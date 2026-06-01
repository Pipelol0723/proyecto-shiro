# ADR 0019: STT — microservicio Python con faster-whisper, push-to-talk + VAD opcional, partials visuales

- **Status**: Accepted
- **Fecha**: 2026-05-31
- **Decidido por**: Pipelol0723

## Contexto

Cerrado el hito Memoria (ADRs 0017–0018), toca el hito **STT** — entrada de voz. La interfaz [`ISTTModule`](../../packages/core/src/interfaces/ISTTModule.ts) ya existe (de la fase Core) y define `transcribe(request)` + `transcribeStream?(audioChunks, language)` con un `STTResult { text, confidence?, isFinal }`. El slot `stt` del `modules.config.yaml` está reservado y hoy lo cubre un `NoopSTT`. Falta la implementación real.

El objetivo del hito V1: el usuario habla por el micrófono → ve la transcripción en vivo en el subtítulo → al soltar la tecla (o cuando VAD detecta silencio) el texto se manda como `user:message` y arranca el pipeline conversacional normal. Texto sigue funcionando igual; voz es input adicional.

### Restricciones reales

- **Local-first**. El proyecto mantiene LLM y memoria locales (Ollama, Letta + Ollama embeddings). El STT debe encajar — no aceptamos mandar audio a la nube por defecto.
- **Hardware en transición**. Dev principal: GTX 1650 4 GB hoy, RTX 5080 16 GB próximamente. Build nuevo cabe holgado; el actual está ajustado con `qwen2.5:3b` + Letta embeddings.
- **Modelos populares de Whisper**: `tiny`/`base`/`small`/`medium`/`large-v3` y `distil-large-v3`. Tamaños van de ~40 MB a ~1.5 GB. Calidad y latencia escalan con el tamaño.
- **Ecosistema Node de Whisper** (whisper.cpp bindings) está menos maduro que el Python (faster-whisper + CTranslate2), que es la implementación canónica con CUDA nativo y ~4× más rápido que openai-whisper original.
- **Multi-cliente futuro**. Mismo patrón que ADRs 0012–0013: cualquier cliente futuro (móvil, robot) debe poder usar STT enviando audio al mismo microservicio. La arquitectura tiene que dejar esa puerta abierta.
- **Captura de audio vive en el cliente**, no en el server. Web Audio API + `MediaRecorder` en el desktop; el robot/móvil futuro lo hará con sus propios mecanismos.

## Decisión

**Microservicio Python con faster-whisper (modelo `small` por defecto, switch a `large-v3` vía YAML), conexión WebSocket directa cliente↔microservicio, push-to-talk como activación primaria con Silero VAD opcional para modo hands-free, partials visuales en vivo, empaquetado Docker, GPU automática con fallback CPU. La "respuesta temprana del LLM" (especulación con parciales) queda fuera de este hito como deuda explícita para un hito futuro post-TTS.**

### 1. Microservicio Python con faster-whisper

Servicio aparte (`services/whisper/`) sobre Python 3.11 + faster-whisper + FastAPI/WebSocket. Escucha en `:8765`, recibe chunks de audio, transcribe en streaming y devuelve resultados parciales y finales.

Mismo patrón operativo que Letta: contenedor Docker de larga vida que se arranca aparte del `npm run dev`. Healthcheck HTTP en `/health`.

### 2. Modelo `small` por defecto, switch a `large-v3` vía YAML

`config/modules.config.yaml` (slot `stt.config`) trae el nombre del modelo. `small` (~244 MB) cabe holgado en la GTX 1650 actual junto con `qwen2.5:3b` y los embeddings de Letta. Calidad muy decente en español. Cuando el hardware nuevo esté listo, cambiar a `large-v3` (~1.5 GB) o `distil-large-v3` es una sola línea — el microservicio recarga el modelo al recibir SIGTERM/restart.

### 3. Topología: cliente desktop → microservicio directo

El desktop abre un WebSocket directamente al microservicio (`ws://localhost:8765/stt`). Los chunks de audio van por ese WS; los `stt:partial` y `stt:transcribed` vuelven por el **mismo** WS al desktop, que los re-emite al bus del core-host (vía el `WebSocketTransport` cliente que ya existe).

Esto preserva la regla del proyecto: **los eventos `user:*` y de input siempre los origina el cliente**. El microservicio nunca habla directo con el core-host — es el cliente quien traduce "transcripción final" en `user:message`. Coherente con cómo el cliente ya emite `user:message` al tipear.

Beneficio operativo: menos hops para el audio. El core-host no es un cuello de botella para chunks binarios de audio en tiempo real.

### 4. Push-to-talk + Silero VAD opcional

**Modo por defecto**: push-to-talk con tecla configurable (default `Space` mientras el foco está en el chat). Mientras se mantiene, captura audio; al soltar, envía marker de fin de turno al microservicio y espera `stt:transcribed` final.

**Modo hands-free**: toggle en settings para activar **Silero VAD** (port JS vía ONNX Web, `@ricky0123/vad-web` o equivalente). El VAD escucha continuamente; cuando detecta `speech_start` empieza captura, cuando detecta silencio sostenido (configurable) corta. Silero usa deep learning — distingue voz de ruido ambiental (música, teclado) mucho mejor que WebRTC VAD heurístico, a coste de ~2 MB extra del modelo en el bundle.

Push-to-talk es el camino seguro para empezar; el VAD se activa por preferencia del usuario y vive detrás del mismo flujo (cuando arranca/termina, el efecto es idéntico al de mantener/soltar la tecla).

### 5. Streaming visual de partials

El microservicio emite `stt:partial { text, userId }` mientras transcribe (frecuencia ~10 Hz típica). El cliente desktop ya tiene el reducer `STT_PARTIAL` que pinta el texto en el subtítulo — no hace falta cambiar UI. Al soltar (o al cortar el VAD), el microservicio emite `stt:transcribed { text, userId, isFinal: true }` con el resultado final, y el cliente:

1. Despacha `STT_FINAL` al reducer (apaga `listening`, limpia `sttLive`).
2. **Emite `user:message`** con el texto final. Esto entra al pipeline conversacional como si el usuario hubiera tipeado: el LLM responde con normalidad, la memoria registra el turno, etc.

**Respuesta temprana del LLM (deuda explícita)**: el usuario pidió que el LLM pudiera empezar a procesar mientras el usuario habla. Es una optimización útil pero requiere diseño propio (cuándo disparar el LLM, cómo manejar respuestas tentativas que pueden invalidarse al llegar el final, UI que diferencie tentativa de definitiva). Se trata como **hito futuro independiente** post-TTS — necesita su ADR. En este hito no se aborda.

### 6. Empaquetado Docker

El microservicio se distribuye como imagen Docker (`shiro-whisper` localmente; en su `services/whisper/Dockerfile`). El `docker-compose.yml` raíz gana el servicio:

```yaml
whisper:
  build: ./services/whisper
  restart: unless-stopped
  ports: ['8765:8765']
  volumes:
    - whisper-models:/root/.cache/huggingface
  environment:
    WHISPER_MODEL: small
    WHISPER_LANGUAGE: es
    WHISPER_COMPUTE_TYPE: auto # GPU si hay, CPU si no
  deploy:
    resources:
      reservations:
        devices:
          - capabilities: [gpu] # opcional; Docker Desktop con WSL2 lo soporta
```

Volumen persistente para el cache de modelos (descarga única, sobrevive a `docker compose down`). La imagen incluye `nvidia/cuda` base para que `pip install ctranslate2[cuda12]` funcione cuando hay GPU; sin GPU, faster-whisper cae a CPU automáticamente.

### 7. GPU auto, fallback CPU

`WHISPER_COMPUTE_TYPE=auto` deja que faster-whisper detecte CUDA. En la GTX 1650 actual `small` cabe en CUDA junto con `qwen2.5:3b` (5 GB) y los embeddings (1 GB), aunque ajustado — ~9-10 GB usados, queda margen. En la 5080 (16 GB) sobra para `large-v3`. Sin CUDA, el modelo `small` corre razonable en CPU (~3-5× tiempo real con `int8` quantization).

### 8. `WhisperSTT` cliente en `@proyecto-shiro/core`

El módulo `WhisperSTT` que implementa `ISTTModule` vive en `packages/core/src/modules/stt/whisper-stt.ts`. Su rol es **acotado**: cliente HTTP del microservicio para `ping()`/healthcheck en el arranque del core-host y para llamadas batch (`transcribe(buffer)`) que ningún flujo principal usa hoy pero quedan disponibles para tests/CLI o invocaciones programáticas futuras.

El audio en tiempo real **no pasa por el core-host**: lo maneja el cliente desktop directamente (decisión 3). El `WhisperSTT` del core-host solo se entera del microservicio para verificar que está vivo y reportarlo al log.

### 9. `agent_id`-equivalente: no hay

A diferencia de Letta, faster-whisper no requiere un "agente" preexistente. Cada conexión WS abre una sesión de transcripción independiente. Sin estado persistente del lado del microservicio (los modelos sí se cachean, pero las sesiones son efímeras).

## Alternativas consideradas

### Sobre el motor de STT

- **Cloud API (OpenAI Whisper API, Anthropic, Google Cloud)**: descartada. Rompe el local-first del proyecto, cuesta dinero por minuto procesado y manda audio del usuario a un tercero. Para un companion que aspira a ser **íntimo** y **siempre disponible** es contraproducente.
- **Whisper.cpp con Node bindings** (`@xenova/transformers.js` o `nodejs-whisper`): descartada. La performance con CUDA es notablemente peor que faster-whisper (CUDA via CTranslate2). Los bindings de Node a whisper.cpp tienden a quedar desactualizados o no soportar features nuevas (distil-models, batched inference). Más mantenimiento por menos.
- **Vosk / DeepSpeech / Mozilla TTS**: descartadas. Calidad inferior a Whisper en español, ecosistemas menos activos.

### Sobre el modelo

- **`tiny` o `base`** (40-74 MB): descartados. Calidad notablemente peor en español; falsos positivos altos.
- **`large-v3` directo**: descartado de momento. No cabe junto con qwen + embeddings en la GTX 1650 actual. Cuando llegue la 5080 se cambia el YAML.
- **`distil-large-v3`**: candidato fuerte para el switch futuro — ~50% más rápido que `large-v3` con calidad casi idéntica. Lo dejamos para evaluación cuando el hardware lo permita.

### Sobre la topología

- **Cliente → core-host → microservicio**: descartada. Añadiría un hop de proxy para cada chunk de audio (bytes binarios), saturando el WebSocket del core-host innecesariamente. El microservicio puede aceptar conexiones de N clientes igual de bien.
- **Cliente sube blob HTTP al soltar la tecla** (sin streaming): descartada por la decisión de partials visuales. Sin streaming no hay `stt:partial`.
- **gRPC entre cliente y microservicio**: descartada. WebSocket es lo que ya conoce el desktop (transporte hacia el core-host); reutilizar minimiza fricción. gRPC en navegador requiere `grpc-web` y otra capa.

### Sobre la activación

- **Solo push-to-talk** (sin VAD): descartado como decisión final aunque es el modo por defecto. El usuario explícitamente pidió híbrido y el VAD añade valor real para sesiones largas hands-free.
- **Solo VAD continuo** (sin tecla): descartado. Falsos positivos altos en entornos ruidosos; necesitas un fallback manual cuando el VAD se equivoca o cuando el usuario quiere hablar sin que el dispositivo esté siempre escuchando.
- **Wake word ("Hey Shiro")**: aplazado. Es una capa encima del VAD que vale la pena cuando el companion sea más "asistente ambient". Para el desktop con foco activo, push-to-talk + VAD bastan.

### Sobre el VAD

- **WebRTC VAD** (heurístico de energía + zero-crossing): descartado. Funciona pero da más falsos positivos con música/ventilador/teclado. Silero es solo ~2 MB extra para ganar mucho en precisión.
- **Sin VAD en el cliente, delegar al microservicio**: descartado. Tendríamos que streamear audio constante al microservicio aunque no haya voz. Drena ancho de banda y batería sin razón.

### Sobre el empaquetado

- **`pip install faster-whisper` en un `services/whisper/` con README**: descartado por la fricción de mantener Python + CUDA toolkit a mano en Windows. Docker resuelve los dos.
- **Imagen oficial de algún proveedor**: no encontramos una de faster-whisper oficial bien mantenida. Construir la propia (Python 3.11 + faster-whisper + uvicorn) es ~30 líneas de Dockerfile.

### Sobre el hardware

- **CPU forzado siempre**: descartado. Latencia inaceptable con `medium`/`large` en CPU; aunque para `small` es viable, queremos aprovechar la GPU cuando esté.
- **GPU forzado, error si no hay CUDA**: descartado. Penaliza al onboarding (un dev sin GPU no puede probar el flujo). Auto detecta y degrada.

### Sobre la respuesta temprana del LLM

- **Hacerla en este hito**: descartada (ver decisión 5). Es trabajo significativo con su propio set de decisiones (cuándo disparar, cómo cancelar, UI). Se planifica en un hito futuro post-TTS con su propio ADR.

## Consecuencias

### Positivas

- **Local-first preservado**: el audio nunca sale del dispositivo del usuario (queda en `localhost`). Coherente con la promesa del proyecto.
- **Patrón conocido**: mismo modelo operativo que Letta (Docker, servicio de larga vida, healthcheck). El usuario ya tiene la disciplina; no hay sorpresas operacionales.
- **Calidad alta esperable**: faster-whisper `small` en español tiene WER ~8-10%, suficiente para chat conversacional. Subir a `large-v3` con la 5080 cierra la brecha con el cloud.
- **Streaming visual barato**: la UI ya está cableada (reducer tiene `STT_PARTIAL` desde la fase Cliente Desktop). El feedback inmediato mejora la sensación de respuesta sin tocar el LLM.
- **Multi-cliente listo**: cuando llegue móvil/robot, conectan al mismo microservicio. No hay que rediseñar.
- **Switch de modelo barato**: cambiar `small` → `large-v3` en el YAML y reiniciar el contenedor. Sin recompilar nada.

### Negativas / Riesgos

- **Otro servicio que mantener**: Docker, modelo cacheado en volumen, healthcheck. La superficie operativa crece (Letta + Whisper).
- **Captura de audio en navegador**: pide permiso al usuario (`getUserMedia`), depende de HTTPS o `localhost`. Documentado en el README del hito.
- **Cold start del modelo**: la primera transcripción tras arrancar el contenedor paga la carga del modelo (~3-5 s para `small`). Warm-up automático al arranque del microservicio (transcribir 1 s de silencio) lo mitiga.
- **GTX 1650 con todo cargado va apretada**: `qwen2.5:3b` (~3 GB) + Letta embeddings (~1 GB) + Whisper `small` (~1 GB) + WSL2/Docker overhead. Caben en 4 GB ajustado. Si el usuario nota OOM, bajar a `tiny` o desactivar embeddings de Letta es la salida (documentado).
- **Silero VAD añade ~2 MB al bundle del desktop**. Aceptable, no rompe nada.
- **El cliente desktop habla con dos servicios** (core-host en :9876 y whisper en :8765). Dos URLs configurables (`VITE_SHIRO_HOST_URL` y `VITE_WHISPER_URL`).

### Neutrales

- **`ISTTModule.transcribeStream`** queda opcional en el contrato; el flujo real lo cubre el cliente desktop directamente, no el `WhisperSTT` del core. Si en el futuro otro consumidor necesita stream desde el core, se implementa entonces.
- **`stt:listening`, `stt:partial`, `stt:transcribed`** ya están en el `EventMap`. No hay eventos nuevos.
- **`user:message`** se sigue emitiendo desde el cliente (al tipear o al cerrar transcripción). Pipeline downstream sin cambios.

## Notas de implementación

Mapa de archivos a tocar por PR (ver tasks #8-#14):

### Microservicio Python (`services/whisper/`)

- `services/whisper/Dockerfile` — base `python:3.11-slim` o `nvidia/cuda:12.x-runtime`. Instala `faster-whisper`, `fastapi`, `uvicorn`, `websockets`.
- `services/whisper/main.py` — servidor FastAPI con WS `/stt`. Recibe chunks (16-bit PCM o WebM/Opus decodificable con `ffmpeg-python`), pasa a faster-whisper en streaming, emite `stt:partial` cada `~250 ms` y un `stt:transcribed` final cuando recibe el marker de fin de turno del cliente.
- `services/whisper/config.py` — lee `WHISPER_MODEL`, `WHISPER_LANGUAGE`, `WHISPER_COMPUTE_TYPE` del entorno.
- `services/whisper/healthcheck.py` — HTTP `GET /health` devolviendo `{ status, model, device }`.
- `services/whisper/tests/` — tests Python (pytest) que validan el contrato del WS con un audio de fixture.

### Cliente del microservicio en `@proyecto-shiro/core`

- `packages/core/src/modules/stt/whisper-stt.ts` — `WhisperSTT` implementa `ISTTModule`. Constructor recibe `{ base_url, timeout_ms }`. `ping()` hace GET `/health`. `transcribe(request)` hace POST `/transcribe` con el buffer (modo batch para tests/CLI; no se usa en el pipeline conversacional). `transcribeStream` no se implementa aquí — la decisión 3 lo deja al desktop.
- `packages/core/src/index.ts` — exporta `WhisperSTT`, su schema zod, y el error tipado.
- `packages/core/tests/unit/modules/stt/whisper-stt.test.ts` — tests con `fetch` mockeado.

### Captura de audio + push-to-talk en `@proyecto-shiro/desktop`

- `packages/desktop/src/audio/useMicrophone.ts` — hook que abre el WS al microservicio, maneja `getUserMedia`, instancia `MediaRecorder` con `audio/webm;codecs=opus` (o PCM si el servidor lo prefiere).
- `packages/desktop/src/audio/usePushToTalk.ts` — bind a tecla configurable. Mientras presionada → `useMicrophone.start()`; al soltar → `useMicrophone.stop()` (manda marker de fin).
- `packages/desktop/src/audio/wireSttBus.ts` — al recibir `stt:transcribed { isFinal: true }` del WS del microservicio, emite `user:message` al bus.
- Permission flow: primer uso pide micro vía `navigator.mediaDevices.getUserMedia`. Si rechazado, mostrar mensaje y mantener input de texto activo.

### Silero VAD opcional

- `packages/desktop/src/audio/useVad.ts` — wrapper sobre `@ricky0123/vad-web`. Toggle desde `SetupScreen` o `ConversationScreen`.
- Cuando VAD detecta `speech_start` → llama `useMicrophone.start()`; cuando `speech_end` o silencio sostenido → `useMicrophone.stop()`.
- Config: `positiveSpeechThreshold`, `negativeSpeechThreshold`, `redemptionFrames` en `modules.config.yaml` bajo `stt.config.vad`.

### Wiring final

- `packages/desktop/src/state/companion-reducer.ts` — `LISTEN_START` ya dispara desde el micro (en lugar de `stt:listening` del bus). Actualizar el flujo: al arrancar captura → dispatch `LISTEN_START` localmente (el cliente es quien empieza). Cuando llega `stt:partial` → `STT_PARTIAL`. Cuando llega `stt:transcribed` → `STT_FINAL` + emit `user:message`.
- `packages/core-host/src/bootstrap.ts` — registra `WhisperSTT` (cliente para healthcheck). El factory llama `ping()` en arranque y loguea warn si el microservicio no responde (mismo patrón que el manager de memoria — Shiro sigue funcionando sin STT, solo input de texto).

### Config

- `config/modules.config.yaml` — bloque `stt`:

  ```yaml
  stt:
    active: WhisperSTT
    config:
      base_url: 'http://localhost:8765'
      timeout_ms: 5000
      vad:
        enabled: false # toggle del modo hands-free; UI puede sobreescribir
        positive_speech_threshold: 0.5
        negative_speech_threshold: 0.35
        redemption_frames: 8
  ```

- `.env.example` — `VITE_WHISPER_URL` (default `ws://localhost:8765/stt`), `WHISPER_MODEL` (default `small`).

### Docs

- `README.md` — sección "Requisitos para el hito STT": `docker compose up -d whisper`, primer arranque tarda (descarga modelo), permiso de micro en el navegador, gotchas de `host.docker.internal` (mismos que Letta).
- `docs/architecture.md` — diagrama del flujo de voz: `Cliente desktop ↔ microservicio whisper ↔ bus core-host`. Indicar que el audio NO pasa por el core-host.

## Referencias

- [ADR 0001](0001-arquitectura-modular-event-driven.md) — modular event-driven; STT vive como un módulo más.
- [ADR 0007](0007-module-loader-registry.md) — factory registry que registra `WhisperSTT`.
- [ADR 0012](0012-split-cliente-server-core-host.md) — el core vive server-side; el desktop es cliente del bus.
- [ADR 0013](0013-protocolo-websocket-eventbus.md) — protocolo del bus, intacto en este hito.
- [ADR 0017](0017-memoria-persistente-local-y-letta.md) y [ADR 0018](0018-letta-sdk-oficial-embeddings-ollama.md) — mismo patrón operativo (servicio Docker, healthcheck, embeddings/inferencia local). Plantilla para el setup operativo de Whisper.
- Interfaz: [`packages/core/src/interfaces/ISTTModule.ts`](../../packages/core/src/interfaces/ISTTModule.ts).
- faster-whisper: <https://github.com/SYSTRAN/faster-whisper>
- Silero VAD: <https://github.com/snakers4/silero-vad> · port JS: <https://github.com/ricky0123/vad>
- Modelos Whisper: <https://huggingface.co/openai/whisper-large-v3> · `distil-large-v3`: <https://huggingface.co/distil-whisper/distil-large-v3>
