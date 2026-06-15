import { z } from 'zod';

/** Horario de atención por día (0=domingo .. 6=sábado), HH:MM. */
export const businessHoursSchema = z.array(
  z.object({
    day: z.number().int().min(0).max(6),
    open: z.string().regex(/^\d{2}:\d{2}$/, 'Formato HH:MM'),
    close: z.string().regex(/^\d{2}:\d{2}$/, 'Formato HH:MM'),
  }),
);

/**
 * Config del local (HU-01-10): moneda (solo PEN, backend.md §6), IGV, aforo,
 * horarios y datos fiscales. PATCH parcial; rechaza claves desconocidas.
 */
export const tenantSettingsSchema = z
  .object({
    ruc: z.string().regex(/^\d{11}$/, 'RUC debe tener 11 dígitos'),
    legalName: z.string().min(1),
    fiscalAddress: z.string().min(1),
    currency: z.literal('PEN'),
    igvRate: z.number().min(0).max(1),
    capacity: z.number().int().positive(),
    businessHours: businessHoursSchema,
  })
  .partial()
  .strict();

export type TenantSettingsInput = z.infer<typeof tenantSettingsSchema>;
