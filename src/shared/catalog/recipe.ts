import { z } from 'zod';

export const recipeKindSchema = z.enum(['dish', 'sub_recipe']);

/** Ítem de BOM: referencia EXACTAMENTE un ingrediente o una sub-receta (HU-02-07/08). */
export const recipeItemSchema = z
  .object({
    ingredientId: z.uuid().optional(),
    subRecipeId: z.uuid().optional(),
    qty: z.number().positive(),
    wasteFactor: z.number().min(0).max(1).optional(),
  })
  .refine((i) => (i.ingredientId ? 1 : 0) + (i.subRecipeId ? 1 : 0) === 1, {
    message:
      'Cada ítem debe referenciar un ingrediente o una sub-receta (no ambos)',
  });

export const createRecipeSchema = z.object({
  name: z.string().min(1),
  kind: recipeKindSchema.optional(),
  yield: z.number().positive().optional(),
  items: z.array(recipeItemSchema).min(1),
});
export type CreateRecipeInput = z.infer<typeof createRecipeSchema>;

export const updateRecipeSchema = z.object({
  name: z.string().min(1).optional(),
  kind: recipeKindSchema.optional(),
  yield: z.number().positive().optional(),
  items: z.array(recipeItemSchema).min(1).optional(),
});
export type UpdateRecipeInput = z.infer<typeof updateRecipeSchema>;
