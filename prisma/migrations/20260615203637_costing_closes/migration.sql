-- CreateTable
CREATE TABLE "costing_closes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "total_cif" DECIMAL(12,2) NOT NULL,
    "total_units" INTEGER NOT NULL,
    "total_ingredient_cost" DECIMAL(12,2) NOT NULL,
    "total_revenue" DECIMAL(12,2) NOT NULL,
    "total_contribution" DECIMAL(12,2) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "closed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "costing_closes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "costing_closes_tenant_id_idx" ON "costing_closes"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "costing_closes_tenant_id_period_key" ON "costing_closes"("tenant_id", "period");

-- AddForeignKey
ALTER TABLE "costing_closes" ADD CONSTRAINT "costing_closes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS FORCE (multi-tenant, fail-closed) — riesgo R4.
ALTER TABLE "costing_closes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "costing_closes" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "costing_closes"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
