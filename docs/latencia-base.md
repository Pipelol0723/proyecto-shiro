# Línea base de latencia

Cuánto tarda hoy un turno de Shiro, etapa por etapa. Es el punto de partida para saber si un cambio mejora o empeora la latencia: antes de optimizar nada, se repite esta medición y se compara.

Pedida por P-16 del [plan de mejora](plan-mejora-2026-11.md) (gate de la Fase 2, punto 5).

## Cómo se mide

Cada turno deja dos líneas en el log del core-host:

```text
turno <id> (local): route=890ms context=1ms llm=2372ms persist=1ms tts=703ms resto=1ms total=3968ms
turno <id>: primer audio a los 4005 ms
```

| Etapa          | Qué incluye                                                                       |
| -------------- | --------------------------------------------------------------------------------- |
| `route`        | Decidir si responde el modelo local o el de la nube (una llamada al clasificador) |
| `context`      | Leer la memoria: lo reciente (SQLite) y los recuerdos parecidos (Letta)           |
| `llm`          | Generar la respuesta                                                              |
| `persist`      | Guardar la respuesta                                                              |
| `tts`          | Sintetizar la voz y dejar el audio listo para pedirse                             |
| `resto`        | Lo que no es de ninguna etapa: emitir los eventos del turno                       |
| `total`        | Desde que llega el mensaje hasta que el audio está listo                          |
| `primer audio` | Desde que llega el mensaje hasta que la voz empieza a sonar en un cliente         |

El chat enseña lo mismo: junto a cada respuesta, el tiempo hasta el texto y el tiempo hasta la voz, con el desglose al pasar el ratón.

## Condiciones de la medición (2026-11-20)

- **Equipo**: el portátil de desarrollo (Ryzen 5 4600H, 16 GB, GTX 1650 de 4 GB). Todo en la misma máquina.
- **Modelo local**: `qwen2.5:3b` en Ollama 0.31.2, el mismo para responder y para clasificar. `ollama ps` durante la medición: 2,2 GB, 100 % en GPU, contexto de 4096 y descarga a los 30 minutos (las opciones de P-16 se aplican). La GPU tenía 2254 de 4096 MiB en uso.
- **Voz**: ElevenLabs, modelo `eleven_multilingual_v2` (la configuración por defecto).
- **Memoria**: Letta apagado. El contexto son los 10 turnos recientes de SQLite, sin recuerdos parecidos.
- **Entrada**: texto escrito, no voz. No hay etapa de transcripción.
- **Cliente**: el de desarrollo, en un navegador de la misma máquina.
- **Frases**: cinco preguntas cortas de conversación, las mismas en todas las tandas. Todas fueron al modelo local.

## Línea base: cinco turnos en caliente

Con el modelo ya cargado.

| Turno   | Respuesta (caracteres) | `route` | `context` | `llm` | `persist` | `tts` | `total` | Primer audio |
| ------- | ---------------------: | ------: | --------: | ----: | --------: | ----: | ------: | -----------: |
| 1       |                     34 |     890 |         1 |  2372 |         1 |   703 |    3968 |         4005 |
| 2       |                    227 |     901 |         1 |  3313 |         0 |  1398 |    5614 |         5629 |
| 3       |                    302 |     901 |         2 |  3526 |         0 |  2286 |    6717 |         6733 |
| 4       |                    247 |    1041 |         2 |  3355 |         0 |  1862 |    6261 |         6282 |
| 5       |                    180 |    1024 |         1 |  3068 |         0 |  1281 |    5375 |         5394 |
| Mediana |                    227 |     901 |         1 |  3313 |         0 |  1398 |    5614 |         5629 |

Tiempos en milisegundos.

**Desde que envías el mensaje hasta que oyes la voz pasan entre 4 y 7 segundos; la mediana es 5,6 s.**

Una tanda anterior con las mismas frases dio totales de 3608, 6689, 5746, 5599 y 5849 ms: la medida se repite.

## Arranque en frío

El primer turno tras arrancar Ollama, con el modelo sin cargar:

| `route` | `context` | `llm` | `persist` | `tts` | `total` |
| ------: | --------: | ----: | --------: | ----: | ------: |
|    2013 |         2 | 11555 |        39 |   808 |   14457 |

- Cargar el modelo cuesta unos 9 segundos más en `llm`.
- El clasificador agotó su plazo de 2 s (`route` = 2013) y el turno se decidió con la regla de respaldo.
- Solo pasa una vez: después el modelo se queda cargado 30 minutos.

## Dónde se va el tiempo

Con la mediana de la línea base:

| Etapa                | Tiempo | Parte del total |
| -------------------- | -----: | --------------: |
| Generar la respuesta |  3,3 s |            59 % |
| Sintetizar la voz    |  1,4 s |            25 % |
| Elegir modelo        |  0,9 s |            16 % |
| Memoria y guardar    |   2 ms |             0 % |

- **La respuesta del modelo local es lo que más pesa**, y crece con su longitud: 2,4 s para 34 caracteres, 3,5 s para 302.
- **Elegir modelo cuesta casi un segundo en cada turno**, aunque la respuesta sea una frase. Es una llamada entera al modelo solo para decidir. El atajo para mensajes cortos (P-36) se la ahorraría a la mayoría de los turnos.
- **La voz crece con la longitud de la respuesta**: 0,7 s para una frase, 2,3 s para un párrafo.
- **La memoria local y el guardado no cuentan**: 1 o 2 ms.
- **Del audio listo a la voz sonando hay entre 15 y 40 ms**: descargar y empezar a reproducir, en local, es despreciable.

## Prueba de la voz rápida

Misma tanda cambiando solo el modelo de voz a `eleven_flash_v2_5` (en el YAML: `tts.config.model_id`).

| Turno   | Respuesta (caracteres) | `tts` con `multilingual_v2` | `tts` con `flash_v2_5` |
| ------- | ---------------------: | --------------------------: | ---------------------: |
| 1       |                     34 |                         703 |                    791 |
| 2       |              227 / 250 |                        1398 |                   2264 |
| 3       |                    302 |                        2286 |                   1065 |
| 4       |                    247 |                        1862 |                    952 |
| 5       |                    180 |                        1281 |                    843 |
| Mediana |                        |                        1398 |                    952 |

Las respuestas de los turnos 1, 3, 4 y 5 tuvieron la misma longitud en las dos tandas, así que esos cuatro se comparan directamente. La del turno 2 fue distinta.

- **Con respuestas largas, la voz rápida tarda la mitad**: 1,1 s frente a 2,3 s para 302 caracteres.
- **Con una frase corta no hay diferencia**: las dos rondan los 0,7 o 0,8 s, que es lo que cuesta la llamada en sí.
- **Hubo un caso lento** (turno 2, 2,3 s). Con cinco turnos no se puede saber si es habitual.
- **En el total del turno ahorra en torno a medio segundo** en respuestas de más de 150 caracteres.

**No se ha evaluado cómo suena.** La medición fue sin escuchar. Antes de cambiar el modelo por defecto hay que oír las dos voces con el mismo texto.

## Lo que esta medición no cubre

- **La entrada por voz**: el tiempo de transcribir con Whisper no está medido ni forma parte de las etapas.
- **Letta encendido**: con recuerdos parecidos, `context` deja de ser 1 ms. Su plazo es de 1,5 s.
- **El modelo de la nube**: ningún turno fue a Claude.
- **El binario instalado**: se midió con el cliente de desarrollo.
- **Respuestas con herramientas**.
- **Una respuesta vacía**: en una de las tandas, el modelo local devolvió un texto vacío al primer «hola» y la app lo entregó tal cual, sin voz y sin aviso. No es de latencia, pero salió aquí.

## Cómo repetirla

1. Arranca Ollama y la app como siempre, con tus claves.
2. Envía un mensaje de calentamiento y espera a que termine.
3. Envía las frases de prueba, una a una, esperando a que acabe la voz de cada una.
4. Copia del log del core-host las líneas que empiezan por `turno`.

Las frases de esta medición: «¿Cómo estás hoy?», «Cuéntame algo curioso sobre los gatos.», «¿Qué me recomiendas para concentrarme al estudiar?», «Dime un color y por qué te gusta.» y «¿Qué harías en un día de lluvia?».
