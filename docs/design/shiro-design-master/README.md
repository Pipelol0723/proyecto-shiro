# Shiro — Diseño maestro

**Versión:** 0.3 · **Fecha:** 11 de noviembre de 2026 · **Estado:**
**aprobado por Pipe**.

> **Nota de autoría.** Este diseño maestro lo redactó **Claude** (el asistente
> de IA con el que se desarrolla el proyecto) **como documento de trabajo para
> sí mismo**: una referencia compacta y legible por máquina para que sus
> sesiones futuras produzcan arte y código de Shiro coherentes entre sí, sin
> volver a deducir las reglas cada vez. Las decisiones que recoge son de Pipe;
> las propuestas de Claude están marcadas como tales (columna "Origen", valor
> **C**). No es arte ni una lámina de personaje: las guías SVG son esquemas.

Este documento reúne lo que ya está decidido sobre el aspecto de Shiro, para
que la chibi, el 3D y el 2D salgan de la misma fuente. La biblia
([`../shiro-character-bible.md`](../shiro-character-bible.md)) recoge las
mismas decisiones en prosa y es la referencia para las personas; este
documento y sus archivos de datos son la versión de trabajo.

Archivos que lo acompañan, en esta misma carpeta:

| Archivo                  | Qué es                                             |
| ------------------------ | -------------------------------------------------- |
| `palette.json`           | Los colores, con nombre, hex y uso                 |
| `expressions.json`       | Las nueve expresiones, definidas por rasgos        |
| `proportions-guide.svg`  | Regla de cabezas de la Shiro normal y de la chibi  |
| `circuit-vocabulary.svg` | Los elementos permitidos en las líneas de circuito |

---

## 1. Quién es, en una línea

Una compañera **adulta joven (18–20 años)**, serena y de pocas palabras, con
un ingenio seco que asoma cuando hay confianza. Su estética es su nombre:
**blanco que brilla en la oscuridad**.

## 2. Las tres ideas que no se negocian

| Idea                   | Cómo se ve                                         | Qué la rompe                                    |
| ---------------------- | -------------------------------------------------- | ----------------------------------------------- |
| Blanco que brilla (白) | Ribetes, pañuelo, aro y líneas son lo más luminoso | Otro color de acento; brillo de color           |
| Contención             | Emoción en cejas, párpados, comisuras y rubor      | Bocas grandes, gestos amplios, poses expansivas |
| IA que escucha         | Auriculares siempre puestos; líneas que reaccionan | Quitar los auriculares; líneas de adorno fijo   |

Orden de lectura de la imagen: **pelo azul claro → aro y ribetes blancos →
líneas de circuito**.

## 3. Rasgos

"Núcleo" = sin esto deja de ser Shiro. Quién lo decidió: **P** = Pipe;
**B** = viene del borrador o del brief; **C** = propuesta de Claude aceptada
como base de trabajo.

### 3.1. Cabeza

| Rasgo          | Definición                                                                                                                                                                         | Núcleo | Origen |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------ |
| Cara           | La de `shiro proto2`: redonda, ojos grandes y abiertos, serena                                                                                                                     | Sí     | P      |
| Pelo           | Azul claro, corto, a capas con puntas hacia fuera; flequillo que cae entre los ojos; mechones laterales hasta la mandíbula; degradado a azul medio en las puntas; brillos en rombo | Sí     | B      |
| Ahoge          | Un rizo fino que nace en la coronilla, detrás de la diadema, y asoma por encima                                                                                                    | Sí     | B      |
| Ojos           | Azules, sin heterocromía. Iris en dos tonos (azul medio arriba, celeste abajo), dos brillos blancos, pestaña superior gruesa con colita exterior                                   | Sí     | B      |
| Cejas          | Finas, del color del pelo, **siempre visibles por encima del flequillo**                                                                                                           | Sí     | C      |
| Boca de reposo | Recta y relajada. La comisura hacia abajo es de `annoyed`                                                                                                                          | —      | C      |
| Auriculares    | Diadema oscura, pieza metálica gris en la unión, copa oscura con **aro blanco fino** y centro oscuro. Las dos copas existen aunque el pelo tape una                                | Sí     | B, C   |

### 3.2. Cuerpo

| Rasgo      | Definición                                                   | Origen |
| ---------- | ------------------------------------------------------------ | ------ |
| Edad       | Adulta joven, 18–20 años                                     | P      |
| Proporción | ≈6,3 cabezas, como el turnaround                             | B      |
| Complexión | Natural, la del turnaround, **sin exagerar** busto ni cadera | P      |
| Piel       | Pálida y cálida                                              | B      |

### 3.3. Vestuario

| Pieza         | Definición                                                                                                                                                   | Origen |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| Blusa         | Marinera, azul muy oscuro, manga larga                                                                                                                       | B      |
| Cuello        | Marinero, cuadrado por detrás, **un** ribete blanco; pechera interior con ribete                                                                             | B, C   |
| Pañuelo       | Blanco, anudado, nudo redondeado, dos puntas largas                                                                                                          | B, C   |
| Puños         | **Un** ribete blanco                                                                                                                                         | C      |
| Falda         | Plisada, oscura, ribete blanco en el bajo. **Largo: por decidir** entre el del borrador y algo más larga; se decide con el modelo 3D, donde es un deslizador | P      |
| Bajo la falda | Sin pantalón corto                                                                                                                                           | P      |
| Medias        | Altas, oscuras, con **una** banda blanca arriba                                                                                                              | B      |
| Zapatos       | Mocasín negro con suela blanca                                                                                                                               | B, C   |

### 3.4. Líneas de circuito

| Regla       | Definición                                                                                                     | Origen |
| ----------- | -------------------------------------------------------------------------------------------------------------- | ------ |
| Color       | Blanco puro, con halo frío                                                                                     | B      |
| Dónde       | Mangas, costados del torso, costados de la falda, medias                                                       | B      |
| Vocabulario | Línea simple, línea doble, quiebro a 45°, fila de tres cuadrados, fila de puntos. Ver `circuit-vocabulary.svg` | C      |
| Marcas      | **Solo cuadrados**, en filas de tres. Los triángulos desaparecen                                               | P      |
| Simetría    | Los dos lados se corresponden; cualquier asimetría es deliberada                                               | C      |
| Técnica     | Siempre en una **capa o máscara independiente**, nunca pintadas en la ropa                                     | C      |
| Reactividad | Su intensidad acompaña a la emoción (`expressions.json`)                                                       | C      |
| Densidad    | A menor tamaño en pantalla, menos líneas. La chibi usa la versión simplificada del borrador                    | C      |

### 3.5. Silueta sobre fondos oscuros

El uniforme tiene un contraste de ≈1,2:1 contra el fondo de la app. **Por
decidir:** contorno de luz fino del color del halo, o solo líneas y ribetes.
Se decide comparando las dos versiones en la chibi (P). La paleta no se toca
en ningún caso.

### 3.6. Sombreado

| Formato | Sombreado                                        | Origen |
| ------- | ------------------------------------------------ | ------ |
| Chibi   | Plano, como el borrador                          | C      |
| 3D      | Dos tonos, con los colores "sombra" de la paleta | C      |

## 4. Tono y contenido

Decidido por Pipe el 11 de noviembre de 2026.

| Punto       | Regla                                                                                                                                                                                         |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NSFW        | **No está planeado ahora:** hoy no hay desnudo ni nada explícito en ningún formato. **No se descarta añadirlo en el futuro**; si llega, será una decisión aparte de Pipe                      |
| Fan service | **Leve:** el que ya trae el diseño (falda, medias altas, físicas naturales, cámara libre). No se añaden atuendos ni poses pensados para ello                                                  |
| Encuadre    | Por defecto, cara y medio cuerpo. **La cámara no se bloquea ni se limita**                                                                                                                    |
| Poses       | Relajadas y algo recogidas. Shiro no adopta poses sugerentes por defecto                                                                                                                      |
| Cuerpo      | Natural. Las físicas del busto existen porque está "viva", pero son discretas y secundarias; se ajustan con el modelo 3D delante                                                              |
| Expresiones | El rubor es timidez. Ninguna cara sugerente                                                                                                                                                   |
| Interacción | Si reacciona al clic, lo hace **como ella**: con cabeza, hombro o mano, cercanía según la confianza; en otras zonas, molestia o vergüenza con un comentario seco. Función aún sin implementar |

Lo que Claude no produce en ningún caso: contenido sexual explícito, ni nada
que haga parecer a Shiro más joven de lo que es.

## 5. Expresiones

Definidas por rasgos en `expressions.json`. Resumen:

| Expresión  | Emoción en el código | Lectura                                  |
| ---------- | -------------------- | ---------------------------------------- |
| `idle`     | `neutral`            | Calma                                    |
| `smirk`    | `divertida`          | Media sonrisa, una ceja apenas arriba    |
| `thinking` | `pensativa`          | Mirada desviada, cejas levemente juntas  |
| `annoyed`  | `molesta`            | Mohín, no furia                          |
| `soft`     | `vulnerable`         | Cejas arriba y hacia dentro, rubor suave |
| `surprise` | — (propuesta)        | Ojos muy abiertos                        |
| `happy`    | — (propuesta)        | Sonrisa contenida                        |
| `shy`      | — (propuesta)        | Mira a un lado, rubor fuerte             |
| `sleepy`   | — (propuesta)        | Párpados caídos                          |

**Regla de oro: Shiro subexpresa.** Y una regla técnica: ninguna expresión
toca la apertura de la boca ni el parpadeo.

## 6. Formatos

| Formato | Papel                                                    | Proporción                                                        | Estado                                     |
| ------- | -------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------ |
| Chibi   | Secundaria: equipos modestos, modo ahorro, modo flotante | La de las chibis del borrador (cabeza ≈43 % de la figura sentada) | Prototipo en curso                         |
| 3D      | Objetivo final                                           | ≈6,3 cabezas                                                      | Maqueta, después de la chibi               |
| 2D      | Gama media                                               | ≈6,3 cabezas, de busto                                            | Aparcado hasta tener ilustración por capas |

Los tres tienen que reconocerse como la misma Shiro sin ser copias
geométricas. Qué se conserva siempre: paleta, pelo y ahoge, aro de los
auriculares, cuello y pañuelo, líneas con cuadrados.

## 7. Qué no hacer

- Cambiar el diseño entre vistas o formatos (mechones, pañuelo, líneas).
- Expresiones exageradas o bocas abiertas como parte de una emoción.
- Colores fuera de `palette.json`.
- Líneas de circuito pintadas en la ropa en vez de en su capa.
- Usar la pose de `shiro proto1` como pose por defecto.
- Llamar "final" a un prototipo.

## 8. Lo que queda por decidir

| Qué                                       | Cuándo se decide                | Cómo                                    |
| ----------------------------------------- | ------------------------------- | --------------------------------------- |
| Largo de la falda                         | Con la maqueta 3D               | Dos valores del deslizador, lado a lado |
| Contorno de luz                           | Con la chibi                    | Con y sin contorno, lado a lado         |
| Físicas del busto                         | Con la maqueta 3D               | Ajuste a ojo                            |
| Ampliar las emociones del código de 5 a 9 | Tras validar el prototipo       | Decisión de arquitectura aparte         |
| Trazado exacto de las líneas por prenda   | Al preparar las texturas del 3D | Mapa en SVG                             |

## 9. Relación con la biblia del repo

La biblia se actualizó a **v0.2** el 11 de noviembre de 2026 con estas mismas
decisiones. Lo que cambió en ella respecto a la v0.1:

| Punto               | Biblia v0.1                   | Biblia v0.2 y diseño maestro                                             |
| ------------------- | ----------------------------- | ------------------------------------------------------------------------ |
| Edad                | "Adolescente"                 | **Adulta joven, 18–20 años**                                             |
| Cuello              | "Lazo/corbata"                | Pañuelo marinero anudado                                                 |
| Falda               | "Líneas de pliegue luminosas" | Pliegues en línea oscura; lo luminoso es el ribete y el circuito lateral |
| Ojos                | Heterocromía aún abierta      | Azules, sin heterocromía                                                 |
| Ahoge y auriculares | Convivencia aún abierta       | Conviven                                                                 |
| Objetivo            | Solo VRM                      | Tres formatos                                                            |
| Tono                | Sin definir                   | §4 de este documento                                                     |

Si las dos vuelven a diferir, se corrige la que esté desfasada; no se deja
la contradicción.

## 10. Historial

| Versión | Fecha      | Cambio                                                                                  |
| ------- | ---------- | --------------------------------------------------------------------------------------- |
| 0.1     | 2026-11-11 | Primera versión, con las decisiones de Pipe del 9 al 11 de noviembre                    |
| 0.2     | 2026-11-11 | Aprobado por Pipe. La biblia del repo pasa a v0.2 con las mismas decisiones             |
| 0.3     | 2026-11-11 | Entra en el repo con nota de autoría. NSFW: no planeado ahora, sin descartarlo a futuro |
