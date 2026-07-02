-- Lote B4 · Vida útil de insumos (MVP SIN modelo de lotes/FEFO real).
-- Migración aditiva: columna nullable, SIN default (no se inventa vida útil
-- para insumos existentes; se completa explícitamente vía seed/CRUD).
-- No requiere tocar la política RLS de "ingredients" (ya FORCE, ADR-004,
-- ver 20260615081612_ingredients): la policy filtra por tenant_id, ajeno a
-- esta columna.

-- AlterTable
ALTER TABLE "ingredients" ADD COLUMN "shelf_life_days" INTEGER;
