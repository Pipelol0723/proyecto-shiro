-- Cambia la base que usa Letta por la restaurada. Lo ejecuta
-- `scripts/restore-backup.ps1` (ver RESTORE.md).
--
-- Antes: el volcado ya está restaurado en la base `letta_restaurada`.
-- Después: Letta usa esa base, y la que había queda guardada, sin
-- conexiones, con el nombre que se le pase.
--
-- Variables de psql: `db`, la base que usa Letta, y `old`, el nombre con el
-- que se guarda la anterior.
--
-- Va en una sola transacción (`psql --single-transaction`): si algo falla,
-- no cambia nada y la base sigue en uso.
ALTER DATABASE :"db" WITH ALLOW_CONNECTIONS false;
SELECT count(pg_terminate_backend(pid)) AS conexiones_cerradas
FROM pg_stat_activity
WHERE datname = :'db';
ALTER DATABASE :"db" RENAME TO :"old";
ALTER DATABASE letta_restaurada RENAME TO :"db";
