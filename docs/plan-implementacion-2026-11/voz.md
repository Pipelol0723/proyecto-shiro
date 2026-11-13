# Plan de implementación (2026-11) — Voz nueva en ElevenLabs

> Parte del [plan de implementación](README.md) (estado: propuesta, pendiente de aprobación). Los IDs R-xxx, L-xxx y P-xx son los de la [revisión](../revision-estado-2026-11.md) y del [plan de mejora](../plan-mejora-2026-11.md). Las referencias a otras secciones (§1, §2, §7 en el índice; §3 a §6 en los archivos hermanos) están resueltas en la tabla del [índice](README.md).

## 5. Voz nueva en ElevenLabs

Pipe quiere diseñar una voz nueva para Shiro y pregunta si se puede crear una voz con el mismo tono y rango que una voz real sin copiarla con IA. La respuesta corta: **sí en categoría (describiendo sus rasgos), no en identidad**; el detalle está en §5.2. Documentación oficial de ElevenLabs consultada el **2026-11-12** (elevenlabs.io/docs, /pricing, /pricing/api, /use-policy, /v4); lo que no dice va como **sin verificar**. Ningún paso que gaste créditos o toque el repo se ejecuta sin que Pipe lo apruebe; las preguntas y permisos de este frente están en §2.4.

### 5.1 Punto de partida en el repo

| Qué                   | Dónde                                                                                       | Estado hoy                                                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Slot TTS              | `config/modules.config.yaml:56-71`                                                          | `ElevenLabsTTS` + fallback `SystemTTS`; `voice_id` ya fijado (`:64`), `model_id: eleven_multilingual_v2` (`:65`), `similarity_boost 0.78`, `style 0.15`, `use_speaker_boost true` (`:69-71`) |
| Esquema de config     | `packages/core/src/modules/tts/elevenlabs-tts.ts:36-73`                                     | Acepta `voice_id`, `model_id`, `similarity_boost`, `style`, `use_speaker_boost`, `default_stability` (0.75), `base_url`, `timeout_ms`. **No acepta `speed`**                                 |
| Petición              | `elevenlabs-tts.ts:170-180`                                                                 | `POST /v1/text-to-speech/{voice_id}` sin streaming, sin `seed`, sin `speed`, sin `language_code`                                                                                             |
| Stability por emoción | `elevenlabs-tts.ts:248-255` + `packages/core/src/character/characters/default.yaml:101-120` | neutral 0.75 · divertida 0.65 · pensativa 0.82 · molesta 0.88 · vulnerable 0.55                                                                                                              |
| Fallback              | `packages/core-host/src/tts/tts-with-fallback.ts:35-55`                                     | Si ElevenLabs falla (401/429/red), sale la voz del sistema. Cambiar la voz no lo afecta                                                                                                      |
| Decisión              | ADR 0020 §5-§6                                                                              | Voz por Voice Design; cambiar de voz = solo YAML, sin código                                                                                                                                 |
| README                | `README.md:342-354`                                                                         | Tabla de ajustes; **recomienda `eleven_turbo_v2_5`, hoy deprecado** (ver §5.7)                                                                                                               |

Consecuencia: cambiar a la voz nueva no exige código (solo `voice_id`). Añadir `speed` o cambiar de modelo
sí toca el esquema y sus tests.

### 5.2 Respuesta a la duda: «¿una voz "real" con el mismo tono y rango que una real, sin copiarla con IA?»

**Sí, en categoría; no, en identidad.** Son dos operaciones distintas:

|            | Clonar (Instant / Professional Voice Cloning)                                                                                                                                       | Diseñar (Voice Design)                            |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Entrada    | Audio de una persona concreta                                                                                                                                                       | Una descripción en texto (20–1000 caracteres)     |
| Resultado  | Esa persona, reconocible                                                                                                                                                            | Una voz nueva que no existe, de la clase descrita |
| Requisitos | Consentimiento explícito e informado de la persona (política de uso, act. 2026-10-09). La Professional verifica con voice-captcha que la voz es tuya y pide plan Creator o superior | Ninguno sobre terceros                            |

Lo que el diseño sí puede reproducir son **rasgos de clase**, describiéndolos:

- **Edad aparente** («early twenties», «young adult»).
- **Registro y tesitura**: grave/medio/agudo dentro de su rango («low-mid register for a young woman», «not high-pitched»).
- **Timbre**: cálido, frío, brillante, opaco, nasal, redondo.
- **Aire o aspereza**: «slightly breathy», «clear», «a hint of rasp».
- **Ritmo y pausas**: «unhurried, short phrases, small pauses».
- **Energía y volumen**: «low energy, quiet, never raises her voice».
- **Acento/variedad**: «neutral Latin American Spanish», «Castilian Spanish».
- **Forma de entonar**: «falling, flat-ish intonation; dry delivery; understated».

Si describes con esos ejes los rasgos que buscas, puedes quedar **cerca de esa clase** (una joven de voz media,
algo aireada, calmada y seca).

**Regla fija para los prompts:** describir solo ejes (edad aparente, registro, timbre, aire, ritmo, energía,
variedad, entonación). **Nunca** nombrar a una persona, actriz, cantante o personaje («como X», «estilo X»), ni
pegar como texto de muestra una transcripción suya. Si una candidata recuerda de forma reconocible a alguien
real, se **descarta** aunque guste, y se anota en la receta («descartada por parecido reconocible»).

Límites honestos:

- La voz saldrá **parecida en categoría, no idéntica**: el generador interpreta palabras, no mide hercios.
- **No garantiza el rango exacto** ni una tesitura concreta; hay que generar varias tandas y elegir de oído.
- Dos generaciones con el mismo texto dan voces distintas salvo que fijes `seed` (parámetro de la API).

**Cuándo deja de ser buena idea:** cuando el objetivo es que se **reconozca a una persona concreta**
(«que suene como X»). Ahí entran los derechos de imagen y de voz de esa persona y la política de ElevenLabs
(prohíbe imitar a una persona viva sin consentimiento y bloquea voces de figuras públicas, «No-Go Voices»).
Ojo con un atajo: Voice Design con `eleven_ttv_v3` admite **audio de referencia**
(`reference_audio_base64`, con `prompt_strength`). Subir ahí audio de otra persona **ya no es diseñar
por descripción**: es usar su voz y necesita su consentimiento. No usarlo con audio de terceros.

**Vía legítima si de verdad quieres ESA voz:** tu propia voz, o la de alguien que consienta **por escrito**
(qué uso, en qué proyecto, que puede retirarlo), con **Professional Voice Cloning** (plan Creator o superior,
verificación de voz). Para Shiro no lo recomiendo: la biblia pide una voz propia del personaje y el repo es público.

### 5.3 Retrato vocal de Shiro (deducido de la biblia y del personaje)

Fuentes: `docs/design/shiro-character-bible.md:24-26` (adulta joven 18–20, serena, ingenio seco),
`:40-71` (dandere + kuudere, «sí es / no es»), `:75-86` (registro comedido, énfasis de contenido y no de volumen,
el TTS debe respetar la contención), `:240-245` (subexpresa); `default.yaml:7-28` (edad aparente ~20,
español neutro, frases cortas y calmadas, ligeramente seca); `expressions.json:5-10` («los cambios son pequeños»).

**Sí es**

- Mujer joven, 19–21 años aparentes. Adulta, no niña.
- Registro **medio, tirando a medio-grave** para su edad. Suave.
- Timbre limpio, algo **aireado** en lo suave; cálido por debajo, sin brillo excesivo.
- Ritmo **pausado**, frases cortas, pausas breves antes de la ironía.
- Energía **baja y estable**; volumen contenido; nunca grita.
- Entonación **descendente y poco ondulada**; el humor se oye en la sequedad, no en la risa.
- Español neutro (variedad a decidir por Pipe, ver §2.4).

**No es**

- Voz anime aguda, chillona o «kawaii» infantil.
- Locutora corporativa, de anuncio o de asistente de call center (la biblia: «sonar artificial o corporativa»).
- Sensual o susurrante por defecto (fan service leve solo en lo visual; la voz no se sexualiza).
- Teatral o emocional (`style` alto, exclamaciones).
- Robótica o plana sin calidez (la biblia: «tranquila», no «apática»).
- Voz grave adulta de narradora (ni 35+ ni «grave aterciopelada»).

### 5.4 Tres prompts de Voice Design

Estructura recomendada por la guía oficial: idioma y variedad → género y edad → calidad de audio →
persona y emoción → timbre, ritmo y entrega. Evitar palabras de efectos («reverb», «echo», «phone»);
usar «intonation» en vez de «accent» si no se habla de variedad regional. Se recomienda el prompt en
**inglés** (los ejemplos oficiales lo están) con el texto de muestra **en español**; la versión en español
sirve para entender y para probar si sale distinto.

#### A — «Serena y seca» (la base)

- EN: `Neutral Latin American Spanish. A young woman around 20 years old. Studio-quality recording. Calm, reserved and quietly observant, with a dry, understated sense of humor. Mid to slightly low register for her age, soft and clear timbre with a light touch of breathiness. Unhurried pacing, short sentences, small pauses, gently falling intonation. Never loud, never overly cheerful.`
- ES: `Español latinoamericano neutro. Mujer joven de unos 20 años. Calidad de estudio. Tranquila, reservada y observadora, con un humor seco y contenido. Registro medio, algo grave para su edad; timbre suave y limpio con un leve aire. Ritmo pausado, frases cortas, pausas breves, entonación descendente. Nunca alza la voz ni suena eufórica.`

#### B — «Cálida por debajo» (más dandere)

- EN: `Neutral Latin American Spanish. A shy but composed young woman in her early twenties. Studio-quality recording. Gentle and warm underneath a reserved surface, speaks softly and a little hesitantly when moved, but stays steady. Mid register, rounded and slightly airy timbre, low energy. Relaxed pacing with natural pauses, subtle and restrained intonation.`
- ES: `Español latinoamericano neutro. Mujer joven de poco más de 20 años, tímida pero serena. Calidad de estudio. Cálida por debajo de una superficie reservada; habla bajo y con algo de duda cuando algo la toca, pero mantiene la compostura. Registro medio, timbre redondo y algo aireado, energía baja. Ritmo relajado con pausas naturales, entonación sutil y contenida.`

#### C — «Fría y precisa» (más kuudere)

- EN: `Neutral Latin American Spanish. A young adult woman, about 19 to 21. Studio-quality recording. Cool, analytical and precise, deadpan delivery with faint sarcasm, but never cold or rude. Clear mid register, smooth timbre with little breath, crisp articulation. Steady, measured pacing, flat-to-falling intonation, minimal emotional peaks.`
- ES: `Español latinoamericano neutro. Mujer adulta joven, de 19 a 21 años. Calidad de estudio. Fría, analítica y precisa; entrega impasible con un sarcasmo leve, pero nunca borde. Registro medio y claro, timbre liso con poco aire, articulación nítida. Ritmo medido y constante, entonación plana o descendente, sin picos emocionales.`

(Si Pipe elige español peninsular, cambiar la primera frase por `Castilian Spanish from Spain.` / `Español de España.`)

#### Texto de muestra (fijo para las tres, 100–1000 caracteres; ~390)

> Hola. Llegas tarde, pero no te preocupes, tampoco tenía planes. Estuve revisando lo que dejaste ayer… hay dos errores, uno bastante obvio. No te lo voy a decir todavía; quiero ver si lo encuentras tú. Si te cansas, avísame. Puedo explicarlo despacio. O puedo quedarme callada y fingir que no me importa. Tú eliges.

Mismo texto para todas las tandas: así se comparan voces, no textos. No usar «Auto-generate» (mete etiquetas
y cambia el texto entre tandas).

#### Parámetros de diseño (API `POST /v1/text-to-voice/design`)

| Parámetro                | Valor propuesto                                                           | Motivo                                                                                     |
| ------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `model_id`               | `eleven_ttv_v3` (probar también `eleven_multilingual_ttv_v2`, el default) | ttv_v3 es el modelo de diseño más nuevo; las voces diseñadas funcionan con v4 y anteriores |
| `guidance_scale`         | 5 (default); subir si el tono no se respeta, bajar si suena artificial    | La doc avisa: alto = más fiel, pero puede sonar artificial                                 |
| `loudness`               | 0.5 (default)                                                             |                                                                                            |
| `seed`                   | fijar uno por tanda y anotarlo                                            | Reproducibilidad en la receta                                                              |
| `should_enhance`         | `false`                                                                   | Queremos controlar la descripción, no que la expanda una IA                                |
| `reference_audio_base64` | **no usar**                                                               | Ver §5.2                                                                                   |

Cada tanda devuelve **3 vistas previas** (`previews[].generated_voice_id`, `audio_base_64`).

### 5.5 Guion de prueba (para comparar candidatas)

Una frase por emoción del enum actual (`neutral`, `divertida`, `pensativa`, `molesta`, `vulnerable`),
sintetizada con el `stability` de esa emoción, y dos frases largas con el de `neutral`.

| Emoción             | Frase                                                                                                                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| neutral             | «Ya está. Guardé el archivo y dejé una nota con lo que falta.»                                                                                                                                                                                                           |
| divertida           | «¿Otra vez el mismo error? Empiezo a pensar que le tienes cariño.»                                                                                                                                                                                                       |
| pensativa           | «Mmm… no cuadra. Si el servidor respondió, el fallo tiene que estar antes. Déjame pensarlo.»                                                                                                                                                                             |
| molesta             | «Te lo dije hace una hora. No pasa nada. Solo… léelo esta vez.»                                                                                                                                                                                                          |
| vulnerable          | «Gracias por quedarte. No lo digo mucho, pero… me gusta cuando hablamos así.»                                                                                                                                                                                            |
| larga 1 (técnica)   | «El problema no es la memoria, es el orden. Primero se guarda el turno y después se manda a Letta; si Letta tarda, el turno espera en la cola local. Por eso no perdiste nada anoche. Aun así, conviene revisar el registro: hay tres avisos seguidos a las dos y diez.» |
| larga 2 (madrugada) | «Son casi las tres. Deberías dormir, aunque supongo que no me vas a hacer caso. Está bien… pon algo de música tranquila y cuéntame qué te tiene despierto. No tengo prisa. Nunca la tengo, la verdad.»                                                                   |

Qué escuchar (puntuar 1–5): edad creíble · calma · sequedad sin frialdad · calidez en «vulnerable» ·
que «divertida» suene a media sonrisa y no a risa · pronunciación de «Letta» y cifras · estabilidad entre frases ·
cansancio tras 2 minutos de escucha.

### 5.6 Procedimiento paso a paso

| #   | Pipe                                                                                                              | Agente                                                                                                                                                                                                                                                                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Decide variedad de español, plan y tope de créditos (§2.4)                                                        | —                                                                                                                                                                                                                                                                                                                                            |
| 2   | Inicia sesión en elevenlabs.io (el agente nunca teclea contraseñas)                                               | Prepara la carpeta de trabajo **fuera del repo** (p. ej. `%LOCALAPPDATA%\shiro-voice-lab\`) y una hoja de puntuación                                                                                                                                                                                                                         |
| 3   | Aprueba la tanda: «3 prompts × 1 tanda, ~1,2 k créditos»                                                          | **Vía web:** opera Voice Design en el navegador de Pipe con su sesión (pega prompt, texto, ajusta guidance, pulsa Generate). **Vía API:** script que lee `ELEVENLABS_API_KEY` del entorno sin imprimirla ni volcarla a disco, llama a `/v1/text-to-voice/design` y guarda las 3 vistas previas como MP3 con su `seed` y `generated_voice_id` |
| 4   | Escucha las 9 vistas previas y marca 2–3 favoritas                                                                | Hace una tabla con id, prompt, seed y notas                                                                                                                                                                                                                                                                                                  |
| 5   | Aprueba guardar las favoritas (ocupan huecos de voz)                                                              | `POST /v1/text-to-voice` con `voice_name` (`shiro-A1`…), `voice_description` y `generated_voice_id` (o «Save» en la web) y apunta los `voice_id`                                                                                                                                                                                             |
| 6   | Aprueba el gasto del guion: ~1 k caracteres por candidata y modelo                                                | Sintetiza el guion (§5.5) con cada candidata en `eleven_multilingual_v2` y en el modelo rápido elegido (§5.7), un MP3 por frase, nombres `A1_v2_neutral.mp3`                                                                                                                                                                                 |
| 7   | Escucha a ciegas (el agente baraja los nombres) y elige una voz                                                   | Propone los ajustes finos (tabla §5.7) y repite solo las frases dudosas                                                                                                                                                                                                                                                                      |
| 8   | Confirma la voz y los ajustes. Si hace falta una key nueva, la pega él en su `.env` (raíz del repo, no trackeado) | Abre el PR del §5.8                                                                                                                                                                                                                                                                                                                          |
| 9   | Prueba Shiro en local, 10 minutos de conversación real, y da el visto bueno                                       | —                                                                                                                                                                                                                                                                                                                                            |

Reglas para el agente: nunca leer ni mostrar la API key (ni abrir `.env`); si el script necesita la key,
Pipe la exporta en la sesión o la carga el propio proceso desde el entorno. Nada de audio dentro del repo.
Detener la tanda si el saldo baja del tope acordado (`GET /v1/user/subscription` muestra el uso: **sin verificar**
el nombre exacto del campo).

### 5.7 Modelo y ajustes

#### Modelos vigentes (docs/overview/models, 2026-11-12)

| `model_id`                               | Idiomas | Latencia mediana\*              | Precio API         | Nota                                                                                     |
| ---------------------------------------- | ------- | ------------------------------- | ------------------ | ---------------------------------------------------------------------------------------- |
| `eleven_v4`                              | 90+     | no publicada                    | 0,08 USD / 1k car. | El más expresivo; nuevo                                                                  |
| `eleven_v4_turbo`                        | 90+     | ~100 ms (≈150 ms a primera voz) | 0,04               | Tiempo real, etiquetas de audio, streaming bidireccional                                 |
| `eleven_v3` / `eleven_v3_conversational` | 70+     | — / ~165 ms                     | 0,08 / 0,04        | La doc los llama generación anterior                                                     |
| `eleven_multilingual_v2` (**el actual**) | 29      | mayor que Flash                 | 0,08               | El más estable en textos largos                                                          |
| `eleven_flash_v2_5`                      | 32      | ~100 ms                         | 0,04               | Normalización de texto desactivada por defecto (cifras)                                  |
| `eleven_turbo_v2_5`                      | —       | —                               | —                  | **Deprecado**, sustituir por `flash_v2_5`. El README (`README.md:347`) aún lo recomienda |

\* Sin red ni aplicación. En la app, 1 crédito ≈ 1 carácter en multilingual v2; Flash 0,5–1 (página de precios).

Ajustes según la API de síntesis: `stability` (def. 0.5; menor = más rango emocional), `similarity_boost`
(def. 0.75), `style` (def. 0; distinto de 0 **añade latencia**), `use_speaker_boost` (def. true; añade algo de
latencia), `speed` (def. 1.0, rango 0.7–1.2). La documentación **no dice qué ajustes respeta cada modelo**;
la página de v4 solo muestra Stability y Similarity: que v4/v4 Turbo respeten `style` y `speed` queda
**sin verificar** y se comprueba de oído en el paso 6.

**Recomendación:** mantener `eleven_multilingual_v2` como referencia de calidad y comparar contra
**`eleven_flash_v2_5`** (mitad de precio, ~100 ms) y **`eleven_v4_turbo`** (más nuevo, etiquetas). Como el
código pide el MP3 completo sin streaming (`elevenlabs-tts.ts:170-192`), la latencia que nota Pipe es el tiempo
total de generación; el streaming sigue diferido (ADR 0020 §8). Elegir por oído en el guion; si gana un modelo
rápido, pasar a él. Con Flash, cuidar cifras y fechas (normalización desactivada). La **medición de latencia** de
`eleven_flash_v2_5` por YAML ya es parte de P-16 (`docs/latencia-base.md`): aquí solo se decide de oído y P-16 aporta
las cifras; no se mide dos veces.

#### Ajustes por emoción a probar

`similarity_boost 0.78`, `use_speaker_boost true` constantes. Dos rejillas por candidata:

| Emoción    | Stability actual (A) | Variante B (más vida) | `style` | `speed` propuesto\*\* |
| ---------- | -------------------- | --------------------- | ------- | --------------------- |
| neutral    | 0.75                 | 0.65                  | 0.15    | 0.95                  |
| divertida  | 0.65                 | 0.55                  | 0.20    | 1.00                  |
| pensativa  | 0.82                 | 0.72                  | 0.10    | 0.90                  |
| molesta    | 0.88                 | 0.78                  | 0.10    | 1.00                  |
| vulnerable | 0.55                 | 0.45                  | 0.15    | 0.90                  |

La variante B existe porque una voz diseñada ya calmada puede sonar plana con stability ≥ 0.8.
Probar también `style: 0` (menor latencia). \*\*`speed` y `style` por emoción **no los admite el código hoy**
(solo `stability` varía por emoción, `elevenlabs-tts.ts:248-255`); en la prueba se pasan por API directamente.
Llevarlos a la app sería un cambio de esquema aparte (ver §5.8).

### 5.8 Encargo de PR (cuando haya voz elegida)

**Rama:** `feat/pipe/voz-shiro-v2` → base `develop`. **Commits:** `feat:` / `docs:`. **El PR espera a que P-03a
esté fusionado** (toca `README.md`, que hoy edita otro grupo). Sin ADR: cambiar de voz está
previsto por ADR 0020 §6 («solo el YAML»). Si además se añade `speed`/`style` por emoción, sigue sin ser
arquitectónico (un módulo, reversible), pero mencionarlo en ADR 0020 con una nota de enmienda corta.

1. `config/modules.config.yaml:61-71`: nuevo `voice_id`, `model_id` elegido, `style` si cambia; comentario con
   el nombre de la voz y la fecha.
2. `packages/core/src/character/characters/default.yaml:101-120`: `tts_stability` elegidos.
3. (Opcional, commit aparte con tests) `elevenlabs-tts.ts:36-73, 171-179`: campo `speed` (0.7–1.2, def. 1.0)
   en el esquema y en `voice_settings`; si se quiere por emoción, `tts_speed` en el esquema del personaje.
   Tests: el body enviado incluye `speed`; valor fuera de rango rechazado por zod.
4. `README.md:342-354`: modelo actual, quitar `eleven_turbo_v2_5` y poner `eleven_flash_v2_5`/`eleven_v4_turbo`
   como opción de baja latencia; enlace a la receta.
5. **Nuevo** `docs/design/shiro-voz-receta.md`: prompt exacto (EN/ES), modelo de diseño, `guidance_scale`,
   `loudness`, `seed`, texto de muestra, qué vista previa se eligió, `voice_id`, modelo de síntesis, tabla de
   ajustes por emoción, fecha y descartes con el motivo. Sin audio.
6. Enlazar la receta desde `docs/design/shiro-character-bible.md` §3.

**Custodia del clip de referencia (fuera del repo):** guardar el MP3 de la vista previa elegida y el guion
sintetizado en la carpeta de trabajo y una copia en el almacenamiento personal de Pipe. En la receta, solo el
nombre del archivo y su hash SHA-256 (para saber que es ese). La voz vive en la cuenta de ElevenLabs: si se
borra, la receta + seed permiten intentar regenerarla, sin garantía.

Checks antes de pushear: `format:check`, `lint`, `typecheck`, `test`, `build` (los corre Pipe o el agente que implemente).

### 5.9 Coste y plan

| Fase        | Cálculo                                                                                     | Créditos aprox.                 |
| ----------- | ------------------------------------------------------------------------------------------- | ------------------------------- |
| Diseño      | 3 prompts × 2 tandas × ~390 car. (se cobra el texto una vez por tanda, no por vista previa) | ~2.400                          |
| Guion       | ~1.000 car. × 3 candidatas × 2 modelos                                                      | ~6.000 (≈4.500 si uno es Flash) |
| Ajuste fino | rejilla B + repeticiones, ~1.000 × 3                                                        | ~3.000                          |
| **Total**   |                                                                                             | **~10.000–12.000**              |

- **Free** (10.000 créditos/mes, 3 huecos de voz, Voice Design incluido, **sin licencia comercial**): **no alcanza
  sin recortar tandas** (el total previsto es 10.000-12.000 y no deja nada para usar Shiro ese mes); si la voz actual
  ocupa un hueco, quedan 2. Acceso a la API en Free: **sin verificar**.
- **Starter** (6 USD/mes, 1 USD el primer mes; 30.000 créditos; 10 huecos; licencia comercial): **recomendado;
  la decisión y el pago son de Pipe**. Cubre el diseño y deja ~18.000 para hablar con Shiro el resto del mes.
- Uso posterior: 30.000 caracteres/mes son ~25–30 min de voz con multilingual v2; con Flash o v4 Turbo, el doble.
- Aviso: la página de API dice que la API se factura en USD (0,08 / 0,04 por 1k car.) y la de planes en
  créditos. Cuál aplica a una key de un plan Starter: **sin verificar**; mirar el panel de uso tras la primera tanda.

### 5.10 Fuentes (consultadas el 2026-11-12)

- Voice Design (guía): https://elevenlabs.io/docs/creative-platform/voices/voice-design
- API Design: https://elevenlabs.io/docs/api-reference/text-to-voice/design · Create: https://elevenlabs.io/docs/api-reference/text-to-voice/create
- Síntesis: https://elevenlabs.io/docs/api-reference/text-to-speech/convert · Streaming: https://elevenlabs.io/docs/api-reference/text-to-speech/stream
- Modelos: https://elevenlabs.io/docs/overview/models · v4: https://elevenlabs.io/v4
- Controles (speed, etiquetas): https://elevenlabs.io/docs/best-practices/prompting/controls
- Tipos de voz: https://elevenlabs.io/docs/overview/capabilities/voices
- Precios: https://elevenlabs.io/pricing · https://elevenlabs.io/pricing/api
- Coste de Voice Design: https://elevenlabs.io/docs/help-center/product/voices/voice-design/how-much-does-voice-design-cost
- Política de uso (act. 2026-10-09): https://elevenlabs.io/use-policy · No-Go Voices: https://elevenlabs.io/docs/help-center/legal/what-are-no-go-voices
