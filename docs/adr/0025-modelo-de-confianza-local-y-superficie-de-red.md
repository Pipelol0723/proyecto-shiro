# ADR 0025: Modelo de confianza local y superficie de red

- **Status**: Proposed
- **Fecha**: 2026-07-15
- **Decidido por**: Pipelol (pendiente de acuerdo con el compañero)

## Contexto

La revisión de seguridad de 2026-07 (ver
[`docs/security-review-2026-07.md`](../security-review-2026-07.md)) encontró
que el `core-host` (WebSocket `/bus` + HTTP de audio) y el microservicio
Whisper (`/stt`) **escuchan en `0.0.0.0`, sin autenticación y sin validar el
header `Origin`**. Hasta ahora esto se trató como "es local, no pasa nada",
pero nunca se escribió como una decisión con su frontera. El problema es que
"local" es más ambiguo de lo que parece:

- Bindear a `0.0.0.0` expone el servicio a **toda la LAN**, no solo a
  `localhost`.
- Los WebSocket **no** están sujetos a same-origin al conectar, así que
  **cualquier web que el usuario visite** mientras Shiro corre puede abrir un
  WS a `ws://localhost:9876/bus` e inyectar `user:message`, auto-aprobar tools
  `confirm` (el `requestId` se hace broadcast) o pisar las API keys vía
  `secrets:save`.

La arquitectura **ya prevé** clientes que no son el desktop local (móvil,
Arduino, IoT — ver `plan-modular-ai-companion.md` y el patrón de transports del
ADR 0003/0013). El día que llegue el primero, "sin auth" deja de ser aceptable.
No sabemos aún **cuándo** llega ese hito, así que la decisión debe fijar el
**trigger** de reversión, no una fecha.

Esto NO es un bug puntual: es una postura de confianza que afecta a varios
módulos (transports, pipeline, secrets, Whisper) y es cara de retrofitear. Por
eso va a ADR y no solo a un fix.

## Decisión

**Aceptamos operar sin autenticación entre cliente y `core-host`/Whisper
MIENTRAS el despliegue sea estrictamente local y de un solo usuario — pero
cerramos la superficie a `localhost` y validamos `Origin` desde ya, y fijamos
un trigger duro de reversión.**

Concretamente, en este hito:

1. **Bindear a `127.0.0.1`** por defecto tanto el `core-host` (WS + HTTP de
   audio) como Whisper. Exponer a `0.0.0.0` pasa a ser un opt-in explícito por
   variable de entorno (`SHIRO_BIND_HOST`), no el default.
2. **Validar `Origin`** en el upgrade del WebSocket del `core-host`: allowlist
   con los orígenes del cliente Tauri/dev (`tauri://localhost`,
   `http://localhost:5173`). Un `Origin` no reconocido se rechaza.
3. **Tope de buffer** en Whisper y cierre de conexiones que excedan el límite
   (defensa de disponibilidad, independiente de la auth).

**Trigger de reversión (obligatorio):** en cuanto se añada **el primer cliente
que no sea el desktop local en la misma máquina** (móvil, otro equipo de la LAN,
bridge Arduino/IoT), este ADR se supersede por otro que introduzca
**autenticación por token compartido** (mismo patrón que
`LETTA_SERVER_PASSWORD`) en el handshake del bus y del STT, y que el
`tool:approval` valide la propiedad de la sesión.

## Alternativas consideradas

- **Auth por token desde ya (ahora).** Descartada _por ahora_: añade fricción
  de setup (gestionar y distribuir el token) para un beneficio marginal en un
  despliegue de un solo proceso en `localhost`. Se difiere al trigger, pero se
  deja escrito para no improvisarlo entonces.
- **Seguir en `0.0.0.0` sin más (statu quo).** Descartada: el vector "web que
  visitas mientras Shiro corre" es real hoy y no cuesta nada cerrarlo bindeando
  a `localhost` + validando `Origin`. No merece esperar al trigger.
- **mTLS / certificados entre cliente y server.** Descartada por
  sobre-ingeniería para el hito actual; se reconsiderará si el transporte pasa a
  cruzar redes no confiables (no solo LAN doméstica).

## Consecuencias

### Positivas

- Cierra el vector drive-by desde el navegador y la exposición a la LAN sin
  añadir fricción (no hay token que gestionar todavía).
- Deja la decisión y su disparador **por escrito**: quien añada el cliente
  móvil se topa con este ADR y sabe que debe implementar la auth antes.
- Separa dos ejes que estaban mezclados: **disponibilidad** (tope de buffer,
  bind) se arregla ya; **autenticación** se difiere con criterio.

### Negativas / Riesgos

- Bindear a `127.0.0.1` puede romper flujos donde hoy alguien accede al
  core-host desde otro dispositivo de la LAN de forma informal (no soportada);
  se documenta el opt-in `SHIRO_BIND_HOST`.
- El trigger depende de disciplina humana: si alguien añade un cliente de red y
  **no** lee este ADR, la ventana queda abierta. Mitigación: enlazarlo desde el
  ADR 0003 (transports) y desde el README de arquitectura.

### Neutrales

- No cambia el modelo de datos ni el protocolo del bus; solo el bind y una
  comprobación de `Origin`.

## Notas de implementación

- `packages/core-host/src/transports/websocket-server-transport.ts` — pasar
  `host` a `httpServer.listen(...)`; validar `Origin` en el handler de
  `connection`/`upgrade`.
- `packages/core-host/src/server.ts` — leer `SHIRO_BIND_HOST` (default
  `127.0.0.1`).
- `services/whisper/config.py` / `docker-compose.yml` — `WHISPER_HOST` default
  `127.0.0.1`, publicar `127.0.0.1:8765:8765`.
- `services/whisper/main.py` — tope de `bytearray` + cierre con code 1009.
- Al llegar el trigger: handshake con token en `parseEnvelope`/upgrade y en el
  WS de Whisper.

## Referencias

- [`docs/security-review-2026-07.md`](../security-review-2026-07.md) —
  hallazgos SEC-01, SEC-02 (y contexto de SEC-08/SEC-09).
- [ADR 0003](0003-transport-abstraction-device-registry.md) — abstracción de
  transports y registry de dispositivos (multi-device previsto).
- [ADR 0013](0013-protocolo-websocket-eventbus.md) — protocolo WebSocket del
  EventBus.
- [ADR 0020](0020-tts-elevenlabs-systemtts-fallback-y-multidevice-diferido.md) —
  multi-device ya diferido en el eje TTS/cliente-activo.
