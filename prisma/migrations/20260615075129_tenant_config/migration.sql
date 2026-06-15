-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "business_hours" JSONB,
ADD COLUMN     "capacity" INTEGER,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'PEN',
ADD COLUMN     "fiscal_address" TEXT,
ADD COLUMN     "igv_rate" DOUBLE PRECISION NOT NULL DEFAULT 0.18,
ADD COLUMN     "legal_name" TEXT,
ADD COLUMN     "ruc" TEXT;
