mod deploy;
mod frontend;
mod lan;
mod storage;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(lan::LanState::default())
        .setup(|app| {
            storage::init(app.handle())?;
            Ok(())
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
            storage::storage_read_file_bytes,
            storage::storage_write_file_bytes,
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
