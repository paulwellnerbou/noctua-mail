// Prevents a console window from appearing on Windows in release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

// Sidecar types and imports are only needed in release builds.
// In dev mode (`tauri dev`) Tauri loads devUrl directly — no sidecar is spawned.
#[cfg(not(debug_assertions))]
use std::net::TcpListener;
#[cfg(not(debug_assertions))]
use std::sync::Mutex;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::{process::CommandChild, ShellExt};

/// Holds the Bun sidecar process so it stays alive for the duration of the app.
#[cfg(not(debug_assertions))]
struct ServerProcess(Mutex<Option<CommandChild>>);

/// Binds to a random port assigned by the OS, records it, then releases the
/// listener. There is a brief race window before Bun binds the same port, but
/// in practice this is not an issue on loopback.
#[cfg(not(debug_assertions))]
fn find_free_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("failed to bind to any port");
    listener.local_addr().unwrap().port()
}

/// Polls until a TCP connection to 127.0.0.1:{port} succeeds (server is up)
/// or the 30-second timeout is reached.
#[cfg(not(debug_assertions))]
fn wait_for_server(port: u16) -> bool {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    while std::time::Instant::now() < deadline {
        if std::net::TcpStream::connect(format!("127.0.0.1:{port}")).is_ok() {
            return true;
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }
    false
}

/// Opens a new detached WebView window (used instead of window.open which is
/// blocked in the Tauri WebView). The URL is an app-relative path, e.g.
/// "/message/window?messageId=...".
#[tauri::command]
fn open_detached_window(app: tauri::AppHandle, label: String, url: String, width: u32, height: u32) {
    // WebviewUrl::App expects a relative path without leading slash.
    let relative = url.trim_start_matches('/').to_string();
    let _ = tauri::WebviewWindowBuilder::new(
        &app,
        label,
        tauri::WebviewUrl::App(relative.into()),
    )
    .title("Noctua Mail")
    .inner_size(f64::from(width), f64::from(height))
    .resizable(true)
    .build();
}

fn main() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![open_detached_window]);

    // Only register ServerProcess state in release builds (sidecar is not used in dev)
    #[cfg(not(debug_assertions))]
    let builder = builder.manage(ServerProcess(Mutex::new(None)));

    builder
        .setup(|app| {
            #[cfg(not(debug_assertions))]
            {
                let port = find_free_port();

                // Resolve the Next.js standalone server.js from the bundle's resource dir.
                // build-desktop.sh copies .next/standalone → <Resources>/standalone/
                let resource_dir = app.path().resource_dir()?;
                let server_js = resource_dir.join("standalone").join("server.js");

                // Resolve the OS-appropriate data directory for this app.
                // On macOS: ~/Library/Application Support/com.noctuamail.app
                // On Linux: ~/.local/share/com.noctuamail.app
                // On Windows: %APPDATA%\com.noctuamail.app
                let data_dir = app.path().app_data_dir()?;

                // Spawn the Bun sidecar with the Next.js server
                let (child, _events) = app
                    .shell()
                    .sidecar("bun")?
                    .args([server_js.to_str().unwrap()])
                    .env("PORT", port.to_string())
                    .env("HOSTNAME", "127.0.0.1")
                    .env("NODE_ENV", "production")
                    .env("APP_ENV_LABEL", "Desktop")
                    // Desktop-specific behaviour: skip invite codes on signup,
                    // and store IMAP credentials in the local DB by default.
                    .env("NOCTUA_DESKTOP_MODE", "true")
                    .env("IMAP_CREDENTIALS_STORAGE", "db")
                    // Store all user data in the OS-appropriate app data directory.
                    .env("NOCTUA_DATA_DIR", data_dir.to_str().unwrap_or(""))
                    .spawn()?;

                // Keep the child alive in app state (dropping it would kill the process)
                *app.state::<ServerProcess>().0.lock().unwrap() = Some(child);

                // Block until the server accepts connections (or time out)
                if !wait_for_server(port) {
                    eprintln!("[noctua] server did not become ready within 30s");
                }

                // Navigate the pre-created (but hidden) main window to the server URL,
                // then show it.
                let window = app.get_webview_window("main").unwrap();
                window.navigate(
                    tauri::Url::parse(&format!("http://127.0.0.1:{port}/")).unwrap(),
                )?;
                window.show()?;
            }

            // In dev mode the window is visible from the start (devUrl is loaded automatically)
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.show()?;
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Noctua Mail");
}
