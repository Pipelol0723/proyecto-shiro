# ADR 0036: Turnos propios e iniciativa — cola, `turnId` y hablar primero

- **Status**: Proposed
- **Fecha**: 2026-11-24
- **Decidido por**: Pipelol0723 (pendiente de aceptar)

> **Estado (2026-11-24):** propuesta escrita por un agente a partir de lo que
> el dueño decidió el 2026-11-19 para la
> [vía de iniciativa](../plan-mejora-2026-11.md#vía-paralela-iniciativa-sentidos-vida-propia-y-directos)
> del plan de mejora. **Sin aceptar y sin implementar.** Es el paso IN-0; lo
> cumplen los pasos IN-1 a IN-6. La tabla «Qué viene del dueño y qué propone
> el agente» separa lo uno de lo otro.

## Contexto

Shiro solo existe cuando le hablan. El dueño quiere que también empiece ella:
que salude, avise, retome temas y proponga. El código de hoy no tiene por
dónde (comprobado sobre `develop` el 2026-11-24):

- **Todo turno nace de un `user:message`** y su lógica entera vive en ese
  manejador (`conversation-flow.ts`). Lo único que Shiro dice sin que le
  hablen es el aviso de self-dev: un texto que arma el código, con el tema y
  el enlace o el error, sin pasar por el modelo.
- **No hay cola.** Dos mensajes seguidos corren a la vez y el segundo no ve la
  respuesta del primero (R-061). El `turnId` existe desde P-16 solo para medir
  tiempos, y es opcional.
- **`llm:responded` sirve para tres cosas** (una respuesta, la frase de error
  y el aviso de self-dev) sin un campo que diga cuál es (R-093). El aviso se
  cruza con un turno en curso (R-092).
- **Un turno en vuelo no se puede parar**: `tts:cancel` solo corta el audio
  (R-094), y ni eso entre el texto y la voz (R-080).
- **El modelo no sabe qué hora es** ni cuánto hace del último mensaje, y su
  salida le obliga siempre a decir algo
  ([ADR 0014](0014-llm-structured-output-text-emotion.md)).
- **Los tokens gastados se suman y se tiran.** No hay contador ni tope.
- **El bus no distingue clientes**: la voz suena en todos los que no estén
  silenciados, y cualquiera puede emitir cualquier evento (lo cierra P-39).
- **La memoria entra en el contexto mezclada con las instrucciones** (lo
  cierra P-33, con el ADR 0031).

Lo que no sabemos y solo dirá el uso: cuánta iniciativa cansa, cuánto cuesta
de verdad un mes y si «la ventana está a la vista» basta como señal de que
hay alguien delante.

Este ADR absorbe el que el plan dejaba para después, «Turnos con identidad»,
y lo adelanta: sin cola ni `turnId`, un turno que empieza Shiro se mezclaría
con los del dueño.

## Decisión

**Vamos a hacer del turno una unidad con identidad, origen y una cola única
en el core-host, y a dejar que un turno nazca también del servidor: un «turno
propio», que abre un módulo de iniciativa a partir de lo que cuentan los
sentidos, dentro de un regulador y un tope de gasto, y que puede acabar en
silencio.**

### 1. El turno: identidad, origen y cola

Un turno va desde que algo pide que Shiro hable hasta que su respuesta está
entregada o se decide que no hay respuesta. **Entregado** quiere decir que el
texto ya salió por `llm:responded`; la voz viene después.

| Campo     | Valores                              | Qué es                                                                                                                                                 |
| --------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `turnId`  | Un identificador único               | Lo pone el core-host al aceptar el turno y va en todos los eventos que el core emite sobre él                                                          |
| `origin`  | `user`, `shiro` o `system`           | Quién lo abre: el dueño con un mensaje; Shiro, con un turno propio; o el sistema, con un texto que arma el código sin el modelo (el aviso de self-dev) |
| `trigger` | `sense` y `kind`, de listas cerradas | Solo en los turnos propios: qué lo disparó (§3)                                                                                                        |

**La cola es una sola y atiende un turno a la vez**, por este orden:

1. **Los turnos del dueño**, en orden de llegada. Ninguno se descarta.
2. **Los encargos** (§3), por orden de vencimiento. Ninguno se pierde. Si
   vencen varios a la vez, van en un solo turno.
3. **Los avisos del sistema.**
4. **Lo espontáneo**: como mucho un turno, y solo con la cola vacía. Si llega
   cualquier otra cosa mientras espera o piensa, se descarta.

Lo que eso implica:

- El mensaje del dueño se guarda en la memoria cuando empieza su turno, no al
  llegar. Así el segundo mensaje ve la respuesta del primero, y el primero no
  ve al segundo.
- **Si llega un mensaje del dueño y un turno propio todavía no está
  entregado, ese turno se cancela sin decir nada.** Un encargo cancelado así
  vuelve a la cola y se dice después.
- **Si llega cuando el texto ya está entregado**, el texto se queda y la voz
  se corta. Si la voz aún no se había emitido, no se emite. Vale para
  cualquier turno, y cierra R-080.
- **Un permiso pendiente no para la cola cinco minutos.** Si llega un mensaje
  del dueño mientras su turno anterior espera una aprobación, esa aprobación
  se da por rechazada; el turno acaba y después se atiende el mensaje nuevo.
- Para la cola, un turno acaba cuando acaba la parte del servidor, no cuando
  deja de sonar: un cliente silenciado nunca reproduce el audio.
- La cola es única porque el bus no distingue clientes. Cuando exista el
  `clientId` del ADR 0033, se parte por cliente.
- **Una sesión de self-dev no es un turno**: pararía la cola durante minutos.
  Lo son sus avisos hablados. Sus aprobaciones no llevan `turnId`.

Cada turno se anuncia con `turn:accepted`, al entrar en la cola, y con
`turn:ended`, que dice cómo acabó: `replied`, `silent`, `failed` o
`cancelled` (§11). El cliente muestra «pensando» desde el `turn:accepted` de
un turno del dueño; hoy espera a `router:routed`, y en ese hueco se podía
lanzar otro turno (R-121). Con un turno propio no muestra nada hasta que haya
texto: si Shiro decide callar, nadie lo nota.

### 2. Cancelar un turno

`turn:cancel` (cliente → core) para un turno, en la cola o en vuelo: aborta
la llamada al modelo, da por rechazada una aprobación pendiente, no empieza
ninguna herramienta más y no sintetiza la voz.

- Una herramienta que ya está en marcha termina: cortar una escritura a
  medias es peor. La cola se libera cuando termina.
- Un turno cancelado no pasa al otro modelo, y lo que llegue tarde de una
  llamada abortada se tira.
- El turno acaba como `cancelled`. El mensaje del dueño queda en la memoria;
  una respuesta que no llegó a entregarse no se guarda.
- Cancelar un turno que ya acabó, o que no existe, no hace nada.

Es lo que necesita un botón «Detener»; el botón es del rediseño. `tts:cancel`
sigue como está: corta la voz de una respuesta ya entregada.

### 3. Sentidos y disparos

Un **sentido** es una fuente de hechos: cuenta lo que pasa y nada más. No
abre turnos ni habla con el modelo. Un **disparo** es un hecho que el módulo
de iniciativa toma como motivo para hablar. Hay dos clases:

- **Encargo**: lo pidió el dueño de forma expresa. Se dice siempre.
- **Espontáneo**: lo empieza Shiro. Es lo que regulan el §6 y el §8.

| Sentido            | Hecho                                            | Cómo llega                            | Disparo (`kind`) | `trust`    | Clase      | Paso     |
| ------------------ | ------------------------------------------------ | ------------------------------------- | ---------------- | ---------- | ---------- | -------- |
| Reloj (`clock`)    | Hace mucho que nadie dice nada                   | Temporizador del módulo de iniciativa | `silence`        | `internal` | Espontáneo | IN-5     |
| Reloj (`clock`)    | Vence un recordatorio o un temporizador          | Tabla de recordatorios                | `reminder`       | `owner`    | Encargo    | IN-6     |
| App (`app`)        | Se abre la app                                   | Primera conexión de un cliente        | `greeting`       | `internal` | Espontáneo | IN-5     |
| App (`app`)        | El dueño vuelve tras un rato sin estar           | `presence:reported` (§4)              | `return`         | `internal` | Espontáneo | IN-5     |
| App (`app`)        | El dueño sugiere una forma del avatar (ADR 0035) | `avatar:suggest`                      | `avatar-suggest` | `owner`    | Encargo    | AV-5     |
| Memoria (`memory`) | Un tema quedó a medias o se acerca una fecha     | Lo define ME-0                        | Los define ME-0  | ME-0       | Espontáneo | Bloque 2 |

Cada disparo lleva, además de `sense` y `kind`:

- **`trust`**, quién está detrás: `owner` (el dueño lo pidió), `internal`
  (nace del reloj o de la app, sin texto de nadie) o `third-party` (algo que
  escribió otra persona: un correo, Discord, el chat de un directo, la
  memoria pública). **Ningún disparo `third-party` abre turno hasta IN-7**,
  que pone sus reglas. Un sentido que no declare su `trust` cuenta como
  `third-party`; esa regla es provisional hasta SE-0.
- **`importance`** (`low`, `normal`, `high`) y **`expiresAt`**: hasta cuándo
  tiene sentido decirlo.
- **Datos** de listas cerradas y números. El único texto libre es el de un
  recordatorio. Lo escribió el modelo cuando el dueño lo pidió, así que entra
  como dato delimitado y **nunca amplía lo que ese turno puede hacer**:
  `owner` decide que se diga, no da permisos.

Detalles de los disparos del bloque 1:

- `greeting` sale una vez por arranque del core-host, o tras un rato largo
  sin ningún cliente. Una reconexión no es abrir la app.
- `return` sale cuando la ventana vuelve a verse tras un rato sin verse o sin
  conexión (30 minutos por defecto).
- `silence` sale cuando pasa el intervalo del regulador sin que nadie diga
  nada.

Añadir un sentido es añadir una fuente que emite sus eventos tipados y sus
filas en la tabla de disparos. El contrato de los sentidos de fuera de la app
(el equipo, la música, el correo) es del ADR de SE-0.

### 4. Si hay alguien delante

El cliente cuenta de sí mismo tres cosas, con `presence:reported`: si su
ventana está a la vista (`visible`), si tiene la voz silenciada (`muted`) y si
el dueño tiene un mensaje a medias, escrito o dictándose (`composing`: un sí
o un no, nunca el texto). Lo manda al conectar y cuando cambia algo.

Es la primera señal del módulo de presencia del
[ADR 0035](0035-avatar-eleccion-de-modelo-en-caliente.md): hay una sola
presencia, y la completan AV-4 (dormida, modo de actividad) y SE-1 (si el
dueño está activo en el equipo). En el bloque 1 hay dos grados:

- **Conectado**: hay un cliente conectado.
- **Delante**: conectado y con la ventana a la vista. Es una señal floja: la
  ventana puede estar abierta con la silla vacía.

Hasta que un cliente recién conectado manda su primer informe, cuenta como
conectado, no delante y sin silenciar. Un `composing` que no cambia en dos
minutos deja de contar: una señal perdida no puede dejar muda a Shiro.

### 5. De un disparo espontáneo a un turno

Tres pasos, del más barato al más caro. La mayoría se quedan en el primero o
en el segundo.

1. **Reglas**, sin modelo y sin coste: las del §6.
2. **Juicio barato**, solo para los disparos que lo piden (en el bloque 1,
   `silence`): una pregunta corta a un modelo barato sobre si merece la pena
   decir algo ahora. Lo elige `initiative.judge` (`local`, `cloud` o `none`);
   por defecto, el local. Es el mismo patrón que el clasificador del router
   ([ADR 0015](0015-hybrid-router-classifier-llm-based.md)): con tiempo
   límite y, ante la duda o el fallo, la respuesta es no.
3. **El turno propio** (§7): el modelo que escribe. Todavía puede callar.

Un encargo se salta los dos primeros pasos.

### 6. Cuándo habla y cuándo calla

**Lo espontáneo** abre turno solo si se cumple todo esto. Si falla algo, se
descarta:

1. El regulador deja ese tipo de disparo (§8).
2. No se alcanzó el tope de gasto del mes (§9).
3. La cola está vacía.
4. El dueño está delante y no tiene un mensaje a medias.
5. No suena la voz de Shiro, y la voz no está silenciada.
6. Shiro está despierta y el dueño no puso el modo de juego ni el de directo
   (ADR 0035; llega con AV-4).
7. Pasó el intervalo mínimo desde el final de su último intento espontáneo,
   acabara como acabara (también cuenta un «no» del juicio barato).
8. **No insiste.** Un turno espontáneo entregado queda «sin respuesta» si el
   dueño no dice nada antes de que toque el siguiente. Cada uno sin respuesta
   duplica el intervalo; tras tres seguidos, Shiro no empieza nada más hasta
   que el dueño diga algo. Cualquier mensaje suyo pone la cuenta a cero. Los
   turnos que acabaron en `silent`, `failed` o `cancelled` no cuentan: el
   dueño no vio nada.

**Un encargo se dice siempre.** Lo único que cambia es cuándo y cómo.
Cuándo: manda la primera fila que se cumpla.

| Situación                                      | Cuándo se dice el encargo                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------- |
| No hay ningún cliente conectado                | Va a pendientes                                                           |
| El dueño puso el modo de directo               | Va a pendientes hasta que lo quite. D-0 decidirá si puede decirse en vivo |
| Hay un turno en curso, o suena la voz de Shiro | Cuando acabe                                                              |
| El dueño tiene un mensaje a medias             | Cuando lo mande o lo deje; como mucho, a los dos minutos                  |
| Nada de lo anterior                            | Ya                                                                        |

Cómo, cuando se dice. Estas tres cosas se suman:

- Si Shiro está dormida, el encargo la despierta.
- Si la voz está silenciada, sale solo como texto.
- Si no hay nadie delante (la ventana no está a la vista), se dice igual y
  además se queda en pendientes: Shiro lo recuerda una vez al volver.

**El ciclo de un encargo.** Cada uno tiene un id que se guarda. Se da por
dicho cuando su turno se entrega. Si el proceso se cae antes de anotarlo, se
dice otra vez al arrancar: mejor dos veces que ninguna. Si el dueño cancela el
recordatorio, sale de la cola y de pendientes; si lo que cancela es el turno
que lo estaba diciendo, el encargo vuelve a pendientes.

**Pendientes.** Lo que no pudo decirse se guarda con su importancia y su
caducidad. Cuando el dueño vuelve o abre la app, el módulo abre **un solo**
turno (`return` o `greeting`) con los pendientes que no han caducado: Shiro
los dice con sus palabras, lo más importante primero. Los caducados se borran
sin decirse.

- **En el bloque 1 solo los encargos llegan a pendientes.** Sus tres disparos
  espontáneos solo tienen sentido en el momento. Los tipos de los bloques 2 y
  3 (retomar un tema, proponer) sí se guardarán.
- Cada pendiente pasa por su regla: con el regulador en `off`, ese turno solo
  se abre si hay encargos y solo lleva encargos. Con un encargo dentro, el
  turno no puede acabar en silencio.
- Al arrancar, los recordatorios que vencieron con la app cerrada pasan a
  pendientes.
- La importancia solo ordena y fija la caducidad. Avisar por otro canal según
  la importancia (la notificación de Windows, el móvil) es de SE-2 y SE-6.

Los pendientes, los recordatorios, el gasto del mes, el nivel del regulador
elegido en la app y las cuentas de las reglas 7 y 8 se guardan en tablas
propias del mismo archivo SQLite que la memoria local. El core-host se apaga
con la app: sin guardarlas, cada arranque las pondría a cero. Y así la copia
y la restauración de P-11a las cubren sin tocarlas.

### 7. El turno propio por dentro

- **No pasa por el router.** El modelo se elige en la configuración
  (`initiative.voice`: `cloud` o `local`). Hoy, la nube: el modelo local se
  queda corto. Con el equipo nuevo, local.
- **Contexto.** A partir de IN-2, todos los turnos, también los del dueño,
  llevan como datos la fecha y la hora locales y cuánto hace del último
  mensaje del dueño. El turno propio añade su disparo, los pendientes y los
  últimos comentarios espontáneos de Shiro, para que no se repita. Ese bloque
  lo monta el servidor y va con el contexto, no en el prompt del personaje.
- **Salida que permite callar.** La respuesta estructurada del ADR 0014 gana
  un campo opcional, `silent`, que solo se ofrece en los turnos espontáneos.
  Con `silent` en verdadero no se emite ni se guarda nada y el turno acaba
  como `silent`. **Un texto vacío sin `silent` sigue siendo un fallo**
  (`empty`, nota del 2026-11-20 del ADR 0016): una respuesta cortada no es
  una decisión de callar.
- **Los campos nuevos de la respuesta quedan fijados aquí**, para no tocar el
  ADR 0014 tres veces: `silent` (este ADR), y `form` y `sleep`, cuyo
  significado es el del ADR 0035 §4 y que implementa AV-5. Un valor ausente o
  no válido no cambia nada, como ya pasa con la emoción. La excepción es la
  del ADR 0035: en el turno `avatar-suggest`, `form` es obligatorio. P-31c
  cambiará cómo viajan, no qué son.
- **Fallo en silencio.** Si un turno espontáneo falla, no hay frase de error,
  ni aviso al dueño, ni paso al otro modelo: queda una línea en el log y
  `turn:ended` con `failed`. No se reintenta, y cuenta para el intervalo. Si
  no, un proveedor caído haría que Shiro lo intentara sin parar.
- **Un encargo no se pierde.** Si falla el modelo, un recordatorio se dice
  con un texto fijo («Recordatorio: …») en ese mismo turno, marcado como
  `fallback`. Una sugerencia de forma sin modelo sigue la regla que el ADR
  0035 §4 ya tiene para cuando no hay LLM.
- **Sin herramientas.** Hasta IN-8, un turno propio no recibe ninguna, ni las
  de lectura: su contexto lleva la memoria, que todavía no está separada de
  las instrucciones, y puede no haber nadie mirando. Los tres modos de
  autonomía son de IN-8.
- **Marca de origen.** `llm:responded` lleva `origin` y `trigger`, y la
  entrada que se guarda en la memoria los lleva en sus metadatos. La app
  etiqueta el mensaje y distingue un aviso que pidió el dueño de algo que
  Shiro dijo por su cuenta; en el contexto de los turnos siguientes consta
  igual. Un turno propio no crea ninguna entrada del dueño.

### 8. El regulador

Un solo ajuste, `initiative.level`, con cuatro niveles. Regula lo espontáneo;
los encargos se dicen en cualquier nivel, también con `off`.

| Nivel               | Qué empieza Shiro por su cuenta                           | Intervalo mínimo entre dos intentos espontáneos |
| ------------------- | --------------------------------------------------------- | ----------------------------------------------- |
| `off` (por defecto) | Nada                                                      | —                                               |
| `low`               | Saluda al abrir la app                                    | 3 h                                             |
| `normal`            | Además, saluda al volver y comenta tras un silencio largo | 1 h                                             |
| `high`              | Lo mismo, más a menudo                                    | 20 min                                          |

- **Ajuste fino**: `initiative.min_interval_minutes` y un interruptor por tipo
  de disparo (`initiative.kinds`) mandan sobre lo que fija el nivel. Sobre
  `off` no manda nada: con `off` no hay nada espontáneo.
- Se cambia desde la app (`initiative:set`); el core anuncia el nivel vigente
  (`initiative:changed`). Lo elegido en la app se guarda y manda sobre el
  YAML, que solo da el valor inicial.
- Los bloques siguientes añaden tipos (retomar, opinar, proponer) y dicen en
  qué nivel entra cada uno.
- Los números de esta tabla y los del §3 y el §6 son un punto de partida: van
  en la configuración y se afinan con el uso.

### 9. Gasto y tope

- Cada turno anota lo que gastó: tokens de entrada y de salida por modelo
  (hoy `tokensUsed` es una suma) y voz por proveedor. Se anota toda llamada
  que el proveedor cobra: también el juicio barato y las que fallan o se
  cancelan, cuando el proveedor dice lo que consumieron.
- Se pasa a dólares con una tabla de precios que vive en la configuración,
  con la fecha en que se comprobó. Es una estimación: manda la factura del
  proveedor. El modelo local cuenta tokens y cuesta cero.
- Se guarda por mes y por origen: turnos del dueño y turnos propios.
- **El tope es de los turnos propios**, encargos incluidos:
  `initiative.monthly_cap_usd`, 10 por defecto. Los turnos del dueño se
  cuentan y se enseñan, y nunca se bloquean.
- **Alcanzado el tope:** no hay más turnos espontáneos hasta el mes siguiente
  o hasta que el dueño lo suba. Los encargos se siguen diciendo, sin gastar:
  con texto fijo, sin modelo y con la voz del sistema, que es gratis (si no
  la hay, solo como texto).
- El tope se comprueba antes de abrir cada turno, así que puede pasarse en lo
  que cueste el turno que lo cruza.
- La app enseña siempre lo gastado y el tope (`usage:reported`). En el bloque
  1 el tope se cambia en la configuración; desde la app, con el rediseño.

### 10. Una sola voz

La iniciativa da por hecho **un solo cliente de escritorio**. Sin clientes
conectados, lo espontáneo no se abre y los encargos van a pendientes. Con dos
o más no se garantiza nada: la voz suena en todos los que no estén
silenciados, como hoy, y de `presence:reported` vale el último recibido.
Elegir qué cliente habla es del protocolo multicliente (ADR 0033), que sigue
en espera.

### 11. Eventos

Nuevos:

| Evento               | Sentido         | Contenido                                                          | Cuándo                                     |
| -------------------- | --------------- | ------------------------------------------------------------------ | ------------------------------------------ |
| `turn:accepted`      | core → clientes | `turnId`, `origin`, `trigger` si es propio y `messageId` si lo hay | Al entrar el turno en la cola              |
| `turn:ended`         | core → clientes | `turnId`, `origin`, `outcome`                                      | Al acabar                                  |
| `turn:cancel`        | cliente → core  | `turnId`                                                           | Al pedir que pare                          |
| `presence:reported`  | cliente → core  | `visible`, `muted`, `composing`                                    | Al conectar y cuando cambia algo           |
| `initiative:set`     | cliente → core  | `level`                                                            | Al cambiar el ajuste en la app             |
| `initiative:changed` | core → clientes | `level`, y si se alcanzó el tope                                   | Al cambiar, y cuando un cliente se conecta |
| `usage:reported`     | core → clientes | El mes, lo gastado por origen y el tope                            | Al conectar y tras cada turno con gasto    |

Cambian:

- `user:message` gana `messageId`, opcional: un id que pone el cliente y que
  vuelve en `turn:accepted`, para saber qué turno es el de cada mensaje.
- `llm:responded`: `turnId` pasa a ser obligatorio; gana `origin`, `trigger`
  (en los turnos propios) y `fallback` (verdadero cuando el texto es una
  frase fija por un fallo). `tier` pasa a ser opcional: falta cuando el texto
  no lo escribió un modelo; hoy el aviso de self-dev dice `cloud` sin serlo.
  Con eso se distinguen los tres usos de R-093. Con AV-5 llevará también
  `form` y `sleep`.
- `router:routed`, `llm:failed` y `tts:audio` ganan `turnId`. `turn:measured`
  gana `origin`, y su `tier` también pasa a ser opcional.
- `tool:requires-approval` gana `turnId` cuando la petición es de un turno;
  las de self-dev no lo llevan.
- Los eventos que emite el cliente se enlazan con su turno por lo que ya
  llevan: `tts:audio-started`, `tts:audio-ended` y `tts:cancel` por el
  `audioId`, y `tool:approval` por el `requestId`.

Todos llevan `userId`, como los demás. Los eventos de recordatorios los define
IN-6.

**Ningún evento deja que un cliente abra un turno propio con texto suyo.** Un
turno propio nace dentro del core-host; lo único que un cliente aporta son
valores de listas cerradas y síes o noes, nunca texto que llegue al modelo.

### 12. Enmiendas que anuncia

Cada una viaja como nota fechada en el PR del paso que la cumple, como pide
la vía de iniciativa del plan.

| ADR                                                                      | Qué cambia                                                                                                                      | Paso       |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| [0014](0014-llm-structured-output-text-emotion.md)                       | La respuesta gana `silent`; `form` y `sleep` quedan reservados                                                                  | IN-4; AV-5 |
| [0015](0015-hybrid-router-classifier-llm-based.md)                       | El turno propio no pasa por el router                                                                                           | IN-4       |
| [0016](0016-pipeline-conversational-wiring.md)                           | El turno sale de su manejador a una función propia, con cola y cancelación; el mensaje del dueño se guarda al empezar su turno  | IN-1       |
| [0016](0016-pipeline-conversational-wiring.md)                           | Errores según el origen: un turno espontáneo que falla no dice la frase de error ni pasa al otro modelo                         | IN-4       |
| [0020](0020-tts-elevenlabs-systemtts-fallback-y-multidevice-diferido.md) | La voz de un turno que el dueño ya dejó atrás no se emite                                                                       | IN-1       |
| [0020](0020-tts-elevenlabs-systemtts-fallback-y-multidevice-diferido.md) | La iniciativa da por hecho un solo cliente con voz                                                                              | IN-5       |
| [0022](0022-shiro-agentic-tools-fs-shell.md)                             | Una aprobación pendiente se da por rechazada si el turno se cancela o si llega otro mensaje del dueño                           | IN-1       |
| [0022](0022-shiro-agentic-tools-fs-shell.md)                             | Un turno propio no recibe herramientas hasta IN-8                                                                               | IN-4       |
| [0023](0023-shiro-self-improvement-propose-only.md)                      | Sus avisos hablados pasan a ser turnos del sistema, en la cola                                                                  | IN-1       |
| [0023](0023-shiro-self-improvement-propose-only.md)                      | Existe ya algo de fondo, la iniciativa, que ni vigila el repositorio ni arranca self-dev                                        | IN-4       |
| [0023](0023-shiro-self-improvement-propose-only.md)                      | Shiro puede proponer de palabra, por su cuenta, una mejora de sí misma. Arrancar self-dev sigue siendo del dueño                | IN-9       |
| [0035](0035-avatar-eleccion-de-modelo-en-caliente.md)                    | El módulo de presencia recibe su primera señal, `presence:reported`, antes de AV-4                                              | IN-2       |
| [0035](0035-avatar-eleccion-de-modelo-en-caliente.md)                    | Un encargo que vence también despierta a Shiro                                                                                  | AV-4       |
| [0035](0035-avatar-eleccion-de-modelo-en-caliente.md)                    | El turno de una sugerencia de forma es un encargo de este ADR; sin modelo, o con el tope alcanzado, vale su regla de transición | AV-5       |

### 13. Qué queda fuera

- Los sentidos de fuera de la app y su contrato (SE-0).
- La memoria con tipos y la memoria pública (ME-0), y con ellas retomar
  temas. ME-0 dice qué `trust` tiene lo que nace de la memoria privada.
- Opinar, proponer, los tres modos de autonomía y las reglas del contenido de
  terceros (bloque 3).
- **Qué pasa con un permiso cuando no hay nadie delante.** En el bloque 1 no
  puede darse: un turno propio no tiene herramientas. Lo decide IN-8; el plan
  ya prevé que caduque pronto y se descarte, sin entrar en el reenvío de P-27.
- Que Shiro decida dormirse o callarse un rato (IN-10 y AV-5).
- Avisar por otros canales según la importancia (SE-2 y SE-6).
- Qué cliente habla cuando hay varios (ADR 0033).
- Quién puede emitir cada evento (P-39) y el token del bus (P-40).
- El aspecto definitivo de todo esto en la app: llega con el rediseño. El
  bloque 1 pone un ajuste y una etiqueta en las pantallas de hoy.
- Los directos (D-0).

### Qué viene del dueño y qué propone el agente

| Punto                           | Del dueño (2026-11-19)                                                      | Propuesta del agente                                                                                           |
| ------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Que Shiro empiece               | Sí, y «mucha más iniciativa»                                                | —                                                                                                              |
| De dónde nace un turno suyo     | Reloj y recordatorios, la app y su memoria; después, por fases, lo de fuera | Sentidos que solo cuentan y un módulo que decide; la tabla de disparos                                         |
| Añadir una fuente               | Tiene que ser fácil                                                         | Una fuente con eventos tipados más sus filas en la tabla                                                       |
| Frecuencia                      | Alrededor de una vez por hora, ajustable                                    | Cuatro niveles; `normal` es 1 h, `low` 3 h y `high` 20 min                                                     |
| Si no está delante              | Lo guarda y lo dice al volver                                               | Pendientes con importancia y caducidad; un solo turno al volver. **En el bloque 1 solo se guardan encargos**   |
| Quién piensa esos turnos        | Ajustable y mixto; hoy Claude, después local                                | Dos ajustes: el juicio barato (local) y el que escribe (nube)                                                  |
| Tope de gasto                   | Entre 10 y 25 USD al mes                                                    | 10 por defecto; corta lo espontáneo; los turnos del dueño nunca se bloquean                                    |
| Encargos frente a lo espontáneo | —                                                                           | Lo que pidió el dueño se dice siempre: con `off` y, sin gastar, con el tope alcanzado                          |
| Encargo con la ventana oculta   | —                                                                           | Se dice en su momento y, además, Shiro lo recuerda al volver                                                   |
| Encargo en directo              | —                                                                           | Espera a que acabe el directo, hasta que D-0 decida otra cosa                                                  |
| No insistir                     | —                                                                           | El intervalo se duplica sin respuesta; tras tres, espera al dueño. Sale de la propuesta de diseño              |
| Despertar                       | —                                                                           | Un encargo que vence despierta a Shiro. Amplía «despierta con cualquier interacción», aceptado con el ADR 0035 |
| Cuánto cuesta decidir           | —                                                                           | Reglas, juicio barato y solo entonces el modelo que escribe                                                    |
| Una sola voz                    | —                                                                           | Un solo cliente de escritorio; con dos, sin garantías                                                          |
| Cola                            | —                                                                           | Única; el dueño va primero, y sus mensajes en orden y sin descartar ninguno                                    |
| Permiso pendiente               | —                                                                           | Otro mensaje del dueño lo da por rechazado, para no parar la cola cinco minutos                                |
| Herramientas en un turno propio | Tres modos                                                                  | Por defecto el limitado (ya propuesto en el plan). Ninguna hasta que existan los modos (IN-8)                  |
| Dónde se guarda                 | —                                                                           | En el archivo de la memoria local, para que la copia lo cubra                                                  |

## Alternativas consideradas

- **Disfrazar el turno propio de mensaje del dueño** (un `user:message` con
  una instrucción interna). Es lo más barato de escribir. Descartado: queda en
  la memoria como si lo hubiera dicho el dueño, pasa por el router, obliga a
  responder, y cualquier cliente podría fabricarlo.
- **Seguir sin cola** y fiarse de que la interfaz bloquea la entrada.
  Descartado: con los turnos propios hay una segunda fuente que la interfaz
  no controla.
- **Que el último mensaje del dueño cancele al anterior**, en vez de
  esperar. Descartado: se pierden mensajes suyos sin avisar. Para parar un
  turno está `turn:cancel`.
- **Una cola por cliente ya.** Descartado: el bus todavía no distingue
  clientes. Partir la cola única más adelante no rompe nada.
- **Frases escritas y un planificador sin modelo**, como las compañeras de
  escritorio sin IA. Descartado como mecanismo principal: no es su voz ni
  sabe de qué se habló. Se queda como respaldo de los encargos.
- **Una sola llamada cara que decide y escribe.** Descartado para los
  disparos periódicos: casi siempre la respuesta es callar, y se pagaría
  entera cada vez.
- **Que el modelo se programe a sí mismo** cuándo volver a despertarse.
  Descartado por ahora: el gasto y el comportamiento dejan de ser
  predecibles y no se pueden probar con una tabla de casos.
- **La iniciativa en el cliente**, con temporizadores en la app. Descartado:
  el cerebro vive en el core-host y los clientes son delgados; un segundo
  cliente la duplicaría.
- **Un tope sobre todo el gasto.** Descartado: el presupuesto de su
  iniciativa no puede dejar al dueño sin poder hablar con ella.
- **Decir un encargo solo si hay alguien delante.** Descartado: un
  temporizador que no suena porque la ventana está minimizada no sirve. Se
  dice y, por si nadie lo oyó, se recuerda al volver.

## Consecuencias

### Positivas

- Shiro puede hablar primero sin dejar de ser predecible: una tabla de
  disparos, unas reglas y un regulador se prueban con casos.
- Los turnos dejan de mezclarse, y el segundo mensaje ve la respuesta del
  primero.
- Se puede parar un turno, y un evento dice ya de qué turno es y quién lo
  abrió.
- El gasto queda a la vista, y el de su iniciativa tiene techo.
- AV-5 no construye otro turno desde el servidor: usa este.

### Negativas / Riesgos

- Dos mensajes seguidos del dueño tardan más: el segundo espera.
- **«Delante» es una señal floja** hasta SE-1: a veces hablará a una silla
  vacía y dará por dicho lo que nadie oyó.
- Con dos clientes abiertos el comportamiento no está definido.
- En el bloque 1 Shiro habla pero no hace: sin herramientas hasta IN-8.
- **Lo que dice un turno propio sale de su memoria, que es privada.** Puede
  decirlo en voz alta con otra persona en la habitación, y va al proveedor
  del modelo y al de la voz, como cualquier turno. En el modo de directo no
  hay nada espontáneo.
- **La memoria sigue entrando sin separar de las instrucciones** hasta P-33.
  Un recuerdo envenenado puede hacer que Shiro diga algo por su cuenta, y eso
  que dice se guarda y entra en el contexto de turnos posteriores, también de
  los del dueño, que sí tienen herramientas. Es el mismo riesgo que ya tiene
  cualquier respuesta suya.
- **Cualquier programa del equipo que llegue al bus** puede fingir la
  presencia, cambiar el regulador, cancelar turnos o sugerir formas, y con
  eso provocar llamadas de pago hasta el tope. No es una exposición nueva: hoy
  ya puede mandar mensajes como si fuera el dueño, y esos no tienen tope. Lo
  cierran P-39 y el token (P-40).
- El coste es una estimación con precios que hay que mantener al día.
- Vaciar la memoria local borra también los recordatorios y los pendientes.
- Los eventos cambian de forma: cliente y servidor tienen que actualizarse a
  la vez. Hoy van siempre juntos; con un segundo cliente hará falta la versión
  del protocolo del ADR 0033.

### Neutrales

- `llm:responded` sigue llamándose así aunque lleve un texto que no escribió
  el modelo.
- El módulo de iniciativa vive en el core-host junto al pipeline, no como un
  slot intercambiable: no hay dos implementaciones entre las que elegir.
- Un mensaje del dueño que espera en la cola no está guardado todavía: si el
  proceso se cae en esos segundos, se pierde con la cola.

## Notas de implementación

- `packages/core-host/src/pipeline/`: la función del turno, la cola y la
  cancelación (IN-1). Antes, la red de tests del turno (P-30).
- `packages/core-host/src/initiative/`: disparos, reglas, pendientes y
  regulador (IN-4 a IN-6). Su bloque `initiative:` de la configuración se
  valida con zod en la parte de Node, como `selfdev:`.
- `packages/core/src/types/events.ts`: los eventos del §11.
- `packages/core/src/interfaces/ILLMModule.ts`: tokens de entrada y de salida
  por separado, `silent` y el bloque de fecha y hora.
- `packages/desktop/src/state/`: `turn:accepted` en lugar de `router:routed`
  para «pensando», `presence:reported`, la etiqueta de origen y el ajuste.
- El PR de IN-4 añade la fila de los turnos propios a la tabla SEC-xx.

## Referencias

- [Vía de iniciativa del plan de mejora](../plan-mejora-2026-11.md#vía-paralela-iniciativa-sentidos-vida-propia-y-directos)
  y la [propuesta de vida propia](../design/propuesta-vida-propia.md).
- [Revisión de 2026-11](../revision-estado-2026-11.md): R-061, R-080, R-092,
  R-093, R-094 y R-121.
- ADR [0014](0014-llm-structured-output-text-emotion.md),
  [0015](0015-hybrid-router-classifier-llm-based.md),
  [0016](0016-pipeline-conversational-wiring.md),
  [0020](0020-tts-elevenlabs-systemtts-fallback-y-multidevice-diferido.md),
  [0022](0022-shiro-agentic-tools-fs-shell.md),
  [0023](0023-shiro-self-improvement-propose-only.md) y
  [0035](0035-avatar-eleccion-de-modelo-en-caliente.md).
- [Biblia del personaje](../design/shiro-character-bible.md): serena,
  reservada y de pocas palabras. «No insiste» es lectura de la propuesta de
  vida propia.
