import { z } from 'zod';

/**
 * E10 · Tipos de notificación. Coincide con los eventos del dominio:
 * low_stock (HU-05-10), order_ready / bill_requested (E03 POS), system (genérico
 * / futuras alertas de IA E08), forecast_shortfall (E08×E10 — el forecast
 * detecta que un insumo no cubre la demanda proyectada; ver
 * `ForecastingService.notifyShortfalls`). PUSH y otros tipos quedan fuera de
 * alcance. Nota de compatibilidad: la campana del frontend (`notifications-
 * adapter.ts`) coerciona cualquier tipo desconocido a `system` (fallback
 * genérico), así que un tipo nuevo acá NUNCA rompe la UI — solo pierde el CTA
 * específico hasta que el frontend lo modele explícitamente.
 */
export const notificationTypeSchema = z.enum([
  'low_stock',
  'order_ready',
  'bill_requested',
  'system',
  'forecast_shortfall',
]);
export type NotificationType = z.infer<typeof notificationTypeSchema>;

/**
 * HU-10-01 · Query de la bandeja. `unreadOnly` filtra las no leídas; `limit`
 * acota la lista (1..200, default en el servicio). El `unreadCount` del envelope
 * SIEMPRE cuenta todas las no leídas (ignora estos filtros) → es el badge.
 */
export const listNotificationsQuerySchema = z.object({
  unreadOnly: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
export type ListNotificationsQuery = z.infer<
  typeof listNotificationsQuerySchema
>;

/**
 * HU-10-03 · Upsert de preferencia por (usuario, tipo). Al menos uno de los
 * canales (`inApp`/`email`) suele venir; ambos son opcionales (se conserva el
 * valor previo / default si no se envían). `email` es el canal reservado para
 * HU-10-02 (Resend, diferido).
 */
export const setPreferenceSchema = z
  .object({
    type: notificationTypeSchema,
    inApp: z.boolean().optional(),
    email: z.boolean().optional(),
  })
  .strict();
export type SetPreferenceInput = z.infer<typeof setPreferenceSchema>;
