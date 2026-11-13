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

Hay que nombrarlo: el servicio tiene el perfil `stt` y `docker compose up -d` a
secas no lo levanta.

La primera vez tarda varios minutos porque construye la imagen y
descarga el modelo (`small` por defecto, ~244 MB). El cache de modelos
queda en un volumen Docker, así que reinicios posteriores son rápidos.

### Requisitos para que use la GPU

El `docker-compose.yml` declara la GPU NVIDIA como recurso del
contenedor. En **Docker Desktop Windows con WSL2** y drivers GeForce
recientes esto suele funcionar sin configurar nada extra — la GPU del
host queda visible dentro del contenedor automáticamente.

**Cómo saber si tu setup la ve**:

```bash
docker compose logs whisper --tail 30
```

Si aparece `WARNING: The NVIDIA Driver was not detected`, el contenedor
está corriendo en CPU. Causas frecuentes:

- Setup sin GPU: comenta la sección `deploy:` en `docker-compose.yml` y
  pon `WHISPER_DEVICE=cpu` en tu `.env`.
- Docker Desktop sin WSL2 o con WSL2 sin drivers NVIDIA: actualiza los
  drivers GeForce del host de Windows; reinicia Docker Desktop.

Verifica el modelo cargado mirando los logs después del arranque:

```
cargando modelo whisper small (device=auto, compute_type=int8)
modelo cargado en X.XXs (device resuelto: cuda)    ← debe decir `cuda`, no `cpu`
warm-up de Whisper completado
```

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

| Variable                        | Default servicio    | Default compose | Descripción                                                                                                                                                                                                                                    |
| ------------------------------- | ------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WHISPER_MODEL`                 | `small`             | `small`         | `tiny`/`base`/`small`/`medium`/`large-v3`/`distil-large-v3`.                                                                                                                                                                                   |
| `WHISPER_DEVICE`                | `auto`              | `auto`          | `auto`/`cuda`/`cpu`. `auto` detecta CUDA y degrada si no hay.                                                                                                                                                                                  |
| `WHISPER_COMPUTE_TYPE`          | `auto`              | `int8`          | `auto`/`int8`/`int8_float16`/`int8_bfloat16`/`float16`/`float32`. `int8` es el default seguro (CPU + cualquier CUDA). Con Tensor Cores (RTX 2060+) usa `int8_float16` para ~2× más velocidad.                                                  |
| `WHISPER_LANGUAGE`              | `es`                | `es`            | ISO 639-1.                                                                                                                                                                                                                                     |
| `WHISPER_PARTIAL_INTERVAL_MS`   | `1500`              | `2500`          | Cada cuánto retranscribir el buffer para emitir un partial. Más alto = menos cómputo acumulado por turno.                                                                                                                                      |
| `WHISPER_HOTWORDS`              | `""` (sin hotwords) | `Shiro`         | Palabras clave que el decoder boostea (separadas por espacios). Faster-whisper ≥1.1.0. Sesga sin filtrarse al output — usar esto en vez de un prompt completo evita que Whisper escupa la frase como transcripción cuando el audio es ambiguo. |
| `WHISPER_SAMPLE_RATE`           | `16000`             | `16000`         | Sample rate esperado del PCM Int16 LE mono que envía el cliente.                                                                                                                                                                               |
| `WHISPER_HOST` / `WHISPER_PORT` | `0.0.0.0` / `8765`  | (sin efecto)    | Bind del servidor **solo sin Docker** (`python -m services.whisper.main`). En Docker el `CMD` del `Dockerfile` fija `--host 0.0.0.0 --port 8765` y la exposición la decide `ports:` de compose (solo `127.0.0.1` salvo `WHISPER_BIND`).        |

Sin compose el servicio usa sus propios defaults (`auto`, 1500 ms y sin hotwords). Para igualar compose exporta `WHISPER_COMPUTE_TYPE=int8`, `WHISPER_PARTIAL_INTERVAL_MS=2500` y `WHISPER_HOTWORDS=Shiro`.

> **Sobre `compute_type` y Tensor Cores**: `int8_float16` y `int8_bfloat16` son ~2× más rápidos que `int8` puro, pero requieren **Tensor Cores** — los tienen RTX 2060+, Tesla T4, A100, H100, RTX 50-series, etc. La **GTX 1650** y **GTX 1660** son Turing **sin** Tensor Cores: solo aceptan `int8`, `float16`, `float32`. Por eso el default conservador es `int8`. Si tienes Tensor Cores, pon `WHISPER_COMPUTE_TYPE=int8_float16` en tu `.env` para ganar el speedup. Las GPU Pascal (GTX 10xx) tampoco tienen Tensor Cores: usa `int8`.

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
quieres CUDA, los toolkits NVIDIA instalados nativamente. Ejecuta todo
**desde la raíz del repo** (el paquete `services.whisper` solo se resuelve
desde ahí):

```bash
python -m venv services/whisper/.venv
source services/whisper/.venv/bin/activate    # Windows: services/whisper/.venv/Scripts/activate
pip install -r services/whisper/requirements.txt
python -m services.whisper.main
```

Ojo: `.venv` todavía no está en `.gitignore`; no lo commitees.

Tests:

```bash
pytest services/whisper/tests
```

Los tests de Python no corren en el CI y la revisión de 2026-11 los encontró
probablemente rotos (R-194). El plan de mejora propone un job mínimo de pytest
(P-06b) y la suite completa en CI (P-18), sin implementar.

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
- **Seguridad (deuda local diferida)**: dentro del contenedor el servicio
  escucha en `0.0.0.0`, pero compose lo publica solo en `127.0.0.1` salvo
  `WHISPER_BIND`. Sigue con CORS `*`, sin autenticación, y el buffer del WS
  `/stt` no tiene tope (audio ilimitado → DoS de memoria/CPU). La decisión
  vigente es
  [ADR 0027](../../docs/adr/0027-autenticacion-token-bus-stt-multicliente.md)
  (token en el handshake, `WHISPER_HOST` a `127.0.0.1` y tope de buffer con
  cierre 1009), Accepted y **sin implementar en este servicio**. Estado en la fila SEC-02 de la
  tabla viva de
  [`docs/security-review-2026-07.md`](../../docs/security-review-2026-07.md).
