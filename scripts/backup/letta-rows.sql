-- Filas de cada tabla del Postgres de Letta, una línea `tabla=n` por tabla.
-- Lo usa la copia de seguridad (para el manifiesto) y el ensayo de
-- restauración (para comparar). No depende de la versión de Letta: cuenta las
-- tablas que haya.
SELECT table_name || '=' || (xpath('/row/n/text()', query_to_xml(
  format('select count(*) as n from %I.%I', table_schema, table_name), false, true, '')))[1]::text
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY 1;
