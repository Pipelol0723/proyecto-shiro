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

La restauración la hace una orden. **No la hagas a mano**: más abajo está por qué.

Primero ensaya la copia que vas a restaurar (`npm run backup:check`). Después, con **Shiro cerrado**, esto dice lo que haría, sin cambiar nada:

```powershell
npm run backup:restore -- -Backup <carpeta de la copia> -Memory -Letta
```

Y con `-Yes` lo hace:

```powershell
npm run backup:restore -- -Backup <carpeta de la copia> -Memory -Letta -Yes
```

- `-Memory` restaura la memoria local y `-Letta`, el Letta en marcha. Lo normal es restaurar las dos cosas de la misma copia.
- Por defecto, la memoria es la de desarrollo. Con `-Installed`, la de la app instalada; con `-MemoryDb <ruta>`, la que digas.
- Antes de tocar nada comprueba la copia (archivos, memoria y turnos) y que Shiro está cerrado.
- **No borra nada.** La memoria que había queda al lado, en una carpeta `antes-<fecha>`. La base de Letta que había queda guardada dentro de Letta con el nombre `letta_antes_<fecha>`. La orden dice los dos nombres **al terminar**: apúntalos.
- Letta tiene que estar en marcha (`docker compose up -d`) y ser de la misma imagen que el de la copia. Con otra imagen la orden se niega: restaura solo la memoria y rellena Letta con `reindex-memory`.
- Restaura Letta primero. Si Letta falla, la base en uso no cambia y la memoria no se toca.
- Si hay más de un contenedor de Letta, di cuál con `-LettaContainer <nombre>`.
- Si la memoria de la copia no se puede poner, la que había vuelve a su sitio.
- Sale con el código 0 si todo fue bien. Con 1 si hubo un error, o si lo hizo pero queda un aviso que mirar (por ejemplo, Letta tarda en volver tras reiniciarlo): lo dice al final.

Si algo falla a medias, la orden dice cómo quedó cada cosa y cómo seguir:

- **El cambio de bases de Letta no entra.** La base en uso no se ha tocado. Repite la orden: vuelve a restaurar el volcado desde el principio.
- **Letta entra y la memoria no.** Repite solo con `-Memory`, o vuelve atrás en Letta (abajo).

Si restauras solo una de las dos cosas, la memoria y Letta pueden no cuadrar: la memoria anota qué turnos se han enviado ya, y ese Letta puede no tenerlos. La orden lo avisa; se arregla con `reindex-memory`, más abajo. Con las dos de una misma copia no pasa: la copia saca primero la memoria, así que un turno enviado mientras se copiaba queda como pendiente y, al restaurar, se reenvía (puede quedar repetido en Letta, no perdido).

### Volver atrás

- **Letta.** Con el nombre que dio la restauración, tal cual. La base que está en uso se guarda a su vez, como `letta_descartada_<fecha>`. Sin `-Yes` solo dice lo que haría:

  ```powershell
  npm run backup:restore -- -LettaUndo letta_antes_<fecha> -Yes
  ```

- **La memoria.** Con Shiro cerrado, en la carpeta de datos: saca de ahí la memoria restaurada (`memory.db` y, si están, `memory.db-wal` y `memory.db-shm`) y devuelve a su sitio los archivos de la carpeta `antes-<fecha>`. Se puede hacer con el explorador de archivos. Los tres archivos van siempre juntos.

Cuando hayas comprobado que Shiro recuerda lo que debe, puedes borrar lo apartado: la carpeta `antes-<fecha>` y, en Letta, las bases guardadas (`letta_antes_<fecha>` y, si volviste atrás, `letta_descartada_<fecha>`):

```powershell
docker exec <contenedor de Letta> sh -c 'dropdb -U $POSTGRES_USER letta_antes_<fecha>'
```

### Por qué no a mano

Al preparar esto se ensayaron los pasos y se revisaron uno a uno. En los dos sitios hay maneras de estropear la restauración sin que nada avise, y la orden las evita:

- **La memoria local.** Si al lado de la `memory.db` restaurada se queda un `memory.db-wal` de la memoria anterior, SQLite lo aplica encima: la app abre sin errores y enseña los turnos de antes, no los de la copia. La orden aparta los tres archivos, comprueba que no queda ninguno y solo entonces copia.
- **Letta.** Restaurar encima de la base en uso con `pg_restore --clean` termina con cientos de errores y la base sin tablas (probado el 2026-11-20 en un Letta temporal). La orden restaura en una base aparte, compara las filas con las de la copia, cambia una base por otra en una sola transacción, comprueba cómo quedaron las bases y reinicia Letta. Si un paso falla, se para ahí.

## Volver a llenar Letta desde la memoria local

La memoria local guarda todos los turnos, así que Letta se puede volver a llenar desde ella. Hace falta cuando Letta está vacío o es otro (uno nuevo, o uno restaurado de una copia de otra fecha): los turnos que ya constan como enviados no se reenvían solos.

Con **Shiro cerrado**, esto dice lo que haría, sin tocar ningún turno: cuántos turnos hay, cuántos constan como enviados y qué agente de Letta está anotado.

```powershell
npm run reindex-memory
```

Y esto lo hace:

```powershell
npm run reindex-memory -- --yes
```

- Deja todos los turnos como pendientes de enviar y olvida el agente anotado. No borra ningún turno ni toca Letta.
- Al arrancar Shiro con Letta en marcha se crea un agente nuevo y los turnos se reenvían por lotes. Con muchos turnos tarda un rato.
- El agente anterior, si sigue en Letta, se queda sin usar.
- Si la configuración fija un agente (`letta.agent_id`), no se crea ninguno: los turnos se reenvían a ese.
- Por defecto actúa sobre la memoria de desarrollo. Para otra, con la ruta completa: `npm run reindex-memory -- --db <ruta de memory.db> --yes`.
- Con Shiro en marcha no hace nada y lo dice: el servidor tiene el agente en uso.
- Abrir la memoria la deja en el esquema actual, como hace Shiro al arrancar: si era de una versión anterior, la migra y guarda al lado una copia previa. Pasa también cuando solo se pregunta qué haría.

## Si la imagen de Letta no trajera `pg_dump`

La imagen fijada hoy lo trae (comprobado el 2026-11-20: PostgreSQL 15). Tras subir Letta de versión, compruébalo antes de fiarte de la copia:

```powershell
docker exec <contenedor de Letta> sh -c "command -v pg_dump"
```

Si no está, la alternativa es copiar el volumen `letta_pgdata` con el contenedor parado (`docker compose stop letta`), o hacer el volcado desde un contenedor auxiliar de Postgres de la misma versión mayor.

## Lo que no se ha probado

- La primera copia a otro equipo: crear allí la carpeta con sus permisos, enviar con `scp`, comprobar los hashes y rotar. En local y contra un Docker de pruebas sí está probado; contra el otro equipo, solo la llegada por SSH y la forma de la ruta.
- La restauración sobre el Letta en uso y sobre una memoria con historial de verdad. Está ensayada entera (restaurar, volver atrás y la memoria con su `-wal`) en un Letta temporal y en carpetas temporales, con datos de prueba.
- Una carpeta de copias remota con espacios en la ruta. La de por defecto no los tiene.
