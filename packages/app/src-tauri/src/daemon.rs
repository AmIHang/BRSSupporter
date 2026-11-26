//! Starting the bundled BRSSupporter daemon (as in BRSOrganizer, without its token handling).
//!
//! The daemon runs detached: BSM/OTMA keep syncing when the app window is closed. The app only
//! starts it when nothing healthy answers on its port.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Duration;

use tauri::{AppHandle, Manager};

/// Fixed port: the web UI (src/lib/api.ts) talks to it directly.
const PORT: u16 = 47910;
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;

/// `GET /api/health` must answer with our app name (a foreign program on the port does not count).
fn is_healthy() -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], PORT));
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(500)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let request =
        format!("GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut response = String::new();
    let _ = stream.read_to_string(&mut response);
    response.starts_with("HTTP/1.1 200") && response.contains("\"app\":\"BRSSupporter\"")
}

/// Tauri returns verbatim paths (`\\?\C:\...`); Node cannot resolve a main script given that way.
fn plain_path(path: PathBuf) -> PathBuf {
    let s = path.to_string_lossy();
    match s.strip_prefix(r"\\?\") {
        Some(rest) if rest.as_bytes().get(1) == Some(&b':') => PathBuf::from(rest),
        _ => path,
    }
}

fn data_dir() -> PathBuf {
    let base = std::env::var("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(|_| {
        PathBuf::from(std::env::var("USERPROFILE").unwrap_or_default()).join("AppData\\Local")
    });
    base.join("BRSSupporter")
}

/// Starts the daemon unless it already runs. Errors are for the log only: the UI then shows
/// "Daemon nicht erreichbar".
pub fn ensure_running(app: &AppHandle) -> Result<(), String> {
    if is_healthy() {
        return Ok(());
    }
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| plain_path(d.to_path_buf())))
        .ok_or("cannot locate the app folder")?;
    let node = exe_dir.join("brssupporter-node.exe");
    let runtime = plain_path(app.path().resource_dir().map_err(|e| e.to_string())?).join("runtime");
    let script = runtime.join("daemon.mjs");
    if !node.exists() || !script.exists() {
        return Err(format!("bundled daemon not found ({})", script.display()));
    }

    // Early crashes (before the daemon logs anything) end up here instead of nowhere.
    let logs = data_dir().join("logs");
    let _ = std::fs::create_dir_all(&logs);
    let log = std::fs::File::create(logs.join("daemon.log"))
        .map_err(|e| format!("cannot create daemon log: {e}"))?;
    let log_err = log.try_clone().map_err(|e| e.to_string())?;

    Command::new(&node)
        .arg(&script)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err))
        .env("BRSSUPPORTER_VERSION", app.package_info().version.to_string())
        .env("BRSSUPPORTER_MIGRATIONS", runtime.join("drizzle"))
        .creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP)
        // Not kept: the daemon outlives the app.
        .spawn()
        .map_err(|e| format!("failed to start daemon: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::plain_path;
    use std::path::PathBuf;

    #[test]
    fn strips_verbatim_prefix_from_drive_paths_only() {
        assert_eq!(
            plain_path(PathBuf::from(r"\\?\C:\Apps\BRSSupporter")),
            PathBuf::from(r"C:\Apps\BRSSupporter")
        );
        assert_eq!(
            plain_path(PathBuf::from(r"\\?\UNC\server\share")),
            PathBuf::from(r"\\?\UNC\server\share")
        );
    }
}
