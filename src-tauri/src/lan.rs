//! LAN player view: HTTP + WebSocket server inside the app process.
//!
//! Routes: `/` and `/player.html` (player page), `/assets/*` (built bundle),
//! `/asset/{area}/{path}` (map images and models), `/ws` (sync relay),
//! `PUT /api/player-upload/{name}` (a player's picture for the DM).
//! Every route except the bundle needs a token in `?token=`; asset requests
//! may carry it in the cookie the player page sets instead. Player tokens are
//! the keys of the links map (token → view) the DM app sets; the per-start
//! DM token only counts from loopback.
//!
//! The DM socket speaks the relay's view frames (`src/sync/relayApi.ts`):
//! DM frames are `<view>[,<view>...]\n<message>` and reach only players of
//! those views; a player's message (hello, roll, ping, own token move)
//! reaches the DM rebuilt as `<view>\n<message>`, status frames tell the
//! DM how many players watch each view and uploads frames which pictures
//! wait. The DM app reads and deletes those through commands, never HTTP.
//!
//! A remote DM (a second device of the DM on the LAN, token in the links map
//! under the reserved view `@dm`) gets the DM page (`/dm.html`), the DM's
//! files through `/dm/storage/*` and a socket to the DM app: DM frames
//! `@dm\n<message>` reach every remote DM as `<message>`, a remote DM's
//! message reaches the DM as `@dm\n<message>`, and `@dm-count\n<n>` tells
//! the DM how many remote DMs are connected.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::ffi::OsStr;
use std::io::SeekFrom;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use axum::body::{Body, Bytes};
use axum::extract::DefaultBodyLimit;
use axum::extract::ws::{close_code, CloseFrame, Message, Utf8Bytes, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, Path as UrlPath, Query, State as Shared};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use axum::Router;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::broadcast::{self, error::RecvError};
use tokio::sync::{watch, Mutex};
use tokio::task::JoinHandle;
use tokio_util::io::ReaderStream;

use crate::frontend;
use crate::history;
use crate::storage::{self, Area, StorageError, StorageState};

const PLAYER_PAGE: &str = "player.html";
const BUNDLE_DIR: &str = "assets";
const TOKEN_COOKIE: &str = "fogwarden-lan";
const DM_PAGE: &str = "index.html";
// Path=/, unlike the player cookie: the remote DM's storage requests use it.
const DM_COOKIE: &str = "fogwarden-dm";
// '@' is never part of a player view, so no player link can take this one.
const REMOTE_DM_VIEW: &str = "@dm";
const REMOTE_DM_PREFIX: &str = "@dm\n";
const REMOTE_DM_COUNT: &str = "@dm-count\n";
// A remote DM sends commands and immer patches, never whole documents.
const REMOTE_DM_MESSAGE_LIMIT: usize = 8 * 1024 * 1024;
// Map pictures and packs a remote DM imports go through one write.
const REMOTE_DM_WRITE_LIMIT: usize = 512 * 1024 * 1024;
// Player messages are a hello, a roll, a ping or a move; anything bigger is
// not a valid message.
const PLAYER_MESSAGE_LIMIT: usize = 1024;
// A player may send this many messages at once, then one per
// `PLAYER_REFILL`; more are dropped (`server/relayServer.ts` does the same).
const PLAYER_BURST: f64 = 10.0;
const PLAYER_REFILL: Duration = Duration::from_millis(500);
// Same limits as `playerMessageSchema` in `src/sync/protocol.ts`.
const PARTY_VIEW: &str = "party";
const MAX_COORDINATE_FT: f64 = 1_000_000.0;
const PLAYER_DICE_MAX: usize = 40;
const PLAYER_LABEL_MAX: usize = 40;
const PLAYER_CHAT_MAX: usize = 500;
const PLAYER_NOTE_MAX: usize = 20_000;
const SHEET_VALUE_MAX: u32 = 1_000_000;
const SHEET_ITEMS_MAX: u32 = 1000;
// Receivers that fall this far behind are dropped and reconnect for a resend.
const CHANNEL_CAPACITY: usize = 64;
// `RELAY_LINK_REVOKED`: the player page stops reconnecting on this code.
const LINK_REVOKED: u16 = 4001;
// Graceful shutdown waits for every open response, and a phone that sleeps
// halfway through a large asset never finishes its own.
const STOP_GRACE: Duration = Duration::from_secs(2);
// Same limits as `PLAYER_UPLOAD_*` in `src/sync/relayApi.ts`.
const PLAYER_UPLOAD_MAX_BYTES: usize = 10 * 1024 * 1024;
const PLAYER_UPLOAD_MAX_PENDING: usize = 20;
const PLAYER_UPLOAD_NAME_MAX: usize = 100;
const PLAYER_UPLOAD_SNIFF_BYTES: usize = 12;

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

#[derive(Debug)]
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
    /// The DM's second device; holds its link token.
    RemoteDm(String),
}

impl Role {
    // Logs must not carry tokens, so not the Debug output.
    fn name(&self) -> &'static str {
        match self {
            Role::Player(_) => "player",
            Role::Dm => "DM",
            Role::RemoteDm(_) => "remote DM",
        }
    }

    fn link_check(&self, links: &Links) -> Next {
        match self {
            Role::Player(viewer) => match links.get(&viewer.token) {
                None => Next::Kick(LINK_REVOKED, "link revoked"),
                Some(view) if *view != viewer.view => Next::Kick(close_code::AGAIN, "view changed, reconnect"),
                Some(_) => Next::Stay,
            },
            Role::RemoteDm(token) if links.get(token).is_none_or(|view| view != REMOTE_DM_VIEW) => {
                Next::Kick(LINK_REVOKED, "link revoked")
            }
            Role::RemoteDm(_) | Role::Dm => Next::Stay,
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
// does not let a LAN device send messages as the DM. The remote DM link is
// for another device, so it counts from anywhere, like player links.
fn role(links: &Links, dm: &str, given: &str, peer: IpAddr) -> Option<Role> {
    match links.iter().find(|(token, _)| token_matches(token, given)) {
        Some((token, view)) if view == REMOTE_DM_VIEW => Some(Role::RemoteDm(token.clone())),
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

fn check_links(links: &Links, uploads: &[String], remote_dm: Option<&str>) -> Result<(), LanError> {
    let valid = links
        .iter()
        .all(|(token, view)| link_text(token, 16, 128) && valid_view(view))
        && uploads.iter().all(|view| valid_view(view))
        && remote_dm.is_none_or(|token| link_text(token, 16, 128) && !links.contains_key(token));
    if valid {
        Ok(())
    } else {
        Err(LanError(
            "player links need tokens of 16-128 and views of 1-64 of A-Z a-z 0-9 _ -".into(),
        ))
    }
}

/// The checked player links plus the remote DM link.
fn all_links(mut links: Links, remote_dm: Option<String>) -> Links {
    if let Some(token) = remote_dm {
        links.insert(token, REMOTE_DM_VIEW.to_owned());
    }
    links
}

fn remote_dm_count(count: usize) -> Utf8Bytes {
    format!("{REMOTE_DM_COUNT}{count}").into()
}

// A slice of the received frame, so a large snapshot is not copied.
fn remote_dm_frame(text: &Utf8Bytes) -> Option<Utf8Bytes> {
    text.starts_with(REMOTE_DM_PREFIX)
        .then(|| Utf8Bytes::try_from(Bytes::from(text.clone()).slice(REMOTE_DM_PREFIX.len()..)).ok())
        .flatten()
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
            Role::Dm | Role::RemoteDm(_) => None,
        }
    }
}

fn status(players: &PlayerCounts) -> Utf8Bytes {
    let total: usize = players.values().sum();
    serde_json::json!({ "relay": { "players": total, "views": players } })
        .to_string()
        .into()
}

/// A picture a player uploaded; `PlayerUpload` in `src/sync/relayApi.ts`.
#[derive(Clone, Debug, PartialEq, Serialize)]
struct PlayerUpload {
    id: String,
    view: String,
    name: String,
    #[serde(rename = "type")]
    kind: &'static str,
    size: usize,
    /// Milliseconds since 1970.
    at: u64,
}

/// Waiting player uploads and what limits new ones.
struct Uploads {
    /// Created by the first upload, removed when the server stops.
    dir: PathBuf,
    /// Views whose players may upload.
    views: HashSet<String>,
    /// Oldest first.
    pending: Vec<PlayerUpload>,
    /// Uploads per view still streaming in; they count against its limit.
    receiving: HashMap<String, usize>,
    /// Upload rate per link token.
    rates: HashMap<String, RateLimit>,
}

fn uploads_frame(pending: &[PlayerUpload]) -> Utf8Bytes {
    serde_json::json!({ "uploads": pending }).to_string().into()
}

// Mirrors `sniffPicture`: the type by the first bytes, never by the name.
fn sniff_picture(bytes: &[u8]) -> Option<&'static str> {
    let webp = bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP";
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        Some("png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("jpg")
    } else if webp {
        Some("webp")
    } else {
        None
    }
}

// Mirrors `isPlayerUploadName`: the name is only shown to the DM, yet no
// separators, drive colons, control characters or leading dots pass.
fn upload_name_valid(name: &str) -> bool {
    let forbidden = |c: char| matches!(c, '/' | '\\' | ':') || c < ' ' || c == '\u{7f}';
    !name.is_empty()
        && !name.starts_with('.')
        && name.encode_utf16().count() <= PLAYER_UPLOAD_NAME_MAX
        && !name.chars().any(forbidden)
}

/// A view's slot for one picture while it streams in. Dropping it frees
/// the slot, and the file too unless the upload was recorded.
struct Reservation<'a> {
    hub: &'a Hub,
    id: String,
    view: String,
    name: String,
    file: PathBuf,
    recorded: bool,
}

impl Drop for Reservation<'_> {
    fn drop(&mut self) {
        if let Some(count) = self.hub.uploads().receiving.get_mut(&self.view) {
            *count -= 1;
        }
        if !self.recorded {
            match std::fs::remove_file(&self.file) {
                Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                    eprintln!("LAN upload {} not removed: {error}", self.file.display())
                }
                _ => (),
            }
        }
    }
}

struct Hub {
    host: Box<dyn LanHost>,
    dm_token: String,
    links: watch::Sender<Links>,
    to_players: broadcast::Sender<ViewFrame>,
    to_dm: broadcast::Sender<Utf8Bytes>,
    to_remote_dms: broadcast::Sender<Utf8Bytes>,
    players: watch::Sender<PlayerCounts>,
    remote_dms: watch::Sender<usize>,
    uploads: std::sync::Mutex<Uploads>,
    shutdown: watch::Receiver<bool>,
}

#[derive(Deserialize)]
struct Auth {
    #[serde(default)]
    token: String,
}

/// Query of the remote DM's storage routes; which fields count depends on the route.
#[derive(Deserialize)]
struct StorageQuery {
    #[serde(default)]
    token: String,
    area: Option<Area>,
    #[serde(default)]
    path: String,
    #[serde(default)]
    from: String,
    #[serde(default)]
    to: String,
}

impl StorageQuery {
    fn area(&self) -> Result<Area, HttpError> {
        self.area
            .ok_or_else(|| HttpError(StatusCode::BAD_REQUEST, "missing area".into()))
    }
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

    // Every change keeps the uploads consistent before it can panic, so a
    // poisoned lock still holds valid state.
    fn uploads(&self) -> std::sync::MutexGuard<'_, Uploads> {
        self.uploads.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
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

    fn count(&self, role: &Role, joined: bool) {
        match role {
            Role::Player(viewer) => self.count_player(&viewer.view, joined),
            Role::RemoteDm(_) => self.remote_dms.send_modify(|count| {
                *count = if joined { *count + 1 } else { *count - 1 };
                let _ = self.to_dm.send(remote_dm_count(*count));
            }),
            Role::Dm => (),
        }
    }

    fn set_links(&self, links: Links, upload_views: Vec<String>) {
        {
            let mut uploads = self.uploads();
            uploads.views = upload_views.into_iter().collect();
            uploads.rates.retain(|token, _| links.contains_key(token));
        }
        self.links.send_replace(links);
        let _ = self.to_dm.send(status(&self.players.borrow()));
    }

    // Subscribed under the counts and uploads locks: every later status,
    // uploads and remote DM count frame is at least as new as the returned
    // ones. No remote DM count while none is connected, so a DM app without
    // the remote DM feature gets the frames it knows.
    fn dm_subscribe(&self) -> (broadcast::Receiver<Utf8Bytes>, Vec<Utf8Bytes>) {
        let players = self.players.borrow();
        let uploads = self.uploads();
        let remote_dms = *self.remote_dms.borrow();
        let mut greeting = vec![status(&players), uploads_frame(&uploads.pending)];
        if remote_dms > 0 {
            greeting.push(remote_dm_count(remote_dms));
        }
        (self.to_dm.subscribe(), greeting)
    }

    /// Ok for a remote DM's storage request; the token comes from the query or the DM page's cookie.
    fn remote_dm(&self, query: &StorageQuery, headers: &HeaderMap, peer: SocketAddr) -> Result<(), HttpError> {
        let token = if query.token.is_empty() {
            cookie_token(headers, DM_COOKIE).unwrap_or_default()
        } else {
            &query.token
        };
        match self.authorize(&self.links.borrow(), token, peer)? {
            Role::RemoteDm(_) => Ok(()),
            Role::Player(_) | Role::Dm => Err(HttpError(
                StatusCode::FORBIDDEN,
                "only the remote DM link reaches the DM's files".into(),
            )),
        }
    }

    fn area_root(&self, area: Area) -> Result<PathBuf, HttpError> {
        self.host.area_root(area).map_err(internal_error)
    }

    /// A slot for a picture of `viewer` named `name`, or why it is refused.
    /// Refused attempts count against the rate too.
    fn reserve_upload(&self, viewer: &Viewer, name: &str, now: Instant) -> Result<Reservation<'_>, HttpError> {
        let id = random_token().map_err(internal_error)?;
        let mut uploads = self.uploads();
        let allowed = uploads
            .rates
            .entry(viewer.token.clone())
            .or_insert_with(|| RateLimit::new(now))
            .take(now);
        let receiving = uploads.receiving.get(&viewer.view).copied().unwrap_or_default();
        let waiting = uploads.pending.iter().filter(|u| u.view == viewer.view).count() + receiving;
        let refusal = if !allowed {
            Some((StatusCode::TOO_MANY_REQUESTS, "too many uploads, wait a moment".to_owned()))
        } else if !upload_name_valid(name) {
            Some((StatusCode::BAD_REQUEST, format!("invalid file name: {name}")))
        } else if viewer.view == PARTY_VIEW {
            Some((StatusCode::FORBIDDEN, "the party view cannot upload".to_owned()))
        } else if !uploads.views.contains(&viewer.view) {
            Some((StatusCode::FORBIDDEN, "the DM does not take pictures from players".to_owned()))
        } else if waiting >= PLAYER_UPLOAD_MAX_PENDING {
            let text = format!("{PLAYER_UPLOAD_MAX_PENDING} pictures already wait for the DM");
            Some((StatusCode::TOO_MANY_REQUESTS, text))
        } else {
            None
        };
        match refusal {
            Some((code, text)) => Err(HttpError(code, text)),
            None => {
                uploads.receiving.insert(viewer.view.clone(), receiving + 1);
                Ok(Reservation {
                    hub: self,
                    file: uploads.dir.join(&id),
                    id,
                    view: viewer.view.clone(),
                    name: name.to_owned(),
                    recorded: false,
                })
            }
        }
    }

    /// Adds the received picture to the waiting ones and tells the DM.
    fn record_upload(&self, mut reservation: Reservation<'_>, kind: &'static str, size: usize) -> String {
        let at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |since| u64::try_from(since.as_millis()).unwrap_or(u64::MAX));
        let upload = PlayerUpload {
            id: reservation.id.clone(),
            view: reservation.view.clone(),
            name: reservation.name.clone(),
            kind,
            size,
            at,
        };
        {
            let mut uploads = self.uploads();
            uploads.pending.push(upload);
            // Sent under the lock, so DMs see the uploads frames in order.
            let _ = self.to_dm.send(uploads_frame(&uploads.pending));
        }
        reservation.recorded = true;
        reservation.id.clone()
    }

    /// File of a waiting upload.
    fn upload_file(&self, id: &str) -> Option<PathBuf> {
        let uploads = self.uploads();
        uploads.pending.iter().any(|u| u.id == id).then(|| uploads.dir.join(id))
    }

    /// Forgets a waiting upload and deletes its file; an unknown id is no
    /// error, so a repeated delete does no harm.
    fn delete_upload(&self, id: &str) -> Result<(), LanError> {
        let file = {
            let mut uploads = self.uploads();
            let before = uploads.pending.len();
            uploads.pending.retain(|u| u.id != id);
            let removed = uploads.pending.len() != before;
            if removed {
                let _ = self.to_dm.send(uploads_frame(&uploads.pending));
            }
            removed.then(|| uploads.dir.join(id))
        };
        match file.map(std::fs::remove_file) {
            Some(Err(error)) if error.kind() != std::io::ErrorKind::NotFound => Err(error.into()),
            _ => Ok(()),
        }
    }

    fn incoming(&self, role: &Role, text: Utf8Bytes, rate: &mut RateLimit) -> Next {
        match role {
            Role::Dm => match remote_dm_frame(&text) {
                Some(message) => {
                    let _ = self.to_remote_dms.send(message);
                    Next::Stay
                }
                None => match view_frame(text) {
                    Some(frame) => {
                        let _ = self.to_players.send(frame);
                        Next::Stay
                    }
                    None => Next::Kick(close_code::POLICY, "frames must start with a view list"),
                },
            },
            // The DM app parses it; the socket's size limit bounds it.
            Role::RemoteDm(_) => {
                let _ = self.to_dm.send(format!("{REMOTE_DM_PREFIX}{}", text.as_str()).into());
                Next::Stay
            }
            Role::Player(viewer) => match rebuild_player_message(&viewer.view, text.as_str()) {
                Some(message) => {
                    if rate.take(Instant::now()) {
                        let _ = self.to_dm.send(message);
                    }
                    Next::Stay
                }
                None => Next::Kick(close_code::POLICY, "not a valid player message"),
            },
        }
    }
}

/// Token bucket of one player socket or of one link's uploads.
struct RateLimit {
    tokens: f64,
    at: Instant,
}

impl RateLimit {
    fn new(now: Instant) -> Self {
        RateLimit {
            tokens: PLAYER_BURST,
            at: now,
        }
    }

    /// True while the player stays within its message rate.
    fn take(&mut self, now: Instant) -> bool {
        let refilled = now.duration_since(self.at).as_secs_f64() / PLAYER_REFILL.as_secs_f64();
        self.tokens = (self.tokens + refilled).min(PLAYER_BURST);
        self.at = now;
        let allowed = self.tokens >= 1.0;
        if allowed {
            self.tokens -= 1.0;
        }
        allowed
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct PlayerMessage {
    protocol: u32,
    from: PlayerSender,
    payload: PlayerPayload,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum PlayerSender {
    Player,
}

// Struct variants, also for hello: serde ignores extra fields of an
// internally tagged unit variant.
#[derive(Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
enum PlayerPayload {
    Hello {
        #[serde(rename = "mapRevision", default, skip_serializing_if = "Option::is_none")]
        map_revision: Option<u64>,
    },
    Roll {
        dice: String,
        mode: RollMode,
        label: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        share: Option<bool>,
    },
    Point {
        at: MapPoint,
    },
    Move {
        #[serde(rename = "combatantId")]
        combatant_id: String,
        to: MapPoint,
    },
    Chat {
        text: String,
        to: ChatTo,
    },
    Note {
        text: String,
    },
    #[serde(rename = "sheetEdit")]
    SheetEdit {
        #[serde(rename = "combatantId")]
        combatant_id: String,
        edit: SheetEdit,
    },
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum ChatTo {
    All,
    Dm,
}

// The sheet fields players may change; the DM app checks the real ranges.
#[derive(Deserialize, Serialize)]
#[serde(tag = "field", rename_all = "camelCase", deny_unknown_fields)]
enum SheetEdit {
    Hp { value: u32 },
    TempHp { value: u32 },
    SlotsUsed { level: u8, value: u32 },
    HitDiceUsed { value: u32 },
    DeathSaves { successes: u8, failures: u8 },
    ItemQuantity { index: u32, value: u32 },
    ItemEquipped { index: u32, value: bool },
    Currency { coin: Coin, value: u32 },
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum Coin {
    Cp,
    Sp,
    Ep,
    Gp,
    Pp,
}

impl SheetEdit {
    fn valid(&self) -> bool {
        match self {
            SheetEdit::Hp { value } | SheetEdit::TempHp { value } | SheetEdit::HitDiceUsed { value } => {
                *value <= SHEET_VALUE_MAX
            }
            SheetEdit::SlotsUsed { level, value } => (1..=9).contains(level) && *value <= SHEET_VALUE_MAX,
            SheetEdit::DeathSaves { successes, failures } => *successes <= 3 && *failures <= 3,
            SheetEdit::ItemQuantity { index, value } => *index < SHEET_ITEMS_MAX && *value <= SHEET_VALUE_MAX,
            SheetEdit::ItemEquipped { index, .. } => *index < SHEET_ITEMS_MAX,
            SheetEdit::Currency { value, .. } => *value <= SHEET_VALUE_MAX,
        }
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum RollMode {
    Normal,
    Advantage,
    Disadvantage,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct MapPoint {
    x: f64,
    y: f64,
    elevation_ft: f64,
}

impl MapPoint {
    fn valid(&self) -> bool {
        [self.x, self.y, self.elevation_ft]
            .iter()
            .all(|v| v.abs() <= MAX_COORDINATE_FT)
    }
}

impl PlayerPayload {
    // Party screens have no sheet, notes or chat and no token of their own.
    fn allowed_for(&self, view: &str) -> bool {
        // UTF-16 units, as JavaScript counts the string length.
        let units = |text: &str| text.encode_utf16().count();
        let character = view != PARTY_VIEW;
        match self {
            PlayerPayload::Hello { .. } => true,
            PlayerPayload::Roll { dice, label, .. } => {
                character
                    && (1..=PLAYER_DICE_MAX).contains(&dice.len())
                    && dice
                        .bytes()
                        .all(|b| b.is_ascii_digit() || matches!(b, b'd' | b'D' | b'+' | b'-' | b' '))
                    && units(label) <= PLAYER_LABEL_MAX
            }
            PlayerPayload::Point { at } => at.valid(),
            PlayerPayload::Move { combatant_id, to } => character && combatant_id == view && to.valid(),
            PlayerPayload::Chat { text, .. } => character && (1..=PLAYER_CHAT_MAX).contains(&units(text)),
            PlayerPayload::Note { text } => character && units(text) <= PLAYER_NOTE_MAX,
            PlayerPayload::SheetEdit { combatant_id, edit } => character && combatant_id == view && edit.valid(),
        }
    }
}

// Rebuilt from the parsed fields instead of forwarded, so the DM never sees
// smuggled data; mirrors `rebuildPlayerMessage` in `src/sync/protocol.ts`.
fn rebuild_player_message(view: &str, text: &str) -> Option<Utf8Bytes> {
    serde_json::from_str::<PlayerMessage>(text)
        .ok()
        .filter(|message| message.payload.allowed_for(view))
        .and_then(|message| serde_json::to_string(&message).ok())
        .map(|json| format!("{view}\n{json}").into())
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
        "mp3" => Some("audio/mpeg"),
        "ogg" => Some("audio/ogg"),
        "wav" => Some("audio/wav"),
        "m4a" => Some("audio/mp4"),
        "mp4" => Some("video/mp4"),
        "webm" => Some("video/webm"),
        _ => None,
    }
}

// Pictures inside document folders: campaign folders hold fog masks
// (what each character explored), maps their terrain heightmap. A campaign's
// handouts and the assets a campaign import moved aside are there to be shown
// to players. The version history holds old copies of all of these.
fn document_data(file: &Path) -> bool {
    let parts: Vec<&OsStr> = file
        .components()
        .filter(|c| !matches!(c, Component::CurDir))
        .map(|c| c.as_os_str())
        .collect();
    let named = |index: usize, name: &str| parts.get(index).is_some_and(|part| part.eq_ignore_ascii_case(name));
    let shown = parts.len() > 3 && (named(2, "handouts") || named(2, "imported-assets"));
    (named(0, "campaigns") && !shown)
        || file.file_name().is_some_and(|name| name.eq_ignore_ascii_case("terrain.png"))
        || history::in_history(file)
}

/// The MIME type of `relative` if it is a picture, model or sound.
fn media_type(relative: &Path) -> Option<&'static str> {
    relative.extension().and_then(|e| e.to_str()).and_then(asset_mime)
}

/// The MIME type of `relative` if it is a picture, model or sound outside the document data.
fn asset_type(relative: &Path) -> Option<&'static str> {
    media_type(relative).filter(|_| !document_data(relative))
}

// Images and models only: documents hold DM secrets (hidden monsters,
// secret doors, notes) and must never reach a player; `documents` lets the
// remote DM have the pictures inside them too. Windows opens other
// spellings of a path too (any case, trailing dots, 8.3 short names) and
// links may lead elsewhere, so the opened file's real path decides.
fn asset_file(root: &Path, path: &str, documents: bool) -> Result<(PathBuf, &'static str), HttpError> {
    let file = storage::resolve(root, path).map_err(|e| HttpError(StatusCode::BAD_REQUEST, e.to_string()))?;
    let refused = || HttpError(StatusCode::FORBIDDEN, format!("not a map asset: {path}"));
    let allowed = if documents { media_type } else { asset_type };
    allowed(Path::new(path)).ok_or_else(refused)?;
    if file.is_file() {
        let real = std::fs::canonicalize(&file).map_err(internal_error)?;
        let real_root = std::fs::canonicalize(root).map_err(internal_error)?;
        let mime = real
            .strip_prefix(&real_root)
            .ok()
            .and_then(allowed)
            .ok_or_else(refused)?;
        Ok((real, mime))
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
// the cookie set with the player or DM page covers those requests.
fn cookie_token<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .find_map(|pair| pair.trim().strip_prefix(name)?.strip_prefix('='))
}

fn page_with_cookie(hub: &Hub, page: &str, cookie: &str) -> Result<Response, HttpError> {
    let mut response = frontend_response(hub, page)?;
    response.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_str(cookie).map_err(internal_error)?,
    );
    Ok(response)
}

async fn player_page(
    Shared(hub): Shared<Arc<Hub>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Query(auth): Query<Auth>,
) -> Result<Response, HttpError> {
    if let Role::RemoteDm(_) = hub.authorize(&hub.links.borrow(), &auth.token, peer)? {
        return Err(HttpError(StatusCode::FORBIDDEN, "the DM link opens /dm.html".into()));
    }
    let cookie = format!("{TOKEN_COOKIE}={}; Path=/asset; HttpOnly; SameSite=Strict", auth.token);
    page_with_cookie(&hub, PLAYER_PAGE, &cookie)
}

// The same page as the desktop's DM window; the app sees the token in the URL
// and runs as the remote DM.
async fn dm_page(
    Shared(hub): Shared<Arc<Hub>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Query(auth): Query<Auth>,
) -> Result<Response, HttpError> {
    match hub.authorize(&hub.links.borrow(), &auth.token, peer)? {
        Role::RemoteDm(_) => Ok(()),
        Role::Player(_) | Role::Dm => Err(HttpError(StatusCode::FORBIDDEN, "not a DM link".into())),
    }?;
    let cookie = format!("{DM_COOKIE}={}; Path=/; HttpOnly; SameSite=Strict", auth.token);
    page_with_cookie(&hub, DM_PAGE, &cookie)
}

// Vite's hashed chunks are app code without user data, and the browser
// requests them without the token.
async fn bundle_file(Shared(hub): Shared<Arc<Hub>>, UrlPath(file): UrlPath<String>) -> Result<Response, HttpError> {
    storage::resolve(Path::new(BUNDLE_DIR), &file).map_err(|e| HttpError(StatusCode::BAD_REQUEST, e.to_string()))?;
    frontend_response(&hub, &format!("{BUNDLE_DIR}/{file}"))
}

#[derive(Debug, PartialEq, Eq)]
enum ByteRange {
    Whole,
    /// First and last byte.
    Part(u64, u64),
    Unsatisfiable,
}

// Safari plays audio and video only with byte ranges. One `bytes=` range is
// served, several get the whole file; mirrors `byteRange` in
// `server/relayServer.ts`.
fn byte_range(header: Option<&str>, size: u64) -> ByteRange {
    let digits = |text: &str| text.bytes().all(|b| b.is_ascii_digit());
    // Only overflow fails here: such numbers lie beyond any file.
    let number = |text: &str| text.parse::<u64>().unwrap_or(u64::MAX);
    let spec = header
        .and_then(|value| value.strip_prefix("bytes="))
        .and_then(|value| value.split_once('-'))
        .filter(|(from, to)| digits(from) && digits(to) && !(from.is_empty() && to.is_empty()));
    match (spec, size.checked_sub(1)) {
        (None, _) => ByteRange::Whole,
        (Some(_), None) => ByteRange::Unsatisfiable,
        (Some((from, to)), Some(last)) => {
            let suffix = from.is_empty();
            let start = if suffix { size.saturating_sub(number(to)) } else { number(from) };
            let end = if suffix || to.is_empty() { last } else { number(to).min(last) };
            if start <= end {
                ByteRange::Part(start, end)
            } else {
                ByteRange::Unsatisfiable
            }
        }
    }
}

async fn storage_asset(
    Shared(hub): Shared<Arc<Hub>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Query(auth): Query<Auth>,
    headers: HeaderMap,
    UrlPath((area, path)): UrlPath<(Area, String)>,
) -> Result<Response, HttpError> {
    let token = if auth.token.is_empty() {
        cookie_token(&headers, DM_COOKIE)
            .or_else(|| cookie_token(&headers, TOKEN_COOKIE))
            .unwrap_or_default()
    } else {
        &auth.token
    };
    let role = hub.authorize(&hub.links.borrow(), token, peer)?;
    let root = hub.area_root(area)?;
    let (file, mime) = asset_file(&root, &path, matches!(role, Role::RemoteDm(_)))?;
    let mut opened = tokio::fs::File::open(&file).await.map_err(internal_error)?;
    let size = opened.metadata().await.map_err(internal_error)?.len();
    let range = headers.get(header::RANGE).and_then(|value| value.to_str().ok());
    let (status, body, length, content_range) = match byte_range(range, size) {
        ByteRange::Whole => (StatusCode::OK, Body::from_stream(ReaderStream::new(opened)), size, None),
        ByteRange::Part(start, end) => {
            opened.seek(SeekFrom::Start(start)).await.map_err(internal_error)?;
            let length = end - start + 1;
            let stream = ReaderStream::new(opened.take(length));
            let content_range = format!("bytes {start}-{end}/{size}");
            (StatusCode::PARTIAL_CONTENT, Body::from_stream(stream), length, Some(content_range))
        }
        ByteRange::Unsatisfiable => (
            StatusCode::RANGE_NOT_SATISFIABLE,
            Body::empty(),
            0,
            Some(format!("bytes */{size}")),
        ),
    };
    // CORS: a player page from the Vite dev server (`?ws=`) loads assets
    // cross-origin, and three.js loaders request them in CORS mode.
    let fixed = [
        (header::CONTENT_TYPE, mime),
        (header::CACHE_CONTROL, "no-cache"),
        (header::ACCESS_CONTROL_ALLOW_ORIGIN, "*"),
        (header::ACCEPT_RANGES, "bytes"),
    ];
    let mut response = (status, fixed, body).into_response();
    response.headers_mut().insert(header::CONTENT_LENGTH, HeaderValue::from(length));
    if let Some(content_range) = content_range {
        let value = HeaderValue::from_str(&content_range).map_err(internal_error)?;
        response.headers_mut().insert(header::CONTENT_RANGE, value);
    }
    Ok(response)
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
                .on_upgrade(move |socket| session(hub, role, socket, outgoing, links, Vec::new()))
        }
        Role::Dm => {
            let (outgoing, greeting) = hub.dm_subscribe();
            upgrade.on_upgrade(move |socket| session(hub, role, socket, outgoing, links, greeting))
        }
        Role::RemoteDm(_) => {
            let outgoing = hub.to_remote_dms.subscribe();
            upgrade
                .max_message_size(REMOTE_DM_MESSAGE_LIMIT)
                .on_upgrade(move |socket| session(hub, role, socket, outgoing, links, Vec::new()))
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
    greeting: Vec<Utf8Bytes>,
) {
    hub.count(&role, true);
    let result = relay(&hub, &role, socket, outgoing, links, greeting).await;
    hub.count(&role, false);
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
    greeting: Vec<Utf8Bytes>,
) -> Result<(), axum::Error> {
    for text in greeting {
        socket.send(Message::Text(text)).await?;
    }
    let mut shutdown = hub.shutdown.clone();
    let mut rate = RateLimit::new(Instant::now());
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
                Some(Ok(Message::Text(text))) => hub.incoming(role, text, &mut rate),
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

// Streamed to `file` with only the first bytes looked at: a picture over
// the limit or of another type is refused as soon as that shows. The DM
// app checks the picture itself before anyone sees it.
async fn receive_picture(headers: &HeaderMap, body: Body, file: &Path) -> Result<(&'static str, usize), HttpError> {
    let too_large = || {
        let text = format!("pictures may have at most {PLAYER_UPLOAD_MAX_BYTES} bytes");
        HttpError(StatusCode::PAYLOAD_TOO_LARGE, text)
    };
    let not_picture = || HttpError(StatusCode::UNSUPPORTED_MEDIA_TYPE, "only PNG, JPEG and WebP pictures".into());
    let declared = headers
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or_default();
    if declared > PLAYER_UPLOAD_MAX_BYTES {
        return Err(too_large());
    }
    if let Some(dir) = file.parent() {
        tokio::fs::create_dir_all(dir).await.map_err(internal_error)?;
    }
    let mut out = tokio::fs::File::create(file).await.map_err(internal_error)?;
    let mut stream = body.into_data_stream();
    let mut size = 0;
    let mut head = Vec::with_capacity(PLAYER_UPLOAD_SNIFF_BYTES);
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| HttpError(StatusCode::BAD_REQUEST, e.to_string()))?;
        let sniffing = head.len() < PLAYER_UPLOAD_SNIFF_BYTES;
        let take = (PLAYER_UPLOAD_SNIFF_BYTES - head.len().min(PLAYER_UPLOAD_SNIFF_BYTES)).min(chunk.len());
        head.extend_from_slice(&chunk[..take]);
        size += chunk.len();
        if sniffing && head.len() >= PLAYER_UPLOAD_SNIFF_BYTES && sniff_picture(&head).is_none() {
            return Err(not_picture());
        }
        if size > PLAYER_UPLOAD_MAX_BYTES {
            return Err(too_large());
        }
        out.write_all(&chunk).await.map_err(internal_error)?;
    }
    out.flush().await.map_err(internal_error)?;
    let kind = sniff_picture(&head).ok_or_else(not_picture)?;
    Ok((kind, size))
}

async fn player_upload(
    Shared(hub): Shared<Arc<Hub>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Query(auth): Query<Auth>,
    UrlPath(name): UrlPath<String>,
    headers: HeaderMap,
    body: Body,
) -> Result<Response, HttpError> {
    let role = hub.authorize(&hub.links.borrow(), &auth.token, peer)?;
    let viewer = match role {
        Role::Player(viewer) => Ok(viewer),
        Role::Dm | Role::RemoteDm(_) => Err(HttpError(StatusCode::FORBIDDEN, "only players upload pictures".into())),
    }?;
    let reservation = hub.reserve_upload(&viewer, &name, Instant::now())?;
    let (kind, size) = receive_picture(&headers, body, &reservation.file).await?;
    let id = hub.record_upload(reservation, kind, size);
    let answer = serde_json::json!({ "id": id }).to_string();
    Ok((StatusCode::CREATED, [(header::CONTENT_TYPE, "application/json")], answer).into_response())
}

// File work blocks; a refused path or a missing file is the caller's error.
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, StorageError> + Send + 'static,
) -> Result<T, HttpError> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(internal_error)?
        .map_err(|e| HttpError(StatusCode::BAD_REQUEST, e.to_string()))
}

fn json_response(value: &impl Serialize) -> Result<Response, HttpError> {
    let text = serde_json::to_string(value).map_err(internal_error)?;
    Ok(([(header::CONTENT_TYPE, "application/json"), (header::CACHE_CONTROL, "no-store")], text).into_response())
}

async fn dm_roots(
    Shared(hub): Shared<Arc<Hub>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Query(query): Query<StorageQuery>,
    headers: HeaderMap,
) -> Result<Response, HttpError> {
    hub.remote_dm(&query, &headers, peer)?;
    let (data, content) = (hub.area_root(Area::Data)?, hub.area_root(Area::Content)?);
    json_response(&serde_json::json!({
        "dataRoot": data.to_string_lossy(),
        "contentRoot": content.to_string_lossy(),
    }))
}

async fn dm_read(
    Shared(hub): Shared<Arc<Hub>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Query(query): Query<StorageQuery>,
    headers: HeaderMap,
) -> Result<Response, HttpError> {
    hub.remote_dm(&query, &headers, peer)?;
    let root = hub.area_root(query.area()?)?;
    let bytes = blocking(move || storage::read_bytes(&root, &query.path)).await?;
    let fixed = [(header::CONTENT_TYPE, "application/octet-stream"), (header::CACHE_CONTROL, "no-store")];
    Ok((fixed, bytes).into_response())
}

// Through `write_data` like the desktop's writes: the version history keeps
// what a write replaces and refuses writes into itself.
async fn dm_write(
    Shared(hub): Shared<Arc<Hub>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Query(query): Query<StorageQuery>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, HttpError> {
    hub.remote_dm(&query, &headers, peer)?;
    let root = hub.area_root(Area::Data)?;
    blocking(move || storage::write_data(&root, &query.path, &body)).await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

async fn dm_list(
    Shared(hub): Shared<Arc<Hub>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Query(query): Query<StorageQuery>,
    headers: HeaderMap,
) -> Result<Response, HttpError> {
    hub.remote_dm(&query, &headers, peer)?;
    let root = hub.area_root(query.area()?)?;
    json_response(&blocking(move || storage::list_area(&root, &query.path)).await?)
}

async fn dm_exists(
    Shared(hub): Shared<Arc<Hub>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Query(query): Query<StorageQuery>,
    headers: HeaderMap,
) -> Result<Response, HttpError> {
    hub.remote_dm(&query, &headers, peer)?;
    let root = hub.area_root(query.area()?)?;
    json_response(&blocking(move || storage::exists(&root, &query.path)).await?)
}

async fn dm_remove(
    Shared(hub): Shared<Arc<Hub>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Query(query): Query<StorageQuery>,
    headers: HeaderMap,
) -> Result<Response, HttpError> {
    hub.remote_dm(&query, &headers, peer)?;
    let root = hub.area_root(Area::Data)?;
    blocking(move || storage::remove_data(&root, &query.path)).await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

async fn dm_copy(
    Shared(hub): Shared<Arc<Hub>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Query(query): Query<StorageQuery>,
    headers: HeaderMap,
) -> Result<Response, HttpError> {
    hub.remote_dm(&query, &headers, peer)?;
    let (source, data) = (hub.area_root(query.area()?)?, hub.area_root(Area::Data)?);
    blocking(move || storage::copy_into_data(&source, &data, &query.from, &query.to)).await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

fn router(hub: Arc<Hub>) -> Router {
    Router::new()
        .route("/", get(player_page))
        .route("/player.html", get(player_page))
        .route("/dm.html", get(dm_page))
        .route("/assets/{*file}", get(bundle_file))
        .route("/asset/{area}/{*path}", get(storage_asset))
        .route("/ws", get(socket))
        // A wildcard, so a name with a slash reaches the name check.
        .route("/api/player-upload/{*name}", put(player_upload))
        .route("/dm/storage/roots", get(dm_roots))
        .route("/dm/storage/read", get(dm_read))
        .route(
            "/dm/storage/write",
            put(dm_write).layer(DefaultBodyLimit::max(REMOTE_DM_WRITE_LIMIT)),
        )
        .route("/dm/storage/list", get(dm_list))
        .route("/dm/storage/exists", get(dm_exists))
        .route("/dm/storage/remove", post(dm_remove))
        .route("/dm/storage/copy", post(dm_copy))
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
    fn spawn(
        host: Box<dyn LanHost>,
        listener: TcpListener,
        links: Links,
        upload_views: Vec<String>,
    ) -> Result<Self, LanError> {
        let port = listener.local_addr()?.port();
        let (stop, shutdown) = watch::channel(false);
        let dir = std::env::temp_dir().join(format!("fogwarden-lan-uploads-{}", random_token()?));
        let hub = Arc::new(Hub {
            host,
            dm_token: random_token()?,
            links: watch::Sender::new(links),
            to_players: broadcast::channel(CHANNEL_CAPACITY).0,
            to_dm: broadcast::channel(CHANNEL_CAPACITY).0,
            to_remote_dms: broadcast::channel(CHANNEL_CAPACITY).0,
            players: watch::Sender::new(PlayerCounts::new()),
            remote_dms: watch::Sender::new(0),
            uploads: std::sync::Mutex::new(Uploads {
                dir,
                views: upload_views.into_iter().collect(),
                pending: Vec::new(),
                receiving: HashMap::new(),
                rates: HashMap::new(),
            }),
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

    // Waiting uploads end with the server: the DM app has stored what it
    // accepted, and players upload again to a new one.
    async fn stop(mut self) -> Result<(), LanError> {
        self.stop.send_replace(true);
        let finished = match tokio::time::timeout(STOP_GRACE, &mut self.task).await {
            Ok(finished) => finished,
            Err(_) => {
                self.task.abort();
                self.task.await
            }
        };
        let dir = self.hub.uploads().dir.clone();
        match tokio::fs::remove_dir_all(&dir).await {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => return Err(error.into()),
            _ => (),
        }
        match finished {
            // Aborting drops the listener, which frees the port.
            Err(error) if error.is_cancelled() => Ok(()),
            finished => Ok(finished??),
        }
    }
}

#[derive(Default)]
pub struct LanState(Mutex<Option<Server>>);

/// Starts the server on all interfaces with a fresh DM token, the given
/// player links, the views whose players may upload pictures and the remote
/// DM link, if any.
#[tauri::command]
pub async fn lan_start(
    app: AppHandle,
    state: State<'_, LanState>,
    port: u16,
    links: Links,
    uploads: Vec<String>,
    remote_dm: Option<String>,
) -> Result<LanInfo, LanError> {
    check_links(&links, &uploads, remote_dm.as_deref())?;
    let links = all_links(links, remote_dm);
    let mut server = state.0.lock().await;
    if server.is_some() {
        Err(LanError("the LAN server is already running".into()))
    } else {
        let listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::UNSPECIFIED, port)))
            .await
            .map_err(|e| LanError(format!("cannot listen on port {port}: {e}")))?;
        let started = Server::spawn(Box::new(AppHost(app)), listener, links, uploads)?;
        let info = started.info();
        *server = Some(started);
        Ok(info)
    }
}

/// Replaces all player links, the views that may upload and the remote DM
/// link; players and remote DMs of withdrawn or moved links are disconnected.
#[tauri::command]
pub async fn lan_set_links(
    state: State<'_, LanState>,
    links: Links,
    uploads: Vec<String>,
    remote_dm: Option<String>,
) -> Result<(), LanError> {
    check_links(&links, &uploads, remote_dm.as_deref())?;
    let links = all_links(links, remote_dm);
    match state.0.lock().await.as_ref() {
        Some(server) => {
            server.hub.set_links(links, uploads);
            Ok(())
        }
        None => Err(LanError("the LAN server is not running".into())),
    }
}

fn running(server: &Option<Server>) -> Result<&Hub, LanError> {
    server
        .as_ref()
        .map(|running| running.hub.as_ref())
        .ok_or_else(|| LanError("the LAN server is not running".into()))
}

/// The bytes of a waiting player upload, for the DM to review.
#[tauri::command]
pub async fn lan_player_upload(state: State<'_, LanState>, id: String) -> Result<tauri::ipc::Response, LanError> {
    let file = running(&*state.0.lock().await)?
        .upload_file(&id)
        .ok_or_else(|| LanError(format!("no waiting upload {id}")))?;
    Ok(tauri::ipc::Response::new(tokio::fs::read(file).await?))
}

/// Deletes a waiting player upload, once the DM stored or rejected it.
#[tauri::command]
pub async fn lan_delete_player_upload(state: State<'_, LanState>, id: String) -> Result<(), LanError> {
    running(&*state.0.lock().await)?.delete_upload(&id)
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
    fn remote_dm_link_counts_from_any_peer_and_never_as_a_player() {
        let (player, remote, dm) = ("p".repeat(32), "r".repeat(32), "d".repeat(32));
        let links = all_links(links(&[(&player, "party")]), Some(remote.clone()));
        let lan: IpAddr = "192.168.1.20".parse().unwrap();
        assert_eq!(role(&links, &dm, &remote, lan), Some(Role::RemoteDm(remote.clone())));
        assert_eq!(role(&links, &dm, &dm, lan), None);
        assert!(matches!(role(&links, &dm, &player, lan), Some(Role::Player(_))));
        let remote_dm = Role::RemoteDm(remote.clone());
        assert!(matches!(remote_dm.link_check(&links), Next::Stay));
        let rotated = all_links(self::links(&[(&player, "party")]), Some("s".repeat(32)));
        assert!(matches!(remote_dm.link_check(&rotated), Next::Kick(LINK_REVOKED, _)));
        assert!(check_links(&self::links(&[(&player, "party")]), &[], Some(&remote)).is_ok());
        assert!(check_links(&self::links(&[(&player, "party")]), &[], Some(&player)).is_err());
        assert!(check_links(&Links::new(), &[], Some("short")).is_err());
        assert!(check_links(&self::links(&[(&player, REMOTE_DM_VIEW)]), &[], None).is_err());
        let frame = view_frame(Utf8Bytes::from("A\nmsg")).unwrap();
        assert!(frame.text_for(&remote_dm).is_none());
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
        let ok = |links: &Links| check_links(links, &[], None).is_ok();
        assert!(ok(&links(&[(&token, "party"), (&"B_-9".repeat(32), &"v".repeat(64))])));
        assert!(ok(&Links::new()));
        assert!(!ok(&links(&[(&"a".repeat(15), "party")])));
        assert!(!ok(&links(&[(&"a".repeat(129), "party")])));
        assert!(!ok(&links(&[(&format!("{token}!"), "party")])));
        assert!(!ok(&links(&[(&token, "")])));
        assert!(!ok(&links(&[(&token, &"v".repeat(65))])));
        assert!(!ok(&links(&[(&token, "a,b")])));
        assert!(check_links(&Links::new(), &["A".into(), "b_-9".into()], None).is_ok());
        assert!(check_links(&Links::new(), &["a/b".into()], None).is_err());
        assert!(check_links(&Links::new(), &[String::new()], None).is_err());
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
        asset_file(root, path, false).map_or_else(|e| e.0, |_| StatusCode::OK)
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
        let fog = "campaigns/c1/encounters/e1/fog/explored/pc.png";
        assert_eq!(asset_status(&root, fog), StatusCode::FORBIDDEN);
        std::fs::create_dir_all(root.join("campaigns/c1/handouts")).unwrap();
        std::fs::write(root.join("campaigns/c1/handouts/letter.png"), b"PNGDATA").unwrap();
        assert_eq!(asset_status(&root, "campaigns/c1/handouts/letter.png"), StatusCode::OK);
        assert_eq!(
            asset_status(&root, "campaigns/handouts/x/letter.png"),
            StatusCode::FORBIDDEN
        );
        assert_eq!(asset_status(&root, "library/maps/m1/terrain.png"), StatusCode::FORBIDDEN);
        let kept = "history/2026-10-12/library/maps/m1/assets/map.png";
        std::fs::create_dir_all(root.join("history/2026-10-12/library/maps/m1/assets")).unwrap();
        std::fs::write(root.join(kept), b"PNGDATA").unwrap();
        assert_eq!(asset_status(&root, kept), StatusCode::FORBIDDEN);
        assert_eq!(asset_status(&root, &kept.replace("history", "History")), StatusCode::FORBIDDEN);
        assert_eq!(asset_status(&root, "folder.png"), StatusCode::NOT_FOUND);
        assert_eq!(asset_status(&root, "missing.glb"), StatusCode::NOT_FOUND);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn other_spellings_of_document_data_are_refused() {
        let root = test_root("spellings");
        let hidden = "campaigns/c1/encounters/e1/fog/hidden.png";
        std::fs::create_dir_all(root.join("campaigns/c1/encounters/e1/fog")).unwrap();
        std::fs::write(root.join(hidden), b"SECRET").unwrap();
        std::fs::write(root.join("library/maps/m1/terrain.png"), b"SECRET").unwrap();
        assert_eq!(asset_status(&root, &format!("./{hidden}")), StatusCode::FORBIDDEN);
        assert_eq!(asset_status(&root, &format!("library/./../{hidden}")), StatusCode::BAD_REQUEST);
        if cfg!(windows) {
            let spellings = [
                hidden.replace("campaigns", "Campaigns"),
                hidden.replace("campaigns", "campaigns."),
                hidden.replace("campaigns", "campaigns "),
                hidden.replace("campaigns", "./CAMPAIGNS."),
                "library/maps/m1/TERRAIN.png".to_owned(),
                "library/maps/m1/terrain.PNG".to_owned(),
            ];
            // Not found is fine too: what matters is that nothing is served.
            for spelling in spellings {
                assert_ne!(asset_status(&root, &spelling), StatusCode::OK, "{spelling}");
            }
            // Only where the volume creates 8.3 short names.
            if root.join("CAMPAI~1").is_dir() {
                let short = hidden.replace("campaigns", "CAMPAI~1");
                assert_eq!(asset_status(&root, &short), StatusCode::FORBIDDEN);
            }
        }
        let imported = "campaigns/c1/imported-assets/library/creatures/assets/goblin.png";
        std::fs::create_dir_all(root.join("campaigns/c1/imported-assets/library/creatures/assets")).unwrap();
        std::fs::write(root.join(imported), b"PNGDATA").unwrap();
        assert_eq!(asset_status(&root, imported), StatusCode::OK);
        assert_eq!(asset_status(&root, "campaigns/imported-assets/x.png"), StatusCode::FORBIDDEN);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn byte_ranges_follow_the_relay() {
        assert_eq!(byte_range(None, 100), ByteRange::Whole);
        assert_eq!(byte_range(Some("bytes=0-9"), 100), ByteRange::Part(0, 9));
        assert_eq!(byte_range(Some("bytes=90-"), 100), ByteRange::Part(90, 99));
        assert_eq!(byte_range(Some("bytes=-10"), 100), ByteRange::Part(90, 99));
        assert_eq!(byte_range(Some("bytes=-500"), 100), ByteRange::Part(0, 99));
        assert_eq!(byte_range(Some("bytes=50-5000"), 100), ByteRange::Part(50, 99));
        assert_eq!(byte_range(Some("bytes=100-"), 100), ByteRange::Unsatisfiable);
        assert_eq!(byte_range(Some("bytes=9-5"), 100), ByteRange::Unsatisfiable);
        assert_eq!(byte_range(Some("bytes=0-0"), 0), ByteRange::Unsatisfiable);
        assert_eq!(byte_range(Some("bytes=0-1,5-6"), 100), ByteRange::Whole);
        assert_eq!(byte_range(Some("bytes=-"), 100), ByteRange::Whole);
        assert_eq!(byte_range(Some("items=0-1"), 100), ByteRange::Whole);
    }

    #[test]
    fn pack_pictures_and_models_are_served_but_never_their_documents() {
        let root = test_root("packs");
        let pack = root.join("packs/mm");
        std::fs::create_dir_all(pack.join("creatures")).unwrap();
        std::fs::create_dir_all(pack.join("maps/m1/assets")).unwrap();
        for file in [
            "pack.json",
            "creatures/goblin.txt",
            "creatures/goblin.png",
            "maps/m1/map.json",
            "maps/m1/terrain.png",
            "maps/m1/assets/tree.glb",
        ] {
            std::fs::write(pack.join(file), b"DATA").unwrap();
        }
        let status = |file: &str| asset_status(&root, &format!("packs/mm/{file}"));
        assert_eq!(status("creatures/goblin.png"), StatusCode::OK);
        assert_eq!(status("maps/m1/assets/tree.glb"), StatusCode::OK);
        assert_eq!(status("pack.json"), StatusCode::FORBIDDEN);
        assert_eq!(status("creatures/goblin.txt"), StatusCode::FORBIDDEN);
        assert_eq!(status("maps/m1/map.json"), StatusCode::FORBIDDEN);
        assert_eq!(status("maps/m1/terrain.png"), StatusCode::FORBIDDEN);
        assert_eq!(status("../../library/maps/m1/assets/map.png"), StatusCode::BAD_REQUEST);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn players_send_only_valid_messages_for_their_view() {
        let rebuilt = |view: &str, payload: &str| {
            rebuild_player_message(
                view,
                &format!(r#"{{"protocol":1,"from":"player","payload":{payload}}}"#),
            )
            .map(|text| text.to_string())
        };
        assert_eq!(
            rebuild_player_message("A", HELLO).unwrap().as_str(),
            format!("A\n{HELLO}")
        );
        let roll = r#"{"type":"roll","dice":"1d20 + 5","mode":"advantage","label":"Hit"}"#;
        let expected_roll = concat!(
            r#"{"protocol":1,"from":"player","payload":"#,
            r#"{"type":"roll","dice":"1d20 + 5","mode":"advantage","label":"Hit"}}"#
        );
        assert_eq!(rebuilt("A", roll), Some(format!("A\n{expected_roll}")));
        let point = r#"{"type":"point","at":{"x":1.5,"y":2.0,"elevationFt":0.0}}"#;
        assert!(rebuilt("party", point).is_some());
        let to = r#""to":{"x":5.0,"y":5.0,"elevationFt":0.0}"#;
        assert!(rebuilt("A", &format!(r#"{{"type":"move","combatantId":"A",{to}}}"#)).is_some());

        // Another view's token, or nothing of the party's own.
        assert!(rebuilt("A", &format!(r#"{{"type":"move","combatantId":"B",{to}}}"#)).is_none());
        assert!(rebuilt("party", &format!(r#"{{"type":"move","combatantId":"party",{to}}}"#)).is_none());
        assert!(rebuilt("party", roll).is_none());
        // Malformed requests.
        assert!(rebuilt("A", r#"{"type":"roll","dice":"1d20;rm","mode":"normal","label":""}"#).is_none());
        assert!(rebuilt("A", r#"{"type":"roll","dice":"1d20","mode":"lucky","label":""}"#).is_none());
        let long_label = format!(
            r#"{{"type":"roll","dice":"1d20","mode":"normal","label":"{}"}}"#,
            "x".repeat(41)
        );
        assert!(rebuilt("A", &long_label).is_none());
        assert!(rebuilt("A", r#"{"type":"point","at":{"x":"1","y":2,"elevationFt":0}}"#).is_none());
        assert!(rebuilt("A", r#"{"type":"point","at":{"x":1e9,"y":2,"elevationFt":0}}"#).is_none());
        assert!(rebuilt("A", r#"{"type":"point","at":{"x":1,"y":2,"elevationFt":0},"by":"DM"}"#).is_none());
        assert!(rebuilt("A", r#"{"type":"hello","x":1}"#).is_none());
        let revision = r#"{"type":"hello","mapRevision":1760000000123}"#;
        let with_revision = HELLO.replace(r#"{"type":"hello"}"#, revision);
        assert_eq!(rebuilt("party", revision), Some(format!("party\n{with_revision}")));
        assert!(rebuilt("A", r#"{"type":"hello","mapRevision":-1}"#).is_none());
        assert!(rebuilt("A", r#"{"type":"hello","mapRevision":"1"}"#).is_none());
        assert!(rebuilt("A", r#"{"type":"map","map":null}"#).is_none());
        let dm = r#"{"protocol":1,"from":"dm","payload":{"type":"hello"}}"#;
        assert!(rebuild_player_message("A", dm).is_none());
        let extra = r#"{"protocol":1,"from":"player","payload":{"type":"hello"},"x":1}"#;
        assert!(rebuild_player_message("A", extra).is_none());
        assert!(rebuild_player_message("A", "not json").is_none());
    }

    #[test]
    fn players_chat_note_share_and_edit_only_their_own_sheet() {
        let rebuilt = |view: &str, payload: &str| {
            rebuild_player_message(
                view,
                &format!(r#"{{"protocol":3,"from":"player","payload":{payload}}}"#),
            )
            .map(|text| text.to_string())
        };
        let same = |view: &str, payload: &str| {
            let expected = format!(r#"{view}
{{"protocol":3,"from":"player","payload":{payload}}}"#);
            assert_eq!(rebuilt(view, payload), Some(expected), "{payload}");
        };
        let chat = r#"{"type":"chat","text":"Hello","to":"all"}"#;
        same("A", chat);
        same("A", r#"{"type":"chat","text":"Psst","to":"dm"}"#);
        same("A", r#"{"type":"roll","dice":"1d20","mode":"normal","label":"","share":true}"#);
        same("A", r#"{"type":"note","text":"Owes Bob 5 gp"}"#);
        same("A", r#"{"type":"note","text":""}"#);
        let edits = [
            r#"{"field":"hp","value":7}"#,
            r#"{"field":"tempHp","value":5}"#,
            r#"{"field":"slotsUsed","level":1,"value":2}"#,
            r#"{"field":"hitDiceUsed","value":1}"#,
            r#"{"field":"deathSaves","successes":1,"failures":2}"#,
            r#"{"field":"itemQuantity","index":3,"value":10}"#,
            r#"{"field":"itemEquipped","index":0,"value":true}"#,
            r#"{"field":"currency","coin":"gp","value":120}"#,
        ];
        for edit in edits {
            same("A", &format!(r#"{{"type":"sheetEdit","combatantId":"A","edit":{edit}}}"#));
            // Another character's sheet.
            assert!(rebuilt("A", &format!(r#"{{"type":"sheetEdit","combatantId":"B","edit":{edit}}}"#)).is_none());
            assert!(rebuilt("party", &format!(r#"{{"type":"sheetEdit","combatantId":"party","edit":{edit}}}"#))
                .is_none());
        }

        // The party screen neither chats, keeps notes nor shares rolls.
        assert!(rebuilt("party", chat).is_none());
        assert!(rebuilt("party", r#"{"type":"note","text":"x"}"#).is_none());
        assert!(rebuilt("party", r#"{"type":"roll","dice":"1d20","mode":"normal","label":"","share":true}"#).is_none());
        // Bounds and fields outside the allowlist.
        assert!(rebuilt("A", r#"{"type":"chat","text":"","to":"all"}"#).is_none());
        assert!(rebuilt("A", &format!(r#"{{"type":"chat","text":"{}","to":"all"}}"#, "x".repeat(501))).is_none());
        assert!(rebuilt("A", &format!(r#"{{"type":"chat","text":"{}","to":"all"}}"#, "ü".repeat(500))).is_some());
        assert!(rebuilt("A", r#"{"type":"chat","text":"Hi","to":"B"}"#).is_none());
        assert!(rebuilt("A", r#"{"type":"chat","text":"Hi","to":"all","from":"DM"}"#).is_none());
        assert!(rebuilt("A", &format!(r#"{{"type":"note","text":"{}"}}"#, "x".repeat(20_001))).is_none());
        assert!(rebuilt("A", r#"{"type":"roll","dice":"1d20","mode":"normal","label":"","share":1}"#).is_none());
        let edit = |edit: &str| rebuilt("A", &format!(r#"{{"type":"sheetEdit","combatantId":"A","edit":{edit}}}"#));
        assert!(edit(r#"{"field":"hp","value":-1}"#).is_none());
        assert!(edit(r#"{"field":"hp","value":1.5}"#).is_none());
        assert!(edit(r#"{"field":"hp","value":1000001}"#).is_none());
        assert!(edit(r#"{"field":"hp","value":7,"max":99}"#).is_none());
        assert!(edit(r#"{"field":"armorClass","value":30}"#).is_none());
        assert!(edit(r#"{"field":"slotsUsed","level":0,"value":1}"#).is_none());
        assert!(edit(r#"{"field":"slotsUsed","level":10,"value":1}"#).is_none());
        assert!(edit(r#"{"field":"deathSaves","successes":4,"failures":0}"#).is_none());
        assert!(edit(r#"{"field":"itemQuantity","index":1000,"value":1}"#).is_none());
        assert!(edit(r#"{"field":"itemEquipped","index":0,"value":"yes"}"#).is_none());
        assert!(edit(r#"{"field":"currency","coin":"xp","value":1}"#).is_none());
    }

    #[test]
    fn rate_limit_allows_a_burst_then_refills() {
        let start = Instant::now();
        let mut rate = RateLimit::new(start);
        let burst = (0..12).filter(|_| rate.take(start)).count();
        assert_eq!(burst, 10);
        assert!(!rate.take(start + PLAYER_REFILL / 2));
        assert!(rate.take(start + PLAYER_REFILL));
        assert!(!rate.take(start + PLAYER_REFILL));
    }

    struct TestHost(PathBuf);

    impl LanHost for TestHost {
        fn area_root(&self, _area: Area) -> Result<PathBuf, LanError> {
            Ok(self.0.clone())
        }

        fn frontend_file(&self, path: &str) -> Option<(Vec<u8>, String)> {
            match path {
                PLAYER_PAGE => Some((b"<html>player</html>".to_vec(), "text/html".to_owned())),
                DM_PAGE => Some((b"<html>dm</html>".to_vec(), "text/html".to_owned())),
                _ => None,
            }
        }
    }

    async fn http_send(port: u16, request: Vec<u8>) -> String {
        tokio::task::spawn_blocking(move || {
            let mut stream = std::net::TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
            stream.write_all(&request).unwrap();
            let mut response = Vec::new();
            stream.read_to_end(&mut response).unwrap();
            String::from_utf8_lossy(&response).into_owned()
        })
        .await
        .unwrap()
    }

    async fn http_get(port: u16, path: &str, extra_headers: &str) -> String {
        let request = format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\n{extra_headers}Connection: close\r\n\r\n");
        http_send(port, request.into_bytes()).await
    }

    /// The status code of a PUT with `body`.
    async fn http_put(port: u16, path: &str, body: &[u8]) -> u16 {
        let head = format!(
            "PUT {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        let response = http_send(port, [head.as_bytes(), body].concat()).await;
        response[9..12].parse().unwrap()
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

    async fn expect_uploads(dm: &mut Client, uploads: Value) {
        let frame: Value = serde_json::from_str(&next_text(dm).await).unwrap();
        assert_eq!(frame, json!({ "uploads": uploads }));
    }

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n and the rest of a picture";

    #[test]
    fn pictures_are_known_by_their_first_bytes_and_names_never_lead_anywhere() {
        assert_eq!(sniff_picture(PNG), Some("png"));
        assert_eq!(sniff_picture(b"\xff\xd8\xff\xe0 jpeg data"), Some("jpg"));
        assert_eq!(sniff_picture(b"RIFF\0\0\0\0WEBPVP8 "), Some("webp"));
        assert_eq!(sniff_picture(b"RIFF\0\0\0\0WAVEfmt "), None);
        assert_eq!(sniff_picture(b"GIF89a and more"), None);
        assert_eq!(sniff_picture(b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>"), None);
        assert_eq!(sniff_picture(b"\x89PN"), None);
        assert!(upload_name_valid("Thorin portrait.png"));
        assert!(upload_name_valid("noextension"));
        assert!(upload_name_valid(&"é".repeat(100)));
        for name in ["", "../x.png", "a/b.png", "a\\b.png", ".hidden", "..", "C:x.png", "a\0.png", "a\n.png"] {
            assert!(!upload_name_valid(name), "{name:?}");
        }
        assert!(!upload_name_valid(&"x".repeat(101)));
    }

    async fn received(declared: Option<usize>, body: Vec<u8>) -> Result<(&'static str, usize), StatusCode> {
        let root = test_root("receive");
        let mut headers = HeaderMap::new();
        if let Some(length) = declared {
            headers.insert(header::CONTENT_LENGTH, HeaderValue::from(length));
        }
        let result = receive_picture(&headers, Body::from(body), &root.join("upload")).await;
        std::fs::remove_dir_all(root).unwrap();
        result.map_err(|error| error.0)
    }

    #[tokio::test]
    async fn uploads_are_refused_over_the_limit_or_without_picture_bytes() {
        assert_eq!(received(None, PNG.to_vec()).await, Ok(("png", PNG.len())));
        let declared = Some(PLAYER_UPLOAD_MAX_BYTES + 1);
        assert_eq!(received(declared, PNG.to_vec()).await, Err(StatusCode::PAYLOAD_TOO_LARGE));
        let streamed = [PNG, &vec![0u8; PLAYER_UPLOAD_MAX_BYTES]].concat();
        assert_eq!(received(None, streamed).await, Err(StatusCode::PAYLOAD_TOO_LARGE));
        let gif = b"GIF89a and the rest of a picture".to_vec();
        assert_eq!(received(None, gif).await, Err(StatusCode::UNSUPPORTED_MEDIA_TYPE));
        assert_eq!(received(None, PNG[..4].to_vec()).await, Err(StatusCode::UNSUPPORTED_MEDIA_TYPE));
    }

    #[tokio::test]
    async fn player_uploads_reach_only_the_dm_and_are_refused_otherwise() {
        let root = test_root("uploads");
        let (token_a, token_party, token_c) = ("a".repeat(32), "p".repeat(32), "c".repeat(32));
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let initial = links(&[(&token_a, "A"), (&token_party, "party"), (&token_c, "C")]);
        let views = vec!["A".to_owned(), "party".to_owned()];
        let server = Server::spawn(Box::new(TestHost(root.clone())), listener, initial, views).unwrap();
        let info = server.info();
        let port = info.port;
        let dm_token = server.hub.dm_token.clone();
        let (mut dm, _) = tokio_tungstenite::connect_async(info.dm_url.as_str()).await.unwrap();
        expect_status(&mut dm, 0, json!({})).await;
        expect_uploads(&mut dm, json!([])).await;
        let put = |token: &str, name: &str, body: &'static [u8]| {
            let path = format!("/api/player-upload/{name}?token={token}");
            async move { http_put(port, &path, body).await }
        };

        assert_eq!(put("wrong", "me.png", PNG).await, 401);
        assert_eq!(put(&token_party, "me.png", PNG).await, 403);
        assert_eq!(put(&token_c, "me.png", PNG).await, 403);
        assert_eq!(put(&dm_token, "me.png", PNG).await, 403);
        assert_eq!(put(&token_a, "me.png", b"GIF89a and the rest of a picture").await, 415);
        for name in ["..%2F..%2Fx.png", "a%5Cb.png", ".hidden.png", "a%00.png", "C%3Ax.png", "dir/me.png"] {
            assert_eq!(put(&token_a, name, PNG).await, 400, "{name}");
        }

        assert_eq!(put(&token_a, "Thorin%20portrait.png", PNG).await, 201);
        let frame: Value = serde_json::from_str(&next_text(&mut dm).await).unwrap();
        let upload = &frame["uploads"][0];
        assert_eq!(frame["uploads"].as_array().unwrap().len(), 1);
        assert_eq!(upload["view"], "A");
        assert_eq!(upload["name"], "Thorin portrait.png");
        assert_eq!(upload["type"], "png");
        assert_eq!(upload["size"], PNG.len());
        let id = upload["id"].as_str().unwrap().to_owned();
        let file = server.hub.upload_file(&id).unwrap();
        assert_eq!(std::fs::read(&file).unwrap(), PNG);
        // Players have no way to read uploads back, not even their own.
        let back = http_get(port, &format!("/api/player-upload/{id}?token={token_a}"), "").await;
        assert!(back.starts_with("HTTP/1.1 405"), "{back}");

        server.hub.delete_upload(&id).unwrap();
        expect_uploads(&mut dm, json!([])).await;
        assert!(!file.exists());
        assert!(server.hub.upload_file(&id).is_none());
        server.hub.delete_upload(&id).unwrap();

        assert_eq!(put(&token_a, "again.png", PNG).await, 201);
        let dir = server.hub.uploads().dir.clone();
        assert!(dir.exists());
        server.stop().await.unwrap();
        assert!(!dir.exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn uploads_wait_at_most_twenty_per_view_and_follow_the_rate_limit() {
        let root = test_root("upload-limits");
        let token = "a".repeat(32);
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let initial = links(&[(&token, "A")]);
        let server = Server::spawn(Box::new(TestHost(root.clone())), listener, initial, vec!["A".into()]).unwrap();
        let hub = &server.hub;
        let viewer = Viewer {
            token: token.clone(),
            view: "A".into(),
        };
        let start = Instant::now();
        let status = |result: Result<Reservation<'_>, HttpError>| result.map(|_| ()).map_err(|error| error.0);
        let burst: Vec<_> = (0..11).map(|_| status(hub.reserve_upload(&viewer, "p.png", start))).collect();
        assert_eq!(burst[..10], [Ok(()); 10]);
        assert_eq!(burst[10], Err(StatusCode::TOO_MANY_REQUESTS));

        let at = |i: u32| start + PLAYER_REFILL * (i + 10);
        for i in 0..PLAYER_UPLOAD_MAX_PENDING as u32 {
            let reservation = hub.reserve_upload(&viewer, "p.png", at(i)).unwrap();
            hub.record_upload(reservation, "png", 1);
        }
        let full = status(hub.reserve_upload(&viewer, "p.png", at(30)));
        assert_eq!(full, Err(StatusCode::TOO_MANY_REQUESTS));
        let first = hub.uploads().pending[0].id.clone();
        hub.delete_upload(&first).unwrap();
        assert!(hub.reserve_upload(&viewer, "p.png", at(31)).is_ok());

        // A slot still streaming counts, and frees itself when dropped.
        let streaming = hub.reserve_upload(&viewer, "p.png", at(32)).unwrap();
        assert_eq!(status(hub.reserve_upload(&viewer, "p.png", at(33))), Err(StatusCode::TOO_MANY_REQUESTS));
        drop(streaming);
        assert!(hub.reserve_upload(&viewer, "p.png", at(34)).is_ok());

        hub.set_links(links(&[(&token, "A")]), Vec::new());
        let withdrawn = status(hub.reserve_upload(&viewer, "p.png", at(40)));
        assert_eq!(withdrawn, Err(StatusCode::FORBIDDEN));
        server.stop().await.unwrap();
        std::fs::remove_dir_all(root).unwrap();
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
        let initial = links(&[(&token, "party")]);
        let server = Server::spawn(Box::new(TestHost(root.clone())), listener, initial, Vec::new()).unwrap();
        let info = server.info();
        let port = info.port;
        assert_eq!(info.hosts.last().unwrap(), &format!("http://127.0.0.1:{port}"));
        let asset = "/asset/data/library/maps/m1/assets/map.png";
        let get = |path: String| async move { http_get(port, &path, "").await };

        let served = get(format!("{asset}?token={token}")).await;
        assert!(served.starts_with("HTTP/1.1 200"));
        assert!(served.contains("PNGDATA"));
        assert!(served.contains("accept-ranges: bytes"));
        let ranged = http_get(port, &format!("{asset}?token={token}"), "Range: bytes=1-3\r\n").await;
        assert!(ranged.starts_with("HTTP/1.1 206"));
        assert!(ranged.contains("content-range: bytes 1-3/7"));
        assert!(ranged.ends_with("\r\n\r\nNGD"));
        let beyond = http_get(port, &format!("{asset}?token={token}"), "Range: bytes=7-\r\n").await;
        assert!(beyond.starts_with("HTTP/1.1 416"));
        assert!(beyond.contains("content-range: bytes */7"));
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
        expect_uploads(&mut dm, json!([])).await;
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
        expect_close(&mut player, close_code::POLICY, "not a valid player message").await;
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
    async fn stops_while_a_player_stalls_a_download() {
        use tokio::io::AsyncWriteExt;
        let root = test_root("stall");
        let token = "p".repeat(32);
        // Far more than the socket buffers hold, so the response cannot end.
        std::fs::write(root.join("library/maps/m1/assets/big.mp4"), vec![0u8; 64 << 20]).unwrap();
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let initial = links(&[(&token, "party")]);
        let server = Server::spawn(Box::new(TestHost(root)), listener, initial, Vec::new()).unwrap();
        let port = server.info().port;
        let mut stalled = tokio::net::TcpStream::connect((Ipv4Addr::LOCALHOST, port)).await.unwrap();
        let path = format!("/asset/data/library/maps/m1/assets/big.mp4?token={token}");
        let request = format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
        stalled.write_all(request.as_bytes()).await.unwrap();
        let mut status = [0u8; 12];
        stalled.read_exact(&mut status).await.unwrap();
        assert_eq!(&status, b"HTTP/1.1 200");
        let stopped = tokio::time::timeout(STOP_GRACE * 3, server.stop()).await;
        assert!(matches!(stopped, Ok(Ok(()))));
        TcpListener::bind((Ipv4Addr::LOCALHOST, port)).await.unwrap();
        // The stalled connection may still hold the file open on Windows, so
        // the next run's test_root removes the folder.
    }

    #[tokio::test]
    async fn routes_messages_per_view_and_follows_link_changes() {
        let root = test_root("views");
        let (token_a, token_b) = ("a".repeat(32), "b".repeat(32));
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let initial = links(&[(&token_a, "A"), (&token_b, "B")]);
        let server = Server::spawn(Box::new(TestHost(root.clone())), listener, initial, Vec::new()).unwrap();
        let port = server.info().port;
        let (mut dm, _) = tokio_tungstenite::connect_async(server.info().dm_url.as_str())
            .await
            .unwrap();
        expect_status(&mut dm, 0, json!({})).await;
        expect_uploads(&mut dm, json!([])).await;

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

        server.hub.set_links(links(&[(&token_b, "B")]), Vec::new());
        expect_close(&mut a, LINK_REVOKED, "link revoked").await;
        expect_status(&mut dm, 2, json!({ "A": 1, "B": 1 })).await;
        expect_status(&mut dm, 1, json!({ "B": 1 })).await;
        assert!(rejected(port, &token_a).await);
        let page = http_get(port, &format!("/player.html?token={token_a}"), "").await;
        assert!(page.starts_with("HTTP/1.1 401"));
        let asset = format!("/asset/data/library/maps/m1/assets/map.png?token={token_a}");
        assert!(http_get(port, &asset, "").await.starts_with("HTTP/1.1 401"));

        server.hub.set_links(links(&[(&token_b, "A")]), Vec::new());
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

    /// The status code of a request without body.
    async fn http_status(port: u16, method: &str, path: &str, extra_headers: &str) -> u16 {
        let head = format!("{method} {path} HTTP/1.1\r\nHost: 127.0.0.1\r\n{extra_headers}");
        let request = format!("{head}Content-Length: 0\r\nConnection: close\r\n\r\n");
        let response = http_send(port, request.into_bytes()).await;
        response[9..12].parse().unwrap()
    }

    #[tokio::test]
    async fn remote_dm_gets_the_dm_page_files_and_frames_and_nobody_else_does() {
        let root = test_root("remote-dm");
        std::fs::write(root.join("library/maps/m1/terrain.png"), b"TERRAIN").unwrap();
        let (player, remote) = ("p".repeat(32), "r".repeat(32));
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let initial = all_links(links(&[(&player, "party")]), Some(remote.clone()));
        let server = Server::spawn(Box::new(TestHost(root.clone())), listener, initial, Vec::new()).unwrap();
        let info = server.info();
        let port = info.port;
        let dm_token = server.hub.dm_token.clone();
        let get = |path: String| async move { http_get(port, &path, "").await };
        let status = |method: &'static str, path: String| async move { http_status(port, method, &path, "").await };

        let page = get(format!("/dm.html?token={remote}")).await;
        assert!(page.starts_with("HTTP/1.1 200"), "{page}");
        assert!(page.contains("<html>dm</html>"));
        assert!(page.contains(&format!("set-cookie: {DM_COOKIE}={remote}; Path=/; HttpOnly; SameSite=Strict")));
        assert_eq!(status("GET", format!("/dm.html?token={player}")).await, 403);
        assert_eq!(status("GET", format!("/dm.html?token={dm_token}")).await, 403);
        assert_eq!(status("GET", "/dm.html?token=wrong".to_owned()).await, 401);
        assert_eq!(status("GET", format!("/player.html?token={remote}")).await, 403);

        let read = "/dm/storage/read?area=data&path=library%2Fmaps%2Fm1%2Fmap.json";
        let document = get(format!("{read}&token={remote}")).await;
        assert!(document.starts_with("HTTP/1.1 200") && document.ends_with("{\"secret\":true}"));
        let cookie = format!("Cookie: {DM_COOKIE}={remote}\r\n");
        assert_eq!(http_status(port, "GET", read, &cookie).await, 200);
        for token in [&player, &dm_token] {
            assert_eq!(status("GET", format!("{read}&token={token}")).await, 403);
            assert_eq!(status("GET", format!("/dm/storage/roots?token={token}")).await, 403);
            assert_eq!(http_put(port, &format!("/dm/storage/write?path=x.json&token={token}"), b"{}").await, 403);
            assert_eq!(status("POST", format!("/dm/storage/remove?path=x.json&token={token}")).await, 403);
        }
        assert_eq!(status("GET", read.to_owned()).await, 401);
        let escape = format!("/dm/storage/read?area=data&path=..%2F..%2Fsecret.json&token={remote}");
        assert_eq!(status("GET", escape).await, 400);
        assert_eq!(status("GET", format!("/dm/storage/read?path=x.json&token={remote}")).await, 400);
        let roots = get(format!("/dm/storage/roots?token={remote}")).await;
        assert!(roots.starts_with("HTTP/1.1 200") && roots.contains("\"dataRoot\""));
        let listed = get(format!("/dm/storage/list?area=data&path=library%2Fmaps%2Fm1&token={remote}")).await;
        assert!(listed.contains("\"name\":\"map.json\""), "{listed}");
        let exists = get(format!("/dm/storage/exists?area=content&path=library&token={remote}")).await;
        assert!(exists.ends_with("true"));

        let write = |path: &str| format!("/dm/storage/write?path={path}&token={remote}");
        assert_eq!(http_put(port, &write("campaigns%2Fc1%2Fnote.json"), b"{}").await, 204);
        assert_eq!(std::fs::read(root.join("campaigns/c1/note.json")).unwrap(), b"{}");
        assert_eq!(http_put(port, &write("history%2F2026-10-19%2Fx.json"), b"{}").await, 400);
        assert_eq!(http_put(port, &write("..%2Fx.json"), b"{}").await, 400);
        assert!(!root.join("history/2026-10-19/x.json").exists());
        let remove = |path: &str| format!("/dm/storage/remove?path={path}&token={remote}");
        assert_eq!(status("POST", remove("history%2F2026-10-19")).await, 400);
        assert_eq!(status("POST", remove("campaigns%2Fc1%2Fnote.json")).await, 204);
        assert!(!root.join("campaigns/c1/note.json").exists());
        let copy = format!("/dm/storage/copy?area=data&from=library%2Fmaps%2Fm1&to=library%2Fmaps%2Fm2&token={remote}");
        assert_eq!(status("POST", copy).await, 204);
        assert!(root.join("library/maps/m2/map.json").is_file());
        let copy_out = format!("/dm/storage/copy?area=data&from=library&to=..%2Fout&token={remote}");
        assert_eq!(status("POST", copy_out).await, 400);

        let terrain = "/asset/data/library/maps/m1/terrain.png";
        assert_eq!(status("GET", format!("{terrain}?token={remote}")).await, 200);
        assert_eq!(http_status(port, "GET", terrain, &cookie).await, 200);
        assert_eq!(status("GET", format!("{terrain}?token={player}")).await, 403);
        let json_asset = format!("/asset/data/library/maps/m1/map.json?token={remote}");
        assert_eq!(status("GET", json_asset).await, 403);

        let (mut dm, _) = tokio_tungstenite::connect_async(info.dm_url.as_str()).await.unwrap();
        expect_status(&mut dm, 0, json!({})).await;
        expect_uploads(&mut dm, json!([])).await;
        let mut laptop = connect(port, &remote).await;
        assert_eq!(next_text(&mut dm).await, "@dm-count\n1");
        let mut table = connect(port, &player).await;
        expect_status(&mut dm, 1, json!({ "party": 1 })).await;

        laptop.send(WsMessage::text(r#"{"type":"hello"}"#)).await.unwrap();
        assert_eq!(next_text(&mut dm).await, "@dm\n{\"type\":\"hello\"}");
        let map = r#"{"protocol":1,"from":"dm","payload":{"type":"map","revision":1,"map":null}}"#;
        dm.send(WsMessage::text("@dm\n{\"type\":\"snapshot\"}")).await.unwrap();
        dm.send(WsMessage::text(format!("party\n{map}"))).await.unwrap();
        assert_eq!(next_text(&mut laptop).await, "{\"type\":\"snapshot\"}");
        assert_eq!(next_text(&mut table).await, map);

        let (mut second, _) = tokio_tungstenite::connect_async(info.dm_url.as_str()).await.unwrap();
        expect_status(&mut second, 1, json!({ "party": 1 })).await;
        expect_uploads(&mut second, json!([])).await;
        assert_eq!(next_text(&mut second).await, "@dm-count\n1");

        server.hub.set_links(all_links(links(&[(&player, "party")]), Some("s".repeat(32))), Vec::new());
        expect_close(&mut laptop, LINK_REVOKED, "link revoked").await;
        expect_status(&mut dm, 1, json!({ "party": 1 })).await;
        assert_eq!(next_text(&mut dm).await, "@dm-count\n0");
        assert_eq!(status("GET", format!("{read}&token={remote}")).await, 401);

        server.stop().await.unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }
}
