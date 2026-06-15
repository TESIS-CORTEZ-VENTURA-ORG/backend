-- AlterTable: campos de autenticación en users.
ALTER TABLE "users"
  ADD COLUMN "password_hash" TEXT NOT NULL,
  ADD COLUMN "roles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- DropIndex: el unique compuesto (tenant_id, email) se reemplaza por email global-unique
-- (login por email en el piloto; multi-org del mismo email se difiere a Better-Auth).
DROP INDEX "users_tenant_id_email_key";

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
