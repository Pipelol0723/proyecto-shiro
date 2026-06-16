# 🧩 Plan de Desarrollo: AI Companion — Arquitectura Modular y Escalable

> ⚠️ **DOCUMENTO HISTÓRICO** — Plan original escrito el 2026-05-24 antes
> de empezar a codear. Se conserva intacto como referencia de "qué
> pensábamos al principio".
>
> **El estado actual del proyecto vive en**:
>
> - [`docs/architecture.md`](docs/architecture.md) — arquitectura viva
>   con diagramas mermaid y mapeo cliente↔core.
> - [`docs/adr/`](docs/adr/) — todas las decisiones arquitectónicas
>   tomadas desde entonces (1-10 y subiendo), con su contexto y
>   alternativas descartadas.
> - [`README.md`](README.md) — estado de cada hito y roadmap.
>
> **Cambios principales respecto a este plan:**
>
> - **Numeración de fases → nombres**: el cliente desktop se intercaló
>   entre Core y LLM, así que pasamos a llamar las fases por su contenido
>   (Setup, Core, Cliente desktop, LLM, Memoria, STT, TTS, Avatar Live2D,
>   Packaging Tauri, Agentic tools) en lugar de Fase 0–7.
> - **Hito Agentic** (no previsto en este plan): Shiro gana capacidad
>   ejecutiva (FS + shell con permisos mixtos, loop tool-use, modal de
>   aprobación). Ver [ADR 0022](docs/adr/0022-shiro-agentic-tools-fs-shell.md).
> - **Cliente desktop adelantado**: ya no es Fase 7. Se construye ahora,
>   entre Core y LLM, con stack Vite + React + TS (no solo Tauri).
>   Ver [ADR 0008](docs/adr/0008-cliente-desktop-vite-react.md).
> - **Orbe placeholder del avatar**: hasta que llegue el hito Avatar
>   Live2D, el cliente muestra un orbe SVG animado.
>   Ver [ADR 0009](docs/adr/0009-orbe-placeholder-avatar.md).
> - **Transports separados del EventBus**: la arquitectura prevé múltiples
>   transports (in-process, WebSocket, MQTT, Serial) desde el día uno.
>   Ver [ADR 0003](docs/adr/0003-transport-abstraction-device-registry.md).
>
> El texto debajo de este banner permanece sin modificar.

---

## Visión del Proyecto

Un framework propio para AI companions con avatar animado estilo VTuber, voz en
tiempo real, memoria persistente y sistema de módulos intercambiables. Cada pieza
puede reemplazarse sin romper el resto. Diseñado para crecer.

**Trabajo en equipo:** 2 personas vía GitHub.
**Disponibilidad:** 4-6 horas/semana por persona.
**Duración estimada del MVP:** ~5 meses (menos si se divide bien el trabajo).

---

## Stack Tecnológico

| Capa | Tecnología | Justificación |
|------|-----------|---------------|
| Lenguaje | TypeScript | Tipado fuerte, contratos claros |
| Runtime | Node.js 20+ | Compatible con todas las librerías |
| Core | EventBus custom | Desacoplamiento total |
| Desktop | Tauri | Más ligero que Electron, nativo |
| LLM local | Ollama + Qwen 2.5 14B | 16 GB VRAM, mejor español open-source |
| LLM cloud | Claude Sonnet (Anthropic SDK) | Máxima calidad conversacional |
| STT | faster-whisper (Python microservicio) | Local, privado, preciso |
| TTS | ElevenLabs + SystemTTS (fallback) | Calidad cloud + garantía offline mínima (ver ADR 0020) |
| Avatar 2D | Live2D Cubism SDK Web | Sin necesidad de saber diseño 3D |
| Avatar 3D | @pixiv/three-vrm (futuro) | Migración sin cambiar otros módulos |
| Memoria | Letta self-hosted (Docker) | Long-term memory, privado |
| Tests | Vitest | Rápido, compatible con TypeScript |
| Config | YAML + zod | Legible, validado en runtime |

---

## Arquitectura del Sistema

```
Usuario habla o escribe
         ↓
  Open-LLM-VTuber
  (coordinador central)
         ↓
  ┌─── Clasificador rápido (Qwen local) ───┐
  ↓                                        ↓
Tarea simple                         Tarea compleja
  ↓                                        ↓
Ollama + Qwen 2.5 14B              Claude Sonnet API
  (local, gratis)                   (de pago, potente)
  └─────────────────┬───────────────────────┘
                    ↓
           Respuesta generada
                    ↓
          ElevenLabs TTS (cloud)
                    ↓
     Avatar Live2D animado + lip sync
                    ↓
           Usuario ve y escucha
```

---

## Estructura del Repositorio

```
/companion-core
├── src/
│   ├── core/
│   │   ├── orchestrator.ts        ← Cerebro central
│   │   ├── event-bus.ts           ← Comunicación entre módulos
│   │   ├── module-loader.ts       ← Carga módulos desde config
│   │   └── logger.ts              ← Logging unificado
│   │
│   ├── interfaces/                ← Contratos inamovibles
│   │   ├── ISTTModule.ts
│   │   ├── ITTSModule.ts
│   │   ├── ILLMModule.ts
│   │   ├── IMemoryModule.ts
│   │   ├── IAvatarModule.ts
│   │   └── IRouterModule.ts
│   │
│   ├── modules/
│   │   ├── stt/
│   │   │   └── WhisperSTT.ts
│   │   ├── tts/
│   │   │   ├── ElevenLabsTTS.ts
│   │   │   ├── SystemTTS.ts
│   │   │   └── SystemTTS.ts       ← Fallback del OS
│   │   ├── llm/
│   │   │   ├── OllamaLLM.ts
│   │   │   └── AnthropicLLM.ts
│   │   ├── memory/
│   │   │   ├── LettaMemory.ts
│   │   │   └── LocalMemory.ts     ← Fallback JSON
│   │   ├── avatar/
│   │   │   ├── Live2DAvatar.ts
│   │   │   └── VRMAvatar.ts       ← Futuro (3D)
│   │   └── router/
│   │       └── HybridRouter.ts
│   │
│   ├── plugins/                   ← Features futuras (IoT, móvil, etc.)
│   │   └── .gitkeep
│   │
│   ├── character/
│   │   ├── character-loader.ts
│   │   └── characters/
│   │       └── default.yaml
│   │
│   └── app/
│       └── desktop/               ← Entry point Tauri
│
├── config/
│   ├── modules.config.yaml        ← Módulo activo en cada slot
│   └── devices.config.yaml        ← Futuro: dispositivos IoT
│
├── tests/
│   ├── unit/
│   └── integration/
│
└── docs/
    ├── architecture.md
    ├── adding-a-module.md
    └── character-format.md
```

---

## Principios de Diseño

- **Desacoplamiento total**: ningún módulo llama directamente a otro, todo va por EventBus.
- **Interfaces primero**: el contrato se define antes de implementar.
- **Un módulo, una responsabilidad**: STT solo transcribe, TTS solo sintetiza.
- **Config sobre código**: cambiar modelo o proveedor = cambiar una línea en YAML.
- **Fail gracefully**: si Claude falla → cae a local. Si ElevenLabs falla → SystemTTS (ver ADR 0020).

---

## 🗓️ Cronograma (4-6 horas/semana)

```
SEMANAS  FASE          QUIÉN            CONTENIDO
──────────────────────────────────────────────────────────────────
1-2      Fase 0        Ambos            Setup del entorno
3-5      Fase 1        Ambos/dividido   Core: EventBus + Orchestrator
6-8      Fase 2        Dividido         LLM híbrido (Qwen + Claude)
9-10     Fase 3        Un@ cada uno     Memoria Letta
11-12    Fase 4        Un@              STT (voz entrada)
13-14    Fase 5        El/la otr@       TTS (voz salida)
15-18    Fase 6        Dividido         Avatar Live2D
19-20    Fase 7        Ambos            App desktop + integración final
──────────────────────────────────────────────────────────────────
TOTAL    ~5 meses      MVP funcional en PC
```

**Si dividen bien el trabajo en paralelo → pueden bajar a ~3 meses.**

### Fases futuras (post-MVP, sin fecha fija)

```
Fase 8  → Sistema de plugins
Fase 9  → Móvil (Android primero, iOS después)
Fase 10 → Migración a avatar 3D (VRoid Studio + VRM)
Fase 11 → Integración IoT (MQTT, Home Assistant)
```

---

## 🐙 Flujo de Trabajo en GitHub

### Estructura de branches

```
main                ← código estable, siempre funciona
└── develop         ← integración, aquí se mezcla el trabajo
    ├── feat/tu-nombre/fase-2-llm
    └── feat/companero/fase-3-memoria
```

**Regla de oro:** nadie hace push directo a `main` ni a `develop`.
Todo entra por Pull Request.

### El flujo del día a día

```bash
# 1. Antes de empezar, traer cambios del compañero
git checkout develop
git pull origin develop

# 2. Crear tu branch para la tarea
git checkout -b feat/tu-nombre/lo-que-vas-a-hacer

# 3. Trabajar y hacer commits frecuentes (cada 30-60 min)
git add .
git commit -m "feat: implementar OllamaLLM básico"

# 4. Subir tu branch
git push origin feat/tu-nombre/lo-que-vas-a-hacer

# 5. Abrir Pull Request en GitHub hacia develop
# 6. El compañero revisa, aprueba y se mergea
```

### Convenciones de commits

```
feat:  nueva funcionalidad       → feat: implementar WhisperSTT
fix:   corrección de bug         → fix: crash en lip sync con audio corto
test:  añadir o mejorar tests    → test: cubrir EventBus con casos edge
docs:  documentación             → docs: actualizar guía de módulos
refac: refactorizar sin cambios  → refac: simplificar HybridRouter
chore: tareas de mantenimiento   → chore: actualizar dependencias
```

### División de trabajo por fase

| Fase | Tú | Tu compañero |
|------|----|-------------|
| 0 | Setup Ollama + Tauri | Setup TypeScript + Vitest |
| 1 | EventBus | Orchestrator + ModuleLoader |
| 2 | OllamaLLM + HybridRouter | AnthropicLLM + CharacterLoader |
| 3 | LettaMemory | LocalMemory + integración |
| 4 | WhisperSTT | (Fase 5 en paralelo) |
| 5 | (Fase 4 en paralelo) | ElevenLabsTTS + SystemTTS |
| 6 | Live2D renderer | Lip sync + expresiones |
| 7 | Empaquetado Tauri | Tests de integración |

### 3 reglas simples para no sufrir

```
✅ Commits pequeños y frecuentes (cada 30-60 min de trabajo)
✅ Nunca trabajar más de 2 días sin hacer pull de develop
✅ Si hay duda sobre algo, abrir un Issue en GitHub antes de codear
```

### Setup inicial del repo (una sola vez, quien crea el repo)

```bash
git init companion-core
cd companion-core
git checkout -b develop
# primer commit con estructura vacía
git push origin main
git push origin develop

# En GitHub → Settings → Branches → Branch protection rules:
# Proteger main:    ✓ Require pull request before merging
# Proteger develop: ✓ Require pull request before merging
```

### Los 4 comandos nuevos que necesitas aprender

```bash
git checkout -b nombre-branch   # crear branch nueva
git checkout develop            # cambiar de branch
git pull origin develop         # traer cambios remotos
git merge develop               # mezclar develop en tu branch
```

---

## 📋 Detalle de cada Fase

---

### FASE 0 — Setup del entorno
**Semanas 1-2 · Ambos**

- [ ] Crear repositorio en GitHub con estructura de branches
- [ ] Configurar protección de `main` y `develop`
- [ ] Inicializar TypeScript + ESLint + Prettier + Vitest
- [ ] Crear estructura de carpetas base (vacía con .gitkeep)
- [ ] Instalar Ollama: `ollama pull qwen2.5:14b`
- [ ] Verificar que TypeScript compila sin errores
- [ ] Verificar que los tests corren (aunque estén vacíos)
- [ ] Crear `modules.config.yaml` y `default.yaml` del personaje

**✅ Listo cuando:** el repo está en GitHub, ambos pueden clonar y compilar sin errores.

---

### FASE 1 — Core: EventBus + Orchestrator
**Semanas 3-5 · Dividido**

- [ ] Implementar `EventBus` (pub/sub tipado en TypeScript)
- [ ] Implementar `ModuleLoader` (lee config.yaml, instancia módulos)
- [ ] Implementar `Orchestrator` (conecta el flujo de eventos)
- [ ] Definir todas las interfaces (ILLMModule, ITTSModule, etc.)
- [ ] Tests unitarios del EventBus (cobertura > 80%)
- [ ] Tests unitarios del ModuleLoader
- [ ] Test de integración con módulos mock

**✅ Listo cuando:** puedes registrar módulos falsos y el flujo completo pasa sin errores.

---

### FASE 2 — LLM híbrido (Local + Cloud)
**Semanas 6-8 · Dividido en paralelo**

- [ ] Implementar `OllamaLLM` con Ollama SDK
- [ ] Implementar `AnthropicLLM` con Anthropic SDK
- [ ] Implementar `HybridRouter` (clasificador en Qwen)
- [ ] Implementar `CharacterLoader` (inyecta personalidad en contexto)
- [ ] Test: ambos LLMs responden con el personaje cargado
- [ ] Test: HybridRouter clasifica correctamente 20 mensajes de prueba

**✅ Listo cuando:** puedes chatear por texto con el companion desde la terminal.

---

### FASE 3 — Memoria persistente
**Semanas 9-10 · Un@ cada módulo**

- [ ] Implementar `LocalMemory` (JSON, sin dependencias externas)
- [ ] Instalar Letta con Docker: `docker run letta/letta`
- [ ] Implementar `LettaMemory` con Letta SDK
- [ ] Integrar memoria en el Orchestrator
- [ ] Test: recuerda el nombre del usuario entre reinicios
- [ ] Test: fallback a LocalMemory si Letta no está disponible

**✅ Listo cuando:** cierras y abres la app y el companion recuerda la conversación anterior.

---

### FASE 4 — STT: voz de entrada ✅

**Completada 2026-06-03** (PRs #37-#42 sobre la rama `develop`).

- [x] Implementar faster-whisper como microservicio Python (FastAPI, puerto 8765) — `services/whisper/`, Docker con CUDA 12.6 base, sample rate 16 kHz, modelo `small` por defecto.
- [x] Implementar `WhisperSTT.ts` que llama al microservicio — `packages/core/src/modules/stt/whisper-stt.ts`. Su rol es **acotado** (ADR 0019, decisión 8): `ping()` para healthcheck en el bootstrap del `core-host` + `transcribe()` batch contra `POST /transcribe` para tests/CLI. El flujo de chat en vivo va por WebSocket directo desde el cliente desktop.
- [x] Captura en el cliente con AudioWorklet y push-to-talk (`Space` o click-and-hold del botón). Hook `useMicrophonePTT` produce PCM Int16 LE @ 16 kHz y abre WS al microservicio.
- [x] **VAD pospuesto a futuro hito**: en V1 el corte de turno lo hace el push-to-talk (keyup), no un VAD. faster-whisper tiene `vad_filter` interno para recortar silencios dentro del audio enviado, pero la detección "fin de frase" hands-free (Silero/WebRTC) queda como deuda explícita para cuando el PTT no cubra suficiente. Esto está marcado como tarea futura (PR #12 del hito, no implementado en V1).
- [x] Wiring `stt:transcribed` → `user:message` para que un turno hablado entre al pipeline conversacional por el mismo camino que un turno tipeado. Tests E2E del flujo completo voz→user:message→router→llm→tts en `packages/desktop/tests/useCompanionState.test.tsx`.
- [x] Tests del cliente WS (`WhisperSttClient`), del hook PTT (caso `unsupported`), del wiring del reducer, del microservicio Python (config, transcribe batch, hotwords).

**✅ Listo:** hablas (mantén Space) y la transcripción llega al historial automáticamente, Shiro responde sin que tengas que tocar nada más. Ver [ADR 0019](docs/adr/0019-stt-faster-whisper-microservicio-python.md) y el [README](README.md) para setup y tunings.

---

### FASE 5 — TTS: voz de salida ✅

**Completada 2026-06-03** (PRs #44-#48 sobre la rama `develop`).

- [x] Implementar `ElevenLabsTTS` con mapeo de emociones — `packages/core/src/modules/tts/elevenlabs-tts.ts`. Cliente HTTP REST del API de ElevenLabs (`POST /v1/text-to-speech/{voice_id}`), browser-safe (`fetch`). Mapeo emoción → `stability` lee `character.emotions[emotion].tts_stability` del YAML por turno. El resto (`similarity_boost`, `style`, `use_speaker_boost`, `model_id`) son constantes en `config/modules.config.yaml`. Errores específicos para 401 (key rechazada) y 429 (cuota / rate limit).
- [x] ~~Implementar `KokoroTTS` (offline, fallback)~~ — descartado por ADR 0020; SystemTTS cubre el caso offline, UTAU/voz sintética post-5080.
- [x] Implementar `SystemTTS` (último recurso, voz del OS) — `packages/core/src/modules/tts/system-tts.ts`. Node-only (usa `child_process` via `say.js`). SAPI en Windows, NSSpeechSynthesizer en macOS, festival/espeak en Linux. Exporta a WAV temporal, lee buffer, cleanup. Promise wrapper con timeout (default 15s) para no colgarse en Linux sin motor instalado.
- [x] **`TtsWithFallback`** — wrapper que envuelve primary + N fallbacks como un solo `ITTSModule`. El pipeline conversacional ve solo este. Itera la cadena, loguea warnings, lanza el último error si todos fallan.
- [x] **Audio en V1: server genera, cliente reproduce** (ADR 0020 decisión 3). `AudioCache` en memoria con TTL 60s; HTTP route `GET /audio/<id>.<ext>` en core-host; `tts:audio { url, audioId, mimeType }` por el bus; cliente fetch + `HTMLAudioElement` con `useTtsPlayback` hook.
- [x] **Cancelable mid-speech** — `tts:cancel { audioId }` por el bus; server invalida el cache, cliente para el audio.
- [x] **Mute por cliente** persistido en `localStorage` — preparación para multi-device. Lógica de "elegir dispositivo activo" diferida a ADR futuro.
- [x] Test: sintetiza texto con emoción mapeada y con fallback a `default_stability` (24 tests en `elevenlabs-tts.test.ts`).
- [x] Test: fallback a SystemTTS cuando ElevenLabs falla (5 tests en `tts-with-fallback.test.ts` + integración del bootstrap).
- [x] Tests del wrapper de `say.js` con inyección de FS (16 tests en `system-tts.test.ts`).
- [x] Tests del `useTtsPlayback` con FakeAudio (12 tests).
- [x] Tests del `AudioCache` con timers fake (11 tests).

**✅ Listo:** el companion responde con voz natural del personaje (ElevenLabs si hay API key + voice_id; SystemTTS como fallback siempre disponible). Cancelable, multi-cliente, mute por dispositivo. Ver [ADR 0020](docs/adr/0020-tts-elevenlabs-systemtts-fallback-y-multidevice-diferido.md) y el [README](README.md) para setup y tunings.

---

### FASE 6 — Avatar Live2D
**Semanas 15-18 · Dividido**

**Semana 15-16 — Renderer base (un@)**
- [ ] Configurar Three.js + Live2D Cubism SDK en Tauri
- [ ] Implementar `Live2DAvatar.ts`: carga modelo .moc3, render loop
- [ ] Conectar expresiones a morfos del modelo
- [ ] Animaciones idle automáticas

**Semana 17-18 — Lip sync (el/la otr@)**
- [ ] Análisis de audio en tiempo real (Web Audio API)
- [ ] Mapear amplitud de audio al morph target de boca
- [ ] Sincronizar lip sync con buffer de TTS antes de reproducir

**Avatar recomendado para empezar:** descargar modelo gratuito de Booth.pm
(buscar "Live2D free") para no bloquearse esperando un modelo propio.

**✅ Listo cuando:** el avatar mueve la boca al ritmo de la voz del companion.

---

### FASE 7 — Integración final + App Desktop
**Semanas 19-20 · Ambos**

- [ ] Unir todos los módulos en el Orchestrator
- [ ] Test de integración completo: voz → respuesta → avatar
- [ ] Medir latencia total (objetivo: < 2 seg en respuestas simples)
- [ ] Empaquetar con Tauri: instalador Windows/Mac/Linux
- [ ] Modo overlay (ventana flotante sobre el escritorio)
- [ ] Atajos de teclado (push-to-talk, silenciar)
- [ ] Manejo de errores visible para el usuario

**✅ Listo cuando:** app instalable con doble clic, sin abrir terminales.

---

## 💰 Costes Estimados

| Servicio | Coste mensual |
|---------|--------------|
| Claude API (~30-40% de mensajes con híbrido) | $10-20/mes |
| ElevenLabs (tier Creator) | $11/mes |
| Letta self-hosted (Docker local) | $0 |
| Qwen 2.5 14B local | $0 |
| **Total operativo** | **~$20-30/mes** |

---

## 📊 Métricas de Éxito

| Métrica | Objetivo |
|---------|---------|
| Latencia respuesta simple (Qwen local) | < 1.5 seg |
| Latencia respuesta compleja (Claude) | < 3 seg |
| % mensajes resueltos por modelo local | > 60% |
| Cobertura de tests del core | > 80% |
| Tiempo para añadir un módulo nuevo | < 2 horas |
| Tiempo para cambiar de proveedor TTS | < 5 minutos |

---

## 🔮 Roadmap Post-MVP

```
MVP listo (mes 5)
      ↓
Fase 8  → Sistema de plugins       (2 semanas)
      ↓
Fase 9  → Móvil Android (PWA → APK) (3-4 semanas)
      ↓
Fase 10 → Avatar 3D con VRoid      (1-2 semanas, solo config)
      ↓
Fase 11 → IoT: luces, sensores,    (3-4 semanas)
           Home Assistant
```

Cada fase es independiente. Puedes hacerlas en cualquier orden
o saltarte las que no necesites.

---

## 📚 Recursos

| Recurso | URL |
|---------|-----|
| Anthropic SDK | https://github.com/anthropics/anthropic-sdk-python |
| Ollama SDK JS | https://github.com/ollama/ollama-js |
| Live2D Cubism SDK Web | https://www.live2d.com/sdk/about |
| @pixiv/three-vrm (3D futuro) | https://github.com/pixiv/three-vrm |
| Letta (memoria) | https://github.com/letta-ai/letta |
| Tauri (desktop) | https://tauri.app |
| Modelos Live2D gratuitos | https://booth.pm |
| VRoid Studio (3D futuro) | https://vroid.com/studio |
| ElevenLabs | https://elevenlabs.io |
| Anthropic API Console | https://console.anthropic.com |
