//! Relay server setup: an install script and an nginx site generated from
//! templates, written to a folder or deployed and run over SSH.
//!
//! SSH uses exec channels without PTY, so stdin bytes arrive unchanged and
//! stdout/stderr stay separate. Uploads pipe the file into `cat` instead of
//! using SFTP, which servers may disable and which needs no extra crate.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh::client::{self, Handle};
use russh::keys::{self, HashAlg, PrivateKeyWithHashAlg, PublicKeyOrCertificate};
use russh::{ChannelMsg, Disconnect};
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::AppHandle;

use crate::frontend;

const INSTALL_TEMPLATE: &str = include_str!("deploy/install.sh");
const NGINX_TEMPLATE: &str = include_str!("deploy/fogwarden-relay.nginx.conf");
const RELAY_FILE: &str = "relay.mjs";
const INSTALL_FILE: &str = "install.sh";
const NGINX_FILE: &str = "fogwarden-relay.nginx.conf";
// A shell word, not a path: the remote shell expands $HOME.
const REMOTE_DIR: &str = "\"$HOME/fogwarden-relay-setup\"";
const DM_KEY_PREFIX: &str = "FOGWARDEN_DM_KEY=";
const DM_KEY_LENGTH: usize = 64;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
const AUTH_TIMEOUT: Duration = Duration::from_secs(20);
// apt and certbot can stay silent for minutes; keepalives hold NAT state.
const KEEPALIVE_INTERVAL: Duration = Duration::from_secs(30);
const MIN_APP_PORT: u16 = 1024;
const MAX_DOMAIN_LENGTH: usize = 253;
const MAX_LABEL_LENGTH: usize = 63;
const MAX_EMAIL_LENGTH: usize = 254;
// SSH extended data type 1 is stderr (RFC 4254, section 5.2).
const STDERR_DATA: u32 = 1;

#[derive(Debug)]
pub struct DeployError(String);

impl std::fmt::Display for DeployError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl Serialize for DeployError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

impl From<std::io::Error> for DeployError {
    fn from(value: std::io::Error) -> Self {
        DeployError(value.to_string())
    }
}

impl From<russh::Error> for DeployError {
    fn from(value: russh::Error) -> Self {
        DeployError(format!("SSH: {value}"))
    }
}

impl From<tauri::Error> for DeployError {
    fn from(value: tauri::Error) -> Self {
        DeployError(value.to_string())
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerSetup {
    domain: String,
    /// Empty skips certbot and leaves the relay on plain HTTP.
    email: String,
    app_port: u16,
}

/// Credentials stay in memory only and never reach events or errors.
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum DeployAuth {
    Key { path: String, passphrase: Option<String> },
    Password { password: String },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployRequest {
    host: String,
    port: u16,
    user: String,
    auth: DeployAuth,
    /// Host key the user confirmed, as returned by `deploy_host_key`.
    fingerprint: String,
    setup: ServerSetup,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LineStream {
    Info,
    Stdout,
    Stderr,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct DeployLine {
    stream: LineStream,
    line: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployResult {
    dm_key: String,
}

fn info(line: impl Into<String>) -> DeployLine {
    DeployLine {
        stream: LineStream::Info,
        line: line.into(),
    }
}

// Both cases allowed: e-mail domains may carry capitals.
fn valid_label(label: &str) -> bool {
    (1..=MAX_LABEL_LENGTH).contains(&label.len())
        && label.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
        && !label.starts_with('-')
        && !label.ends_with('-')
}

fn valid_domain(domain: &str) -> bool {
    domain.len() <= MAX_DOMAIN_LENGTH
        && !domain.bytes().any(|b| b.is_ascii_uppercase())
        && domain.split('.').all(valid_label)
}

// A leading '-' would turn the address into a certbot option.
fn valid_email(email: &str) -> bool {
    email.len() <= MAX_EMAIL_LENGTH
        && email.split_once('@').is_some_and(|(local, host)| {
            local.bytes().next().is_some_and(|b| b.is_ascii_alphanumeric())
                && local
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"._%+-".contains(&b))
                && host.contains('.')
                && host.split('.').all(valid_label)
        })
}

impl ServerSetup {
    // The values end up in shell and nginx text: this is the injection guard.
    fn validate(&self) -> Result<(), DeployError> {
        if !valid_domain(&self.domain) {
            Err(DeployError(format!(
                "invalid domain {:?}: use lowercase letters, digits, dots and hyphens",
                self.domain
            )))?;
        }
        if !(self.email.is_empty() || valid_email(&self.email)) {
            Err(DeployError(format!("invalid e-mail address {:?}", self.email)))?;
        }
        if self.app_port < MIN_APP_PORT {
            Err(DeployError(format!(
                "invalid relay port {}: use {MIN_APP_PORT} to 65535",
                self.app_port
            )))?;
        }
        Ok(())
    }
}

struct SetupFile {
    name: &'static str,
    bytes: Vec<u8>,
}

/// The files to place on the server, in upload order.
fn setup_files(setup: &ServerSetup, relay: Vec<u8>) -> Result<Vec<SetupFile>, DeployError> {
    setup.validate()?;
    let port = setup.app_port.to_string();
    let install = INSTALL_TEMPLATE
        .replace("@DOMAIN@", &setup.domain)
        .replace("@EMAIL@", &setup.email)
        .replace("@PORT@", &port);
    let nginx = NGINX_TEMPLATE
        .replace("@DOMAIN@", &setup.domain)
        .replace("@PORT@", &port);
    Ok(vec![
        SetupFile {
            name: RELAY_FILE,
            bytes: relay,
        },
        SetupFile {
            name: INSTALL_FILE,
            bytes: install.into_bytes(),
        },
        SetupFile {
            name: NGINX_FILE,
            bytes: nginx.into_bytes(),
        },
    ])
}

fn relay_script(app: &AppHandle) -> Result<Vec<u8>, DeployError> {
    frontend::read(app, RELAY_FILE)
        .map(|(bytes, _)| bytes)
        .ok_or_else(|| DeployError(frontend::missing(RELAY_FILE)))
}

fn lock_error<T>(_: std::sync::PoisonError<T>) -> DeployError {
    DeployError("host key check panicked".into())
}

/// Accepts only the expected host key; without one, any key, for the probe.
struct HostKeyCheck {
    expected: Option<String>,
    seen: Arc<Mutex<Option<String>>>,
}

impl client::Handler for HostKeyCheck {
    type Error = DeployError;

    async fn check_server_key(&mut self, key: &PublicKeyOrCertificate) -> Result<bool, Self::Error> {
        let actual = key.public_key().fingerprint(HashAlg::Sha256).to_string();
        match self.expected.as_deref() {
            Some(expected) if expected != actual => Err(DeployError(format!(
                "host key mismatch: expected {expected}, the server presented {actual}; not connecting"
            ))),
            _ => {
                *self.seen.lock().map_err(lock_error)? = Some(actual);
                Ok(true)
            }
        }
    }
}

async fn connect(host: &str, port: u16, check: HostKeyCheck) -> Result<Handle<HostKeyCheck>, DeployError> {
    let config = Arc::new(client::Config {
        keepalive_interval: Some(KEEPALIVE_INTERVAL),
        ..Default::default()
    });
    tokio::time::timeout(CONNECT_TIMEOUT, client::connect(config, (host, port), check))
        .await
        .map_err(|_| DeployError(format!("connecting to {host}:{port} timed out")))?
        .map_err(|error| DeployError(format!("cannot connect to {host}:{port}: {error}")))
}

async fn host_key(host: &str, port: u16) -> Result<String, DeployError> {
    let seen = Arc::new(Mutex::new(None));
    let check = HostKeyCheck {
        expected: None,
        seen: seen.clone(),
    };
    let handle = connect(host, port, check).await?;
    handle.disconnect(Disconnect::ByApplication, "", "en").await?;
    let fingerprint = seen.lock().map_err(lock_error)?.take();
    fingerprint.ok_or_else(|| DeployError(format!("{host}:{port} presented no host key")))
}

async fn authenticate(handle: &mut Handle<HostKeyCheck>, user: &str, auth: &DeployAuth) -> Result<(), DeployError> {
    let attempt = async {
        let (method, result) = match auth {
            DeployAuth::Password { password } => ("password", handle.authenticate_password(user, password).await?),
            DeployAuth::Key { path, passphrase } => {
                let key = keys::load_secret_key(path, passphrase.as_deref())
                    .map_err(|error| DeployError(format!("cannot read SSH key {path}: {error}")))?;
                // Only RSA negotiates a hash; asking costs up to a second.
                let hash = if key.algorithm().is_rsa() {
                    handle.best_supported_rsa_hash().await?.flatten()
                } else {
                    None
                };
                let key = PrivateKeyWithHashAlg::new(Arc::new(key), hash);
                ("key", handle.authenticate_publickey(user, key).await?)
            }
        };
        if result.success() {
            Ok(())
        } else {
            Err(DeployError(format!("the server rejected the {method} for user {user}")))
        }
    };
    tokio::time::timeout(AUTH_TIMEOUT, attempt)
        .await
        .map_err(|_| DeployError("SSH login timed out".into()))?
}

/// Splits one output stream into lines; a chunk may end mid-line.
struct LineBuffer {
    stream: LineStream,
    pending: Vec<u8>,
}

impl LineBuffer {
    fn new(stream: LineStream) -> Self {
        LineBuffer {
            stream,
            pending: Vec::new(),
        }
    }

    fn emit<F>(&self, line: &[u8], sink: &mut F) -> Result<(), DeployError>
    where
        F: FnMut(DeployLine) -> Result<(), DeployError>,
    {
        let text = String::from_utf8_lossy(line);
        sink(DeployLine {
            stream: self.stream,
            line: text.trim_end_matches(['\n', '\r']).to_owned(),
        })
    }

    fn push<F>(&mut self, data: &[u8], sink: &mut F) -> Result<(), DeployError>
    where
        F: FnMut(DeployLine) -> Result<(), DeployError>,
    {
        self.pending.extend_from_slice(data);
        let complete = self.pending.iter().rposition(|&b| b == b'\n').map_or(0, |end| end + 1);
        let rest = self.pending.split_off(complete);
        let lines = std::mem::replace(&mut self.pending, rest);
        lines
            .split_inclusive(|&b| b == b'\n')
            .try_for_each(|line| self.emit(line, sink))
    }

    fn finish<F>(self, sink: &mut F) -> Result<(), DeployError>
    where
        F: FnMut(DeployLine) -> Result<(), DeployError>,
    {
        if self.pending.is_empty() {
            Ok(())
        } else {
            self.emit(&self.pending, sink)
        }
    }
}

/// Runs `command` in the user's shell with `stdin` as input and returns the
/// exit code; every output line goes to `sink` as it arrives.
async fn exec<F>(handle: &Handle<HostKeyCheck>, command: &str, stdin: &[u8], sink: &mut F) -> Result<u32, DeployError>
where
    F: FnMut(DeployLine) -> Result<(), DeployError> + Send,
{
    let channel = handle.channel_open_session().await?;
    channel.exec(true, command).await?;
    let (mut reader, writer) = channel.split();
    // Written while reading: a full output window must not stall the input.
    let write = async {
        writer.data(stdin).await?;
        writer.eof().await?;
        Ok::<(), DeployError>(())
    };
    let read = async {
        let mut stdout = LineBuffer::new(LineStream::Stdout);
        let mut stderr = LineBuffer::new(LineStream::Stderr);
        let mut status = None;
        while let Some(message) = reader.wait().await {
            match message {
                ChannelMsg::Data { data } => stdout.push(&data, sink)?,
                ChannelMsg::ExtendedData { data, ext } if ext == STDERR_DATA => stderr.push(&data, sink)?,
                ChannelMsg::ExitStatus { exit_status } => status = Some(Ok(exit_status)),
                ChannelMsg::ExitSignal { signal_name, .. } => {
                    status = Some(Err(DeployError(format!(
                        "`{command}` was killed by signal {signal_name:?}"
                    ))))
                }
                ChannelMsg::Failure => Err(DeployError(format!("the server refused to run `{command}`")))?,
                _ => {}
            }
        }
        stdout.finish(sink)?;
        stderr.finish(sink)?;
        status.unwrap_or_else(|| Err(DeployError(format!("`{command}` ended without an exit status"))))
    };
    let (written, status) = tokio::join!(write, read);
    // A command that fails early stops reading its input: the exit code is
    // the cause, the broken input stream only a consequence.
    match status? {
        0 => written.map(|()| 0),
        code => Ok(code),
    }
}

fn succeeded(code: u32, step: &str) -> Result<(), DeployError> {
    if code == 0 {
        Ok(())
    } else {
        Err(DeployError(format!("{step} failed with exit code {code}")))
    }
}

async fn upload<F>(handle: &Handle<HostKeyCheck>, dir: &str, file: &SetupFile, sink: &mut F) -> Result<(), DeployError>
where
    F: FnMut(DeployLine) -> Result<(), DeployError> + Send,
{
    let size = file.bytes.len().div_ceil(1024);
    sink(info(format!("Uploading {} ({size} KB)", file.name)))?;
    let command = format!("mkdir -p {dir} && cat > {dir}/{}", file.name);
    let code = exec(handle, &command, &file.bytes, sink).await?;
    succeeded(code, &format!("uploading {}", file.name))
}

async fn remote_uid<F>(handle: &Handle<HostKeyCheck>, sink: &mut F) -> Result<u32, DeployError>
where
    F: FnMut(DeployLine) -> Result<(), DeployError> + Send,
{
    let mut output = String::new();
    let mut collect = |line: DeployLine| match line.stream {
        LineStream::Stdout => {
            output.push_str(&line.line);
            Ok(())
        }
        _ => sink(line),
    };
    let code = exec(handle, "id -u", &[], &mut collect).await?;
    succeeded(code, "id -u")?;
    output
        .trim()
        .parse()
        .map_err(|_| DeployError(format!("unexpected output of `id -u`: {output}")))
}

/// Command and stdin that run install.sh as root.
async fn install_command<F>(
    handle: &Handle<HostKeyCheck>,
    request: &DeployRequest,
    dir: &str,
    sink: &mut F,
) -> Result<(String, Vec<u8>), DeployError>
where
    F: FnMut(DeployLine) -> Result<(), DeployError> + Send,
{
    let uid = remote_uid(handle, sink).await?;
    match (uid, &request.auth) {
        (0, _) => Ok((format!("cd {dir} && bash {INSTALL_FILE}"), Vec::new())),
        // -k ignores cached credentials, so sudo always consumes the password.
        (_, DeployAuth::Password { password }) => Ok((
            format!("cd {dir} && sudo -k -S -p '' bash {INSTALL_FILE}"),
            format!("{password}\n").into_bytes(),
        )),
        (_, DeployAuth::Key { .. }) => {
            let code = exec(handle, "sudo -n true", &[], sink).await?;
            if code != 0 {
                Err(DeployError(format!(
                    "sudo on the server needs a password for {}: log in with the password or as root, \
                     or allow sudo without password for this user",
                    request.user
                )))?;
            }
            Ok((format!("cd {dir} && sudo -n bash {INSTALL_FILE}"), Vec::new()))
        }
    }
}

fn valid_dm_key(key: &str) -> bool {
    key.len() == DM_KEY_LENGTH && key.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Uploads `files` to `dir` (a shell word) and runs install.sh; returns the
/// DM key, whose output line never reaches `sink`.
async fn run<F>(request: &DeployRequest, files: &[SetupFile], dir: &str, sink: &mut F) -> Result<String, DeployError>
where
    F: FnMut(DeployLine) -> Result<(), DeployError> + Send,
{
    sink(info(format!("Connecting to {}:{}", request.host, request.port)))?;
    let check = HostKeyCheck {
        expected: Some(request.fingerprint.clone()),
        seen: Arc::default(),
    };
    let mut handle = connect(&request.host, request.port, check).await?;
    sink(info(format!("Logging in as {}", request.user)))?;
    authenticate(&mut handle, &request.user, &request.auth).await?;
    for file in files {
        upload(&handle, dir, file, sink).await?;
    }
    let (command, stdin) = install_command(&handle, request, dir, sink).await?;
    sink(info(format!("Running {INSTALL_FILE} as root")))?;
    let mut key_line = None;
    let mut filter = |line: DeployLine| match line.line.strip_prefix(DM_KEY_PREFIX) {
        Some(key) if line.stream == LineStream::Stdout => {
            key_line = Some(key.to_owned());
            Ok(())
        }
        _ => sink(line),
    };
    let code = exec(&handle, &command, &stdin, &mut filter).await?;
    handle.disconnect(Disconnect::ByApplication, "", "en").await?;
    succeeded(code, INSTALL_FILE)?;
    key_line
        .filter(|key| valid_dm_key(key))
        .ok_or_else(|| DeployError(format!("{INSTALL_FILE} did not print a valid {DM_KEY_PREFIX} line")))
}

/// Writes install.sh, the nginx site and relay.mjs into `folder`.
#[tauri::command]
pub async fn deploy_write_files(
    app: AppHandle,
    folder: String,
    setup: ServerSetup,
) -> Result<Vec<String>, DeployError> {
    let files = setup_files(&setup, relay_script(&app)?)?;
    let folder = std::path::absolute(PathBuf::from(folder))?;
    files
        .iter()
        .map(|file| {
            let path = folder.join(file.name);
            std::fs::write(&path, &file.bytes)?;
            Ok(path.to_string_lossy().into_owned())
        })
        .collect()
}

/// Host key fingerprint (`SHA256:...`) for the user to confirm; no login.
#[tauri::command]
pub async fn deploy_host_key(host: String, port: u16) -> Result<String, DeployError> {
    host_key(&host, port).await
}

/// Uploads the setup files and runs install.sh as root, streaming its output.
#[tauri::command]
pub async fn deploy_run(
    app: AppHandle,
    request: DeployRequest,
    events: Channel<DeployLine>,
) -> Result<DeployResult, DeployError> {
    let files = setup_files(&request.setup, relay_script(&app)?)?;
    let mut send = |line: DeployLine| Ok(events.send(line)?);
    let dm_key = run(&request, &files, REMOTE_DIR, &mut send).await?;
    Ok(DeployResult { dm_key })
}

#[cfg(test)]
mod tests {
    use super::*;
    use russh::keys::ssh_key::private::Ed25519Keypair;
    use russh::keys::ssh_key::{Cipher, Kdf, LineEnding};
    use russh::keys::{PrivateKey, PublicKey};
    use russh::server::{self, Auth, ChannelOpenHandle, Msg, Session};
    use russh::{Channel as SshChannel, ChannelId};
    use std::collections::HashMap;
    use std::ffi::OsString;
    use std::future::Future;
    use std::net::Ipv4Addr;
    use std::path::Path;
    use std::process::Stdio;
    use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use tokio::sync::mpsc;

    const LOCALHOST: &str = "127.0.0.1";
    const USER: &str = "dm";
    const PASSWORD: &str = "correct horse";
    const PASSPHRASE: &str = "battery staple";
    const TEST_KEY: &str = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
    const TEST_TIMEOUT: Duration = Duration::from_secs(60);
    // Stands in for sudo: checks how the deployer calls it, then runs the
    // command. SUDO_NOPASS set means `sudo -n` succeeds.
    const FAKE_SUDO: &str = r#"#!/usr/bin/env bash
password_on_stdin=0
while [[ $1 == -* ]]; do
  case $1 in
    -S) password_on_stdin=1 ;;
    -p) shift ;;
    -n)
      if [[ -z ${SUDO_NOPASS:-} ]]; then
        echo "sudo: a password is required" >&2
        exit 1
      fi
      ;;
  esac
  shift
done
if ((password_on_stdin)); then
  IFS= read -r password
  if [[ $password != "$SUDO_PASSWORD" ]]; then
    echo "sudo: wrong password" >&2
    exit 1
  fi
fi
SUDO_USED=1 exec "$@"
"#;

    async fn within<T>(future: impl Future<Output = T>) -> T {
        tokio::time::timeout(TEST_TIMEOUT, future)
            .await
            .expect("test timed out")
    }

    // Per process: a concurrent `cargo test` must not delete these fixtures.
    fn test_dir(name: &str) -> PathBuf {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join(format!("deploy-test-{name}-{}", std::process::id()));
        if dir.exists() {
            std::fs::remove_dir_all(&dir).unwrap();
        }
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    // Git for Windows puts git.exe in Git\cmd and bash.exe in Git\bin. The
    // System32 bash.exe would start WSL instead.
    fn bash() -> PathBuf {
        let name = if cfg!(windows) { "bash.exe" } else { "bash" };
        let path = std::env::var_os("PATH").expect("PATH is set");
        std::env::split_paths(&path)
            .filter(|dir| !dir.to_string_lossy().to_ascii_lowercase().contains("system32"))
            .flat_map(|dir| [dir.join(name), dir.join("..").join("bin").join(name)])
            .find(|candidate| candidate.is_file())
            .expect("bash on PATH")
    }

    fn shell_word(path: &Path) -> String {
        format!("'{}'", path.to_string_lossy().replace('\\', "/"))
    }

    fn random_key() -> PrivateKey {
        let mut seed = [0u8; 32];
        getrandom::fill(&mut seed).unwrap();
        PrivateKey::from(Ed25519Keypair::from_seed(&seed))
    }

    fn fingerprint(key: &PrivateKey) -> String {
        key.public_key().fingerprint(HashAlg::Sha256).to_string()
    }

    fn binary_payload() -> Vec<u8> {
        (0..=255u8).cycle().take(300_000).collect()
    }

    #[derive(Clone)]
    struct TestServer {
        bash: PathBuf,
        path: OsString,
        env: Vec<(&'static str, String)>,
        client_key: Option<PublicKey>,
        stdin: HashMap<ChannelId, mpsc::UnboundedSender<Vec<u8>>>,
    }

    async fn pump(handle: server::Handle, channel: ChannelId, ext: Option<u32>, mut output: impl AsyncRead + Unpin) {
        let mut buffer = vec![0; 16 * 1024];
        let mut read = output.read(&mut buffer).await.unwrap();
        while read > 0 {
            let chunk = buffer[..read].to_vec();
            match ext {
                None => handle.data(channel, chunk).await.unwrap(),
                Some(ext) => handle.extended_data(channel, ext, chunk).await.unwrap(),
            }
            read = output.read(&mut buffer).await.unwrap();
        }
    }

    impl server::Handler for TestServer {
        type Error = russh::Error;

        async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
            Ok(if user == USER && password == PASSWORD {
                Auth::Accept
            } else {
                Auth::reject()
            })
        }

        async fn auth_publickey(&mut self, user: &str, key: &PublicKey) -> Result<Auth, Self::Error> {
            Ok(if user == USER && self.client_key.as_ref() == Some(key) {
                Auth::Accept
            } else {
                Auth::reject()
            })
        }

        async fn channel_open_session(
            &mut self,
            _channel: SshChannel<Msg>,
            reply: ChannelOpenHandle,
            _session: &mut Session,
        ) -> Result<(), Self::Error> {
            reply.accept().await;
            Ok(())
        }

        async fn exec_request(
            &mut self,
            channel: ChannelId,
            data: &[u8],
            session: &mut Session,
        ) -> Result<(), Self::Error> {
            session.channel_success(channel)?;
            let mut child = tokio::process::Command::new(&self.bash)
                .arg("-c")
                .arg(String::from_utf8_lossy(data).as_ref())
                .env("PATH", &self.path)
                .envs(self.env.iter().map(|(name, value)| (name, value)))
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .kill_on_drop(true)
                .spawn()?;
            let mut input = child.stdin.take().unwrap();
            let (sender, mut receiver) = mpsc::unbounded_channel::<Vec<u8>>();
            self.stdin.insert(channel, sender);
            tokio::spawn(async move {
                while let Some(chunk) = receiver.recv().await {
                    // The process exited without reading everything.
                    if input.write_all(&chunk).await.is_err() {
                        receiver.close();
                    }
                }
            });
            let handle = session.handle();
            let stdout = child.stdout.take().unwrap();
            let stderr = child.stderr.take().unwrap();
            tokio::spawn(async move {
                tokio::join!(
                    pump(handle.clone(), channel, None, stdout),
                    pump(handle.clone(), channel, Some(STDERR_DATA), stderr)
                );
                let code = child.wait().await.unwrap().code().unwrap();
                handle
                    .exit_status_request(channel, u32::try_from(code).unwrap())
                    .await
                    .unwrap();
                handle.eof(channel).await.unwrap();
                handle.close(channel).await.unwrap();
            });
            Ok(())
        }

        async fn data(&mut self, channel: ChannelId, data: &[u8], _session: &mut Session) -> Result<(), Self::Error> {
            let closed = self
                .stdin
                .get(&channel)
                .is_some_and(|input| input.send(data.to_vec()).is_err());
            if closed {
                self.stdin.remove(&channel);
            }
            Ok(())
        }

        async fn channel_eof(&mut self, channel: ChannelId, _session: &mut Session) -> Result<(), Self::Error> {
            // Dropping the sender closes the process's stdin.
            self.stdin.remove(&channel);
            Ok(())
        }
    }

    struct Fixture {
        port: u16,
        fingerprint: String,
        dir: PathBuf,
    }

    impl Drop for Fixture {
        // Reported, not raised: panicking while a failed test unwinds aborts.
        fn drop(&mut self) {
            if let Err(error) = std::fs::remove_dir_all(&self.dir) {
                eprintln!("cannot remove {}: {error}", self.dir.display());
            }
        }
    }

    async fn start_server(name: &str, client_key: Option<PublicKey>, nopass_sudo: bool) -> Fixture {
        let dir = test_dir(name);
        let bin = dir.join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(bin.join("sudo"), FAKE_SUDO).unwrap();
        // Unix only runs it from PATH when executable; else the real sudo runs.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(bin.join("sudo"), std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let path = std::env::var_os("PATH").unwrap();
        let path = std::env::join_paths(std::iter::once(bin).chain(std::env::split_paths(&path))).unwrap();
        let mut env = vec![("SUDO_PASSWORD", PASSWORD.to_owned())];
        if nopass_sudo {
            env.push(("SUDO_NOPASS", "1".to_owned()));
        }
        let handler = TestServer {
            bash: bash(),
            path,
            env,
            client_key,
            stdin: HashMap::new(),
        };
        let host_key = random_key();
        let fingerprint = fingerprint(&host_key);
        let config = Arc::new(server::Config {
            keys: vec![host_key],
            auth_rejection_time: Duration::ZERO,
            auth_rejection_time_initial: Some(Duration::ZERO),
            ..Default::default()
        });
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            loop {
                let (socket, _) = listener.accept().await.unwrap();
                let (config, handler) = (config.clone(), handler.clone());
                tokio::spawn(async move {
                    let result = match server::run_stream(config, socket, handler).await {
                        Ok(session) => session.await,
                        Err(error) => Err(error),
                    };
                    if let Err(error) = result {
                        eprintln!("test SSH session ended: {error}");
                    }
                });
            }
        });
        Fixture { port, fingerprint, dir }
    }

    async fn login(fixture: &Fixture, auth: &DeployAuth) -> Result<Handle<HostKeyCheck>, DeployError> {
        let check = HostKeyCheck {
            expected: Some(fixture.fingerprint.clone()),
            seen: Arc::default(),
        };
        let mut handle = connect(LOCALHOST, fixture.port, check).await?;
        authenticate(&mut handle, USER, auth).await?;
        Ok(handle)
    }

    fn password() -> DeployAuth {
        DeployAuth::Password {
            password: PASSWORD.to_owned(),
        }
    }

    fn setup(domain: &str, email: &str, app_port: u16) -> ServerSetup {
        ServerSetup {
            domain: domain.to_owned(),
            email: email.to_owned(),
            app_port,
        }
    }

    fn request(fixture: &Fixture, auth: DeployAuth) -> DeployRequest {
        DeployRequest {
            host: LOCALHOST.to_owned(),
            port: fixture.port,
            user: USER.to_owned(),
            auth,
            fingerprint: fixture.fingerprint.clone(),
            setup: setup("relay.example.com", "", 8080),
        }
    }

    // Fails unless sudo consumed the password and stdin is empty afterwards.
    fn fake_install(key_line: &str, exit_code: u8) -> Vec<SetupFile> {
        let script = format!(
            r#"#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ ${{SUDO_USED:-}} != 1 ]]; then echo "not run through sudo" >&2; exit 9; fi
if IFS= read -r -t 1 leftover; then echo "stdin leaked into install.sh" >&2; exit 8; fi
echo "installing"
echo "careful" >&2
echo "{key_line}"
printf 'done'
exit {exit_code}
"#
        );
        vec![
            SetupFile {
                name: RELAY_FILE,
                bytes: binary_payload(),
            },
            SetupFile {
                name: INSTALL_FILE,
                bytes: script.into_bytes(),
            },
            SetupFile {
                name: NGINX_FILE,
                bytes: b"server {}\n".to_vec(),
            },
        ]
    }

    fn lines_of(lines: &[DeployLine], stream: LineStream) -> Vec<&str> {
        lines
            .iter()
            .filter(|line| line.stream == stream)
            .map(|line| line.line.as_str())
            .collect()
    }

    async fn run_fake(
        fixture: &Fixture,
        auth: DeployAuth,
        files: &[SetupFile],
    ) -> (Result<String, DeployError>, Vec<DeployLine>) {
        let mut lines = Vec::new();
        let mut collect = |line| {
            lines.push(line);
            Ok(())
        };
        let remote = shell_word(&fixture.dir.join("remote"));
        let result = within(run(&request(fixture, auth), files, &remote, &mut collect)).await;
        (result, lines)
    }

    #[test]
    fn domains_must_be_plain_hostnames() {
        for domain in [
            "relay.example.com",
            "a-b.c1.de",
            "localhost",
            &format!("{}.de", "a".repeat(63)),
        ] {
            assert!(setup(domain, "", 8080).validate().is_ok(), "{domain}");
        }
        let long_label = format!("{}.de", "a".repeat(64));
        let invalid = [
            "",
            "Relay.example.com",
            "-relay.example.com",
            "relay-.example.com",
            "relay..example.com",
            ".example.com",
            "example.com.",
            "relay_1.example.com",
            "relay.example.com;reboot",
            "relay.example.com\nreboot",
            "$(reboot).example.com",
            "relay example.com",
            "relay.example.com'",
            "relay.example.com }",
            &long_label,
        ];
        for domain in invalid {
            assert!(setup(domain, "", 8080).validate().is_err(), "{domain:?}");
        }
    }

    #[test]
    fn emails_are_empty_or_plain_addresses() {
        for email in [
            "",
            "dm@example.com",
            "Game.Master+relay@Mail.example.org",
            "dm_1%x@example.co.uk",
        ] {
            assert!(setup("relay.example.com", email, 8080).validate().is_ok(), "{email}");
        }
        let invalid = [
            "dm",
            "dm@",
            "@example.com",
            "dm@example",
            "dm@@example.com",
            "dm@ex@ample.com",
            "-dm@example.com",
            "dm'@example.com",
            "dm\"@example.com",
            "d m@example.com",
            "dm@example.com; reboot",
            "dm@example.com\n",
            "$(reboot)@example.com",
            "`reboot`@example.com",
            "dm@-example.com",
        ];
        for email in invalid {
            assert!(setup("relay.example.com", email, 8080).validate().is_err(), "{email:?}");
        }
    }

    #[test]
    fn app_ports_are_unprivileged() {
        for port in [1024, 8080, 65535] {
            assert!(setup("relay.example.com", "", port).validate().is_ok(), "{port}");
        }
        for port in [0, 80, 443, 1023] {
            assert!(setup("relay.example.com", "", port).validate().is_err(), "{port}");
        }
    }

    #[test]
    fn generated_files_carry_the_setup_and_install_sh_parses() {
        let dir = test_dir("generate");
        let files = setup_files(&setup("relay.example.com", "dm@example.com", 8123), b"relay".to_vec()).unwrap();
        let names: Vec<_> = files.iter().map(|file| file.name).collect();
        assert_eq!(names, [RELAY_FILE, INSTALL_FILE, NGINX_FILE]);
        assert_eq!(files[0].bytes, b"relay");
        let install = String::from_utf8(files[1].bytes.clone()).unwrap();
        let nginx = String::from_utf8(files[2].bytes.clone()).unwrap();
        for text in [&install, &nginx] {
            assert!(!text.contains("@DOMAIN@") && !text.contains("@EMAIL@") && !text.contains("@PORT@"));
            assert!(!text.contains('\r'));
        }
        assert!(install.contains("DOMAIN='relay.example.com'"));
        assert!(install.contains("EMAIL='dm@example.com'"));
        assert!(install.contains("PORT='8123'"));
        assert!(nginx.contains("server_name relay.example.com;"));
        assert_eq!(nginx.matches("proxy_pass http://127.0.0.1:8123;").count(), 2);
        let script = dir.join(INSTALL_FILE);
        std::fs::write(&script, &install).unwrap();
        let check = std::process::Command::new(bash())
            .arg("-n")
            .arg(&script)
            .output()
            .unwrap();
        assert!(check.status.success(), "{}", String::from_utf8_lossy(&check.stderr));
        assert!(setup_files(&setup("relay.example.com", "x';reboot;'@a.de", 8123), Vec::new()).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn line_buffer_joins_chunks_and_flushes_the_rest() {
        let mut lines = Vec::new();
        let mut collect = |line: DeployLine| -> Result<(), DeployError> {
            lines.push(line.line);
            Ok(())
        };
        let mut buffer = LineBuffer::new(LineStream::Stdout);
        buffer.push(b"on", &mut collect).unwrap();
        buffer.push(b"e\r\ntwo\n\nthr", &mut collect).unwrap();
        buffer.push("\u{e4}\nfour".as_bytes(), &mut collect).unwrap();
        buffer.finish(&mut collect).unwrap();
        assert_eq!(lines, ["one", "two", "", "thr\u{e4}", "four"]);
    }

    #[test]
    fn dm_keys_are_64_lowercase_hex_digits() {
        assert!(valid_dm_key(TEST_KEY));
        assert!(!valid_dm_key(&TEST_KEY.to_uppercase()));
        assert!(!valid_dm_key(&TEST_KEY[1..]));
        assert!(!valid_dm_key(&format!("{}g", &TEST_KEY[1..])));
    }

    #[tokio::test]
    async fn host_key_probe_returns_the_server_fingerprint() {
        let fixture = start_server("probe", None, false).await;
        let probed = within(host_key(LOCALHOST, fixture.port)).await.unwrap();
        assert_eq!(probed, fixture.fingerprint);
        assert!(probed.starts_with("SHA256:") && !probed.ends_with('='));
    }

    #[tokio::test]
    async fn unexpected_host_key_is_refused() {
        let fixture = start_server("mismatch", None, false).await;
        let check = HostKeyCheck {
            expected: Some("SHA256:somethingElse".into()),
            seen: Arc::default(),
        };
        let error = within(connect(LOCALHOST, fixture.port, check)).await.err().unwrap();
        assert!(error.0.contains("expected SHA256:somethingElse"), "{error}");
        assert!(error.0.contains(&fixture.fingerprint), "{error}");
    }

    #[tokio::test]
    async fn password_login_accepts_only_the_right_password() {
        let fixture = start_server("password", None, false).await;
        within(login(&fixture, &password())).await.unwrap();
        let wrong = DeployAuth::Password {
            password: "wrong".into(),
        };
        let error = within(login(&fixture, &wrong)).await.err().unwrap();
        assert!(error.0.contains("rejected the password"), "{error}");
    }

    #[tokio::test]
    async fn key_login_reads_encrypted_openssh_keys() {
        let client_key = random_key();
        let fixture = start_server("key", Some(client_key.public_key().clone()), false).await;
        let mut salt = vec![0u8; 16];
        getrandom::fill(&mut salt).unwrap();
        let kdf = Kdf::Bcrypt { salt, rounds: 16 };
        let encrypted = client_key
            .encrypt_with(Cipher::Aes256Ctr, kdf, 0x5eed_5eed, PASSPHRASE)
            .unwrap();
        let key_path = fixture.dir.join("id_ed25519");
        std::fs::write(&key_path, encrypted.to_openssh(LineEnding::LF).unwrap().as_bytes()).unwrap();
        let key_auth = |passphrase: &str| DeployAuth::Key {
            path: key_path.to_string_lossy().into_owned(),
            passphrase: Some(passphrase.to_owned()),
        };
        within(login(&fixture, &key_auth(PASSPHRASE))).await.unwrap();
        let error = within(login(&fixture, &key_auth("wrong"))).await.err().unwrap();
        assert!(error.0.contains("cannot read SSH key"), "{error}");

        let stranger_path = fixture.dir.join("id_stranger");
        let stranger = random_key().to_openssh(LineEnding::LF).unwrap();
        std::fs::write(&stranger_path, stranger.as_bytes()).unwrap();
        let stranger_auth = DeployAuth::Key {
            path: stranger_path.to_string_lossy().into_owned(),
            passphrase: None,
        };
        let error = within(login(&fixture, &stranger_auth)).await.err().unwrap();
        assert!(error.0.contains("rejected the key"), "{error}");
    }

    #[tokio::test]
    async fn upload_is_binary_safe() {
        let fixture = start_server("upload", None, false).await;
        let handle = within(login(&fixture, &password())).await.unwrap();
        let file = SetupFile {
            name: RELAY_FILE,
            bytes: binary_payload(),
        };
        let remote = fixture.dir.join("remote");
        let mut lines = Vec::new();
        let mut collect = |line| {
            lines.push(line);
            Ok(())
        };
        let uploaded = within(upload(&handle, &shell_word(&remote), &file, &mut collect)).await;
        uploaded.unwrap_or_else(|error| panic!("{error}: {lines:?}"));
        assert_eq!(std::fs::read(remote.join(RELAY_FILE)).unwrap(), file.bytes);
        assert_eq!(lines, [info("Uploading relay.mjs (293 KB)")]);
    }

    #[tokio::test]
    async fn exec_streams_lines_and_returns_the_exit_code() {
        let fixture = start_server("exec", None, false).await;
        let handle = within(login(&fixture, &password())).await.unwrap();
        let mut lines = Vec::new();
        let mut collect = |line| {
            lines.push(line);
            Ok(())
        };
        let command = "for i in 1 2 3; do echo line$i; done; echo warn >&2; cat; printf tail; exit 7";
        let code = within(exec(&handle, command, b"in1\nin2\n", &mut collect))
            .await
            .unwrap();
        assert_eq!(code, 7);
        assert_eq!(
            lines_of(&lines, LineStream::Stdout),
            ["line1", "line2", "line3", "in1", "in2", "tail"]
        );
        assert_eq!(lines_of(&lines, LineStream::Stderr), ["warn"]);
    }

    #[tokio::test]
    async fn run_uses_sudo_with_the_password_and_hides_the_dm_key() {
        let fixture = start_server("run", None, false).await;
        let files = fake_install(&format!("{DM_KEY_PREFIX}{TEST_KEY}"), 0);
        let (result, lines) = run_fake(&fixture, password(), &files).await;
        assert_eq!(result.unwrap(), TEST_KEY);
        assert_eq!(lines_of(&lines, LineStream::Stdout), ["installing", "done"]);
        assert_eq!(lines_of(&lines, LineStream::Stderr), ["careful"]);
        assert!(lines
            .iter()
            .all(|line| !line.line.contains(TEST_KEY) && !line.line.contains(PASSWORD)));
        assert!(lines.contains(&info("Uploading install.sh (1 KB)")));
        assert_eq!(lines.last().unwrap().line, "done");
        let remote = fixture.dir.join("remote");
        assert_eq!(std::fs::read(remote.join(RELAY_FILE)).unwrap(), binary_payload());
        assert_eq!(std::fs::read(remote.join(NGINX_FILE)).unwrap(), b"server {}\n");
    }

    #[tokio::test]
    async fn run_fails_on_exit_code_or_missing_dm_key() {
        let fixture = start_server("run-fail", None, false).await;
        let (result, _) = run_fake(&fixture, password(), &fake_install("no key", 0)).await;
        assert!(result
            .err()
            .unwrap()
            .0
            .contains("did not print a valid FOGWARDEN_DM_KEY= line"));
        let (result, _) = run_fake(&fixture, password(), &fake_install(&format!("{DM_KEY_PREFIX}xyz"), 0)).await;
        assert!(result
            .err()
            .unwrap()
            .0
            .contains("did not print a valid FOGWARDEN_DM_KEY= line"));
        let (result, _) = run_fake(&fixture, password(), &fake_install("no key", 4)).await;
        let error = result.err().unwrap();
        assert!(error.0.contains("install.sh failed with exit code 4"), "{error}");
    }

    #[tokio::test]
    async fn run_with_key_needs_passwordless_sudo() {
        let client_key = random_key();
        let key_path = |fixture: &Fixture| {
            let path = fixture.dir.join("id_ed25519");
            std::fs::write(&path, client_key.to_openssh(LineEnding::LF).unwrap().as_bytes()).unwrap();
            DeployAuth::Key {
                path: path.to_string_lossy().into_owned(),
                passphrase: None,
            }
        };
        let files = fake_install(&format!("{DM_KEY_PREFIX}{TEST_KEY}"), 0);

        let fixture = start_server("sudo-pass", Some(client_key.public_key().clone()), false).await;
        let (result, lines) = run_fake(&fixture, key_path(&fixture), &files).await;
        let error = result.err().unwrap();
        assert!(
            error.0.contains("sudo on the server needs a password for dm"),
            "{error}"
        );
        assert_eq!(lines_of(&lines, LineStream::Stderr), ["sudo: a password is required"]);

        let fixture = start_server("sudo-nopass", Some(client_key.public_key().clone()), true).await;
        let (result, _) = run_fake(&fixture, key_path(&fixture), &files).await;
        assert_eq!(result.unwrap(), TEST_KEY);
    }
}
