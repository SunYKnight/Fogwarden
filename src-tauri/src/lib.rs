mod lan;
mod storage;

pub fn run() {
    tauri::Builder::default()
        .manage(lan::LanState::default())
        .setup(|app| {
            storage::init(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            storage::storage_roots,
            storage::storage_set_data_root,
            storage::storage_read_text,
            storage::storage_write_text,
            storage::storage_write_bytes,
            storage::storage_list,
            storage::storage_exists,
            storage::storage_remove,
            storage::storage_asset_path,
            storage::storage_copy,
            lan::lan_start,
            lan::lan_stop,
            lan::lan_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the DM tool");
}
