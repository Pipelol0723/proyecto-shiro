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

## Por qué los binarios no están en git

Los `.png`, `.ico` y `.icns` son ignorados por `.gitignore` para evitar:

- Bloat del repo con binarios cuando los placeholders cambian.
- Mezclar el branding "definitivo" con los placeholders durante V1 (los
  iconos definitivos llegan cuando se decida modelo y branding propio,
  documentado en ADR 0024).

Cada dev / CI runner genera los suyos al setup.
