# ADR 0021: Avatar Live2D — pixi-live2d-display, 30 fps, fallback al Orbe

- **Status**: Accepted
- **Fecha**: 2026-06-04
- **Decidido por**: Pipelol0723

## Contexto

Cerrado el hito **TTS** (ADR 0020), toca el hito **Avatar Live2D** — la cara real del companion. Hoy `<Avatar>` es un placeholder que renderiza un `<Orb>` SVG (ADR 0009) cuyos colores mapean a la emoción del LLM. Cumple su rol mientras no había un avatar real; ahora toca poner el modelo Live2D que el resto del stack (TTS con `tts:audio`, mapeo emocional en `default.yaml`, `IAvatarModule` interface) lleva tiempo esperando.

### Estado del que partimos

- **Interface `IAvatarModule`** existe (`setExpression`, `startLipSync`, `stop`) — el slot del orchestrator ya está reservado.
- **`AvatarScreen`** existe como pantalla full-screen dedicada al avatar; hoy muestra el orbe + status.
- **`<Orb>` en `ConversationScreen`** es el avatar visible por defecto.
- **`character.emotions[emotion].avatar_expression`** del YAML del personaje ya mapea las 5 emociones (`neutral`, `divertida`, `pensativa`, `molesta`, `vulnerable`) a nombres de expresión (`idle`, `smirk`, `thinking`, `annoyed`, `soft`). Falta el código que las consuma.
- **TTS emite `tts:audio { url, audioId, mimeType }`** que el cliente reproduce con `HTMLAudioElement` via `useTtsPlayback`. Tenemos audio reproduciéndose en el cliente — ideal para lip-sync.

### Restricciones reales

- **Hardware en transición**. GTX 1650 4 GB hoy compartida con Ollama + Letta + Whisper. Live2D **no usa CUDA** (es WebGL via integrated/discrete GPU), pero la GPU sigue siendo la misma — conviene tirar a la baja.
- **Sin modelo definitivo**. El usuario aún no ha elegido qué modelo será Shiro a largo plazo. Necesitamos un placeholder que arranque hoy.
- **Modelo y SDK propietarios fuera del repo**. El Cubism Core SDK (`Live2DCubismCore.js`/`.dll`) y los archivos del modelo (`.moc3`, `.model3.json`, texturas) no se commitean — cada dev los baja manualmente. Ya documentado en `.gitignore`. El repo en GitHub no incluye modelo: si alguien lo clona, debe poder usar el companion (sin avatar visual) hasta que descargue el SDK + modelo.
- **Proyecto de uso personal**. Sin licencia comercial de Live2D necesaria; el SDK gratis y los modelos gratuitos (Hiyori) son suficientes.
- **Pareja de 2 desarrolladores**. Tests visuales con Playwright son overkill — verificación manual por dev tras cada PR.

### Lo que el usuario quiere dejar fuera de V1

- **Eye tracking del cursor**.
- **Touch / click interactions** ("pat the head", reacciones a clicks).
- **Overlay always-on-top** (estilo VTuber profesional sobre otras apps).
- **Decidir el destino final de `AvatarScreen`** (¿se mantiene como pantalla aparte? ¿queda como espacio para futuras settings del avatar?). El usuario prefiere verlo en código antes de decidir.

Las tres primeras son features de envergadura suficiente para que merezcan sus propios hitos o ADRs futuros. Las documentamos como deuda explícita.

## Decisión

**Avatar Live2D via `pixi-live2d-display` (wrapper sobre el Cubism SDK oficial) renderizando dentro del componente `<Avatar>` que reemplaza al `<Orb>` en `ConversationScreen` y `AvatarScreen`. Modelo Hiyori (sample del Cubism SDK) como placeholder, descargado manualmente por cada dev. Cap de 30 fps para no presionar el hardware actual. Lip-sync con Web Audio API analizando el `HTMLAudioElement` del TTS. Expresiones mapeadas desde `character.emotions[emotion].avatar_expression`. Si el SDK o el modelo no cargan, `<Avatar>` cae al `<Orb>` automáticamente — el companion sigue funcional sin avatar visual. Modelo definitivo y interacciones avanzadas (eye tracking, touch, overlay) quedan documentados como hitos futuros independientes.**

### 1. `pixi-live2d-display` como lib

`pixi-live2d-display` envuelve el Cubism SDK oficial sobre PixiJS y reduce el código del cliente de ~500 líneas (SDK puro: matrices manuales, shaders, gestión de texturas) a ~50 líneas (load model, attach to PIXI.Application). Wrapper estable, mantenido, con comunidad sólida.

**Por qué no Cubism SDK puro**: control total no aporta valor en V1 — Hiyori es un modelo de sample. Cuando el modelo definitivo llegue (probablemente con expresiones / parámetros que requieran tuning fino), si pixi-live2d-display no expone algo, se puede acceder al modelo interno (`model.internalModel.coreModel`) y manipularlo a mano sin abandonar el wrapper.

**Costo**: PixiJS añade ~150 KB minificado al bundle del cliente. Aceptable.

### 2. Modelo placeholder: Hiyori (sample del Cubism SDK)

Hiyori viene gratis con el Cubism SDK for Web (incluida en el zip oficial), con `.model3.json` + `.moc3` + texturas + 4 expresiones (`smile`, `surprise`, `anger`, `default`). El usuario acepta la **disonancia visual** con Shiro kuudere (Hiyori es energética y cute) durante el período placeholder.

**Mapeo provisional emoción Shiro → expresión Hiyori** (mejor approximación dada la limitación):

| Emoción YAML | `avatar_expression` actual | Hiyori expression file |
| ------------ | -------------------------- | ---------------------- |
| `neutral`    | `idle`                     | `default` (o ninguna)  |
| `divertida`  | `smirk`                    | `smile`                |
| `pensativa`  | `thinking`                 | `default`              |
| `molesta`    | `annoyed`                  | `anger`                |
| `vulnerable` | `soft`                     | `default`              |

Este mapeo vive en el código del `Live2DAvatar` por ahora — cuando llegue el modelo definitivo con expresiones nombradas correctamente (`smirk`, `thinking`, etc.), el componente las usa tal cual y el mapeo intermedio desaparece.

### 3. Reemplaza al Orbe en ambas pantallas, con Orbe como fallback automático

`<Avatar>` decide qué renderizar en mount-time según disponibilidad:

```
                       ┌──────────────────────────┐
<Avatar emotion={…} /> │ ¿Cubism Core JS cargado? │
                       │ ¿Modelo descargado?      │
                       └──────────────────────────┘
                             │            │
                            sí          no/error
                             ▼            ▼
                       ┌──────────┐  ┌─────────┐
                       │ Live2D   │  │ <Orb>   │
                       │ (PIXI)   │  │ (SVG)   │
                       └──────────┘  └─────────┘
```

- **Camino feliz** (devs con setup completo): Live2D renderiza Hiyori.
- **Camino fallback** (devs nuevos sin SDK/modelo, o devs sin GPU): el Orbe se muestra en su lugar. El companion sigue 100% funcional — solo cambia el visual.

El fallback es **automático**: el cliente intenta importar dinámicamente el SDK y cargar el modelo; si cualquiera falla, captura el error, loguea un `info`, y cae al Orbe sin más drama.

**Implicación**: el `<Orb>` no se elimina del código. Vive como módulo independiente. Se le baja el nivel de "componente principal" a "fallback gracioso".

### 4. Cap de 30 fps

PixiJS por defecto usa `requestAnimationFrame` → 60 fps. Para el hardware actual (GTX 1650 con Ollama + Whisper + Letta compitiendo por GPU/CPU), fijamos `ticker.maxFPS = 30`.

**Argumento**:

- 30 fps es suave para una animación de avatar facial — los lip-syncs en Vocaloid 3D usan 30 fps históricamente sin que se note.
- Reduce a la mitad el coste GPU del render.
- Cuando llegue la RTX 5080, el cap se sube a 60 con un cambio de una línea — o se quita.

**Configurable** en `config/modules.config.yaml` como `avatar.config.max_fps` (default 30) para que el usuario lo ajuste sin recompilar.

### 5. Lip-sync con Web Audio API en el cliente

El TTS reproduce el audio con `HTMLAudioElement` en el cliente (ADR 0020). Conectamos ese elemento a un `AudioContext` + `MediaElementAudioSourceNode` + `AnalyserNode`. Cada frame del render del avatar, leemos `analyser.getByteFrequencyData()`, calculamos un RMS / amplitud, y lo mapeamos al parámetro de apertura de boca del modelo (`ParamMouthOpenY` en Live2D).

**Por qué Web Audio en el cliente y no análisis pre-calculado server-side**:

- El audio ya está reproduciéndose en el cliente — analizar el mismo elemento es cero coste extra de red.
- Sincronización exacta: el audio analizado **es** el audio que se oye. Cualquier análisis server-side tendría drift por la latencia del fetch.
- Disponible desde Chrome/Edge/Firefox 35+ — sin polyfills.

**Implementación**: hook `useLipSync(audioElement, model)` que el `<Avatar>` usa cuando recibe el `HTMLAudioElement` del `useTtsPlayback`. Cuando `useTtsPlayback` no expone el element (cliente muted), el lip-sync no se activa — la boca queda cerrada.

### 6. Expresiones desde el character YAML

Hook `useAvatarExpression(bus, model)` que:

1. Escucha `llm:responded { emotion }`.
2. Lee `character.emotions[emotion].avatar_expression`.
3. Llama `model.expression(expressionName)` (API de pixi-live2d-display).

Al recibir `tts:audio-ended`, vuelve a `idle` (la expresión neutral). Si la expresión no existe en el modelo (caso típico con Hiyori que solo tiene 4), cae a `default` con un debug log para que sea trivial diagnóstico cuando llegue un modelo nuevo.

El **character** se pasa al cliente como parte del bootstrap (igual que se hace ya con el snapshot de memoria). El cliente no inventa nada — todo viene del YAML server-side.

### 7. Modelo y SDK fuera del repo, descarga manual

- **Cubism Core SDK**: `Live2DCubismCore.js` (web) y opcionalmente `.dll` (nativo si Tauri lo necesita). Bajado manualmente desde <https://www.live2d.com/sdk/download/web/>. Patrón ya documentado en `.gitignore` y en CLAUDE.md.
- **Modelo Hiyori**: viene dentro del zip del Cubism SDK (`Samples/TypeScript/Demo/public/Resources/Hiyori/`). El dev copia esa carpeta a `packages/desktop/public/live2d/models/Hiyori/`.
- **Documentación nueva en README**: pasos exactos para descargar el SDK + extraer Hiyori + verificar que arranca.
- **Repo limpio sin assets propietarios**: si alguien clona y arranca sin el SDK/modelo, el companion arranca con el Orbe (fallback) sin errores.

### 8. Tests: solo lógicos, verificación visual manual

WebGL no funciona en jsdom (el environment de Vitest). Eso descarta tests visuales del avatar real. Lo que SÍ podemos testear:

- **Mapeo emoción → expresión**: `useAvatarExpression` con un mock de `model.expression`, verificar que el nombre correcto se pasa para cada emoción.
- **Lip-sync wiring**: que el hook conecta el `analyser` cuando el audio empieza, lo desconecta cuando termina.
- **Fallback al Orbe**: el `<Avatar>` con `cubismCore: undefined` renderiza `<Orb>`.

**Verificación visual** (que el modelo se ve, las expresiones cambian visiblemente, el lip-sync coincide con el audio) la hace el usuario en cada PR con la app corriendo. Documentado como contrato en el test plan de cada PR del hito.

### 9. Deferreds explícitos (NO entran en V1)

- **Eye tracking del cursor** — feature visual frecuente en VTubers, requiere capturar `mousemove` global y calcular el ángulo entre el avatar y el puntero. ~50 líneas; queda para un PR posterior cuando el usuario lo pida.
- **Touch / click interactions** (clicks sobre zonas del modelo → reacciones tipo "pat the head") — Live2D models tienen `hit areas` definidas; pixi-live2d-display las expone. Diferido por el mismo motivo.
- **Overlay always-on-top** (el avatar flotando sobre otras apps tipo VTube Studio) — depende del hito Packaging Tauri. Cuando Tauri esté en escena se evalúa.
- **Modelo definitivo de Shiro** — fuera del repo, fuera del proceso de PRs. El usuario decidirá cuándo (comprar en Booth, comisionar custom, etc.) y solo cambia un archivo de config + assets.
- **Avatar 3D (VRM)** post-MVP — el wiring (emit emoción + audio) se reusa idéntico; solo cambia el renderer.

## Alternativas consideradas

- **Cubism SDK puro (sin wrapper PixiJS)**: control total, mínimas deps. Descartado por overhead de código manual (matrices, shaders) que no aporta valor con Hiyori como modelo placeholder. Si el modelo definitivo necesita algo fuera del wrapper, migrar es factible (no es one-way door).
- **Tests visuales con Playwright**: instalar Playwright, levantar Chromium real, comparar screenshots por expresión. Sólido pero overkill para V1 con 2 devs.
- **Avatar reproduciendo lip-sync server-side (análisis del audio antes de mandarlo)**: el server analiza el MP3, manda un timeline de amplitudes, el cliente lo sigue. Más complejo y propenso a drift si el audio se reproduce con latencia variable. Web Audio en cliente es el camino estándar.
- **Mantener el Orbe como avatar principal**: descartado — promesa del roadmap. El Orbe sigue existiendo como fallback gracioso.

## Consecuencias

### Positivas

- **Identidad visual real**: Shiro deja de ser un orbe abstracto y se vuelve un personaje con cara, expresiones, voz sincronizada. El salto perceptual es enorme.
- **Lip-sync coordinated con el TTS**: la boca se mueve al ritmo del audio que ya estamos reproduciendo. Cero coste de red, sincronización perfecta.
- **Fallback robusto**: el repo en GitHub funciona out-of-the-box para cualquiera que lo clone, aunque no tenga el SDK descargado. El Orbe es la red de seguridad.
- **30 fps amigable con la GTX 1650**: el avatar no compite con Whisper/Ollama por GPU. Cuando llegue la 5080, una línea de config sube a 60.
- **Modular**: cambiar el modelo es un cambio de assets sin tocar código. Cambiar de pixi a SDK puro es un cambio de implementación dentro de `Live2DAvatar` sin tocar nada de lo que lo rodea.

### Negativas / Riesgos

- **Dependencia nueva grande**: PixiJS (~150 KB) + pixi-live2d-display + Cubism Core (propietario). Tres piezas más que mantener.
- **Disonancia visual durante el período placeholder**: Hiyori es energética y cute; Shiro es reservada y kuudere. El usuario acepta esa disonancia hasta que llegue el modelo definitivo. Sin fecha estimada para el cambio.
- **Tests visuales delegados al humano**: si una regresión en el render no se nota en review, llega a develop. Mitigación: el dev verifica visualmente cada PR del hito, lo confirma en el test plan.
- **Compatibilidad con Tauri por verificar**: Tauri 2.0 usa WebView2 / WebKit; Live2D + WebGL deberían funcionar pero hay que verificarlo cuando llegue el hito Packaging. No bloqueante ahora.
- **Bundle size del cliente sube**: el desktop pasa de ~256 KB a ~400+ KB minificado. Aceptable para una app desktop, no aceptable si llegara móvil con datos limitados (pero hoy es desktop con HMR).

### Neutrales

- El `<Orb>` se mantiene en el código como fallback. Cero código eliminado, sólo se le baja la prioridad.
- El interface `IAvatarModule` no cambia — `Live2DAvatar` lo implementa tal cual estaba especificado desde ADR 0001.
- El YAML del personaje no cambia — el campo `avatar_expression` ya estaba, solo le damos uso.
- `AvatarScreen` se mantiene como pantalla full-screen del avatar. Su contenido cambia (Orbe → Avatar grande), pero el routing no.

## Notas de implementación

### Estructura propuesta

```
packages/core/src/modules/avatar/
  live2d-avatar.ts          ← IAvatarModule impl (lifecycle: load model, dispose)
  live2d-avatar.test.ts     ← tests lógicos del módulo

packages/desktop/src/avatar/
  Live2DCanvas.tsx          ← componente React que monta PIXI.Application
  useLipSync.ts             ← hook Web Audio API → ParamMouthOpenY
  useAvatarExpression.ts    ← hook bus → model.expression()
  cubism-core.ts            ← carga dinámica del Live2DCubismCore.js
  model-loader.ts           ← carga el .model3.json + texturas
  hiyori-expressions.ts     ← mapeo emoción Shiro → expresión Hiyori (temporal)

packages/desktop/src/components/Avatar/
  Avatar.tsx                ← decide Live2D vs Orb según disponibilidad
  Avatar.module.css

packages/desktop/public/live2d/
  Core/                     ← Live2DCubismCore.js (gitignored, manual)
  models/Hiyori/            ← .model3.json + .moc3 + texturas (gitignored, manual)
```

### Deps a añadir

```bash
npm install pixi.js@^8 pixi-live2d-display -w @proyecto-shiro/desktop
```

### EventMap

No requiere eventos nuevos. El avatar consume eventos existentes:

- `llm:responded { emotion }` → set expression.
- `tts:audio { url }` → conectar lip-sync al elemento.
- `tts:audio-ended` → desconectar lip-sync, volver a expresión idle.

### Config nueva en `modules.config.yaml`

```yaml
avatar:
  active: Live2DAvatar
  config:
    model_path: '/live2d/models/Hiyori/Hiyori.model3.json'
    max_fps: 30
    cubism_core_url: '/live2d/Core/live2dcubismcore.js'
```

### PRs del hito (planificados)

Cada PR es enviable y verificable de forma independiente:

1. **`Live2DAvatar` módulo** — wrapper de pixi-live2d-display, implementa `IAvatarModule`. Tests con SDK mockeado. Sin render todavía.
2. **Render en `<Avatar>` con fallback al Orbe** — componente React, PIXI.Application, cap de 30 fps, carga dinámica del Cubism Core, fallback a Orbe si falla. Documentación de instalación manual.
3. **Lip-sync** — hook `useLipSync` con Web Audio API, integración con `useTtsPlayback`.
4. **Expresiones** — hook `useAvatarExpression`, mapeo Hiyori desde character YAML.
5. **Docs cierre** — README + architecture + CLAUDE + plan reflejan Avatar Live2D ✅, próximo Packaging Tauri.

## Actualización (2026-06-08) — implementación real

Durante la implementación (PRs #51-#53 y el del lip-sync) la realidad divergió de la decisión original en tres puntos. Se documentan aquí en vez de reescribir el cuerpo del ADR (que captura el pensamiento del momento).

### 1. Librería: `pixi-live2d-display-lipsyncpatch`, no `pixi-live2d-display`

La decisión nombró `pixi-live2d-display` (guansss) sobre **PixiJS v8**. En la práctica esa librería **no soporta PixiJS v8 ni el Cubism Core nuevo**: el render crashea con `Cannot read properties of undefined (reading '0')` en `CubismRenderer_WebGL.doDrawModel`. Se adoptó el fork **`pixi-live2d-display-lipsyncpatch@0.5.0-ls-8`** sobre **PixiJS v7**, que parchea ese bug y trae soporte de lip-sync. El wiring del avatar (emoción + audio) no cambia; solo el renderer interno y la API de Pixi (`app.view` v7).

### 2. Cubism Core: versión 4.2.2 (SDK 4), NO la del SDK 5

El Cubism Core es propietario y cada dev lo descarga manualmente. El Core que trae el **SDK for Web 5** reporta versión **6.0.1** y **crashea** el renderer del fork. El que funciona es el del **SDK for Web 4** (Core **4.2.2**). Como el Core está gitignored, dos devs con SDKs distintos obtienen resultados distintos ("me funciona en mi máquina"). **El README fija la versión 4.2.2 como requisito.** Migrar a un stack que soporte Core 6 (p.ej. `@naari3/pixi-live2d-display` sobre Pixi v8) queda como posible ADR futuro.

### 3. Lip-sync (§5): implementado, e idle OFF por default

El lip-sync se implementó como describe la §5: hook `useLipSync` que conecta el `HTMLAudioElement` del TTS (`useTtsPlayback` lo expone con `crossOrigin="anonymous"` para que el análisis cross-origin no quede tainted) a un `AnalyserNode`, y mapea la amplitud RMS del espectro a `ParamMouthOpenY` cada frame. Hallazgo: **las motions idle de Hiyori tocan `ParamMouthOpenY`** y compiten con el lip-sync (la boca parece desincronizada). Por eso `idle_animation` pasa a **`false` por default** (el modelo igual respira y parpadea, managers aparte) y `autoUpdate` es siempre `true` (necesario para que el parámetro se aplique al mesh; la idle se apaga vía `idleMotionGroup`). Eye tracking, touch y expresiones por emoción (PR #4) siguen pendientes.

## Referencias

- [ADR 0009](0009-orbe-placeholder-avatar.md) — Orbe placeholder. Este ADR supersede su rol primario pero mantiene el Orbe como fallback.
- [ADR 0010](0010-wiring-cliente-core-eventbus.md) — wiring cliente↔core, base del hook `useAvatarExpression`.
- [ADR 0014](0014-llm-structured-output-text-emotion.md) — LLM emite `{ text, emotion }`. La emoción es la fuente de verdad para el avatar.
- [ADR 0020](0020-tts-elevenlabs-systemtts-fallback-y-multidevice-diferido.md) — `tts:audio` con el URL del audio, fuente del lip-sync.
- [Cubism SDK for Web](https://www.live2d.com/sdk/download/web/) — descarga oficial del SDK.
- [pixi-live2d-display](https://github.com/guansss/pixi-live2d-display) — wrapper.
- [`character/characters/default.yaml`](../../packages/core/src/character/characters/default.yaml) — fuente de `avatar_expression` por emoción.
