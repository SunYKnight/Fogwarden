//! Version history of the data root: before the app replaces or removes a file, its previous content is kept in
//! `history/<YYYY-MM-DD>/<relative path>` (the first previous version per file and day). Restores keep the version
//! they replace in `history/<YYYY-MM-DD> <HH-MM-SS> before restore/`. Contents are stored once in
//! `history/.objects/<sha256>`; the dated files are hard links to them, so identical versions cost no space.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};

use chrono::{Local, NaiveDate, NaiveTime};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;

use crate::storage::{self, Area, StorageError, StorageState};

pub(crate) const HISTORY_DIR: &str = "history";
const OBJECTS_DIR: &str = ".objects";
const RESTORE_SUFFIX: &str = " before restore";
const DATE_FORMAT: &str = "%Y-%m-%d";
const TIME_FORMAT: &str = "%H-%M-%S";
/// Folders older than this many days go on every start.
const KEEP_DAYS: u64 = 30;
/// Beyond this size the oldest days go first; today's versions always stay.
const MAX_BYTES: u64 = 2 * 1024 * 1024 * 1024;

/// Volume and file index (Windows) or device and inode (Unix): equal for hard links of one file.
type FileKey = (u64, u64);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryFile {
    path: String,
    bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryFolder {
    name: String,
    files: Vec<HistoryFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryListing {
    folders: Vec<HistoryFolder>,
    /// Disk space of the whole history, every stored content counted once.
    bytes: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreFile {
    folder: String,
    path: String,
}

struct Stored {
    /// None for the content store.
    folder: Option<String>,
    path: PathBuf,
    key: FileKey,
    bytes: u64,
}

/// True for paths inside the history folder (any case: Windows paths ignore it).
pub(crate) fn in_history(relative: &Path) -> bool {
    relative
        .components()
        .find(|c| !matches!(c, Component::CurDir))
        .is_some_and(|c| c.as_os_str().eq_ignore_ascii_case(HISTORY_DIR))
}

pub(crate) fn today() -> String {
    Local::now().format(DATE_FORMAT).to_string()
}

/// The day a history folder's versions were kept, None for anything else.
fn folder_date(name: &str) -> Option<NaiveDate> {
    let date = NaiveDate::parse_from_str(name.get(..10)?, DATE_FORMAT).ok()?;
    let rest = &name[10..];
    let restore = rest
        .strip_prefix(' ')
        .and_then(|r| r.strip_suffix(RESTORE_SUFFIX))
        .is_some_and(|time| NaiveTime::parse_from_str(time, TIME_FORMAT).is_ok());
    (rest.is_empty() || restore).then_some(date)
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(windows)]
fn file_key(path: &Path) -> Result<FileKey, StorageError> {
    let info = winapi_util::file::information(fs::File::open(path)?)?;
    Ok((info.volume_serial_number(), info.file_index()))
}

#[cfg(unix)]
fn file_key(path: &Path) -> Result<FileKey, StorageError> {
    use std::os::unix::fs::MetadataExt;
    let meta = fs::metadata(path)?;
    Ok((meta.dev(), meta.ino()))
}

fn collect_files(dir: &Path, prefix: &Path, files: &mut Vec<PathBuf>) -> Result<(), StorageError> {
    for item in fs::read_dir(dir)? {
        let item = item?;
        let relative = prefix.join(item.file_name());
        if item.file_type()?.is_dir() {
            collect_files(&item.path(), &relative, files)?;
        } else {
            files.push(relative);
        }
    }
    Ok(())
}

/// Files below the folder `dir`, relative to it.
pub(crate) fn files_under(dir: &Path) -> Result<Vec<PathBuf>, StorageError> {
    let mut files = Vec::new();
    collect_files(dir, Path::new(""), &mut files)?;
    Ok(files)
}

/// Stores `bytes` once in the content store and links `copy` to it.
fn store(root: &Path, bytes: &[u8], copy: &Path) -> Result<(), StorageError> {
    let object = root.join(HISTORY_DIR).join(OBJECTS_DIR).join(sha256_hex(bytes));
    if !object.is_file() {
        storage::write_atomic(&object, bytes)?;
    }
    if let Some(parent) = copy.parent() {
        fs::create_dir_all(parent)?;
    }
    // File systems without hard links (FAT, some network shares) get a copy;
    // the next prune drops the then unused object.
    if fs::hard_link(&object, copy).is_err() {
        storage::write_atomic(copy, bytes)?;
    }
    Ok(())
}

/// Pack imports stage their files in `packs/<id>.importing/` and remove it afterwards; nothing there is a version
/// of anything.
fn staging(relative: &Path) -> bool {
    relative
        .components()
        .any(|c| c.as_os_str().to_string_lossy().ends_with(".importing"))
}

/// Keeps the current content of `relative` in the history folder `folder` before it is replaced by `replacement`
/// (None: removed). Nothing happens for a new file, an unchanged one, one the folder holds already or a staged one.
pub(crate) fn keep(root: &Path, relative: &Path, replacement: Option<&[u8]>, folder: &str) -> Result<(), StorageError> {
    let current = root.join(relative);
    let copy = root.join(HISTORY_DIR).join(folder).join(relative);
    if current.is_file() && !copy.exists() && !staging(relative) {
        let bytes = fs::read(&current)?;
        if replacement != Some(bytes.as_slice()) {
            store(root, &bytes, &copy)?;
        }
    }
    Ok(())
}

/// Keeps every file of `relative`, a file or a folder, before it is removed.
pub(crate) fn keep_removed(root: &Path, relative: &Path, folder: &str) -> Result<(), StorageError> {
    let target = root.join(relative);
    let files = if target.is_dir() {
        files_under(&target)?.into_iter().map(|f| relative.join(f)).collect()
    } else {
        vec![relative.to_path_buf()]
    };
    for file in files {
        keep(root, &file, None, folder)?;
    }
    Ok(())
}

/// Names of the dated history folders, oldest first.
fn folders(root: &Path) -> Result<Vec<String>, StorageError> {
    let history = root.join(HISTORY_DIR);
    let mut names = Vec::new();
    if history.is_dir() {
        for item in fs::read_dir(&history)? {
            let item = item?;
            let name = item.file_name().to_string_lossy().into_owned();
            if item.file_type()?.is_dir() && folder_date(&name).is_some() {
                names.push(name);
            }
        }
    }
    names.sort();
    Ok(names)
}

fn is_temp(path: &Path) -> bool {
    path.extension().is_some_and(|e| e == "tmp")
}

/// Every stored file of the dated folders and the content store; temp files of interrupted writes are left out.
fn scan(root: &Path) -> Result<Vec<Stored>, StorageError> {
    let history = root.join(HISTORY_DIR);
    let objects = history.join(OBJECTS_DIR);
    let mut sources: Vec<(Option<String>, PathBuf)> = folders(root)?
        .into_iter()
        .map(|name| (Some(name.clone()), history.join(name)))
        .collect();
    if objects.is_dir() {
        sources.push((None, objects));
    }
    let mut stored = Vec::new();
    for (folder, dir) in sources {
        for path in files_under(&dir)?.into_iter().filter(|p| !is_temp(p)) {
            let file = dir.join(&path);
            stored.push(Stored {
                folder: folder.clone(),
                key: file_key(&file)?,
                bytes: fs::metadata(&file)?.len(),
                path,
            });
        }
    }
    Ok(stored)
}

fn slash_path(path: &Path) -> String {
    path.components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn listing(root: &Path) -> Result<HistoryListing, StorageError> {
    let mut sizes: HashMap<FileKey, u64> = HashMap::new();
    let mut files: BTreeMap<String, Vec<HistoryFile>> = folders(root)?.into_iter().map(|n| (n, Vec::new())).collect();
    for item in scan(root)? {
        sizes.insert(item.key, item.bytes);
        if let Some(list) = item.folder.and_then(|folder| files.get_mut(&folder)) {
            list.push(HistoryFile {
                path: slash_path(&item.path),
                bytes: item.bytes,
            });
        }
    }
    let folders = files
        .into_iter()
        .map(|(name, mut files)| {
            files.sort_by(|a, b| a.path.cmp(&b.path));
            HistoryFolder { name, files }
        })
        .collect();
    Ok(HistoryListing {
        folders,
        bytes: sizes.values().sum(),
    })
}

/// Deletes contents no dated folder links to any more.
fn remove_orphans(root: &Path) -> Result<(), StorageError> {
    let stored = scan(root)?;
    let used: HashSet<FileKey> = stored.iter().filter(|s| s.folder.is_some()).map(|s| s.key).collect();
    let objects = root.join(HISTORY_DIR).join(OBJECTS_DIR);
    for item in stored.iter().filter(|s| s.folder.is_none() && !used.contains(&s.key)) {
        fs::remove_file(objects.join(&item.path))?;
    }
    Ok(())
}

fn remove_folders(root: &Path, names: &[String]) -> Result<(), StorageError> {
    for name in names {
        fs::remove_dir_all(root.join(HISTORY_DIR).join(name))?;
    }
    remove_orphans(root)
}

/// Removes folders older than `keep_days`, then the oldest ones before `today` while the history is larger than
/// `max_bytes`.
fn prune(root: &Path, today: NaiveDate, keep_days: u64, max_bytes: u64) -> Result<(), StorageError> {
    let cutoff = today - chrono::Days::new(keep_days);
    // A content is freed once the newest folder linking it is gone.
    let mut newest: HashMap<FileKey, (u64, Option<String>)> = HashMap::new();
    for item in scan(root)? {
        let entry = newest.entry(item.key).or_insert((item.bytes, None));
        entry.1 = entry.1.take().max(item.folder);
    }
    let mut freed: HashMap<String, u64> = HashMap::new();
    let mut total = 0;
    for (bytes, folder) in newest.into_values() {
        if let Some(folder) = folder {
            total += bytes;
            *freed.entry(folder).or_default() += bytes;
        }
    }
    let mut doomed = Vec::new();
    for name in folders(root)? {
        let old = folder_date(&name).is_some_and(|date| date < cutoff || (total > max_bytes && date < today));
        if old {
            total -= freed.get(&name).copied().unwrap_or(0);
            doomed.push(name);
        }
    }
    remove_folders(root, &doomed)
}

/// Removes the folders of days before `before`.
fn clean(root: &Path, before: NaiveDate) -> Result<(), StorageError> {
    let doomed: Vec<String> = folders(root)?
        .into_iter()
        .filter(|name| folder_date(name).is_some_and(|date| date < before))
        .collect();
    remove_folders(root, &doomed)
}

/// The kept version `file` names, refusing anything but a file in a history folder.
fn kept_version(root: &Path, file: &RestoreFile) -> Result<PathBuf, StorageError> {
    if folder_date(&file.folder).is_some() && !in_history(Path::new(&file.path)) {
        storage::resolve(&root.join(HISTORY_DIR).join(&file.folder), &file.path)
    } else {
        Err(StorageError(format!("not a kept version: {}/{}", file.folder, file.path)))
    }
}

/// Writes the kept versions back. What they replace is kept like any write (`today`) and, so the restore can be
/// undone even after earlier changes today, also in the folder `marker`.
fn restore(root: &Path, files: &[RestoreFile], today: &str, marker: &str) -> Result<(), StorageError> {
    for file in files {
        let bytes = fs::read(kept_version(root, file)?)?;
        let target = storage::resolve(root, &file.path)?;
        let relative = Path::new(&file.path);
        keep(root, relative, Some(&bytes), today)?;
        keep(root, relative, Some(&bytes), marker)?;
        storage::write_atomic(&target, &bytes)?;
    }
    Ok(())
}

#[tauri::command]
pub fn history_list(state: State<'_, StorageState>) -> Result<HistoryListing, StorageError> {
    listing(&state.root(Area::Data)?)
}

/// Applies the age and size budget; the app calls it on every start and data root switch.
#[tauri::command]
pub fn history_prune(state: State<'_, StorageState>) -> Result<(), StorageError> {
    prune(&state.root(Area::Data)?, Local::now().date_naive(), KEEP_DAYS, MAX_BYTES)
}

/// Removes the versions kept more than `older_than_days` days ago.
#[tauri::command]
pub fn history_clean(state: State<'_, StorageState>, older_than_days: u64) -> Result<(), StorageError> {
    clean(
        &state.root(Area::Data)?,
        Local::now().date_naive() - chrono::Days::new(older_than_days),
    )
}

#[tauri::command]
pub fn history_restore(state: State<'_, StorageState>, files: Vec<RestoreFile>) -> Result<(), StorageError> {
    let marker = format!("{}{RESTORE_SUFFIX}", Local::now().format("%Y-%m-%d %H-%M-%S"));
    restore(&state.root(Area::Data)?, &files, &today(), &marker)
}

/// Shows the history folder in the OS file manager.
#[tauri::command]
pub fn history_open_folder(state: State<'_, StorageState>) -> Result<(), StorageError> {
    let dir = state.root(Area::Data)?.join(HISTORY_DIR);
    fs::create_dir_all(&dir)?;
    storage::open_in_file_manager(&dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    // In the project's ignored data-local/, so test files never leave the repo.
    fn test_root(name: &str) -> PathBuf {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("data-local")
            .join(format!("history-test-{name}"));
        if dir.exists() {
            fs::remove_dir_all(&dir).unwrap();
        }
        fs::create_dir_all(dir.join("library/maps/m1/assets")).unwrap();
        fs::canonicalize(dir).unwrap()
    }

    fn day(text: &str) -> NaiveDate {
        NaiveDate::parse_from_str(text, DATE_FORMAT).unwrap()
    }

    /// One app write on `folder`'s day.
    fn write(root: &Path, relative: &str, bytes: &[u8], folder: &str) {
        keep(root, Path::new(relative), Some(bytes), folder).unwrap();
        storage::write_atomic(&root.join(relative), bytes).unwrap();
    }

    fn kept(root: &Path, folder: &str, relative: &str) -> Option<Vec<u8>> {
        fs::read(root.join(HISTORY_DIR).join(folder).join(relative)).ok()
    }

    #[test]
    fn keeps_the_first_previous_version_per_day() {
        let root = test_root("daily");
        let map = "library/maps/m1/map.json";
        write(&root, map, b"v1", "2026-10-10");
        assert_eq!(kept(&root, "2026-10-10", map), None);
        write(&root, map, b"v2", "2026-10-10");
        write(&root, map, b"v3", "2026-10-10");
        write(&root, map, b"v3", "2026-10-11");
        write(&root, map, b"v4", "2026-10-11");
        assert_eq!(kept(&root, "2026-10-10", map), Some(b"v1".to_vec()));
        assert_eq!(kept(&root, "2026-10-11", map), Some(b"v3".to_vec()));
        assert_eq!(fs::read(root.join(map)).unwrap(), b"v4");
        keep_removed(&root, Path::new("library/maps/m1"), "2026-10-12").unwrap();
        assert_eq!(kept(&root, "2026-10-12", map), Some(b"v4".to_vec()));
        let staged = "packs/p.importing/pack.json";
        write(&root, staged, b"{}", "2026-10-12");
        keep_removed(&root, Path::new("packs/p.importing"), "2026-10-12").unwrap();
        assert_eq!(kept(&root, "2026-10-12", staged), None);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn stores_identical_binaries_once() {
        let root = test_root("dedup");
        let image = "library/maps/m1/assets/map.png";
        let copy = "library/maps/m2/assets/map.png";
        let big = vec![7u8; 100_000];
        write(&root, image, &big, "2026-10-10");
        write(&root, copy, &big, "2026-10-10");
        write(&root, image, &big, "2026-10-10");
        assert_eq!(kept(&root, "2026-10-10", image), None);
        write(&root, image, b"new", "2026-10-11");
        write(&root, copy, b"new", "2026-10-11");
        assert_eq!(kept(&root, "2026-10-11", image), Some(big.clone()));
        assert_eq!(kept(&root, "2026-10-11", copy), Some(big.clone()));
        let objects = files_under(&root.join(HISTORY_DIR).join(OBJECTS_DIR)).unwrap();
        assert_eq!(objects.len(), 1);
        assert_eq!(listing(&root).unwrap().bytes, 100_000);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn prunes_by_age_and_size() {
        let root = test_root("prune");
        let file = "library/maps/m1/assets/map.png";
        fs::write(root.join(file), vec![9u8; 1000]).unwrap();
        for (index, folder) in ["2026-08-01", "2026-10-01", "2026-10-05", "2026-10-12"].iter().enumerate() {
            write(&root, file, &vec![index as u8; 1000], folder);
        }
        let names = |root: &Path| folders(root).unwrap();
        assert_eq!(names(&root), ["2026-08-01", "2026-10-01", "2026-10-05", "2026-10-12"]);
        prune(&root, day("2026-10-12"), 30, u64::MAX).unwrap();
        assert_eq!(names(&root), ["2026-10-01", "2026-10-05", "2026-10-12"]);
        prune(&root, day("2026-10-12"), 30, 1500).unwrap();
        assert_eq!(names(&root), ["2026-10-12"]);
        prune(&root, day("2026-10-12"), 30, 0).unwrap();
        assert_eq!(names(&root), ["2026-10-12"]);
        assert_eq!(listing(&root).unwrap().bytes, 1000);
        clean(&root, day("2026-10-13")).unwrap();
        assert!(names(&root).is_empty());
        assert_eq!(listing(&root).unwrap().bytes, 0);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn restores_a_kept_version_undoably() {
        let root = test_root("restore");
        let map = "library/maps/m1/map.json";
        write(&root, map, b"monday", "2026-10-10");
        write(&root, map, b"tuesday", "2026-10-10");
        write(&root, map, b"today", "2026-10-11");
        let files = [RestoreFile {
            folder: "2026-10-10".into(),
            path: map.into(),
        }];
        let marker = "2026-10-11 14-03-05 before restore";
        restore(&root, &files, "2026-10-11", marker).unwrap();
        assert_eq!(fs::read(root.join(map)).unwrap(), b"monday");
        assert_eq!(kept(&root, marker, map), Some(b"today".to_vec()));
        let undo = [RestoreFile {
            folder: marker.into(),
            path: map.into(),
        }];
        restore(&root, &undo, "2026-10-11", "2026-10-11 14-04-00 before restore").unwrap();
        assert_eq!(fs::read(root.join(map)).unwrap(), b"today");
        let outside = [RestoreFile {
            folder: "../library".into(),
            path: map.into(),
        }];
        assert!(restore(&root, &outside, "2026-10-11", marker).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn lists_folders_and_recognises_history_paths() {
        let root = test_root("listing");
        write(&root, "settings.json", b"{}", "2026-10-10");
        write(&root, "settings.json", b"{ }", "2026-10-10");
        fs::write(root.join(HISTORY_DIR).join("2026-10-10").join("settings.json.tmp"), b"x").unwrap();
        fs::create_dir_all(root.join(HISTORY_DIR).join("notes")).unwrap();
        let listed = listing(&root).unwrap();
        assert_eq!(listed.folders.len(), 1);
        assert_eq!(listed.folders[0].name, "2026-10-10");
        let paths: Vec<_> = listed.folders[0].files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, ["settings.json"]);
        assert!(in_history(Path::new("History/2026-10-10/settings.json")));
        assert!(in_history(Path::new("./history")));
        assert!(!in_history(Path::new("library/history/x.txt")));
        assert!(folder_date("2026-10-10 14-03-05 before restore").is_some());
        assert!(folder_date("2026-10-10 later").is_none());
        fs::remove_dir_all(root).unwrap();
    }
}
