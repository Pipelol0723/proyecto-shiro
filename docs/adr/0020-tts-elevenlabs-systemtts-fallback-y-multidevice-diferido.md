# ADR 0020: TTS — ElevenLabs primary + SystemTTS fallback, in-process en core-host, audio en el cliente en V1

- **Status**: Accepted
- **Fecha**: 2026-06-03
- **Decidido por**: Pipelol0723

## Contexto

Cerrado el hito **STT** (ADR 0019), toca el hito **TTS** — salida de voz. La interfaz [`ITTSModule`](../../packages/core/src/interfaces/ITTSModule.ts) ya existe y define `synthesize(request)` con `{ text, emotion, voiceId }` → `{ audio: Buffer, duration?, mimeType }`. El slot `tts` del `modules.config.yaml` está reservado con `ElevenLabsTTS` activo, `KokoroTTS` y `SystemTTS` como fallback chain, voz vacía y parámetros placeholder. Hoy ningún módulo TTS real existe — la cadena de fallback nunca se ejecuta.

El plan original (`plan-modular-ai-companion.md`) menciona la cadena **ElevenLabs → Kokoro → SystemTTS**. Lo revisamos a la luz del contexto actual:

### Personaje (lo que pide el YAML)

- **Shiro es kuudere**: reservada, analítica, tranquila, sarcasmo sutil. `dislikes` incluye explícitamente `sonar artificial o corporativa` y `entusiasmo falso`.
- Los `tts_stability` por emoción del `default.yaml` están en 0.55-0.88 (rango **alto**, voz **consistente**, baja expresividad).
- Edad aparente ~20, femenino. El YAML pide voz que admita matiz emocional sutil sin caer en exageración.

### Restricciones reales

- **Hardware en transición**. GTX 1650 4 GB hoy con VRAM saturada por Whisper + Ollama (`qwen2.5:3b`) + Letta embeddings. Cualquier modelo TTS local pesado entra en CPU o no entra. La RTX 5080 16 GB llega más adelante.
- **Multi-device declarado pero diferido**. El usuario quiere a futuro escuchar a Shiro desde varios dispositivos (desktop + móvil + IoT/bridge). En V1 solo existe el cliente desktop y no hay urgencia.
- **Sin voz custom grabada**. No hay 30-60 min de muestras para entrenar voces locales (Piper) ni 5-10 s para clonar (XTTS).
- **Latencia no crítica en V1**. La conversación con Shiro no es turnos rápidos en cascada; un par de segundos extra es aceptable.
- **Cuota / coste**. ElevenLabs cobra por caracteres: free tier (10k chars/mes), Starter ($5/mes 30k), Creator ($22/mes 100k). El usuario asume el coste.
- **Identidad de voz**. Shiro debería tener una voz **única, no genérica**. ElevenLabs ofrece Voice Library + Voice Design + Voice Remix → permite buscar o construir una voz a medida sin grabar.

## Decisión

**TTS server-side directo en `core-host` con dos implementaciones: `ElevenLabsTTS` (primary, cloud) y `SystemTTS` (fallback, voz del OS). En V1 el audio se transporta del server al cliente desktop a través del bus y se reproduce ahí. La voz sintética artificial (estilo Vocaloid/UTAU/Defoko) y el multi-device real (broadcast a múltiples clientes) se documentan como hitos futuros independientes que se abrirán cuando llegue la RTX 5080.**

### 1. ElevenLabs como primary, SystemTTS como único fallback

`ElevenLabsTTS` cubre el caso normal: cloud, voz neuronal expresiva, alta calidad, soporte multilingüe. Si falla por cualquier motivo (sin internet, cuota agotada, API key inválida, 5xx del provider), `SystemTTS` toma el turno usando la voz del sistema operativo (`say.js` en macOS/Linux, SAPI en Windows). La cadena se reduce de tres a dos: **se descarta Kokoro**.

Por qué descartamos Kokoro:

- **No es necesario para cubrir "modo offline"**. SystemTTS ya da garantía de audio sin internet.
- **El hito de voz sintética/Vocaloid post-5080 cubre el caso "TTS local con identidad"**. Mantener Kokoro como capa intermedia añade complejidad sin diferenciar — su voz neuronal sería peor que ElevenLabs y menos artística que UTAU.
- **Una capa menos = menos código que mantener y testear**.

### 2. Topología in-process en `core-host` (no microservicio aparte)

`ElevenLabsTTS` vive en `packages/core/src/modules/tts/elevenlabs-tts.ts`. Es un cliente del API HTTP REST de ElevenLabs usando `fetch` global (`@elevenlabs/elevenlabs-js` o llamadas crudas — decisión a nivel implementación). Corre dentro del proceso `core-host`, exactamente como `OllamaLLM` y `AnthropicLLM`.

`SystemTTS` también in-process en `core-host`. Usa `say.js` o equivalente; se genera el audio a un buffer/blob, no se reproduce directamente desde el host (ver decisión 3).

Por qué NO microservicio aparte (como Whisper):

- ElevenLabs es un API REST trivial — su SDK son ~20 líneas. Envolverlo en un contenedor Docker es overkill arquitectónico que no aporta valor.
- No requiere CUDA, GPU, ni dependencias pesadas (Whisper sí).
- La latencia es menor sin el hop extra.
- La **API key** queda confinada al `core-host` server-side. Si el TTS fuera un microservicio HTTP en otro proceso, habría que decidir cómo viaja la API key. In-process la mantiene en `process.env` del único proceso que la necesita.

**Asimetría aceptada con el hito futuro**: cuando llegue UTAU/voz sintética post-5080, ESE sí será un microservicio aparte (Python + voicebanks + motor headless), siguiendo el mismo patrón que Whisper. Vivirán en `services/tts-synth/` o similar. El módulo `SynthTTS` en core sería entonces un cliente HTTP de ese microservicio. La asimetría refleja la realidad: **cloud APIs in-process, motores locales pesados en microservicio**. Las dos formas conviven sin tensión.

### 3. Audio en V1: server genera, cliente reproduce

Para mantener el principio del proyecto (todo el cómputo en el `core-host`, los clientes son delgados), el server **genera el audio** pero **el cliente lo reproduce**. El flujo concreto:

1. `core-host` recibe `llm:responded { text, emotion, userId }`.
2. Pipeline conversacional llama `tts.synthesize({ text, emotion })`. Devuelve `{ audio: Buffer, duration, mimeType }`.
3. `core-host` guarda el buffer en una cache en memoria con un id único (`audioId`), TTL ~60 s.
4. `core-host` expone un endpoint HTTP `GET /audio/:audioId` que sirve el buffer con el mimeType correcto.
5. `core-host` emite `tts:audio { url, duration, mimeType, audioId, userId }` al bus.
6. El cliente desktop recibe el evento, hace `fetch(url)`, crea un `HTMLAudioElement` y lo reproduce.
7. Cuando termina, el cliente emite `tts:audio-ended { audioId, userId }` al bus.
8. El cache del server borra el buffer pasado el TTL o tras un `audio-ended` recibido.

Por qué URL HTTP en lugar de bytes por el bus:

- El wire-schema actual del bus es JSON. Mandar bytes binarios requeriría base64-encode (+33% tamaño y latencia) o cambiar el schema.
- Sólo los clientes que reproducen necesitan los bytes; el resto se ahorra el download.
- Cancelación es trivial: server invalida el `audioId`, cualquier fetch posterior recibe 410, el cliente que ya tenía el audio simplemente lo `pause()`.

### 4. Cancelable mid-speech

El usuario puede interrumpir a Shiro hablando (con voz o con texto). El cliente emite `tts:cancel { audioId, userId }` al bus cuando detecta input nuevo durante un `speaking: true`. El server invalida el `audioId` y emite `tts:cancel` de vuelta — clientes que estén reproduciendo ese id hacen `audio.pause(); audio.src = '';`. El reducer del cliente ya tiene `SPEAK_END` que limpia el estado; reusamos el camino añadiendo `TTS_CANCELLED` (o dispatcheamos `SPEAK_END` directamente desde el handler de `tts:cancel`).

Esto es **necesario para conversación natural** — sin esto, si el usuario corrige mid-frase tendría que esperar a que Shiro termine de hablar lo que ya es obsoleto.

### 5. Mapeo emoción → parámetros de TTS desde el YAML del personaje

El YAML actual (`default.yaml`) ya tiene un bloque `emotions:` con `tts_stability` por emoción:

```yaml
emotions:
  neutral: { tts_stability: 0.75 }
  divertida: { tts_stability: 0.65 }
  pensativa: { tts_stability: 0.82 }
  molesta: { tts_stability: 0.88 }
  vulnerable: { tts_stability: 0.55 }
```

`ElevenLabsTTS.synthesize()` lee la emoción del request y consulta `character.emotions[emotion].tts_stability` para componer el `voice_settings.stability` enviado a ElevenLabs. Los demás parámetros (`similarity_boost`, `style`, `use_speaker_boost`, `model_id`) son **constantes** por voz, viven en `config/modules.config.yaml`:

```yaml
tts:
  active: ElevenLabsTTS
  fallback_chain:
    - SystemTTS
  config:
    voice_id: '<elegido tras Voice Design del usuario>'
    model_id: 'eleven_multilingual_v2'
    similarity_boost: 0.78
    style: 0.15 # bajo — Shiro no exagera
    use_speaker_boost: true
```

`SystemTTS` ignora la emoción (la voz del OS no la modula); registra un debug log cuando la recibe para que más adelante sea trivial añadirle un mapeo de pitch/rate si vale la pena.

### 6. Voice ID — placeholder hasta exploración de Voice Design

El usuario va a usar **Voice Design / Voice Remix de ElevenLabs** para construir una voz custom alineada con Shiro (kuudere, joven adulta, calmada, sarcasmo sutil) en lugar de elegir del catálogo. Hasta que termine esa exploración, el ADR documenta como **placeholders aceptables**:

- **Sarah** (`EXAVITQu4vr4xnSDxMaL`) — suave, joven adulta, calmada. El default más seguro mientras tanto.
- **Aria** (`9BWtsMINqrJLrRacOk9x`) — cálida con expresividad ligeramente mayor; útil si la "Shiro divertida" debe sonar a sonrisa contenida.

El voice_id real entra en `config/modules.config.yaml` cuando el usuario lo decida. Cambiar de voz no requiere cambios de código — solo el YAML.

### 7. Multi-device diferido como hito independiente

V1 asume un solo cliente reproduciendo audio. Cuando se añada un segundo cliente (móvil, IoT bridge), aparecen problemas reales:

- **Echo**: si dos clientes en la misma habitación reproducen simultáneamente, se solapan.
- **Selección de cliente activo**: ¿cuál cliente "es" el output de voz cuando hay varios?
- **Sincronización**: si un cliente arranca tarde, ¿reproduce desde el principio o se salta lo perdido?

La topología elegida (URL HTTP servida por core-host) **ya soporta multi-device** en el camino feliz: cualquier cliente que reciba `tts:audio` puede hacer `fetch(url)` y reproducir. Lo que falta es la **lógica de selección** — un toggle "🔊 oír audio" por cliente y una política para evitar echo. Eso se diseña en su propio ADR cuando aparezca el primer cliente adicional.

En el código de V1 dejamos el patrón "cualquier cliente puede reproducir" y el primer cliente conectado tiene audio activo por defecto.

### 8. Streaming del LLM al TTS (deferred)

ElevenLabs soporta streaming del audio (genera mientras va sintetizando) y el LLM también emite `llm:chunk`. Encadenarlos permitiría que Shiro **empiece a hablar antes de que termine de pensar** — reduce la latencia perceptual del primer fonema en frases largas.

En V1 **NO** lo hacemos. Razones:

- La interfaz `ITTSModule` ya define `synthesizeStream?` opcional; el contrato deja la puerta abierta.
- El cliente actual no tiene infraestructura para reproducir streams incrementales (necesita MediaSource Extensions o Web Audio API con buffer chaining).
- La latencia de V1 (1-3 s) con `eleven_multilingual_v2` es aceptable para conversación contemplativa con Shiro. Una kuudere que toma su tiempo no sufre por arrancar 800 ms después.

Cuando llegue valor concreto (queja real del usuario sobre latencia, o necesidad para Avatar Live2D con lip-sync), se abre un ADR para diseñar el streaming end-to-end y se implementa `synthesizeStream` en `ElevenLabsTTS`.

## Alternativas consideradas

- **Kokoro como fallback intermedio entre ElevenLabs y SystemTTS**: descartado. SystemTTS ya garantiza audio offline; Kokoro añadía complejidad sin diferenciar lo suficiente. La voz sintética/UTAU post-5080 cubre el nicho "TTS local con identidad" mejor que Kokoro.
- **Microsoft Edge TTS gratis (cloud)** como fallback intermedio: descartado por el usuario. Razonable, pero mete dependencia de un endpoint no-oficial que podría desaparecer.
- **TTS como microservicio aparte (Docker)** como Whisper: descartado. ElevenLabs no merece la complejidad operativa. UTAU/voz sintética post-5080 sí merece y será microservicio.
- **Audio reproducido server-side** (altavoces del PC del usuario): descartado. Funciona para un solo PC, pero rompe el principio de cliente delgado y bloquea multi-device futuro. La opción de "una vez que el server reproduce, los clientes solo ven la transcripción" es viable pero peor.
- **Web Speech API (`speechSynthesis`) del browser como SystemTTS**: descartado por consistencia con el principio "todo el cómputo en server". También para que el fallback funcione idéntico cuando llegue el cliente móvil (que también tendrá Web Speech, pero coordinar dos paths es complejidad innecesaria).
- **Voice cloning con XTTS / F5-TTS**: descartado en V1 por hardware y por la decisión de no grabar muestras. Reservado para post-5080 si la voz sintética/UTAU no termina dando el feel deseado.
- **Streaming LLM→TTS encadenado en V1**: descartado por complejidad de reproducción incremental en el cliente. Diferido a su propio ADR.

## Consecuencias

### Positivas

- **Setup operacional mínimo**: el usuario añade `ELEVENLABS_API_KEY` a `.env`, instala `say.js` (o equivalente OS), y arranca `npm run dev`. No hay Docker nuevo, no hay servicios extra.
- **Identidad del personaje cubierta sin esfuerzo de grabación**: ElevenLabs Voice Design permite construir una voz custom de Shiro sin necesidad de actor de voz ni equipo de grabación.
- **Cero acoplamiento al cliente**: el cliente solo necesita conocer la URL y reproducir un MP3. Cuando llegue el cliente móvil (RN o Tauri Mobile), el mismo flujo aplica.
- **Cadena de fallback simple y robusta**: dos eslabones, fácil de razonar y testear. SystemTTS garantiza que Shiro **siempre** tiene voz aunque ElevenLabs caiga.
- **El YAML del personaje sigue siendo la fuente de verdad** para emociones — añadir una emoción nueva al avatar y al TTS es un solo cambio.

### Negativas / Riesgos

- **Dependencia del cloud y de la cuota de ElevenLabs**: el bolsillo del usuario es el límite. Si la cuota se acaba a mitad de mes, SystemTTS toma el turno y la experiencia degrada.
- **No hay TTS local con identidad hasta post-5080**: el fallback SystemTTS sonará genérico y romperá la inmersión del personaje. Aceptable porque es fallback de emergencia, no la experiencia primaria.
- **Multi-device queda como deuda explícita**: el patrón está preparado pero la lógica de "qué cliente reproduce" no existe. Si el usuario añade un segundo cliente antes de que se diseñe, habrá echo.
- **Latencia perceptual de 1-3 s**: aceptable para Shiro (personaje contemplativo) pero notoria si en algún momento se persigue conversación de turnos rápidos.
- **API key viaja por HTTPS a ElevenLabs**: aunque server-side, una intrusión en `core-host` la expone. Standard risk de toda app con API key cloud.

### Neutrales

- El campo `synthesizeStream?` del `ITTSModule` queda como opcional sin implementar — futuro hito.
- El cache de audio en memoria del server crece linealmente con turnos en cola; el TTL de 60 s lo mantiene acotado. Si pasa a ser problema, se mueve a disk (`/tmp/audio/`) sin cambiar el bus.
- El módulo de Voice Design / Remix de ElevenLabs no es parte del código del proyecto — es trabajo manual del usuario en la web de ElevenLabs. Solo el `voice_id` resultante entra al repo.

## Notas de implementación

### Eventos del bus que añadimos

```ts
// packages/core/src/types/events.ts (EventMap)
'tts:audio': {
  url: string;        // p. ej. http://localhost:9876/audio/abc123.mp3
  audioId: string;    // id del cache server-side
  duration: number;   // ms, para sincronizar lip-sync
  mimeType: string;   // 'audio/mpeg', 'audio/wav', etc.
  userId: string;
};
'tts:cancel': { audioId: string; userId: string };
// 'tts:audio-ended' ya existe; añadir `audioId?` opcional al payload.
```

### Cambios en el HTTP server del core-host

El `core-host` actualmente expone solo el WebSocket en `/bus`. Hay que añadir un router HTTP simple para `GET /audio/:audioId.:ext`. La implementación más limpia es montar el WS sobre un `http.Server` Node y servir las rutas de audio en el mismo. Buffer-cache en memoria con `Map<audioId, { buffer, mimeType, expiresAt }>` y un timer que limpia entradas vencidas.

### Cambios en `config/modules.config.yaml`

Sustituir el bloque actual del slot `tts` por la versión post-decisión (quitar `KokoroTTS`, añadir `style` y `use_speaker_boost`, dejar `voice_id` como placeholder explícito). Esto entra en su propio PR junto con la actualización de docs (`README`, `architecture.md`, `CLAUDE.md`).

### Cambios en `packages/desktop/`

- `useCompanionState`: añadir handler de `tts:audio` que dispare reproducción + `tts:cancel` que la pare.
- Nuevo hook `useTtsPlayback(bus)` que encapsula `HTMLAudioElement` + listeners.
- `ConversationScreen`: toggle de mute por cliente (UI nueva, persistencia en localStorage). Default `true` para el primer cliente conectado y `false` para los demás cuando exista lógica de "cliente activo".

### Cambios en el pipeline conversacional

`packages/core-host/src/pipeline/conversation-flow.ts` recibe el `tts` cargado por el `ModuleLoader`. Añadir el paso de síntesis después del `llm:responded` (intentar `tts.synthesize`, capturar errores, caer al fallback, emitir `tts:audio` o `tts:audio-ended` directo si todo falla).

### Tests

- Unit: `ElevenLabsTTS` con fetch mockeado (caminos felices + 401 + 429 cuota + 5xx).
- Unit: `SystemTTS` con `say.js` mockeado.
- Integration en `core-host`: pipeline con TTS mockeado verificando que `tts:audio` aparece tras `llm:responded`, que `tts:cancel` invalida el audioId, y que el fallback se activa si primary lanza.
- Desktop: hook `useTtsPlayback` con `HTMLAudioElement` mockeado.

## Referencias

- [ADR 0001](0001-arquitectura-modular-event-driven.md) — arquitectura modular event-driven.
- [ADR 0012](0012-split-cliente-server-core-host.md) — split cliente/server.
- [ADR 0014](0014-llm-structured-output-text-emotion.md) — el LLM emite `{ text, emotion }`, base del mapeo emocional.
- [ADR 0016](0016-pipeline-conversational-wiring.md) — pipeline conversacional en core-host (dónde se enchufa el TTS).
- [ADR 0019](0019-stt-faster-whisper-microservicio-python.md) — patrón "microservicio aparte" del STT (que aquí NO seguimos para ElevenLabs, pero SÍ seguiremos para UTAU post-5080).
- ElevenLabs Voice Design: https://elevenlabs.io/voice-lab
- `default.yaml` del personaje Shiro: [packages/core/src/character/characters/default.yaml](../../packages/core/src/character/characters/default.yaml)
