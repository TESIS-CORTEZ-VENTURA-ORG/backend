-- CreateTable
CREATE TABLE "sales_history" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "sold_on" TIMESTAMP(3) NOT NULL,
    "dish_name" TEXT NOT NULL,
    "menu_item_id" UUID,
    "qty" INTEGER NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "external_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_history_tenant_id_idx" ON "sales_history"("tenant_id");

-- CreateIndex
CREATE INDEX "sales_history_tenant_id_sold_on_idx" ON "sales_history"("tenant_id", "sold_on");

-- CreateIndex
CREATE UNIQUE INDEX "sales_history_tenant_id_external_ref_key" ON "sales_history"("tenant_id", "external_ref");

-- AddForeignKey
ALTER TABLE "sales_history" ADD CONSTRAINT "sales_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS FORCE (multi-tenant, fail-closed) — riesgo R4.
ALTER TABLE "sales_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sales_history" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "sales_history"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
