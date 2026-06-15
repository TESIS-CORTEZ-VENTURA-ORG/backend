-- CreateTable
CREATE TABLE "zones" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dining_tables" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 2,
    "status" TEXT NOT NULL DEFAULT 'free',
    "pos_x" INTEGER,
    "pos_y" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "dining_tables_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "zones_tenant_id_idx" ON "zones"("tenant_id");

-- CreateIndex
CREATE INDEX "dining_tables_tenant_id_idx" ON "dining_tables"("tenant_id");

-- CreateIndex
CREATE INDEX "dining_tables_zone_id_idx" ON "dining_tables"("zone_id");

-- CreateIndex
CREATE UNIQUE INDEX "dining_tables_tenant_id_code_key" ON "dining_tables"("tenant_id", "code");

-- AddForeignKey
ALTER TABLE "zones" ADD CONSTRAINT "zones_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS FORCE (multi-tenant, fail-closed) — riesgo R4.
ALTER TABLE "zones" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "zones" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "zones"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE "dining_tables" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dining_tables" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "dining_tables"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
