import { z } from 'zod';

// HU-02-12 · Categoría de la carta (entradas, principales, postres, bebidas).
// HU-03-07: kitchenStationId enruta los platos de la categoría a una estación de cocina.
export const createMenuCategorySchema = z.object({
  name: z.string().min(1),
  position: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  kitchenStationId: z.uuid().nullable().optional(),
});
export type CreateMenuCategoryInput = z.infer<typeof createMenuCategorySchema>;

export const updateMenuCategorySchema = z.object({
  name: z.string().min(1).optional(),
  position: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  kitchenStationId: z.uuid().nullable().optional(),
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

// HU-02-11 · Modificadores (extra queso, sin cebolla...). priceDelta puede ser negativo.
export const createMenuModifierSchema = z.object({
  name: z.string().min(1),
  priceDelta: z.number().optional(),
  required: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
});
export type CreateMenuModifierInput = z.infer<typeof createMenuModifierSchema>;

export const updateMenuModifierSchema = z.object({
  name: z.string().min(1).optional(),
  priceDelta: z.number().optional(),
  required: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
});
export type UpdateMenuModifierInput = z.infer<typeof updateMenuModifierSchema>;

// HU-02-13 · Disponibilidad por horario. Minutos desde medianoche (0..1440), hora del tenant.
const minuteOfDaySchema = z.number().int().min(0).max(1440);
export const createMenuAvailabilitySchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
    startMinute: minuteOfDaySchema,
    endMinute: minuteOfDaySchema,
  })
  .refine((w) => w.endMinute > w.startMinute, {
    message: 'endMinute debe ser mayor que startMinute',
  });
export type CreateMenuAvailabilityInput = z.infer<
  typeof createMenuAvailabilitySchema
>;

// Consulta de disponibilidad: instante ISO opcional (default = ahora).
export const availabilityCheckSchema = z.object({
  at: z.iso.datetime({ offset: true }).optional(),
});
export type AvailabilityCheckInput = z.infer<typeof availabilityCheckSchema>;
