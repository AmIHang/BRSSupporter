#[cfg(not(debug_assertions))]
mod daemon;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|_app| {
            // Installed app: start the bundled daemon unless it already runs. `tauri dev` uses the
            // daemon started by hand (see README).
            #[cfg(not(debug_assertions))]
            {
                let app = _app.handle().clone();
                std::thread::spawn(move || {
                    if let Err(e) = daemon::ensure_running(&app) {
                        eprintln!("BRSSupporter daemon: {e}");
                    }
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running BRSSupporter");
}
