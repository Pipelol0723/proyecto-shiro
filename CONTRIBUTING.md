# Contribuir a Proyecto Shiro

Guía corta para el equipo. Para el flujo de ramas/commits y los checks
previos al push, ver [`CLAUDE.md`](CLAUDE.md) y la sección
"[Cómo correr los tests y checks](README.md#cómo-correr-los-tests-y-checks)"
del README.

## Firma del auto-updater (Tauri)

El binario se auto-actualiza desde GitHub Releases verificando una firma
**ed25519** (ADR 0024 §4). Hay un par de claves:

- **Clave pública** — vive en `packages/desktop/src-tauri/tauri.conf.json`
  (`plugins.updater.pubkey`). Es pública por diseño; está commiteada.
- **Clave privada** — firma los artefactos del release. **NUNCA** se
  commitea. Vive solo en tu máquina y como secret de GitHub Actions.

### Generar el par de claves (una sola vez para el proyecto)

Ya hay un par generado para este repo (la pública está en `tauri.conf.json`).
Si necesitas **regenerarlo** (clave comprometida, o arrancas un fork):

```bash
npx @tauri-apps/cli signer generate -w "$HOME/.tauri/shiro-updater.key"
```

Esto escribe la clave privada en `~/.tauri/shiro-updater.key` y la
pública en `~/.tauri/shiro-updater.key.pub`. Pega el contenido del `.pub`
en `tauri.conf.json` → `plugins.updater.pubkey`.

> ⚠️ Si regeneras la clave, **todos los binarios ya instalados dejan de
> poder auto-actualizarse** (la firma vieja ya no valida) — los usuarios
> tendrán que reinstalar a mano una vez. Regenera solo si es necesario.

### Secrets de GitHub Actions (para el release CI — task #36)

El workflow de release firma los artefactos en CI. Configura en
**Settings → Secrets and variables → Actions** del repo:

| Secret                               | Valor                                                                   |
| ------------------------------------ | ----------------------------------------------------------------------- |
| `TAURI_SIGNING_PRIVATE_KEY`          | El **contenido** del archivo `~/.tauri/shiro-updater.key` (no la ruta). |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | La contraseña de la clave, o vacío si la generaste sin contraseña.      |

Para volcar la privada al portapapeles y pegarla en el secret:

```bash
# Windows PowerShell
Get-Content "$HOME\.tauri\shiro-updater.key" | Set-Clipboard
```

### Build local firmado (probar el updater sin CI)

Para que `npm run tauri:build` genere los artefactos del updater
(`.sig` + `latest.json`) hay que exportar la privada antes:

```bash
# Windows PowerShell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$HOME\.tauri\shiro-updater.key" -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""   # si no le pusiste contraseña
npm run build:sidecar -w @proyecto-shiro/desktop
npm run tauri:build -w @proyecto-shiro/desktop
```

Sin esas env vars, el build normal funciona pero **no** produce los
artefactos firmados del updater (Tauri lo avisa con un warning).

## Qué NO se commitea

- La **clave privada** del updater (`~/.tauri/*.key`) ni ningún `.env`.
- Binarios del sidecar, modelos Live2D, Cubism SDK — ver `.gitignore`.
