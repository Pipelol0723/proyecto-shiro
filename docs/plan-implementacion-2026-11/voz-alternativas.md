# Voz de Shiro: ¿plan gratuito de ElevenLabs, otra opción o pago?

> Consulta: 2026-11-13. Cada dato lleva fuente oficial y fecha; lo que no se pudo comprobar va **sin verificar**.
> Base: tres informes de investigación (opciones locales, nube y ElevenLabs gratis), contrastados con las páginas
> oficiales de los datos que deciden la recomendación, más la lectura de `packages/core/src/modules/tts/`, de
> `packages/core-host/src/{bootstrap.ts,tts/,secrets/}` y del ADR 0020. Complementa `docs/plan-implementacion-2026-11/voz.md`.

## 1. Respuesta directa

1. **El plan gratuito de ElevenLabs no alcanza para el uso previsto**: 10.000 créditos/mes son unos 330 caracteres al día con `eleven_multilingual_v2` (unos 660 con Flash), y se piden «unos pocos miles al día». Sirve para diseñar la voz o como respaldo, no como voz diaria.
2. **Sí hay una opción gratuita mejor que probar antes de pagar**: Gemini 3.8 Flash TTS (o Flash-Lite) en la Gemini API. Su nivel gratuito es oficial («Free of charge»), crea una voz propia **por descripción** (Voice Design, sin clonar a nadie) y controla la emoción con un texto de estilo en cada turno.
3. **Hay un pero**: en el nivel gratuito Google usa el contenido para mejorar sus productos, y los textos de Shiro llevan memoria personal. Además, las cuotas gratuitas de TTS no están publicadas y el acento latino no se ha escuchado. Hay que probarlo una tarde antes de decidir.
4. **Si Gemini convence pero molesta la privacidad o se acaba la cuota**, su nivel de pago es lo más barato que se ha visto (estimación propia: 1-3 USD/mes para el uso previsto; precio de Flash 9 USD por 1 M de tokens de audio hasta el 31-dic-2026, 18 USD desde 2027). **Si Gemini no convence de oído**, el pago a planear es ElevenLabs: Starter (6 USD/mes) con Flash, o Creator (22 USD/mes) si el uso pasa de unos 2.000 caracteres al día.
5. **Lo local, con el portátil de hoy, no sustituye a ElevenLabs**: lo que cabe en CPU (Kokoro, Piper) no da voz propia ni emoción. El candidato local serio (Qwen3-TTS VoiceDesign, Apache-2.0) queda para cuando llegue la GPU de 16 GB.

## 2. Tabla comparativa (candidatas serias)

| Candidata                               | Español latino                                                    | Voz propia sin clonar                                     | Expresividad por emoción                                                      | Latencia (a primer audio)                                                           | Coste para el uso previsto                                                         | Licencia / condiciones                                                             | Esfuerzo de integración                                                                        |
| --------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **ElevenLabs Free** (hoy)               | Sí, variedad pedida en el prompt de diseño; no garantizada        | Sí, Voice Design (incluido en Free, 3 huecos)             | `stability`/`style` (numérico); v4 con etiquetas                              | ~100 ms Flash/v4 Turbo según la doc (sin medir); el código actual no hace streaming | 0 USD, pero 10.000 créditos/mes ≈ 330 car./día: **insuficiente**                   | Free sin licencia comercial; atribución si se publica audio                        | Ninguno (solo YAML)                                                                            |
| **ElevenLabs Starter / Creator**        | Igual                                                             | Igual (10 / 30 huecos)                                    | Igual                                                                         | Igual                                                                               | 6 USD (1 USD el primer mes) → 30.000 créditos; 22 USD → 121.000                    | Licencia comercial                                                                 | Ninguno                                                                                        |
| **Gemini 3.8 Flash / Flash-Lite TTS**   | «Spanish» sin variantes; acento por descripción; **sin escuchar** | Sí, Voice Design (`POST /v1beta/voices`, `type=prompted`) | Alta: `speech_metadata.style` por turno + etiquetas `<sigh>`, `<short pause>` | Streaming disponible; cifra **sin verificar**                                       | Gratis (cuotas TTS sin publicar); pago estimado 1-3 USD/mes                        | Free: el contenido se usa para mejorar productos; voces guardadas con TTL de 1 año | Módulo nuevo (~6-10 h) + ADR                                                                   |
| **Azure AI Speech F0** (es-MX Neural)   | Sí, nativo: Dalia, Beatriz, Candela, Renata… (es-MX)              | No: catálogo + ajuste (pitch, rate)                       | Media: Dalia tiene estilos cheerful/sad/whispering con `styledegree`          | Streaming en SDK; cifra sin verificar                                               | Gratis: 0,5 M car./mes de Neural (cubre ~16.000 car./día)                          | Términos de Azure; cuenta Azure (tarjeta **sin verificar**)                        | Módulo nuevo (~6-8 h) + ADR                                                                    |
| Amazon Polly                            | es-MX Mia, es-US Lupe                                             | No                                                        | Baja (SSML prosody)                                                           | Sin cifra                                                                           | Standard 5 M car./mes gratis sin límite de tiempo; Neural 1 M gratis solo 12 meses | Términos de AWS; firma SigV4                                                       | Módulo nuevo (SDK)                                                                             |
| Deepgram Aura-2                         | Sí, es-mx y es-419 con nombre (Estrella, Olivia, Selena)          | No                                                        | Baja                                                                          | Sin cifra                                                                           | 200 USD de crédito único (~6,6 M car.), luego 30 USD/1 M                           | Sin verificar                                                                      | Módulo nuevo (~4-6 h)                                                                          |
| Kokoro-82M (local, CPU)                 | Una sola voz femenina española (`ef_dora`), G2P español genérico  | No                                                        | Ninguna (solo velocidad)                                                      | Plausible <1 s en CPU, **sin medir** en Ryzen 5 4600H                               | Gratis                                                                             | Pesos Apache-2.0; respaldo espeak-ng GPL-3.0                                       | Microservicio Python o `sherpa-onnx-node` (~1-2 días) + ADR (revierte el descarte de ADR 0020) |
| Qwen3-TTS 1.7B VoiceDesign (local, GPU) | Español sí; latino por descripción (sin verificar)                | Sí, por descripción                                       | Alta (instrucciones en texto)                                                 | ~97 ms en GPU según el fabricante                                                   | Gratis                                                                             | Apache-2.0                                                                         | Microservicio Python (patrón Whisper); **no cabe en la GTX 1650**                              |

Descartadas o rebajadas tras comprobar:

- **Supertonic 3**: el repositorio oficial está **archivado y en solo lectura** («No updates, bug fixes, or support will be provided»). Además los pesos son OpenRAIL-M y no permiten crear una voz propia (Voice Builder dejó de funcionar el 31-ago-2026). El informe local lo daba como candidato; se rebaja a «no recomendado».
- **OpenAI TTS**: deprecado con cierre el 6-ene-2027 y sin capa gratuita.
- **Cartesia (20K créditos/mes gratis), Inworld (70 min), Hume**: capa gratuita menor que la de Gemini o Azure, o sin confirmar en fuente oficial.
- **Google Cloud TTS (Chirp 3 HD)**: no tiene es-MX ni voz por descripción; la página de precios salió truncada.
- **Edge TTS no oficial**: zona gris de condiciones de servicio y puede romperse sin aviso. Solo valdría como parche personal.
- **Piper, MeloTTS, Parler, VoxCPM2, Chatterbox, XTTS, Orpheus**: calidad baja, sin voz propia, exigen clonación, no caben o tienen licencia dudosa (detalle en el informe local).

## 3. Las 3 mejores opciones

### 3.1 Gemini 3.8 Flash TTS con Voice Design (recomendada para probar primero)

- **Pros**: gratis oficialmente; voz propia por descripción, que encaja con el retrato vocal de `voz.md` §5.3; la emoción pasa a ser una frase de estilo («dry, quietly amused») en vez de un número, lo que da más control que `stability`; respuesta sin streaming en WAV de 24 kHz (el cliente ya reproduce un archivo por HTTP, así que no hay que convertir nada); streaming disponible para más adelante. El pago es barato.
- **Contras**: en el nivel gratuito Google usa los textos para mejorar sus productos (privacidad). Las cuotas gratuitas de TTS no están publicadas. El acento latino no se ha escuchado. La voz guardada tiene un TTL de 1 año (la página no dice si se renueva con el uso: **sin verificar**). El precio de pago se duplica el 1-ene-2027. La síntesis con voz diseñada va por la «Interactions API», un endpoint distinto del `generateContent` clásico. El modelo y Voice Design son recientes.
- **Qué hacer**:
  1. Pipe crea la clave en AI Studio. Antes de empezar, mirar si pide tarjeta y qué cuota de TTS aparece en `aistudio.google.com/rate-limit`.
  2. Con un script fuera del repo, crear 2-3 voces con los prompts A/B/C de `voz.md` §5.4 (descripción de 1-2 frases, `language_code` es-419 o es-MX a probar) y escuchar `sample_audio`.
  3. Sintetizar el guion de `voz.md` §5.5 con un `style` por emoción y medir el tiempo al primer audio con `stream: true`.
  4. Decidir de oído contra la voz actual de ElevenLabs.
  5. Solo si gana: ADR e integración (§6).

### 3.2 ElevenLabs: Free para diseñar, Starter/Creator para el uso diario

- **Pros**: ya está integrado (cambiar de voz es solo el YAML); Voice Design probado; calidad conocida; existe un respaldo automático ante 401/429.
- **Contras**: el Free no cubre el uso diario; sin licencia comercial en Free; el coste exacto de una tanda de Voice Design en créditos no está documentado (la ayuda solo dice que se cobra por los caracteres del texto de vista previa); acceso a la API de TTS en Free **sin verificar** en la doc vigente (una página de ayuda antigua dice que sí; la de PAYG dice que algunas APIs están desactivadas en Free, sin nombrar TTS).
- **Qué hacer**: el diseño reducido de §4 en el mes en curso y, si Gemini no gana, pasar a Starter con `eleven_flash_v2_5` (o Creator si hace falta más volumen).

### 3.3 Azure AI Speech F0 con una voz es-MX de catálogo

- **Pros**: es la única opción gratuita con voces **nativas** de México por nombre y cupo de sobra (0,5 M caracteres/mes, unas 50 veces el Free de ElevenLabs); estilos por SSML en Dalia (cheerful, sad, whispering, con `styledegree` de 0,01 a 2) que se pueden mapear a las emociones; Microsoft no entrena con el contenido de los clientes (afirmación general, **sin verificar** para F0).
- **Contras**: no hay voz propia, solo catálogo ajustado con pitch/rate (el encargo lo permite, pero será menos única); los estilos de Dalia no cubren «molesta» ni «pensativa»; las voces más expresivas (HD, MAI-Voice-2) no figuran en el cupo gratis; hay que crear una cuenta de Azure; los precios de pago salen enmascarados en la página oficial.
- **Qué hacer**: escuchar Dalia, Renata y Beatriz en la galería de Azure. Si alguna encaja con «serena y seca», es el plan B gratuito si Gemini falla por privacidad o cuota.

**Vía local (sin fecha)**: cuando llegue la GPU de 16 GB, probar Qwen3-TTS VoiceDesign como microservicio (mismo patrón que `services/whisper`). Hoy, Kokoro (`ef_dora`) solo tendría sentido como respaldo offline mejor que la voz del sistema, y eso reabre lo que el ADR 0020 §1 descartó. No lo recomiendo ahora.

## 4. Diseño de voz reducido que cabe en ElevenLabs Free (10.000 créditos)

Supuestos: 1 crédito por carácter en `eleven_multilingual_v2`; Flash v2.5 por API entre 0,5 y 1 crédito por carácter (rango oficial de la página de precios). Una tanda de diseño cobra los caracteres del texto de vista previa (~390); que sea una vez por tanda y no por cada una de las 3 vistas previas está **sin verificar**.

| Paso      | Qué                                                                                                             | Créditos                                                                |
| --------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1         | 3 tandas de Voice Design (prompts A, B y C, una cada uno) con el texto fijo de ~390 car.                        | ~1.170 (≈3.500 si se cobra por vista previa)                            |
| 2         | Guardar 2 candidatas (huecos; si la voz actual ocupa uno, quedan 2)                                             | 0                                                                       |
| 3         | Guion mínimo por candidata: 5 frases de emoción (~360 car.) + «larga 2» (~200) = ~560 car.; se omite la técnica | —                                                                       |
| 4         | Guion × 2 candidatas × 2 modelos (multilingual v2 y flash v2.5)                                                 | ~1.700-2.240                                                            |
| 5         | Ajuste fino solo de la ganadora: rejilla B (5 frases) + repeticiones                                            | ~960                                                                    |
| **Total** |                                                                                                                 | **~3.800-4.400** (~5.300 con un 20 % de margen; ~7.600 en el peor caso) |

- **Qué cabe**: 3 prompts × 1 tanda, 2 candidatas, comparación en 2 modelos y ajuste de la ganadora. Quedan unos 4.700 créditos ese mes (~155 caracteres al día).
- **Qué no cabe**: la segunda tanda por prompt, la tercera candidata, `eleven_v4`/`v4_turbo` en la comparación (coste en créditos **sin verificar**), la frase técnica larga y, en la práctica, el uso diario de Shiro ese mes. El presupuesto original de `voz.md` §5.9 (10.000-12.000) no cabe.
- **Regla de parada**: después de la primera tanda, leer el saldo (panel o `GET /v1/user/subscription`). Si costó unos 1.170 créditos, seguir. Si costó unos 3.500 (cobro por vista previa), limitarse a los prompts A y C y a 1 candidata en 2 modelos (unos 3.500 en total).
- **Consejo**: hacer el diseño al principio del ciclo de facturación y usar Shiro ese mes con la voz del sistema, o bien hacer el diseño con un mes de Starter (1 USD el primer mes) y bajar a Free después. Qué pasa con las voces guardadas al bajar de plan está **sin verificar**: guardar el MP3 de la vista previa elegida y la receta fuera del repo.
- Si se prueba Gemini (§3.1), el diseño ahí no consume créditos de ElevenLabs. Conviene probar Gemini **antes** de gastar en este ejercicio.

## 5. Criterio para pasar a un plan de pago (y cuál)

Pasar a pago cuando se cumpla **cualquiera** de estas condiciones:

1. Más de 2-3 días al mes con cuota agotada (429 → salta la voz del sistema) usando Shiro con normalidad.
2. Pipe no acepta que los textos de Shiro sirvan para entrenar a Google en el nivel gratuito.
3. Ninguna voz gratuita (Gemini Free, Azure F0) pasa la escucha a ciegas del guion de `voz.md` §5.5.

Cuál:

| Situación                                                      | Plan                                        | Coste                                                                                                                                                                                          |
| -------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| La voz de Gemini gana de oído y falla la cuota o la privacidad | Gemini API de pago (Flash o Flash-Lite TTS) | Estimación propia: ~1-3 USD/mes (~3.000 car./día ≈ 200 s de audio/día; a ~25 tokens de audio/s, dato **sin verificar**, ≈ 150 K tokens/mes → 1,35 USD con Flash en 2026 y 2,70 USD desde 2027) |
| Gana ElevenLabs y el uso es ≤ ~2.000 car./día                  | ElevenLabs Starter con `eleven_flash_v2_5`  | 6 USD/mes (1 USD el primer mes), 30.000 créditos                                                                                                                                               |
| Gana ElevenLabs y el uso es ~2.000-4.000 car./día              | ElevenLabs Creator                          | 22 USD/mes (11 USD el primer mes según el informe; **sin verificar** hoy), 121.000 créditos                                                                                                    |

Pagar lo decide y lo hace Pipe.

## 6. Qué cambiaría en el repo en cada caso

Estado actual leído:

- `ElevenLabsTTS` (`packages/core/src/modules/tts/elevenlabs-tts.ts`) implementa `ITTSModule` y pide el MP3 completo, sin streaming.
- La emoción solo cambia `stability` (`resolveStability`, leído de `emotions.<x>.tts_stability` en el esquema del personaje, `packages/core/src/character/schema.ts:46`).
- `bootstrap.ts` registra `ElevenLabsTTS` y `SystemTTS` en el loader y **construye la cadena a mano** (`fallbacks: [systemTts]`, `bootstrap.ts:282-287`): no lee `fallback_chain` del YAML.
- La clave entra por `MANAGED_KEYS = ['ANTHROPIC_API_KEY','ELEVENLABS_API_KEY']` (`core-host/src/secrets/secrets-file.ts:25`), y `system:health`/`SetupScreen.tsx` la comprueban.
- El comentario de `ITTSModule.ts` y el del YAML mencionan el descarte de Kokoro.

| Caso                                         | Cambios                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | ADR                                                                                                                                                                                                                                                       |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ElevenLabs (Free o pago), voz nueva**      | `config/modules.config.yaml`: `voice_id`, `model_id` (`eleven_flash_v2_5` si gana). `default.yaml`: `tts_stability`. Opcional: campo `speed` en el esquema + tests (~2 h). README: quitar `eleven_turbo_v2_5`. Receta en `docs/design/shiro-voz-receta.md`.                                                                                                                                                                                                                                                                                                                                                                             | No (ADR 0020 §6). Si se añade `speed`/`style` por emoción, una nota de enmienda corta en 0020.                                                                                                                                                            |
| **Gemini TTS como voz principal**            | Nuevo `packages/core/src/modules/tts/gemini-tts.ts` (`fetch`, WAV en la respuesta sin streaming, `voice_id` de Voice Design, `model_id`, timeout, errores 401/429 como hoy) + tests con fetch simulado. Registrar `GeminiTTS` en `bootstrap.ts`. Esquema del personaje: campo opcional por emoción `tts_style` (texto). `GEMINI_API_KEY` en `MANAGED_KEYS`, `system-health.ts`, `events.ts` (health) y `SetupScreen.tsx`. Que la cadena salga del YAML (`fallback_chain: [ElevenLabsTTS, SystemTTS]`) en vez de estar fija en `bootstrap.ts`. Script de creación de voz **fuera del repo**. README/architecture/CLAUDE.md. Unas 6-10 h. | **ADR nuevo** (siguiente número libre; hoy 0030): servicio externo nuevo, datos que salen a Google, patrón de emoción como texto de estilo y cadena configurable. Marca 0020 §1 y §5 como «Superseded by NNNN» (parcial); el resto de 0020 sigue vigente. |
| **Azure F0**                                 | Nuevo `azure-tts.ts` (REST con SSML: `<voice>`, `mstts:express-as style/styledegree`, `prosody rate/pitch`; clave + región). Mapeo por emoción en el personaje (`tts_style`, `tts_styledegree`, `tts_rate`). Clave `AZURE_SPEECH_KEY`/región en secretos y health. Misma refactorización de la cadena. Unas 6-8 h.                                                                                                                                                                                                                                                                                                                      | **ADR nuevo**, igual que Gemini.                                                                                                                                                                                                                          |
| **Local (Kokoro ahora / Qwen3-TTS con GPU)** | Microservicio Python en `services/tts-local/` (patrón Whisper: Docker, health `ping()`) o `sherpa-onnx-node` dentro del core-host. Módulo `LocalTTS` HTTP. Mapeo de emoción a velocidad (Kokoro) o a instrucción de texto (Qwen3). Actualizar los comentarios de `ITTSModule.ts` y del YAML. 1-2 días.                                                                                                                                                                                                                                                                                                                                  | **ADR nuevo**: revierte el descarte de Kokoro (0020 §1, «Alternativas consideradas») o abre el hito local post-GPU.                                                                                                                                       |

Recomendación de diseño para cualquier proveedor nuevo: generalizar el bloque `emotions:` del personaje para que cada proveedor lea su propio campo (`tts_stability`, `tts_style`…) sin romper los existentes. Fija un patrón y entra en el mismo ADR.

## 7. Sin verificar

- Cuotas gratuitas de TTS de Gemini (RPM/RPD) y si piden tarjeta; si Voice Design funciona en el nivel gratuito (la página de Voice Design no lo dice).
- Calidad y acento latino reales de Gemini TTS, de las voces es-MX de Azure y de Kokoro `ef_dora` (nadie las ha escuchado).
- Latencia real al primer audio de Gemini, Azure y ElevenLabs Flash/v4 Turbo desde la red de Pipe; RTF de Kokoro en el Ryzen 5 4600H.
- Tokens de audio por segundo de Gemini (la estimación de 1-3 USD/mes depende de esto) y el precio de los tokens de entrada de texto.
- Si el TTL de 1 año de las voces de Gemini se renueva con el uso.
- ElevenLabs: acceso a la API de TTS en Free según la doc vigente; si Voice Design cobra una vez por tanda o por cada vista previa; coste en créditos de v4/v4 Turbo; qué pasa con las voces diseñadas al bajar de plan; precio del primer mes de Creator.
- Azure: si F0 pide tarjeta; precios de pago (la página los enmascara); si las voces HD/MAI-Voice-2 entran en F0; política de uso de datos en F0.
- Licencias de terceros no leídas completas: OpenRAIL-M (Supertonic), términos de la Gemini API, términos de Azure/AWS/Deepgram.
- Cifras de los informes que no se recomprobaron hoy: Deepgram (200 USD sin tarjeta), Cartesia, Inworld, Hume, Qwen3-TTS (requisitos en Windows/CPU), VoxCPM2.

## 8. Fuentes (consultadas el 2026-11-13)

- ElevenLabs: https://elevenlabs.io/pricing · https://elevenlabs.io/docs/overview/administration/pay-as-you-go · https://elevenlabs.io/docs/help-center/product/voices/voice-design/how-much-does-voice-design-cost · https://elevenlabs.io/docs/help-center/legal/can-i-publish-the-content-i-generate-on-the-platform.md (vía informe) · https://help.elevenlabs.io/hc/en-us/articles/28184926326033-How-much-does-it-cost-to-use-the-API (antigua)
- Gemini: https://aistudio.google.com/docs/pricing · https://aistudio.google.com/docs/voice-design · https://aistudio.google.com/docs/speech-generation · https://aistudio.google.com/docs/rate-limits (no da cuotas de TTS)
- Azure: https://azure.microsoft.com/en-us/pricing/details/speech/ · https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=tts · https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-synthesis-markup-voice
- Amazon Polly: https://aws.amazon.com/polly/pricing/
- Kokoro: https://huggingface.co/hexgrad/Kokoro-82M · https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md
- Supertonic: https://github.com/supertone-inc/supertonic (repositorio archivado)
- Qwen3-TTS: https://github.com/QwenLM/Qwen3-TTS (vía informe, 2026-11-12)
- Repo: `docs/adr/0020-…md` §1, §5, §6; `packages/core/src/modules/tts/elevenlabs-tts.ts`; `packages/core/src/interfaces/ITTSModule.ts`; `packages/core-host/src/bootstrap.ts:128-139, 276-289`; `packages/core-host/src/secrets/secrets-file.ts:25`; `config/modules.config.yaml:56-71`; `docs/plan-implementacion-2026-11/voz.md`.
