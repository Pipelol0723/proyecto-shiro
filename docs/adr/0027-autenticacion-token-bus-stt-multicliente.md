# ADR 0027: Autenticación por token compartido en el bus y el STT

- **Status**: Accepted
- **Fecha**: 2026-08-18
- **Decidido por**: Pipelol
- **Supersede a**: [ADR 0025](0025-modelo-de-confianza-local-y-superficie-de-red.md)

## Contexto

El [ADR 0025](0025-modelo-de-confianza-local-y-superficie-de-red.md) aceptó
operar sin autenticación **mientras el despliegue fuese estrictamente local y
de un solo usuario**, y fijó un trigger explícito: _"en cuanto se añada el
primer cliente que no sea el desktop local en la misma máquina […] este ADR se
supersede por otro que introduzca autenticación por token compartido"_.

La estación holográfica del [ADR 0026](0026-estacion-holografica-pepper-ghost-cliente-ligero.md)
**es ese cliente**. El trigger se ha disparado.

Dos matices que condicionan el alcance de este ADR:

- **El ADR 0025 quedó en `Proposed` y nunca se implementó.** El bind sigue
  siendo implícito (`httpServer.listen(options.port)` en
  `packages/core-host/src/transports/websocket-server-transport.ts`), es decir
  `0.0.0.0`, sin validación de `Origin` y sin tope de buffer en Whisper. Por
  tanto este ADR no solo añade la auth: **absorbe también los tres puntos
  pendientes de 0025**, que siguen siendo correctos.
- La estación **necesita** que el `core-host` escuche en la LAN. O sea, el
  mitigante principal de 0025 —bindear a `127.0.0.1`— deja de aplicar al caso
  de uso nuevo. La auth pasa de "deseable" a "lo único que queda".

Hay además un agujero concreto que 0025 ya nombraba y que multi-cliente
empeora: el `requestId` de `tool:requires-approval` se hace **broadcast**, así
que cualquier cliente conectado puede auto-aprobar una tool `confirm` de otro
(ADR 0022).

## Decisión

**Vamos a autenticar el bus del `core-host` y el WebSocket de Whisper con un
token compartido, presentado en el handshake, y a atar la aprobación de tools a
la sesión que la originó.**

Concretamente:

1. **Token**: `SHIRO_BUS_TOKEN`, 32 bytes aleatorios en hex, generado en el
   primer arranque y guardado junto a las API keys en `secrets.env` dentro del
   `app_local_data_dir` (mismo mecanismo del setup wizard del ADR 0024). Si la
   variable ya existe en el entorno, se respeta y no se pisa.
2. **Handshake**: el cliente envía el token en el **primer frame** del
   WebSocket (`hello`), no por query string —para que no acabe en logs de
   acceso ni en el historial— y el servidor cierra con **1008** si el token
   falta, es incorrecto, o no llega dentro de una ventana corta. La comparación
   es en **tiempo constante**.
3. **Bind explícito**: `SHIRO_BIND_HOST` con default `127.0.0.1`. Exponer a la
   LAN es opt-in consciente, y el setup wizard lo pide de forma explícita al
   emparejar una estación (no se activa solo).
4. **`Origin`**: se mantiene la allowlist para clientes navegador
   (`tauri://localhost`, `http://localhost:5173`). Los clientes que no son
   navegador no mandan `Origin`; su ausencia se acepta **solo si el token es
   válido**. Un `Origin` presente y no reconocido se rechaza siempre, con token
   o sin él — eso cierra el drive-by desde una web abierta.
5. **Propiedad de la sesión en `tool:approval`**: el `requestId` queda asociado
   al `clientId` que originó el turno, y el `ApprovalGate` **descarta
   aprobaciones que vengan de otra sesión**. El evento se sigue emitiendo a
   todos los clientes para que puedan mostrar estado, pero solo el dueño puede
   resolverlo.
6. **Whisper**: el mismo token en el handshake de `/stt`, `WHISPER_HOST` con
   default `127.0.0.1`, y el **tope de buffer** con cierre 1009 que 0025 ya
   había especificado.
7. **Emparejamiento**: la estación recibe el token una sola vez en el
   aprovisionamiento (fichero de config al montarla). No hay flujo de
   emparejamiento por pantalla en V1 — la estación se monta a mano y no cambia
   de dueño.

**Lo que NO hacemos: TLS.** El token viaja en claro por `ws://` dentro de la LAN
doméstica. Es un riesgo asumido y acotado (ver abajo), con su propio trigger.

## Alternativas consideradas

- **mTLS / certificados entre cliente y server.** Descartada, igual que en 0025:
  sobre-ingeniería para una LAN doméstica de un usuario, y la gestión de CA
  propia y renovación de certificados es una carga de mantenimiento
  desproporcionada para 4-6 h/semana.
- **TLS simple (`wss://`) con certificado autofirmado.** Descartada para V1:
  obliga a distribuir e instalar el certificado en cada cliente, y en la
  estación (webview embebido) el manejo de errores de certificado es
  desagradable. Se reconsidera en el trigger de abajo.
- **OAuth / usuarios y contraseñas.** Descartada: no hay multi-usuario. Un token
  compartido modela exactamente la realidad (un dueño, N dispositivos suyos).
- **Token por query string** (`ws://host/bus?token=...`). Descartada: acaba en
  logs de acceso, en referrers y en el historial del webview. El coste de
  moverlo al primer frame es casi cero.
- **Seguir sin auth y confiar en la LAN.** Descartada explícitamente: es justo lo
  que 0025 aceptó _bajo la condición_ de ser local, y esa condición ya no se
  cumple. Una LAN doméstica tiene invitados, móviles y IoT de terceros.
- **Firmar cada evento en vez de autenticar la conexión.** Descartada por
  complejidad desproporcionada: el transporte es un canal persistente, no
  peticiones sueltas; autenticar el canal una vez es suficiente.

## Consecuencias

### Positivas

- Desbloquea el ADR 0026 y, con él, cualquier cliente futuro (móvil,
  arduino-bridge, iot-bridge) sin volver a abrir la discusión.
- Cierra el vector drive-by desde el navegador (`Origin` + token) y el
  auto-aprobado cruzado de tools `confirm`, que era el agujero más serio del
  ADR 0022 en multi-cliente.
- Recupera los tres puntos de 0025 que se habían quedado sin implementar, en vez
  de dejarlos huérfanos en un ADR `Proposed`.
- El `clientId` que exige el punto 5 es el mismo que el ADR 0026 necesita para
  enrutar la respuesta: una sola pieza de protocolo sirve a las dos decisiones.

### Negativas / Riesgos

- **Fricción de setup**: hay un token que generar, guardar y copiar a la
  estación. Es el precio directo del multi-dispositivo.
- **El token viaja en claro por la LAN.** Quien ya esté dentro de la red y pueda
  esnifar tráfico puede capturarlo. Asumido para una LAN doméstica; ver trigger.
- **Un fallo de auth es un fallo de arranque opaco** ("no conecta"). Hay que
  cuidar el mensaje de error y el logging, o el debugging será miserable.
- Si el usuario pierde el `secrets.env`, todos los clientes dejan de conectar a
  la vez.

### Neutrales

- El envelope del wire gana campos (`clientId`, y el frame `hello`). Cambio de
  protocolo menor pero que rompe compatibilidad con clientes viejos: todos los
  clientes se actualizan a la vez, que hoy es trivial (hay uno).

## Trigger de revisión

Este ADR se supersede por otro que introduzca **TLS** en cuanto ocurra
cualquiera de estas:

- El transporte deja de estar confinado a la LAN doméstica (acceso desde fuera,
  túnel, VPS, exposición por reverse proxy).
- Aparece un segundo usuario humano con sus propios dispositivos.
- La red deja de ser de confianza (piso compartido, red de universidad, wifi de
  invitados en el mismo segmento).

## Notas de implementación

- `packages/core-host/src/transports/websocket-server-transport.ts` — pasar
  `host` a `listen(...)`; validar `Origin` y el frame `hello` en el handler de
  `connection`/`upgrade`; `timingSafeEqual` para el token.
- `packages/core-host/src/server.ts` — leer `SHIRO_BIND_HOST` (default
  `127.0.0.1`) y `SHIRO_BUS_TOKEN`; generarlo si no existe.
- `packages/core/src/core/transports/wire-schema.ts` — frame `hello` y
  `clientId` en el envelope, validados con zod.
- `packages/core-host/src/tools/approval-gate.ts` — asociar `requestId` a
  `clientId` y descartar aprobaciones ajenas.
- `services/whisper/config.py` / `docker-compose.yml` — `WHISPER_HOST` default
  `127.0.0.1`, publicar `127.0.0.1:8765:8765`, token en el handshake.
- `services/whisper/main.py` — tope de `bytearray` + cierre con code 1009.
- Setup wizard (ADR 0024) — generar y mostrar el token, y pedir confirmación
  explícita antes de bindear a la LAN.

## Referencias

- [ADR 0025](0025-modelo-de-confianza-local-y-superficie-de-red.md) — decisión
  previa; este ADR la supersede al dispararse su trigger.
- [ADR 0026](0026-estacion-holografica-pepper-ghost-cliente-ligero.md) — la
  estación es el cliente que dispara el trigger.
- [ADR 0013](0013-protocolo-websocket-eventbus.md) — protocolo WebSocket del bus.
- [ADR 0022](0022-shiro-agentic-tools-fs-shell.md) — `ApprovalGate` y tools
  `confirm`.
- [ADR 0024](0024-packaging-tauri-windows-sidecar.md) — `secrets.env` y setup
  wizard.
- [`docs/security-review-2026-07.md`](../security-review-2026-07.md) — hallazgos
  SEC-01, SEC-02, SEC-08, SEC-09.
