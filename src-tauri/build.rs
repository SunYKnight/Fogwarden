// Listing the commands makes each one need an `allow-*` grant in a capability;
// without the list every window, the player window too, could call them all.
const COMMANDS: &[&str] = &[
    "storage_roots",
    "storage_set_data_root",
    "storage_read_text",
    "storage_read_bytes",
    "storage_write_text",
    "storage_write_bytes",
    "storage_list",
    "storage_exists",
    "storage_remove",
    "storage_asset_path",
    "storage_copy",
    "storage_copy_data_root",
    "storage_open_data_root",
    "storage_list_folder",
    "storage_import_file",
    "storage_read_file_text",
    "storage_is_file",
    "storage_read_file_bytes",
    "storage_write_file_bytes",
    "history_list",
    "history_prune",
    "history_clean",
    "history_restore",
    "history_open_folder",
    "lan_start",
    "lan_set_links",
    "lan_stop",
    "lan_status",
    "frontend_file",
    "deploy_write_files",
    "deploy_host_key",
    "deploy_run",
];

fn main() {
    let manifest = tauri_build::AppManifest::new().commands(COMMANDS);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest)).expect("tauri build script failed");
}
