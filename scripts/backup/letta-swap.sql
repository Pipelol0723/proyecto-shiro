-- Cambia la base que usa Letta por una restaurada (ver RESTORE.md).
--
-- Antes: el volcado ya está restaurado en la base `letta_restaurada`.
-- Después: Letta usa esa base, y la que había queda como `letta_antes`, sin
-- conexiones, hasta que se compruebe que todo va bien y se borre a mano.
--
-- Se ejecuta en una sola transacción (`psql --single-transaction`): si algo
-- falla (por ejemplo, ya existe `letta_antes` de una restauración anterior),
-- no cambia nada y la base sigue en uso.
ALTER DATABASE letta WITH ALLOW_CONNECTIONS false;
SELECT count(pg_terminate_backend(pid)) AS conexiones_cerradas
FROM pg_stat_activity
WHERE datname = 'letta';
ALTER DATABASE letta RENAME TO letta_antes;
ALTER DATABASE letta_restaurada RENAME TO letta;
