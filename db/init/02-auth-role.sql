-- Rol para el LOOKUP de credenciales en login. Idempotente, ejecutado como postgres.
--
-- La autenticación ocurre ANTES de conocer el tenant (login solo trae email+password),
-- así que el lookup por email debe ver usuarios de cualquier tenant → BYPASSRLS.
-- Pero NO es superuser y solo tiene SELECT: acceso mínimo y auditable. Se usa
-- exclusivamente para la verificación de credenciales (nunca en requests de negocio).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gastronomia_auth') THEN
    CREATE ROLE gastronomia_auth LOGIN PASSWORD 'gastronomia_auth'
      NOSUPERUSER NOCREATEROLE NOCREATEDB BYPASSRLS;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE gastronomia_dev TO gastronomia_auth;
GRANT USAGE ON SCHEMA public TO gastronomia_auth;
-- SELECT sobre tablas actuales y futuras (las crea gastronomia_app al migrar).
GRANT SELECT ON ALL TABLES IN SCHEMA public TO gastronomia_auth;
ALTER DEFAULT PRIVILEGES FOR ROLE gastronomia_app IN SCHEMA public
  GRANT SELECT ON TABLES TO gastronomia_auth;
