# Topología: qué corre dónde y qué sale de la máquina

> **Esbozo** (P-11a, 2026-11-20). Describe la instalación de hoy: todo en un solo equipo. Los perfiles por entorno llegan con el ADR 0032 (P-34, Fase 4), y este documento es su prueba de aceptación. Para los diagramas, ver [`architecture.md`](architecture.md).

## Qué corre y dónde escucha

Todo corre en el equipo de desarrollo. Todo lo que escucha, lo hace solo en `127.0.0.1` salvo que se cambie a propósito ([ADR 0027](adr/0027-autenticacion-token-bus-stt-multicliente.md)).

| Pieza                 | Cómo corre                              | Dónde escucha                                                                    | Qué guarda                                                                                                               |
| --------------------- | --------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `core-host`           | Node, o dentro del binario instalado    | `127.0.0.1:9876` (bus y audio)                                                   | `memory.db` (todos los turnos), el contador de uso de voz y `last-backup.json`. El audio de la voz solo pasa por la RAM. |
| Cliente de escritorio | Navegador o ventana de Tauri            | En desarrollo, Vite sirve la interfaz en `localhost:5173`; instalado, no escucha | Preferencias de la interfaz                                                                                              |
| Ollama                | Proceso del sistema                     | `localhost:11434`                                                                | Los modelos (LLM local, clasificador del router y embeddings de la memoria)                                              |
| Letta                 | Docker (`docker compose`)               | `127.0.0.1:8283`                                                                 | Su Postgres interno, en el volumen `letta_pgdata`                                                                        |
| Whisper               | Docker (`docker compose`, perfil `stt`) | `127.0.0.1:8765`                                                                 | El modelo de transcripción, en su volumen                                                                                |

En desarrollo, los datos del `core-host` están en `packages/core-host/data`. En la app instalada, en la carpeta local de datos de la aplicación.

## Qué sale de la máquina

Con contenido del usuario:

| A dónde               | Cuándo                                                                             | Qué viaja                                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Anthropic (LLM nube)  | Cuando el router manda el turno a la nube                                          | El mensaje, las instrucciones del personaje, el contexto de la memoria y, si se usan, los resultados de las herramientas |
| ElevenLabs (voz)      | En cada respuesta con voz que le toque, como proveedor activo o de respaldo        | El texto de la respuesta                                                                                                 |
| Gemini (voz)          | Solo si está en la cadena de voz ([ADR 0034](adr/0034-tts-gemini-voz-disenada.md)) | El texto de la respuesta                                                                                                 |
| Destino de las copias | Al ejecutar `npm run backup`                                                       | `memory.db`, el volcado de Letta y el manifiesto, **en claro**                                                           |

Sin contenido del usuario:

| A dónde   | Cuándo                                                             | Qué viaja                                           |
| --------- | ------------------------------------------------------------------ | --------------------------------------------------- |
| GitHub    | La app instalada, al abrirse, mira si hay una versión nueva        | La petición del archivo de versiones                |
| Google    | Al arrancar el `core-host`, si Gemini está en la cadena de voz     | La consulta de la caducidad de la voz, con la clave |
| Descargas | La primera vez: modelos de Ollama y de Whisper, imágenes de Docker | Peticiones de descarga                              |

Lo que Shiro **no** envía: el audio del micrófono (lo transcribe Whisper en local), los embeddings (los calcula Ollama en local) ni el contenido de Letta.

Sin revisar todavía: el tráfico propio de las imágenes de terceros (Letta) y lo que puedan hacer las herramientas que ejecutan órdenes cuando se usan.

## Copias de seguridad

El procedimiento está en [`RESTORE.md`](../RESTORE.md). Resumen:

- `npm run backup` copia la memoria local y, si Letta está en marcha, su volcado. El destino es una carpeta de otra unidad u otro equipo por SSH.
- La carpeta de las copias es propia y dedicada. Cuando el script la crea en otro equipo, la deja legible solo para el usuario que copia; una carpeta local, o una que ya existía, se queda con los permisos que tenga. Se conservan las 7 copias más nuevas y, además, la última completa.
- El `core-host` avisa al arrancar si no hay copia o si la última tiene 14 días o más, y lo lleva en el informe de salud (`lastBackup`).
- `npm run backup:restore` pone una copia en el sitio de la memoria local, del Letta en uso o de los dos. No borra nada: lo anterior queda apartado, y sabe volver atrás.
- `npm run reindex-memory` prepara la memoria local para volver a llenar Letta desde ella, cuando Letta es otro o está vacío.

## Ensayos de restauración

Un ensayo es `npm run backup:check` sobre una copia: comprueba los archivos, abre la memoria copiada y restaura el volcado de Letta en un contenedor temporal. Se anota aquí cada vez. Toca cada trimestre y antes de subir Letta de versión.

| Fecha      | Copia ensayada                                              | Memoria   | Letta               | Resultado |
| ---------- | ----------------------------------------------------------- | --------- | ------------------- | --------- |
| 2026-11-20 | Copia local de la memoria de desarrollo, hecha en el ensayo | 70 turnos | 49 tablas, 48 filas | Correcto  |

El ensayo del 2026-11-20 probó el procedimiento en el equipo de desarrollo, con datos de prueba. **Falta el ensayo con una copia traída del destino de verdad**: lo hace el dueño y lo anota en esta tabla.
