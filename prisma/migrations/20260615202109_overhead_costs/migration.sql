-- CreateTable
CREATE TABLE "overhead_costs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "concept" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "overhead_costs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "overhead_costs_tenant_id_idx" ON "overhead_costs"("tenant_id");

-- CreateIndex
CREATE INDEX "overhead_costs_period_idx" ON "overhead_costs"("period");

-- AddForeignKey
ALTER TABLE "overhead_costs" ADD CONSTRAINT "overhead_costs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS FORCE (multi-tenant, fail-closed) — riesgo R4.
ALTER TABLE "overhead_costs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "overhead_costs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "overhead_costs"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
