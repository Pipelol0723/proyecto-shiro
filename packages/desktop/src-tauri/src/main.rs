// Evita que en Windows abra una consola al ejecutar el .exe del release.
// En dev sigue abriéndola — útil para ver logs de Rust en stdout/stderr.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    proyecto_shiro_desktop_lib::run()
}
