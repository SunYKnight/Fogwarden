//! LAN player view: HTTP + WebSocket server inside the app process.
//!
//! Routes: `/` and `/player.html` (player page), `/assets/*` (built bundle),
//! `/asset/{area}/{path}` (map images and models), `/ws` (sync relay).
//! Every route except the bundle needs a token in `?token=`; asset requests
//! may carry it in the cookie the player page sets instead. Player tokens are
//! the keys of the links map (token → view) the DM app sets; the per-start
//! DM token only counts from loopback.
//!
//! The DM socket speaks the relay's view frames (`src/sync/relayApi.ts`):
//! DM frames are `<view>[,<view>...]\n<message>` and reach only players of
//! those views; a player's hello reaches the DM as `<view>\n<hello>`, and
//! status frames tell the DM how many players watch each view.

use std::collections::{BTreeMap, HashMap};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::body::{Body, Bytes};
use axum::extract::ws::{close_code, CloseFrame, Message, Utf8Bytes, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, Path as UrlPath, Query, State as Shared};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tokio::net::TcpListener;
use tokio::sync::broadcast::{self, error::RecvError};
use tokio::sync::{watch, Mutex};
use tokio::task::JoinHandle;
use tokio_util::io::ReaderStream;

use crate::frontend;
use crate::storage::{self, Area, StorageError, StorageState};

const PLAYER_PAGE: &str = "player.html";
const BUNDLE_DIR: &str = "assets";
const TOKEN_COOKIE: &str = "dmtool-lan";
// Players only ever send `hello`; anything bigger is not a valid message.
const PLAYER_MESSAGE_LIMIT: usize = 1024;
// Receivers that fall this far behind are dropped and reconnect for a resend.
const CHANNEL_CAPACITY: usize = 64;
// `RELAY_LINK_REVOKED`: the player page stops reconnecting on this code.
const LINK_REVOKED: u16 = 4001;

/// Player link token → view ('party' or a player character's combatant id).
type Links = HashMap<String, String>;
/// Connected players per view; views without players are absent.
type PlayerCounts = BTreeMap<String, usize>;

#[derive(Debug)]
pub struct LanError(String);

impl std::fmt::Display for LanError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl Serialize for LanError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

impl From<std::io::Error> for LanError {
    fn from(value: std::io::Error) -> Self {
        LanError(value.to_string())
    }
}

impl From<StorageError> for LanError {
    fn from(value: StorageError) -> Self {
        LanError(value.to_string())
    }
}

impl From<tokio::task::JoinError> for LanError {
    fn from(value: tokio::task::JoinError) -> Self {
        LanError(value.to_string())
    }
}

struct HttpError(StatusCode, String);

impl IntoResponse for HttpError {
    fn into_response(self) -> Response {
        (self.0, self.1).into_response()
    }
}

fn internal_error(error: impl std::fmt::Display) -> HttpError {
    HttpError(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
}

/// What the server needs from the app; tests run it without Tauri.
trait LanHost: Send + Sync + 'static {
    fn area_root(&self, area: Area) -> Result<PathBuf, LanError>;
    /// File of the built frontend by '/'-separated path below `dist/`.
    fn frontend_file(&self, path: &str) -> Option<(Vec<u8>, String)>;
}

struct AppHost(AppHandle);

impl LanHost for AppHost {
    fn area_root(&self, area: Area) -> Result<PathBuf, LanError> {
        Ok(self.0.state::<StorageState>().root(area)?)
    }

    fn frontend_file(&self, path: &str) -> Option<(Vec<u8>, String)> {
        frontend::read(&self.0, path)
    }
}

#[derive(Debug, PartialEq, Eq)]
struct Viewer {
    token: String,
    view: String,
}

#[derive(Debug, PartialEq, Eq)]
enum Role {
    Player(Viewer),
    Dm,
}

impl Role {
    // Logs must not carry tokens, so not the Debug output.
    fn name(&self) -> &'static str {
        match self {
            Role::Player(_) => "player",
            Role::Dm => "DM",
        }
    }

    fn link_check(&self, links: &Links) -> Next {
        match self {
            Role::Player(viewer) => match links.get(&viewer.token) {
                None => Next::Kick(LINK_REVOKED, "link revoked"),
                Some(view) if *view != viewer.view => Next::Kick(close_code::AGAIN, "view changed, reconnect"),
                Some(_) => Next::Stay,
            },
            Role::Dm => Next::Stay,
        }
    }
}

fn random_token() -> Result<String, LanError> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|e| LanError(e.to_string()))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

// Constant time: response timing must not reveal partial token matches.
fn token_matches(expected: &str, given: &str) -> bool {
    expected.len() == given.len()
        && expected
            .bytes()
            .zip(given.bytes())
            .fold(0u8, |diff, (a, b)| diff | (a ^ b))
            == 0
}

// The DM token only counts from this machine, so even a leaked DM URL
// does not let a LAN device send messages as the DM.
fn role(links: &Links, dm: &str, given: &str, peer: IpAddr) -> Option<Role> {
    match links.iter().find(|(token, _)| token_matches(token, given)) {
        Some((token, view)) => Some(Role::Player(Viewer {
            token: token.clone(),
            view: view.clone(),
        })),
        None if token_matches(dm, given) && peer.is_loopback() => Some(Role::Dm),
        None => None,
    }
}

// Same character set as `RELAY_TOKEN_PATTERN` and `RELAY_VIEW_PATTERN`.
fn link_text(text: &str, min: usize, max: usize) -> bool {
    (min..=max).contains(&text.len())
        && text
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn valid_view(view: &str) -> bool {
    link_text(view, 1, 64)
}

fn check_links(links: &Links) -> Result<(), LanError> {
    let valid = links
        .iter()
        .all(|(token, view)| link_text(token, 16, 128) && valid_view(view));
    if valid {
        Ok(())
    } else {
        Err(LanError(
            "player links need tokens of 16-128 and views of 1-64 of A-Z a-z 0-9 _ -".into(),
        ))
    }
}

/// A DM message and the views it is for; both slices of the received frame.
#[derive(Clone)]
struct ViewFrame {
    views: Utf8Bytes,
    message: Utf8Bytes,
}

// Same rules as `parseViewFrame`; the message itself stays unparsed.
fn view_frame(text: Utf8Bytes) -> Option<ViewFrame> {
    let end = text.find('\n').filter(|&end| text[..end].split(',').all(valid_view))?;
    let bytes = Bytes::from(text);
    Some(ViewFrame {
        views: Utf8Bytes::try_from(bytes.slice(..end)).ok()?,
        message: Utf8Bytes::try_from(bytes.slice(end + 1..)).ok()?,
    })
}

/// What a broadcast channel carries and which of it a socket gets.
trait Outgoing: Clone + Send + 'static {
    fn text_for(self, role: &Role) -> Option<Utf8Bytes>;
}

impl Outgoing for Utf8Bytes {
    fn text_for(self, _role: &Role) -> Option<Utf8Bytes> {
        Some(self)
    }
}

impl Outgoing for ViewFrame {
    fn text_for(self, role: &Role) -> Option<Utf8Bytes> {
        match role {
            Role::Player(viewer) => self
                .views
                .split(',')
                .any(|view| view == viewer.view)
                .then_some(self.message),
            Role::Dm => None,
        }
    }
}

fn status(players: &PlayerCounts) -> Utf8Bytes {
    let total: usize = players.values().sum();
    serde_json::json!({ "relay": { "players": total, "views": players } })
        .to_string()
        .into()
}

struct Hub {
    host: Box<dyn LanHost>,
    dm_token: String,
    links: watch::Sender<Links>,
    to_players: broadcast::Sender<ViewFrame>,
    to_dm: broadcast::Sender<Utf8Bytes>,
    players: watch::Sender<PlayerCounts>,
    shutdown: watch::Receiver<bool>,
}

#[derive(Deserialize)]
struct Auth {
    #[serde(default)]
    token: String,
}

enum Next {
    Stay,
    Leave,
    Kick(u16, &'static str),
}

impl Hub {
    fn authorize(&self, links: &Links, token: &str, peer: SocketAddr) -> Result<Role, HttpError> {
        role(links, &self.dm_token, token, peer.ip())
            .ok_or_else(|| HttpError(StatusCode::UNAUTHORIZED, "missing or wrong token".into()))
    }

    // A send without receivers only means nobody is connected right now:
    // players resend `hello` on connect and the DM resends on reconnect, and
    // a connecting DM gets the current status first.
    fn count_player(&self, view: &str, joined: bool) {
        self.players.send_modify(|players| {
            let count = players.get(view).copied().unwrap_or_default();
            let count = if joined { count + 1 } else { count - 1 };
            if count == 0 {
                players.remove(view);
            } else {
                players.insert(view.to_owned(), count);
            }
            // Sent under the lock, so DMs see the status frames in order.
            let _ = self.to_dm.send(status(players));
        });
    }

    fn set_links(&self, links: Links) {
        self.links.send_replace(links);
        let _ = self.to_dm.send(status(&self.players.borrow()));
    }

    // Subscribed under the counts lock: every later status frame is at
    // least as new as the returned one.
    fn dm_subscribe(&self) -> (broadcast::Receiver<Utf8Bytes>, Utf8Bytes) {
        let players = self.players.borrow();
        (self.to_dm.subscribe(), status(&players))
    }

    fn incoming(&self, role: &Role, text: Utf8Bytes) -> Next {
        match role {
            Role::Dm => match view_frame(text) {
                Some(frame) => {
                    let _ = self.to_players.send(frame);
                    Next::Stay
                }
                None => Next::Kick(close_code::POLICY, "frames must start with a view list"),
            },
            Role::Player(viewer) => match player_hello(&viewer.view, text.as_str()) {
                Some(hello) => {
                    let _ = self.to_dm.send(hello);
                    Next::Stay
                }
                None => Next::Kick(close_code::POLICY, "players may only send hello"),
            },
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PlayerMessage {
    protocol: u32,
    from: PlayerSender,
    payload: PlayerPayload,
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum PlayerSender {
    Player,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PlayerPayload {
    #[serde(rename = "type")]
    kind: PayloadKind,
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum PayloadKind {
    Hello,
}

// Rebuilt instead of forwarded, so the DM only ever sees a clean hello.
fn player_hello(view: &str, text: &str) -> Option<Utf8Bytes> {
    serde_json::from_str::<PlayerMessage>(text).ok().map(|message| {
        let PlayerMessage {
            protocol,
            from: PlayerSender::Player,
            payload: PlayerPayload {
                kind: PayloadKind::Hello,
            },
        } = message;
        format!("{view}\n{{\"protocol\":{protocol},\"from\":\"player\",\"payload\":{{\"type\":\"hello\"}}}}").into()
    })
}

fn asset_mime(extension: &str) -> Option<&'static str> {
    match extension.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        "avif" => Some("image/avif"),
        "glb" => Some("model/gltf-binary"),
        "gltf" => Some("model/gltf+json"),
        "bin" => Some("application/octet-stream"),
        "ktx2" => Some("image/ktx2"),
        _ => None,
    }
}

// Images and models only: documents hold DM secrets (hidden monsters,
// secret doors, notes) and must never reach a player.
fn asset_file(root: &Path, path: &str) -> Result<(PathBuf, &'static str), HttpError> {
    let file = storage::resolve(root, path).map_err(|e| HttpError(StatusCode::BAD_REQUEST, e.to_string()))?;
    let mime = file
        .extension()
        .and_then(|e| e.to_str())
        .and_then(asset_mime)
        .ok_or_else(|| HttpError(StatusCode::FORBIDDEN, format!("not a map asset: {path}")))?;
    if file.is_file() {
        Ok((file, mime))
    } else {
        Err(HttpError(StatusCode::NOT_FOUND, format!("no such asset: {path}")))
    }
}

fn frontend_response(hub: &Hub, path: &str) -> Result<Response, HttpError> {
    let (bytes, mime) = hub.host.frontend_file(path).ok_or_else(|| {
        HttpError(
            StatusCode::NOT_FOUND,
            format!("{path} is missing from the player bundle; run `pnpm build`"),
        )
    })?;
    Ok(([(header::CONTENT_TYPE, mime)], bytes).into_response())
}

// Models load their .bin and textures by relative URL, which drops the query;
// the cookie set with the player page covers those requests.
fn cookie_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .find_map(|pair| pair.trim().strip_prefix(TOKEN_COOKIE)?.strip_prefix('='))
}

async fn player_page(
    Shared(hub): Shared<Arc<Hub>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Query(auth): Query<Auth>,
) -> Result<Response, HttpError> {
    hub.authorize(&hub.links.borrow(), &auth.token, peer)?;
    let cookie = format!("{TOKEN_COOKIE}={}; Path=/asset; HttpOnly; SameSite=Strict", auth.token);
    let mut response = frontend_response(&hub, PLAYER_PAGE)?;
    response.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_str(&cookie).map_err(internal_error)?,
    );
    Ok(response)
}

// Vite's hashed chunks are app code without user data, and the browser
// requests them without the token.
async fn bundle_file(Shared(hub): Shared<Arc<Hub>>, UrlPath(file): UrlPath<String>) -> Result<Response, HttpError> {
    storage::resolve(Path::new(BUNDLE_DIR), &file).map_err(|e| HttpError(StatusCode::BAD_REQUEST, e.to_string()))?;
    frontend_response(&hub, &format!("{BUNDLE_DIR}/{file}"))
}

async fn storage_asset(
    Shared(hub): Shared<Arc<Hub>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Query(auth): Query<Auth>,
    headers: HeaderMap,
    UrlPath((area, path)): UrlPath<(Area, String)>,
) -> Result<Response, HttpError> {
    let token = if auth.token.is_empty() {
        cookie_token(&headers).unwrap_or_default()
    } else {
        &auth.token
    };
    hub.authorize(&hub.links.borrow(), token, peer)?;
    let root = hub.host.area_root(area).map_err(internal_error)?;
    let (file, mime) = asset_file(&root, &path)?;
    let stream = ReaderStream::new(tokio::fs::File::open(&file).await.map_err(internal_error)?);
    // CORS: a player page from the Vite dev server (`?ws=`) loads assets
    // cross-origin, and three.js loaders request them in CORS mode.
    let headers = [
        (header::CONTENT_TYPE, mime),
        (header::CACHE_CONTROL, "no-cache"),
        (header::ACCESS_CONTROL_ALLOW_ORIGIN, "*"),
    ];
    Ok((headers, Body::from_stream(stream)).into_response())
}

async fn socket(
    Shared(hub): Shared<Arc<Hub>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Query(auth): Query<Auth>,
    upgrade: WebSocketUpgrade,
) -> Result<Response, HttpError> {
    // Authorized against the subscribed links, so a session sees every
    // links change after its check.
    let links = hub.links.subscribe();
    let role = hub.authorize(&links.borrow(), &auth.token, peer)?;
    // Subscribing before the handshake completes means a client never misses
    // a message sent right after it connected.
    let response = match role {
        Role::Player(_) => {
            let outgoing = hub.to_players.subscribe();
            upgrade
                .max_message_size(PLAYER_MESSAGE_LIMIT)
                .on_upgrade(move |socket| session(hub, role, socket, outgoing, links, None))
        }
        Role::Dm => {
            let (outgoing, status) = hub.dm_subscribe();
            upgrade.on_upgrade(move |socket| session(hub, role, socket, outgoing, links, Some(status)))
        }
    };
    Ok(response)
}

async fn session<T: Outgoing>(
    hub: Arc<Hub>,
    role: Role,
    socket: WebSocket,
    outgoing: broadcast::Receiver<T>,
    links: watch::Receiver<Links>,
    greeting: Option<Utf8Bytes>,
) {
    if let Role::Player(viewer) = &role {
        hub.count_player(&viewer.view, true);
    }
    let result = relay(&hub, &role, socket, outgoing, links, greeting).await;
    if let Role::Player(viewer) = &role {
        hub.count_player(&viewer.view, false);
    }
    if let Err(error) = result {
        eprintln!("LAN {} connection failed: {error}", role.name());
    }
}

async fn relay<T: Outgoing>(
    hub: &Hub,
    role: &Role,
    mut socket: WebSocket,
    mut outgoing: broadcast::Receiver<T>,
    mut links: watch::Receiver<Links>,
    greeting: Option<Utf8Bytes>,
) -> Result<(), axum::Error> {
    if let Some(text) = greeting {
        socket.send(Message::Text(text)).await?;
    }
    let mut shutdown = hub.shutdown.clone();
    let mut next = Next::Stay;
    while matches!(next, Next::Stay) {
        next = tokio::select! {
            message = outgoing.recv() => match message {
                Ok(item) => {
                    if let Some(text) = item.text_for(role) {
                        socket.send(Message::Text(text)).await?;
                    }
                    Next::Stay
                }
                Err(RecvError::Lagged(_)) => Next::Kick(close_code::AGAIN, "fell behind, reconnect"),
                Err(RecvError::Closed) => Next::Kick(close_code::AWAY, "server stopped"),
            },
            incoming = socket.recv() => match incoming {
                Some(Ok(Message::Text(text))) => hub.incoming(role, text),
                Some(Ok(Message::Binary(_))) => Next::Kick(close_code::UNSUPPORTED, "text messages only"),
                Some(Ok(Message::Close(_))) | None => Next::Leave,
                Some(Ok(Message::Ping(_) | Message::Pong(_))) => Next::Stay,
                Some(Err(error)) => Err(error)?,
            },
            changed = links.changed() => match changed {
                Ok(()) => role.link_check(&links.borrow_and_update()),
                // The links sender lives in the hub, so it is gone only
                // once the server is.
                Err(_) => Next::Kick(close_code::AWAY, "server stopped"),
            },
            _ = shutdown.changed() => Next::Kick(close_code::AWAY, "server stopped"),
        };
    }
    if let Next::Kick(code, reason) = next {
        let frame = CloseFrame {
            code,
            reason: reason.into(),
        };
        socket.send(Message::Close(Some(frame))).await?;
    }
    Ok(())
}

fn router(hub: Arc<Hub>) -> Router {
    Router::new()
        .route("/", get(player_page))
        .route("/player.html", get(player_page))
        .route("/assets/{*file}", get(bundle_file))
        .route("/asset/{area}/{*path}", get(storage_asset))
        .route("/ws", get(socket))
        .with_state(hub)
}

// Interface addresses only; IPv4 because phones get typed or scanned URLs.
fn lan_hosts(port: u16) -> Result<Vec<String>, LanError> {
    let mut hosts: Vec<Ipv4Addr> = if_addrs::get_if_addrs()?
        .iter()
        .filter(|interface| interface.is_oper_up())
        .filter_map(|interface| match interface.ip() {
            IpAddr::V4(ip) if !ip.is_loopback() && !ip.is_link_local() => Some(ip),
            _ => None,
        })
        .collect();
    hosts.sort();
    hosts.dedup();
    // Last, for trying the player view on the DM's own machine.
    hosts.push(Ipv4Addr::LOCALHOST);
    Ok(hosts.iter().map(|host| format!("http://{host}:{port}")).collect())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanInfo {
    port: u16,
    /// Player view base URLs; the app appends the page and a link token.
    hosts: Vec<String>,
    /// WebSocket URL for the DM window; loopback only.
    dm_url: String,
    players: usize,
}

struct Server {
    hub: Arc<Hub>,
    port: u16,
    hosts: Vec<String>,
    stop: watch::Sender<bool>,
    task: JoinHandle<std::io::Result<()>>,
}

impl Server {
    fn spawn(host: Box<dyn LanHost>, listener: TcpListener, links: Links) -> Result<Self, LanError> {
        let port = listener.local_addr()?.port();
        let (stop, shutdown) = watch::channel(false);
        let hub = Arc::new(Hub {
            host,
            dm_token: random_token()?,
            links: watch::Sender::new(links),
            to_players: broadcast::channel(CHANNEL_CAPACITY).0,
            to_dm: broadcast::channel(CHANNEL_CAPACITY).0,
            players: watch::Sender::new(PlayerCounts::new()),
            shutdown: shutdown.clone(),
        });
        let hosts = lan_hosts(port)?;
        let service = router(hub.clone()).into_make_service_with_connect_info::<SocketAddr>();
        let mut signal = shutdown;
        let task = tokio::spawn(async move {
            axum::serve(listener, service)
                .with_graceful_shutdown(async move {
                    // An error means the sender is gone, which is a stop too.
                    let _ = signal.changed().await;
                })
                .await
        });
        Ok(Server {
            hub,
            port,
            hosts,
            stop,
            task,
        })
    }

    fn info(&self) -> LanInfo {
        LanInfo {
            port: self.port,
            hosts: self.hosts.clone(),
            dm_url: format!("ws://127.0.0.1:{}/ws?token={}", self.port, self.hub.dm_token),
            players: self.hub.players.borrow().values().sum(),
        }
    }

    async fn stop(self) -> Result<(), LanError> {
        self.stop.send_replace(true);
        Ok(self.task.await??)
    }
}

#[derive(Default)]
pub struct LanState(Mutex<Option<Server>>);

/// Starts the server on all interfaces with a fresh DM token and the given
/// player links.
#[tauri::command]
pub async fn lan_start(
    app: AppHandle,
    state: State<'_, LanState>,
    port: u16,
    links: Links,
) -> Result<LanInfo, LanError> {
    check_links(&links)?;
    let mut server = state.0.lock().await;
    if server.is_some() {
        Err(LanError("the LAN server is already running".into()))
    } else {
        let listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::UNSPECIFIED, port)))
            .await
            .map_err(|e| LanError(format!("cannot listen on port {port}: {e}")))?;
        let started = Server::spawn(Box::new(AppHost(app)), listener, links)?;
        let info = started.info();
        *server = Some(started);
        Ok(info)
    }
}

/// Replaces all player links; players of withdrawn or moved links are
/// disconnected.
#[tauri::command]
pub async fn lan_set_links(state: State<'_, LanState>, links: Links) -> Result<(), LanError> {
    check_links(&links)?;
    match state.0.lock().await.as_ref() {
        Some(server) => {
            server.hub.set_links(links);
            Ok(())
        }
        None => Err(LanError("the LAN server is not running".into())),
    }
}

/// Stops the server and waits until the port is free again.
#[tauri::command]
pub async fn lan_stop(state: State<'_, LanState>) -> Result<(), LanError> {
    let mut server = state.0.lock().await;
    match server.take() {
        Some(running) => running.stop().await,
        None => Ok(()),
    }
}

#[tauri::command]
pub async fn lan_status(state: State<'_, LanState>) -> Result<Option<LanInfo>, LanError> {
    Ok(state.0.lock().await.as_ref().map(Server::info))
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::{SinkExt, StreamExt};
    use serde_json::{json, Value};
    use std::io::{Read, Write};
    use tokio_tungstenite::tungstenite::{Error as WsError, Message as WsMessage};

    const HELLO: &str = r#"{"protocol":1,"from":"player","payload":{"type":"hello"}}"#;

    fn test_root(name: &str) -> PathBuf {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join(format!("lan-test-{name}"));
        if root.exists() {
            std::fs::remove_dir_all(&root).unwrap();
        }
        std::fs::create_dir_all(root.join("library/maps/m1/assets")).unwrap();
        std::fs::write(root.join("library/maps/m1/assets/map.png"), b"PNGDATA").unwrap();
        std::fs::write(root.join("library/maps/m1/map.json"), b"{\"secret\":true}").unwrap();
        std::fs::create_dir_all(root.join("folder.png")).unwrap();
        root
    }

    fn links(entries: &[(&str, &str)]) -> Links {
        entries
            .iter()
            .map(|(token, view)| (token.to_string(), view.to_string()))
            .collect()
    }

    #[test]
    fn token_matches_only_identical_tokens() {
        assert!(token_matches("abc123", "abc123"));
        assert!(!token_matches("abc123", "abc124"));
        assert!(!token_matches("abc123", "abc12"));
        assert!(!token_matches("abc123", ""));
    }

    #[test]
    fn dm_token_only_counts_from_loopback() {
        let (player, dm) = ("p".repeat(32), "d".repeat(32));
        let links = links(&[(&player, "party")]);
        let lan: IpAddr = "192.168.1.20".parse().unwrap();
        let local: IpAddr = Ipv4Addr::LOCALHOST.into();
        let viewer = || {
            Some(Role::Player(Viewer {
                token: player.clone(),
                view: "party".into(),
            }))
        };
        assert_eq!(role(&links, &dm, &player, lan), viewer());
        assert_eq!(role(&links, &dm, &player, local), viewer());
        assert_eq!(role(&links, &dm, &dm, local), Some(Role::Dm));
        assert_eq!(role(&links, &dm, &dm, lan), None);
        assert_eq!(role(&links, &dm, "", lan), None);
        assert_eq!(role(&links, &dm, "party", local), None);
        assert_eq!(role(&links, &dm, &"x".repeat(32), local), None);
    }

    #[test]
    fn generated_tokens_differ() {
        let (first, second) = (random_token().unwrap(), random_token().unwrap());
        assert_eq!(first.len(), 32);
        assert_ne!(first, second);
    }

    #[test]
    fn links_follow_the_relay_patterns() {
        let token = "a".repeat(16);
        assert!(check_links(&links(&[(&token, "party"), (&"B_-9".repeat(32), &"v".repeat(64))])).is_ok());
        assert!(check_links(&Links::new()).is_ok());
        assert!(check_links(&links(&[(&"a".repeat(15), "party")])).is_err());
        assert!(check_links(&links(&[(&"a".repeat(129), "party")])).is_err());
        assert!(check_links(&links(&[(&format!("{token}!"), "party")])).is_err());
        assert!(check_links(&links(&[(&token, "")])).is_err());
        assert!(check_links(&links(&[(&token, &"v".repeat(65))])).is_err());
        assert!(check_links(&links(&[(&token, "a,b")])).is_err());
    }

    fn frame_parts(text: &'static str) -> Option<(String, String)> {
        view_frame(Utf8Bytes::from(text)).map(|frame| (frame.views.to_string(), frame.message.to_string()))
    }

    #[test]
    fn view_frames_need_a_view_list() {
        let parts = |views: &str, message: &str| Some((views.to_owned(), message.to_owned()));
        assert_eq!(frame_parts("party\n{}"), parts("party", "{}"));
        assert_eq!(
            frame_parts("A,b-1_c\n{\"x\":\"a\\nb\"}\nrest"),
            parts("A,b-1_c", "{\"x\":\"a\\nb\"}\nrest")
        );
        assert_eq!(frame_parts("A\n"), parts("A", ""));
        assert_eq!(frame_parts("{\"relay\":{}}"), None);
        assert_eq!(frame_parts("\n{}"), None);
        assert_eq!(frame_parts("A,\n{}"), None);
        assert_eq!(frame_parts("A B\n{}"), None);
        assert_eq!(frame_parts("A"), None);
        let long = format!("{}\n{{}}", "v".repeat(65));
        assert!(view_frame(Utf8Bytes::from(long)).is_none());
    }

    #[test]
    fn view_frames_reach_only_their_views() {
        let viewer = |view: &str| {
            Role::Player(Viewer {
                token: "t".repeat(16),
                view: view.into(),
            })
        };
        let frame = view_frame(Utf8Bytes::from("A,Bc\nmsg")).unwrap();
        assert_eq!(frame.clone().text_for(&viewer("A")).unwrap().as_str(), "msg");
        assert_eq!(frame.clone().text_for(&viewer("Bc")).unwrap().as_str(), "msg");
        assert!(frame.clone().text_for(&viewer("B")).is_none());
        assert!(frame.text_for(&Role::Dm).is_none());
    }

    fn asset_status(root: &Path, path: &str) -> StatusCode {
        asset_file(root, path).map_or_else(|e| e.0, |_| StatusCode::OK)
    }

    #[test]
    fn asset_paths_stay_inside_the_root() {
        let root = test_root("containment");
        assert_eq!(asset_status(&root, "library/maps/m1/assets/map.png"), StatusCode::OK);
        let escaped = "../lan-test-containment/library/maps/m1/assets/map.png";
        assert_eq!(asset_status(&root, escaped), StatusCode::BAD_REQUEST);
        assert_eq!(asset_status(&root, "library/../../x.png"), StatusCode::BAD_REQUEST);
        assert_eq!(asset_status(&root, "/etc/x.png"), StatusCode::BAD_REQUEST);
        if cfg!(windows) {
            assert_eq!(asset_status(&root, "C:/Windows/x.png"), StatusCode::BAD_REQUEST);
            assert_eq!(asset_status(&root, "library\\..\\..\\x.png"), StatusCode::BAD_REQUEST);
            assert_eq!(asset_status(&root, "\\\\server\\share\\x.png"), StatusCode::BAD_REQUEST);
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn assets_are_images_and_models_only() {
        let root = test_root("types");
        assert_eq!(asset_status(&root, "library/maps/m1/map.json"), StatusCode::FORBIDDEN);
        assert_eq!(asset_status(&root, "library/maps/m1"), StatusCode::FORBIDDEN);
        assert_eq!(asset_status(&root, ""), StatusCode::FORBIDDEN);
        assert_eq!(asset_status(&root, "folder.png"), StatusCode::NOT_FOUND);
        assert_eq!(asset_status(&root, "missing.glb"), StatusCode::NOT_FOUND);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn players_can_only_send_hello() {
        assert_eq!(player_hello("A", HELLO).unwrap().as_str(), format!("A\n{HELLO}"));
        let dm = r#"{"protocol":1,"from":"dm","payload":{"type":"hello"}}"#;
        assert!(player_hello("A", dm).is_none());
        let map = r#"{"protocol":1,"from":"player","payload":{"type":"map","map":null}}"#;
        assert!(player_hello("A", map).is_none());
        let extra_payload = r#"{"protocol":1,"from":"player","payload":{"type":"hello","x":1}}"#;
        assert!(player_hello("A", extra_payload).is_none());
        let extra = r#"{"protocol":1,"from":"player","payload":{"type":"hello"},"x":1}"#;
        assert!(player_hello("A", extra).is_none());
        assert!(player_hello("A", "not json").is_none());
    }

    struct TestHost(PathBuf);

    impl LanHost for TestHost {
        fn area_root(&self, _area: Area) -> Result<PathBuf, LanError> {
            Ok(self.0.clone())
        }

        fn frontend_file(&self, path: &str) -> Option<(Vec<u8>, String)> {
            (path == PLAYER_PAGE).then(|| (b"<html>player</html>".to_vec(), "text/html".to_owned()))
        }
    }

    async fn http_get(port: u16, path: &str, extra_headers: &str) -> String {
        let request = format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\n{extra_headers}Connection: close\r\n\r\n");
        tokio::task::spawn_blocking(move || {
            let mut stream = std::net::TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
            stream.write_all(request.as_bytes()).unwrap();
            let mut response = Vec::new();
            stream.read_to_end(&mut response).unwrap();
            String::from_utf8_lossy(&response).into_owned()
        })
        .await
        .unwrap()
    }

    type Client = tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

    async fn connect(port: u16, token: &str) -> Client {
        tokio_tungstenite::connect_async(format!("ws://127.0.0.1:{port}/ws?token={token}"))
            .await
            .unwrap()
            .0
    }

    async fn rejected(port: u16, token: &str) -> bool {
        let result = tokio_tungstenite::connect_async(format!("ws://127.0.0.1:{port}/ws?token={token}")).await;
        matches!(result, Err(WsError::Http(response)) if response.status() == StatusCode::UNAUTHORIZED.as_u16())
    }

    async fn next_text(socket: &mut Client) -> String {
        socket
            .next()
            .await
            .unwrap()
            .unwrap()
            .into_text()
            .unwrap()
            .as_str()
            .to_owned()
    }

    async fn expect_status(dm: &mut Client, players: usize, views: Value) {
        let status: Value = serde_json::from_str(&next_text(dm).await).unwrap();
        assert_eq!(status, json!({ "relay": { "players": players, "views": views } }));
    }

    async fn expect_close(socket: &mut Client, code: u16, reason: &str) {
        match socket.next().await.unwrap().unwrap() {
            WsMessage::Close(Some(frame)) => {
                assert_eq!(u16::from(frame.code), code);
                assert_eq!(frame.reason.as_str(), reason);
            }
            other => panic!("expected close {code}, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn serves_assets_and_relays_messages_on_localhost() {
        let root = test_root("smoke");
        let token = "p".repeat(32);
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let server = Server::spawn(Box::new(TestHost(root.clone())), listener, links(&[(&token, "party")])).unwrap();
        let info = server.info();
        let port = info.port;
        assert_eq!(info.hosts.last().unwrap(), &format!("http://127.0.0.1:{port}"));
        let asset = "/asset/data/library/maps/m1/assets/map.png";
        let get = |path: String| async move { http_get(port, &path, "").await };

        let served = get(format!("{asset}?token={token}")).await;
        assert!(served.starts_with("HTTP/1.1 200"));
        assert!(served.contains("PNGDATA"));
        assert!(get(asset.to_owned()).await.starts_with("HTTP/1.1 401"));
        assert!(get(format!("{asset}?token=wrong")).await.starts_with("HTTP/1.1 401"));
        let json = format!("/asset/data/library/maps/m1/map.json?token={token}");
        assert!(get(json).await.starts_with("HTTP/1.1 403"));
        let escape = format!("/asset/data/..%2F..%2Fsecret.png?token={token}");
        assert!(get(escape).await.starts_with("HTTP/1.1 400"));

        let page = get(format!("/player.html?token={token}")).await;
        assert!(page.contains("<html>player</html>"));
        assert!(page.contains(&format!("set-cookie: {TOKEN_COOKIE}={token}; Path=/asset;")));
        assert!(get("/player.html".to_owned()).await.starts_with("HTTP/1.1 401"));
        let with_cookie = http_get(port, asset, &format!("Cookie: a=b; {TOKEN_COOKIE}={token}\r\n")).await;
        assert!(with_cookie.starts_with("HTTP/1.1 200"));
        let wrong_cookie = http_get(port, asset, &format!("Cookie: {TOKEN_COOKIE}=wrong\r\n")).await;
        assert!(wrong_cookie.starts_with("HTTP/1.1 401"));

        assert!(tokio_tungstenite::connect_async(format!("ws://127.0.0.1:{port}/ws"))
            .await
            .is_err());
        let (mut dm, _) = tokio_tungstenite::connect_async(info.dm_url.as_str()).await.unwrap();
        expect_status(&mut dm, 0, json!({})).await;
        let mut player = connect(port, &token).await;
        expect_status(&mut dm, 1, json!({ "party": 1 })).await;
        assert_eq!(server.info().players, 1);

        player.send(WsMessage::text(HELLO)).await.unwrap();
        assert_eq!(next_text(&mut dm).await, format!("party\n{HELLO}"));
        let map = r#"{"protocol":1,"from":"dm","payload":{"type":"map","revision":1,"map":null}}"#;
        dm.send(WsMessage::text(format!("party\n{map}"))).await.unwrap();
        assert_eq!(next_text(&mut player).await, map);

        let forged = r#"{"protocol":1,"from":"dm","payload":{"type":"camera","camera":null}}"#;
        player.send(WsMessage::text(forged)).await.unwrap();
        expect_close(&mut player, close_code::POLICY, "players may only send hello").await;
        // The forged message never reached the DM: it only sees the player
        // leave, then a second player join and say hello.
        expect_status(&mut dm, 0, json!({})).await;
        let mut second = connect(port, &token).await;
        expect_status(&mut dm, 1, json!({ "party": 1 })).await;
        second.send(WsMessage::text(HELLO)).await.unwrap();
        assert_eq!(next_text(&mut dm).await, format!("party\n{HELLO}"));

        server.stop().await.unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn routes_messages_per_view_and_follows_link_changes() {
        let root = test_root("views");
        let (token_a, token_b) = ("a".repeat(32), "b".repeat(32));
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let initial = links(&[(&token_a, "A"), (&token_b, "B")]);
        let server = Server::spawn(Box::new(TestHost(root.clone())), listener, initial).unwrap();
        let port = server.info().port;
        let (mut dm, _) = tokio_tungstenite::connect_async(server.info().dm_url.as_str())
            .await
            .unwrap();
        expect_status(&mut dm, 0, json!({})).await;

        let modified = format!("{}c", &token_b[1..]);
        for token in ["party", "A", "B", modified.as_str(), ""] {
            assert!(rejected(port, token).await, "token {token:?} must be rejected");
        }

        let mut a = connect(port, &token_a).await;
        expect_status(&mut dm, 1, json!({ "A": 1 })).await;
        let mut b = connect(port, &token_b).await;
        expect_status(&mut dm, 2, json!({ "A": 1, "B": 1 })).await;

        a.send(WsMessage::text(HELLO)).await.unwrap();
        assert_eq!(next_text(&mut dm).await, format!("A\n{HELLO}"));
        let only_a = r#"{"protocol":1,"from":"dm","payload":{"type":"map","revision":1,"map":null}}"#;
        let both = r#"{"protocol":1,"from":"dm","payload":{"type":"camera","camera":null}}"#;
        dm.send(WsMessage::text(format!("A\n{only_a}"))).await.unwrap();
        dm.send(WsMessage::text(format!("A,B\n{both}"))).await.unwrap();
        assert_eq!(next_text(&mut a).await, only_a);
        assert_eq!(next_text(&mut a).await, both);
        assert_eq!(next_text(&mut b).await, both);

        server.hub.set_links(links(&[(&token_b, "B")]));
        expect_close(&mut a, LINK_REVOKED, "link revoked").await;
        expect_status(&mut dm, 2, json!({ "A": 1, "B": 1 })).await;
        expect_status(&mut dm, 1, json!({ "B": 1 })).await;
        assert!(rejected(port, &token_a).await);
        let page = http_get(port, &format!("/player.html?token={token_a}"), "").await;
        assert!(page.starts_with("HTTP/1.1 401"));
        let asset = format!("/asset/data/library/maps/m1/assets/map.png?token={token_a}");
        assert!(http_get(port, &asset, "").await.starts_with("HTTP/1.1 401"));

        server.hub.set_links(links(&[(&token_b, "A")]));
        expect_close(&mut b, close_code::AGAIN, "view changed, reconnect").await;
        expect_status(&mut dm, 1, json!({ "B": 1 })).await;
        expect_status(&mut dm, 0, json!({})).await;
        let mut moved = connect(port, &token_b).await;
        expect_status(&mut dm, 1, json!({ "A": 1 })).await;
        dm.send(WsMessage::text(format!("B\n{only_a}"))).await.unwrap();
        dm.send(WsMessage::text(format!("A\n{both}"))).await.unwrap();
        assert_eq!(next_text(&mut moved).await, both);

        dm.send(WsMessage::text(both)).await.unwrap();
        expect_close(&mut dm, close_code::POLICY, "frames must start with a view list").await;

        server.stop().await.unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }
}
