// shortcut: the daemon is started by hand (see README); start it as a sidecar like BRSOrganizer
// once the app is installed for real.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running BRSSupporter");
}
