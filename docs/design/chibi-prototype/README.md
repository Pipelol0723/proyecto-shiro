# Prototipo de la chibi por capas

Banco de pruebas del avatar chibi de Shiro: una figura hecha con imágenes por
capas que habla, parpadea, cambia de expresión y mueve la mirada en un canvas
2D, sin dependencias. **No es el motor del cliente**: es el prototipo que
respalda el [ADR 0028](../../adr/0028-avatar-motores-y-manifiesto.md) y la
referencia de la que sale el motor definitivo, que se escribe en TypeScript
dentro de `packages/desktop`.

> **Nota de autoría.** El código de esta carpeta lo escribió Claude (el
> asistente de IA con el que se desarrolla el proyecto) durante el diseño del
> avatar. Las decisiones de diseño son del autor del proyecto; ver la
> [biblia](../shiro-character-bible.md) y el
> [diseño maestro](../shiro-design-master/README.md).

## Qué hay y qué no

| Ruta                                             | Contenido                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `scripts/`                                       | Proceso que convierte una ilustración de color plano en capas y piezas para el reproductor |
| `player/`                                        | Reproductor (`shiro-chibi.js`) y página de pruebas (`index.html`)                          |
| `poses/`                                         | Geometría de cada pose (dónde están ojos, cejas y boca)                                    |
| [`manifest-schema.md`](manifest-schema.md)       | Borrador del esquema de `avatar.manifest.json` (v0.2), campo a campo                       |
| [`expected-behaviors.md`](expected-behaviors.md) | Qué hace el motor ante cada entrada, con los casos límite                                  |
| `test-model/`                                    | Modelo sintético de prueba, los mismos casos en datos y un script que los comprueba        |

**No se incluyen las imágenes de Shiro**: ni las ilustraciones de origen ni
las capas generadas. Son recursos del modelo y, como dice el ADR 0028, no se
commitean. Sin ellas el reproductor no tiene nada de Shiro que mostrar; hay
que generarlas en local a partir de las ilustraciones.

Lo que sí va en el repo es el **modelo sintético** de `test-model/`: formas
de color generadas por código, sin arte del personaje, para que las pruebas
del motor no dependan de nada de fuera.

## Cómo funciona

1. **`scripts/pose_prep.py`** (solo para imágenes generadas): amplía la imagen
   a la escala de trabajo, acerca los colores a la paleta canónica y aplana el
   fondo.
2. **`scripts/chibi_layers.py`**: separa la figura del fondo, extrae las
   líneas de circuito a su propia capa y deja la cara en blanco.
3. **`scripts/chibi_pieces.py`**: genera las piezas de cara (ojos, cejas,
   bocas, rubor), las exporta a la resolución del reproductor y escribe
   `avatar.manifest.json` y una hoja de contacto.
4. **`player/`**: carga el manifiesto y dibuja. Expone los cinco verbos del
   ADR 0028: `setExpression`, `setMouthOpen`, `setBlink`, `setGlow` y
   `setLookAt`.

Las cejas de reposo son los píxeles de la ilustración de origen. Cada ojo se
separa en tres piezas —el blanco visible, el iris y las líneas— por cada
estado de párpado; los ojos entornados se obtienen recortando el ojo original
por una curva de párpado y dibujando la pestaña encima. Cejas de expresión,
bocas y rubor están dibujados por código y son **provisionales**.

**Mirada móvil.** El reproductor pinta el iris desplazado y recortado por el
blanco del ojo, así que el párpado lo tapa solo. `setLookAt(x, y)` va de −1 a
1; `setLookAt(null)` devuelve la mirada propia de cada expresión (`thinking`
mira a un lado, `soft` hacia abajo).

## Regenerar un modelo

Requisitos: Python 3.13 con `numpy`, `opencv-python-headless` y `scipy`, y
Node para servir la página.

```bash
# Capas a tamaño completo
python scripts/chibi_layers.py <ilustracion> work/layers [poses/<pose>.json]

# Piezas, manifiesto y hoja de contacto
python scripts/chibi_pieces.py <ilustracion> work/layers player \
  ../shiro-design-master/palette.json [poses/<pose>.json]

# Ver el resultado
node scripts/static-server.mjs player 5599
```

Sin el JSON de pose, los scripts usan la geometría de la primera pose (la
chibi sentada del borrador). `poses/de-pie.json` es la de la pose de pie, que
se generó con Gemini a partir del borrador y pasa antes por `pose_prep.py`
con factor `1.52`.

## Para implementar y probar el motor

- El formato del manifiesto está en [`manifest-schema.md`](manifest-schema.md),
  con las reglas que debe rechazar el esquema y una propuesta de cabecera de
  coste y capacidades para el cambio de modelo en caliente.
- El comportamiento está en [`expected-behaviors.md`](expected-behaviors.md):
  voz → boca, expresión y parpadeo → ojos, mirada → iris, brillo, orden de
  pintado y los casos del selector.
- `test-model/` trae el modelo sintético (`avatar.manifest.json` con todos los
  campos y `avatar.minimal.manifest.json` solo con los obligatorios), sus 29
  imágenes y `behavior-cases.json` con los casos en datos.

```bash
# Comprobar los casos contra el prototipo (sin navegador)
node test-model/check-cases.mjs

# Ver el modelo sintético en la página de pruebas
node scripts/static-server.mjs . 5599
# y abrir http://127.0.0.1:5599/player/index.html?model=../test-model/avatar.manifest.json

# Regenerar sus imágenes (requiere Pillow)
python test-model/make_test_model.py
```

## Límites conocidos

- La geometría de cada pose (elipses de los ojos, cajas de cejas y boca) está
  medida a ojo y vive en el JSON de la pose.
- El movimiento de la mirada es discreto: el iris casi llena el ojo de la
  chibi y el recorrido es de unos 15 × 7 píxeles.
- Cada pieza de cara ocupa la caja entera de la cara, así que un modelo
  cargado ronda los 50 MB de memoria.
- La paleta de las piezas dibujadas es la canónica; la de las ilustraciones
  de origen coincide en torno al 80 % de la figura (el resto son bordes
  suavizados y degradados).
- El prototipo no valida el manifiesto ni tiene selector de modelos; ver el
  último apartado de [`expected-behaviors.md`](expected-behaviors.md).
