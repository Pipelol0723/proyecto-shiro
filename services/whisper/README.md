# shiro-whisper

Microservicio STT del proyecto. Recibe audio del cliente desktop por
WebSocket y devuelve transcripciones parciales y final usando
**faster-whisper**. Ver [ADR 0019](../../docs/adr/0019-stt-faster-whisper-microservicio-python.md) para
el porqué.

## Arrancar (vía Docker)

Desde la raíz del repo:

```bash
docker compose up -d whisper
```

La primera vez tarda varios minutos porque construye la imagen y
descarga el modelo (`small` por defecto, ~244 MB). El cache de modelos
queda en un volumen Docker, así que reinicios posteriores son rápidos.

Verifica que responde:

```bash
curl http://localhost:8765/health
```

Debe devolver algo como:

```json
{
  "status": "ok",
  "model": "small",
  "device": "cuda",
  "language": "es",
  "sample_rate": 16000
}
```

## Variables de entorno

El servicio (Python standalone) trae defaults conservadores; el `docker-compose.yml` del proyecto los afina al hardware de Shiro (CUDA esperado).

| Variable                        | Default servicio   | Default compose                                    | Descripción                                                                                                                                                                                   |
| ------------------------------- | ------------------ | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WHISPER_MODEL`                 | `small`            | `small`                                            | `tiny`/`base`/`small`/`medium`/`large-v3`/`distil-large-v3`.                                                                                                                                  |
| `WHISPER_DEVICE`                | `auto`             | `auto`                                             | `auto`/`cuda`/`cpu`. `auto` detecta CUDA y degrada si no hay.                                                                                                                                 |
| `WHISPER_COMPUTE_TYPE`          | `auto`             | `int8`                                             | `auto`/`int8`/`int8_float16`/`int8_bfloat16`/`float16`/`float32`. `int8` es el default seguro (CPU + cualquier CUDA). Con Tensor Cores (RTX 2060+) usa `int8_float16` para ~2× más velocidad. |
| `WHISPER_LANGUAGE`              | `es`               | `es`                                               | ISO 639-1.                                                                                                                                                                                    |
| `WHISPER_PARTIAL_INTERVAL_MS`   | `1500`             | `2500`                                             | Cada cuánto retranscribir el buffer para emitir un partial. Más alto = menos cómputo acumulado por turno.                                                                                     |
| `WHISPER_INITIAL_PROMPT`        | `""` (sin prompt)  | `El usuario habla con un asistente llamado Shiro.` | Sesga el decoder hacia un vocabulario concreto. Muy efectivo para nombres propios — los modelos pequeños mapean "Shiro" a "Chiro"/"Ciro" sin esto.                                            |
| `WHISPER_SAMPLE_RATE`           | `16000`            | `16000`                                            | Sample rate esperado del PCM Int16 LE mono que envía el cliente.                                                                                                                              |
| `WHISPER_HOST` / `WHISPER_PORT` | `0.0.0.0` / `8765` | mismo                                              | Bind del servidor.                                                                                                                                                                            |

> **Sobre `compute_type` y Tensor Cores**: `int8_float16` y `int8_bfloat16` son ~2× más rápidos que `int8` puro, pero requieren **Tensor Cores** — los tienen RTX 2060+, Tesla T4, A100, H100, RTX 50-series, etc. La **GTX 1650** y **GTX 1660** son Turing **sin** Tensor Cores: solo aceptan `int8`, `float16`, `float32`. Por eso el default conservador es `int8`. Si tienes Tensor Cores, pon `WHISPER_COMPUTE_TYPE=int8_float16` en tu `.env` para ganar el speedup.

## Protocolo del WebSocket (`/stt`)

Diseñado para que el **cliente desktop** lo consuma directamente — el
`core-host` no participa en este flujo (ADR 0019, decisión 3).

### Cliente envía

- **Frames binarios**: chunks de audio crudo **PCM Int16 LE mono** al
  sample rate configurado (default 16 kHz).
- **Frames de texto** (JSON): comandos de control.
  - `{"type": "stop"}` — fin del turno: el servidor transcribe el buffer
    completo, emite el `transcribed` final y cierra la conexión.

### Servidor envía (siempre JSON)

- `{"type": "partial", "text": "..."}` — resultado parcial; reemplaza al
  anterior. Se envía solo cuando el texto cambia respecto al partial
  inmediatamente previo.
- `{"type": "transcribed", "text": "...", "isFinal": true}` — resultado
  definitivo tras el `stop`. El cliente debe traducir esto a
  `user:message` en el bus del core-host.
- `{"type": "error", "message": "..."}` — cualquier fallo.

## Desarrollo local (sin Docker)

Útil para iterar el código del servicio. Requiere Python 3.11 y, si
quieres CUDA, los toolkits NVIDIA instalados nativamente.

```bash
cd services/whisper
python -m venv .venv
source .venv/bin/activate    # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m services.whisper.main
```

Tests:

```bash
pytest services/whisper/tests
```

Los tests NO están en el CI principal (que es Vitest sobre el monorepo
TS); ejecútalos cuando toques este servicio. Si más adelante el
servicio crece, añadimos un workflow GitHub Actions específico.

## Notas operativas

- **Cold start**: el `warmup()` al arranque transcribe 250 ms de
  silencio para forzar la carga de pesos en GPU. La primera petición
  real ya no paga ese coste.
- **Partials**: el modelo se re-aplica al buffer entero cada
  `WHISPER_PARTIAL_INTERVAL_MS`. Bajo en CPU; aceptable en GPU.
  Subóptimo a propósito en V1 (faster-whisper no tiene true streaming).
- **VRAM en GTX 1650**: `small` cabe junto con `qwen2.5:3b` + Letta
  embeddings. Para modelos mayores, espera a hardware más holgado.
- **Sin estado persistente**: cada conexión WS es independiente, no hay
  agentes ni sesiones que sobrevivan.
