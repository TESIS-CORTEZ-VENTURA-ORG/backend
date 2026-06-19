#!/bin/sh
# Arranque del contenedor de la API: aplica migraciones pendientes y luego inicia
# el server. `prisma migrate deploy` es idempotente (solo aplica lo que falta) y es
# el comando correcto para entornos no-interactivos (no genera ni resetea).
#
# Nota (A4): se migra con DATABASE_URL = gastronomia_app, que ES quien DEBE poseer
# las tablas (el modelo RLS FORCE exige dueño NOSUPERUSER; ver db/init/01-roles.sql).
# Por eso conviene arrancar sobre un VOLUMEN LIMPIO: sobre un volumen viejo cuyas
# tablas fueron creadas por `postgres`, los privilegios/ownership pueden no calzar.
set -e

echo "[entrypoint] Aplicando migraciones (prisma migrate deploy)…"
bunx prisma migrate deploy

echo "[entrypoint] Iniciando API…"
exec "$@"
