import { z } from 'zod';

// HU-03-03/04/05/10/11: estado de la orden y de cada ítem.
export const orderStatusSchema = z.enum([
  'open',
  'sent_to_kitchen',
  'served',
  'void',
  'paid',
]);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

export const orderItemStatusSchema = z.enum([
  'pending',
  'preparing',
  'ready',
  'served',
]);
export type OrderItemStatus = z.infer<typeof orderItemStatusSchema>;

// HU-03-03 · Abrir mesa. idempotencyKey permite reintentos seguros (misma orden).
export const openOrderSchema = z.object({
  tableId: z.uuid(),
  guests: z.number().int().positive().optional(),
  idempotencyKey: z.string().optional(),
});
export type OpenOrderInput = z.infer<typeof openOrderSchema>;

// HU-03-04/05 · Tomar orden (con modificadores). El precio se calcula en el
// servidor a partir del plato + sus modificadores (snapshot).
export const addOrderItemsSchema = z.object({
  items: z
    .array(
      z.object({
        menuItemId: z.uuid(),
        qty: z.number().int().positive(),
        notes: z.string().optional(),
        modifierIds: z.array(z.uuid()).optional(),
      }),
    )
    .min(1),
});
export type AddOrderItemsInput = z.infer<typeof addOrderItemsSchema>;

// HU-03-04/10 · Editar ítem: cambiar cantidad, marcar estado (servido), o quitar.
export const updateOrderItemSchema = z.object({
  qty: z.number().int().positive().optional(),
  status: orderItemStatusSchema.optional(),
  remove: z.boolean().optional(),
});
export type UpdateOrderItemInput = z.infer<typeof updateOrderItemSchema>;

// HU-03-11 · Anular orden. La razón es OBLIGATORIA (auditoría).
export const voidOrderSchema = z.object({
  reason: z.string().min(1),
});
export type VoidOrderInput = z.infer<typeof voidOrderSchema>;
