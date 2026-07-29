// AI Agent OS — desktop shell (Tauri 2), "Hướng A": the shell supervises the
// local Next.js *standalone* server AND the worker, then points the WebView at
// the control plane.
//
// Why not a static export: this app has API routes, PostgreSQL access,
// server-side sessions and an SSE stream. `output: "export"` would delete all
// of that, so `.next/standalone` ships as a bundled resource and is executed.
//
// Fixes over the first scaffold:
//   * identity check — never adopt an unrelated server that owns the port
//   * dynamic port    — fall back when 3000 is taken by something else
//   * worker sidecar  — production mode enqueues only; without a worker no
//                       audit would ever run
//   * AUDIT_TARGET_ROOT — the auditor must scan a repository, not the bundle

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::{Emitter, Manager, State};

const APP_IDENTITY: &str = "ai-agent-os-control-plane";
const PREFERRED_PORT: u16 = 3000;

#[derive(Default)]
struct Supervised {
    server: Mutex<Option<Child>>,
    worker: Mutex<Option<Child>>,
    port: Mutex<u16>,
}

fn port_listening(port: u16) -> bool {
    let addr: SocketAddr = format!("127.0.0.1:{port}").parse().expect("addr");
    TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
}

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .unwrap_or(3111)
}

/// Minimal HTTP GET /api/health, so the shell can prove the listener really is
/// our control plane before attaching to it.
fn health_identity(port: u16) -> Option<String> {
    use std::io::Write;
    let addr: SocketAddr = format!("127.0.0.1:{port}").parse().ok()?;
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_millis(400)).ok()?;
    stream.set_read_timeout(Some(Duration::from_millis(1200))).ok()?;
    write!(
        stream,
        "GET /api/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )
    .ok()?;
    let mut body = String::new();
    for line in BufReader::new(stream).lines().map_while(Result::ok) {
        body.push_str(&line);
    }
    Some(body)
}

fn is_our_control_plane(port: u16) -> bool {
    health_identity(port)
        .map(|b| b.contains(APP_IDENTITY))
        .unwrap_or(false)
}

fn resource(app: &tauri::AppHandle, rel: &str) -> Option<PathBuf> {
    app.path()
        .resolve(rel, tauri::path::BaseDirectory::Resource)
        .ok()
}

fn app_mode() -> String {
    std::env::var("APP_MODE").unwrap_or_else(|_| "demo".into())
}

/// The repository the auditor should scan. Defaults to the user's selected
/// workspace; without it the auditor would scan its own packaged bundle.
fn audit_target_root(app: &tauri::AppHandle) -> String {
    if let Ok(explicit) = std::env::var("AUDIT_TARGET_ROOT") {
        return explicit;
    }
    app.path()
        .home_dir()
        .map(|h| h.join("AgentOS").join("workspace").to_string_lossy().to_string())
        .unwrap_or_else(|_| ".".into())
}

fn spawn_server(app: &tauri::AppHandle, port: u16) -> Option<Child> {
    let server_js = resource(app, "server/server.js")?;
    println!("[shell] starting control plane on :{port} → {server_js:?}");
    Command::new("node")
        .arg(&server_js)
        .current_dir(server_js.parent()?)
        .env("PORT", port.to_string())
        .env("HOSTNAME", "127.0.0.1")
        .env("NODE_ENV", "production")
        .env("APP_MODE", app_mode())
        .env("AUDIT_TARGET_ROOT", audit_target_root(app))
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .ok()
}

/// In production the dashboard only enqueues — without this sidecar no audit
/// or job would ever be executed.
fn spawn_worker(app: &tauri::AppHandle) -> Option<Child> {
    if app_mode() != "production" {
        println!("[shell] demo mode: no worker sidecar (inline engine owns the queue)");
        return None;
    }
    let worker = resource(app, "server/worker/index.js")?;
    println!("[shell] starting worker sidecar → {worker:?}");
    Command::new("node")
        .arg(&worker)
        .current_dir(worker.parent()?.parent()?)
        .env("NODE_ENV", "production")
        .env("APP_MODE", "production")
        .env("AUDIT_TARGET_ROOT", audit_target_root(app))
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .ok()
}

#[tauri::command]
fn system_status(state: State<Supervised>) -> serde_json::Value {
    let port = *state.port.lock().expect("lock");
    serde_json::json!({
        "shell": "tauri",
        "controlPlaneUrl": format!("http://127.0.0.1:{port}"),
        "port": port,
        "listening": port_listening(port),
        "identityVerified": is_our_control_plane(port),
        "mode": app_mode(),
        "workerSupervised": state.worker.lock().expect("lock").is_some(),
    })
}

#[tauri::command]
fn restart_backend(app: tauri::AppHandle, state: State<Supervised>) -> bool {
    for slot in [&state.server, &state.worker] {
        if let Some(mut child) = slot.lock().expect("lock").take() {
            let _ = child.kill();
        }
    }
    let port = *state.port.lock().expect("lock");
    let server = spawn_server(&app, port);
    let ok = server.is_some();
    *state.server.lock().expect("lock") = server;
    *state.worker.lock().expect("lock") = spawn_worker(&app);
    ok
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Supervised::default())
        .invoke_handler(tauri::generate_handler![system_status, restart_backend])
        .setup(|app| {
            let handle = app.handle().clone();
            let state = app.state::<Supervised>();

            // Decide the port: reuse :3000 only when OUR control plane answers
            // there; if a foreign process owns it, take a free port instead.
            let port = if port_listening(PREFERRED_PORT) {
                if is_our_control_plane(PREFERRED_PORT) {
                    println!("[shell] attaching to existing AI Agent OS on :{PREFERRED_PORT}");
                    PREFERRED_PORT
                } else {
                    let p = free_port();
                    println!("[shell] :{PREFERRED_PORT} is owned by another app — using :{p}");
                    p
                }
            } else {
                PREFERRED_PORT
            };
            *state.port.lock().expect("lock") = port;

            let already_ours = port == PREFERRED_PORT && is_our_control_plane(PREFERRED_PORT);
            if !already_ours {
                *state.server.lock().expect("lock") = spawn_server(&handle, port);
                *state.worker.lock().expect("lock") = spawn_worker(&handle);
            }

            // Reveal the window only once the healthcheck confirms identity,
            // so users never see connection-refused or a foreign app.
            thread::spawn(move || {
                let deadline = Instant::now() + Duration::from_secs(60);
                while Instant::now() < deadline {
                    if is_our_control_plane(port) {
                        if let Some(win) = handle.get_webview_window("main") {
                            let _ = win.eval(&format!(
                                "if (location.origin !== 'http://127.0.0.1:{port}') location.replace('http://127.0.0.1:{port}')"
                            ));
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                        let _ = handle.emit("control-plane-ready", port);
                        return;
                    }
                    thread::sleep(Duration::from_millis(400));
                }
                if let Some(win) = handle.get_webview_window("main") {
                    let _ = win.show();
                }
                let _ = handle.emit("control-plane-timeout", port);
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let state = window.state::<Supervised>();
                for slot in [&state.server, &state.worker] {
                    if let Some(mut child) = slot.lock().expect("lock").take() {
                        let _ = child.kill();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running AI Agent OS desktop shell");
}
