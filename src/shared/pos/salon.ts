import { z } from 'zod';

// HU-03-02: estados de mesa (alineados al mapa POS del frontend).
export const tableStatusSchema = z.enum([
  'free',
  'occupied',
  'bill',
  'reserved',
]);
export type TableStatus = z.infer<typeof tableStatusSchema>;

// HU-03-01 · Zona del salón.
export const createZoneSchema = z.object({
  name: z.string().min(1).max(60),
  position: z.number().int().min(0).optional(),
});
export type CreateZoneInput = z.infer<typeof createZoneSchema>;

export const updateZoneSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  position: z.number().int().min(0).optional(),
});
export type UpdateZoneInput = z.infer<typeof updateZoneSchema>;

// HU-03-01 · Mesa. `code` único por tenant; se puede mover de zona (zoneId).
export const createTableSchema = z.object({
  zoneId: z.uuid(),
  code: z.string().min(1).max(32),
  capacity: z.number().int().positive().optional(),
  posX: z.number().int().optional(),
  posY: z.number().int().optional(),
});
export type CreateTableInput = z.infer<typeof createTableSchema>;

export const updateTableSchema = z.object({
  zoneId: z.uuid().optional(),
  code: z.string().min(1).max(32).optional(),
  capacity: z.number().int().positive().optional(),
  status: tableStatusSchema.optional(),
  posX: z.number().int().nullable().optional(),
  posY: z.number().int().nullable().optional(),
});
export type UpdateTableInput = z.infer<typeof updateTableSchema>;
