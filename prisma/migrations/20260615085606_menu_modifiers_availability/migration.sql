-- CreateTable
CREATE TABLE "menu_modifiers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "menu_item_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "price_delta" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "menu_modifiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_availability" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "menu_item_id" UUID NOT NULL,
    "day_of_week" INTEGER,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "menu_availability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "menu_modifiers_menu_item_id_idx" ON "menu_modifiers"("menu_item_id");

-- CreateIndex
CREATE INDEX "menu_modifiers_tenant_id_idx" ON "menu_modifiers"("tenant_id");

-- CreateIndex
CREATE INDEX "menu_availability_menu_item_id_idx" ON "menu_availability"("menu_item_id");

-- CreateIndex
CREATE INDEX "menu_availability_tenant_id_idx" ON "menu_availability"("tenant_id");

-- AddForeignKey
ALTER TABLE "menu_modifiers" ADD CONSTRAINT "menu_modifiers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_modifiers" ADD CONSTRAINT "menu_modifiers_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_availability" ADD CONSTRAINT "menu_availability_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_availability" ADD CONSTRAINT "menu_availability_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS FORCE (multi-tenant, fail-closed) — riesgo R4. Igual que el resto del catálogo.
ALTER TABLE "menu_modifiers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "menu_modifiers" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "menu_modifiers"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE "menu_availability" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "menu_availability" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "menu_availability"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
