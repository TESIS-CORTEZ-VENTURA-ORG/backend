-- E02/E05 · HU-05-12 — Historial de precios de insumos.
-- Alimentado automáticamente al recepcionar una OC (source='purchase_order').
-- RLS FORCE por tenant (ADR-004, riesgo R4).

-- CreateTable
CREATE TABLE "ingredient_price_history" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "unit_cost" DECIMAL(12,2) NOT NULL,
    "recorded_at" TIMESTAMPTZ NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'purchase_order',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingredient_price_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ingredient_price_history_tenant_id_idx" ON "ingredient_price_history"("tenant_id");

-- CreateIndex
CREATE INDEX "ingredient_price_history_tenant_id_ingredient_id_recorded_at_idx"
    ON "ingredient_price_history"("tenant_id", "ingredient_id", "recorded_at");

-- AddForeignKey
ALTER TABLE "ingredient_price_history"
    ADD CONSTRAINT "ingredient_price_history_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredient_price_history"
    ADD CONSTRAINT "ingredient_price_history_ingredient_id_fkey"
    FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS FORCE por tenant (ADR-004, fail-closed). NULLIF evita errores cuando
-- app.tenant_id no está fijado (fuera de runInTenant): la policy devuelve false.
ALTER TABLE "ingredient_price_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ingredient_price_history" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ingredient_price_history"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
