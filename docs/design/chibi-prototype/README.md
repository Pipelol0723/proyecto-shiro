# Prototipo de la chibi por capas

Banco de pruebas del avatar chibi de Shiro: una figura hecha con imágenes por
capas que habla, parpadea y cambia de expresión en un canvas 2D, sin
dependencias. **No está integrado en el cliente**: es el prototipo que
respalda el [ADR 0028](../../adr/0028-avatar-motores-y-manifiesto.md), y el
motor definitivo se escribirá en TypeScript dentro de `packages/desktop`
cuando se haga la integración.

> **Nota de autoría.** El código de esta carpeta lo escribió Claude (el
> asistente de IA con el que se desarrolla el proyecto) durante el diseño del
> avatar. Las decisiones de diseño son del autor del proyecto; ver la
> [biblia](../shiro-character-bible.md) y el
> [diseño maestro](../shiro-design-master/README.md).

## Qué hay y qué no

| Carpeta    | Contenido                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------ |
| `scripts/` | Proceso que convierte una ilustración de color plano en capas y piezas para el reproductor |
| `player/`  | Reproductor (`shiro-chibi.js`) y página de pruebas (`index.html`)                          |
| `poses/`   | Geometría de cada pose (dónde están ojos, cejas y boca)                                    |

**No se incluyen las imágenes**: ni las ilustraciones de origen ni las capas
generadas. Son recursos del modelo y, como dice el ADR 0028, no se commitean.
Sin ellas el reproductor no tiene nada que mostrar; hay que generarlas en
local a partir de las ilustraciones.

## Cómo funciona

1. **`scripts/pose_prep.py`** (solo para imágenes generadas): amplía la imagen
   a la escala de trabajo, acerca los colores a la paleta canónica y aplana el
   fondo.
2. **`scripts/chibi_layers.py`**: separa la figura del fondo, extrae las
   líneas de circuito a su propia capa y deja la cara en blanco.
3. **`scripts/chibi_pieces.py`**: genera las piezas de cara (ojos entornados y
   cerrados, cejas, bocas, rubor), las exporta a la resolución del reproductor
   y escribe `avatar.manifest.json` y una hoja de contacto.
4. **`player/`**: carga el manifiesto y dibuja. Expone los cinco verbos del
   ADR 0028: `setExpression`, `setMouthOpen`, `setBlink`, `setGlow` y
   `setLookAt`.

Los ojos abiertos y las cejas de reposo son los píxeles de la ilustración de
origen. Los ojos entornados se obtienen recortando el ojo original por una
curva de párpado y dibujando la pestaña encima. Cejas de expresión, bocas y
rubor están dibujados por código y son **provisionales**.

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

## Límites conocidos

- La geometría de cada pose (elipses de los ojos, cajas de cejas y boca) está
  medida a ojo y vive en el JSON de la pose.
- No hay mirada móvil: `thinking` se distingue poco de `idle`.
- La paleta de las piezas dibujadas es la canónica; la de las ilustraciones
  de origen coincide en torno al 80 % de la figura (el resto son bordes
  suavizados y degradados).
