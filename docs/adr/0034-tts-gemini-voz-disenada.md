# ADR 0034: TTS — voz diseñada de Gemini como primaria, ElevenLabs y SystemTTS de respaldo

- **Status**: Proposed
- **Fecha**: 2026-11-13
- **Decidido por**: Pipelol0723

## Contexto

[ADR 0020](0020-tts-elevenlabs-systemtts-fallback-y-multidevice-diferido.md) dejó a ElevenLabs como voz primaria y a SystemTTS como único respaldo, y Shiro ya habla con una voz diseñada en ElevenLabs. El problema es la cuota: el plan gratuito da 10 000 créditos al mes, unos 330 caracteres al día, y el uso previsto son unos pocos miles de caracteres diarios ([comparativa](../plan-implementacion-2026-11/voz-alternativas.md), §1). Con ese uso la cuota se agota en pocos días y Shiro pasa el resto del mes hablando con la voz del sistema.

El 2026-11-13 el dueño decidió probar antes de pagar ([voz.md §5.0](../plan-implementacion-2026-11/voz.md)): primero la voz de Gemini por API y, sin abandonar ElevenLabs, comparar. Se diseñaron tres voces **por descripción** (solo rasgos, sin grabar ni imitar a nadie) y se generó con cada una un guion de seis frases: una por cada emoción del personaje y una larga en calma, cada frase con su indicación de estilo. El dueño las escuchó y eligió la tercera, que en la prueba se llamó «Precisa»: joven, analítica, de articulación limpia y entonación contenida.

Adoptar un proveedor nuevo pide un ADR y un módulo nuevo. Este ADR es esa propuesta.

### Datos de la prueba y de la documentación (a 2026-11-13)

Comprobado con llamadas reales al modelo `gemini-3.8-flash-tts`:

- Una voz se crea con `POST /v1beta/voices` (tipo `prompted`, `store: true`) y devuelve un identificador `voice_…` que se reutiliza en cada síntesis. `GET /v1beta/voices/{id}` devuelve su fecha de caducidad.
- La síntesis es `POST /v1beta/interactions` con el texto, la voz y, opcionalmente, una anotación de estilo en lenguaje natural por petición (`speech_metadata.style`).
- Devuelve el audio completo en un WAV (PCM de 16 bits a 24 kHz, mono) codificado en base64.
- Latencia: entre 3,5 y 7,5 s por frase de 60 a 200 caracteres, en el nivel gratuito y sin streaming. ADR 0020 contaba con 1-3 s. No se ha medido con respuestas más largas ni en el nivel de pago.

Leído en la documentación de Google:

- **Nivel gratuito**: sin coste, pero la prueba topó con «10 peticiones al día», y los datos se usan para mejorar sus productos.
- **Nivel de pago**: 0,50 USD por millón de tokens de texto y 9 USD por millón de tokens de audio hasta el 2026-12-31; desde el 2027-01-01, 1 USD y 18 USD. Un segundo de audio son 25 tokens. Los datos no se usan para mejorar productos.
- **Caducidad**: una voz guardada vive un año (la elegida caduca el 2027-11-13). La API solo ofrece crear, consultar, listar y borrar: no hay renovación documentada.
- La voz se crea ligada a un modelo y a un proyecto de Google.

### Lo que no sabemos

- Si una voz recreada con la misma descripción suena igual.
- Si la voz sigue sirviendo al activar la facturación en su proyecto (debería, es el mismo proyecto; hay que comprobarlo con una frase).
- El límite diario del nivel de pago, y si Google mantendrá el modelo, el precio y esta API, que está en `v1beta`.
- La latencia de una respuesta completa de Shiro, que hoy se sintetiza de una vez. De esa medida depende el tiempo máximo del módulo.

## Decisión

**La voz primaria de Shiro pasa a ser la voz diseñada de Gemini elegida por el dueño, con un módulo nuevo `GeminiTTS`; ElevenLabs baja a primer respaldo, con la voz que ya tiene, y SystemTTS sigue siendo el último.** La cadena queda `GeminiTTS → ElevenLabsTTS → SystemTTS`.

La decisión solo tiene efecto con el nivel de pago de Gemini (§4). Con el ADR aceptado y sin pago, `tts.active` se queda en `ElevenLabsTTS`, como hoy.

### 1. `GeminiTTS`, un módulo más del slot `tts`

Implementa [`ITTSModule`](../../packages/core/src/interfaces/ITTSModule.ts) y vive en `packages/core/src/modules/tts/gemini-tts.ts`. Corre dentro del `core-host`, igual que `ElevenLabsTTS` (ADR 0020 §2): es un cliente HTTP con `fetch`, sin SDK nuevo. La clave se lee de `GEMINI_API_KEY` y no sale del `core-host`.

- Devuelve siempre `mimeType: 'audio/wav'` y comprueba la cabecera RIFF de lo que recibe. El camino del audio no cambia: la caché, la ruta `/audio` y el cliente ya manejan WAV, que es lo que entrega SystemTTS.
- Lleva un `timeout_ms` configurable, 30 000 por defecto, como `ElevenLabsTTS`. Pasado ese tiempo falla y la cadena sigue con el siguiente eslabón. El valor se ajusta cuando se mida una respuesta larga: demasiado corto haría saltar al respaldo en las respuestas largas.
- Calcula la duración de cada audio para el contador de §4. El pipeline no usa hoy ese dato.

### 2. La emoción se expresa como estilo, y lo define el personaje

ElevenLabs traduce la emoción a un número (`tts_stability`). Gemini acepta una frase de estilo, y en la prueba cada frase llevó la suya. Cada emoción del YAML del personaje gana un campo opcional `tts_style`, y `GeminiTTS` lo envía como `speech_metadata.style`; si falta, no envía estilo. Los valores se escriben en inglés, como en los ejemplos de Google, y parten de los cinco que se usaron en la prueba. `tts_stability` se queda para ElevenLabs: cada emoción tendrá un parámetro por proveedor. El YAML del personaje sigue siendo la única fuente de las emociones (ADR 0020 §5).

### 3. La cadena de respaldo se construye desde la configuración

Hoy `bootstrap.ts` crea `SystemTTS` a mano y el `fallback_chain` del YAML es decorativo. Con tres eslabones cada uno necesita su configuración:

```yaml
tts:
  active: GeminiTTS
  fallback_chain: [ElevenLabsTTS, SystemTTS]
  config: # la del activo
    voice_id: 'voice_…'
    model_id: 'gemini-3.8-flash-tts'
  providers: # la de los respaldos
    ElevenLabsTTS: { voice_id: '…', model_id: 'eleven_multilingual_v2' }
```

Reglas:

- El activo usa `config`. Cada respaldo usa `providers[nombre]`, o sus valores por defecto si no tiene entrada. Al cambiar el activo a `GeminiTTS`, la configuración actual de ElevenLabs se mueve a `providers.ElevenLabsTTS`.
- El esquema de slot de `core` es común a todos los módulos y hoy descarta los campos que no conoce: gana `providers` como campo opcional, que solo se lee en el slot `tts`.
- Un nombre de `fallback_chain` que no esté registrado, o que repita el activo, detiene el arranque con un mensaje legible.
- `SystemTTS` va siempre al final, aunque el YAML no lo nombre, y sin duplicarlo si ya aparece.
- La cadena se comporta como hoy: un eslabón que falla (sin clave, 401, 429, sin red, tiempo agotado) lanza un error y se pasa al siguiente, con un aviso en el log por turno. No hay «enfriamiento» que salte un eslabón durante un rato; si hace falta, es otro cambio.

Esta parte es separable: tiene valor aunque se rechace el resto, y puede entrar antes como `refac:`.

### 4. Nivel de pago, activado por el dueño, con el gasto a la vista

Con la cuota gratuita Shiro se quedaría sin voz propia a la décima frase del día, y lo que dice iría a mejorar productos de Google.

| Voz al mes                    | Hasta el 2026-12-31 | Desde el 2027-01-01 |
| ----------------------------- | ------------------- | ------------------- |
| 30 minutos                    | 0,41 USD            | 0,81 USD            |
| 100 minutos (el uso previsto) | 1,35 USD            | 2,70 USD            |
| 900 minutos (media hora/día)  | 12,15 USD           | 24,30 USD           |

Son 1,35 céntimos de dólar por minuto hablado hoy y 2,7 desde enero. Los tokens de texto suman céntimos. Como referencia, los mismos 100 minutos en ElevenLabs piden el plan Creator, 22 USD al mes; Starter, 6 USD, da unos 25-30 minutos (el doble con un modelo rápido).

La API de pago no tiene tope de gasto por defecto. Por eso:

- El dueño crea una alerta de presupuesto en su cuenta de Google antes de activar el pago.
- El `core-host` cuenta los segundos sintetizados, guarda el total del mes en su carpeta de datos y avisa en el log al pasar un umbral mensual configurable. Solo ve su propio uso, no el de la cuenta: la alerta de Google es la que manda.

### 5. La voz caduca: receta en el repo, aviso y plan de continuidad

- **Receta.** Modelo `gemini-3.8-flash-tts`, tipo `prompted`, género femenino, idioma `es-MX` y esta descripción: «A cool, analytical young woman about 20 with a neutral Latin American Spanish accent. Clear, smooth mid-register voice with crisp articulation; deadpan and measured, with flat-to-falling intonation.» Con la implementación pasa también a la biblia del personaje.
- **Herramienta.** Un script del repo crea, lista y consulta voces a partir de la receta, para no depender de peticiones hechas a mano.
- **Referencia.** Los clips de la prueba con la voz elegida se guardan fuera del repo, con copia, como patrón de cómo debe sonar.
- **Aviso.** Al arrancar, el `core-host` consulta la voz (una petición a Google con la clave) y avisa si faltan menos de 30 días o si ya no existe. Como Shiro puede pasar semanas apagada, el dueño apunta además la fecha.
- **Recrear** es una tarea manual: el dueño escucha la voz nueva antes de cambiar el `voice_id`.
- **Continuidad.** Si la voz se pierde antes de tiempo (caduca, Google retira el modelo o cambia la API), Shiro sigue con la voz de ElevenLabs mientras dure su cuota gratuita, y después con la del sistema. Por eso ese eslabón se mantiene configurado y se prueba de vez en cuando. Si la pérdida dura, la salida es recrear la voz o pagar ElevenLabs.

### 6. Privacidad: lo que Shiro dice en voz alta sale a Google

Como con ElevenLabs, el texto que Shiro dice en voz alta viaja a un tercero: respuestas, avisos de self-dev y el mensaje de error. Puede incluir datos personales que ella mencione. No se envían la memoria ni lo que escribió el usuario.

En el nivel de pago ese contenido no se usa para mejorar productos; con una clave del nivel gratuito, sí, y el módulo no puede distinguirlas. `.env.example` y el asistente de configuración lo avisan junto al campo de la clave.

Al implementar se añade la fila correspondiente en la tabla viva de la [revisión de seguridad](../security-review-2026-07.md). Este ADR no espera al ADR 0030 que el plan de mejora reserva para la licencia y la privacidad de los datos; cuando se escriba, debe listar a Google junto a ElevenLabs.

## Qué tiene que hacer el dueño

1. Aceptar o rechazar este ADR.
2. Activar la facturación en el proyecto de Google de la clave, poner la alerta de presupuesto y comprobar con una frase que la voz elegida sigue funcionando.
3. Validar la prueba real del último paso de la implementación.
4. Apuntar la renovación de la voz para octubre de 2027.

## Alternativas consideradas

- **ElevenLabs primaria y Gemini de respaldo**: es el cambio más pequeño, pero deja como voz habitual la que se queda sin cuota a diario y como respaldo la que el dueño eligió.
- **Pagar ElevenLabs**: resuelve la cuota sin código nuevo. Descartado por ahora por precio (22 USD al mes para el uso previsto, frente a 1,35-2,70 en Gemini) y porque el dueño prefirió la voz de Gemini. Es la salida si Gemini no convence en la prueba real.
- **Quitar ElevenLabs**: descartado por el dueño. Ya está implementado y da una voz propia cuando Gemini falla; SystemTTS suena genérico y rompe al personaje.
- **Una voz de catálogo** (de Gemini, que no caduca, o es-MX de Azure, con cuota gratuita amplia): descartado. Es una voz que cualquiera puede usar; ADR 0020 pedía una identidad propia.
- **Clonar una voz real**: descartado. Exige grabar a una persona y su consentimiento; la voz por descripción no depende de nadie.
- **`gemini-3.8-flash-lite-tts`** (un tercio más barato): sin probar. Una voz se crea ligada a un modelo, así que cambiar después puede obligar a recrearla; se prueba de oído antes de la activación.
- **Pregrabar las frases frecuentes**: no aplica; casi todo lo que Shiro dice es texto nuevo.
- **Voz local**: sigue aplazada por hardware, como en ADR 0020.
- **Síntesis por frases o por trozos** para bajar la latencia: aplazada, igual que en ADR 0020 §8. Es la salida si la espera molesta.

## Consecuencias

### Positivas

- Shiro habla a diario con la voz que el dueño eligió, coherente con la [biblia del personaje](../design/shiro-character-bible.md).
- El coste es por uso y bajo para el uso previsto, sin cuota mensual fija.
- La emoción se controla con frases legibles en el YAML del personaje.
- La cadena de respaldo pasa a ser real y configurable; añadir otro proveedor deja de exigir tocar el arranque.

### Negativas / Riesgos

- **Más espera.** 3,5-7,5 s por frase frente a los 1-3 s de ElevenLabs, y una respuesta larga tardará más: el subtítulo aparece antes que la voz. En el peor caso, con Gemini colgado y ElevenLabs lento, el silencio llega a la suma de sus tiempos máximos (30 s cada uno), más 15 s si también falla la voz del sistema.
- **La voz caduca en un año** y puede no recrearse idéntica. Es el riesgo principal de la decisión. El respaldo con voz propia, ElevenLabs en su plan gratuito, solo aguanta unos días al mes.
- **API en `v1beta` y modelo reciente**: pueden cambiar o retirarse antes del año.
- **El precio se duplica** el 2027-01-01, y sin alerta el gasto no tiene tope.
- **Requiere pagar**: sin el nivel de pago la decisión no se activa.
- **Dos voces.** Si Gemini falla a mitad de una conversación, Shiro sigue con la voz de ElevenLabs, que es distinta.
- Lo que Shiro dice en voz alta va a Google.
- Tres eslabones son dos claves que gestionar y más casos que probar.
- El WAV pesa unas tres veces más que el MP3 de ElevenLabs (48 KB por segundo frente a 16); cabe en la caché en memoria actual.

### Neutrales

- `ElevenLabsTTS` no cambia de código; solo de posición en la cadena.
- `modules.config.yaml` gana `providers` en el slot `tts` y el personaje gana `tts_style`. Los dos son opcionales: las configuraciones actuales siguen siendo válidas.
- ADR 0020 sigue vigente en topología (ADR 0020 §2), transporte del audio (§3) y cancelación (§4). Este ADR sustituye su §1 (primaria y cadena de dos) y su §6 (voz), y amplía su §5 con `tts_style`. La nota fechada en ADR 0020 y los textos que quedan desfasados (comentarios de `ITTSModule.ts` y de `modules.config.yaml`, README, `architecture.md` y la biblia) se actualizan con el código, no antes.

## Notas de implementación

Sin implementar. Si el dueño lo acepta, en PRs pequeños y en este orden:

1. `refac:` cadena de respaldo desde la configuración: `providers` en el esquema de slot de `core` y la construcción de la cadena con sus reglas en `bootstrap.ts`, con sus tests. Toca dos paquetes y no depende de Gemini.
2. `GeminiTTS` sin estilo: petición, tiempo máximo, cabecera RIFF, duración y contador de segundos. Tests con `fetch` simulado: caso feliz, 401, 429, respuesta sin audio y tiempo agotado.
3. `tts_style` en el esquema del personaje y en `default.yaml`, y su envío desde `GeminiTTS`.
4. Script de voces (crear, listar, consultar) y aviso de caducidad al arrancar, con su campo nuevo en el informe de salud.
5. Clave nueva: `MANAGED_KEYS` y el mapa de campos en el `core-host`, los tipos de `secrets:save` y del informe de salud en `core`, la pantalla de Setup, `.env.example` con el aviso del nivel gratuito, y la fila de la tabla SEC-xx. Es un cambio de protocolo del bus entre tres paquetes.
6. Activación: `tts.active: GeminiTTS` en `config/modules.config.yaml`, la nota en ADR 0020 y los documentos desfasados, y la prueba real del dueño. Se da por buena si la voz es la elegida y la espera de una respuesta normal es tolerable. Se prueban además los dos saltos: sin la clave de Gemini habla ElevenLabs, y sin red habla la voz del sistema.

## Referencias

- [ADR 0020](0020-tts-elevenlabs-systemtts-fallback-y-multidevice-diferido.md) — TTS: ElevenLabs y SystemTTS, topología y transporte del audio.
- [ADR 0007](0007-module-loader-registry.md) — registro de módulos y slots.
- [`voz.md`](../plan-implementacion-2026-11/voz.md) §5.0 — decisiones del dueño del 2026-11-13 — y [`voz-alternativas.md`](../plan-implementacion-2026-11/voz-alternativas.md) — comparativa de opciones con sus fuentes.
- [Biblia del personaje](../design/shiro-character-bible.md) — tono de Shiro.
- Documentación de Google consultada el 2026-11-13: [diseño de voces](https://ai.google.dev/gemini-api/docs/voice-design), [API de voces](https://ai.google.dev/api/voices), [generación de voz](https://ai.google.dev/gemini-api/docs/speech-generation), [precios](https://ai.google.dev/gemini-api/docs/pricing).
