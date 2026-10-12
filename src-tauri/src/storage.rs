use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager, State};

const BOOTSTRAP_FILE: &str = "bootstrap.json";
const PATH_HEADER: &str = "x-storage-path";

#[derive(Debug)]
pub struct StorageError(String);

impl std::fmt::Display for StorageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for StorageError {}

impl From<std::io::Error> for StorageError {
    fn from(value: std::io::Error) -> Self {
        StorageError(value.to_string())
    }
}

impl From<tauri::Error> for StorageError {
    fn from(value: tauri::Error) -> Self {
        StorageError(value.to_string())
    }
}

impl From<serde_json::Error> for StorageError {
    fn from(value: serde_json::Error) -> Self {
        StorageError(value.to_string())
    }
}

impl Serialize for StorageError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Area {
    Data,
    Content,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Roots {
    data_root: String,
    content_root: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    name: String,
    is_dir: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Bootstrap {
    data_root: PathBuf,
}

pub struct StorageState {
    data_root: Mutex<PathBuf>,
    content_root: PathBuf,
    bootstrap_path: PathBuf,
}

impl StorageState {
    pub(crate) fn root(&self, area: Area) -> Result<PathBuf, StorageError> {
        match area {
            Area::Data => Ok(self
                .data_root
                .lock()
                .map_err(|e| StorageError(e.to_string()))?
                .clone()),
            Area::Content => Ok(self.content_root.clone()),
        }
    }

    fn roots(&self) -> Result<Roots, StorageError> {
        Ok(Roots {
            data_root: self.root(Area::Data)?.to_string_lossy().into_owned(),
            content_root: self.content_root.to_string_lossy().into_owned(),
        })
    }
}

// Debug builds read the repo's content folder so edits need no rebuild. The
// path must not contain "..": the asset protocol scope rejects such paths.
fn content_root(app: &AppHandle) -> Result<PathBuf, StorageError> {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let root = match manifest.parent() {
        Some(repo) if cfg!(debug_assertions) => repo.join("content"),
        _ => app.path().resource_dir()?.join("content"),
    };
    Ok(root)
}

fn load_data_root(app: &AppHandle, bootstrap_path: &Path) -> Result<PathBuf, StorageError> {
    let root = if bootstrap_path.is_file() {
        let bootstrap: Bootstrap = serde_json::from_str(&fs::read_to_string(bootstrap_path)?)?;
        bootstrap.data_root
    } else {
        app.path().app_data_dir()?
    };
    Ok(root)
}

pub fn init(app: &AppHandle) -> Result<(), StorageError> {
    let bootstrap_path = app.path().app_config_dir()?.join(BOOTSTRAP_FILE);
    let data_root = load_data_root(app, &bootstrap_path)?;
    let content_root = content_root(app)?;
    fs::create_dir_all(&data_root)?;
    app.asset_protocol_scope().allow_directory(&data_root, true)?;
    app.asset_protocol_scope().allow_directory(&content_root, true)?;
    app.manage(StorageState {
        data_root: Mutex::new(data_root),
        content_root,
        bootstrap_path,
    });
    Ok(())
}

pub(crate) fn resolve(root: &Path, relative: &str) -> Result<PathBuf, StorageError> {
    let rel = Path::new(relative);
    let safe = rel
        .components()
        .all(|c| matches!(c, Component::Normal(_) | Component::CurDir));
    if safe {
        Ok(root.join(rel))
    } else {
        Err(StorageError(format!("path must stay inside the storage root: {relative}")))
    }
}

// Temp file + rename keeps the old file intact if the app dies mid-write.
fn write_atomic(target: &Path, bytes: &[u8]) -> Result<(), StorageError> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut tmp_name = target
        .file_name()
        .ok_or_else(|| StorageError(format!("not a file path: {}", target.display())))?
        .to_os_string();
    tmp_name.push(".tmp");
    let tmp = target.with_file_name(tmp_name);
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, target)?;
    Ok(())
}

fn percent_decode(value: &str) -> Result<String, StorageError> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).map_err(|e| StorageError(e.to_string()))?;
            out.push(u8::from_str_radix(hex, 16).map_err(|e| StorageError(e.to_string()))?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|e| StorageError(e.to_string()))
}

#[tauri::command]
pub fn storage_roots(state: State<'_, StorageState>) -> Result<Roots, StorageError> {
    state.roots()
}

// Assets of the new root must load at once; the bootstrap file keeps the
// choice across restarts.
fn switch_data_root(app: &AppHandle, state: &StorageState, root: PathBuf) -> Result<Roots, StorageError> {
    fs::create_dir_all(&root)?;
    app.asset_protocol_scope().allow_directory(&root, true)?;
    let bootstrap = serde_json::to_string_pretty(&Bootstrap { data_root: root.clone() })?;
    write_atomic(&state.bootstrap_path, bootstrap.as_bytes())?;
    *state.data_root.lock().map_err(|e| StorageError(e.to_string()))? = root;
    state.roots()
}

#[tauri::command]
pub fn storage_set_data_root(
    app: AppHandle,
    state: State<'_, StorageState>,
    path: String,
) -> Result<Roots, StorageError> {
    switch_data_root(&app, &state, PathBuf::from(path))
}

#[cfg(target_os = "windows")]
const FILE_MANAGER: &str = "explorer";
#[cfg(target_os = "macos")]
const FILE_MANAGER: &str = "open";
#[cfg(all(unix, not(target_os = "macos")))]
const FILE_MANAGER: &str = "xdg-open";

/// Shows the data root in the OS file manager.
#[tauri::command]
pub fn storage_open_data_root(state: State<'_, StorageState>) -> Result<(), StorageError> {
    // Explorer exits with 1 even on success, so only the spawn is checked.
    std::process::Command::new(FILE_MANAGER)
        .arg(state.root(Area::Data)?)
        .spawn()?;
    Ok(())
}

#[tauri::command]
pub fn storage_read_text(state: State<'_, StorageState>, area: Area, path: String) -> Result<String, StorageError> {
    Ok(fs::read_to_string(resolve(&state.root(area)?, &path)?)?)
}

#[tauri::command]
pub fn storage_write_text(state: State<'_, StorageState>, path: String, text: String) -> Result<(), StorageError> {
    write_atomic(&resolve(&state.root(Area::Data)?, &path)?, text.as_bytes())
}

#[tauri::command]
pub fn storage_write_bytes(state: State<'_, StorageState>, request: Request<'_>) -> Result<(), StorageError> {
    let header = request
        .headers()
        .get(PATH_HEADER)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| StorageError(format!("missing {PATH_HEADER} header")))?;
    let target = resolve(&state.root(Area::Data)?, &percent_decode(header)?)?;
    match request.body() {
        InvokeBody::Raw(bytes) => write_atomic(&target, bytes),
        InvokeBody::Json(_) => Err(StorageError("expected a binary body".into())),
    }
}

fn list_dir(dir: &Path) -> Result<Vec<Entry>, StorageError> {
    let mut entries = Vec::new();
    if dir.is_dir() {
        for item in fs::read_dir(dir)? {
            let item = item?;
            entries.push(Entry {
                name: item.file_name().to_string_lossy().into_owned(),
                is_dir: item.file_type()?.is_dir(),
            });
        }
    }
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

#[tauri::command]
pub fn storage_list(state: State<'_, StorageState>, area: Area, path: String) -> Result<Vec<Entry>, StorageError> {
    list_dir(&resolve(&state.root(area)?, &path)?)
}

/// Entries of a folder the user picked in a native dialog, outside the storage roots.
#[tauri::command]
pub fn storage_list_folder(path: String) -> Result<Vec<Entry>, StorageError> {
    let dir = PathBuf::from(&path);
    if dir.is_absolute() && dir.is_dir() {
        list_dir(&dir)
    } else {
        Err(StorageError(format!("not a folder: {path}")))
    }
}

/// Copies the file `from`, an absolute path outside the storage roots, to `to` inside `root`.
fn import_file(root: &Path, from: &Path, to: &str) -> Result<(), StorageError> {
    if from.is_absolute() && from.is_file() {
        write_atomic(&resolve(root, to)?, &fs::read(from)?)
    } else {
        Err(StorageError(format!("not a file: {}", from.display())))
    }
}

/// Copies a file the user picked (absolute path) into the data area.
#[tauri::command]
pub fn storage_import_file(state: State<'_, StorageState>, from: String, to: String) -> Result<(), StorageError> {
    import_file(&state.root(Area::Data)?, Path::new(&from), &to)
}

#[tauri::command]
pub fn storage_exists(state: State<'_, StorageState>, area: Area, path: String) -> Result<bool, StorageError> {
    Ok(resolve(&state.root(area)?, &path)?.exists())
}

#[tauri::command]
pub fn storage_remove(state: State<'_, StorageState>, path: String) -> Result<(), StorageError> {
    let root = state.root(Area::Data)?;
    let target = resolve(&root, &path)?;
    if target == root {
        Err(StorageError("refusing to remove the data root".into()))
    } else if target.is_dir() {
        Ok(fs::remove_dir_all(&target)?)
    } else if target.is_file() {
        Ok(fs::remove_file(&target)?)
    } else {
        Ok(())
    }
}

#[tauri::command]
pub fn storage_asset_path(state: State<'_, StorageState>, area: Area, path: String) -> Result<String, StorageError> {
    Ok(resolve(&state.root(area)?, &path)?.to_string_lossy().into_owned())
}

fn copy_recursive(from: &Path, to: &Path) -> Result<(), StorageError> {
    if from.is_dir() {
        fs::create_dir_all(to)?;
        for item in fs::read_dir(from)? {
            let item = item?;
            copy_recursive(&item.path(), &to.join(item.file_name()))?;
        }
    } else {
        if let Some(parent) = to.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(from, to)?;
    }
    Ok(())
}

/// Copies a file or folder from either area into the data area.
#[tauri::command]
pub fn storage_copy(state: State<'_, StorageState>, area: Area, from: String, to: String) -> Result<(), StorageError> {
    let source = resolve(&state.root(area)?, &from)?;
    if !source.exists() {
        Err(StorageError(format!("nothing to copy at {from}")))
    } else {
        copy_recursive(&source, &resolve(&state.root(Area::Data)?, &to)?)
    }
}

/// Copies the whole data root `from` into `to`, an existing empty folder that neither contains nor lies inside it.
fn copy_data_root(from: &Path, to: &Path) -> Result<(), StorageError> {
    if !to.is_absolute() || !to.is_dir() {
        Err(StorageError(format!("choose an existing empty folder: {}", to.display())))
    } else {
        let source = fs::canonicalize(from)?;
        let target = fs::canonicalize(to)?;
        if target.starts_with(&source) || source.starts_with(&target) {
            Err(StorageError(format!(
                "the new folder must be outside the data folder and not contain it: {}",
                to.display()
            )))
        } else if fs::read_dir(&target)?.next().is_some() {
            Err(StorageError(format!("the new folder is not empty: {}", to.display())))
        } else {
            copy_recursive(&source, &target)
        }
    }
}

/// Copies the data root into the empty folder `path` and makes that folder the data root.
#[tauri::command]
pub fn storage_copy_data_root(
    app: AppHandle,
    state: State<'_, StorageState>,
    path: String,
) -> Result<Roots, StorageError> {
    let target = PathBuf::from(path);
    copy_data_root(&state.root(Area::Data)?, &target)?;
    switch_data_root(&app, &state, target)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Inside the project's ignored data-local/ so test files never leave the repo.
    fn test_dir(name: &str) -> PathBuf {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("data-local")
            .join(format!("storage-test-{name}"));
        if dir.exists() {
            fs::remove_dir_all(&dir).unwrap();
        }
        fs::create_dir_all(dir.join("root/library/maps/m1/assets")).unwrap();
        fs::write(dir.join("root/settings.json"), b"{}").unwrap();
        fs::write(dir.join("root/library/maps/m1/assets/map.png"), b"PNGDATA").unwrap();
        fs::canonicalize(dir).unwrap()
    }

    #[test]
    fn copies_the_data_root_into_an_empty_folder() {
        let dir = test_dir("copy");
        let target = dir.join("copy");
        fs::create_dir_all(&target).unwrap();
        copy_data_root(&dir.join("root"), &target).unwrap();
        assert_eq!(fs::read(target.join("settings.json")).unwrap(), b"{}");
        assert_eq!(fs::read(target.join("library/maps/m1/assets/map.png")).unwrap(), b"PNGDATA");
        assert!(dir.join("root/settings.json").is_file());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn refuses_unsafe_copy_targets() {
        let dir = test_dir("refuse");
        let root = dir.join("root");
        let full = dir.join("full");
        fs::create_dir_all(&full).unwrap();
        fs::write(full.join("keep.txt"), b"x").unwrap();
        let inside = root.join("inside");
        fs::create_dir_all(&inside).unwrap();
        assert!(copy_data_root(&root, &full).is_err());
        assert!(copy_data_root(&root, &inside).is_err());
        assert!(copy_data_root(&root, &root).is_err());
        assert!(copy_data_root(&root, &dir).is_err());
        assert!(copy_data_root(&root, &dir.join("missing")).is_err());
        assert!(copy_data_root(&root, Path::new("relative")).is_err());
        assert_eq!(fs::read(full.join("keep.txt")).unwrap(), b"x");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn imports_a_picked_file_into_the_data_area() {
        let dir = test_dir("import");
        let picked = dir.join("picked");
        fs::create_dir_all(&picked).unwrap();
        fs::write(picked.join("goblin.jpg"), b"JPG").unwrap();
        let root = dir.join("root");
        import_file(&root, &picked.join("goblin.jpg"), "library/creatures/assets/g.jpg").unwrap();
        assert_eq!(fs::read(root.join("library/creatures/assets/g.jpg")).unwrap(), b"JPG");
        assert!(import_file(&root, Path::new("goblin.jpg"), "x.jpg").is_err());
        assert!(import_file(&root, &picked, "x.jpg").is_err());
        assert!(import_file(&root, &picked.join("goblin.jpg"), "../escape.jpg").is_err());
        assert!(!dir.join("escape.jpg").exists());
        fs::remove_dir_all(dir).unwrap();
    }
}
