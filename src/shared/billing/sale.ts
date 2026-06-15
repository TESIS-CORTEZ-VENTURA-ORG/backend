import { z } from 'zod';

// E04 — Cobros. Tipo de documento (comprobante) y estado del ticket.
// Espejo del contrato del frontend (shared/types/domain.ts: SaleDocType/SaleStatus).
export const saleDocTypeSchema = z.enum(['boleta', 'factura']);
export type SaleDocType = z.infer<typeof saleDocTypeSchema>;

export const saleStatusSchema = z.enum(['issued', 'void']);
export type SaleStatus = z.infer<typeof saleStatusSchema>;

// Métodos de pago soportados (sin pasarela; solo registro). HU-04-04/05.
export const paymentMethodSchema = z.enum(['cash', 'card', 'yape', 'plin']);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

// HU-04-02/04/05/06 · Cobrar una orden: emite el ticket y registra los pagos.
// El total/IGV se calculan en el servidor desde los ítems de la orden; el body
// solo trae los pagos (≥1, monto > 0) y los datos del comprobante.
export const payOrderSchema = z.object({
  payments: z
    .array(
      z.object({
        method: paymentMethodSchema,
        amount: z.number().positive(),
      }),
    )
    .min(1),
  docType: saleDocTypeSchema.default('boleta'),
  customer: z.string().optional(),
  customerDoc: z.string().optional(),
});
export type PayOrderInput = z.infer<typeof payOrderSchema>;

// HU-04-07 · Anular ticket. La razón es OBLIGATORIA (auditoría).
export const voidSaleSchema = z.object({
  reason: z.string().min(1),
});
export type VoidSaleInput = z.infer<typeof voidSaleSchema>;

// HU-04-03 · División de cuenta por comensal (cómputo, no persiste). Dos modos:
//  - equal: dividir el total en `parts` partes (default = order.guests si ≥ 2).
//  - items: agrupar los ítems en `assignments` (cada ítem asignado una sola vez).
export const splitOrderSchema = z
  .object({
    mode: z.enum(['equal', 'items']),
    parts: z.number().int().min(2).optional(),
    assignments: z
      .array(
        z.object({
          label: z.string().min(1),
          itemIds: z.array(z.uuid()).min(1),
        }),
      )
      .min(1)
      .optional(),
  })
  .refine((v) => v.mode !== 'items' || v.assignments !== undefined, {
    message: 'El modo "items" requiere assignments',
    path: ['assignments'],
  });
export type SplitOrderInput = z.infer<typeof splitOrderSchema>;
