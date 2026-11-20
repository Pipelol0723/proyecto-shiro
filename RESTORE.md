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
| 0      | Copia hecha y comprobada en el destino.                                               |
| 1      | Error. No se anota nada.                                                              |
| 2      | El otro equipo no responde (apagado o sin cable). No es un error: se repite otro día. |
| 3      | La carpeta de las copias no existe y no se pidió crearla.                             |

**Cuándo:** después de cada sesión de uso que quieras conservar, y siempre **antes de subir Letta de versión**.

## Ensayar la restauración (sin tocar nada)

Una copia que no se ha restaurado nunca no es una copia. El ensayo comprueba que la copia se restaura, sin tocar la memoria ni el Letta en uso.

Si la copia está en otro equipo, tráela primero a una carpeta temporal:

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

Sale con el código 0 si la copia se restaura bien. Anota la fecha y los recuentos en [`docs/topologia.md`](docs/topologia.md) y borra la carpeta temporal, que lleva el historial en claro:

```powershell
Remove-Item $env:TEMP\shiro-ensayo -Recurse
```

El ensayo se repite cada trimestre (P-43 del plan de mejora) y antes de cualquier subida de Letta.

## Restaurar de verdad

Primero ensaya la copia que vas a restaurar. Después, con **Shiro cerrado** (la app o `npm run dev`):

### 1. La memoria local

En la carpeta de datos (`packages\core-host\data` en desarrollo; `%LOCALAPPDATA%\com.pipelol.proyecto-shiro\data` en la app instalada):

```powershell
New-Item -ItemType Directory antes | Out-Null
Move-Item memory.db, memory.db-wal, memory.db-shm antes -ErrorAction SilentlyContinue
Copy-Item <copia>\memory.db memory.db
```

Los archivos `memory.db-wal` y `memory.db-shm` de la memoria anterior **no pueden quedarse** al lado de la restaurada: SQLite intentaría aplicarlos sobre ella. Por eso se apartan los tres.

Al arrancar, Shiro enseña el historial de la copia. Si la copia es de un esquema anterior, la migra sola y deja al lado una copia previa a la migración.

### 2. Letta

El volcado se restaura en un Letta **de la misma imagen** que el de la copia (está en el manifiesto, en `letta.image`, y es la que fija `docker-compose.yml`). Con el contenedor de Letta en marcha:

```powershell
$c = docker ps --filter "label=com.docker.compose.service=letta" --format "{{.Names}}"
docker cp <copia>\letta.dump "${c}:/tmp/letta.dump"
docker cp scripts\backup\letta-swap.sql "${c}:/tmp/letta-swap.sql"
docker exec $c sh -c 'createdb -U $POSTGRES_USER letta_restaurada && pg_restore -U $POSTGRES_USER -d letta_restaurada --no-owner /tmp/letta.dump'
docker exec $c sh -c 'psql -U $POSTGRES_USER -d postgres -v ON_ERROR_STOP=1 --single-transaction -f /tmp/letta-swap.sql'
docker restart $c
```

Qué hace cada paso:

1. Lleva al contenedor el volcado y el SQL del intercambio.
2. Restaura el volcado en una base nueva, `letta_restaurada`. La base en uso no se toca todavía.
3. Intercambia las bases en una sola transacción: la que había pasa a llamarse `letta_antes` y la restaurada pasa a ser `letta`. Si algo falla, no cambia nada.
4. Reinicia Letta para que abra la base restaurada.

Si el intercambio dice que la base está en uso, repite esa orden: Letta abrió una conexión entre dos pasos. Si dice que `letta_antes` ya existe, es de una restauración anterior: bórrala (abajo) y repite.

Cuando hayas comprobado que Shiro recuerda lo que debe, borra la base anterior:

```powershell
docker exec $c sh -c 'dropdb -U $POSTGRES_USER letta_antes'
```

**No restaures encima de la base en uso** con `pg_restore --clean`. Probado el 2026-11-20 en un Letta temporal: termina con cientos de errores y la base se queda sin tablas.

### 3. Si Letta no se puede restaurar

Pasa si solo hay copias parciales, o si el Letta nuevo es de otra versión. La memoria local guarda todos los turnos, así que Letta se puede volver a llenar desde ella: se borra en la memoria local el agente anotado y la marca de «ya enviado» de cada turno, y Shiro los vuelve a mandar a un agente nuevo.

La orden que hace eso (`reindex-memory`) todavía no existe: es la parte de P-11a que falta. Hasta entonces, restaura solo la memoria local. Shiro funciona con ella y enseña el historial; lo que no tendrá es la búsqueda de Letta sobre los turnos anteriores.

## Si la imagen de Letta no trajera `pg_dump`

La imagen fijada hoy lo trae (comprobado el 2026-11-20: PostgreSQL 15). Tras subir Letta de versión, compruébalo antes de fiarte de la copia:

```powershell
docker exec $c which pg_dump
```

Si no está, la alternativa es copiar el volumen `letta_pgdata` con el contenedor parado (`docker compose stop letta`), o hacer el volcado desde un contenedor auxiliar de Postgres de la misma versión mayor.

## Lo que no se ha probado

- La primera copia a otro equipo: crear allí la carpeta con sus permisos, enviar con `scp`, comprobar los hashes y rotar. En local y contra un Docker de pruebas sí está probado; contra el otro equipo, solo la llegada por SSH y la forma de la ruta.
- Una carpeta de copias remota con espacios en la ruta. La de por defecto no los tiene.
