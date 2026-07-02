-- AlterTable
ALTER TABLE "forecast_runs" ADD COLUMN     "context_status" TEXT,
ADD COLUMN     "drivers" JSONB;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION;
