# Copia de seguridad y restauración de la memoria

La memoria de Shiro es lo único del proyecto que no se regenera. Este documento dice cómo copiarla, cómo comprobar que la copia sirve y cómo restaurarla.

Todo lo de aquí se ejecuta en Windows PowerShell, desde la raíz del repositorio y con el Node de `.node-version`.

## Qué lleva una copia

Una carpeta con nombre de fecha (`20261120T083005Z`, en UTC) y tres archivos:

| Archivo         | Qué es                                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `memory.db`     | La memoria local (SQLite): todos los turnos de conversación. Es una instantánea coherente, sacada con la app abierta o cerrada.      |
| `letta.dump`    | El volcado del Postgres de Letta (`pg_dump`). Solo si Letta estaba en marcha al copiar.                                              |
| `manifest.json` | El hash de cada archivo, cuántos turnos hay, la imagen de Letta, las filas de cada tabla de Letta y los modelos de Ollama que había. |

Una copia sin `letta.dump` es **parcial**. Protege el historial, porque la memoria local guarda todos los turnos; le falta lo que Letta elabora por su cuenta.

**No se copian** los modelos de Ollama ni de Whisper (se vuelven a descargar; el manifiesto anota cuáles eran), ni `.env`, ni `secrets.env`.

**La copia lleva el historial en claro.** Guárdala donde solo la leas tú.

## Hacer una copia

A una carpeta de este equipo o de otra unidad:

```powershell
npm run backup -- -Destination E:\shiro-backup -CreateDestination
```

A otro equipo con Windows y OpenSSH. El equipo, el usuario y la clave no están en el repositorio: se pasan por variables de entorno o con `-RemoteHost`, `-RemoteUser` y `-KeyFile`.

```powershell
$env:SHIRO_BACKUP_HOST = '<equipo>'
$env:SHIRO_BACKUP_USER = '<usuario>'
$env:SHIRO_BACKUP_KEY = "$env:USERPROFILE\.ssh\<clave>"
npm run backup -- -CreateDestination
```

- `-CreateDestination` solo hace falta la primera vez. Sin él, el script no crea la carpeta de las copias: sale con el código 3. En otro equipo la crea en `C:\shiro-backup` (se cambia con `-RemoteDir`), legible solo para tu usuario.
- Por defecto copia la memoria de desarrollo (`packages/core-host/data/memory.db`). Con `-Installed` copia la de la app instalada. Con `-MemoryDb <ruta>`, la que le digas.
- Para una copia completa, Letta tiene que estar en marcha (`docker compose up -d`). Si no lo está, o su volcado falla, la copia se hace igual y queda parcial. Con `-RequireLetta` eso es un error.
- Conserva las 7 copias más nuevas (`-Keep`) y, además, la última completa. Solo retira carpetas con nombre de copia y con su manifiesto.
- Al terminar anota la copia en `last-backup.json`, al lado de `memory.db`. El `core-host` lo lee: avisa al arrancar si no hay copia o si la última tiene 14 días o más.

Códigos de salida:

| Código | Qué pasó                                                                              |
| ------ | ------------------------------------------------------------------------------------- |
| 0      | Copia hecha y comprobada en el destino. Puede ser parcial (sin Letta): lo dice.       |
| 1      | Error. La copia no se da por hecha.                                                   |
| 2      | El otro equipo no responde (apagado o sin cable). No es un error: se repite otro día. |
| 3      | La carpeta de las copias no existe y no se pidió crearla.                             |

**Cuándo:** después de cada sesión de uso que quieras conservar, y siempre **antes de subir Letta de versión**.

## Ensayar la restauración (sin tocar nada)

Una copia que no se ha restaurado nunca no es una copia. El ensayo comprueba que la copia se restaura, sin tocar la memoria ni el Letta en uso.

Si la copia está en otro equipo, tráela primero a una carpeta temporal **que no exista** (si existe, `scp` mete la copia dentro y el ensayo no la encuentra):

```powershell
scp -i <clave> -r <usuario>@<equipo>:C:/shiro-backup/<nombre> $env:TEMP\shiro-ensayo
```

Y ensáyala:

```powershell
npm run backup:check -- -Backup $env:TEMP\shiro-ensayo
```

El ensayo hace tres cosas:

1. Comprueba que los archivos coinciden con el manifiesto.
2. Abre la memoria copiada, le pasa la comprobación de SQLite y cuenta los turnos.
3. Si la copia lleva `letta.dump`, arranca un Letta temporal con la misma imagen y sin puertos, restaura el volcado en una base aparte y compara las filas de cada tabla con las que había al copiar. Al terminar borra ese contenedor y su volumen.

Códigos de salida del ensayo:

| Código | Qué pasó                                                                                                        |
| ------ | --------------------------------------------------------------------------------------------------------------- |
| 0      | Todo lo que lleva la copia se ha comprobado y se restaura bien.                                                 |
| 1      | Algo no cuadra o falló. La copia no sirve tal cual.                                                             |
| 2      | Lo comprobado está bien, pero falta una parte: se pidió `-SkipLetta`, o la copia no lleva el recuento de Letta. |

Una copia sin `letta.dump` sale con 0 si su memoria está bien: se ha comprobado todo lo que lleva, y el ensayo dice que no lleva Letta.

Anota la fecha y los recuentos en [`docs/topologia.md`](docs/topologia.md) y borra la carpeta temporal, que lleva el historial en claro:

```powershell
Remove-Item $env:TEMP\shiro-ensayo -Recurse
```

El ensayo se repite cada trimestre (P-43 del plan de mejora) y antes de cualquier subida de Letta.

## Restaurar de verdad

**Todavía no hay una orden para esto, y no conviene hacerlo a mano.** Llega con `npm run backup:restore`, la parte de P-11a que sigue a esta.

Por qué no a mano. Al escribir este documento se ensayaron los pasos y se revisaron uno a uno, y en los dos sitios hay maneras de estropear la restauración sin que nada avise:

- **La memoria local.** Si al lado de la `memory.db` restaurada se queda un `memory.db-wal` de la memoria anterior, SQLite lo aplica encima: la app abre sin errores y enseña los turnos de antes, no los de la copia. Hay que apartar los tres archivos (`memory.db`, `memory.db-wal` y `memory.db-shm`) y comprobar que no queda ninguno antes de copiar.
- **Letta.** Restaurar encima de la base en uso con `pg_restore --clean` termina con cientos de errores y la base sin tablas (probado el 2026-11-20 en un Letta temporal). Lo que funciona es restaurar en una base aparte, cambiarla por la que hay en una sola transacción y reiniciar Letta. Hecho a mano, una orden que falla no para a las siguientes.
- **Las dos a la vez.** La memoria local anota qué turnos se han enviado ya a Letta. Si se restaura una memoria y un Letta de copias distintas, hay turnos que constan como enviados y que ese Letta no tiene: no se reenvían solos.

Si necesitas restaurar antes de que exista la orden, pide ayuda con la copia delante y **no borres nada**: ni la memoria que hay, ni el volumen de Letta, ni las copias.

## Si la imagen de Letta no trajera `pg_dump`

La imagen fijada hoy lo trae (comprobado el 2026-11-20: PostgreSQL 15). Tras subir Letta de versión, compruébalo antes de fiarte de la copia:

```powershell
docker exec <contenedor de Letta> sh -c "command -v pg_dump"
```

Si no está, la alternativa es copiar el volumen `letta_pgdata` con el contenedor parado (`docker compose stop letta`), o hacer el volcado desde un contenedor auxiliar de Postgres de la misma versión mayor.

## Lo que no se ha probado

- La primera copia a otro equipo: crear allí la carpeta con sus permisos, enviar con `scp`, comprobar los hashes y rotar. En local y contra un Docker de pruebas sí está probado; contra el otro equipo, solo la llegada por SSH y la forma de la ruta.
- Una carpeta de copias remota con espacios en la ruta. La de por defecto no los tiene.
