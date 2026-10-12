//! Files of the built frontend (`dist/`): served by the LAN server, uploaded
//! to the relay server.

use tauri::ipc::Response;
use tauri::AppHandle;

/// File of the built frontend by '/'-separated path below `dist/`.
// Release builds embed dist/ in the executable. Dev builds (devUrl set)
// embed nothing and Tauri reads ../dist from disk: run `pnpm build` first.
pub fn read(app: &AppHandle, path: &str) -> Option<(Vec<u8>, String)> {
    app.asset_resolver()
        .get(path.to_owned())
        .map(|asset| (asset.bytes, asset.mime_type))
}

pub fn missing(path: &str) -> String {
    format!("{path} is missing from the built frontend; run `pnpm build`")
}

/// Raw bytes of a built frontend file, e.g. the player bundle for the relay.
#[tauri::command]
pub async fn frontend_file(app: AppHandle, path: String) -> Result<Response, String> {
    read(&app, &path)
        .map(|(bytes, _)| Response::new(bytes))
        .ok_or_else(|| missing(&path))
}
