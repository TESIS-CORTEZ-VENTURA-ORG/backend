import { z } from 'zod';

/** Proveedor (HU-02-05). RUC 11 dígitos. */
export const createSupplierSchema = z.object({
  ruc: z.string().regex(/^\d{11}$/, 'RUC debe tener 11 dígitos'),
  name: z.string().min(1),
  contactName: z.string().min(1).optional(),
  contactEmail: z.email().optional(),
  contactPhone: z.string().min(1).optional(),
  paymentTerms: z.string().min(1).optional(),
  leadTimeDays: z.number().int().nonnegative().optional(),
  active: z.boolean().optional(),
});
export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;

export const updateSupplierSchema = createSupplierSchema.partial();
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;

/** Asociación insumo ↔ proveedor (HU-02-06). */
export const linkSupplierSchema = z.object({
  supplierId: z.uuid(),
  supplierSku: z.string().min(1).optional(),
  lastPrice: z.number().nonnegative().optional(),
  preferred: z.boolean().optional(),
});
export type LinkSupplierInput = z.infer<typeof linkSupplierSchema>;
