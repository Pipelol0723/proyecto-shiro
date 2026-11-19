# Comportamientos esperados del motor de capas

Qué tiene que hacer el motor de capas del
[ADR 0028](../../adr/0028-avatar-motores-y-manifiesto.md) ante cada entrada,
con los casos límite. Sale del prototipo
([`player/shiro-chibi.js`](player/shiro-chibi.js)) y está pensado para
escribir los tests del port a TypeScript.

Los mismos casos están en datos en
[`test-model/behavior-cases.json`](test-model/behavior-cases.json), sobre el
modelo sintético de esa carpeta. `node test-model/check-cases.mjs` los
comprueba contra el prototipo (203 comprobaciones). Los valores de ejemplo de
este documento son los del modelo sintético: umbrales de boca
`[0.12, 0.34, 0.6]`, recorrido de mirada `[5, 3]` píxeles, parpadeo de
130 ms.

## 1. Nivel de voz → boca

Dos pasos: el audio se convierte en un número de 0 a 1, y ese número elige la
pieza.

**Audio → apertura** (`computeMouthOpen`, la misma fórmula que
`useLipSync.ts`): media cuadrática de los bytes del espectro, entre 255, por
una ganancia de 1,7, recortada a 0..1.

| Espectro   | Ganancia | Apertura |
| ---------- | -------- | -------- |
| vacío      | 1,7      | 0        |
| todo 0     | 1,7      | 0        |
| todo 75    | 1,7      | 0,5      |
| `[0, 150]` | 1,7      | 0,7071   |
| todo 255   | 1,7      | 1        |
| todo 51    | 1        | 0,2      |

El suavizado entre fotogramas (0,45 hacia el valor nuevo) es de quien entrega
el número, no del motor.

**Apertura → pieza** (`setMouthOpen`): se parte de la boca cerrada de la
expresión y se recorre la lista de umbrales; gana la última boca abierta cuyo
umbral se alcanza (`>=`).

| Apertura          | Pieza                                                          |
| ----------------- | -------------------------------------------------------------- |
| 0 … 0,1199        | la boca cerrada de la expresión (`mouth_idle`, `mouth_smirk`…) |
| 0,12 … 0,3399     | `mouth_open_s`                                                 |
| 0,34 … 0,5999     | `mouth_open_m`                                                 |
| 0,6 … 1           | `mouth_open_l`                                                 |
| mayor que 1       | se recorta a 1 → `mouth_open_l`                                |
| menor que 0       | se recorta a 0 → boca cerrada                                  |
| `NaN`, `Infinity` | **boca cerrada**: si el audio falla, no se queda abierta       |

Las bocas abiertas son comunes a todas las expresiones: al hablar, la forma
de la boca de la expresión se pierde; se conservan ojos, cejas y rubor. Con
la lista de umbrales vacía la boca no se abre nunca.

## 2. Expresión + parpadeo → ojos

El parpadeo es un número de 0 (abierto) a 1 (cerrado). Viene de `setBlink(v)`
si se ha fijado, y si no del temporizador automático.

| Parpadeo         | La expresión usa el ojo abierto (`idle`, `soft`) | La expresión ya entorna (`smirk`, `thinking`, `annoyed`) |
| ---------------- | ------------------------------------------------ | -------------------------------------------------------- |
| 0 … 0,3          | su estado (`eyes_open`)                          | su estado (`eyes_lid22`, `eyes_lid12`, `eyes_lid38t`)    |
| más de 0,3 … 0,7 | `eyes_half`                                      | **su estado**: un ojo ya entornado no pasa por el medio  |
| más de 0,7 … 1   | `eyes_closed`                                    | `eyes_closed`                                            |

- Los límites son estrictos: 0,3 justo sigue abierto y 0,7 justo sigue en el
  medio.
- `setBlink(v)` recorta a 0..1; `setBlink(null)` devuelve el mando al
  temporizador; un valor no finito se ignora.
- «Ojo abierto» es el estado que diga `face.blink.open` (por defecto
  `eyes_open`).

**Parpadeo automático.** Tras una espera al azar dentro de
`face.blink.interval_s`, el valor sube de 0 a 1 y vuelve a 0 en línea recta
durante `duration_ms`. Con 130 ms, y siendo `t` la fracción transcurrida:

| `t`         | Valor         | Estado en `idle`                       |
| ----------- | ------------- | -------------------------------------- |
| 0 … 0,15    | 0 … 0,3       | abierto                                |
| 0,15 … 0,35 | 0,3 … 0,7     | medio                                  |
| 0,35 … 0,65 | 0,7 … 1 … 0,7 | cerrado (≈ 39 ms)                      |
| 0,65 … 0,85 | 0,7 … 0,3     | medio                                  |
| 0,85 … 1    | 0,3 … 0       | abierto                                |
| 1 o más     | 0             | abierto; se sortea la siguiente espera |

A 60 fotogramas por segundo el ojo cerrado dura dos o tres fotogramas. Si un
fotograma llega tarde y se salta el parpadeo entero, no pasa nada: se sortea
el siguiente.

## 3. `setLookAt(x, y)` + expresión → desplazamiento del iris

La mirada tiene un **objetivo** y un **valor actual** que lo persigue.

**Objetivo:**

| Situación                                | Objetivo                                                                |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| Nunca se llamó a `setLookAt`             | el `gaze` de la expresión (`[0, 0]` si no trae)                         |
| `setLookAt(x, y)`                        | `[x, y]`, cada eje recortado a −1..1 por separado                       |
| `setLookAt(x)` sin `y`                   | `[x, 0]`                                                                |
| `setLookAt(null)`                        | vuelve a mandar el `gaze` de la expresión                               |
| `setLookAt` con una coordenada no finita | la llamada se ignora; el objetivo queda como estaba                     |
| Cambia la expresión con la mirada fijada | sigue mandando `setLookAt`                                              |
| Cambia la expresión sin mirada fijada    | el objetivo salta al `gaze` de la nueva; el valor lo sigue con suavidad |

`setLookAt(null)` y la `y` opcional **amplían** el ADR 0028, que solo define
`setLookAt(x, y)`. Los usa el prototipo y los necesita el traspaso de estado
entre modelos; la enmienda del ADR viaja con el código que los implemente.

**Valor actual:** se acerca al objetivo de forma exponencial, con una
constante de tiempo de 110 ms: en cada paso avanza
`1 − e^(−dt / 110)` de lo que falta. No depende de los fotogramas por
segundo (dos pasos de 55 ms dan lo mismo que uno de 110 ms).

| Tiempo desde el cambio | Recorrido hecho |
| ---------------------- | --------------- |
| 16 ms                  | 13,5 %          |
| 110 ms                 | 63,2 %          |
| 220 ms                 | 86,5 %          |
| 330 ms                 | 95,0 %          |
| 500 ms                 | 98,9 %          |

**Desplazamiento del iris**, en píxeles del modelo:
`(valor.x × max.x, −valor.y × max.y)`. El signo de `y` se invierte porque en
la mirada «arriba» es positivo y en la imagen es negativo.

| Expresión  | Llamada                    | Valor asentado | Desplazamiento (`max = [5, 3]`) |
| ---------- | -------------------------- | -------------- | ------------------------------- |
| `idle`     | —                          | `[0, 0]`       | `[0, 0]`                        |
| `idle`     | `setLookAt(1, 0)`          | `[1, 0]`       | `[5, 0]` derecha                |
| `idle`     | `setLookAt(-1, 0)`         | `[-1, 0]`      | `[-5, 0]` izquierda             |
| `idle`     | `setLookAt(0, 1)`          | `[0, 1]`       | `[0, -3]` arriba                |
| `idle`     | `setLookAt(0, -1)`         | `[0, -1]`      | `[0, 3]` abajo                  |
| `idle`     | `setLookAt(2, -3)`         | `[1, -1]`      | `[5, 3]`                        |
| `idle`     | `setLookAt(0.5)`           | `[0.5, 0]`     | `[2.5, 0]`                      |
| `thinking` | —                          | `[0.85, 0.35]` | `[4.25, -1.05]`                 |
| `soft`     | —                          | `[0, -0.4]`    | `[0, 1.2]`                      |
| `thinking` | `setLookAt(-1, 0)`         | `[-1, 0]`      | `[-5, 0]`                       |
| `thinking` | …y luego `setLookAt(null)` | `[0.85, 0.35]` | `[4.25, -1.05]`                 |

**Cómo se pinta el ojo:**

1. En un lienzo auxiliar del tamaño de la caja de la cara se pinta el blanco
   del estado de párpado.
2. Encima, el iris desplazado, **solo donde ya hay blanco** (`source-atop`):
   el párpado y el borde del ojo lo recortan solos.
3. Ese lienzo se pinta en la figura, y encima las líneas del estado.

Casos límite:

- **Ojo cerrado** (`white: null`): no se pinta ni blanco ni iris, solo las
  líneas. La mirada sigue avanzando por dentro, así que al abrir ya está donde
  toca.
- **Modelo sin `face.iris`**: se pinta el blanco tal cual y `setLookAt` no
  tiene efecto visible.
- **Sin `face.gaze`**: el recorrido es `[0, 0]`; el iris no se mueve.
- **Durante un fundido de expresión** se pintan dos caras, y las dos usan el
  mismo valor de mirada.
- El desplazamiento puede tener decimales; no se redondea.

## 4. Expresiones

| Entrada                                                     | Resultado                                                                                 |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Arranque                                                    | `idle`, sin fundido                                                                       |
| `setExpression("smirk")` desde `idle`                       | fundido de 140 ms: la cara anterior queda debajo, opaca, y la nueva entra encima de 0 a 1 |
| A los 70 ms                                                 | cara nueva al 50 %                                                                        |
| A los 140 ms o más                                          | solo la cara nueva                                                                        |
| `setExpression` con la que ya está                          | no hace nada; **no reinicia** el fundido ni el destello                                   |
| `setExpression("no-existe")`                                | va a `idle`                                                                               |
| `setExpression("toString")`, `"constructor"`, `"__proto__"` | va a `idle`: solo cuentan las claves propias de `expressions`, no las heredadas           |
| `setEmotion("divertida")`                                   | la expresión que diga `emotions` (`smirk`)                                                |
| `setEmotion` con una emoción desconocida, o sin `emotions`  | `idle`                                                                                    |
| `setEmotion("toString")`                                    | `idle`, por lo mismo                                                                      |

El rubor de cada cara se pinta con la opacidad de su expresión por la del
fundido; con opacidad 0 no se pinta.

Límite conocido del prototipo: si se cambia de expresión **a mitad de un
fundido**, la cara que estaba debajo desaparece de golpe. Con un fundido de
140 ms casi no se ve; el port puede dejarlo igual.

## 5. Brillo

`setGlow(v)` fija la intensidad (recortada a ≥ 0, sin tope superior);
`setGlow(null)` devuelve el mando a la expresión; un valor no finito se
ignora. Sin fijar, manda el patrón de la expresión:

| Patrón   | Intensidad                                          | Ejemplo                                                  |
| -------- | --------------------------------------------------- | -------------------------------------------------------- |
| `steady` | `level`                                             | `idle` → 1 siempre                                       |
| `pulse`  | `level × (1 + 0,2 × sen(2π × t / 2600 ms))`         | `thinking` (0,9): entre 0,72 y 1,08                      |
| `flash`  | `level × (1 + 0,6 × e^(−desde_que_entró / 260 ms))` | `smirk` (1): 1,6 al entrar, 1,22 a los 260 ms, 1 después |

Cómo se pinta: la capa de brillo con opacidad `min(1, intensidad)`. Si la
intensidad pasa de 1, una segunda pasada **sumada** (`lighter`) con opacidad
`min(1, intensidad − 1)`. Sin capa de brillo no se pinta nada.

Los dos patrones animados usan relojes distintos:

- **`pulse`**: `t` es el **reloj total del motor**, la suma de todos los
  pasos de `update` desde que se creó. No se reinicia al cambiar de
  expresión: al entrar en `thinking` el pulso sigue por donde iba, sin
  salto de fase entre dos expresiones que pulsen.
- **`flash`**: `desde_que_entró` es el tiempo desde el último cambio de
  expresión. Repetir la misma expresión no lo reinicia.

## 6. Orden de pintado

De abajo arriba:

1. Contorno de luz (solo si está encendido y el modelo lo trae).
2. Base.
3. Cara anterior, opaca (solo durante un fundido).
4. Cara actual: ojos (blanco + iris, luego líneas) → boca → rubor → cejas.
5. Brillo.

La figura se ajusta a la caja que se le da conservando la proporción,
centrada en horizontal y **apoyada en el borde inferior**. Respira: se estira
en vertical un 0,4 % desde la base, con un periodo de 4,2 s. Si el sistema
pide reducir el movimiento, el port debería apagar la respiración y el pulso
del brillo.

## 7. Carga y selector

La carga del modelo y el selector de candidatos son del ADR 0028 §3. El
prototipo solo tiene la carga; el selector es nuevo en el cliente. Lo que
debería cumplirse:

| Caso                                                    | Resultado                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------ |
| El primer candidato está disponible                     | se monta ese; no se prueba el resto                          |
| Mientras se comprueba un candidato                      | se ve el orbe                                                |
| El manifiesto no existe (404) o no es JSON              | se pasa al siguiente candidato                               |
| El manifiesto no cumple el esquema                      | se pasa al siguiente                                         |
| El `kind` del manifiesto no es el del candidato         | se pasa al siguiente                                         |
| El `kind` del candidato no lo conoce el cliente         | se pasa al siguiente                                         |
| Falta **una** imagen del modelo                         | el modelo entero no vale: se pasa al siguiente               |
| La comprobación no responde en el tiempo límite (≈ 4 s) | se pasa al siguiente; si la respuesta llega tarde, se ignora |
| Fallan todos                                            | orbe                                                         |
| Lista vacía                                             | orbe                                                         |
| El motor falla al pintar después de montado             | se desmonta y se pasa al siguiente (al final, orbe)          |
| El componente se desmonta a mitad de una comprobación   | no se monta nada y no queda nada colgando                    |
| Un candidato de capas disponible y Live2D no instalado  | sale el de capas                                             |

El orbe es siempre el último candidato y nunca falla. El cambio de modelo con
la app en marcha queda fuera del ADR 0028; ver el ADR 0035 y el final de
[`manifest-schema.md`](manifest-schema.md).

## 8. Paso de tiempo y `dispose()`

| Entrada                                          | Resultado                                                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `update(dt)` con `dt` finito y ≥ 0               | avanzan el reloj total, el fundido, la mirada y el parpadeo                                                   |
| `update(0)`                                      | no cambia nada                                                                                                |
| `update(NaN)`, `update(Infinity)`, `update(-50)` | **se ignora**: si entrara, la mirada y los relojes quedarían en `NaN` y ningún paso posterior los recuperaría |
| `dispose()`                                      | suelta las imágenes y el lienzo auxiliar; desde entonces `draw` no pinta nada                                 |
| Un verbo o `update` después de `dispose()`       | no falla y no tiene efecto visible                                                                            |

El motor no tiene temporizadores propios: el parpadeo y los fundidos
avanzan solo con `update`. **El bucle de animación es de quien usa el
motor**, y le toca cancelarlo a la vez que llama a `dispose()`.

## 9. Lo que el prototipo no cubre

Para que no se dé por probado lo que no lo está:

- **No valida el manifiesto.** Los casos de manifiestos inválidos de
  `behavior-cases.json` son la especificación del esquema, no algo que el
  prototipo compruebe. `check-cases.mjs` solo mira que cada caso esté bien
  escrito (que cambie algo del manifiesto de partida).
- **Carga todas las capas de `layers`**, también las que no conoce; el
  esquema pide ignorarlas (ver [`manifest-schema.md`](manifest-schema.md)).
- **No tiene selector** ni tiempo límite.
- **No mira `prefers-reduced-motion`** ni la densidad de píxeles de la
  pantalla (eso lo hace la página de pruebas, no el motor).
- La página de pruebas limita cada paso a 100 ms cuando la pestaña vuelve de
  estar oculta; el motor en sí acepta cualquier paso finito y no negativo.
- Comprobado a mano en el navegador con las dos poses de la chibi y con el
  modelo sintético; sin tests automáticos más allá de `check-cases.mjs`.
