# Topología: qué corre dónde y qué sale de la máquina

> **Esbozo** (P-11a, 2026-11-20). Describe la instalación de hoy: todo en un solo equipo. Los perfiles por entorno llegan con el ADR 0032 (P-34, Fase 4), y este documento es su prueba de aceptación. Para los diagramas, ver [`architecture.md`](architecture.md).

## Qué corre y dónde escucha

Todo corre en el equipo de desarrollo. Todo lo que escucha, lo hace solo en `127.0.0.1` salvo que se cambie a propósito ([ADR 0027](adr/0027-autenticacion-token-bus-stt-multicliente.md)).

| Pieza                 | Cómo corre                              | Dónde escucha                  | Qué guarda                                                                                        |
| --------------------- | --------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------- |
| `core-host`           | Node, o dentro del binario instalado    | `127.0.0.1:9876` (bus y audio) | `memory.db` (todos los turnos), la caché de audio, el contador de uso de voz y `last-backup.json` |
| Cliente de escritorio | Navegador o ventana de Tauri            | No escucha                     | Preferencias de la interfaz                                                                       |
| Ollama                | Proceso del sistema                     | `localhost:11434`              | Los modelos (LLM local, clasificador del router y embeddings de la memoria)                       |
| Letta                 | Docker (`docker compose`)               | `127.0.0.1:8283`               | Su Postgres interno, en el volumen `letta_pgdata`                                                 |
| Whisper               | Docker (`docker compose`, perfil `stt`) | `127.0.0.1:8765`               | El modelo de transcripción, en su volumen                                                         |

En desarrollo, los datos del `core-host` están en `packages/core-host/data`. En la app instalada, en la carpeta local de datos de la aplicación.

## Qué sale de la máquina

| A dónde               | Cuándo                                                                                    | Qué viaja                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Anthropic (LLM nube)  | Cuando el router manda el turno a la nube                                                 | El mensaje, las instrucciones del personaje, el contexto de la memoria y, si se usan, los resultados de las herramientas |
| ElevenLabs (voz)      | En cada respuesta con voz, mientras sea el proveedor activo                               | El texto de la respuesta                                                                                                 |
| Gemini (voz)          | Solo si se activa como proveedor de voz ([ADR 0034](adr/0034-tts-gemini-voz-disenada.md)) | El texto de la respuesta                                                                                                 |
| Destino de las copias | Al ejecutar `npm run backup`                                                              | `memory.db`, el volcado de Letta y el manifiesto, **en claro**                                                           |

Lo que **no** sale: el audio del micrófono (lo transcribe Whisper en local), los embeddings (los calcula Ollama en local) ni el contenido de Letta.

## Copias de seguridad

El procedimiento está en [`RESTORE.md`](../RESTORE.md). Resumen:

- `npm run backup` copia la memoria local y, si Letta está en marcha, su volcado. El destino es una carpeta de otra unidad u otro equipo por SSH.
- La carpeta de las copias es propia y dedicada, legible solo para el usuario que copia. Se conservan las 7 más nuevas y, además, la última completa.
- El `core-host` avisa al arrancar si no hay copia o si la última tiene 14 días o más, y lo lleva en el informe de salud (`lastBackup`).

## Ensayos de restauración

Un ensayo es `npm run backup:check` sobre una copia: comprueba los archivos, abre la memoria copiada y restaura el volcado de Letta en un contenedor temporal. Se anota aquí cada vez. Toca cada trimestre y antes de subir Letta de versión.

| Fecha      | Copia ensayada                                              | Memoria   | Letta               | Resultado |
| ---------- | ----------------------------------------------------------- | --------- | ------------------- | --------- |
| 2026-11-20 | Copia local de la memoria de desarrollo, hecha en el ensayo | 70 turnos | 49 tablas, 48 filas | Correcto  |

El ensayo del 2026-11-20 probó el procedimiento en el equipo de desarrollo, con datos de prueba. **Falta el ensayo con una copia traída del destino de verdad**: lo hace el dueño y lo anota en esta tabla.
