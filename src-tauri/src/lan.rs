//! LAN player view: HTTP + WebSocket server inside the app process.
//!
//! Routes: `/` and `/player.html` (player page), `/assets/*` (built bundle),
//! `/asset/{area}/{path}` (map images and models), `/ws` (sync relay).
//! Every route except the bundle needs the session token in `?token=`; asset
//! requests may carry it in the cookie the player page sets instead.

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use axum::body::Body;
use axum::extract::ws::{close_code, CloseFrame, Message, Utf8Bytes, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, Path as UrlPath, Query, State as Shared};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::net::TcpListener;
use tokio::sync::broadcast::{self, error::RecvError};
use tokio::sync::{watch, Mutex};
use tokio::task::JoinHandle;
use tokio_util::io::ReaderStream;

use crate::storage::{self, Area, StorageError, StorageState};

const PLAYERS_EVENT: &str = "lan-players";
const DM_WINDOW: &str = "dm";
const PLAYER_PAGE: &str = "player.html";
const BUNDLE_DIR: &str = "assets";
const TOKEN_COOKIE: &str = "dmtool-lan";
// Players only ever send `hello`; anything bigger is not a valid message.
const PLAYER_MESSAGE_LIMIT: usize = 1024;
// Receivers that fall this far behind are dropped and reconnect for a resend.
const CHANNEL_CAPACITY: usize = 64;

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
    fn players_changed(&self, count: usize);
}

struct AppHost(AppHandle);

impl LanHost for AppHost {
    fn area_root(&self, area: Area) -> Result<PathBuf, LanError> {
        Ok(self.0.state::<StorageState>().root(area)?)
    }

    // Release builds embed dist/ in the executable. Dev builds (devUrl set)
    // embed nothing and Tauri reads ../dist from disk: run `pnpm build` first.
    fn frontend_file(&self, path: &str) -> Option<(Vec<u8>, String)> {
        self.0
            .asset_resolver()
            .get(path.to_owned())
            .map(|asset| (asset.bytes, asset.mime_type))
    }

    fn players_changed(&self, count: usize) {
        if let Err(error) = self.0.emit_to(DM_WINDOW, PLAYERS_EVENT, count) {
            eprintln!("LAN player count event failed: {error}");
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Role {
    Player,
    Dm,
}

struct Tokens {
    player: String,
    dm: String,
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

impl Tokens {
    fn generate() -> Result<Self, LanError> {
        Ok(Tokens {
            player: random_token()?,
            dm: random_token()?,
        })
    }

    // The DM token only counts from this machine, so even a leaked DM URL
    // does not let a LAN device send messages as the DM.
    fn role(&self, given: &str, peer: IpAddr) -> Option<Role> {
        if token_matches(&self.player, given) {
            Some(Role::Player)
        } else if token_matches(&self.dm, given) && peer.is_loopback() {
            Some(Role::Dm)
        } else {
            None
        }
    }
}

struct Hub {
    host: Box<dyn LanHost>,
    tokens: Tokens,
    to_players: broadcast::Sender<Utf8Bytes>,
    to_dm: broadcast::Sender<Utf8Bytes>,
    players: AtomicUsize,
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
    fn authorize(&self, token: &str, peer: SocketAddr) -> Result<Role, HttpError> {
        self.tokens
            .role(token, peer.ip())
            .ok_or_else(|| HttpError(StatusCode::UNAUTHORIZED, "missing or wrong token".into()))
    }

    fn player_joined(&self) {
        self.host
            .players_changed(self.players.fetch_add(1, Ordering::SeqCst) + 1);
    }

    fn player_left(&self) {
        self.host
            .players_changed(self.players.fetch_sub(1, Ordering::SeqCst) - 1);
    }

    // A send without receivers only means nobody is connected right now:
    // players resend `hello` on connect and the DM resends on reconnect.
    fn incoming(&self, role: Role, text: Utf8Bytes) -> Next {
        match role {
            Role::Dm => {
                let _ = self.to_players.send(text);
                Next::Stay
            }
            Role::Player => match player_hello(text.as_str()) {
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
fn player_hello(text: &str) -> Option<Utf8Bytes> {
    serde_json::from_str::<PlayerMessage>(text).ok().map(|message| {
        let PlayerMessage {
            protocol,
            from: PlayerSender::Player,
            payload: PlayerPayload {
                kind: PayloadKind::Hello,
            },
        } = message;
        format!(r#"{{"protocol":{protocol},"from":"player","payload":{{"type":"hello"}}}}"#).into()
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
    hub.authorize(&auth.token, peer)?;
    let cookie = format!(
        "{TOKEN_COOKIE}={}; Path=/asset; HttpOnly; SameSite=Strict",
        hub.tokens.player
    );
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
    hub.authorize(token, peer)?;
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
    let role = hub.authorize(&auth.token, peer)?;
    // Subscribing before the handshake completes means a client never misses
    // a message sent right after it connected.
    let response = match role {
        Role::Player => {
            let outgoing = hub.to_players.subscribe();
            upgrade
                .max_message_size(PLAYER_MESSAGE_LIMIT)
                .on_upgrade(move |socket| session(hub, role, socket, outgoing))
        }
        Role::Dm => {
            let outgoing = hub.to_dm.subscribe();
            upgrade.on_upgrade(move |socket| session(hub, role, socket, outgoing))
        }
    };
    Ok(response)
}

async fn session(hub: Arc<Hub>, role: Role, socket: WebSocket, outgoing: broadcast::Receiver<Utf8Bytes>) {
    if role == Role::Player {
        hub.player_joined();
    }
    let result = relay(&hub, role, socket, outgoing).await;
    if role == Role::Player {
        hub.player_left();
    }
    if let Err(error) = result {
        eprintln!("LAN {role:?} connection failed: {error}");
    }
}

async fn relay(
    hub: &Hub,
    role: Role,
    mut socket: WebSocket,
    mut outgoing: broadcast::Receiver<Utf8Bytes>,
) -> Result<(), axum::Error> {
    let mut shutdown = hub.shutdown.clone();
    let mut next = Next::Stay;
    while matches!(next, Next::Stay) {
        next = tokio::select! {
            message = outgoing.recv() => match message {
                Ok(text) => {
                    socket.send(Message::Text(text)).await?;
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
fn lan_urls(port: u16, token: &str) -> Result<Vec<String>, LanError> {
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
    Ok(hosts
        .iter()
        .map(|host| format!("http://{host}:{port}/{PLAYER_PAGE}?token={token}"))
        .collect())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanInfo {
    port: u16,
    /// Player view URLs with the player token.
    urls: Vec<String>,
    token: String,
    /// WebSocket URL for the DM window; loopback only.
    dm_url: String,
    players: usize,
}

struct Server {
    hub: Arc<Hub>,
    port: u16,
    urls: Vec<String>,
    stop: watch::Sender<bool>,
    task: JoinHandle<std::io::Result<()>>,
}

impl Server {
    fn spawn(host: Box<dyn LanHost>, listener: TcpListener) -> Result<Self, LanError> {
        let port = listener.local_addr()?.port();
        let (stop, shutdown) = watch::channel(false);
        let hub = Arc::new(Hub {
            host,
            tokens: Tokens::generate()?,
            to_players: broadcast::channel(CHANNEL_CAPACITY).0,
            to_dm: broadcast::channel(CHANNEL_CAPACITY).0,
            players: AtomicUsize::new(0),
            shutdown: shutdown.clone(),
        });
        let urls = lan_urls(port, &hub.tokens.player)?;
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
            urls,
            stop,
            task,
        })
    }

    fn info(&self) -> LanInfo {
        LanInfo {
            port: self.port,
            urls: self.urls.clone(),
            token: self.hub.tokens.player.clone(),
            dm_url: format!("ws://127.0.0.1:{}/ws?token={}", self.port, self.hub.tokens.dm),
            players: self.hub.players.load(Ordering::SeqCst),
        }
    }

    async fn stop(self) -> Result<(), LanError> {
        self.stop.send_replace(true);
        Ok(self.task.await??)
    }
}

#[derive(Default)]
pub struct LanState(Mutex<Option<Server>>);

/// Starts the server on all interfaces with fresh tokens.
#[tauri::command]
pub async fn lan_start(app: AppHandle, state: State<'_, LanState>, port: u16) -> Result<LanInfo, LanError> {
    let mut server = state.0.lock().await;
    if server.is_some() {
        Err(LanError("the LAN server is already running".into()))
    } else {
        let listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::UNSPECIFIED, port)))
            .await
            .map_err(|e| LanError(format!("cannot listen on port {port}: {e}")))?;
        let started = Server::spawn(Box::new(AppHost(app)), listener)?;
        let info = started.info();
        *server = Some(started);
        Ok(info)
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
    use std::io::{Read, Write};
    use tokio_tungstenite::tungstenite::Message as WsMessage;

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

    fn tokens() -> Tokens {
        Tokens {
            player: "p".repeat(32),
            dm: "d".repeat(32),
        }
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
        let tokens = tokens();
        let lan: IpAddr = "192.168.1.20".parse().unwrap();
        let local: IpAddr = Ipv4Addr::LOCALHOST.into();
        assert_eq!(tokens.role(&tokens.player, lan), Some(Role::Player));
        assert_eq!(tokens.role(&tokens.player, local), Some(Role::Player));
        assert_eq!(tokens.role(&tokens.dm, local), Some(Role::Dm));
        assert_eq!(tokens.role(&tokens.dm, lan), None);
        assert_eq!(tokens.role("", lan), None);
        assert_eq!(tokens.role(&"x".repeat(32), local), None);
    }

    #[test]
    fn generated_tokens_differ() {
        let tokens = Tokens::generate().unwrap();
        assert_eq!(tokens.player.len(), 32);
        assert_ne!(tokens.player, tokens.dm);
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
        assert_eq!(player_hello(HELLO).unwrap().as_str(), HELLO);
        assert!(player_hello(r#"{"protocol":1,"from":"dm","payload":{"type":"hello"}}"#).is_none());
        assert!(player_hello(r#"{"protocol":1,"from":"player","payload":{"type":"map","map":null}}"#).is_none());
        assert!(player_hello(r#"{"protocol":1,"from":"player","payload":{"type":"hello","x":1}}"#).is_none());
        assert!(player_hello(r#"{"protocol":1,"from":"player","payload":{"type":"hello"},"x":1}"#).is_none());
        assert!(player_hello("not json").is_none());
    }

    struct TestHost(PathBuf);

    impl LanHost for TestHost {
        fn area_root(&self, _area: Area) -> Result<PathBuf, LanError> {
            Ok(self.0.clone())
        }

        fn frontend_file(&self, path: &str) -> Option<(Vec<u8>, String)> {
            (path == PLAYER_PAGE).then(|| (b"<html>player</html>".to_vec(), "text/html".to_owned()))
        }

        fn players_changed(&self, _count: usize) {}
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

    async fn next_text(
        socket: &mut (impl StreamExt<Item = tokio_tungstenite::tungstenite::Result<WsMessage>> + Unpin),
    ) -> String {
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

    #[tokio::test]
    async fn serves_assets_and_relays_messages_on_localhost() {
        let root = test_root("smoke");
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let server = Server::spawn(Box::new(TestHost(root.clone())), listener).unwrap();
        let info = server.info();
        let (port, token) = (info.port, info.token.clone());
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

        let player_url = format!("ws://127.0.0.1:{port}/ws?token={token}");
        assert!(tokio_tungstenite::connect_async(format!("ws://127.0.0.1:{port}/ws"))
            .await
            .is_err());
        let (mut dm, _) = tokio_tungstenite::connect_async(info.dm_url.as_str()).await.unwrap();
        let (mut player, _) = tokio_tungstenite::connect_async(player_url.as_str()).await.unwrap();

        player.send(WsMessage::text(HELLO)).await.unwrap();
        assert_eq!(next_text(&mut dm).await, HELLO);
        let map = r#"{"protocol":1,"from":"dm","payload":{"type":"map","revision":1,"map":null}}"#;
        dm.send(WsMessage::text(map)).await.unwrap();
        assert_eq!(next_text(&mut player).await, map);

        let forged = r#"{"protocol":1,"from":"dm","payload":{"type":"camera","camera":null}}"#;
        player.send(WsMessage::text(forged)).await.unwrap();
        match player.next().await.unwrap().unwrap() {
            WsMessage::Close(Some(frame)) => assert_eq!(u16::from(frame.code), close_code::POLICY),
            other => panic!("expected a policy close, got {other:?}"),
        }
        // The forged message never reached the DM: the next one it sees is
        // the hello of a second player.
        let (mut second, _) = tokio_tungstenite::connect_async(player_url.as_str()).await.unwrap();
        second.send(WsMessage::text(HELLO)).await.unwrap();
        assert_eq!(next_text(&mut dm).await, HELLO);

        server.stop().await.unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }
}
