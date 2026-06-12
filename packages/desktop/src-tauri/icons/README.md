# Iconos del binario

Esta carpeta debe contener los siguientes archivos para que `tauri build`
produzca un binario funcional:

```
icons/
├── 32x32.png
├── 128x128.png
├── 128x128@2x.png   (256x256)
├── icon.icns        (macOS — diferido en V1, pero algunos targets lo requieren para el build)
├── icon.ico         (Windows installer)
└── icon.png         (fallback genérico)
```

## Cómo generar los placeholders en V1

V1 usa iconos placeholder genéricos. Para generarlos desde una PNG fuente
(cualquier imagen cuadrada, idealmente 1024×1024):

```bash
# Desde la raíz del repo
npx @tauri-apps/cli icon path/to/source.png
```

Ese comando lee la PNG fuente y escribe todos los formatos necesarios en
`packages/desktop/src-tauri/icons/`.

## Estos iconos SÍ están commiteados

Los `.png`, `.ico` y `.icns` de esta carpeta **sí entran al repo**: el
release CI (`.github/workflows/release.yml`) necesita iconos presentes
para que `tauri build` no falle, y un paso de generación en CI sería
frágil. Son **placeholders temporales** (ADR 0024 §7) — se reemplazan
cuando llegue el branding definitivo de Shiro.

Las subcarpetas `android/` y `ios/` que `tauri icon` también genera
quedan gitignored: V1 es Windows-only, se regeneran cuando toque mobile.
