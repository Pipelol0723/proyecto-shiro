# Propuesta: rediseño visual del cliente de escritorio

> **Estado** (2026-11-13): propuesta de diseño, **sin implementar**. No es una
> decisión de arquitectura ni un encargo: ningún ítem `P-xx` se ejecuta sin
> que el dueño apruebe su fase ([plan de mejora](../plan-mejora-2026-11.md)).
> Lo que pide un ADR está marcado en el §9.
>
> **Nota de autoría.** Lo redactó Claude (el asistente de IA con el que se
> desarrolla el proyecto) a partir de una revisión de la app en marcha y de
> las respuestas de Pipe a tres tandas de preguntas. Las decisiones del §1 son
> de Pipe; el resto son propuestas. Las maquetas (18 tableros) viven en un
> lienzo de diseño fuera del repo.

## 1. Decisiones de Pipe

| Tema                | Decisión                                                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Temas               | **Un solo tema, «Shiro»**. Se retiran Kawaii, Cyberpunk y Editorial                                                               |
| Pantalla principal  | **Escenario + hilo**: Shiro a la izquierda, la conversación en una columna a la derecha, plegable                                 |
| Navegación          | **Tres destinos**: Conversación, Shiro y Sistema, con un chip de estado siempre visible                                           |
| Detalle técnico     | **Dos modos**, limpio y dev, alternables y bien integrados; el modo dev enseña todas las cifras que pueda                         |
| Escenario sin Shiro | **Orbe con el canon**: blanco luminoso; la emoción cambia la intensidad y, **al hablar, el blanco se funde con el azul del pelo** |
| Tono de los textos  | **Todo en voz de Shiro**, también ajustes y avisos de seguridad (con la salvedad del §7)                                          |
| Público             | **Solo Pipe**: comandos, rutas y nombres de módulos a la vista                                                                    |
| A maquetar          | Memoria, manos libres, primer arranque, historial de acciones y **modo overlay** (§10)                                            |

## 2. Lo que hay hoy

Revisado con el cliente y el `core-host` en marcha, sin claves ni servicios.

- **Ningún tema es Shiro.** Cyberpunk usa neón cian y magenta, justo lo que
  el [diseño maestro](shiro-design-master/README.md) prohíbe («otro color de
  acento; brillo de color»). La paleta canónica y el motivo de cuadrados no
  aparecen en la interfaz.
- **El error del turno va disfrazado de respuesta**: sale como un mensaje de
  Shiro, con etiquetas de modelo y latencia, se lee en voz alta y no dice la
  causa (lo aborda P-12).
- **No hay estado del sistema a la vista**: con todo caído, Conversación se
  ve igual que con todo bien (P-16b).
- **Módulos y Personaje son maquetas con datos fijos**, y Avatar repite el de
  Conversación (R-305).
- **Setup es una lista de fallos sin jerarquía**: no dice qué es
  imprescindible, sus comandos dan por hecho un clon del repo (R-306) y lista
  cinco atajos de teclado de los que solo existe uno.
- **Cuatro avisos flotantes sin sistema** (conexión, self-dev, actualización
  y modal): el de conexión tapa el campo de escritura.
- **Jerga de desarrollo como texto** y mezcla de voseo y tuteo.
- Pendientes ya anotados que el rediseño absorbe: contraste (R-286), foco y
  movimiento (R-302), scroll del hilo (R-303), borrador y tema que no se
  guardan (R-304), errores del micro en crudo (R-288), guardado de claves
  (R-307) y primer arranque sin guía (R-284).

## 3. Navegación

Barra lateral con tres destinos y un sitio reservado para el overlay.

| Destino          | Contiene                                                 | Sustituye a        |
| ---------------- | -------------------------------------------------------- | ------------------ |
| **Conversación** | Escenario, hilo y actividad                              | Conversación       |
| **Shiro**        | Voz y oído · Memoria · Aspecto; su ficha, en la cabecera | Personaje y Avatar |
| **Sistema**      | Estado · Claves · Acciones · Módulos y ajustes           | Setup y Módulos    |

La cabecera de todas las pantallas lleva dos controles fijos:

- **Chip de estado** (P-16b). Resume por **capacidad**, no por servicio:
  pensar, oír, hablar y recordar. Cuatro cuadrados y una frase («Todo en
  orden», «No te oigo», «Sin copia reciente»). Al pulsarlo abre Sistema.
- **Selector Limpio / Dev** (§5), con atajo de teclado; la elección se guarda.

El selector de tema desaparece. Los atajos se listan en Sistema y **solo los
que existen**.

## 4. Pantallas y estados

### 4.1. Conversación

Escenario a la izquierda (orbe, estado en una línea, subtítulo y campo de
escritura) e hilo a la derecha. El hilo es parte principal: horas,
separadores de día, desplazamiento al último mensaje, aviso de mensajes
nuevos, copiar y «repetir en voz». Las acciones de herramientas quedan
anotadas en el hilo como filas propias.

| Estado          | Qué se ve                                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------------------------- |
| Arrancando      | Orbe tenue, tres cuadrados en secuencia y qué partes van despertando; campo deshabilitado                       |
| Vacío           | «Aún no hemos hablado. Empieza tú.»                                                                             |
| Te escucho      | Botón del micro en blanco, medidor de nivel y transcripción en vivo                                             |
| Manos libres    | «Micro abierto» siempre visible, medidor y un botón grande para pausar el micro                                 |
| Pensando        | Pulso lento; «Detener» ocupa el sitio de «Enviar»                                                               |
| Hablando        | El subtítulo en el escenario y el mensaje marcado en el hilo; «Detener» corta la voz                            |
| Sin oído        | Micro con borde discontinuo y tachado; «No te oigo. Whisper está apagado.», con enlace a Sistema                |
| Sin conexión    | Aviso **dentro** del escenario, sin tapar nada; orbe apagado; campo y micro deshabilitados                      |
| Error del turno | Fila propia en el hilo, no un mensaje de Shiro: causa real, «Revisar la clave» y «Reintentar». No se lee en voz |
| Voz cortada     | Fila de aviso bajo el mensaje afectado, con «Repetir en voz»                                                    |

### 4.2. Shiro

- **Cabecera**: nombre, rasgos y el archivo del personaje cargado, leídos del
  servidor (no copiados a mano).
- **Voz y oído**: la cadena de voces en orden con cuál está en uso
  ([ADR 0034](../adr/0034-tts-gemini-voz-disenada.md)); la **caducidad de la
  voz** con su fecha y cuenta atrás; volumen y silencio; modo de entrada
  (pulsar para hablar o manos libres, con sensibilidad y tiempo de silencio);
  micrófono y prueba de nivel; palabra de activación, marcada como aplazada.
- **Memoria**: cuántos recuerdos hay, dónde están, estado de la copia,
  búsqueda, olvidar un recuerdo con confirmación en la propia fila y
  «olvidarlo todo» separado y en color de error.
- **Aspecto**: vista previa, prueba de expresiones, tabla emoción → expresión
  → brillo (los valores de `expressions.json`) y la lista de motores del
  [ADR 0028](../adr/0028-avatar-motores-y-manifiesto.md) con su estado real:
  hoy solo el orbe está en uso; los demás figuran como «no existe»,
  «aparcado» o «aplazado».

### 4.3. Sistema

- **Estado**: arriba, una frase y cuatro casillas por capacidad («Puedo pensar
  y hablar. No te oigo…»). Debajo, la tabla de servicios con estado, detalle
  (modelo cargado, puerto, GPU o CPU) y el comando para levantarlo, con botón
  de copiar. Distingue **listo, a medias, caído y sin datos** (P-12).
- **Claves**: tres (Anthropic, Gemini y ElevenLabs), cada una con su estado:
  sin clave, guardada sin aplicar, válida, sin cuota o rechazada. Guardar no
  borra el campo hasta el acuse, y el reinicio se ofrece como botón (R-307).
  Incluye «qué sale de este equipo» (P-20) y dónde se guardan, sin prometer
  un cifrado que no existe.
- **Acciones**: historial de lo que Shiro hizo con sus herramientas y de lo
  que se canceló o caducó, con detalle por fila y las sesiones de self-dev.
- **Módulos y ajustes**: la configuración real en solo lectura, atajos,
  arranque con el sistema y reducir movimiento.

### 4.4. Primer arranque

Una sola pantalla, no un asistente por pasos. Separa **lo imprescindible**
(con qué pensar: modelo local o clave de la nube; basta uno) de **lo que
puede esperar** (oído, voz, memoria). «Entrar» se habilita al cumplir el
mínimo; siempre se puede entrar sin él. Distingue «Ollama responde, pero
falta el modelo» de «Ollama no responde».

### 4.5. Permiso de herramientas (P-27)

- Campos estructurados: acción, **ruta completa**, tamaño, comando exacto,
  carpeta y límite de tiempo.
- **Contenido completo con scroll**; si el archivo existe, las diferencias
  con `+` y `−` (no solo color).
- **«Antes leí»**: las lecturas previas del turno, o el aviso de que no leyó
  el archivo que va a tocar.
- Cola («1 de 2») y **cuenta atrás** de la caducidad; al caducar se cierra.
- El riesgo se lee en tres sitios: etiqueta, forma del cuadrado y qué botón
  es el principal. En **borrar**, el principal es «Cancelar».
- Se mantiene lo que ya funciona: foco inicial en Cancelar, `Esc` cancela y
  la pausa de medio segundo para Espacio y Enter.

### 4.6. Avisos

Una sola zona de actividad, **acoplada al pie del hilo**, sustituye a los
tres flotantes: sesión de self-dev con sus cinco pasos, actualización y copia
atrasada (P-11a). Cada aviso tiene una acción. La conexión no es un aviso:
vive en el escenario y en el chip.

## 5. Modo dev

El mismo diseño con una capa más; no es otra pantalla. Al activarlo:

- el chip se despliega por servicio;
- el escenario muestra un panel con estado, emoción, expresión, brillo,
  amplitud, motor del avatar y cuadros por segundo;
- bajo el subtítulo aparece la **latencia del turno por etapa**;
- cada mensaje lleva sus etiquetas y el hilo se divide para mostrar el
  registro de eventos del bus.

| Dato                                      | Hoy                                   | Qué falta                            |
| ----------------------------------------- | ------------------------------------- | ------------------------------------ |
| Ruta local o nube, emoción                | Sí (`router:routed`, `llm:responded`) | —                                    |
| Latencia total                            | Sí, sin la voz                        | Incluir la voz (P-16)                |
| Latencia por etapa y primer audio         | No                                    | P-16                                 |
| Modelo, tokens y rondas de herramientas   | No                                    | Campos nuevos en `llm:responded`     |
| Tiempo de transcripción, GPU o CPU        | No                                    | P-12 y un campo en los eventos `stt` |
| Eslabón de la cadena de voz               | No                                    | Campo en `tts:audio` (con ADR 0034)  |
| Registro de eventos del bus               | No                                    | Solo cliente: escuchar el transporte |
| Estado, expresión, brillo, cuadros, motor | Parcial, en el cliente                | Solo cliente                         |
| Identificador del turno                   | No                                    | ADR de turnos (posterior al plan)    |

## 6. Sistema visual

Idea: **la interfaz es su uniforme**. Fondo azul casi negro, ribetes blancos
finos y el vocabulario de las líneas de circuito.

- **Color.** Todo sale de [`palette.json`](shiro-design-master/palette.json).
  Fondo `#0E1117`; paneles `#131824` y `#1B2233`; campos `#10141F`. El
  **blanco** es el único acento (botón principal, elemento activo, orbe);
  solo brillan él y, cuando Shiro habla, el azul de su pelo. El uniforme
  `#1B2233` apenas contrasta con el fondo (≈1,2:1): toda superficie en ese
  tono lleva línea o ribete. El **azul del pelo** `#BBE2F2` es el segundo foco:
  foco de teclado, «listo», texto de código. Aviso: **piel sombra**
  `#E7C3AE`. Error: **rubor** `#F4A9B0`; a Shiro le da apuro fallar. Dos
  tonos derivados, no canónicos: línea `#2B3550` y texto secundario
  (`#B6C1D2`, `#8C97AB`).
- **Tipografía.** Chakra Petch para títulos y etiquetas (sus esquinas a 45°
  repiten el quiebro del circuito), Manrope para el texto (ya está en el
  cliente) y JetBrains Mono para datos (también). Salen tres familias y entra
  una.
- **Forma.** Radios de 2, 4 y 6 px; **sin píldoras**. Espaciado en base 4.
  **Un ribete blanco por pieza**, como en el cuello y los puños.
- **Motivo.** Solo el vocabulario cerrado: línea, línea doble, quiebro a 45°,
  **fila de tres cuadrados** y fila de puntos. Los tres cuadrados son la
  marca, el indicador de «en curso» y la base de los estados. Sin triángulos.
- **Estados.** Cuadrado lleno (listo), medio (a medias), hueco (caído) y de
  trazo fino (sin datos): se distinguen por forma, no solo por color.
- **Orbe.** Un núcleo blanco con halo frío y un aro fino, el de sus
  auriculares, que siempre es blanco. La emoción es **intensidad y pulso**,
  con los valores de `expressions.json`. **Al hablar, el núcleo se funde con
  el azul del pelo** (`#BBE2F2`, con `#7FBEDD` hacia el borde): la mezcla
  sigue al volumen de la voz, el mismo valor que mueve la boca del avatar, y
  en silencio vuelve al blanco. Es una decisión de Pipe que matiza la regla
  del diseño maestro sobre el brillo de color: el azul es de la paleta y el
  aro no cambia. El orbe queda como respaldo cuando exista el avatar.
- **Movimiento.** Poco y lento; nada rebota. Transiciones cortas, del orden
  de 140 ms, como en el prototipo del avatar. Con `prefers-reduced-motion`,
  ninguno.
- **Accesibilidad.** Texto a 5:1 o más sobre los paneles; foco visible de
  2 px en el azul del pelo; controles reales con nombre accesible; el hilo se
  anuncia a lectores de pantalla.

## 7. La voz de la interfaz

Todos los textos los dice Shiro: tuteo, frases cortas, primera persona, sin
exclamaciones ni emojis. Nombra la causa y el siguiente paso («Claude no
acepta la clave. Revísala.»). Cuatro reglas para que el personaje no reste
precisión donde hace falta:

1. **Los datos no se parafrasean**: rutas, comandos, tamaños y códigos de
   error van literales y en monoespaciada.
2. **En un permiso no hay ironía** ni se quita importancia al riesgo.
3. Las etiquetas de un solo nombre («Ruta», «Claves») son neutras; la voz
   está en las frases.
4. Los términos internos («core-host», «WAL») salen de los textos; en modo
   dev pueden aparecer como dato.

## 8. Lo que falta, con prioridad

**A** = sin esto el rediseño no cumple · **B** = lo completa · **C** = después.

| Pri. | Qué                                                             | Depende de                                              |
| ---- | --------------------------------------------------------------- | ------------------------------------------------------- |
| A    | Tema único y componentes del §6                                 | Enmienda de ADR 0008                                    |
| A    | Chip de estado por capacidades                                  | P-12 y P-16b                                            |
| A    | Error del turno con causa, fuera de la voz de Shiro             | P-12 (R-281)                                            |
| A    | Permiso con vista estructurada, cola y caducidad                | P-27 (enmienda de ADR 0022)                             |
| A    | Hilo de primera clase y borrador que no se pierde               | L-PROD-06 (cola P-42)                                   |
| A    | Sistema con datos reales; fuera las maquetas de Módulos y Setup | P-12; P-35 para los comandos                            |
| A    | Zona única de avisos                                            | P-11a para la copia                                     |
| A    | Primer arranque                                                 | P-12 («vivo» frente a «listo»)                          |
| B    | Modo dev completo                                               | P-16 y campos nuevos (§5)                               |
| B    | Voz: cadena, caducidad y tercera clave                          | ADR 0034, en curso en otra rama                         |
| B    | Guardado de claves con acuse y reinicio desde la app            | P-15b (R-307)                                           |
| B    | «Detener» mientras piensa (cortar la voz ya existe)             | ADR de turnos, posterior al plan                        |
| B    | Historial de acciones                                           | Registro persistente de acciones (hoy no existe)        |
| B    | Memoria: ver y olvidar                                          | ADR de ciclo de vida de los datos, posterior al plan    |
| B    | Manos libres                                                    | Detección de voz en el cliente: dependencia nueva (ADR) |
| C    | Modo overlay                                                    | Enmienda de ADR 0024 §3; aplazado                       |
| C    | Palabra de activación                                           | Un modelo más siempre cargado; ADR                      |
| C    | Aprobar por voz                                                 | Frontera de confianza: ADR 0022 y tabla SEC-xx          |
| C    | Reacciones al clic y expresiones de 5 a 9                       | Avatar integrado (ADR 0028, aplazado)                   |

## 9. Encaje con el plan y con los ADR

- **No adelanta fases.** El rediseño da forma a ítems que ya existen (P-12,
  P-16b, P-27, la cola P-42) y añade trabajo de cliente que hoy no está en el
  plan. Si se aprueba, lo razonable es repartirlo entre esos ítems y un ítem
  nuevo de «tema y componentes».
- **Pide ADR o enmienda** antes de tocar código: retirar los tres temas
  (ADR 0008), la tipografía nueva, cualquier evento nuevo del bus (memoria,
  historial, campos del modo dev), la detección de voz, la palabra de
  activación, el overlay (ADR 0024 §3) y aprobar por voz (ADR 0022).
- **Voz de Gemini.** La pantalla de Claves y la de Voz ya cuentan con la
  tercera clave y con la caducidad en el informe de salud.
- **Avatar y overlay.** Tienen sitio reservado (lista de motores, botón en la
  barra lateral) y siempre figuran como aplazados.

## 10. Modo overlay

**Aplazado.** Lo vigente es el
[ADR 0024 §3](../adr/0024-packaging-tauri-windows-sidecar.md), y este diseño
pide enmendarlo antes de tocar código. Parte de las respuestas de Pipe y de
una propuesta anterior que toma la **experiencia** de las mascotas de
escritorio, no su código ni su arte.

| Punto          | Diseño                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------- |
| Qué se ve      | Solo Shiro, del tamaño del personaje. La **píldora de estado** y la **burbuja** aparecen cuando hacen falta         |
| Interacción    | **Solo hablada.** No hay campo de texto: para escribir se vuelve a la ventana                                       |
| Hablar         | Tecla global mantenida **o** palabra de activación. Un toque a la tecla la calla                                    |
| Micro abierto  | Con la palabra de activación en marcha, un cuadrado azul fijo sobre ella lo avisa                                   |
| Burbuja        | Lo que va entendiendo, lo que entendió y lo que responde; se desvanece al terminar                                  |
| Clic izquierdo | Reacción (con avatar: cabeza, hombro y mano). Mantener y arrastrar la mueve                                         |
| Clic derecho   | Menú: **volver a la ventana**, silencio, palabra de activación, clics que la atraviesan, tamaño, esconderse y salir |
| Permisos       | Tarjeta compacta junto a ella (ruta, cambios, cuenta atrás, «ver todo en la ventana») **y** aprobación por voz      |
| Reposo largo   | Se duerme: baja el brillo y los cuadros. También con un juego abierto                                               |
| Legibilidad    | El blanco va sobre una copa oscura, la de sus auriculares, para sostenerse sobre fondos claros                      |

- Lo transparente deja pasar los clics y ella **no roba el foco**.
- **Una sola ventana que cambia de modo**: una segunda sería otro cliente del
  bus.
- Por fases: primero lo de la tabla; después, apoyarse en el borde de otras
  ventanas y apartarse ante la pantalla completa; las poses dependen del arte.
- La dibuja el motor que esté disponible: hoy el orbe. La chibi encaja aquí
  cuando se integre (ADR 0028).

**Aviso sobre aprobar por voz.** Es la única decisión que toca una frontera
de confianza: cualquier voz, o un vídeo, podría aprobar una acción, y con la
palabra de activación no hay nada que identifique a quien habla. Propuesta
para acotarlo, a decidir en la enmienda de ADR 0022: valer solo **mientras se
mantiene la tecla global**, exigir una palabra exacta, **no admitirla para
borrar ni para comandos**, y anotar «por voz» en el historial. Las maquetas
ya lo dibujan así.

## 11. Puntos abiertos

- Tamaño mínimo de la ventana (propuesta: 960 × 640; por debajo de 1000 px el
  hilo se pliega solo).
- Si el modo dev debe poder dejarse activo por defecto.
- Qué pasa con el borrador y el hilo al entrar y salir del overlay.
