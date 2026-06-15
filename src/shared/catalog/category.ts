import { z } from 'zod';

/** Categoría jerárquica (HU-02-04). `parentId` null/omitido = raíz. */
export const createCategorySchema = z.object({
  name: z.string().min(1),
  parentId: z.uuid().nullable().optional(),
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = createCategorySchema.partial();
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
