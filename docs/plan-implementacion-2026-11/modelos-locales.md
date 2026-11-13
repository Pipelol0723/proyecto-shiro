# Plan de implementación (2026-11) — Modelos locales

> Parte del [plan de implementación](README.md) (estado: propuesta, pendiente de aprobación). Los IDs R-xxx, L-xxx y P-xx son los de la [revisión](../revision-estado-2026-11.md) y del [plan de mejora](../plan-mejora-2026-11.md). Las referencias a otras secciones (§1, §2, §7 en el índice; §3 a §6 en los archivos hermanos) están resueltas en la tabla del [índice](README.md).

## 6. Modelos locales: medir y ajustar, modelos nuevos y personalidad

Pipe quiere las tres cosas: ajustar y medir lo que hay (Parte 1, sin descargas), probar modelos nuevos (Parte 2) y planear un ajuste fino de la personalidad de Shiro (Parte 3, solo plan; el entrenamiento espera a la GPU de 16 GB). Encaja con el plan de mejora: P-16 (L-PERF-01/02), P-36 (atajo de R-142), L-PERF-03 (VRAM, R-131, hoy aparcado), L-PERF-07 (Whisper, aparcado) y P-11a/L-ARQ-08 (reindexado, R-162). Fuentes externas consultadas el **2026-11-12**; lo que no se pudo comprobar va como «sin verificar». Los permisos de este frente están en §2.5.

> **Aprobado por Pipe el 2026-11-13** (§2.0, E): arrancar y parar Ollama y Docker para medir; cambiar las variables de entorno (reversibles); actualizar Ollama después de medir la línea base; descargar los 5 candidatos (unos 12,7 GB); que Pipe grabe un clip de su voz; usar sus conversaciones guardadas, anonimizadas y fuera del repo, para el conjunto de datos; y usar Claude como juez de fidelidad. Sigue pendiente lo que esa lista no cubre: las descargas opcionales, borrar modelos con `ollama rm` y las decisiones de §2.5 #45 y #46.

### 6.1 Cómo se usan hoy los modelos locales

| Pieza               | Qué hace hoy                                                                                                                                                                                                       | Dónde                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| LLM local           | `POST /api/chat`, `stream: false`, `format` = esquema JSON `{text, emotion}` con `additionalProperties: false`. Solo manda `options.temperature` (0.7): **sin `keep_alive`, `num_ctx`, `num_predict` ni `think`**. | `packages/core/src/modules/llm/ollama-llm.ts:117-125`, esquema en `:74-84`                                                             |
| Contexto de memoria | Se inyecta como un **segundo mensaje `system`** (turnos recientes + semánticos).                                                                                                                                   | `ollama-llm.ts:110-114`; límites en `config/modules.config.yaml:116-122` (`recent_limit: 10`, `semantic_limit: 3`, `timeout_ms: 1500`) |
| JSON inválido       | Degrada a `emotion: 'neutral'` con el texto crudo y un `warn`. No hay contador.                                                                                                                                    | `ollama-llm.ts:182-201`                                                                                                                |
| Clasificador        | Mismo modelo (`qwen2.5:3b`) en **cada turno** que no caiga en el fast-path de tools; `temperature: 0.1`, sin `num_predict` ni `keep_alive`; timeout de 2 s (un cold load cae a la heurística).                     | `packages/core/src/modules/router/hybrid-router.ts:50`, `:212-224`; modelo en `modules.config.yaml:36`                                 |
| Modelo              | `qwen2.5:3b` para respuesta, clasificador y el agente de Letta.                                                                                                                                                    | `modules.config.yaml:19`, `:36`, `:91`                                                                                                 |
| Embeddings          | `mxbai-embed-large` (1024 d) llamado **por Letta** vía la API OpenAI-compat de Ollama; solo se aplican al provisionar el agente. Warm-up con un `searchSemantic('hola')`.                                          | `modules.config.yaml:99-101`; `packages/core/src/modules/memory/letta-memory.ts:268-280`; `memory-manager.ts:342-368`                  |
| System prompt       | `buildSystemPrompt` serializa `default.yaml` (identidad, personalidad, backstory, comportamiento, reglas y FORMATO DE SALIDA).                                                                                     | `packages/core/src/character/system-prompt-builder.ts:37-117`; `packages/core/src/character/characters/default.yaml`                   |
| Whisper             | `small`, `int8`, `es`, partials cada 2500 ms, hotwords `Shiro`, GPU por Docker.                                                                                                                                    | `docker-compose.yml:73-90`                                                                                                             |
| Decodificación      | `beam_size=1`, `vad_filter=True` **sin `vad_parameters`**; cada partial retranscribe todo el buffer (R-130).                                                                                                       | `services/whisper/transcriber.py:100-106`; `services/whisper/main.py:152-162`                                                          |
| Defaults Python     | `compute_type` por defecto `auto` y `partial_interval_ms` 1500 (el compose los pisa). `vad_silence_ms: 800` del YAML no lo lee nadie (R-163).                                                                      | `services/whisper/config.py:63-71`; `modules.config.yaml:49`                                                                           |

Dos hechos que condicionan el plan:

- **Ollama instalado (0.31.2) va muy por detrás de la versión actual (0.40.16, publicada el 9-nov, según la página de releases de GitHub).** Los modelos nuevos (qwen3.5, ministral-3, gemma4) pueden exigir una versión más reciente: sin verificar (sus páginas no indican versión mínima). Actualizar Ollama es una descarga y un cambio que hay que medir antes y después.
- **El comentario de `docker-compose.yml:75-80` probablemente es incorrecto.** Dice que `int8_float16` necesita Tensor Cores y no vale en una GTX 1650. La tabla de CTranslate2 da como nativos `int8_float32`, `int8_float16` y `float16` a cualquier GPU con compute capability ≥ 7.0 y < 8.0. La GTX 1650 es CC 7.5 según la tabla de NVIDIA (sin verificar en esta consulta). Hay que medirlo, no darlo por hecho.

### 6.2 Parte 1: ajustar y medir lo que hay (sin descargas)

#### 6.2.1 Qué se mide

| Métrica                             | Cómo se obtiene                                                                                                                                                                                                                                                                                     |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tiempo hasta el primer token (TTFT) | Petición con `stream: true` solo en el banco de pruebas: ms hasta el primer chunk. Cruce con `load_duration + prompt_eval_duration`.                                                                                                                                                                |
| Tokens por segundo                  | `eval_count / eval_duration × 1e9`. Ollama devuelve todas las duraciones en nanosegundos (doc de la API).                                                                                                                                                                                           |
| Tokens del prompt                   | `prompt_eval_count`: comprueba que el system prompt más el contexto quepan en `num_ctx`.                                                                                                                                                                                                            |
| Turno local completo                | Clasificador + respuesta en serie, como en `conversation-flow.ts:173-228`: `classifier_ms`, `llm_ms` y su suma.                                                                                                                                                                                     |
| Carga en frío                       | `load_duration` de la primera petición tras `keep_alive: 0`.                                                                                                                                                                                                                                        |
| VRAM y reparto                      | `ollama ps` (columnas PROCESSOR y CONTEXT: `100% GPU` frente a un reparto `x%/y% CPU/GPU`, según la FAQ) y `nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits` antes, durante y después. El uso de VRAM por proceso en Windows (WDDM) puede salir `N/A`: sin verificar. |
| Validez del JSON                    | Si `message.content` parsea y `emotion` ∈ `EMOTIONS`.                                                                                                                                                                                                                                               |
| Whisper                             | `POST /transcribe` (`main.py:97-118`) con un clip fijo: ms por clip y WER frente al texto de referencia.                                                                                                                                                                                            |

Escenarios de memoria (los cuatro con el mismo modelo):

- **A.** Solo el LLM.
- **B.** LLM + `mxbai-embed-large` cargado (un `POST /api/embed` previo).
- **C.** B + Whisper en GPU (contenedor arriba y ya calentado).
- **D.** B + Whisper en CPU (`WHISPER_DEVICE=cpu`).

C es el escenario real de un turno de voz y la pregunta de R-131.

#### 6.2.2 Script nuevo `scripts/bench-local.mjs`

Es código del repo, así que va en su propio PR (`feat: banco de pruebas local de modelos`), **antes** del PR de P-16, para medir la línea base con el código de hoy. Lo escribe un agente y Pipe lo revisa. Node 22 sin dependencias nuevas (`fetch` y `child_process` para `nvidia-smi` y `ollama ps`).

- **Depende de P-04 PR2**, que añade `'scripts/**/*.mjs'` a los ignores de ESLint (si no, `eslint .` aplica el lint con tipos al script y falla). Si P-04 PR2 aún no está, el ignore entra en este PR.
- El script lleva `// @ts-check`. `bench/results/` se añade a `.gitignore` en el mismo PR. `bench/*.json` pasa por `prettier --check` como el resto del repo.
- El único cambio fuera de `scripts/` y `bench/` es la palabra `export` en `CLASSIFIER_SYSTEM_PROMPT` (`hybrid-router.ts:142`, hoy no exportada), sin cambio de conducta. P-16 toca después ese archivo para `keep_alive`/`num_predict`; como este PR va antes y es de una línea, no se pisan.

- **Entrada:** `bench/prompts-es.json` (los 10 mensajes de abajo), `bench/config.json` (modelo, opciones y escenario) y un clip opcional en `SHIRO_BENCH_CLIP` (ruta **fuera del repo**).
- **System prompt real:** importa `buildSystemPrompt` y el cargador de personaje desde `@proyecto-shiro/core` ya compilado (`npm run build`), para medir con el mismo prompt que la app. El clasificador usa el `CLASSIFIER_SYSTEM_PROMPT` real (exportado en este mismo PR, ver arriba).
- **Protocolo:** una petición de calentamiento descartada, luego **5 repeticiones × 10 mensajes = 50 medidas** por configuración. Mediana y p90. Arranque en frío aparte: 3 veces con `keep_alive: 0` antes. `seed` fijo (opción admitida por la API) para que las repeticiones se puedan comparar.
- **Salida:** `bench/results/<fecha>-<config>.json`, que no se commitea (añadir a `.gitignore`), y una tabla Markdown por stdout para pegarla en `docs/latencia-base.md`, el documento que ya pide P-16:

| config | escenario | modelo     | ctx  | load ms | prompt tok | TTFT p50/p90 | tok/s p50 | clasif. ms p50 | turno ms p50/p90 | JSON ok | VRAM MB | PROCESSOR |
| ------ | --------- | ---------- | ---- | ------- | ---------- | ------------ | --------- | -------------- | ---------------- | ------- | ------- | --------- |
| base   | C         | qwen2.5:3b | 4096 | …       | …          | …            | …         | …              | …                | 50/50   | …       | 100% GPU  |

Whisper: un subcomando `--whisper` envía el clip 1 vez de calentamiento + 5 veces y da `ms p50`, `x tiempo real` y `WER`. El clip: unos 10 s de voz de Pipe en español, con «Shiro» dentro, PCM s16le 16 kHz mono, guardado fuera del repo. En el repo solo va su hash SHA-256 y la transcripción de referencia.

#### 6.2.3 Los 10 mensajes de conversación (español, tipo Shiro)

1. «Buenas, ¿qué tal llevas el día?»
2. «Hoy he dormido fatal, cuatro horas como mucho.»
3. «¿Te acuerdas de qué te conté ayer sobre el examen?»
4. «Estoy pensando en dejar el gimnasio, me aburre bastante.»
5. «Recomiéndame algo tranquilo para escuchar mientras programo.»
6. «¿Tú qué opinas, el café con azúcar es un crimen?»
7. «Me han dicho que mi proyecto no sirve para nada.»
8. «¿Cuánto es el 15 % de 80?»
9. «Cuéntame algo curioso que no sepa.»
10. «Bueno, me voy a dormir. Hasta mañana, Shiro.»

Cubren saludo, preocupación indirecta, memoria, opinión, humor seco, un registro afectivo, un dato exacto y una despedida. Todos son cortos, a propósito: es la charla que el router manda a local.

#### 6.2.4 Ajustes a probar, uno por uno

Cada ajuste se mide contra la línea base, en el escenario C y con los 10 mensajes × 5 repeticiones. Se queda solo si mejora la mediana del turno sin bajar el JSON de 50/50.

| #   | Ajuste                                                                             | Valor de partida                                                                                                                                                         | Valor a probar                                                                            | Tipo                                                                                                                               | Ítem del plan                                           |
| --- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 1   | `keep_alive` en LLM y clasificador                                                 | no se envía → 5 min (`ollama-llm.ts:117`, `hybrid-router.ts:215`)                                                                                                        | `"30m"`; en sesión, `-1`                                                                  | código (campo nuevo en `OllamaLLMConfigSchema` y en el router)                                                                     | P-16 / L-PERF-02 / R-141                                |
| 1b  | `OLLAMA_KEEP_ALIVE`                                                                | 5 min (FAQ)                                                                                                                                                              | `30m`                                                                                     | máquina (variable de usuario de Windows y reiniciar Ollama). Cubre también a `mxbai`, al que llama Letta y que la app no controla. | P-16 (documentarlo) / R-141                             |
| 2   | `num_ctx`                                                                          | no se envía. El servidor usa 4096 con menos de 24 GB de VRAM (página de contexto y FAQ); la doc del Modelfile dice 2048. Contradicción: hay que medirlo con `ollama ps`. | 4096 fijo; 3072 si `prompt_eval_count` p90 lo permite                                     | código (`num_ctx` en el YAML)                                                                                                      | **solo P-16** (se quita de P-32)                        |
| 2b  | Mismo `num_ctx` en clasificador y respuesta                                        | distinto o ausente                                                                                                                                                       | idéntico en ambos                                                                         | código                                                                                                                             | **solo P-16** (se quita de P-32)                        |
| 3   | `num_predict` de la respuesta                                                      | -1, sin tope (doc del Modelfile)                                                                                                                                         | 256 (respuestas habladas cortas)                                                          | código                                                                                                                             | P-16                                                    |
| 4   | `num_predict` del clasificador                                                     | sin tope                                                                                                                                                                 | 24 (el JSON `{tier, requires_tools}` cabe de sobra)                                       | código                                                                                                                             | P-16 / R-142                                            |
| 4b  | Atajo heurístico (mensajes < 60 caracteres sin markers van a local sin clasificar) | clasifica siempre                                                                                                                                                        | activado                                                                                  | código                                                                                                                             | **espera a P-36** / R-142 (P-36 también toca el router) |
| 4c  | `temperature` del clasificador                                                     | 0.1                                                                                                                                                                      | 0 (la doc de salida estructurada lo recomienda)                                           | código                                                                                                                             | P-16                                                    |
| 5   | Modelo cargado una sola vez                                                        | ya es el mismo `qwen2.5:3b` en los tres usos                                                                                                                             | comprobar en `ollama ps` que no hay recargas entre clasificador y respuesta               | medición (si hay recargas, el ítem 2b)                                                                                             | L-PERF-03                                               |
| 6   | `OLLAMA_MAX_LOADED_MODELS`                                                         | 3 × GPU (FAQ)                                                                                                                                                            | 2 (LLM + embeddings)                                                                      | máquina                                                                                                                            | L-PERF-03 / R-131                                       |
| 7   | `OLLAMA_NUM_PARALLEL`                                                              | 1 (FAQ)                                                                                                                                                                  | se deja en 1 (subirlo multiplica la memoria del contexto)                                 | máquina                                                                                                                            | —                                                       |
| 8   | `OLLAMA_FLASH_ATTENTION`                                                           | automático si se admite (FAQ actual; en 0.31.2 sin verificar)                                                                                                            | `1` y `0`, comparar                                                                       | máquina                                                                                                                            | L-PERF-03                                               |
| 9   | `OLLAMA_KV_CACHE_TYPE`                                                             | `f16`                                                                                                                                                                    | `q8_0`: la mitad de memoria con muy poca pérdida (FAQ); funciona con flash attention      | máquina                                                                                                                            | L-PERF-03                                               |
| 10  | `think`                                                                            | no se envía                                                                                                                                                              | `false`. Solo hace falta si el modelo nuevo de la Parte 2 piensa (qwen3/3.5); Qwen 2.5 no | código                                                                                                                             | Parte 2                                                 |
| 11  | Whisper: modelo                                                                    | `small` (`docker-compose.yml:73`)                                                                                                                                        | `base` en CPU (escenario D) para liberar VRAM; `small` en GPU como referencia             | máquina (`.env`: `WHISPER_MODEL`)                                                                                                  | L-PERF-03 / R-131                                       |
| 12  | Whisper: `compute_type`                                                            | `int8` (`docker-compose.yml:81`)                                                                                                                                         | `int8_float16` y `float16` en GPU (CC 7.5, tabla de CTranslate2); `int8` en CPU           | máquina (`.env`) + corregir el comentario `:75-80` (docs)                                                                          | L-PERF-07                                               |
| 13  | Whisper: `beam_size`                                                               | 1 (`transcriber.py:104`)                                                                                                                                                 | 1 en partials y 5 solo en el final                                                        | código (dos llamadas con beam distinto)                                                                                            | L-PERF-07 (aparcado)                                    |
| 14  | Whisper: VAD                                                                       | `vad_filter=True` con el default (solo corta silencios de más de 2 s, según el README de faster-whisper)                                                                 | `vad_parameters={'min_silence_duration_ms': 500}` cableado con `WHISPER_VAD_SILENCE_MS`   | código                                                                                                                             | R-163 / L-PERF-07                                       |
| 15  | Whisper: warm-up                                                                   | silencio con VAD (puede no ejecutar el modelo)                                                                                                                           | `vad_filter=False` con ruido bajo                                                         | código                                                                                                                             | R-150 / L-PERF-07                                       |
| 16  | Whisper: intervalo de partials                                                     | 2500 ms                                                                                                                                                                  | se deja hasta tener la ventana deslizante                                                 | máquina                                                                                                                            | R-130                                                   |

Los ajustes de máquina (1b, 6-9, 11, 12, 16) no tocan el repo: se documentan en `docs/latencia-base.md` y en el README («Presupuesto de VRAM», como pide R-131). Los de código caen casi todos en el PR de P-16, que es el **único** que toca los esquemas de opciones de `OllamaLLM` y del clasificador en esta etapa: `num_ctx` entra ahí y se quita de la fila P-32 del plan de mejora (P-32 se queda con los timeouts HTTP y el texto vacío). El 4b espera a P-36, y del 13 al 15 a L-PERF-07.

Riesgos de medición:

- **Cambiar `num_ctx` entre peticiones al mismo modelo provoca una recarga.** Es un comportamiento conocido de Ollama pero sin verificar en la doc: se confirma mirando `load_duration` > 0 en el turno.
- `num_predict` demasiado bajo corta el JSON a medias. `parseContent` no falla: degrada a `neutral` con el JSON crudo como texto (`ollama-llm.ts:186-188`), y eso es peor que un error porque Shiro leería el JSON en voz alta. El banco de pruebas cuenta estos casos.
- Un presupuesto de VRAM orientativo (**estimación sin verificar**, se mide en el escenario C): `qwen2.5:3b` Q4_K_M 1,9 GB en disco (ollama.com) + caché KV a 4096 de unos 0,15 GB + grafo de cómputo; `mxbai-embed-large` 0,67 GB; Whisper `small` int8 con contexto CUDA, unos 0,5-1 GB; Windows y el escritorio, unos 0,3-0,5 GB. Supera o roza los 4 GB, así que es muy probable que algo se reparta a CPU o se descargue entre turnos. Eso es justo lo que la medición tiene que confirmar.

### 6.3 Parte 2: probar modelos nuevos

#### 6.3.1 Presupuesto

El LLM con su caché debe quedar en **≤ 2,6 GB** para convivir con `mxbai` (0,67 GB) y con Whisper fuera de la GPU, o en ≤ 2,0 GB si Whisper sigue en ella. Con la GPU de 16 GB del PC nuevo cabe un 8B en Q4 (`qwen3:8b` 5,2 GB) junto a todo lo demás. Se planifica, pero no se da por disponible.

#### 6.3.2 Candidatos a sustituir a `qwen2.5:3b` (tamaños de ollama.com, 12-nov)

| Etiqueta exacta                       | Descarga | Cuantización | Por qué                                                                                                                           | Pega                                                                                                                                                                  |
| ------------------------------------- | -------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `qwen3:4b-instruct-2507-q4_K_M`       | 2,5 GB   | Q4_K_M       | Sucesor directo de la familia actual, variante _instruct_ (sin modo de pensamiento) y contexto de 256K. El candidato más natural. | +0,6 GB frente a hoy; casi seguro obliga a sacar Whisper de la GPU.                                                                                                   |
| `qwen3.5:2b-q4_K_M`                   | 1,9 GB   | Q4_K_M       | Familia más reciente (actualizada hace 1 mes), con el mismo tamaño en disco que hoy; dice cubrir 201 idiomas.                     | Es «thinking»: hay que enviar `think: false` (la API lo admite). Trae visión (el proyector puede ocupar VRAM, sin verificar). Versión mínima de Ollama sin verificar. |
| `qwen3.5:4b-q4_K_M`                   | 3,3 GB   | Q4_K_M       | La mejor calidad esperable de esta tanda.                                                                                         | No cabe con nada más en 4 GB: solo es referencia de techo de calidad, o para el PC nuevo.                                                                             |
| `llama3.2:3b-instruct-q4_K_M`         | 2,0 GB   | Q4_K_M       | Familia distinta como control; buena con salida estructurada.                                                                     | Tiene 2 años y su español es probablemente peor (sin verificar).                                                                                                      |
| `ministral-3:3b-instruct-2512-q4_K_M` | 3,0 GB   | Q4_K_M       | Mistral, fuerte en idiomas europeos y con contexto de 256K.                                                                       | 3,0 GB: mismo problema de VRAM que `qwen3.5:4b`.                                                                                                                      |

Descartados para 4 GB: `gemma3:4b` (3,4 GB, con visión), `gemma4:e2b` (4,3-4,6 GB) y `phi4-mini` (inglés primero). `qwen2.5:7b` ya está en disco (4,7 GB) y se mide solo como referencia del reparto CPU/GPU.

#### 6.3.3 ¿Clasificador pequeño y separado?

- **A favor:** menos latencia por turno y libera al modelo grande.
- **En contra:** un segundo modelo residente en 4 GB (más VRAM y posibles recargas) y otra pieza que mantener.
- **Recomendación:** primero el atajo heurístico (P-36) + `num_predict: 24`, y medir cuántos turnos siguen pasando por el clasificador. Probar `qwen3.5:0.8b-q8_0` (1,0 GB), `qwen3:1.7b` (1,4 GB) o `gemma3:1b` (806 MB) solo si el clasificador sigue costando más de 300 ms p50 **y** el modelo de respuesta pasa a ser mayor (7-8B en el PC nuevo).
- **Criterio:** coincidencia con etiquetas a mano en 60 mensajes (los 50 de abajo + 10 de tools) ≥ 95 % en `requires_tools` y ≥ 90 % en `tier`.

#### 6.3.4 ¿Cambiar el modelo de embeddings?

`mxbai-embed-large` tiene un contexto de 512 tokens (ollama.com) y su página no dice si es multilingüe (sin verificar).

| Alternativa            | Datos                                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| `nomic-embed-text`     | Ya está en disco.                                                                                        |
| `qwen3-embedding:0.6b` | 639 MB, 32K de contexto; dimensión sin verificar (se lee de la longitud del vector en `/api/embed`).     |
| `embeddinggemma-2`     | Multilingüe y de 768 d con truncado Matryoshka, según su página; versión mínima de Ollama sin verificar. |

**No cambiarlo ahora.** Por R-162, editar el YAML no tiene efecto: el agente se reutiliza, y forzar uno nuevo deja la memoria semántica vacía porque no existe un `reindex-memory`. Antes hace falta el script de reindexado de L-ARQ-08 (P-11a). La comparación se hace sin tocar Letta:

1. Una prueba de recuperación con 30 turnos reales del WAL de Pipe y 30 consultas con su turno correcto anotado.
2. Recall@3 de cada modelo calculado en el script con `/api/embed` y coseno.
3. Cambiar solo si la ganancia es de 10 puntos o más, y en el mismo PR que el reindexado y su aviso.

#### 6.3.5 Banco de pruebas de modelos

Mismo `scripts/bench-local.mjs` con un subcomando `--eval`, en el escenario C (o D si el candidato no cabe en C).

**a) Corrección en español (20 preguntas, 0-1 punto cada una, criterio automático por regex o lista de respuestas aceptadas):**

| #   | Pregunta                                                          | Se acepta                            |
| --- | ----------------------------------------------------------------- | ------------------------------------ |
| 1   | ¿Capital de Australia?                                            | Canberra                             |
| 2   | ¿Cuánto es 17 × 6?                                                | 102                                  |
| 3   | ¿Cuántos días tiene un año bisiesto?                              | 366                                  |
| 4   | ¿Quién escribió _Cien años de soledad_?                           | García Márquez                       |
| 5   | ¿El 15 % de 80?                                                   | 12                                   |
| 6   | Plural de «lápiz»                                                 | lápices                              |
| 7   | ¿Qué gas absorben las plantas en la fotosíntesis?                 | dióxido de carbono / CO2             |
| 8   | Si hoy es lunes, ¿qué día será dentro de 10 días?                 | jueves                               |
| 9   | Antónimo de «efímero»                                             | duradero / permanente / perenne      |
| 10  | ¿Cuántos minutos hay en 3 horas y media?                          | 210                                  |
| 11  | ¿En qué continente está Marruecos?                                | África                               |
| 12  | Traduce «I'm tired»                                               | estoy cansad(o\|a)                   |
| 13  | ¿Cuál es mayor, 0,8 o 0,75?                                       | 0,8                                  |
| 14  | ¿Fórmula química del agua?                                        | H2O                                  |
| 15  | ¿Qué planeta es el más grande del sistema solar?                  | Júpiter                              |
| 16  | Corrige: «haber si vienes»                                        | a ver                                |
| 17  | ¿Cuántos lados tiene un hexágono?                                 | 6 / seis                             |
| 18  | ¿En qué año llegó el ser humano a la Luna?                        | 1969                                 |
| 19  | ¿Qué es más pesado, un kilo de plomo o un kilo de paja?           | igual / lo mismo                     |
| 20  | Si no sabes algo, ¿qué dices? → «¿Quién ganó el Mundial de 2054?» | admite que no lo sabe (sin inventar) |

**b) Fidelidad al personaje:** el system prompt real (`buildSystemPrompt(default.yaml)`) con los 10 mensajes de §6.2.3 y 10 más de registro afectivo y serio. Se puntúa de 0 a 5 con una rúbrica sacada de `default.yaml` y de la biblia: frases cortas y calmadas, ironía seca, sin halagos, sin exceso de emojis, afecto indirecto, emoción coherente con el texto.

- **Juez:** Claude (slot cloud, con la key de Pipe) con la rúbrica, a ciegas sobre el modelo. Coste estimado: unos 0,5-1 USD por candidato (sin verificar; depende del modelo y del precio vigente).
- Pipe valida a mano 10 respuestas por candidato.

**c) Validez del JSON en 50 turnos:** los 10 mensajes + las 20 preguntas + 20 trampas (comillas, saltos de línea, emojis, código, texto de más de 150 palabras, petición de «responde sin JSON», inglés). Cuenta como OK si parsea, `emotion` ∈ `EMOTIONS`, `text` no está vacío y no contiene JSON anidado.

**d) Velocidad y VRAM:** como en la Parte 1.

**Regla de cambio** (todas a la vez, frente a `qwen2.5:3b` medido igual):

- JSON ≥ 49/50, y ningún texto vacío ni con JSON anidado.
- Corrección ≥ base + 2 de 20.
- Fidelidad ≥ base (media) y ninguna respuesta por debajo de 2.
- Turno local p50 ≤ 1,25 × base.
- `100% GPU` en el escenario en que se vaya a usar.

Si dos modelos pasan, gana el de mayor fidelidad. Cambiar el modelo por defecto es un cambio de YAML (reversible en minutos, sin ADR), pero **también hay que cambiar `classifier_model` y el `model` de Letta** (`modules.config.yaml:36` y `:91`). El de Letta tiene el mismo problema que R-162 (solo se aplica al provisionar).

#### 6.3.6 Lo que habría que descargar (Ollama y los 5 candidatos, aprobados; los opcionales, pedir permiso antes)

| Descarga                                                                                               | Tamaño                           | Para qué                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Actualizar Ollama 0.31.2 → 0.40.16                                                                     | instalador, tamaño sin verificar | Probablemente necesario para qwen3.5 y ministral-3 (sin verificar). Se mide la línea base antes y después.                                                   |
| `qwen3:4b-instruct-2507-q4_K_M`                                                                        | 2,5 GB                           | candidato                                                                                                                                                    |
| `qwen3.5:2b-q4_K_M`                                                                                    | 1,9 GB                           | candidato                                                                                                                                                    |
| `qwen3.5:4b-q4_K_M`                                                                                    | 3,3 GB                           | techo de calidad / PC nuevo                                                                                                                                  |
| `llama3.2:3b-instruct-q4_K_M`                                                                          | 2,0 GB                           | control                                                                                                                                                      |
| `ministral-3:3b-instruct-2512-q4_K_M`                                                                  | 3,0 GB                           | candidato                                                                                                                                                    |
| Opcional, clasificador: `qwen3.5:0.8b-q8_0`                                                            | 1,0 GB                           | solo si §6.3.3 lo justifica                                                                                                                                  |
| Opcional, embeddings: `qwen3-embedding:0.6b`                                                           | 639 MB                           | prueba de recall (§6.3.4)                                                                                                                                    |
| Opcional, embeddings: `embeddinggemma-2:440m`                                                          | 671-714 MB                       | prueba de recall (§6.3.4)                                                                                                                                    |
| Opcional, Whisper `large-v3-turbo` (CTranslate2, de Hugging Face, dentro del volumen `whisper_models`) | ≈ 1,6 GB, sin verificar          | Solo para medirlo en el PC nuevo: 809 M parámetros y 4 capas de decoder, multilingüe. `distil-large-v3` **no sirve**: su ficha lo define como serie inglesa. |

Total obligatorio: unos **12,7 GB** (más el instalador). Con los opcionales, unos **16 GB**. Hay unos 63 GB libres. Los modelos descartados se borran con `ollama rm`, siempre con permiso de Pipe.

### 6.4 Parte 3: personalidad de Shiro con ajuste fino (solo plan)

#### 6.4.1 Alternativa barata que cabe hoy: un Modelfile

```
FROM qwen2.5:3b            # o el ganador de la Parte 2
PARAMETER temperature 0.7
PARAMETER num_ctx 4096
PARAMETER num_predict 256
PARAMETER repeat_penalty 1.1
MESSAGE user Hoy he dormido fatal.
MESSAGE assistant {"text":"Se nota en cómo escribes. ¿Café o siesta? Elige bien.","emotion":"pensativa"}
# … 6-10 ejemplos de pocos disparos, uno por registro y emoción
```

`ollama create shiro-local:v1 -f config/ollama/shiro.Modelfile` reutiliza los blobs del modelo base y no descarga nada. En `modules.config.yaml:19` se pondría `shiro-local:v1`.

Qué se gana:

- Parámetros fijados en un archivo versionado.
- **Ejemplos de pocos disparos** con el tono y el JSON exacto, que es lo que más ayuda a un 3B a respetar «frases cortas, ironía seca» y a elegir bien la emoción.
- No se toca el código.

Qué no se gana:

- El `SYSTEM` del Modelfile es redundante, porque la app ya manda el suyo en cada turno (`ollama-llm.ts:107-109`).
- Si los `MESSAGE` se anteponen en `/api/chat` cuando el cliente manda sus propios `messages` está **sin verificar**: es la primera comprobación. Si no se anteponen, los ejemplos van en `system-prompt-builder.ts` (código, PR pequeño).

Se mide con el banco de la Parte 2 (fidelidad y JSON).

#### 6.4.2 Ajuste fino con QLoRA

- **Herramienta:** Unsloth.
  - Doc de requisitos (consultada el 12-nov): QLoRA en 4 bits pide unos 3,5 GB para 3B, 5 GB para 7B, 6 GB para 8B y 8,5 GB para 14B.
  - Funciona en Windows sin WSL (Studio) y con NVIDIA desde CC 7.0, RTX 50 incluidas (recomienda CUDA ≥ 12.8 para Blackwell).
  - Exporta con `save_pretrained_gguf(..., quantization_method="q4_k_m")` y genera el Modelfile con la plantilla de chat de entrenamiento.
  - La GTX 1650 cumple el mínimo para 3B en teoría, pero sin margen. **El entrenamiento espera a la GPU de 16 GB.**
- **Modelo base:**
  - El que se vaya a servir: el ganador de la Parte 2 en tamaño ~3-4B, para que el resultado siga corriendo en el portátil.
  - Opcionalmente, un segundo ajuste sobre 7-8B (por ejemplo `Qwen3-8B`) para el PC nuevo.
  - Siempre la variante _instruct_ con su plantilla de chat.
- **Conjunto de datos:** 800-1.500 ejemplos de 1 a 4 turnos.

  | Origen                                | Proporción | Cómo                                                                                                                                                                  |
  | ------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Biblia del personaje y `default.yaml` | ~40 %      | Matriz de 4 registros (casual, serio, técnico, afectivo) × 5 emociones × temas de `likes`/`dislikes`. Primer borrador con Claude y curado por Pipe.                   |
  | Conversaciones reales de Pipe         | ~30 %      | Del WAL (`memory.db`), **solo las suyas y con su consentimiento explícito**. Se reescriben las respuestas flojas de Shiro y se quitan datos personales y de terceros. |
  | Escritos a mano por Pipe              | ~10 %      | Unos 100 ejemplos «de oro», incluidos casos límite: incertidumbre, discrepar, no halagar, preocupación indirecta.                                                     |
  | Corrección y formato                  | ~20 %      | Preguntas factuales con su respuesta correcta en voz de Shiro, para no perder corrección, y trampas de JSON (§6.3.5c).                                                |
  - **Formato:** JSONL con `{"messages":[{"role":"system",…},{"role":"user",…},{"role":"assistant","content":"{\"text\":…,\"emotion\":…}"}]}`. El assistant siempre en el JSON exacto de `ollama-llm.ts:74-84`, con el **mismo system prompt** que genera `buildSystemPrompt`.
  - **Reparto 80/10/10** (entrenamiento, validación y prueba), **por conversación** y no por turno. El conjunto de prueba se congela y nunca se entrena con él.
  - **Sin verificar, y es una pregunta para Pipe:** usar salidas de Claude para entrenar otro modelo puede chocar con los términos de uso de Anthropic. Hay que revisarlos antes de generar el 40 %; si no se permite, ese bloque lo escribe Pipe o un modelo local.

- **Hiperparámetros de partida:** LoRA r=16, alpha=16-32, lr 2e-4, 2-3 épocas, `max_seq_length` 2048, 4 bits.
  - **Duración en una GPU de 16 GB: estimación sin verificar** de 15-60 min para unos 1.000 ejemplos con un 4B, y de 1-2 h con un 8B.
  - Más 5-10 min de exportación a GGUF, según la doc de Unsloth.
- **Evaluación:**
  - El banco de la Parte 2 sobre el **conjunto de prueba congelado**, con dos líneas base: el modelo base y el base con el Modelfile de §6.4.1.
  - **Fidelidad:** juez con la rúbrica + prueba A/B a ciegas de Pipe en 30 pares. Se acepta si gana ≥ 60 %.
  - **Corrección:** las 20 preguntas no pueden bajar más de 1 punto.
  - **Formato:** JSON ≥ 49/50, y la emoción debe coincidir con la etiqueta en ≥ 70 % del conjunto de prueba.
  - **Regresión:** las mismas cifras de velocidad y VRAM.
- **Exportación y carga:**
  - GGUF fusionado en Q4_K_M → Modelfile con `FROM ./shiro-ft-v1.Q4_K_M.gguf` → `ollama create shiro-ft:v1`. Ollama no cuantiza un GGUF al importarlo (doc de importación), así que se exporta ya cuantizado.
  - La instrucción `ADAPTER` (cargar solo el LoRA) **no aparece en la doc actual del Modelfile ni de importación** (sin verificar si sigue admitida). Se planifica con el GGUF fusionado, que sí está documentado.
- **Versionado:**
  - Los pesos no se commitean (`.gguf` ya está fuera de git según `CLAUDE.md`). Se guardan en el directorio de datos y en el backup de P-11a.
  - En el repo: `docs/finetune/` con la ficha del conjunto de datos, la configuración de entrenamiento, los resultados de evaluación, el Modelfile y el SHA-256 del GGUF; etiqueta `shiro-ft:vN`.
  - **El conjunto de datos con conversaciones reales no va al repo público.** Solo puede ir, si Pipe quiere, la parte derivada de la biblia y la escrita a mano.
- **ADR:** sí, con el **siguiente número libre al redactarlo** (tras el 0033, porque el plan de mejora §6 ya reserva 0030 licencias/P-20, 0031 datos vs instrucciones, 0032 topología y 0033 multicliente); en la tabla de ADR propuestos va como `_post-plan_`. Título: «Modelo local ajustado para la personalidad de Shiro». Cumple las condiciones 3 (dependencia nueva: Unsloth y una cadena de entrenamiento en Python, más un formato de datos), 4 (patrón de versionado de pesos y datos) y 5. Si además cambia los embeddings o separa el clasificador, se añade una enmienda al ADR 0018 o al 0015.

#### 6.4.3 Qué se puede hacer ya y qué espera al PC nuevo

| Ya (portátil)                                                | Espera al PC nuevo                      |
| ------------------------------------------------------------ | --------------------------------------- |
| Modelfile (§6.4.1) y su medición                             | Instalar Unsloth, CUDA y drivers        |
| Esquema JSONL, rúbrica y juez                                | Entrenar (QLoRA 3-4B y 7-8B)            |
| Escribir los 100 ejemplos de oro y curar los de la biblia    | Exportar a GGUF y hacer `ollama create` |
| Exportar y anonimizar conversaciones (consentimiento propio) | Evaluar contra el conjunto de prueba    |
| Congelar el conjunto de prueba y el banco de la Parte 2      | Decidir el modelo por defecto           |

### 6.5 Orden recomendado y horas

| Orden | Bloque                                                          | Horas (agente + revisión de Pipe) | Notas                                            |
| ----- | --------------------------------------------------------------- | --------------------------------- | ------------------------------------------------ |
| 1     | Parte 1: `bench-local.mjs` + línea base en Ollama 0.31.2        | 4-5 h                             | PR propio antes de P-16; depende de P-04 PR2.    |
| 2     | Parte 1: ajustes de máquina uno por uno y documentación de VRAM | 2-3 h                             | Cierra L-PERF-03 y R-131.                        |
| 3     | Actualizar Ollama y repetir la línea base                       | 1 h                               | Aprobado (2026-11-13), después de la línea base. |
| 4     | Parte 2: banco `--eval` + descargas + 5 candidatos              | 6-8 h                             | Las corridas son en su mayoría desatendidas.     |
| 5     | Parte 3a: Modelfile y su medición                               | 1-2 h                             | —                                                |
| 6     | Parte 3b: conjunto de datos y evaluación                        | 8-12 h                            | Casi todo es tiempo de Pipe: escribir y curar.   |
| 7     | Parte 3c: entrenamiento y evaluación en el PC nuevo + ADR       | 6-8 h                             | Cuando exista el PC.                             |

Total: unas 28-39 h. A 4-6 h por semana, las partes 1 y 2 caben en 3-4 semanas y la 3 queda en segundo plano hasta el PC nuevo.

### 6.6 Fuentes (consultadas el 2026-11-12)

- Ollama: FAQ (variables, `keep_alive`, `ollama ps`, caché KV y flash attention), `docs.ollama.com/context-length`, la referencia del Modelfile, importación, salida estructurada, `thinking` y la API (`github.com/ollama/ollama/blob/main/docs/api.md`); releases (`github.com/ollama/ollama/releases`).
- Biblioteca de ollama.com: páginas de etiquetas de `qwen3`, `qwen3.5`, `gemma3`, `gemma4`, `llama3.2`, `ministral-3`, `qwen2.5`, `qwen3-embedding`, `mxbai-embed-large`, `embeddinggemma-2` y el índice de la biblioteca.
- CTranslate2: `opennmt.net/CTranslate2/quantization.html`. faster-whisper: README de `github.com/SYSTRAN/faster-whisper`. Fichas de `openai/whisper-large-v3-turbo` y `distil-whisper/distil-large-v3` en Hugging Face.
- Unsloth: requisitos (`unsloth.ai/docs/get-started/fine-tuning-for-beginners/unsloth-requirements`), guardado en GGUF y en Ollama (`unsloth.ai/docs/basics/inference-and-deployment/`).
