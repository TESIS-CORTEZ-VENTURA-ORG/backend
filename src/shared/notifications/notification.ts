import { z } from 'zod';

/**
 * E10 · Tipos de notificación. Coincide con los eventos del dominio:
 * low_stock (HU-05-10), order_ready / bill_requested (E03 POS), system (genérico
 * / futuras alertas de IA E08). PUSH y otros tipos quedan fuera de alcance.
 */
export const notificationTypeSchema = z.enum([
  'low_stock',
  'order_ready',
  'bill_requested',
  'system',
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
