-- Roles Postgres para RLS multi-tenant (DEV). Idempotente y no-destructivo.
--
-- Se ejecuta como superuser (postgres):
--   * automáticamente en setups nuevos (montado en /docker-entrypoint-initdb.d
--     por docker-compose.yml, corre solo con volumen vacío), y
--   * manualmente sobre un contenedor existente:
--       docker exec -i gastronomia-db psql -U postgres -d gastronomia_dev < db/init/01-roles.sql
--
-- gastronomia_app: rol de RUNTIME tenant-scoped. NO superuser → la RLS (FORCE)
-- SÍ le aplica. Posee las tablas (las crea al migrar). En prod (Neon) se separa
-- el rol de migración del de runtime; en dev usamos uno con CREATEDB para el
-- shadow DB de `prisma migrate dev`.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gastronomia_app') THEN
    CREATE ROLE gastronomia_app LOGIN PASSWORD 'gastronomia_app'
      NOSUPERUSER NOCREATEROLE NOBYPASSRLS CREATEDB;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE gastronomia_dev TO gastronomia_app;
GRANT USAGE, CREATE ON SCHEMA public TO gastronomia_app;
