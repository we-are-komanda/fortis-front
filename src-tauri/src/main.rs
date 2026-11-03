#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    io::{BufRead, BufReader},
    net::TcpListener,
    process::{Child, Command, Stdio},
    sync::{mpsc, Mutex},
    time::Duration,
};
use tauri::Manager;

const PORT: u16 = 43178;
struct LocalServer(Mutex<Option<Child>>);
impl Drop for LocalServer {
    fn drop(&mut self) {
        if let Ok(child) = self.0.get_mut() {
            if let Some(child) = child.as_mut() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

fn launch(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    // ponytail: one stable loopback port preserves local drafts; add single-instance activation if needed.
    let reservation = TcpListener::bind(("127.0.0.1", PORT))?;
    let resources = app.path().resource_dir()?;
    let server = resources.join("server");
    let mut command = Command::new(resources.join(if cfg!(target_os = "macos") {
        "node-macos"
    } else {
        "node.exe"
    }));
    command.env_clear();
    for key in [
        "HOME",
        "TMPDIR",
        "PATH",
        "SYSTEMROOT",
        "WINDIR",
        "TEMP",
        "TMP",
        "LOCALAPPDATA",
        "APPDATA",
        "USERPROFILE",
    ] {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
    command
        .current_dir(server.join("app"))
        .args(["--require", "../lifecycle.cjs", "server.js"])
        .env("NODE_ENV", "production")
        .env("HOSTNAME", "127.0.0.1")
        .env("PORT", PORT.to_string())
        .env("FORTIS_RUNTIME_MODE", "demo")
        .env("FORTIS_LOCAL_DRAFTS_ENABLED", "true")
        .env("NEXT_TELEMETRY_DISABLED", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    drop(reservation);
    let mut child = command.spawn()?;
    let output = child.stdout.take().ok_or("Missing local server output")?;
    *app.state::<LocalServer>().0.lock().unwrap() = Some(child);
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(output).lines().map_while(Result::ok) {
            if line == "FORTIS_READY" {
                let _ = tx.send(());
            }
        }
    });
    rx.recv_timeout(Duration::from_secs(65))?;
    let window = app.get_webview_window("main").ok_or("Missing window")?;
    window.navigate(format!("http://127.0.0.1:{PORT}/").parse()?)?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(LocalServer(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                if let Err(error) = launch(&handle) {
                    eprintln!("Fortis startup: {error}");
                    if let Some(window) = handle.get_webview_window("main") {
                        let _ = window.eval("document.getElementById('status').textContent = 'Не удалось запустить Fortis. Закройте другую копию приложения и повторите запуск. Если ошибка повторяется, переустановите приложение.'");
                    }
                    if let Some(mut child) = handle.state::<LocalServer>().0.lock().unwrap().take() {
                        let _ = child.kill(); let _ = child.wait();
                    }
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Failed to build Fortis window")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                if let Some(mut child) = app.state::<LocalServer>().0.lock().unwrap().take() {
                    let _ = child.kill(); let _ = child.wait();
                }
            }
        });
}
