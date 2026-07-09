//! The Local Mail desktop shell.
//!
//! This shell is the smallest native wrapper around the existing Bun mail
//! engine (`local-mail app`). It owns exactly two things: the window, and the
//! lifetime of the child engine process. It does NOT own Gmail OAuth, token
//! refresh, sync, the SQLite mirror, or the loopback API bearer; those all stay
//! in Bun end to end (ADR-0116). The engine already serves the triage SPA and a
//! same-origin `/api` on `127.0.0.1` and injects the per-launch bearer into the
//! HTML it serves, so the shell only has to point a webview at that origin.
//!
//! Startup, end to end (the ADR-0084 sidecar recipe):
//!
//! 1. `setup()` spawns `bun src/bin.ts app` from the engine's package dir.
//! 2. The engine prints exactly one line to stdout, the loopback origin it now
//!    serves (`http://127.0.0.1:<port>`), and prints it only after the server
//!    is listening. That line is both the discovery signal (which port) and the
//!    readiness signal (it is up), so no separate health poll is needed.
//! 3. On that line, the shell opens a `WebviewUrl::External` window at the
//!    origin. Tauri does not inject its CSP into external pages, so the engine's
//!    own response headers (frame-deny, `no-store`, CSP) remain the security
//!    boundary; the shell adds nothing and subtracts nothing.
//! 4. On app exit (Cmd+Q, or closing the window), the shell kills the engine so
//!    it never outlives the window. ADR-0116: the mirror syncs only while the
//!    app is open; there is no background mail service.
//!
//! The webview never calls `invoke()` (it talks only to its own same-origin
//! `/api` over HTTP), so the shell registers no commands and needs no remote-IPC
//! allowlist. The bearer never transits Rust.

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};

/// The spawned Bun mail engine, held so the shell can kill it on exit. `None`
/// until the engine spawns, and taken (leaving `None`) when it is killed.
struct EngineProcess(Mutex<Option<Child>>);

/// The Local Mail package directory (the parent of `src-tauri`), resolved at
/// compile time so the spawned `bun src/bin.ts app` runs from the engine's
/// package root and finds `ui/dist` on disk. This is the dev/source launch
/// path. A distributable bundle must ship the engine as a compiled sidecar and
/// spawn that instead (see `src-tauri/README.md`); that is the packaging wave,
/// not wired here.
fn engine_package_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri always has a parent package dir")
        .to_path_buf()
}

/// Spawn the Bun mail engine with its stdout piped (so the shell can read the
/// printed origin) and its stderr inherited (so the engine's sync/gmail logs
/// stay visible in the terminal running `tauri dev`).
fn spawn_engine() -> std::io::Result<Child> {
    Command::new("bun")
        .args(["src/bin.ts", "app"])
        .current_dir(engine_package_dir())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
}

/// Kill the engine if it is still held. SIGKILL is safe by the engine's design:
/// its per-account sync lock is an fcntl lock the kernel releases on process
/// death, and its presence file is stale-safe (it just names a dead port), so a
/// hard kill leaves no corrupt state (ADR-0116).
fn kill_engine(app: &tauri::AppHandle) {
    if let Some(mut child) = app.state::<EngineProcess>().0.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(EngineProcess(Mutex::new(None)))
        .setup(|app| {
            let mut child = match spawn_engine() {
                Ok(child) => child,
                Err(err) => {
                    eprintln!(
                        "[local-mail shell] failed to spawn the mail engine (`bun src/bin.ts app`): {err}. Is `bun` on PATH?"
                    );
                    return Ok(());
                }
            };

            let stdout = child
                .stdout
                .take()
                .expect("engine stdout was piped in spawn_engine");
            app.state::<EngineProcess>().0.lock().unwrap().replace(child);

            // setup() is synchronous, so read the engine's stdout on a
            // background thread and open the window on the main thread once the
            // origin line arrives.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                for line in BufReader::new(stdout).lines() {
                    let Ok(line) = line else { break };
                    let origin = line.trim();
                    // The engine prints only the origin to stdout, but skip any
                    // other line defensively rather than trusting line 1.
                    if !origin.starts_with("http://127.0.0.1:") {
                        continue;
                    }
                    let origin = origin.to_string();
                    let handle = handle.clone();
                    let _ = handle.clone().run_on_main_thread(move || {
                        open_window(&handle, &origin);
                    });
                    break;
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the Local Mail shell")
        .run(|app, event| {
            // Cmd+Q and `app.exit()` (see `open_window`'s close handler) both
            // reach here; kill the engine so it never outlives the window.
            if let RunEvent::Exit = event {
                kill_engine(app);
            }
        });
}

/// Open the single "main" window pointed at the engine's external origin, and
/// make closing it quit the app (so the engine is killed via `RunEvent::Exit`,
/// including on macOS where a closed window would otherwise keep the app alive).
fn open_window(handle: &tauri::AppHandle, origin: &str) {
    let url = match origin.parse() {
        Ok(url) => url,
        Err(err) => {
            eprintln!("[local-mail shell] engine printed an unparseable origin {origin:?}: {err}");
            return;
        }
    };
    let window = WebviewWindowBuilder::new(handle, "main", WebviewUrl::External(url))
        .title("Local Mail")
        .inner_size(1200.0, 820.0)
        .min_inner_size(760.0, 520.0)
        .build();
    match window {
        Ok(window) => {
            let quit_handle = handle.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { .. } = event {
                    quit_handle.exit(0);
                }
            });
        }
        Err(err) => {
            eprintln!("[local-mail shell] failed to open the window at {origin}: {err}");
        }
    }
}
