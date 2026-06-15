-- CreateTable
CREATE TABLE "ingredients" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "category" TEXT,
    "unit_cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ingredients_tenant_id_idx" ON "ingredients"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "ingredients_tenant_id_sku_key" ON "ingredients"("tenant_id", "sku");

-- AddForeignKey
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS FORCE por tenant (ADR-004).
ALTER TABLE "ingredients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ingredients" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ingredients"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
