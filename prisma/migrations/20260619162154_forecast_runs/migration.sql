-- CreateTable
CREATE TABLE "forecast_runs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "menu_item_id" UUID,
    "horizon" INTEGER NOT NULL,
    "engine" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "model" TEXT,
    "baseline" TEXT,
    "observations" INTEGER,
    "span_days" INTEGER,
    "data_quality" TEXT,
    "points" JSONB,
    "backtest" JSONB,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "forecast_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "forecast_runs_tenant_id_idx" ON "forecast_runs"("tenant_id");

-- CreateIndex
CREATE INDEX "forecast_runs_tenant_id_scope_menu_item_id_status_created_a_idx" ON "forecast_runs"("tenant_id", "scope", "menu_item_id", "status", "created_at");

-- AddForeignKey
ALTER TABLE "forecast_runs" ADD CONSTRAINT "forecast_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS FORCE (multi-tenant, fail-closed) — riesgo R4.
ALTER TABLE "forecast_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "forecast_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "forecast_runs"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
