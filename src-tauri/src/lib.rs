mod deploy;
mod frontend;
mod history;
mod lan;
mod storage;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(lan::LanState::default())
        .setup(|app| {
            storage::init(app.handle())?;
            Ok(())
        })
        // A player window left alone on a second screen has no way back to the
        // DM's controls, so closing the DM window ends the app.
        .on_window_event(|window, event| {
            if window.label() == "dm" && matches!(event, tauri::WindowEvent::Destroyed) {
                window.app_handle().exit(0);
            }
        })
        .invoke_handler(tauri::generate_handler![
            storage::storage_roots,
            storage::storage_set_data_root,
            storage::storage_read_text,
            storage::storage_read_bytes,
            storage::storage_write_text,
            storage::storage_write_bytes,
            storage::storage_list,
            storage::storage_exists,
            storage::storage_remove,
            storage::storage_asset_path,
            storage::storage_copy,
            storage::storage_copy_data_root,
            storage::storage_open_data_root,
            storage::storage_list_folder,
            storage::storage_import_file,
            storage::storage_read_file_text,
            storage::storage_is_file,
            storage::storage_read_file_bytes,
            storage::storage_write_file_bytes,
            history::history_list,
            history::history_prune,
            history::history_clean,
            history::history_restore,
            history::history_open_folder,
            lan::lan_start,
            lan::lan_set_links,
            lan::lan_stop,
            lan::lan_status,
            frontend::frontend_file,
            deploy::deploy_write_files,
            deploy::deploy_host_key,
            deploy::deploy_run,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Fogwarden");
}
