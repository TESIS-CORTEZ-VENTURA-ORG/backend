-- AlterTable
ALTER TABLE "ingredients" ADD COLUMN     "min_stock" DECIMAL(12,3) NOT NULL DEFAULT 0,
ADD COLUMN     "stock" DECIMAL(12,3) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "qty" DECIMAL(12,3) NOT NULL,
    "note" TEXT,
    "reason" TEXT,
    "user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_movements_tenant_id_idx" ON "inventory_movements"("tenant_id");

-- CreateIndex
CREATE INDEX "inventory_movements_ingredient_id_idx" ON "inventory_movements"("ingredient_id");

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS FORCE (multi-tenant, fail-closed) — riesgo R4.
ALTER TABLE "inventory_movements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_movements" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "inventory_movements"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
