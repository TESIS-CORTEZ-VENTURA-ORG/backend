// E10×E08 (notificaciones proactivas del forecast) · Lógica PURA (sin DB) que
// decide CÓMO agrupar los shortfalls de `shoppingSuggestions` en notificaciones
// y CUÁL es el driver exógeno más narrable de la ventana — testeable sin mockear
// Prisma/BullMQ. El armado del título/cuerpo y la persistencia quedan en
// `ForecastingService.notifyShortfalls` (que sí depende de `NotificationsService`).

import type { ForecastDriver, ShoppingSuggestionItem } from '../shared';

/** Insumo con déficit, reducido a lo que necesita el copy de la notificación. */
export interface ShortfallPlanItem {
  ingredientId: string;
  name: string;
  unit: string;
  suggestedQty: string;
}

/**
 * Plan de notificación de shortfalls:
 *  - `none`       → sin shortfalls, no se notifica nada.
 *  - `individual` → uno por insumo (mismo estilo que `low_stock`), cuando la
 *                    cantidad es manejable (≤ `individualLimit`).
 *  - `grouped`    → UNA notificación agregada cuando hay demasiados insumos
 *                    (evita floodear la campana con N notificaciones sueltas).
 */
export type ShortfallPlan =
  | { mode: 'none' }
  | { mode: 'individual'; items: ShortfallPlanItem[] }
  | {
      mode: 'grouped';
      items: ShortfallPlanItem[]; // los más críticos (mayor shortfall primero, orden de entrada)
      totalCount: number;
      extraCount: number; // totalCount - items.length, para el "y N más"
    };

function toPlanItem(s: ShoppingSuggestionItem): ShortfallPlanItem {
  return {
    ingredientId: s.ingredientId,
    name: s.name,
    unit: s.unit,
    suggestedQty: s.suggestedQty,
  };
}

/**
 * Decide el modo de notificación. `suggestions` YA viene ordenada por
 * `shortfall` desc (contrato de `shoppingSuggestionsResponseSchema`), así que
 * los `items` de un plan `grouped` son automáticamente los más críticos.
 */
export function planShortfallNotifications(
  suggestions: ShoppingSuggestionItem[],
  individualLimit: number,
): ShortfallPlan {
  if (suggestions.length === 0) return { mode: 'none' };

  if (suggestions.length <= individualLimit) {
    return { mode: 'individual', items: suggestions.map(toPlanItem) };
  }

  const items = suggestions.slice(0, individualLimit).map(toPlanItem);
  return {
    mode: 'grouped',
    items,
    totalCount: suggestions.length,
    extraCount: suggestions.length - items.length,
  };
}

/**
 * El driver más narrable de la ventana (p. ej. "Fiestas Patrias" antes que un
 * fin de semana genérico). Prioriza el de mayor `|impact_pct|` (el que más
 * explica el shortfall); si ninguno tiene impacto histórico conocido (core-ai
 * no lo infiere sin ocurrencias previas), cae al primero cronológicamente —
 * `drivers` ya llega ordenado por fecha asc desde `shoppingSuggestions`.
 */
export function mostRelevantDriver(
  drivers: ForecastDriver[],
): ForecastDriver | null {
  if (drivers.length === 0) return null;

  const withImpact = drivers.filter((d) => d.impact_pct !== null);
  if (withImpact.length === 0) return drivers[0];

  return withImpact.reduce((best, d) =>
    Math.abs(d.impact_pct as number) > Math.abs(best.impact_pct as number)
      ? d
      : best,
  );
}
