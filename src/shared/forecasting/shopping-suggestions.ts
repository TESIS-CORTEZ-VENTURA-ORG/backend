import { z } from 'zod';
import { forecastContextStatusSchema, forecastDriverSchema } from './forecast';

/**
 * HU-08-06 · Contrato de sugerencias de compra basadas en pronóstico (E08).
 *
 * El endpoint toma la última corrida completada (scope=total) del tenant,
 * explota el BOM de cada receta activa por insumo y devuelve los shortfalls
 * (consumo previsto > stock actual). Si no existe corrida completada, devuelve
 * `needsForecast: true` con lista vacía para que el frontend pueda guiar al
 * usuario a lanzar un pronóstico.
 *
 * Invariantes:
 *  - `tenant_id` SIEMPRE del JWT (nunca de path/query/body).
 *  - Solo corridas status='completed'; las 'running'/'failed' se ignoran.
 *  - shortfall = forecastConsumption − currentStock (siempre > 0 en la lista).
 *  - suggestedQty = shortfall (puede ajustarse a lotes de compra en futuras HU).
 *  - HU-08-07 (fase 2): `drivers`/`contextStatus` viajan tal cual la corrida
 *    usada, para que el frontend narre el porqué de un shortfall (p. ej.
 *    "Fiestas Patrias en 12 días: +35% demanda proyectada" junto al insumo
 *    que va a faltar). `drivers` ya viene acotado al horizonte por core-ai.
 *  - Lote B4 (E08×E05): `suggestedQty` de un insumo perecible (`shelfLifeDays`
 *    configurado) se topa por lo que realmente se alcanza a consumir antes de
 *    que venza — no tiene sentido sugerir comprar más de lo que se va a poder
 *    usar. `cappedByShelfLife`/`uncappedSuggestedQty` son ADITIVOS (no rompen
 *    consumidores existentes) y solo se activan para insumos con
 *    `shelfLifeDays` configurado (ver `shelf-life-cap.util.ts`).
 */

/** Query params de `GET /forecasting/shopping-suggestions`. */
export const shoppingSuggestionsQuerySchema = z.object({
  horizon: z.coerce.number().int().positive().max(365).default(14),
});
export type ShoppingSuggestionsQuery = z.infer<
  typeof shoppingSuggestionsQuerySchema
>;

/** Un insumo con déficit proyectado dentro del horizonte. */
export const shoppingSuggestionItemSchema = z.object({
  ingredientId: z.string().uuid(),
  name: z.string(),
  unit: z.string(),
  /** Stock actual en la unidad del insumo (Decimal serializado). */
  currentStock: z.string(),
  /** Consumo proyectado por el BOM en el horizonte (Decimal serializado). */
  forecastConsumption: z.string(),
  /** forecastConsumption − currentStock, siempre > 0 (Decimal serializado). */
  shortfall: z.string(),
  /** Cantidad sugerida a comprar (= shortfall, salvo que `cappedByShelfLife`). */
  suggestedQty: z.string(),
  /** Lote B4 · `true` cuando `suggestedQty` se redujo porque el insumo no
   *  alcanza a consumirse antes de su vencimiento estimado (vida útil, MVP
   *  sin lotes). `false` sin `shelfLifeDays` configurado o cuando el tope no
   *  llegó a activarse (p. ej. `shelfLifeDays` ≥ horizonte solicitado). */
  cappedByShelfLife: z.boolean(),
  /** Lote B4 · `shortfall` SIN topar, solo cuando `cappedByShelfLife=true`
   *  (para que la UI explique "se sugieren X, aunque el déficit real es Y");
   *  `null` en cualquier otro caso. */
  uncappedSuggestedQty: z.string().nullable(),
});
export type ShoppingSuggestionItem = z.infer<
  typeof shoppingSuggestionItemSchema
>;

/** Respuesta completa del endpoint de sugerencias de compra. */
export const shoppingSuggestionsResponseSchema = z.object({
  horizon: z.number().int().positive(),
  /** Siempre 'forecast' — en futuras versiones puede ser 'historical'. */
  source: z.literal('forecast'),
  /** ID de la corrida usada; null si needsForecast=true. */
  runId: z.string().uuid().nullable(),
  /** true cuando no existe ninguna corrida completada para el tenant. */
  needsForecast: z.boolean(),
  suggestions: z.array(shoppingSuggestionItemSchema),
  /**
   * HU-08-07 (fase 2) · Factores exógenos dentro del horizonte de la corrida
   * usada (calendario/clima) — `[]` si `needsForecast` o la corrida no tuvo
   * contexto. Permite narrar el shortfall junto al evento que lo explica.
   */
  drivers: z.array(forecastDriverSchema),
  /** Estado del contexto de la corrida usada; `null` si `needsForecast`. */
  contextStatus: forecastContextStatusSchema.nullable(),
});
export type ShoppingSuggestionsResponse = z.infer<
  typeof shoppingSuggestionsResponseSchema
>;
