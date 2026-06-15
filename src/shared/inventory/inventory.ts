import { z } from 'zod';

// E05 · Tipos de movimiento de inventario (kardex). Coincide con el contrato del
// frontend (MovementType): purchase|sale|waste|adjustment|count.
export const movementTypeSchema = z.enum([
  'purchase',
  'sale',
  'waste',
  'adjustment',
  'count',
]);
export type MovementType = z.infer<typeof movementTypeSchema>;

/**
 * HU-05-02/03/08 · Registrar un movimiento. `qty` es un DELTA CON SIGNO: positivo
 * para entrada/compra, negativo para salida/venta/merma. Para `type='waste'`
 * (merma) la `reason` es OBLIGATORIA (HU-05-08) — se valida en la capa de servicio.
 * `userId` no viene del cliente: se toma del JWT (claims.sub).
 */
export const createMovementSchema = z.object({
  ingredientId: z.uuid(),
  type: movementTypeSchema,
  qty: z.number().refine((n) => n !== 0, { message: 'qty no puede ser 0' }),
  note: z.string().optional(),
  reason: z.string().min(1).optional(),
});
export type CreateMovementInput = z.infer<typeof createMovementSchema>;

/** HU-05-10 · Configurar el mínimo de reorden (umbral de alerta) de un insumo. */
export const updateInventoryLevelSchema = z.object({
  minStock: z.number().nonnegative(),
});
export type UpdateInventoryLevelInput = z.infer<
  typeof updateInventoryLevelSchema
>;
