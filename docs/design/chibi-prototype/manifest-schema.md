# Manifiesto del avatar por capas — borrador del esquema (v0.2)

Describe `avatar.manifest.json` para el motor de capas (`kind: "sprite-layers"`)
del [ADR 0028](../../adr/0028-avatar-motores-y-manifiesto.md). Es el formato
que lee hoy el prototipo ([`player/shiro-chibi.js`](player/shiro-chibi.js)) y
el punto de partida para el esquema zod del cliente. **Es un borrador**: lo
que decida la implementación manda, y este documento se corrige después.

Ejemplos que cumplen el esquema:
[`test-model/avatar.manifest.json`](test-model/avatar.manifest.json) (todos
los campos) y
[`test-model/avatar.minimal.manifest.json`](test-model/avatar.minimal.manifest.json)
(solo los obligatorios).

## Unidades y coordenadas

- **Píxeles del modelo**: todas las medidas (`size`, `face.rect`,
  `face.gaze.max`) van en píxeles de las imágenes tal como están en disco. El
  motor escala la figura entera al dibujarla.
- **Origen** arriba a la izquierda; `y` crece hacia abajo.
- **Mirada**: de −1 a 1 por eje. `x` positivo es la derecha de la pantalla;
  `y` positivo es **arriba** (al revés que los píxeles).
- **Rutas**: relativas a la carpeta del manifiesto, con `/`.

## Cabecera (común a cualquier motor)

| Campo         | Tipo   | Obligatorio | Por defecto | Qué es                                                                                           |
| ------------- | ------ | ----------- | ----------- | ------------------------------------------------------------------------------------------------ |
| `kind`        | texto  | sí          | —           | Motor que pide el modelo. Aquí, `"sprite-layers"`. Es lo que mira el selector                    |
| `name`        | texto  | sí          | —           | Nombre para mostrar                                                                              |
| `version`     | texto  | sí          | —           | Versión **del formato** del manifiesto (`"0.2"`), no del arte                                    |
| `provisional` | lógico | no          | `false`     | El modelo lleva piezas provisionales. Solo informativo                                           |
| `credits`     | texto  | no          | `""`        | Autoría y licencias, para la pantalla de créditos                                                |
| `draw_order`  | lista  | no          | —           | **Obsoleto.** Era una nota informativa; el orden lo fija el motor. Los generadores ya no lo usan |

## Campos del motor de capas

### Figura

| Campo            | Tipo                    | Obligatorio | Por defecto  | Qué es                                                                              |
| ---------------- | ----------------------- | ----------- | ------------ | ----------------------------------------------------------------------------------- |
| `size`           | `[ancho, alto]` enteros | sí          | —            | Tamaño de las capas de figura completa. Ambos > 0                                   |
| `layers.base`    | ruta                    | sí          | —            | Figura sin líneas de circuito y con la cara en blanco                               |
| `layers.glow`    | ruta                    | no          | sin brillo   | Líneas de circuito. Sin ella, `setGlow` no hace nada                                |
| `layers.outline` | ruta                    | no          | sin contorno | Contorno de luz opcional, por debajo de la base. Se enciende desde fuera del modelo |

Las tres capas miden `size` y se dibujan en `(0, 0)`.

### Cara

Todas las piezas de `face.pieces` miden lo mismo que la caja de la cara y se
dibujan en su esquina.

| Campo                    | Tipo                          | Obligatorio | Por defecto   | Qué es                                                                                                    |
| ------------------------ | ----------------------------- | ----------- | ------------- | --------------------------------------------------------------------------------------------------------- |
| `face.rect`              | `[x, y, ancho, alto]` enteros | sí          | —             | Caja de la cara dentro de la figura. Debe caber en `size`                                                 |
| `face.pieces`            | mapa nombre → ruta            | sí          | —             | Todas las imágenes de la cara. El resto del manifiesto las nombra por su clave                            |
| `face.eyes`              | mapa estado → objeto          | sí          | —             | Estados de párpado. Al menos los que usen las expresiones y el parpadeo                                   |
| `face.eyes.<e>.white`    | nombre de pieza o `null`      | sí          | —             | Hueco visible del ojo (lo que no tapa el párpado). `null` = ojo cerrado: no se pinta ni blanco ni iris    |
| `face.eyes.<e>.lines`    | nombre de pieza               | sí          | —             | Pestañas y contorno de ese estado. Va encima del iris                                                     |
| `face.iris`              | nombre de pieza               | no          | sin iris      | Iris y pupila de los dos ojos, con la mirada al frente. Sin él no hay mirada móvil                        |
| `face.gaze.max`          | `[x, y]` ≥ 0                  | no          | `[0, 0]`      | Recorrido máximo del iris, en píxeles del modelo, cuando la mirada vale 1                                 |
| `face.blink.open`        | nombre de estado              | no          | `"eyes_open"` | Estado «del todo abierto». Solo las expresiones que lo usan pasan por el fotograma medio al parpadear     |
| `face.blink.half`        | nombre de estado              | sí          | —             | Fotograma medio del parpadeo                                                                              |
| `face.blink.closed`      | nombre de estado              | sí          | —             | Ojo cerrado                                                                                               |
| `face.blink.interval_s`  | `[mín, máx]` segundos         | no          | `[2.5, 6]`    | Entre un parpadeo automático y el siguiente se espera un tiempo al azar en este rango. `0 < mín ≤ máx`    |
| `face.blink.duration_ms` | número > 0                    | no          | `130`         | Lo que dura un parpadeo automático                                                                        |
| `face.mouth_open`        | lista de nombres de pieza     | sí          | —             | Bocas abiertas, de menor a mayor apertura. Puede estar vacía                                              |
| `face.mouth_thresholds`  | lista de números              | sí          | —             | Apertura a partir de la cual entra cada boca. Misma longitud, estrictamente creciente, cada uno en (0, 1] |
| `face.blush`             | nombre de pieza               | no          | sin rubor     | Rubor. Su opacidad la pone cada expresión                                                                 |

### Expresiones

`expressions` es un mapa nombre → objeto. **Debe existir `idle`**: es la de
arranque y a la que se cae cuando se pide una que no está.

| Campo          | Tipo              | Obligatorio | Por defecto | Qué es                                                                  |
| -------------- | ----------------- | ----------- | ----------- | ----------------------------------------------------------------------- |
| `eyes`         | nombre de estado  | sí          | —           | Estado de párpado de la expresión                                       |
| `brows`        | nombre de pieza   | sí          | —           | Cejas                                                                   |
| `mouth`        | nombre de pieza   | sí          | —           | Boca cerrada de la expresión (cuando no habla)                          |
| `blush`        | número 0..1       | no          | `0`         | Opacidad del rubor                                                      |
| `gaze`         | `[x, y]` en −1..1 | no          | `[0, 0]`    | Hacia dónde mira la expresión cuando nadie llama a `setLookAt`          |
| `glow.level`   | número ≥ 0        | no          | `1`         | Intensidad de las líneas. Por encima de 1 se suman a sí mismas          |
| `glow.pattern` | texto             | no          | `"steady"`  | `"steady"` fijo · `"pulse"` vaivén lento · `"flash"` destello al entrar |

### Emociones

| Campo      | Tipo                     | Obligatorio | Por defecto | Qué es                                                                                                                           |
| ---------- | ------------------------ | ----------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `emotions` | mapa emoción → expresión | no          | `{}`        | Emoción del núcleo (`neutral`, `divertida`, `pensativa`, `molesta`, `vulnerable`) → expresión. Una emoción ausente cae en `idle` |

## Reglas que cruzan campos

El esquema debe rechazar un manifiesto que incumpla cualquiera de estas. Hay
un caso de prueba por regla en
[`test-model/behavior-cases.json`](test-model/behavior-cases.json)
(`invalidManifests`).

1. Todo nombre de pieza citado (`white`, `lines`, `iris`, `blush`, `brows`,
   `mouth`, `mouth_open`) existe en `face.pieces`.
2. Todo nombre de estado citado (`expressions.*.eyes`, `face.blink.*`) existe
   en `face.eyes`.
3. Toda expresión citada en `emotions` existe en `expressions`.
4. `expressions.idle` existe.
5. `face.mouth_open` y `face.mouth_thresholds` miden lo mismo, y los umbrales
   crecen.
6. `face.rect` cabe dentro de `size`.
7. Las rutas son relativas, sin `..`, sin barra inicial y sin esquema
   (`https:`, `file:`…): un modelo no puede leer fuera de su carpeta.

Aparte del archivo: si **cualquier** imagen citada no carga, el modelo entero
se da por no disponible. No se monta a medias.

## Cambios de la v0.1 a la v0.2

- Ojos en tres piezas por estado (`face.eyes` con `white` y `lines`) más un
  `face.iris` común, en lugar de una imagen por estado. Es lo que permite la
  mirada móvil.
- `face.gaze.max` y `gaze` por expresión.
- `face.blink.open`: antes el motor llevaba escrito el nombre `eyes_open`.
- Patrones de brillo en inglés (`steady`, `pulse`, `flash`; antes `fijo`,
  `pulso`, `destello`), como el resto de identificadores.
- `layers.glow`, `layers.outline`, `face.iris`, `face.blush` y `emotions`
  pasan a ser opcionales.
- `draw_order` queda obsoleto.

## Para el cambio de modelo en caliente

Nacieron como propuestas de esta carpeta y las recoge el
[ADR 0035](../../adr/0035-avatar-eleccion-de-modelo-en-caliente.md)
(aceptado, sin implementar), que es quien manda si algo difiere. **No forman
parte de la v0.2**: el prototipo no las escribe ni las lee, y los manifiestos
de `test-model/` no las traen.

### En el manifiesto: una cabecera de forma, coste y capacidades

El sitio natural es la cabecera común, junto a `kind`, porque las reglas
tienen que poder leerla **sin cargar el motor** ni las imágenes:

```json
{
  "kind": "sprite-layers",
  "form": "chibi",
  "cost": {
    "tier": "light",
    "needs_webgl": false,
    "memory_mb": 50,
    "download_kb": 1800
  },
  "capabilities": {
    "look_at": true,
    "glow": true,
    "body_motion": false,
    "framing": "full-body"
  }
}
```

| Campo                      | Para qué                                                                                                                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `form`                     | `"chibi"`, `"2d"` o `"3d"`: qué forma de Shiro es el modelo. Añadido por el ADR 0035: Shiro y las reglas eligen una forma, no un archivo, y cada cliente la traduce a su primer candidato instalado de esa forma |
| `cost.tier`                | `"light"`, `"medium"` o `"heavy"`. Lo declara quien hace el modelo; es el orden grueso para «elige uno más ligero»                                                                                               |
| `cost.needs_webgl`         | Si el motor necesita WebGL. Capas no; Live2D y VRM sí. Sirve para descartar candidatos en equipos o modos sin GPU                                                                                                |
| `cost.memory_mb`           | Memoria aproximada con todo cargado. Estimación, no medida                                                                                                                                                       |
| `cost.download_kb`         | Tamaño en disco: lo que tarda en estar listo el cambio                                                                                                                                                           |
| `capabilities.look_at`     | Si tiene mirada móvil. Para que Shiro y la interfaz no prometan lo que el modelo no hace                                                                                                                         |
| `capabilities.glow`        | Si las líneas reaccionan                                                                                                                                                                                         |
| `capabilities.body_motion` | Si el cuerpo se mueve (la chibi no)                                                                                                                                                                              |
| `capabilities.framing`     | `"full-body"`, `"torso"` o `"bust"`: cuánto cuerpo trae. El 2D empezará por el torso, y el overlay y el encuadre lo necesitan para colocarlo                                                                     |

Lo declarado es solo el punto de partida: el coste real (fotogramas por
segundo, tiempo de carga) solo lo puede medir el cliente en marcha, y debería
poder corregir al manifiesto.

Valores de referencia de la chibi, calculados sobre los modelos actuales:

| Modelo              | Figura      | Imágenes | En disco | Decodificado (RGBA) |
| ------------------- | ----------- | -------- | -------- | ------------------- |
| Chibi sentada       | 991 × 1905  | 29       | ≈ 1,8 MB | ≈ 49 MB             |
| Chibi de pie        | 1020 × 1910 | 29       | ≈ 2,2 MB | ≈ 48 MB             |
| Sintético de prueba | 120 × 200   | 29       | 4 KB     | < 1 MB              |

La chibi es ligera de procesador y no usa GPU, pero **no es ligera de
memoria**: cada pieza de cara ocupa la caja entera aunque dibuje solo una
ceja. Si hace falta bajarla (Raspberry, móvil), la vía es recortar cada pieza
a su contenido y guardar su posición; sería un cambio de formato (v0.3) y no
toca al arte.

### En el contrato del motor

- **`dispose()`**: soltar imágenes, lienzos y temporizadores. El prototipo ya
  lo tiene; después de llamarlo no pinta nada.
- **Carga cancelable**: si se pide otro modelo mientras uno carga, la carga
  vieja debe poder abandonarse sin montar nada.
- **Traspaso de estado**: al cambiar, el modelo nuevo debería arrancar con la
  expresión, la mirada fijada y el brillo fijado que tenía el anterior, para
  que el fundido no sea además un cambio de cara. La boca no hace falta: llega
  sola con el siguiente fotograma de audio.
- **Fundido entre modelos**: es del selector, no de cada motor. Según el
  ADR 0035 lo hace con la opacidad de cada lienzo y repitiendo al motor nuevo
  el último valor de cada verbo, así que el motor no necesita ni un verbo de
  opacidad ni uno para leer su estado.

### Varias poses de un mismo modelo

Hoy cada pose de la chibi (sentada, de pie) es un manifiesto aparte y se
trata como un modelo distinto. Si se quiere que «la chibi» sea un solo modelo
que cambia de pose, hará falta un campo que las agrupe. No lo propongo
todavía: depende de si las poses las elige el usuario, Shiro o el contexto.
Con `form`, dos poses de la chibi son dos candidatos de la misma forma.

## Dudas y cómo quedan

Criterio acordado con quien implementa el motor en el cliente:

- **`version`**: es la versión del formato. El esquema acepta solo las que
  conoce. Una versión del arte no hace falta ahora.
- **Emociones**: el núcleo tiene 5 y el diseño prevé 9 expresiones. El
  manifiesto puede mapear más emociones que las del núcleo; las que el núcleo
  no conoce no se usan, y una emoción sin mapa va a `idle`. Ampliar el núcleo
  es otra decisión (queda fuera del ADR 0028).
- **Contorno de luz**: el manifiesto solo dice si el modelo lo trae. En la
  app va apagado por defecto hasta que el autor decida, viéndolo con y sin.
- **Expresión `asleep`**: el ADR 0035 prevé que «dormida» sea la forma más
  ligera con cara de dormida. Cuando llegue ese paso hará falta una expresión
  `asleep` en el manifiesto de la chibi (ojos cerrados, brillo bajo). No está
  hecha.
