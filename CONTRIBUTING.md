# Contribuir a Proyecto Shiro

Guía corta para contribuir. El proyecto lo mantiene una persona, con
agentes de IA como apoyo; las instrucciones para agentes están en
[`CLAUDE.md`](CLAUDE.md). Los checks previos al push están en la sección
"[Cómo correr los tests y checks](README.md#cómo-correr-los-tests-y-checks)"
del README.

## Ramas, PRs y versiones

- `develop` es la única rama de integración. Todo entra por PR pequeño con
  base `develop`; la rama se borra al fusionar.
- Las versiones son tags `vX.Y.Z` sobre `develop`. `main` no es una rama
  "estable": solo avanza al publicar un tag. Hoy va unos 260 commits por
  detrás porque aún no se ha publicado ninguna versión.
- Sin issue tracker: el seguimiento son las casillas del
  [plan de mejora](docs/plan-mejora-2026-11.md), la tabla
  [Roadmap](README.md#roadmap) y la tabla SEC-xx de
  [`docs/security-review-2026-07.md`](docs/security-review-2026-07.md).
- PRs de agentes o de self-dev: citan el lote L-xxx y los R-xxx que cierran,
  diff de 300 líneas como máximo, test rojo→verde y checks en verde; como
  mucho 2 PRs de agente abiertos a la vez.
- Un ADR nuevo va en un PR `docs:` propio, fusionado antes que su código; la
  enmienda de un ADR existente viaja con el código. Detalle en
  [ADR 0029](docs/adr/0029-proceso-de-mantenimiento-de-una-persona.md).

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
> Hoy el coste es nulo: el v0.1.0 nunca se publicó, así que el
> auto-updater no ha servido ninguna actualización.

### Secrets de GitHub Actions (para el release CI)

El workflow `.github/workflows/release.yml` firma los artefactos en CI.
Configura en **Settings → Secrets and variables → Actions** del repo
**un solo secret**:

| Secret                      | Valor                                                                   |
| --------------------------- | ----------------------------------------------------------------------- |
| `TAURI_SIGNING_PRIVATE_KEY` | El **contenido** del archivo `~/.tauri/shiro-updater.key` (no la ruta). |

La clave de este repo se generó **sin contraseña**, y GitHub no permite
guardar un secret con valor vacío — por eso `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
**no se crea como secret**: el workflow lo pasa como string vacío directamente.
Si en una regeneración futura le pones contraseña, añade ese secret y cambia
la línea `TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ''` del workflow para que lea
del secret.

> ⚠️ **Nota de seguridad (`SEC-11`)**: la passphrase vacía deja la clave de
> firma sin segundo factor — quien obtenga el archivo de la clave puede forjar
> actualizaciones que el auto-updater instala solo. Está anotado como deuda en
> [`docs/security-review-2026-07.md`](docs/security-review-2026-07.md);
> regenerar la clave **con** passphrase es obligatorio antes del próximo tag
> (checklist pre-release).

Para volcar la privada al portapapeles y pegarla en el secret:

```powershell
# Windows PowerShell
Get-Content "$HOME\.tauri\shiro-updater.key" -Raw | Set-Clipboard
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

## Checklist pre-release (antes del primer tag)

El único release, v0.1.0, sigue en borrador y el auto-updater nunca ha
servido una actualización. No se publica ningún tag nuevo hasta cumplir todo
esto; hoy se comprueba a mano (llevarlo al CI es trabajo del plan de mejora,
sin implementar):

- [ ] El CI construye el sidecar (`build:sidecar`) y el binario de Tauri.
- [ ] El tag coincide con la versión de `tauri.conf.json` y `Cargo.toml`.
- [ ] Los tests pasan antes de firmar (hoy `release.yml` no los corre).
- [ ] La clave del updater está rotada, con passphrase, y custodiada.
- [ ] Hay un `LICENSE` en la raíz.

## Qué NO se commitea

- La **clave privada** del updater (`~/.tauri/*.key`) ni ningún `.env`.
- Binarios del sidecar, modelos Live2D, Cubism SDK — ver `.gitignore`.
