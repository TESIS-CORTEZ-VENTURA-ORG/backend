-- CreateTable
CREATE TABLE "cash_closes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "opened_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sales_count" INTEGER NOT NULL,
    "void_count" INTEGER NOT NULL,
    "total_gross" DECIMAL(12,2) NOT NULL,
    "by_method" JSONB NOT NULL,
    "user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_closes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cash_closes_tenant_id_idx" ON "cash_closes"("tenant_id");

-- AddForeignKey
ALTER TABLE "cash_closes" ADD CONSTRAINT "cash_closes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS FORCE (multi-tenant, fail-closed) — riesgo R4.
ALTER TABLE "cash_closes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cash_closes" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "cash_closes"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
