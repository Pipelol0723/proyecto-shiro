// Build script estándar de Tauri 2.0. Genera bindings en compile-time
// para los plugins declarados en `tauri.conf.json` y los capabilities
// (ver `capabilities/default.json`).
fn main() {
    tauri_build::build()
}
