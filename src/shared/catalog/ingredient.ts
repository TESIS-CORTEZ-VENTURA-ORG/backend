import { z } from 'zod';

/** Insumo del catálogo (HU-02-01). `unitCost` en S/ (PEN). */
export const createIngredientSchema = z.object({
  sku: z.string().min(1).max(64),
  name: z.string().min(1),
  type: z.string().min(1),
  unit: z.string().min(1),
  category: z.string().min(1).optional(),
  unitCost: z.number().nonnegative().optional(),
});

export type CreateIngredientInput = z.infer<typeof createIngredientSchema>;

export const updateIngredientSchema = createIngredientSchema.partial();

export type UpdateIngredientInput = z.infer<typeof updateIngredientSchema>;

/**
 * Carga masiva (HU-02-02): contenido CSV crudo (cabecera + filas). El cliente/BFF
 * lee el archivo Excel/CSV y envía su texto; el servidor parsea, valida e importa.
 */
export const importIngredientsSchema = z.object({
  content: z.string().min(1),
});

export type ImportIngredientsInput = z.infer<typeof importIngredientsSchema>;
