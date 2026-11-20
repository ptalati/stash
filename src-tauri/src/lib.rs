mod paste;
mod store;

use std::sync::atomic::{AtomicIsize, Ordering};
use store::{Snippet, Store};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// The window that had focus right before the palette opened; paste goes back there.
struct PrevWindow(AtomicIsize);

fn palette(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.get_webview_window("palette")
}

fn hide(app: &AppHandle) {
    if let Some(w) = palette(app) {
        let _ = w.hide();
    }
}

/// Show the palette on the monitor under the mouse, horizontally centred, a
/// quarter of the way down — near where the user is working.
fn show(app: &AppHandle) {
    let Some(w) = palette(app) else { return };
    app.state::<PrevWindow>().0.store(paste::platform::foreground(), Ordering::SeqCst);

    if let Ok(cursor) = app.cursor_position() {
        if let Ok(Some(m)) = app.monitor_from_point(cursor.x, cursor.y) {
            let (mp, ms) = (m.position(), m.size());
            let ws = w.outer_size().unwrap_or_default();
            let x = mp.x + (ms.width as i32 - ws.width as i32) / 2;
            let y = mp.y + ms.height as i32 / 4;
            let _ = w.set_position(PhysicalPosition::new(x, y));
        }
    }
    let _ = w.show();
    let _ = w.set_focus();
    let _ = w.emit("palette-opened", ());
}

fn toggle(app: &AppHandle) {
    match palette(app) {
        Some(w) if w.is_visible().unwrap_or(false) => hide(app),
        _ => show(app),
    }
}

/// Open (or focus) the manager window, optionally selecting a snippet by id.
fn open_manager(app: &AppHandle, select: Option<String>) {
    hide(app);
    // Ids are validated on save, but this one comes from the webview: keep it to safe chars.
    let select = select.filter(|s| s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
    if let Some(w) = app.get_webview_window("manager") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        if let Some(id) = select {
            let _ = w.emit("manager-select", id);
        }
        return;
    }
    let path = match select {
        Some(id) => format!("manager.html?select={id}"),
        None => "manager.html".into(),
    };
    let built = WebviewWindowBuilder::new(app, "manager", WebviewUrl::App(path.into()))
        .title("Stash — Manage snippets")
        .inner_size(980.0, 640.0)
        .min_inner_size(720.0, 480.0)
        .center()
        .build();
    if let Ok(w) = built {
        let _ = w.set_focus();
    }
}

#[tauri::command]
fn list_snippets(store: State<Store>) -> Result<Vec<Snippet>, String> {
    store.load()
}

#[tauri::command]
fn save_snippets(store: State<Store>, snippets: Vec<Snippet>) -> Result<(), String> {
    store.replace(snippets)
}

// Must be async: creating a window from a sync command deadlocks on Windows.
#[tauri::command]
async fn manage_snippets(app: AppHandle, select: Option<String>) {
    open_manager(&app, select);
}

#[tauri::command]
fn hide_palette(app: AppHandle) {
    hide(&app);
}

#[tauri::command]
async fn paste_snippet(app: AppHandle, text: String, sensitive: bool) -> Result<(), String> {
    hide(&app);
    let target = app.state::<PrevWindow>().0.load(Ordering::SeqCst);
    paste::paste(text, sensitive, target)
}

#[tauri::command]
async fn copy_snippet(app: AppHandle, text: String, sensitive: bool) -> Result<(), String> {
    hide(&app);
    paste::copy(text, sensitive)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let hotkey = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| show(app)))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, sc, ev| {
                    if sc == &hotkey && ev.state() == ShortcutState::Pressed {
                        toggle(app);
                    }
                })
                .build(),
        )
        .manage(PrevWindow(AtomicIsize::new(0)))
        .invoke_handler(tauri::generate_handler![
            list_snippets,
            save_snippets,
            manage_snippets,
            hide_palette,
            paste_snippet,
            copy_snippet
        ])
        .setup(move |app| {
            let data_dir = app.path().app_data_dir()?;
            app.manage(Store::new(&data_dir));

            if let Err(e) = app.global_shortcut().register(hotkey) {
                eprintln!("Ctrl+Shift+Space is taken by another app: {e}");
            }

            let autostart_on = app.autolaunch().is_enabled().unwrap_or(false);
            let open = MenuItem::with_id(app, "open", "Open palette\tCtrl+Shift+Space", true, None::<&str>)?;
            let manage = MenuItem::with_id(app, "manage", "Manage snippets…", true, None::<&str>)?;
            let import = MenuItem::with_id(app, "import", "Import import.json", true, None::<&str>)?;
            let folder = MenuItem::with_id(app, "folder", "Open data folder", true, None::<&str>)?;
            let autostart = CheckMenuItem::with_id(app, "autostart", "Launch at sign-in", true, autostart_on, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Stash", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &manage, &import, &folder, &autostart, &sep, &quit])?;

            let import_path = data_dir.join("import.json");
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Stash — Ctrl+Shift+Space")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, e| match e.id.as_ref() {
                    "open" => show(app),
                    "manage" => open_manager(app, None),
                    "import" => match app.state::<Store>().import_plain(&import_path) {
                        Ok(n) => {
                            eprintln!("Imported {n} snippets");
                            let _ = app.emit("snippets-changed", ());
                        }
                        Err(e) => eprintln!("Import failed: {e}"),
                    },
                    "folder" => {
                        if let Some(dir) = import_path.parent() {
                            let _ = std::process::Command::new("explorer").arg(dir).spawn();
                        }
                    }
                    "autostart" => {
                        let al = app.autolaunch();
                        let _ = if al.is_enabled().unwrap_or(false) { al.disable() } else { al.enable() };
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, e| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                        show(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Stash");
}
