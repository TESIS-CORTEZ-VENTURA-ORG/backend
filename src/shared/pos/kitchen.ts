import { z } from 'zod';

// HU-03-07 · Estación de cocina (parrilla, frío, barra…). position = orden visual.
export const createKitchenStationSchema = z.object({
  name: z.string().min(1).max(60),
  position: z.number().int().min(0).optional(),
});
export type CreateKitchenStationInput = z.infer<
  typeof createKitchenStationSchema
>;

export const updateKitchenStationSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  position: z.number().int().min(0).optional(),
});
export type UpdateKitchenStationInput = z.infer<
  typeof updateKitchenStationSchema
>;

// HU-03-07 · Filtro opcional de la cola del KDS por estación.
export const kitchenQueueQuerySchema = z.object({
  stationId: z.uuid().optional(),
});
export type KitchenQueueQueryInput = z.infer<typeof kitchenQueueQuerySchema>;

// HU-03-08/09 · Transición de estado de un ítem en el KDS.
// Solo se aceptan transiciones de cocina: pending→preparing→ready.
export const updateKitchenItemSchema = z.object({
  status: z.enum(['preparing', 'ready']),
});
export type UpdateKitchenItemInput = z.infer<typeof updateKitchenItemSchema>;
