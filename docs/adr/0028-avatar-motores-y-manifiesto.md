# ADR 0028: Avatar — motores intercambiables, manifiesto por modelo y motor de capas

- **Status**: Accepted
- **Fecha**: 2026-11-12
- **Decidido por**: Pipelol

> **Estado de implementación (2026-11-12):** decisión aceptada, **sin
> implementar todavía**. La integración en el cliente queda aplazada por
> decisión del autor. Lo que existe es un prototipo fuera del cliente, en
> [`docs/design/chibi-prototype/`](../design/chibi-prototype/README.md).

## Contexto

El avatar actual (ADR 0021) es Live2D con el modelo de prueba Hiyori, y
`Avatar.tsx` solo sabe elegir entre "Live2D" y "orbe". El diseño de Shiro ya
está aprobado (biblia v0.2 y `docs/design/shiro-design-master/`) y el plan es
tener tres formatos: una **chibi por capas** (prototipo, ya funcionando en un
banco de pruebas fuera del cliente), un **3D en VRM** (objetivo final) y el
**2D en Live2D** (aparcado).

Fuerzas en juego:

- Tres motores de render muy distintos tienen que convivir tras el mismo
  `<Avatar>`, y el orbe debe seguir siendo la red de seguridad.
- El mapeo emoción → expresión está hoy repartido entre el YAML del
  personaje, un alias de Hiyori en el servidor y `expression-map.ts` en el
  cliente. Con un segundo modelo, eso no escala.
- Parte del trabajo ya está hecho: `useLipSync.ts` no conoce el motor
  (entrega un número por un callback); `useAvatarExpression.ts` casi (entrega
  parámetros de Cubism).
- Una persona, 4–6 horas a la semana: no caben abstracciones que haya que
  mantener sin usarlas.

Lo que no sabemos: cuánto costará el VRM en la GTX 1650 junto a Ollama y
Whisper, y si el brillo reactivo sobrevive de Blender a three-vrm. Ninguna de
las dos cosas afecta a esta decisión; afectan al ADR del motor 3D.

## Decisión

**Vamos a separar el avatar del cliente en tres piezas: un contrato común de
cinco verbos, un manifiesto por modelo y un selector de motores con lista de
candidatos; y vamos a añadir el primer motor nuevo, el de capas, para la
chibi.**

### 1. Contrato de un motor: cinco verbos

Cada motor es un componente que recibe el estado y lo dibuja. Internamente
expone solo esto:

| Verbo                    | Significado                                                                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setExpression(nombre)`  | Ir hacia una expresión con nombre de Shiro (`idle`, `smirk`…)                                                                                                        |
| `setMouthOpen(0..1)`     | Abrir la boca; el valor viene del audio                                                                                                                              |
| `setBlink(0..1 \| null)` | Parpadeo manual; `null` = automático                                                                                                                                 |
| `setGlow(0..n \| null)`  | Intensidad de las líneas de circuito; `null` = la de la expresión                                                                                                    |
| `setLookAt(x, y)`        | Mirada, en coordenadas normalizadas de −1 a 1 (`0, 0` = al frente; `x` positivo = derecha de la pantalla, `y` positivo = arriba). Un motor que no la tenga la ignora |

No se abstrae nada más (ni escena común ni huesos genéricos).

El parpadeo automático es de cada motor: si el modelo trae el suyo (Live2D lo
hace hoy), `setBlink(null)` lo deja en sus manos y nadie lo duplica desde
fuera. Solo los motores sin parpadeo propio (capas) usan el temporizador
común.

### 2. Manifiesto por modelo

Cada modelo lleva un `avatar.manifest.json` junto a sus archivos: tipo de
motor (`kind`), archivos, mapa de expresiones de Shiro → piezas o nombres del
modelo, bocas, parpadeo, brillo por expresión, emoción → expresión y créditos.
Cambiar de modelo o de formato pasa a ser cambiar de manifiesto. Hiyori pasa a
tener el suyo y desaparece el alias repartido por el código.

### 3. Selector con lista de candidatos

`Avatar.tsx` deja de conocer Live2D. Recibe una lista ordenada de candidatos
(`[{ kind, manifestUrl }]`) y monta el primero que esté disponible. Cada motor
aporta su comprobación (`probe`) y se carga con import dinámico solo si se va
a usar, como hoy se hace con Live2D. El orbe es siempre el último candidato y
nunca falla.

Cada comprobación tiene un **tiempo límite** (del orden de 4 s). Si falla o se
agota, se pasa al siguiente candidato; mientras tanto se muestra el orbe, como
hoy. Sin ese límite, una petición colgada del primer candidato dejaría la
cadena parada en el orbe aunque hubiera otro modelo disponible. Hoy las
comprobaciones de Live2D no tienen tiempo límite.

Orden por defecto en el escritorio: 3D → 2D → capas → orbe. Hasta que exista
el 3D, en la práctica es Live2D → capas → orbe; con la chibi instalada y sin
Hiyori, sale la chibi.

### 4. Motor de capas (`kind: "sprite-layers"`)

Dibuja en un canvas 2D: contorno opcional, base, ojos, boca, rubor, cejas y
brillo. Boca por umbrales de amplitud (cerrada y tres aperturas), parpadeo
por temporizador, transición corta entre expresiones y brillo con patrón
(fijo, pulso, destello). Sin dependencias nuevas.

### 5. Los recursos del modelo no se commitean

Las capas de la chibi salen del borrador original del personaje y van en
`packages/desktop/public/avatar/models/…`, ignorado por git, igual que hoy
`public/live2d/models/`. El repo sigue funcionando sin ellas (orbe).

## Alternativas consideradas

- **Añadir la chibi como un caso más dentro de `Avatar.tsx`**: lo más rápido
  hoy, pero el tercer motor (VRM) obligaría a rehacerlo, y el mapeo de
  expresiones seguiría repartido en tres sitios.
- **Una abstracción de escena común** (nodos, huesos, materiales): tres
  motores tan distintos solo comparten los cinco verbos. Sería código que
  mantener sin beneficio.
- **Rehacer la chibi como modelo Live2D** para reutilizar el motor actual:
  exige rigging manual en Cubism y ata la versión ligera al SDK propietario,
  justo donde menos compensa.
- **PixiJS para el motor de capas**: ya está en el cliente, pero para apilar
  una docena de imágenes un canvas 2D basta, pesa menos y no arrastra la
  versión de Pixi.
- **Config del avatar servida por el servidor** (evento del bus o endpoint):
  más limpio a largo plazo, pero el cliente ya la tiene escrita en `config.ts`
  y cambiarlo ahora mezcla dos decisiones. Queda para cuando haya varios
  clientes con avatares distintos.
- **Esperar al 3D e integrar todo de una vez**: retrasa ver a Shiro en la app
  y estrena motor, formato y arquitectura el mismo día.

## Consecuencias

### Positivas

- Shiro aparece en la app con su propio diseño sin esperar al 3D.
- El 3D y el 2D de Shiro entran después como un motor o un manifiesto más,
  sin tocar el selector.
- El mapeo de expresiones queda en un solo sitio por modelo.
- El motor de capas no añade dependencias ni depende de WebGL: sirve para
  equipos modestos, modo ahorro y, si se aprueba, el modo flotante.

### Negativas / Riesgos

- Tocar `Avatar.tsx` puede romper el fallback al orbe, que hoy es "a prueba
  de balas". Mitigación: tests del selector con cada motor fallando.
- `useAvatarExpression.ts` se divide en una parte común y el adaptador de
  Live2D: hay que mantener el comportamiento actual de Hiyori idéntico.
- Un formato de manifiesto propio es algo más que documentar y validar (zod).
- Las piezas de cara de la chibi son provisionales; el modelo puede cambiar
  de aspecto cuando lleguen las definitivas (sin cambios de código).

### Neutrales

- `IAvatarModule`, el servidor, el YAML del personaje y `useLipSync.ts` no
  cambian.
- `config.ts` pasa de rutas sueltas a una lista de candidatos.
- "Cuando Shiro decida mostrarse así" (cambio de formato en caliente) queda
  fuera: pide un evento nuevo en el bus y su propio ADR.
- Ampliar las emociones del código de 5 a 9 también queda fuera.

## Notas de implementación

- `packages/desktop/src/components/Avatar/`:
  - `Avatar.tsx` → selector por candidatos.
  - `engines/types.ts` → contrato, manifiesto y su esquema zod.
  - `engines/live2d/` → lo actual (`Live2DCanvas.tsx`, `cubism-core.ts`,
    `model-loader.ts`, `expression-map.ts`).
  - `engines/layers/` → `LayersCanvas.tsx` y el reproductor (port a
    TypeScript del prototipo `shiro-chibi.js`).
  - `useAvatarExpression.ts` → parte común (emoción → nombre de expresión);
    la interpolación de parámetros Cubism se queda en el motor Live2D.
  - `useBlink.ts` → temporizador de parpadeo para los motores que no traen
    el suyo (capas). Live2D conserva el del modelo.
- Tests (Vitest): selector con cada candidato disponible, fallando o
  agotando el tiempo límite; esquema
  del manifiesto; elección de boca por umbrales; elección de ojos con
  parpadeo; que Hiyori se comporte igual que antes.
- README: dónde poner los recursos de la chibi.
- PRs previstos: (1) contrato, manifiesto y selector, con Live2D adaptado y
  sin cambio visible; (2) motor de capas; (3) documentación.

## Referencias

- [ADR 0021](0021-avatar-live2d-pixi-display-fallback-orbe.md) — avatar Live2D y fallback al orbe.
- [ADR 0009](0009-orbe-placeholder-avatar.md) — orbe; [ADR 0014](0014-llm-structured-output-text-emotion.md) — emoción en la salida del LLM; [ADR 0020](0020-tts-elevenlabs-systemtts-fallback-y-multidevice-diferido.md) — TTS.
- [`docs/design/shiro-character-bible.md`](../design/shiro-character-bible.md) (v0.2) y [`docs/design/shiro-design-master/`](../design/shiro-design-master/README.md).
- Prototipo: [`docs/design/chibi-prototype/`](../design/chibi-prototype/README.md).
- Revisión independiente con Gemini 3.8 Flash (2026-11-12): de ahí salen el
  tiempo límite de las comprobaciones, el rango de `setLookAt` y la
  aclaración sobre quién parpadea.
