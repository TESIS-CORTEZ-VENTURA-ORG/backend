// Lote B4 (E08×E05) · Tope de vida útil en las sugerencias de compra. Lógica
// PURA (sin DB) — testeable sin mockear Prisma/BullMQ, mismo patrón que
// `forecast-shortfall.util.ts`. El ensamblado (lectura de `shelfLifeDays` por
// insumo, la suma de `yhat` de la sub-ventana) queda en
// `ForecastingService.shoppingSuggestions`.
//
// Por qué NO hace falta re-explotar el BOM por sub-ventana: la demanda se
// reparte entre platos con una participación (`dishShare`) CONSTANTE en el
// tiempo (últimos 30 días de ventas — no varía día a día dentro del
// horizonte). Por eso el consumo proyectado de CUALQUIER insumo es una
// función LINEAL de `totalForecast` (Σ yhat de la ventana usada): basta
// escalar `forecastConsumption` (consumo en TODO el horizonte) por la
// fracción de demanda que cae dentro de la sub-ventana de vida útil
// (`subWindowForecastUnits / totalForecastUnits`) — resultado EXACTO, no una
// aproximación, dado el mismo modelo que ya usa `shoppingSuggestions`.
import { Prisma } from '@prisma/client';
import type { ForecastPoint } from '../shared';

export interface ShelfLifeCapInput {
  /** forecastConsumption − currentStock del insumo en TODO el horizonte (>0). */
  shortfall: Prisma.Decimal;
  /** Consumo proyectado del insumo en TODO el horizonte solicitado. */
  forecastConsumption: Prisma.Decimal;
  /** Stock on-hand actual del insumo. */
  currentStock: Prisma.Decimal;
  /** Σ yhat de TODOS los días usados para `forecastConsumption` (denominador). */
  totalForecastUnits: Prisma.Decimal;
  /** Σ yhat de los primeros `min(horizon, shelfLifeDays)` días (numerador). */
  subWindowForecastUnits: Prisma.Decimal;
}

export interface ShelfLifeCapResult {
  /** Cantidad final a sugerir (topada si `cappedByShelfLife`). */
  suggestedQty: Prisma.Decimal;
  /** `true` cuando el tope de vida útil redujo la cantidad sugerida. */
  cappedByShelfLife: boolean;
  /** `shortfall` sin topar; solo se expone (no-null) cuando SÍ se topó, para
   *  que la UI pueda explicar "se sugieren X aunque el déficit real es Y". */
  uncappedSuggestedQty: Prisma.Decimal | null;
}

/**
 * Topa `suggestedQty` por lo que realmente se alcanza a consumir antes de que
 * el insumo venza: `min(shortfall, consumo proyectado en min(horizon,
 * shelfLifeDays) − stock actual)`, nunca negativa. No tiene sentido comprar
 * más de lo que se va a poder usar antes de que se pierda (MVP sin lotes:
 * vida útil a nivel de insumo, ver `inventory/ingredient-freshness.util.ts`).
 */
export function capSuggestedQtyByShelfLife(
  input: ShelfLifeCapInput,
): ShelfLifeCapResult {
  const {
    shortfall,
    forecastConsumption,
    currentStock,
    totalForecastUnits,
    subWindowForecastUnits,
  } = input;

  // Fracción de la demanda total que cae dentro de la sub-ventana de vida
  // útil; 0 si no hay demanda proyectada (evita dividir por 0).
  const ratio = totalForecastUnits.gt(0)
    ? subWindowForecastUnits.div(totalForecastUnits)
    : new Prisma.Decimal(0);

  const consumptionWithinShelfLife = forecastConsumption.mul(ratio);
  const subWindowShortfall = consumptionWithinShelfLife.sub(currentStock);

  const capped = Prisma.Decimal.min(shortfall, subWindowShortfall);
  const suggestedQty = Prisma.Decimal.max(capped, 0);
  const cappedByShelfLife = !suggestedQty.eq(shortfall);

  return {
    suggestedQty,
    cappedByShelfLife,
    uncappedSuggestedQty: cappedByShelfLife ? shortfall : null,
  };
}

/** Σ `yhat` de los primeros `days` puntos de `points` (orden ascendente por
 *  `target_date` — el caller es responsable de ordenar antes de llamar). */
export function sumForecastUnits(
  points: ForecastPoint[],
  days: number,
): Prisma.Decimal {
  let sum = new Prisma.Decimal(0);
  for (const p of points.slice(0, days)) {
    sum = sum.add(new Prisma.Decimal(p.yhat));
  }
  return sum;
}
