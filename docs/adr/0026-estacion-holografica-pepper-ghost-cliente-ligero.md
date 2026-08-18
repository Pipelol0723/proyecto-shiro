# ADR 0026: Estación holográfica — pepper's ghost de lámina única y cliente ligero

- **Status**: Accepted
- **Fecha**: 2026-08-18
- **Decidido por**: Pipelol

## Contexto

Queremos usar a Shiro **fuera de la PC**: un objeto físico en el escritorio
—cubo o cilindro— con "holograma", cámaras y micrófonos, en vez de una ventana
de Tauri. Hoy Shiro solo existe como app desktop en la misma máquina que el
`core-host` (ADR 0024).

Las fuerzas en juego:

- La arquitectura **ya prevé** clientes remotos (`ITransport` + `DeviceRegistry`,
  ADR 0003; protocolo WS del bus, ADR 0013). Una estación es, en el papel,
  "otro cliente del `core-host`" — no hay que inventar el transporte.
- Pero sería el **primer cliente fuera de la máquina local**, que es
  literalmente el trigger de reversión que fija el
  [ADR 0025](0025-modelo-de-confianza-local-y-superficie-de-red.md).
- El avatar hoy es **Live2D: 2D y de punto de vista frontal fijo**
  ([ADR 0021](0021-avatar-live2d-pixi-display-fallback-orbe.md)). El paso a 3D
  (VRM) está en post-MVP y es un hito grande por sí solo.
- El [ADR 0020](0020-tts-elevenlabs-systemtts-fallback-y-multidevice-diferido.md)
  dejó el **"cliente activo" multi-dispositivo explícitamente diferido**. Con
  estación y desktop vivos a la vez deja de poder diferirse.
- Equipo de **1 persona a 4-6 h/semana**, con acceso gratuito a impresión 3D en
  la universidad (solo material).

Y lo que **no sabemos**: si el efecto óptico va a convencer en la habitación
real, con la luz real. Es el mayor riesgo del hito y, a la vez, el más barato
de despejar — así que el plan se ordena alrededor de despejarlo primero.

## Decisión

**Vamos a construir la estación como un pepper's ghost de lámina única a 45°
dentro de una carcasa impresa en 3D, gobernada por un cliente ligero que se
conecta por WebSocket al `core-host` de la PC.**

Concretamente:

1. **Óptica: lámina semiespejo única a 45°, no pirámide.** Pantalla arriba
   mirando hacia abajo, lámina de acrílico semiespejo inclinada, interior negro
   mate con capucha y trampas de luz. Se ve de frente (~120° útiles), no en 360°.
2. **Topología: cliente ligero.** El cerebro sigue en la PC. La estación aporta
   pantalla, micrófonos, cámara y altavoz. **Si la PC está apagada, la estación
   no funciona** — aceptado explícitamente a cambio de aprovechar la GPU para
   Whisper/Ollama y de no duplicar el pipeline.
3. **El avatar se reutiliza tal cual.** El único cambio de render es un flip
   vertical del contenedor (`transform: scaleY(-1)`) para compensar el reflejo.
   La estación nace con el Live2D actual; cuando llegue el hito VRM 3D gana
   profundidad y **paralaje de movimiento por head-tracking** (proyección fuera
   de eje alimentada por la cámara que ya está en el BOM) **sin tocar el
   hardware**. La carcasa es agnóstica del avatar.
4. **Activación escalonada, acumulativa.** Botón físico primero (es el
   push-to-talk actual con otro botón, coste cero), wake word local después,
   despertar por cámara al final. Por debajo de todo, un **interruptor que corta
   la alimentación del micro por hardware**, no por software.
5. **Privacidad: todo local salvo petición explícita.** Presencia,
   reconocimiento facial y gestos corren **en el dispositivo**; de las caras se
   guardan **embeddings, nunca imágenes**. Un frame sale hacia la nube
   únicamente cuando el usuario lo pide ("Shiro, mira esto"), y con **LED de
   cámara activa** encendido mientras ocurre.
6. **Multi-cliente: direccionamiento explícito, política simple.** Los eventos
   de salida (`tts:audio`, `llm:responded`, lo que mueva el avatar) llevan un
   **destinatario explícito y separado por modalidad** —el destino del audio y
   el del vídeo pueden diferir—, resuelto en **un único punto del `core-host`**
   (`OutputRouter`). Los clientes filtran por destinatario y **nunca** por
   "¿originé yo este turno?". La política de V1 es la más simple que funciona:
   `destino = origen`, o sea **la respuesta sale por donde entró**. Esto
   **resuelve el diferido del ADR 0020** y, sobre todo, deja el cambio de
   política futuro —responder donde el usuario realmente está— reducido a
   sustituir una función, **sin tocar el protocolo ni los clientes**.
7. **Sin movimiento mecánico en V1.** El seguimiento de mirada lo hace el avatar.
   La base se diseña con patrón de tornillos plano y paso de cable para poder
   añadir un módulo giratorio después.
8. **Fase 1 = maqueta óptica con hardware existente, y es un gate.** Cartón o
   acrílico, un monitor o tablet que ya tengamos, el cliente desktop actual con
   el flip. Si el efecto no convence ahí, el hito se replantea antes de comprar
   nada y antes de escribir código de red.

El plan por fases, el BOM y la guía óptica viven en
[`docs/estacion-holografica.md`](../estacion-holografica.md) (documento vivo).

## Alternativas consideradas

**De la óptica:**

- **Pepper's ghost de pirámide de 4 caras.** Descartada: parte la pantalla en 4
  vistas, cada una pequeña y con un cuarto del brillo, y el personaje queda
  encerrado y diminuto. Con Live2D además obligaría a 4 copias o a adelantar el
  hito 3D. Lo que gana —verla desde detrás— no vale nada en una estación de
  escritorio donde siempre estás en el mismo lado.
- **Ventilador holográfico LED (POV).** Descartada pese a ser la más
  espectacular: el firmware de los modelos de consumo es **cerrado** y solo
  admite vídeo pre-subido, así que alimentarlo en tiempo real desde el
  `core-host` exigiría ingeniería inversa; el lip-sync sincronizado con el TTS
  sería inviable. Además aspas girando (ruido junto a los micros, jaula de
  seguridad) y resolución baja.
- **Pantalla transparente LCD/OLED.** Descartada: cuesta 150-400 € solo el panel
  y **flota menos** que la lámina, porque el negro es transparente y los blancos
  salen lechosos. Los módulos pequeños llegan con placas driver propietarias mal
  documentadas.
- **Cilindro difusor / retroproyección.** La variante "pantalla curva" es la más
  robusta pero Shiro se ve _en una pantalla_, no flotando. La variante
  "retroproyección sobre film" sí flota, pero exige un pico-proyector de foco
  corto (200-400 €), calor, ventilador y calibración óptica delicada.
- **Looking Glass / light-field.** Descartada: ~300 € y sigue siendo una pantalla
  **con marco**, que es justo la referencia visual que rompe la ilusión y que el
  pepper's ghost elimina gratis. Requeriría además el hito 3D como prerrequisito
  duro.
- **Volumétrico real (difusor giratorio).** Descartada por sobre-ingeniería: es
  un proyecto entero, con una superficie girando rápido dentro de la caja.

**De la topología:**

- **Estación autónoma (Jetson / mini-PC dentro).** Descartada: 400-900 €, calor y
  ventilador dentro de la carcasa junto a los micros, y un LLM local muy inferior
  al pipeline actual. Funcionar sin la PC no compensa duplicar todo el stack.
- **Híbrida con fallback a la nube.** Descartada para V1: obliga a mantener dos
  rutas de pipeline, y sin PC no hay memoria Letta local ni tools — es decir, el
  fallback sería una Shiro amnésica y sin manos. Reconsiderable si el "está
  apagada la PC" resulta molesto en uso real.

**Del enrutado de salida:**

- **Un "cliente activo" global** (el planteamiento con el que el ADR 0020 dejó
  diferido el problema). Descartada **como concepto, no solo como política**: un
  singleton no puede expresar el caso real de "le hablo a la estación con los
  cascos del PC puestos", donde el avatar debería ir a la estación y el audio a
  los cascos. Direccionar por evento y por modalidad cuesta lo mismo y es
  estrictamente más expresivo.
- **Enrutado por presencia desde V1** ("responde donde estoy"). Descartada por
  falta de sensores, no por falta de ganas: saber dónde está el usuario exige la
  cámara con reconocimiento facial de la Fase 6, más señales por cliente
  (actividad de teclado, cascos conectados) que hoy nadie publica, más
  histéresis para que una presencia parpadeante no parta la respuesta en dos
  habitaciones. Se difiere a **después de la Fase 6**, que es cuando las señales
  existen y la política se puede probar de verdad.
- **Que cada cliente decida comparando si originó el turno.** Descartada
  explícitamente: mete la semántica de enrutado dentro de cada cliente, así que
  cambiar la política obligaría a tocar el wire y los tres clientes a la vez.
  Es justo el retrofit caro que el direccionamiento explícito evita.

**De la activación:** el push-to-talk actual por teclado se descarta como único
modo por razones obvias (no hay teclado), pero se conserva como base física en
Fase 2 porque cuesta cero y es el fallback cuando la wake word falla.

**De la privacidad:** la **visión continua hacia la nube** se descartó por
suponer streaming permanente de la habitación a un tercero, coste alto por
tokens y un modelo de confianza difícil de justificar por escrito. La **visión
100% local** (modelo de visión en Ollama) se descartó como default por calidad
claramente inferior, pero queda como opción de configuración.

## Consecuencias

### Positivas

- **El software existente se reutiliza casi entero**: el pipeline conversacional
  (ADR 0016), el TTS (0020) y el avatar (0021) no cambian. El esfuerzo real se
  concentra donde de verdad hay trabajo nuevo: transporte autenticado, wake word
  y visión.
- **Desacopla el calendario del hardware del hito VRM 3D.** La estación puede
  existir y ser útil con Live2D, y mejora sola cuando llegue el 3D.
- **Cierra dos diferidos que llevaban tiempo abiertos**: el modelo de confianza
  de red (0025) y el cliente activo multi-dispositivo (0020).
- **El enrutado de salida queda con costura.** Pasar de "responde por donde
  entró" a "responde donde estás" será sustituir el `OutputRouter`, no migrar el
  protocolo ni los clientes. La deuda se paga hoy, que no cuesta casi nada, en
  vez de cuando ya haya tres clientes desplegados.
- **Escalado barato del riesgo**: la Fase 1 cuesta ~30 € y responde la pregunta
  más incierta del hito antes de comprometer dinero o código.
- La impresión 3D gratuita mueve el coste dominante de la carcasa a la óptica y
  el cómputo, y permite geometría de trampas de luz imposible de comprar hecha.

### Negativas / Riesgos

- **Se ve de frente y quiere penumbra.** Es la limitación estructural de la
  técnica. En un escritorio es asumible; en un salón a mediodía, no.
- **La estación depende de que la PC esté encendida.** Es una regresión de
  disponibilidad frente a la idea de "Shiro fuera de la PC".
- **Estrena una superficie de red autenticada** (ADR 0027) que hoy no existe:
  más piezas que pueden fallar en el arranque y más fricción de setup.
- **Un `IVisionModule` es código nuevo de verdad**, con biometría facial de por
  medio. Es la parte del hito con más riesgo de alargarse.
- La wake word siempre escuchando es una superficie de privacidad nueva aunque
  el audio no salga del dispositivo. Mitigada con el corte físico de micro, no
  eliminada.
- **Se paga complejidad de protocolo por adelantado**: el destinatario por
  modalidad es un campo que V1 no aprovecha, porque siempre resuelve al mismo
  cliente. Es deuda deliberada a favor del futuro; si el enrutado por presencia
  nunca llega a construirse, sobra.
- Riesgo de que la Fase 1 salga mal y el hito muera ahí. Es intencionado: mejor
  30 € que 400 €.

### Neutrales

- Aparece un paquete nuevo en el monorepo (`packages/station`), siguiendo el
  mismo patrón que `desktop`.
- El `clientId` pasa a ser parte del envelope del bus — cambio de protocolo
  menor que afecta a todos los clientes presentes y futuros.
- La estación es cliente **y** candidata a `IDeviceModule` (el registry del
  ADR 0003 sigue sin ninguna implementación; la base giratoria futura sería la
  primera).

## Notas de implementación

- `packages/station/` — paquete nuevo, cliente ligero. Reutiliza los componentes
  de render de `desktop`; se decidirá al llegar si se extrae un paquete `ui`
  compartido o se empieza duplicando.
- `packages/desktop/src/components/Avatar` — el flip vertical es un
  `transform: scaleY(-1)` en el contenedor, tras un flag de config (`mirror`).
  El eje correcto se ajusta empíricamente contra la maqueta.
- `packages/core/src/types/events.ts` — eventos nuevos previstos:
  `client:presence` (genérico, publicable por **cualquier** cliente y no solo
  por la estación), `station:wake`, `vision:frame-requested`,
  `vision:described`. Y en el envelope del wire
  (`packages/core/src/core/transports/wire-schema.ts`): `clientId` de origen y
  destinatario de salida separado por modalidad.
- `packages/core/src/interfaces/IVisionModule.ts` — interfaz nueva, mismo patrón
  que `ISTTModule`.
- `packages/core-host/src/pipeline` — `OutputRouter`: el **único** punto que
  resuelve el destinatario de cada evento de salida. En V1 devuelve el origen
  del turno (tres líneas); es la costura por la que entrará después el enrutado
  por presencia. El destino se fija **al inicio del turno** y no se persigue si
  el usuario se mueve a mitad de frase.
- La auth del transporte va en
  [ADR 0027](0027-autenticacion-token-bus-stt-multicliente.md), que es
  **prerrequisito duro** de la Fase 3.

## Referencias

- [`docs/estacion-holografica.md`](../estacion-holografica.md) — plan por fases,
  BOM y guía óptica (documento vivo).
- [ADR 0003](0003-transport-abstraction-device-registry.md) — abstracción de
  transports y device registry.
- [ADR 0013](0013-protocolo-websocket-eventbus.md) — protocolo WebSocket del bus.
- [ADR 0020](0020-tts-elevenlabs-systemtts-fallback-y-multidevice-diferido.md) —
  multi-device diferido; este ADR lo resuelve.
- [ADR 0021](0021-avatar-live2d-pixi-display-fallback-orbe.md) — avatar Live2D.
- [ADR 0024](0024-packaging-tauri-windows-sidecar.md) — packaging y sidecar.
- [ADR 0025](0025-modelo-de-confianza-local-y-superficie-de-red.md) — modelo de
  confianza previo; este hito dispara su trigger.
- [ADR 0027](0027-autenticacion-token-bus-stt-multicliente.md) — autenticación
  del bus y del STT.
