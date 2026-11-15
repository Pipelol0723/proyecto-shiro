# ADR 0035: Avatar — elección del modelo en caliente: Shiro decide, el usuario sugiere o fija

- **Status**: Proposed
- **Fecha**: 2026-11-14
- **Decidido por**: Pipelol0723 (pendiente de aceptar)

> **Estado (2026-11-14):** propuesta escrita por un agente a partir de las
> decisiones que el dueño tomó ese día. **Sin aceptar y sin implementar.** La
> tabla «Qué viene del dueño y qué propone el agente» separa lo uno de lo otro.

## Contexto

[ADR 0028](0028-avatar-motores-y-manifiesto.md) decide cómo conviven varios
motores de avatar tras `<Avatar>`: un contrato de cinco verbos, un manifiesto
por modelo y un selector que monta, **al arrancar**, el primer candidato
disponible. Deja fuera a propósito el cambio con la app en marcha y que lo
decida Shiro («pide un evento nuevo en el bus y su propio ADR»). Este es ese
ADR.

La visión del dueño (2026-11-14): Shiro tendrá tres modelos —la **chibi** (el
primero y el más barato), el **2D** (el principal; al principio solo el torso)
y el **3D** (el «completo»)— que se cambian en cualquier momento, en el modo
normal y en el overlay. Sus ejemplos: chibi o 2D mientras juega o hace stream,
3D cuando está solo con ella, chibi al dormirse para ahorrar recursos, chibi
en una Raspberry o en el móvil, y que Shiro «quiera» verse en 3D.

Fuerzas en juego:

- **Quién manda.** El dueño no quiere un selector en el que él ordena y Shiro
  obedece: lo que él diga es una sugerencia, que **influye en la decisión de
  Shiro pero no la cambia**. A la vez aceptó que exista un **fijar**, para
  asegurar un modelo cuando haga falta (por ejemplo, en un directo).
- **Recursos.** El LLM local, Whisper y el avatar comparten una GPU de 4 GB.
  La chibi no usa GPU, pero cargada ocupa unos 49 MB; el 3D no está medido.
- **Dos niveles de LLM.** Responde el modelo local o el de la nube
  ([ADR 0015](0015-hybrid-router-classifier-llm-based.md)). Las herramientas
  solo existen en la nube; la respuesta estructurada `{ text, emotion }`
  ([ADR 0014](0014-llm-structured-output-text-emotion.md)), en los dos.
- **Un cliente hoy, varios algún día.** Solo existe el escritorio y los
  dispositivos van al final, pero lo decidido no debería rehacerse al llegar.
- Una persona, 4–6 horas a la semana: tiene que entrar por pasos y servir
  desde el primero.

Lo que no sabemos:

- Si un modelo local pequeño usará con criterio un campo de preferencia o lo
  cambiará sin motivo.
- Si dos motores con WebGL caben a la vez en la GPU mientras dura el fundido.
- Los umbrales de «pocos recursos»: no hay medidas hasta P-16.
- Qué aspecto tiene Shiro dormida: todavía no hay pose.

## Decisión

**Vamos a elegir el modelo del avatar en caliente y en cada cliente, con una
escalera de cinco peldaños: los límites del cliente, el fijado del usuario, el
estado y el contexto, la decisión de Shiro y el orden por defecto. Lo que diga
el usuario es una sugerencia que Shiro sopesa; la única forma de imponer un
modelo es fijarlo.**

### 1. Formas, coste y capacidades en el manifiesto

Shiro y las reglas no eligen archivos, eligen una **forma**: `chibi`, `2d` o
`3d`. La cabecera del manifiesto gana tres campos, que se leen sin cargar el
motor ni las imágenes:

| Campo          | Contenido                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------ |
| `form`         | `chibi`, `2d` o `3d`. Cada cliente la traduce a su primer candidato instalado de esa forma       |
| `cost`         | `tier` (`light`, `medium`, `heavy`), `needs_webgl`, `memory_mb`, `download_kb`                   |
| `capabilities` | `look_at`, `glow`, `body_motion` y `framing` (`full-body`, `torso`, `bust`): solo para colocarlo |

Si faltan, se deducen del `kind`. Lo declarado es el punto de partida: lo que
mide el cliente en marcha manda sobre el manifiesto.

### 2. Quién decide: la escalera

| Peldaño                | Qué es                                                                                 | Efecto                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1. Límites del cliente | Lo que este cliente puede dibujar: modelos instalados que pasan la comprobación, WebGL | Descartan modelos. Nadie los salta                                          |
| 2. Fijado              | El usuario fija una forma en este cliente                                              | Se muestra esa forma. Los peldaños 3 a 5 no cambian el modelo               |
| 3. Estado y contexto   | Shiro dormida, modo de actividad del usuario, pocos recursos                           | Acotan entre qué formas se elige                                            |
| 4. Shiro               | Su preferencia                                                                         | Elige dentro de lo que queda                                                |
| 5. Orden por defecto   | El del ADR 0028 (3D → 2D → capas)                                                      | Vale cuando Shiro no ha dicho nada o cuando lo que prefiere está descartado |

Dicho como una función sin efectos: de las formas que el cliente puede
dibujar, la fijada; si no hay fijado, se quitan las que descarta el peldaño 3
y, de las que quedan, la que prefiere Shiro; si no prefiere ninguna de esas,
la primera del orden por defecto.

Reglas que cierran los casos límite:

- **El orbe no es una forma.** Es la red de seguridad del ADR 0028: sale
  cuando ningún modelo puede dibujarse, y ni Shiro ni el usuario lo eligen.
- **La sugerencia del usuario no es un peldaño**: es algo que le llega a Shiro
  (§4).
- **Si el modelo fijado deja de poder dibujarse**, se muestra el primero del
  orden por defecto que sí pueda, con un aviso visible. El fijado se conserva
  y vuelve a aplicarse en cuanto ese modelo esté disponible.
- **La preferencia de Shiro no se pierde** cuando el peldaño 3 la descarta:
  queda guardada y vuelve a valer cuando el estado o el modo terminan.

| Caso                                                          | Resultado                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------ |
| Shiro prefiere el 3D y el usuario activa el modo de actividad | 2D, o chibi si no hay 2D. Al quitar el modo, vuelve el 3D    |
| 3D fijado y modo de actividad activo                          | 3D: el fijado gana                                           |
| 2D fijado y Shiro se duerme                                   | 2D con cara de dormida                                       |
| Sin fijado y Shiro se duerme                                  | Chibi con cara de dormida; al despertar, lo que tocaba antes |
| 3D fijado y el 3D deja de cargar                              | 2D con un aviso; el 3D sigue fijado y vuelve cuando cargue   |
| Solo está instalada la chibi                                  | Chibi siempre; a Shiro no se le ofrece elegir                |

### 3. Estado y contexto

Los tres factores de este apartado solo mueven el modelo cuando no hay fijado.
Con fijado, dormirse solo cambia la cara, el modo de actividad no cambia nada
y «pocos recursos» solo avisa.

**Dormida.** Es un estado de Shiro, no de una ventana: lo lleva un módulo del
core y lo anuncia por el bus. Se duerme por tres vías:

- **Inactividad**: un tiempo sin interacción, configurable (0 lo apaga).
- **Cuando se lo dicen**: con un control de la app, o diciéndoselo (§4).
- **Horario**: una franja configurable.

Despierta con cualquier interacción: un mensaje, pulsar para hablar, un clic
sobre ella o el mismo control. El horario solo duerme; nunca despierta.

Dormida queda una sola forma, la más ligera disponible, y Shiro no elige
mientras duerme. El avatar pone cara de dormida (ojos cerrados, brillo bajo,
menos cuadros por segundo) hasta que exista una pose.

**Modo de actividad.** Lo que está haciendo el usuario: nada especial, jugando
o en directo. Lo pone él, con un atajo global o desde el menú; la detección
automática queda para después. Con un modo activo se descarta la forma pesada
y Shiro elige entre las demás. Para garantizar una forma concreta se fija.
Jugando y en directo tienen hoy el mismo efecto en el avatar; se distinguen
porque Shiro lo sabe.

**Pocos recursos.** El cliente mide los cuadros por segundo del avatar y el
core la latencia del turno (P-16). Si se mantienen fuera del umbral, se baja
un escalón de coste y no se vuelve a subir sola hasta pasado un tiempo. Los
umbrales van en la configuración y se fijan con medidas, no a ojo. Esta regla
manda sobre la preferencia de Shiro.

### 4. Cómo decide Shiro

- En cada turno el core le da, como datos: las formas entre las que puede
  elegir, la que lleva, si está fijada, el modo de actividad y, si la hay, la
  sugerencia pendiente.
- La respuesta estructurada
  ([ADR 0014](0014-llm-structured-output-text-emotion.md)) gana dos campos
  **opcionales**: la forma que quiere y si se duerme. Un campo ausente, o con
  un valor que no está entre los ofrecidos, no cambia nada: la misma
  degradación que ya tiene la emoción.
- El campo de la forma solo se ofrece si hay al menos dos formas entre las que
  elegir. Con una sola, o con el modelo fijado, no se ofrece: no cuesta nada
  hasta que haya dos modelos.
- Los dos campos viajan en `llm:responded`. El módulo de presencia lo escucha
  y es quien anuncia la preferencia y el sueño por el bus (§7).
- **Sugerencia desde la app.** El control la envía y el core abre un turno con
  ella. En ese turno el campo de la forma es obligatorio: Shiro contesta y
  elige. Si elige otra forma, vale la suya.
- **Sugerencia dicha en la conversación.** Es un turno normal: Shiro la lee y
  usa el campo si quiere.
- **Mientras Shiro no sepa decidir** (antes de AV-5), o si no hay LLM que
  conteste, la sugerencia ocupa el sitio de su preferencia en el peldaño 4, y
  pasa igualmente por los peldaños 1 a 3. Es un comportamiento de transición.
- Su preferencia dura hasta que exprese otra o se reinicie el servidor.
- La emoción y las ganas no tienen reglas propias: son cosas que ella sopesa.

Lo que declara un cliente (formas, sugerencia) se valida contra listas
cerradas antes de entrar en el contexto del LLM: nunca texto libre.

### 5. El cambio en caliente

1. El modelo que se ve sigue dibujando mientras el nuevo carga en segundo
   plano. Si la carga falla o agota su tiempo límite, no cambia nada y ese
   modelo queda descartado un rato.
2. Una petición nueva cancela la carga en curso.
3. **Traspaso de estado**: el selector guarda el último valor de cada verbo
   (expresión, mirada, brillo y parpadeo fijados) y se lo repite al motor
   nuevo antes de mostrarlo. La boca llega sola con el siguiente audio.
4. **Fundido corto** (del orden de 250 ms), hecho por el selector con la
   opacidad de cada lienzo; los motores no saben nada de él. Con
   `prefers-reduced-motion`, corte.
5. Al terminar, el motor viejo se suelta: solo hay dos modelos en memoria
   mientras dura el fundido.
6. Shiro no cambia de cuerpo a mitad de frase: un cambio suyo o de las reglas
   espera a que termine el audio que esté sonando, y si llegan varios solo
   cuenta el último. Fijar y soltar son inmediatos.
7. Entre dos cambios de Shiro o de «pocos recursos» pasa un tiempo mínimo,
   para que no haya vaivén. No se aplica a fijar, dormirse ni despertar.

Esto amplía el contrato del ADR 0028 con dos piezas de ciclo de vida, que no
son verbos: **`dispose()`** y **carga cancelable**.

### 6. Por cliente, y en los dos modos de ventana

- La elección se hace en cada cliente. Las señales comunes (dormida, modo de
  actividad, preferencia de Shiro) llegan por el bus y cada cliente las aplica
  a sus candidatos y a sus límites: uno que solo tenga la chibi se queda en la
  chibi aunque Shiro prefiera el 3D.
- El fijado es de cada cliente y se guarda en su `localStorage`, como el
  silencio de la voz
  ([ADR 0020](0020-tts-elevenlabs-systemtts-fallback-y-multidevice-diferido.md)).
- El modo normal y el overlay usan el mismo selector, y el modo de ventana no
  descarta ningún modelo.

### 7. Eventos nuevos en el bus

| Evento             | Sentido         | Contenido                                                                                                   | Cuándo                                     |
| ------------------ | --------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `avatar:state`     | cliente → core  | `current` (forma u `orb`), `available` (formas), `pinned` (forma o `null`)                                  | Al conectar y cuando cambia algo de eso    |
| `avatar:suggest`   | cliente → core  | `form`                                                                                                      | Al sugerir desde la app                    |
| `avatar:preferred` | core → clientes | `form` (o `null`)                                                                                           | Al cambiar, y cuando un cliente se anuncia |
| `presence:set`     | cliente → core  | `action`: `sleep`, `wake` o `activity`; con `activity`, el modo (`none`, `gaming`, `streaming`)             | Desde los controles de la app              |
| `presence:changed` | core → clientes | `state` (`awake`, `asleep`), `activity` y `reason` (`idle`, `asked`, `schedule`, `interaction`, `activity`) | Al cambiar, y cuando un cliente se anuncia |

Todos llevan `userId`, como los demás. `presence:set` es solo de los
clientes: cuando es Shiro quien se duerme, el módulo de presencia lo lee de
`llm:responded`. Con un solo cliente, el core usa el último `avatar:state`
recibido; distinguir clientes llega con el protocolo multicliente.

### 8. Qué queda fuera

- Detectar solos el juego o el directo: pide decidir qué se mira y garantizar
  que solo el modo, y nada de lo observado, sale de la máquina.
- El motor 3D (con su ADR) y el arte del 2D y el 3D.
- El modelo por dispositivo: llega con el protocolo multicliente.
- Varias poses de un mismo modelo, y qué más hace «dormida» fuera del avatar
  (por ejemplo, soltar el modelo local de la GPU).

### Qué viene del dueño y qué propone el agente

| Punto                                                  | Del dueño                                                                | Propuesta del agente                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Tres modelos, en caliente, en modo normal y en overlay | Sí                                                                       | —                                                                                       |
| Sugerencia, no orden                                   | «Que mi decisión influya en Shiro pero no la cambie»                     | Lectura: Shiro puede elegir otra forma que la sugerida. **A confirmar**                 |
| Cómo le llega la sugerencia                            | —                                                                        | Desde la app, un turno con respuesta obligada; hablada, un turno normal                 |
| Que Shiro «quiera» verse de una forma                  | Sí (su ejemplo: verse en 3D)                                             | Una preferencia que dura hasta que exprese otra                                         |
| Fijar                                                  | Existe                                                                   | Gana a todo salvo a los límites del cliente                                             |
| Dormirse                                               | Por inactividad configurable, al decírselo y por horario; dormida, chibi | El horario solo duerme; despierta con cualquier interacción; fijada no cambia de modelo |
| Juego o directo                                        | Lo dice él con un modo o un atajo; detectarlo, después. Ahí, chibi o 2D  | El modo descarta la forma pesada                                                        |
| Cómo se ve el cambio                                   | Fundido corto                                                            | Unos 250 ms, a cargo del selector                                                       |
| Dispositivos al final; overlay donde estaba            | Sí                                                                       | —                                                                                       |
| Orden de la escalera                                   | —                                                                        | Límites → fijado → estado y contexto → Shiro → orden                                    |
| Por dónde habla Shiro                                  | —                                                                        | Campos opcionales de la respuesta estructurada                                          |
| `form`, `cost` y `capabilities`                        | —                                                                        | Propuesta de la sesión de diseño del personaje                                          |

## Alternativas consideradas

- **Un selector clásico: el usuario elige y se hace.** Lo más simple.
  Descartado por el dueño: que Shiro decida su aspecto es parte del personaje.
  Lo que tenía de útil se conserva como fijado.
- **Shiro decide sin límites ni fijado.** Un directo cambiaría de cara cuando
  ella quisiera, y podría pedir un modelo que el equipo no mueve.
- **La preferencia como herramienta**
  ([ADR 0022](0022-shiro-agentic-tools-fs-shell.md)): las herramientas solo
  existen en el nivel nube y pasan por el ciclo de permisos; es mucho aparato
  para un cambio de aspecto, y el modelo local se quedaría sin voz.
- **Reglas fijas emoción → modelo.** Predecible, pero no es Shiro quien
  quiere, y la emoción cambia en cada turno: el avatar no pararía quieto.
- **Detectar la orden de dormir por palabras clave.** Frágil, atada a un
  idioma, y se dispara al hablar de dormir.
- **Decidir en el servidor qué modelo muestra cada cliente.** El servidor no
  sabe qué puede dibujar cada uno, y el ADR 0028 dejó la lista de candidatos
  en el cliente.
- **Llevar la presencia en el cliente.** El temporizador y el horario morirían
  con la ventana, Shiro no sabría que duerme y dos clientes no coincidirían.
- **Detección automática del juego desde el principio.** Pide mirar ventanas o
  procesos (permisos de [ADR 0024 §5](0024-packaging-tauri-windows-sidecar.md))
  y pensar la privacidad. El dueño prefirió empezar por el modo manual.
- **Mantener los tres modelos cargados** para cambiar al instante: no caben en
  una GPU de 4 GB compartida.
- **Corte seco, o pasar siempre por el orbe.** El dueño eligió el fundido.
  Pasar por el orbe queda como salida si dos motores no caben a la vez.

## Consecuencias

### Positivas

- Shiro elige su aspecto y el dueño conserva el control que necesita, sin que
  sea un mando.
- Entra por pasos y cada uno sirve solo: cambio manual (AV-3), reglas (AV-4),
  Shiro (AV-5).
- La elección es una función sin efectos, fácil de probar con tablas.
- Un solo modelo en memoria salvo durante el fundido.
- El mismo esquema sirve para el overlay y, cuando lleguen, los dispositivos.
- No cuesta nada mientras solo haya un modelo instalado.

### Negativas / Riesgos

- La respuesta estructurada cambia en los dos LLM y en el contexto del
  personaje. Mitigación: campos opcionales, solo con dos formas disponibles,
  con tests en los dos.
- Un modelo local pequeño puede cambiar sin motivo. Mitigación: el tiempo
  mínimo entre cambios y no cambiar a mitad de frase; si no basta, la
  preferencia se limita al nivel nube.
- Durante el fundido hay dos modelos cargados. Si dos motores con WebGL no
  caben, ese cambio pasará por el orbe. Se mide al llegar el 3D.
- Sugerir desde la app cuesta un turno entero (LLM y voz).
- Shiro puede elegir otra cosa que lo sugerido. Es la lectura que hace este
  ADR de «influye pero no la cambia», y el dueño debe confirmarla al aceptar;
  la salida es fijar.
- El modo de actividad y la forma que lleva el cliente entran en el contexto
  del LLM, también el de la nube, solo como valores de listas cerradas.
  Mientras el bus no tenga token
  ([ADR 0027](0027-autenticacion-token-bus-stt-multicliente.md)), cualquier
  proceso local puede dormir a Shiro, cambiar el modo o declarar formas
  falsas: el daño es de aspecto, no de datos. La tabla SEC-xx se actualiza con
  AV-4 y AV-5.
- Un módulo nuevo en el core y cinco eventos más que mantener y validar.

### Neutrales

- El ADR 0028 sigue vigente: no cambian sus cinco verbos ni su selector de
  arranque.
- La lista de candidatos sigue en el cliente.
- Aparece un bloque de configuración para la presencia (tiempo de inactividad
  y horario), validado con zod como los demás.
- Los eventos que entran desde un cliente los cubre la validación de entradas
  del bus (P-39).

## Notas de implementación

- **AV-2** (ADR 0028) se construye ya con esto a la vista: el selector guarda
  el último valor de cada verbo y los motores traen `dispose()`.
- **AV-3, cambio manual.** En `packages/desktop/src/components/Avatar/`: la
  función de elección, el cambio en caliente en el selector, `form`, `cost` y
  `capabilities` en el esquema del manifiesto y el fijado. El control vive en
  Shiro → Aspecto. Hasta AV-5, elegir un modelo lo aplica directamente.
- **AV-4, reglas.** `IPresenceModule` en `packages/core/src/interfaces/` y su
  módulo; `presence:set` y `presence:changed` en `types/events.ts`; el bloque
  de configuración; la medida de cuadros por segundo en el cliente.
- **AV-5, Shiro decide.** Los dos campos en la respuesta estructurada de
  `AnthropicLLM` y `OllamaLLM` y en `llm:responded`, el contexto del turno y
  `avatar:state`, `avatar:suggest` y `avatar:preferred`. La enmienda de
  ADR 0014 (nota fechada) va en ese mismo PR.
- **AV-6, overlay.** El mismo selector, con la enmienda de ADR 0024 §3.
- Tests: la escalera con tablas (cada peldaño gana al siguiente); el cambio
  con la carga fallando, tardando y cancelada; el traspaso de estado; que
  Shiro no cambie hablando; las tres vías de dormirse y el despertar; los
  campos nuevos ausentes, válidos y fuera de lista en los dos LLM.

## Referencias

- [ADR 0028](0028-avatar-motores-y-manifiesto.md) — motores, manifiesto y
  selector de arranque; este ADR lo amplía.
- [ADR 0014](0014-llm-structured-output-text-emotion.md) — respuesta
  estructurada; [ADR 0015](0015-hybrid-router-classifier-llm-based.md) — nivel
  local y nube; [ADR 0001](0001-arquitectura-modular-event-driven.md) —
  módulos y bus.
- [ADR 0024 §3](0024-packaging-tauri-windows-sidecar.md) — modo overlay;
  [ADR 0027](0027-autenticacion-token-bus-stt-multicliente.md) — fronteras del
  bus.
- [Plan de mejora](../plan-mejora-2026-11.md), «Vía paralela: avatar y
  modelos» (AV-1 a AV-8), y
  [propuesta de rediseño del escritorio](../design/propuesta-rediseno-escritorio.md)
  (§4.2 Aspecto y §10 overlay).
- Prototipo de la chibi: [`docs/design/chibi-prototype/`](../design/chibi-prototype/README.md).
  De su sesión salen la cabecera de coste y capacidades, `dispose()`, la carga
  cancelable y el traspaso de estado.
