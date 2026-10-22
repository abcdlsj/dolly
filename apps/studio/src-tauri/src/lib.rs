// The native half of Studio. It owns what the web view must not: the agent
// processes, the API key in the system keychain, the `dolly` sidecar, the
// menu bar icon and the windows. The web view calls these commands and hears
// back through the `pi-line` and `pi-exit` events.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::time::Instant;

use serde::Serialize;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, State, WindowEvent};

const KEYCHAIN: &str = "Dolly Studio";

#[derive(Default)]
struct Agents(Mutex<HashMap<String, Agent>>);

struct Agent {
    child: Child,
    stdin: ChildStdin,
    /// Tells a restarted film's new agent from the one it replaced.
    generation: u64,
}

static GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

#[derive(Clone, Serialize)]
struct Line {
    id: String,
    line: String,
}

#[derive(Clone, Serialize)]
struct Exit {
    id: String,
    code: Option<i32>,
}

/// The environment variable each provider's key goes in.
fn key_variable(provider: &str) -> &'static str {
    match provider {
        "openai" | "custom" => "OPENAI_API_KEY",
        "openrouter" => "OPENROUTER_API_KEY",
        _ => "ANTHROPIC_API_KEY",
    }
}

fn secret(provider: &str) -> Option<String> {
    keyring::Entry::new(KEYCHAIN, provider).ok()?.get_password().ok()
}

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default()
}

fn expand(path: &str) -> PathBuf {
    match path.strip_prefix("~/") {
        Some(rest) => home().join(rest),
        None => PathBuf::from(path),
    }
}

/// Apps launched from Finder get a bare PATH, so look where pi is usually installed too.
fn search_path(sidecar_dir: &Path) -> String {
    let mut dirs = vec![sidecar_dir.to_path_buf()];
    dirs.extend(["/opt/homebrew/bin", "/usr/local/bin"].map(PathBuf::from));
    dirs.extend([".bun/bin", ".npm-global/bin", ".local/bin", ".volta/bin"].map(|dir| home().join(dir)));
    if let Some(path) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&path));
    }
    std::env::join_paths(dirs).map(|joined| joined.to_string_lossy().into_owned()).unwrap_or_default()
}

fn find_on(path: &str, name: &str) -> Option<PathBuf> {
    std::env::split_paths(path).map(|dir| dir.join(name)).find(|candidate| candidate.is_file())
}

/// The bundled `dolly` sits next to the Studio executable.
fn sidecar_dir() -> PathBuf {
    std::env::current_exe().ok().and_then(|exe| exe.parent().map(Path::to_path_buf)).unwrap_or_default()
}

#[tauri::command]
fn pi_start(app: AppHandle, agents: State<Agents>, id: String, args: Vec<String>, provider: String) -> Result<(), String> {
    let path = search_path(&sidecar_dir());
    let pi = find_on(&path, "pi").ok_or("pi is not installed. Install it with: npm install -g @mariozechner/pi-coding-agent")?;
    let mut command = Command::new(pi);
    command.args(&args).env("PATH", &path).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    if let Some(key) = secret(&provider) {
        command.env(key_variable(&provider), key);
    }
    let mut child = command.spawn().map_err(|error| format!("could not start pi: {error}"))?;
    let stdin = child.stdin.take().ok_or("pi has no stdin")?;
    let stdout = child.stdout.take().ok_or("pi has no stdout")?;

    let mut agents = agents.0.lock().map_err(|_| "agents lock poisoned")?;
    if let Some(mut old) = agents.remove(&id) {
        let _ = old.child.kill();
    }
    let generation = GENERATION.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    agents.insert(id.clone(), Agent { child, stdin, generation });
    drop(agents);

    std::thread::spawn(move || {
        // pi frames records with \n only; a record may hold U+2028, which lines() keeps intact.
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let _ = app.emit("pi-line", Line { id: id.clone(), line });
        }
        let agent = app.state::<Agents>().0.lock().ok().and_then(|mut agents| {
            let current = agents.get(&id).is_some_and(|agent| agent.generation == generation);
            if current { agents.remove(&id) } else { None }
        });
        // An agent replaced by a restart exits quietly, so the new one keeps its listeners.
        let Some(mut agent) = agent else { return };
        let code = agent.child.wait().ok().and_then(|status| status.code());
        let _ = app.emit("pi-exit", Exit { id, code });
    });
    Ok(())
}

#[tauri::command]
fn pi_send(agents: State<Agents>, id: String, line: String) -> Result<(), String> {
    let mut agents = agents.0.lock().map_err(|_| "agents lock poisoned")?;
    let agent = agents.get_mut(&id).ok_or("that film has no agent running")?;
    agent.stdin.write_all(line.as_bytes()).and_then(|_| agent.stdin.write_all(b"\n")).and_then(|_| agent.stdin.flush()).map_err(|error| error.to_string())
}

#[tauri::command]
fn pi_kill(agents: State<Agents>, id: String) {
    if let Ok(mut agents) = agents.0.lock() {
        if let Some(agent) = agents.get_mut(&id) {
            let _ = agent.child.kill();
        }
    }
}

#[derive(Serialize)]
struct AgentPaths {
    skill: String,
    extension: String,
    sessions: String,
}

#[tauri::command]
fn agent_paths(app: AppHandle) -> Result<AgentPaths, String> {
    let resources = app.path().resource_dir().map_err(|error| error.to_string())?;
    let sessions = app.path().app_data_dir().map_err(|error| error.to_string())?.join("sessions");
    std::fs::create_dir_all(&sessions).map_err(|error| error.to_string())?;
    Ok(AgentPaths {
        skill: resources.join("skills/dolly").to_string_lossy().into_owned(),
        extension: resources.join("agent/studio-extension.ts").to_string_lossy().into_owned(),
        sessions: sessions.to_string_lossy().into_owned(),
    })
}

/// Stores the key in the keychain and returns its last four characters for display.
#[tauri::command]
fn secret_set(provider: String, key: String) -> Result<String, String> {
    keyring::Entry::new(KEYCHAIN, &provider).and_then(|entry| entry.set_password(&key)).map_err(|error| error.to_string())?;
    Ok(key.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect())
}

#[derive(Serialize)]
struct Check {
    ok: bool,
    ms: u128,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/// Lists the provider's models with the stored key. The key goes to curl on stdin, never in argv.
#[tauri::command]
async fn provider_check(provider: String) -> Check {
    let Some(key) = secret(&provider) else {
        return Check { ok: false, ms: 0, error: Some("No key yet".into()) };
    };
    let (url, header) = match provider.as_str() {
        "openai" => ("https://api.openai.com/v1/models", format!("Authorization: Bearer {key}")),
        "openrouter" => ("https://openrouter.ai/api/v1/models", format!("Authorization: Bearer {key}")),
        "custom" => return Check { ok: true, ms: 0, error: None },
        _ => ("https://api.anthropic.com/v1/models", format!("x-api-key: {key}\nanthropic-version: 2023-06-01")),
    };
    let started = Instant::now();
    let run = || -> std::io::Result<String> {
        let mut child = Command::new("curl")
            .args(["-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "10", "-H", "@-", url])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()?;
        child.stdin.take().map(|mut stdin| stdin.write_all(header.as_bytes()));
        let output = child.wait_with_output()?;
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    };
    let result = run();
    let ms = started.elapsed().as_millis();
    match result {
        Ok(status) if status == "200" => Check { ok: true, ms, error: None },
        Ok(status) if status == "401" || status == "403" => Check { ok: false, ms, error: Some("Key not accepted".into()) },
        Ok(status) if status == "000" => Check { ok: false, ms, error: Some("No connection".into()) },
        Ok(status) => Check { ok: false, ms, error: Some(format!("Error {status}")) },
        Err(error) => Check { ok: false, ms, error: Some(error.to_string()) },
    }
}

/// Runs the bundled `dolly` with argv and returns the one JSON object it prints.
#[tauri::command]
async fn dolly(argv: Vec<String>) -> Result<serde_json::Value, String> {
    let dir = sidecar_dir();
    let binary = find_on(&search_path(&dir), "dolly").ok_or("dolly is missing from the app bundle")?;
    let output = Command::new(binary).args(&argv).output().map_err(|error| error.to_string())?;
    serde_json::from_slice(&output.stdout).map_err(|error| format!("dolly printed no JSON: {error}"))
}

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

#[tauri::command]
fn screen_access() -> bool {
    #[cfg(target_os = "macos")]
    return unsafe { CGPreflightScreenCaptureAccess() };
    #[cfg(not(target_os = "macos"))]
    true
}

#[tauri::command]
fn open_permission_settings(kind: String) {
    #[cfg(target_os = "macos")]
    {
        let pane = if kind == "screen" {
            unsafe { CGRequestScreenCaptureAccess() };
            "Privacy_ScreenCapture"
        } else {
            "Privacy_Accessibility"
        };
        let _ = Command::new("open").arg(format!("x-apple.systempreferences:com.apple.preference.security?{pane}")).spawn();
    }
    #[cfg(not(target_os = "macos"))]
    let _ = kind;
}

#[derive(Serialize)]
struct InstalledApp {
    name: String,
    path: String,
    version: String,
}

fn read_app(path: &Path) -> Option<InstalledApp> {
    let info = plist::Value::from_file(path.join("Contents/Info.plist")).ok()?;
    let info = info.as_dictionary()?;
    let text = |key: &str| info.get(key).and_then(|value| value.as_string()).map(str::to_owned);
    let name = text("CFBundleDisplayName").or_else(|| text("CFBundleName")).or_else(|| path.file_stem().map(|stem| stem.to_string_lossy().into_owned()))?;
    Some(InstalledApp { name, path: path.to_string_lossy().into_owned(), version: text("CFBundleShortVersionString").unwrap_or_default() })
}

#[tauri::command]
async fn installed_apps() -> Vec<InstalledApp> {
    let mut apps: Vec<InstalledApp> = [PathBuf::from("/Applications"), home().join("Applications")]
        .iter()
        .filter_map(|dir| std::fs::read_dir(dir).ok())
        .flatten()
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|extension| extension == "app"))
        .filter_map(|path| read_app(&path))
        .collect();
    apps.sort_by_key(|app| app.name.to_lowercase());
    apps
}

#[tauri::command]
async fn choose_app() -> Option<InstalledApp> {
    let output = Command::new("osascript").args(["-e", "POSIX path of (choose application with prompt \"Choose the app to film\" as alias)"]).output().ok()?;
    let path = String::from_utf8_lossy(&output.stdout).trim().trim_end_matches('/').to_owned();
    if path.is_empty() {
        return None;
    }
    read_app(Path::new(&path))
}

#[tauri::command]
fn reveal(path: String) {
    let _ = Command::new("open").arg("-R").arg(expand(&path)).spawn();
}

#[tauri::command]
fn tray_title(app: AppHandle, title: String) {
    if let Some(tray) = app.tray_by_id("dolly") {
        let _ = tray.set_title(if title.is_empty() { None } else { Some(title) });
    }
}

#[tauri::command]
fn show_window(app: AppHandle, label: String) {
    let Some(window) = app.get_webview_window(&label) else { return };
    if label == "glance" {
        // Bottom right of the screen the person is on.
        if let (Ok(Some(monitor)), Ok(size)) = (window.current_monitor(), window.outer_size()) {
            let area = monitor.size();
            let margin = (20.0 * monitor.scale_factor()) as i32;
            let _ = window.set_position(PhysicalPosition::new(area.width as i32 - size.width as i32 - margin, area.height as i32 - size.height as i32 - margin));
        }
        let _ = window.show();
        return;
    }
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

#[tauri::command]
fn hide_window(app: AppHandle, label: String) {
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.hide();
    }
}

#[tauri::command]
fn quit(app: AppHandle, agents: State<Agents>) {
    if let Ok(mut agents) = agents.0.lock() {
        for agent in agents.values_mut() {
            let _ = agent.child.kill();
        }
    }
    app.exit(0);
}

/// Shows the menu bar panel under the icon, or hides it if it is open.
fn toggle_tray(app: &AppHandle, x: f64, y: f64) {
    let Some(window) = app.get_webview_window("tray") else { return };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        return;
    }
    let width = window.outer_size().map(|size| size.width as f64).unwrap_or(320.0);
    let _ = window.set_position(PhysicalPosition::new(x - width / 2.0, y));
    let _ = window.show();
    let _ = window.set_focus();
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .manage(Agents::default())
        .invoke_handler(tauri::generate_handler![
            pi_start,
            pi_send,
            pi_kill,
            agent_paths,
            secret_set,
            provider_check,
            dolly,
            screen_access,
            open_permission_settings,
            installed_apps,
            choose_app,
            reveal,
            tray_title,
            show_window,
            hide_window,
            quit
        ])
        .setup(|app| {
            let open = MenuItem::with_id(app, "open", "Open Dolly", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit Dolly", true, Some("CmdOrCtrl+Q"))?;
            let menu = Menu::with_items(app, &[&open, &quit_item])?;
            TrayIconBuilder::with_id("dolly")
                .icon(tauri::include_image!("icons/tray.png"))
                .icon_as_template(true)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_window(app.clone(), "main".into()),
                    "quit" => quit(app.clone(), app.state::<Agents>()),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, rect, .. } = event {
                        let position = rect.position.to_physical::<f64>(1.0);
                        let size = rect.size.to_physical::<f64>(1.0);
                        toggle_tray(tray.app_handle(), position.x + size.width / 2.0, position.y + size.height + 4.0);
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| match event {
            // Closing a window hides it; Dolly keeps filming from the menu bar.
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            WindowEvent::Focused(false) if window.label() == "tray" => {
                let _ = window.hide();
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running Dolly Studio");
}
