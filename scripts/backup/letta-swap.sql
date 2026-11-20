-- Cambia la base que usa Letta por otra. Lo ejecuta
-- `scripts/restore-backup.ps1` (ver RESTORE.md), para restaurar y para volver
-- atrás.
--
-- Variables de psql: `db`, la base que usa Letta; `new`, la que pasa a
-- usarse (la restaurada, o una guardada antes); y `old`, el nombre con el
-- que se guarda la que había, sin conexiones.
--
-- Va en una sola transacción (`psql --single-transaction`): si algo falla,
-- no cambia nada y la base sigue en uso.
ALTER DATABASE :"new" WITH ALLOW_CONNECTIONS true;
ALTER DATABASE :"db" WITH ALLOW_CONNECTIONS false;
SELECT count(pg_terminate_backend(pid)) AS conexiones_cerradas
FROM pg_stat_activity
WHERE datname = :'db';
ALTER DATABASE :"db" RENAME TO :"old";
ALTER DATABASE :"new" RENAME TO :"db";
