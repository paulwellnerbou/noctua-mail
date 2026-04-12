// Prevents a console window from appearing on Windows in release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::Manager;

// Sidecar types and imports are only needed in release builds.
// In dev mode (`tauri dev`) Tauri loads devUrl directly — no sidecar is spawned.
#[cfg(not(debug_assertions))]
use std::net::TcpListener;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::{process::CommandChild, ShellExt};

/// Holds the Bun sidecar process so it stays alive for the duration of the app.
#[cfg(not(debug_assertions))]
struct ServerProcess(Mutex<Option<CommandChild>>);

/// Stores the sidecar server port so that the `open_detached_window` command
/// can resolve app-relative URLs to absolute `http://127.0.0.1:{port}/…` URLs.
struct ServerPort(Mutex<Option<u16>>);

/// Binds to a random port assigned by the OS, records it, then releases the
/// listener. There is a brief TOCTOU window before Bun binds the same port;
/// if the port is stolen, `wait_for_server` will time out and the error is
/// reported to the user.
#[cfg(not(debug_assertions))]
fn find_free_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("failed to bind to any port");
    listener.local_addr().unwrap().port()
}

/// Polls until a TCP connection to 127.0.0.1:{port} succeeds (server is up)
/// or the timeout is reached.
#[cfg(not(debug_assertions))]
fn wait_for_server(port: u16, timeout: std::time::Duration) -> bool {
    let deadline = std::time::Instant::now() + timeout;
    while std::time::Instant::now() < deadline {
        if std::net::TcpStream::connect(format!("127.0.0.1:{port}")).is_ok() {
            return true;
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }
    false
}

/// Resolves a URL for a new WebviewWindow. App-relative paths (e.g.
/// "/message/window?…") are turned into `WebviewUrl::External` pointing at the
/// local sidecar server. Fully-qualified http(s) URLs are passed through as
/// `WebviewUrl::External`. Unrecognised schemes (blob:, data:, etc.) are
/// rejected with an error.
fn resolve_webview_url(url: &str, server_port: Option<u16>) -> Result<tauri::WebviewUrl, String> {
    if url.starts_with("http://") || url.starts_with("https://") {
        tauri::Url::parse(url)
            .map(tauri::WebviewUrl::External)
            .map_err(|e| format!("Invalid URL \"{url}\": {e}"))
    } else if url.starts_with('/') || !url.contains("://") {
        // App-relative path — resolve against the local sidecar server.
        let port = server_port.ok_or_else(|| "Server port not available yet".to_string())?;
        let absolute = format!("http://127.0.0.1:{port}{}", if url.starts_with('/') { url.to_string() } else { format!("/{url}") });
        tauri::Url::parse(&absolute)
            .map(tauri::WebviewUrl::External)
            .map_err(|e| format!("Invalid resolved URL \"{absolute}\": {e}"))
    } else {
        Err(format!("Unsupported URL scheme: \"{url}\""))
    }
}

/// Opens a new detached WebView window (used instead of window.open which is
/// blocked in the Tauri WebView). Accepts app-relative paths (e.g.
/// "/message/window?messageId=...") or fully-qualified http(s) URLs.
#[tauri::command]
fn open_detached_window(
    app: tauri::AppHandle,
    label: String,
    url: String,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let port = app.state::<ServerPort>().0.lock().unwrap().to_owned();
    let webview_url = resolve_webview_url(&url, port)?;

    tauri::WebviewWindowBuilder::new(&app, label, webview_url)
        .title("Noctua Mail")
        .inner_size(f64::from(width), f64::from(height))
        .resizable(true)
        .build()
        .map_err(|e| format!("Failed to open window: {e}"))?;

    Ok(())
}

fn main() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![open_detached_window])
        .manage(ServerPort(Mutex::new(None)));

    // Only register ServerProcess state in release builds (sidecar is not used in dev)
    #[cfg(not(debug_assertions))]
    let builder = builder.manage(ServerProcess(Mutex::new(None)));

    builder
        .setup(|app| {
            #[cfg(not(debug_assertions))]
            {
                let port = find_free_port();

                // Store the port so open_detached_window can resolve relative URLs.
                *app.state::<ServerPort>().0.lock().unwrap() = Some(port);

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

                // Wait for the sidecar server in a background thread to avoid
                // blocking the main/event-loop thread during startup.
                let app_handle = app.handle().clone();
                std::thread::spawn(move || {
                    if !wait_for_server(port, std::time::Duration::from_secs(30)) {
                        eprintln!("[noctua] server did not become ready within 30s");
                    }
                    // Navigate the pre-created (but hidden) main window to the
                    // server URL, then show it.
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.navigate(
                            tauri::Url::parse(&format!("http://127.0.0.1:{port}/")).unwrap(),
                        );
                        let _ = window.show();
                    }
                });
            }

            // In dev mode the window is visible from the start (devUrl is loaded automatically).
            // Store the dev server port so open_detached_window can resolve relative URLs.
            #[cfg(debug_assertions)]
            {
                *app.state::<ServerPort>().0.lock().unwrap() = Some(3655);
                let window = app.get_webview_window("main").unwrap();
                window.show()?;
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Noctua Mail");
}
