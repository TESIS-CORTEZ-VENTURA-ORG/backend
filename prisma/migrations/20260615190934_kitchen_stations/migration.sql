-- AlterTable
ALTER TABLE "menu_categories" ADD COLUMN     "kitchen_station_id" UUID;

-- CreateTable
CREATE TABLE "kitchen_stations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "kitchen_stations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kitchen_stations_tenant_id_idx" ON "kitchen_stations"("tenant_id");

-- AddForeignKey
ALTER TABLE "kitchen_stations" ADD CONSTRAINT "kitchen_stations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_categories" ADD CONSTRAINT "menu_categories_kitchen_station_id_fkey" FOREIGN KEY ("kitchen_station_id") REFERENCES "kitchen_stations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS FORCE (multi-tenant, fail-closed) — riesgo R4.
ALTER TABLE "kitchen_stations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "kitchen_stations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "kitchen_stations"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
