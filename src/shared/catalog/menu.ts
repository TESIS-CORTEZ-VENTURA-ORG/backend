import { z } from 'zod';

// HU-02-12 · Categoría de la carta (entradas, principales, postres, bebidas).
export const createMenuCategorySchema = z.object({
  name: z.string().min(1),
  position: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});
export type CreateMenuCategoryInput = z.infer<typeof createMenuCategorySchema>;

export const updateMenuCategorySchema = z.object({
  name: z.string().min(1).optional(),
  position: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateMenuCategoryInput = z.infer<typeof updateMenuCategorySchema>;

// HU-02-12 · Reordenar (drag-and-drop): nueva posición por categoría.
export const reorderMenuCategoriesSchema = z.object({
  order: z
    .array(z.object({ id: z.uuid(), position: z.number().int().min(0) }))
    .min(1),
});
export type ReorderMenuCategoriesInput = z.infer<
  typeof reorderMenuCategoriesSchema
>;

// HU-02-10 · Plato vendible: receta + precio de venta + categoría (+ foto, HU-02-14).
export const createMenuItemSchema = z.object({
  recipeId: z.uuid(),
  menuCategoryId: z.uuid().optional(),
  name: z.string().min(1),
  price: z.number().nonnegative(),
  imageUrl: z.url().optional(),
  isActive: z.boolean().optional(),
});
export type CreateMenuItemInput = z.infer<typeof createMenuItemSchema>;

export const updateMenuItemSchema = z.object({
  recipeId: z.uuid().optional(),
  menuCategoryId: z.uuid().nullable().optional(),
  name: z.string().min(1).optional(),
  price: z.number().nonnegative().optional(),
  imageUrl: z.url().nullable().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateMenuItemInput = z.infer<typeof updateMenuItemSchema>;
