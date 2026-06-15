import { z } from 'zod';

/** Familias de unidades; solo se convierte dentro de la misma familia (HU-02-03). */
export const UNIT_FAMILIES = ['mass', 'volume', 'count'] as const;
export const unitFamilySchema = z.enum(UNIT_FAMILIES);
export type UnitFamily = z.infer<typeof unitFamilySchema>;

export const createUnitSchema = z.object({
  code: z.string().min(1).max(16),
  name: z.string().min(1),
  family: unitFamilySchema,
  factorToBase: z.number().positive(),
});
export type CreateUnitInput = z.infer<typeof createUnitSchema>;

export const updateUnitSchema = createUnitSchema.partial();
export type UpdateUnitInput = z.infer<typeof updateUnitSchema>;

/** Query de conversión: convierte `qty` de la unidad `from` a `to` (query → coerce). */
export const convertUnitSchema = z.object({
  qty: z.coerce.number().positive(),
  from: z.string().min(1),
  to: z.string().min(1),
});
export type ConvertUnitInput = z.infer<typeof convertUnitSchema>;
