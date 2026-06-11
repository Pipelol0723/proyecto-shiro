//! Entry point del binario Tauri 2.0 de Proyecto Shiro.
//!
//! Responsabilidades V1:
//!
//! 1. Inicializar Tauri con los plugins declarados en `Cargo.toml`.
//! 2. **Tray icon** con menú (Abrir / Salir) y **close-to-tray**.
//! 3. **Single instance**: re-abrir el binario trae al frente la ventana.
//! 4. **Sidecar `core-host`** (ADR 0024 §2): spawnear el proceso Node
//!    empaquetado al arrancar y matarlo al salir, pasándole por env las
//!    rutas de sus configs y del binario nativo de SQLite.
//!
//! Sobre permisos: el sidecar se lanza **desde Rust** (en `setup`), no
//! desde el webview. La ACL de capabilities solo gobierna las llamadas
//! IPC del webview, así que esto NO requiere conceder `shell:allow-execute`
//! en `capabilities/default.json` — el binario sigue runtime-denied para
//! el JS. Ver la enmienda del ADR 0024 §5.
//!
//! Lo que **NO** hace este archivo en V1: comandos `#[tauri::command]`
//! para FS / shell expuestos al webview. Llegan con el hito agentic
//! (ADR 0022), junto con sus permisos y scopes en la capability.

use std::sync::Mutex;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, RunEvent, WindowEvent,
};
use tauri_plugin_shell::{process::CommandChild, process::CommandEvent, ShellExt};

/// Puerto en el que el `core-host` expone el EventBus por WebSocket.
/// Debe coincidir con el default de `core-host/src/server.ts` y con el
/// `VITE_SHIRO_HOST_URL` que el cliente usa.
const CORE_HOST_PORT: &str = "9876";

/// Handle del proceso sidecar, guardado en el state de Tauri para poder
/// matarlo en el shutdown. `None` si el sidecar no se lanzó (modo dev sin
/// binario empaquetado — el dev corre `core-host` a mano).
#[derive(Default)]
struct SidecarState(Mutex<Option<CommandChild>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        // Auto-updater (ADR 0024 §4): el cliente dispara el check vía
        // `@tauri-apps/plugin-updater`. `process` habilita el relaunch.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // Plugins REGISTRADOS pero sin permisos concedidos al webview en V1
        // (ADR 0024 §5 enmendado). El binario los incluye para que la firma
        // ya los cubra; sus comandos IPC quedan rechazados por la ACL.
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(SidecarState::default())
        .setup(|app| {
            build_tray(app)?;
            // Lanza el core-host empaquetado. Best-effort: si el binario o
            // sus recursos no están (modo dev), loguea y sigue — el cliente
            // se conecta por WS a un core-host lanzado a mano.
            spawn_core_host(app.handle());
            Ok(())
        })
        .on_window_event(|window, event| {
            // close-to-tray: la X oculta la ventana en lugar de cerrar la app.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error al construir la aplicación Tauri")
        .run(|app, event| {
            // Al salir de verdad (tray → Salir, o RunEvent::Exit), matamos
            // el sidecar para no dejar el core-host huérfano ocupando :9876.
            if let RunEvent::Exit = event {
                kill_core_host(app);
            }
        });
}

/// Lanza el sidecar `core-host` resolviendo sus recursos (configs + binario
/// nativo de SQLite) desde el `resource_dir` del bundle. Best-effort: ante
/// cualquier ausencia o error, loguea y retorna sin abortar la app.
fn spawn_core_host(app: &tauri::AppHandle) {
    let resource_dir = match app.path().resource_dir() {
        Ok(dir) => dir,
        Err(e) => {
            log::warn!("no se pudo resolver resource_dir: {e}; core-host no se lanzará desde Tauri");
            return;
        }
    };

    let modules_config = resource_dir.join("modules.config.yaml");
    let character = resource_dir.join("default.yaml");
    let native_binding = resource_dir.join("better_sqlite3.node");

    // En dev los recursos no se copiaron (solo los genera `build:sidecar`).
    // Sin ellos, asumimos que el dev corre el core-host a mano y salimos.
    if !modules_config.exists() || !character.exists() {
        log::info!(
            "recursos del sidecar no encontrados en {} — se asume core-host externo (modo dev)",
            resource_dir.display()
        );
        return;
    }

    // Directorio de datos estable y escribible para el sidecar. El config
    // del core-host usa `local.db_path: './data/memory.db'` RELATIVO al
    // cwd; sin fijar el cwd, el sidecar lo resolvía contra el dir desde el
    // que Tauri lo lanza (`src-tauri/` en dev, Program Files en un install
    // real → read-only). Eso creaba un memory.db distinto en cada contexto,
    // y como el agent_id de Letta se persiste en ese WAL, cada arranque
    // provisionaba un agente nuevo → la memoria no continuaba. Fijando el
    // cwd a `app_local_data_dir`, `./data/memory.db` cae siempre en el mismo
    // sitio estable y escribible (`%LOCALAPPDATA%\com.pipelol.proyecto-shiro`).
    let data_dir = match app.path().app_local_data_dir() {
        Ok(dir) => dir,
        Err(e) => {
            log::warn!("no se pudo resolver app_local_data_dir: {e}; core-host no se lanzará");
            return;
        }
    };
    if let Err(e) = std::fs::create_dir_all(&data_dir) {
        log::warn!("no se pudo crear {}: {e}; core-host no se lanzará", data_dir.display());
        return;
    }

    let sidecar = match app.shell().sidecar("core-host") {
        Ok(cmd) => cmd,
        Err(e) => {
            log::warn!("sidecar core-host no disponible: {e}; se asume core-host externo");
            return;
        }
    };

    let sidecar = sidecar
        .current_dir(data_dir)
        .env("SHIRO_HOST_PORT", CORE_HOST_PORT)
        .env("SHIRO_MODULES_CONFIG", modules_config.to_string_lossy().to_string())
        .env("SHIRO_CHARACTER", character.to_string_lossy().to_string())
        .env(
            "SHIRO_SQLITE_NATIVE_BINDING",
            native_binding.to_string_lossy().to_string(),
        );

    match sidecar.spawn() {
        Ok((mut rx, child)) => {
            log::info!("core-host sidecar lanzado en :{CORE_HOST_PORT}");
            app.state::<SidecarState>().0.lock().unwrap().replace(child);

            // Drena stdout/stderr del sidecar al log de Tauri para que sus
            // mensajes (y crashes) queden en el archivo de logs.
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            log::info!("[core-host] {}", String::from_utf8_lossy(&line).trim_end());
                        }
                        CommandEvent::Stderr(line) => {
                            log::warn!("[core-host] {}", String::from_utf8_lossy(&line).trim_end());
                        }
                        CommandEvent::Error(err) => {
                            log::error!("[core-host] error del proceso: {err}");
                        }
                        CommandEvent::Terminated(payload) => {
                            log::warn!("[core-host] terminó con código {:?}", payload.code);
                        }
                        _ => {}
                    }
                }
            });
        }
        Err(e) => {
            log::error!("no se pudo lanzar el sidecar core-host: {e}");
        }
    }
}

/// Mata el sidecar si está vivo. Idempotente — seguro llamarlo aunque el
/// sidecar nunca se lanzara.
fn kill_core_host(app: &tauri::AppHandle) {
    if let Some(child) = app.state::<SidecarState>().0.lock().unwrap().take() {
        log::info!("matando el sidecar core-host…");
        let _ = child.kill();
    }
}

/// Construye el tray icon con menú (Abrir / Salir). Click izquierdo trae
/// la ventana al frente; click derecho abre el menú.
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
                // `app.exit` dispara RunEvent::Exit → kill_core_host.
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });
    // `Image` no implementa `Default`: el icono se añade solo si la ventana
    // tiene uno (puede faltar en dev si `icons/` aún no se generó).
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;

    Ok(())
}

/// Trae la ventana principal al frente. Idempotente.
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
