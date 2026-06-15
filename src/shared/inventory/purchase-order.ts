import { z } from 'zod';

// E05 · Estados de una orden de compra (OC). Máquina:
// draft → sent → partially_received → received (terminal); cancelled (terminal).
export const purchaseOrderStatusSchema = z.enum([
  'draft',
  'sent',
  'partially_received',
  'received',
  'cancelled',
]);
export type PurchaseOrderStatus = z.infer<typeof purchaseOrderStatusSchema>;

/**
 * HU-05-04 · Crear OC. Una OC referencia un proveedor y ≥1 línea (insumo, cantidad
 * pedida > 0, costo unitario ≥ 0). Nace en estado `draft`. El total
 * (Σ qtyOrdered·unitCost) se calcula en la vista; no se envía desde el cliente.
 */
export const createPurchaseOrderSchema = z.object({
  supplierId: z.uuid(),
  expectedAt: z.iso.datetime({ offset: true }).optional(),
  notes: z.string().optional(),
  items: z
    .array(
      z.object({
        ingredientId: z.uuid(),
        qtyOrdered: z.number().positive(),
        unitCost: z.number().nonnegative(),
      }),
    )
    .min(1),
});
export type CreatePurchaseOrderInput = z.infer<
  typeof createPurchaseOrderSchema
>;

/**
 * HU-05-06 · Recepcionar OC (parcial o total). Por cada línea recibida se indica
 * la cantidad realmente recibida (> 0). El acumulado no puede exceder lo ordenado
 * (se valida en la capa de servicio → 400). Crea un movimiento `purchase` y sube
 * el stock del insumo por cada línea, en una sola transacción.
 */
export const receivePurchaseOrderSchema = z.object({
  items: z
    .array(
      z.object({
        itemId: z.uuid(),
        qtyReceived: z.number().positive(),
      }),
    )
    .min(1),
});
export type ReceivePurchaseOrderInput = z.infer<
  typeof receivePurchaseOrderSchema
>;
