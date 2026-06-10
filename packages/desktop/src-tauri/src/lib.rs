//! Entry point del binario Tauri 2.0 de Proyecto Shiro.
//!
//! Responsabilidades V1 de este archivo:
//!
//! 1. Inicializar Tauri con los plugins declarados en `Cargo.toml`.
//! 2. Configurar el **tray icon** con menú (Abrir / Salir) y
//!    **close-to-tray** (la X minimiza, no cierra).
//! 3. Configurar **single instance**: si el usuario abre el binario dos
//!    veces, la segunda llamada trae al frente la ventana ya abierta
//!    en lugar de spawnear otro proceso.
//!
//! Lo que **NO** hace este archivo en V1 (ADR 0024 §5, enmendado):
//!
//! - No concede permisos de FS / shell / dialog al webview. Los plugins
//!   `tauri-plugin-fs`, `tauri-plugin-shell` y `tauri-plugin-dialog`
//!   quedan registrados aquí (y en `Cargo.toml`) para que el binario y
//!   su firma ya los incluyan, pero **en Tauri 2 cada plugin expone sus
//!   propios comandos IPC al webview** — no hacen falta comandos Rust
//!   custom para invocarlos. El "runtime-denied" real se aplica en
//!   `capabilities/default.json`: ahí NO se conceden los permisos
//!   `fs:*` / `shell:*` / `dialog:*` y la ACL rechaza cualquier invoke.
//!
//! Cuando llegue el hito agentic (ADR 0022), este archivo gana:
//! - Comandos `#[tauri::command]` que envuelven `tauri::api::fs::*` con
//!   FS scope + permission tier check.
//! - Un comando `shell:exec` con allowlist desde `modules.config.yaml`.
//! - Un comando `dialog:show-confirm` para los modales de aprobación.

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

/// Punto de entrada llamado desde `main.rs`. Construye el Builder de
/// Tauri con plugins, hooks de ventana y tray, luego arranca el event
/// loop.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Single instance: si re-arrancas el binario, la 2.ª llamada trae
        // al frente la ventana ya abierta en lugar de spawnear otra.
        // El handler recibe argv/cwd de la 2.ª llamada — útil para
        // futuros file-handlers (drop de un archivo sobre el icono).
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        // Estado de ventana: recordar tamaño/posición/maximized entre
        // reinicios. Se persiste en `~/AppData/Roaming/proyecto-shiro/`.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // Logs estructurados. Por defecto va a stdout en dev y a archivo
        // en release (rotación diaria, max 10 MB).
        .plugin(tauri_plugin_log::Builder::new().build())
        // Notificaciones del sistema. Usadas por el auto-updater (task #35)
        // y posiblemente por toasts del agentic.
        .plugin(tauri_plugin_notification::init())
        // ── Plugins DECLARADOS pero sin comandos custom en V1 ───────
        // Ver el header del módulo y ADR 0024 §5 para por qué.
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        // Setup hook: aquí construimos el tray icon una vez la app está
        // lista (necesita el `AppHandle`).
        .setup(|app| {
            build_tray(app)?;
            Ok(())
        })
        // Hook de eventos de ventana. Interceptamos `CloseRequested` para
        // implementar close-to-tray: en lugar de matar la app, ocultamos
        // la ventana. El usuario la reabre desde el tray o re-ejecutando
        // el binario (single-instance la trae al frente).
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error al arrancar la aplicación Tauri");
}

/// Construye el tray icon con menú contextual.
///
/// Menú V1:
///   - **Abrir**: muestra y enfoca la ventana principal.
///   - **Salir**: cierra el proceso (única manera de salir realmente —
///     la X de la ventana solo oculta).
///
/// **Click simple sobre el tray** también muestra la ventana (UX común
/// en apps tipo Discord/Slack). Click derecho abre el menú.
fn build_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let open_item = MenuItem::with_id(app, "open", "Abrir", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_item, &quit_item])?;

    let mut tray = TrayIconBuilder::with_id("main-tray")
        .tooltip("Proyecto Shiro")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main_window(app),
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // Click simple izquierdo: traer la ventana al frente.
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });
    // `Image` no implementa `Default`, así que el icono se añade solo si
    // la ventana tiene uno (puede faltar en dev si `icons/` aún no se
    // generó con `tauri icon`); el tray funciona igualmente sin icono.
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;

    Ok(())
}

/// Helper para traer la ventana principal al frente desde el tray.
/// Idempotente — funciona aunque la ventana ya esté visible.
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
