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
  Shiro pero no la cambia**. A la vez necesita poder asegurar un modelo (un
  directo no puede cambiar de cara a mitad): eso es **fijar**.
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

| Peldaño                | Qué es                                                                                 | Efecto                                                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1. Límites del cliente | Lo que este cliente puede dibujar: modelos instalados que pasan la comprobación, WebGL | Descartan modelos. Nadie los salta                                                                                   |
| 2. Fijado              | El usuario fija una forma en este cliente                                              | Mientras dure no hay cambios automáticos ni de Shiro. Si el modelo fijado falla, se baja al siguiente y sigue fijado |
| 3. Estado y contexto   | Shiro dormida, modo de actividad del usuario, pocos recursos                           | Acotan entre qué formas se elige                                                                                     |
| 4. Shiro               | Su preferencia                                                                         | Elige dentro de lo que queda                                                                                         |
| 5. Orden por defecto   | El del ADR 0028 (3D → 2D → capas)                                                      | Cuando Shiro no ha dicho nada                                                                                        |

El orbe sigue siendo el último recurso y nunca falla. La sugerencia del
usuario no es un peldaño: es algo que le llega a Shiro (§4).

### 3. Estado y contexto

**Dormida.** Es un estado de Shiro, no de una ventana: lo lleva un módulo del
core y lo anuncia por el bus. Se duerme por tres vías:

- **Inactividad**: un tiempo sin interacción, configurable (0 lo apaga).
- **Cuando se lo dicen**: con un control de la app, o diciéndoselo (§4).
- **Horario**: una franja configurable.

Despierta con cualquier interacción: un mensaje, pulsar para hablar, un clic
sobre ella o el mismo control. El horario solo duerme; nunca despierta.

Dormida, el avatar baja a la forma más ligera disponible y pone cara de
dormida (ojos cerrados, brillo bajo, menos cuadros por segundo) hasta que
exista una pose. Con un modelo fijado no cambia de modelo: solo de cara.

**Modo de actividad.** Lo que está haciendo el usuario: nada especial, jugando
o en directo. Lo pone él, con un atajo global o desde el menú; la detección
automática queda para después. Con un modo activo se descarta la forma pesada
y Shiro elige entre las demás. Para garantizar una forma concreta se fija.
Jugando y en directo tienen hoy el mismo efecto en el avatar; se distinguen
porque Shiro lo sabe.

**Pocos recursos.** El cliente mide los cuadros por segundo del avatar y el
core la latencia del turno (P-16). Si se mantienen fuera del umbral, se baja
un escalón de coste y no se vuelve a subir sola hasta pasado un tiempo. Los
umbrales van en la configuración y se fijan con medidas, no a ojo.

### 4. Cómo decide Shiro

- En cada turno el core le da, como datos: las formas disponibles, la que
  lleva, si está fijada, el modo de actividad y si hay una sugerencia
  pendiente.
- La respuesta estructurada gana dos campos **opcionales**: la forma que
  quiere y si se duerme. Sin campo no cambia nada.
- Con una sola forma disponible el campo no se ofrece: no cuesta nada hasta
  que haya dos modelos.
- **Sugerencia del usuario.** Dicha en la conversación o con el control de la
  app (que la envía como un turno), hace el campo obligatorio en ese turno:
  Shiro contesta y elige. Si elige otra forma, vale la suya.
- Si no hay quien conteste, o mientras Shiro no sepa decidir (antes de AV-5),
  la sugerencia se aplica tal cual: no hay decisión suya que cambiar.
- Su preferencia dura hasta que exprese otra o se reinicie el servidor.
- La emoción, la latencia y las ganas no tienen reglas propias: son cosas que
  ella sopesa.

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
6. Shiro no cambia de cuerpo a mitad de frase: un cambio suyo o automático
   espera a que termine el audio. Fijar y soltar son inmediatos.
7. Entre dos cambios automáticos pasa un tiempo mínimo, para que no haya
   vaivén.

Esto amplía el contrato del ADR 0028 con dos piezas de ciclo de vida, que no
son verbos: **`dispose()`** y **carga cancelable**.

### 6. Por cliente, y en los dos modos de ventana

- La elección se hace en cada cliente. Las señales comunes (dormida, modo de
  actividad, preferencia de Shiro) llegan por el bus y cada cliente las aplica
  a sus candidatos y a sus límites: uno que solo tenga la chibi se queda en la
  chibi aunque Shiro prefiera el 3D.
- El fijado es de cada cliente y se guarda como el silencio de la voz
  ([ADR 0020](0020-tts-elevenlabs-systemtts-fallback-y-multidevice-diferido.md)).
- El modo normal y el overlay usan el mismo selector, y el modo de ventana no
  descarta ningún modelo.

### 7. Eventos nuevos en el bus

| Evento             | Sentido         | Para qué                                                            |
| ------------------ | --------------- | ------------------------------------------------------------------- |
| `avatar:state`     | cliente → core  | Qué forma lleva, cuáles tiene disponibles y si está fijada          |
| `avatar:suggest`   | cliente → core  | Sugerencia hecha desde la app; el core la convierte en un turno     |
| `avatar:preferred` | core → clientes | La forma que Shiro quiere                                           |
| `presence:set`     | cliente → core  | Dormir o despertar a Shiro; poner o quitar el modo de actividad     |
| `presence:changed` | core → clientes | El estado nuevo (despierta o dormida, modo de actividad) y su causa |

### 8. Qué queda fuera

- Detectar solos el juego o el directo: pide decidir qué se mira y garantizar
  que solo el modo, y nada de lo observado, sale de la máquina.
- El motor 3D (con su ADR) y el arte del 2D y el 3D.
- El modelo por dispositivo: llega con el protocolo multicliente.
- Varias poses de un mismo modelo, y qué más hace «dormida» fuera del avatar
  (por ejemplo, soltar el modelo local de la GPU).

### Qué viene del dueño y qué propone el agente

| Punto                                                  | Del dueño                                                | Propuesta del agente                                           |
| ------------------------------------------------------ | -------------------------------------------------------- | -------------------------------------------------------------- |
| Tres modelos, en caliente, en modo normal y en overlay | Sí                                                       | —                                                              |
| Quién decide                                           | Shiro; lo que él diga influye pero no la cambia          | La sugerencia le llega como un turno y ella contesta           |
| Fijar                                                  | Existe                                                   | Gana a todo salvo a los límites del cliente                    |
| Dormirse                                               | Por inactividad configurable, al decírselo y por horario | El horario solo duerme; se despierta con cualquier interacción |
| Juego o directo                                        | Lo dice él con un modo o un atajo; detectarlo, después   | Ese modo descarta la forma pesada                              |
| Cómo se ve el cambio                                   | Fundido corto                                            | Unos 250 ms, a cargo del selector                              |
| Dispositivos al final; overlay donde estaba            | Sí                                                       | —                                                              |
| Orden de la escalera                                   | —                                                        | Límites → fijado → estado y contexto → Shiro → orden           |
| Por dónde habla Shiro                                  | —                                                        | Campos opcionales de la respuesta estructurada                 |
| `form`, `cost` y `capabilities`                        | —                                                        | Propuesta de la sesión de diseño del personaje                 |

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
- Shiro puede decir que no. Es lo pedido; la salida es fijar.
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
  `AnthropicLLM` y `OllamaLLM`, el contexto del turno y `avatar:state`,
  `avatar:suggest` y `avatar:preferred`.
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
