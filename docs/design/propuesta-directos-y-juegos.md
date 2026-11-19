# Propuesta: Shiro en los directos — copresentar, dirigir y jugar

Documento de referencia. **No es una decisión**: es una nota simple de la
sesión de diseño del personaje. Definirlo bien, ordenarlo y escribir sus ADR
es trabajo de la sesión que lleva la reestructuración del proyecto, y nada se
ejecuta sin que el dueño apruebe cada paso.

> **Estado** (2026-11-18): propuesta sin aprobar y sin implementar. Recoge lo
> que el dueño pidió ese día y sus respuestas a cuatro preguntas.

## Qué pidió el dueño

- Que Shiro pueda, aunque sea de forma mínima, **jugar** en sus directos y
  **tomar el control** de ellos.
- Que **no sea un «modo» streamer o gaming**: tiene que ser una capacidad
  nativa de Shiro.
- **Plataforma:** al principio solo Twitch, con OBS, dejando la puerta abierta
  a las demás.
- **Juegos:** que sirva para cualquiera («global»), con integración
  progresiva y **dependiente de pruebas**: rendimiento, recursos, tiempo y
  los juegos del momento.
- **Jugar**, en las cuatro formas: con el chat, a juegos lentos, con él como
  segundo jugador y manejando su juego. Mismas condiciones.
- **Control:** copresentar, dirigir la producción y cubrirle un rato. Que
  haga **directos propios** le gustaría, pero no es prioridad.

## Qué enseñan Neuro-sama y los proyectos parecidos

- **Neuro-sama no es un modelo, son piezas**: un modelo de lenguaje, voz,
  avatar y un módulo por juego. Su creador nunca ha publicado el sistema; lo
  que sigue sale de lo que sí es público.
- **Juega por texto.** Su
  [SDK de juegos](https://github.com/VedalAI/neuro-sdk) (licencia MIT) es un
  protocolo sencillo por WebSocket: el juego le cuenta su estado en texto,
  registra las acciones posibles y ella elige una. Está pensado para juegos
  **por turnos o lentos** (cartas, tablero, novelas visuales).
- **Los juegos rápidos no los juega el modelo de lenguaje.** O hay otro
  sistema que hace lo fino y ella solo decide lo grande, o es un modelo
  entrenado solo para ese juego (así empezó, con _osu!_).
- **En Minecraft es un jugador más**: un personaje propio que entra a la
  partida. Los proyectos abiertos ([AIRI](https://github.com/moeru-ai/airi))
  lo hacen igual.
- **Alguien decide cuándo habla.** Las recreaciones abiertas
  ([kimjammer/Neuro](https://github.com/kimjammer/Neuro)) tienen una pieza
  que mira señales (¿habla el humano?, ¿hay mensajes nuevos?, ¿cuánto
  silencio va?) y decide cuándo darle el turno.
- **El filtro no es opcional.** A Neuro-sama la
  [suspendieron dos semanas](https://en.wikipedia.org/wiki/Neuro-sama) en
  2023 por algo que dijo. Desde entonces lo prohibido se sustituye por una
  palabra antes de llegar a la voz, y su chat está moderado.
- **La latencia lo es todo.** Lo que hace creíble a una copresentadora es
  contestar rápido.

## La idea: nativa, no un modo

Shiro no «entra en modo directo». Es la misma, con la misma memoria y la
misma voz, y gana **sentidos** y **manos** que tiene siempre:

- Si OBS está emitiendo, **lo percibe** y sabe que está en público.
- Si hay chat, lo oye. Si hay un juego conectado, lo ve.
- Si nada de eso está conectado, esos sentidos están callados y ya.

Esto roza una decisión vigente. En el
[ADR 0035](../adr/0035-avatar-eleccion-de-modelo-en-caliente.md) hay un
«modo de actividad» (nada, jugando, en directo) que **indica el usuario**
con un atajo. No es un modo de Shiro: es una señal para elegir qué forma
tiene, y no choca con lo que pidió el dueño. Lo que cambiaría es de dónde
sale: además de indicarla él, Shiro podría **percibirla**. Ese ADR ya deja
«detectar solos el juego o el directo» como pendiente y dice qué pide, así
que sería una enmienda que añade una fuente, no que quita la que hay.

Son tres clases de piezas, y dos ya tienen patrón en el proyecto:

| Pieza        | Qué es                                                                    | Patrón que sigue                                                                    |
| ------------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **Sentidos** | Chat de Twitch, estado de OBS, estado del juego y, al final, la pantalla  | Módulos que publican eventos en el bus                                              |
| **Manos**    | Escribir en el chat, encuestas, clips, escenas de OBS, acciones del juego | Herramientas del registro ([ADR 0022](../adr/0022-shiro-agentic-tools-fs-shell.md)) |
| **Criterio** | Decidir cuándo toma la palabra y a qué le hace caso                       | La iniciativa de la [propuesta de vida propia](propuesta-vida-propia.md), paso 4    |

Un matiz sobre las manos: el ADR 0022 da el patrón, pero su primera versión
solo cubre archivos y comandos. Deja fuera tres categorías, cada una con su
ADR: herramientas de red, dispositivos y manejo del sistema. Las manos de
Twitch y de OBS son **herramientas de red**, así que hoy tampoco existen: el
ADR de esta faceta (D-0) tiene que abrir esa categoría.

Lo importante: **los directos no son un sistema aparte**. Son la iniciativa
de Shiro más unos sentidos y unas manos nuevos. Por eso dependen de ese
paso 4.

## Dos escaleras

Cada peldaño se sube solo si las pruebas del anterior salen bien.

### Control del directo

| Peldaño | Qué hace Shiro                                                                              | Qué necesita                                 |
| ------- | ------------------------------------------------------------------------------------------- | -------------------------------------------- |
| C1      | **Copresenta**: escoge mensajes del chat y responde, le habla al dueño, comenta lo que pasa | Chat, iniciativa, filtro, subtítulos         |
| C2      | **Dirige la producción**: escenas, música, encuestas, predicciones, marcadores y clips      | Manos de OBS y de Twitch                     |
| C3      | **Cubre un rato**: entretiene al chat sola unos minutos y devuelve el directo               | C1, juegos con el chat y un límite de tiempo |
| C4      | **Directos propios** (idea, sin prioridad)                                                  | Todo lo anterior, muy probado                |

### Jugar

| Peldaño | Qué juega                                                    | Cómo                                                                                |
| ------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| J1      | **Con el chat**: trivias, adivinanzas, retos que ella dirige | Solo chat y encuestas; no hace falta ningún juego                                   |
| J2      | **Juegos lentos o por turnos**                               | El juego le describe el estado en texto y ella elige la jugada                      |
| J3      | **Con el dueño**, como segundo jugador                       | Un personaje suyo en la partida; ella decide lo grande y unas rutinas hacen lo fino |
| J4      | **Su juego**, viendo la pantalla y usando ratón y teclado    | Lento e impreciso; solo cosas simples y con su propio ADR                           |

Dos notas sobre «cualquier juego»:

- **J2 puede salir casi gratis.** Si Shiro habla el mismo protocolo que el SDK
  de Neuro-sama, podría usar las integraciones que la comunidad ya ha hecho
  para juegos reales, sin escribir una por juego. Hay que comprobarlo con uno
  y revisar la licencia de cada integración.
- **Los competitivos con anti-trampas no se tocan.** Un programa que maneje
  el juego puede costar la cuenta. Ahí Shiro **comenta y reacciona**, usando
  los datos que el propio juego ofrezca de forma oficial, y nunca envía
  entrada.

## Lo que no es negociable al salir en público

- **Filtro antes de la voz**, para lo que dice ella y para lo que lee del
  chat. Lo filtrado se sustituye por una palabra, con su tono.
- **El chat es entrada no fiable.** Un mensaje del chat nunca aprueba una
  acción ni le da órdenes: es un dato. Las confirmaciones siguen siendo solo
  del dueño.
- **En directo, la memoria privada no sale.** Shiro sabe cosas que se le
  contaron a solas. Tiene que saber que está en público y callarlas. Es lo
  más delicado de todo y hoy la memoria no distingue público de privado.
- **Botón de pánico**: un atajo que la calla y le quita las manos al
  instante.
- **Lo que hace sola en la producción se gradúa**: lo reversible (cambiar de
  escena) puede ir sin preguntar; lo que no (publicar un clip), no.

## Qué hay que medir antes

El equipo actual es un portátil con una gráfica de 4 GB. Juego, OBS y Shiro
entera a la vez no caben, así que cada peldaño depende de medidas:

- **Latencia del turno.** Hoy es de varios segundos y secuencial. Para
  copresentar es lo primero que se notaría.
- **Recursos**: dónde corre cada pieza mientras se juega y se emite (modelos
  en la nube, el equipo nuevo, el servidor de casa).
- **Coste**: un chat activo son muchos turnos; hay que ponerle tope.

## Plan

| Paso | Qué                                                                                  | Depende de                                 |
| ---- | ------------------------------------------------------------------------------------ | ------------------------------------------ |
| D-0  | ADR de la faceta: sentidos, manos (herramientas de red), filtro y memoria en público | ADR de la iniciativa (vida propia, paso 4) |
| D-1  | Sentidos de solo lectura: Shiro sabe que está en directo y oye el chat; no dice nada | D-0                                        |
| D-2  | Copresentar (C1), con filtro, botón de pánico y subtítulos                           | D-1, iniciativa y latencia medida          |
| D-3  | Jugar con el chat (J1) y manos de Twitch                                             | D-2                                        |
| D-4  | Dirigir la producción (C2)                                                           | D-2                                        |
| D-5  | Un juego por turnos (J2), elegido con pruebas                                        | D-2                                        |
| D-6  | Cubrir un rato (C3)                                                                  | D-3                                        |
| D-7  | Jugar con el dueño (J3), empezando por un sandbox                                    | D-5                                        |
| D-8  | Manejar el juego (J4)                                                                | ADR propio: pantalla y entrada del sistema |
| D-9  | Directos propios (C4)                                                                | Sin fecha                                  |

El código lo escribe la sesión que lleva `packages/`. De la sesión de diseño
sería lo que se ve y cómo suena: cómo aparece Shiro en la escena de OBS, los
subtítulos, sus reacciones y su tono con el chat (su sarcasmo seco encaja
bien con un chat; la biblia manda).

## Qué tiene que decidir el dueño

1. Si en directo se aceptan modelos en la nube, con un tope de gasto.
2. Qué puede hacer Shiro en la producción sin preguntar.
3. Si el chat puede dirigirse a ella directamente (por nombre, con puntos del
   canal) o solo ella escoge a quién contesta.
4. Con qué juego se prueba primero el peldaño J2.
