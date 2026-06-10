# ADR 0024: Packaging Tauri 2.0 — Windows V1, sidecar core-host, modo dual ventana/overlay

- **Status**: Accepted
- **Fecha**: 2026-06-09
- **Decidido por**: Pipelol0723

## Contexto

Con cara (Live2D), voz (TTS), oído (STT), memoria (Letta) y agentic + self-improvement ya documentados como visión V1 (ADRs 0022, 0023), el último hito **funcional** del MVP es empaquetar el companion en un binario nativo que el usuario pueda instalar con doble click y abrir como cualquier app de escritorio. Hoy Shiro vive en dos procesos a mano: `npm run dev -w @proyecto-shiro/desktop` (puerto 5173) + `npm run dev -w @proyecto-shiro/core-host` (puerto 9876). Inaceptable para un uso real.

Este ADR cierra el MVP. Después llega agentic (hito implementación de ADR 0022) que aprovecha permisos / firma / auto-updater ya en su sitio, sin re-empaquetar.

### Estado del que partimos

- **Tauri NO está configurado**. Sin `src-tauri/`, sin `tauri.conf.json`. El stack ya menciona Tauri 2.0 en README desde el inicio, pero la integración no se ha hecho.
- **Cliente desktop** (`@proyecto-shiro/desktop`): Vite + React + TS, build produce `dist/` estático. Ya listo para que Tauri lo sirva como WebView.
- **`core-host`** (`@proyecto-shiro/core-host`): proceso Node con WebSocket en `:9876`, dependencias nativas (`better-sqlite3` para LocalMemory). Hoy se ejecuta con `tsx` desde el script `dev`.
- **Servicios externos** que NO viven en el binario:
  - Ollama (`:11434`) — LLM local.
  - Letta (Docker, `:8283`) — memoria semántica.
  - Whisper microservicio (Docker, `:8765`) — STT.
- **ADR 0022 (Proposed)** define que el binario debe poder ejecutar herramientas FS/shell con permisos Tauri runtime. Influye fuertemente el diseño de capabilities.
- **ADR 0023 (Proposed)** depende de 0022; no añade requisitos nuevos al packaging.
- **Equipo**: 2 personas, 4-6 h/semana, sin acceso a Mac, hardware Windows.

### Restricciones reales

- **Solo Windows en V1**. El usuario no tiene Mac (no puede firmar para macOS — requiere Apple Developer ID + notarización). Linux es opcional pero sin testing real. macOS y Linux quedan documentados como diferidos.
- **`better-sqlite3` es nativo**. El sidecar Node debe compilarse para Windows x64 con el binding correcto. `pkg` / `@vercel/ncc` no resuelven módulos nativos por defecto — requiere copia manual del `.node` al lado del exe.
- **Servicios externos pesados** (Letta + Whisper Docker, modelos LLM en GB). El instalador no puede bundlearlos; el usuario debe tenerlos corriendo. Healthcheck visual + setup wizard mitigan la fricción.
- **Firma de código en Windows**: certificados de Authenticode cuestan ($200-400/año mínimos) o se firma con cert auto-firmado (SmartScreen warning al instalar). Para uso personal: cert auto-firmado + documentar el warning como esperable.
- **Auto-updater requiere infra**: signing key (Tauri usa ed25519), endpoint con feed firmado (GitHub Releases sirve), workflow CI que construya y publique. Setup inicial no trivial, beneficio enorme tras configurarlo.

### Lo que el usuario quiere dejar fuera de V1

- **macOS / Linux build pipeline** — diferidos. Documentar que el proyecto es OS-agnóstico en código pero el packaging se hace solo para Windows V1.
- **Iconos custom finales** — placeholders en V1, se afinarán cuando Shiro tenga modelo definitivo y branding propio (post-Avatar definitivo).
- **Bundle de servicios externos** (Ollama, Docker images) — overhead masivo, complicaciones de licencia. Setup wizard cubre.
- **Lanzar Ollama / Docker desde el binario** — frágil ante instalaciones distintas. Documentar como prerequisito es más robusto.

## Decisión

Empaquetamos Shiro como **binario Tauri 2.0 para Windows x64 únicamente en V1**. El `core-host` se distribuye como **sidecar** (ejecutable Node empaquetado con `@vercel/ncc` + `better-sqlite3` copiado a mano), lanzado y matado por Tauri. La ventana arranca en **modo normal con tray icon** (cierre al tray, no a la barra); existe un **toggle en settings** que cambia a **overlay always-on-top transparente** estilo VTuber. El `tauri.conf.json` declara permisos **amplios** (`fs:*`, `shell:*`, dialog) coherentes con ADRs 0022 y 0023, pero la app los mantiene **runtime-denied** mediante feature flags hasta que cada hito los active — esto evita romper la cadena de updates firmados cuando agentic llegue. Los servicios externos (Ollama, Letta, Whisper) **NO se bundlean**; un setup wizard al primer arranque chequea conectividad y muestra comandos exactos si algo falta. Iconos placeholder en V1. **Auto-updater activo desde el primer release**, firmado con ed25519, distribuido vía **GitHub Releases** mediante workflow `release.yml` disparado por tags `v*.*.*`.

### 1. Solo Windows x64 en V1

Build pipeline empaqueta exclusivamente `.msi` (instalador) y `.exe` (portable) para Windows x64. Tauri config soporta los otros targets nominalmente; el workflow CI no los activa. README documenta que macOS / Linux son OS-agnósticos en código pero el build oficial es Windows.

**Por qué no Windows+Linux ni las tres**: cero costo evitar Linux ahora (sin testing local) y macOS requiere Apple Developer ID + Mac físico. Cuando el proyecto justifique distribución multi-plataforma (post-MVP, otra persona contribuyendo), se reabre.

### 2. `core-host` como sidecar Tauri 2.0

**Empaquetado del sidecar**:

1. Compilar `core-host` con `@vercel/ncc` a un único bundle JS (`dist/core-host.js`).
2. Empaquetarlo como ejecutable Node con [`pkg`](https://github.com/vercel/pkg) o `@yao-pkg/pkg` (mantenido) → produce `core-host-windows-x64.exe`.
3. **Resolver módulos nativos**: `better-sqlite3.node` se copia manualmente al lado del exe en `src-tauri/binaries/` con sufijo de target triple (`core-host-x86_64-pc-windows-msvc.exe`).
4. Tauri lo registra como sidecar en `tauri.conf.json`:

```jsonc
{
  "bundle": {
    "externalBin": ["binaries/core-host"],
  },
}
```

**Lifecycle**:

- App arranca → Tauri spawnea el sidecar en `127.0.0.1:9876`.
- Cliente WebView conecta vía WebSocket como ya hace en dev.
- App cierra (incluido el tray exit) → Tauri mata el sidecar.
- Crashes del sidecar se loguean a `~/AppData/Roaming/proyecto-shiro/core-host.log`; UI muestra notificación al usuario para reabrir.

**Por qué no standalone**: doble-click no es opcional para un companion personal. Forzar al usuario a abrir terminal lo convierte en juguete para devs.

**Por qué no asumir Docker external**: idem.

### 3. Modo ventana dual: normal por default + overlay opcional

**Default — Ventana normal con tray**:

- Ventana redimensionable estándar con chrome del SO.
- Cerrar (X) → minimiza al tray, no cierra la app.
- Tray icon con menú: Abrir / Settings / Salir.
- Tamaño inicial: 1200x800 (suficiente para avatar + chat + status bar).

**Toggle en Settings → "Modo overlay"**:

- Ventana sin chrome (`decorations: false`).
- `alwaysOnTop: true`.
- `transparent: true`.
- `skipTaskbar: true`.
- Reduce el tamaño automáticamente a algo más cómodo (~420x720, ratio Live2D).
- Draggable por el body del avatar (Tauri 2.0 `tauri-plugin-window` lo permite).
- El chat panel queda accesible vía hover / botón flotante.

**Cómo se guarda la preferencia**: en `localStorage` por cliente (mismo patrón que mute toggle del TTS, ADR 0020). En multi-device futuro, decidir si sincroniza vía bus.

**Por qué no overlay por default**: el modo overlay es una experiencia VTuber-pro; introduce decisiones de UX (¿dónde están los controles? ¿cómo el usuario interactúa sin chrome?) que es mejor ofrecer como opt-in.

### 4. Auto-updater activo desde el primer release

**Stack**:

- **`tauri-plugin-updater`** v2 plugin oficial.
- **Firma ed25519**: keypair generada con `tauri signer generate`. Public key en `tauri.conf.json`; private key en GitHub Actions secret (`TAURI_SIGNING_PRIVATE_KEY`).
- **Feed**: `https://github.com/Pipelol0723/proyecto-shiro/releases/latest/download/latest.json`. Tauri lo consulta al arrancar.
- **Versión semántica**: tags `v0.1.0`, `v0.2.0`, etc. App lee versión propia del `Cargo.toml` / `tauri.conf.json`.

**Comportamiento del usuario**:

- Al arrancar, app verifica si hay nueva versión.
- Si la hay, notifica con un toast: "Hay una nueva versión disponible. ¿Actualizar ahora?".
- Click → descarga, valida firma, instala, reinicia.
- Si rechaza, vuelve a preguntar al próximo arranque (sin spam).

**Por qué activado desde V1**: una vez configurado el setup (key + workflow), el costo marginal de cada release es cero. Sin auto-updater, cada nueva versión requiere "ve a GitHub, descarga, desinstala vieja, instala nueva" — UX inaceptable para uso real.

### 5. Permisos Tauri amplios pero runtime-denied (con feature flags)

**El truco**: declarar en `tauri.conf.json` todos los permisos que ADRs 0022/0023 prevén — `fs:allow-read-file`, `fs:allow-read-dir`, `fs:allow-write-file`, `fs:allow-remove`, `shell:allow-execute`, `dialog:default`. Pero **en runtime, la app los bloquea** con un feature flag `AGENTIC_ENABLED = false` hasta que cada hito los active.

**Por qué es seguro**: los permisos en `tauri.conf.json` definen el contrato del binario firmado. Si no activamos las capabilities en el ConfigState de Tauri al inicializar, los IPC commands FS/shell devuelven `Permission denied` aunque el binario los tenga declarados. La superficie real está cerrada hasta que el código (agentic) decida abrirla.

**Por qué amplios desde V1**: cuando agentic llegue, NO hay que re-firmar el binario con nuevos permisos — el primer release ya los cubre. Esto evita el caso "el usuario instala el MVP, lo actualiza, y de repente la app pide nuevos permisos" que rompe la confianza y el auto-updater.

**Trade-off aceptado**: en V1, un atacante que comprometa el binario podría teóricamente usar las capabilities declaradas. Mitigaciones:

- App está firmada (cert auto-firmado documentado).
- Compromise del binario requeriría comprometer el repo + signing key.
- En tiempo de release, el workflow CI verifica que el feature flag no se haya activado prematuramente.

**Alternativa de "minimal + re-firmar al activar"**: descartada — auto-updater no soporta "expandir permisos" sin que el usuario re-confirme, lo que rompe la experiencia.

### 6. Servicios externos: setup wizard + healthcheck visual

**Al primer arranque** (detectado por flag en config local), la app:

1. Chequea Ollama (`GET http://localhost:11434/api/tags`).
2. Chequea Letta (`GET http://localhost:8283/v1/health`).
3. Chequea Whisper (`GET http://localhost:8765/health` — actual ping del ADR 0019).
4. Para cada servicio: marca como ✅ o ❌ y muestra el comando exacto si falla.
5. Permite continuar en **modo degradado**: orbe en lugar de Live2D si Whisper falta, "sin memoria" si Letta falta, "solo cloud" si Ollama falta. Shiro sigue siendo conversable.

**Por qué no auto-start**: lanzar `docker compose up` desde Tauri es frágil — asume rutas, permisos, instalaciones. El usuario probablemente ya tiene Docker Desktop con Letta corriendo desde dev — auto-arrancar duplicaría procesos.

**Por qué no bundle**: el instalador pesaría GBs (modelos LLM, imágenes Docker), tiene implicaciones de licencia (qwen2.5 tiene términos de uso), y duplica lo que el usuario ya tiene instalado.

### 7. Iconos placeholder en V1

- Tauri necesita `src-tauri/icons/` con PNG de varias resoluciones (16, 32, 48, 128, 128x128@2x, 256, 512) + `icon.ico` para Windows.
- V1 usa los placeholders genéricos que vienen con `tauri init`. README documenta que serán reemplazados cuando llegue el modelo definitivo de Shiro y se decida un branding propio.
- **Tray icon** también usa placeholder. Color del SO (light/dark) detectado.

**Por qué no generar desde el Orbe**: aunque tentador, el Orbe es _placeholder_ del avatar (ADR 0009). Usar el placeholder del avatar como el icon del binario codifica una decisión visual no-permanente. Mejor placeholder genérico tirando de Shiro como branding final.

### 8. CI release via GitHub Actions en cada tag

**`.github/workflows/release.yml`** se dispara con `git tag v*.*.*` o creación de Release desde la UI:

1. Job en Windows runner (`windows-latest`).
2. Setup Node 22 + Rust + Tauri CLI.
3. `npm ci` + `npm run build` para todos los workspaces.
4. Empaqueta el sidecar (`core-host.exe`) con `@yao-pkg/pkg`.
5. Copia `better-sqlite3.node` a `src-tauri/binaries/`.
6. `cargo tauri build` → genera `.msi`, `.exe` portable, y `latest.json` firmado.
7. Sube todo al GitHub Release vía `softprops/action-gh-release`.

**Secrets requeridos**:

- `TAURI_SIGNING_PRIVATE_KEY` — para firma del updater feed.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — passphrase de la key.

Documentar el setup en `CONTRIBUTING.md` (cómo generar la key, dónde meterla en GitHub Secrets).

**Coste**: GitHub Actions gratis para repos públicos. Runner Windows tarda ~10-15 min por release.

## Alternativas consideradas

- **Electron en lugar de Tauri**: descartada. Mayor footprint (~150MB vs ~10MB), peor seguridad por modelo del proceso. Tauri 2.0 maduro, soportado por Rust, integra Web nativo más sano.
- **Standalone `core-host`** (usuario lo lanza aparte): descartada. Inaceptable UX para companion personal.
- **Asumir Docker compose external para todo**: descartada. Mismo problema de UX; razonable solo si el target fuera devs.
- **Lanzar Ollama / Docker desde el binario**: descartada. Frágil ante variaciones de instalación, duplica procesos.
- **Bundle todo (incl. modelos LLM)** en el instalador: descartada. Tamaño inviable, licencias de modelos turbias para redistribución, duplica recursos del usuario.
- **macOS + Linux desde V1**: diferidas. Sin Mac propio, sin Apple Developer ID, sin testing real en Linux.
- **Auto-updater diferido**: descartada. Una vez configurado, el costo marginal por release es cero — diferir aumenta el costo de cada update manual.
- **Permisos Tauri mínimos + re-firmar al activar agentic**: descartada. Romper la cadena de updates firmados es peor que declarar amplios runtime-denied.
- **Modo overlay como default**: descartada. Decisiones de UX no triviales (¿controles? ¿chat?) que mejor ofrecer como opt-in cuando el modo normal ya está sólido.
- **Auto-firmar con cert de Windows Authenticode** ($200-400/año): descartada para V1. El SmartScreen warning al instalar se documenta como esperable; se reevalúa si Shiro se distribuye públicamente.

## Consecuencias

### Positivas

- **MVP cerrado**. Shiro pasa de "dos terminales abiertas" a "doble-click → app abierta". Salto cualitativo.
- **Auto-updater desde V1**: futuros releases son zero-friction para el usuario.
- **Permisos previstos firmados**: cuando agentic llegue, no rompe la cadena de updates.
- **CI reproducible**: cada tag produce binario firmado idéntico. Sin "funciona en mi máquina".
- **Modo dual ventana/overlay**: el usuario tiene experiencia desktop limpia por default + opción VTuber-pro cuando le da el gusto.
- **Sidecar como pattern**: aprovecha el split cliente/server (ADR 0012) sin reescribir nada en Rust.

### Negativas / Riesgos

- **`better-sqlite3` nativo añade complejidad**: hay que copiar el `.node` correcto al binarios/, mantener la versión consistente con la del runtime Node empaquetado por `pkg`. Posible fuente de bugs en release.
- **Cert auto-firmado = SmartScreen warning**: usuarios verán "Windows protegió su PC" al instalar. Hay que documentar como esperable. Si el proyecto crece, considerar cert real.
- **Servicios externos como prerequisito**: el setup wizard mitiga, pero el primer arranque sin Docker / Ollama instalados es decepcionante. Mitigaciones en docs.
- **Workflow CI con secrets**: pérdida de la signing key implica invalidar todos los updates futuros — los usuarios actualizados tienen que reinstalar manualmente. Backup del key crítico.
- **Sin macOS / Linux**: cualquier contribuidor en esas plataformas tendrá que hacer build manual o esperar a que llegue su pipeline.
- **Permisos amplios firmados** = superficie de ataque mayor en V1 si el binario se compromete. Riesgo mitigado por feature flags + firma del workflow.

### Neutrales

- El cliente React no cambia para soportar Tauri — el WebView lo sirve como cualquier HTML. Único impacto: `useTauriCommand()` hooks aparecerán cuando agentic llegue.
- El `core-host` se compila igual que ahora; solo añade un pipeline de empaquetado al final.
- La arquitectura de eventos (EventBus + WebSocket) sigue idéntica. Sin cambios en el wire protocol.

## Notas de implementación

PRs del hito (tasks #31-#37 ya creadas):

1. **Bootstrap Tauri 2.0**: `src-tauri/`, `tauri.conf.json`, modo ventana normal con tray. Permisos amplios declarados, feature flag `AGENTIC_ENABLED = false`. Sin sidecar.
2. **Sidecar core-host**: `@yao-pkg/pkg` build, copia de `better-sqlite3.node`, registro en `externalBin`, spawn/kill desde Tauri.
3. **Healthcheck wizard**: pantalla "Setup" al primer arranque, chequea servicios, muestra comandos, permite skip a modo degradado.
4. **Modo overlay**: toggle en settings, ventana sin chrome + alwaysOnTop + transparent, drag-by-body, preferencia en localStorage.
5. **Auto-updater + signing**: `tauri-plugin-updater`, generar key, configurar feed, CONTRIBUTING.md con instrucciones.
6. **Workflow CI release**: `.github/workflows/release.yml`, Windows runner, build + sign + upload, secret management.
7. **Docs cierre**: README + architecture + CLAUDE + plan marcando hito ✅, sección instalación + uso, próximo hito (agentic).

**Versionado inicial**: el primer release del MVP será `v0.1.0`. Antes de él, sin releases publicados.

**Estructura del repo tras Packaging**:

```
src-tauri/                    ← Tauri 2.0 (Rust + config)
  src/
    main.rs
    lib.rs
  binaries/
    core-host-*.exe           ← sidecar empaquetado (gitignored)
    *.node                    ← módulos nativos (gitignored)
  icons/                      ← placeholders
  tauri.conf.json
  Cargo.toml
.github/workflows/
  release.yml                 ← workflow de release
CONTRIBUTING.md               ← setup de signing key (nuevo)
```

## Referencias

- [ADR 0008](0008-cliente-desktop-vite-react.md) — Vite + React + TS. Build de `dist/` que Tauri sirve.
- [ADR 0011](0011-core-split-browser-node.md) — split browser/Node. El sidecar es el entry Node.
- [ADR 0012](0012-split-cliente-server-core-host.md) — cliente/server. `core-host` como sidecar es la realización de este split en binario.
- [ADR 0013](0013-protocolo-websocket-eventbus.md) — protocolo WS. Sin cambios — Tauri y sidecar lo siguen usando.
- [ADR 0017](0017-memoria-persistente-local-y-letta.md) — memoria. `better-sqlite3` nativo del WAL.
- [ADR 0019](0019-stt-faster-whisper-microservicio-python.md) — Whisper Docker como servicio externo.
- [ADR 0022](0022-shiro-agentic-tools-fs-shell.md) — agentic. Define los permisos Tauri que este ADR declara amplios.
- [ADR 0023](0023-shiro-self-improvement-propose-only.md) — self-improvement. Mismo paquete de permisos.
- [Tauri 2.0 — Sidecar](https://tauri.app/v2/develop/sidecar/) — patrón de binarios externos.
- [Tauri 2.0 — Updater](https://tauri.app/v2/plugin/updater/) — auto-updater.
- [Tauri 2.0 — Capabilities](https://tauri.app/v2/security/capabilities/) — modelo de permisos.
- [`@yao-pkg/pkg`](https://github.com/yao-pkg/pkg) — fork mantenido de `pkg` para empaquetar Node.
