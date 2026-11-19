# Propuesta: que Shiro tenga vida propia cuando nadie le habla

Documento de referencia. **No es una decisión**: nada de lo que hay aquí se
ejecuta sin que el dueño apruebe cada paso, y los pasos 3 y 4 piden antes una
enmienda o un ADR.

> **Estado** (2026-11-18): propuesta escrita por la sesión de diseño del
> personaje, sin aprobar y sin implementar. El mismo día el dueño fijó la
> **dirección** del paso 4: quiere que Shiro tenga «mucha más iniciativa»
> que la de la primera versión de este documento. El detalle queda por
> definir (ver el paso 4).

## De dónde sale

[_La NO existencia de Lilith_](https://store.steampowered.com/app/4643090/La_NO_existencia_de_Lilith/)
(Nino Games, 2026) es una compañera de escritorio sin inteligencia
artificial: diálogos escritos, voz grabada y un personaje 2D animado a mano.
Aun así se siente viva, porque tiene **rutina y gestos pequeños**: se
adormila de noche, bosteza, se distrae, se duerme y se despierta.

Shiro es lo contrario: tiene cerebro, memoria y voz, pero **solo existe
cuando le hablan**. Entre un turno y el siguiente no hace nada. Esta
propuesta toma de Lilith esa mitad que falta.

Se toman **ideas**, vistas en la página de la tienda y en las notas de
versión públicas. No se copia arte, texto ni código.

## Qué se toma

1. **Sueño por grados.** Hoy el [ADR 0035](../adr/0035-avatar-eleccion-de-modelo-en-caliente.md)
   prevé dos estados: despierta y dormida. Se añade uno intermedio,
   **somnolienta**, y que si la despiertan sin hablarle vuelva a dormirse sola
   al rato.
2. **Gestos en reposo.** Cada cierto tiempo, y sin que nadie se lo pida: mirar
   a un lado, un parpadeo doble, un bostezo. Los reparte un planificador con
   pausas largas y al azar.
3. **Emoción con inercia.** Hoy la cara se queda en la emoción de la última
   respuesta hasta la siguiente. Pasado un rato debería volver sola a la
   calma, con el fundido de siempre.
4. **Iniciativa propia, y mucha.** Lilith solo avisa de que es tarde. Shiro
   debe ir bastante más lejos: hablar primero, retomar temas, proponer y
   empezar cosas por su cuenta. Es la pieza principal de esta propuesta (ver
   el paso 4).
5. **Recordatorios y temporizadores por voz.** «Avísame en veinte minutos».
   Lilith reconoce fechas con reglas; Shiro lo haría con su modelo, como una
   herramienta más.
6. **Convivencia en el escritorio**, para cuando llegue el modo overlay:
   callarse sola en reuniones, gastar menos en reposo, un «llamar a Shiro» si
   se pierde entre monitores, y exigir un gesto claro para la caricia (a
   Lilith se le confundía con arrastrarla).

## Qué no se toma

- **Objetos que caen, rarezas e intercambio.** Es un mecanismo para retener
  jugadores; en una app de uso personal no aporta.
- **Diálogos por menú y voz grabada.** Shiro ya conversa.
- **Ganchos globales de ratón y de portapapeles.** Abren una frontera de
  confianza que hoy no existe.
- **Detectar juegos o reuniones mirando procesos**, por ahora: el ADR 0035 ya
  decidió empezar por el modo manual.

## Tono: cómo lo haría Shiro

La [biblia del personaje](shiro-character-bible.md) manda sobre cualquier
idea prestada:

- **Shiro subexpresa.** Los gestos son pocos y pequeños. Un bostezo es
  discreto; no hay aspavientos ni bailes.
- **La iniciativa es suya, con su voz.** Toma la palabra a menudo, pero como
  es ella: seca, precisa y con algo que decir. No es una mascota que pide
  mimos ni un asistente que notifica.
- **No insiste.** Si no le contestan, lo deja estar; no repite ni se queja.
- **Todo se puede graduar y apagar.** Cuánta iniciativa tiene lo regula el
  usuario.

Hasta dónde llega la iniciativa sin salirse del personaje (la biblia la
describe reservada, de las que empiezan distantes) es algo a afinar al
escribir el ADR; esta lectura es de la sesión de diseño, no del dueño.

## Plan

| Paso | Qué                                                                                | Quién                          | Depende de                             | Tamaño                   |
| ---- | ---------------------------------------------------------------------------------- | ------------------------------ | -------------------------------------- | ------------------------ |
| 1    | Expresiones `sleepy` y `asleep` de la chibi, y el bostezo                          | Sesión de diseño               | Nada                                   | Pequeño                  |
| 2    | Gestos en reposo y emoción con inercia, en el prototipo y con su tabla de casos    | Sesión de diseño               | Paso 1                                 | Pequeño                  |
| 3    | Llevar los pasos 1 y 2 a la app; el estado «somnolienta» en el módulo de presencia | Sesión que escribe `packages/` | AV-2 y AV-4; enmienda del ADR 0035     | Mediano                  |
| 4    | Iniciativa de Shiro, amplia: la define y la escribe la sesión que lleva el código  | Sesión que escribe `packages/` | **ADR nuevo**, aprobado por el dueño   | Muy grande, por entregas |
| 5    | Convivencia en el escritorio                                                       | Quien haga el modo overlay     | Modo overlay (enmienda de ADR 0024 §3) | —                        |

Los pasos AV-x son los de la vía del avatar del
[plan de mejora](../plan-mejora-2026-11.md).

### Paso 1 — caras de sueño

Las tres salen de piezas que la chibi ya tiene, sin arte nuevo:

- `sleepy`: párpado muy bajo, mirada hacia abajo, brillo tenue.
- `asleep`: ojos cerrados, brillo al mínimo. Es la que ya pide el ADR 0035.
- Bostezo: un gesto corto, no una expresión; boca abierta grande con los ojos
  entornados.

Se añaden al generador de piezas, al modelo sintético de prueba y a los casos
de [`chibi-prototype/`](chibi-prototype/README.md). `sleepy` ya estaba
prevista en la biblia (§6.2).

### Paso 2 — gestos en reposo

Un planificador **por encima de los cinco verbos** del motor
([ADR 0028](../adr/0028-avatar-motores-y-manifiesto.md)), para que sirva igual
con la chibi, el 2D y el 3D. Se prototipa en la página de pruebas y se
entrega con su tabla de comportamientos esperados:

- No hace nada mientras Shiro habla, escucha o piensa.
- Pausa al azar entre gestos, del orden de un minuto; nunca dos seguidos.
- Dormida, solo respira.
- Respeta «reducir movimiento» del sistema: entonces no hay gestos.
- La emoción vuelve a `idle` tras un tiempo configurable sin turno nuevo.

### Paso 3 — a la app

Lo escribe la sesión que lleva el código, cuando AV-2 (chibi en la app) y
AV-4 (reglas de dormida) estén hechos. Lo nuevo respecto al ADR 0035 es
pequeño, pero cambia su texto, así que viaja como **enmienda en el mismo PR**:

- Un tercer estado de presencia, `drowsy`, antes de `asleep`.
- Despertarla con un clic, sin mensaje, la deja despierta un rato corto y
  vuelve a dormirse.

### Paso 4 — iniciativa de Shiro

**Dirección del dueño (2026-11-18):** «quiero que Shiro tenga mucha más
iniciativa». No se queda en unos pocos avisos acotados. Lo que sigue es una
**nota simple** de la sesión de diseño; definirlo bien, ordenarlo y escribir
su ADR es trabajo de la sesión que lleva la reestructuración del proyecto.

Hoy todo turno empieza en el usuario. La idea es que Shiro también pueda
empezar. Tipos de iniciativa, de menos a más:

| Tipo                   | Ejemplos                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Hablar primero         | Saludar al llegar o al volver, comentar la hora, avisar de un recordatorio, decir algo tras un silencio largo     |
| Retomar                | Volver a un tema que quedó a medias, preguntar cómo salió algo que se le contó, acordarse de una fecha            |
| Opinar sin que pidan   | Comentar lo que se está haciendo, discrepar, señalar algo que ve mal                                              |
| Proponer               | Sugerir un descanso, una tarea pendiente, una mejora de sí misma (lo que ya hace por encargo el self-improvement) |
| Empezar a hacer        | Arrancar por su cuenta una tarea con sus herramientas, dentro de los permisos y aprobaciones que ya existen       |
| Decidir sobre sí misma | Qué forma tener (ya en el ADR 0035), cuándo dormirse o callarse, de qué humor está                                |

Los recordatorios y temporizadores por voz son un caso más de la primera
fila.

Esta iniciativa es también la base de otra faceta: que Shiro copresente,
dirija y juegue en los directos del dueño. Está en
[`propuesta-directos-y-juegos.md`](propuesta-directos-y-juegos.md) y depende
de este paso.

Lo que la sesión de diseño propone mantener, sea cual sea el alcance:

- **Un regulador de iniciativa** (apagada, poca, normal, mucha), mejor que
  veinte interruptores sueltos.
- **Las aprobaciones no cambian.** Que Shiro empiece algo sola no le da más
  permisos: lo que hoy pide confirmación la sigue pidiendo
  ([ADR 0022](../adr/0022-shiro-agentic-tools-fs-shell.md)).
- **Sabe cuándo callar**: dormida, en modo juego o directo, o si el usuario
  la silenció.

Preguntas abiertas para el ADR:

- De dónde nace un turno propio: reloj, memoria, eventos de la app, lo que
  pasa en el equipo. Mirar la pantalla o los programas abiertos es una
  frontera de confianza nueva y se decide aparte.
- Con qué frecuencia, y cómo evitar que canse.
- Qué modelo piensa esos turnos, y cuánto cuestan si son muchos.
- Por qué cliente sale la voz si hay más de uno.
- Cómo se guarda lo pendiente (recordatorios, temas a retomar) y qué pasa si
  la app estaba cerrada.
- Por dónde empezar: el ADR debería partirlo en entregas pequeñas.

### Paso 5 — convivencia

No se hace nada ahora. Cuando se retome el modo overlay, sumar los cuatro
puntos del apartado 6 de «Qué se toma» a lo que ya se pensó para él en la
[propuesta de rediseño](propuesta-rediseno-escritorio.md) (§10).

## Qué tiene que decidir el dueño

1. Si los pasos 1 y 2 pueden empezar ya. No tocan la app.
2. Si quiere el estado «somnolienta» y el volver a dormirse (paso 3).
3. ~~Si quiere que Shiro pueda hablar primero.~~ Decidido el 2026-11-18: sí, y
   con mucha más iniciativa que la propuesta al principio. Queda por decidir
   el alcance concreto, cuando la sesión de reestructuración lo presente como
   ADR.
