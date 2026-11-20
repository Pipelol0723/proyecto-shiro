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

| Turno | Respuesta (caracteres) | `route` | `context` | `llm` | `persist` | `tts` | `resto` | `total` |
| ------: | --------: | ----: | --------: | ----: | ------: | ------: |
| 2013 | 2 | 11555 | 39 | 808 | 40 | 14457 |

- Cargar el modelo cuesta unos 8 segundos más en `llm` que la mediana en caliente (11,6 s frente a 3,3 s).
- El clasificador agotó su plazo de 2 s (`route` = 2013) y el turno se decidió con la regla de respaldo.
- Solo pasa una vez: después el modelo se queda cargado 30 minutos.

## Dónde se va el tiempo

Con la mediana de la línea base:

| Etapa                | Tiempo | Parte del total |
| -------------------- | -----: | --------------: |
| Generar la respuesta |  3,3 s |            59 % |
| Sintetizar la voz    |  1,4 s |            25 % |
| Elegir modelo        |  0,9 s |            16 % |
| Memoria y guardar    |   1 ms |             0 % |

- **La respuesta del modelo local es lo que más pesa**, y crece con su longitud: 2,4 s para 34 caracteres, 3,5 s para 302.
- **Elegir modelo cuesta casi un segundo en cada turno**, aunque la respuesta sea una frase. Es una llamada entera al modelo solo para decidir. El atajo para mensajes cortos (P-36) se la ahorraría a mensajes como los cinco de esta medición; cuántos turnos reales son así no está medido.
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

- **Con respuestas largas, la voz rápida tarda entre la mitad y dos tercios**: 1,1 s frente a 2,3 s para 302 caracteres, 1,0 s frente a 1,9 s para 247 y 0,8 s frente a 1,3 s para 180.
- **Con una frase corta no hay diferencia**: las dos rondan los 0,7 o 0,8 s, que es lo que cuesta la llamada en sí.
- **Hubo un caso lento** (turno 2, 2,3 s). Con cinco turnos no se puede saber si es habitual.
- **En esos tres turnos comparables la voz tardó entre 0,4 y 1,2 s menos** (0,9 s de mediana). Si lo demás no cambia, eso es lo que baja el total del turno.
- Son tres comparaciones: bastan para ver la tendencia, no para dar una cifra.
- El README menciona también `eleven_turbo_v2_5` como opción de menor latencia. No se ha medido.

**No se ha evaluado cómo suena.** La medición fue sin escuchar. Antes de cambiar el modelo por defecto hay que oír las dos voces con el mismo texto.

## Lo que esta medición no cubre

- **Son pocos datos**: cinco turnos por tanda, un solo arranque en frío, una máquina y un rato. La red y el proveedor de voz varían y eso no está controlado.
- **Qué alarga `llm`**: crece con la longitud de la respuesta, pero el turno más corto fue también el primero de cada tanda. El contexto sí era igual en todos: los 10 turnos recientes, llenos desde el principio.
- **Con varias copias del cliente abiertas**, el primer audio es el de la primera que empieza a sonar, no necesariamente la que escuchas.
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
