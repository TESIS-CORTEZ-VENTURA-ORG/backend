// LOTE B5 · Formateo puro y testeable de la respuesta `kind: 'future'` del
// chat (`ChatService.answerFuture`). Extraído a un util dedicado (mismo
// patrón que `forecast-shortfall.util.ts`/`shelf-life-cap.util.ts`) porque
// ambas funciones encapsulan una decisión de producto que merece tests
// exhaustivos sin levantar el resto del servicio (DB, core-ai, RLS).

/**
 * QA-23 · Estimación de ingresos (S/) DERIVADA — unidades pronosticadas ×
 * ticket promedio por plato. Es una CONVERSIÓN explícita, no una serie de
 * ingresos real: `sales_history` solo permite proyectar demanda en UNIDADES
 * (platos vendidos/día — ver `sales-aggregation.util.ts`/`dailyTotals`), y el
 * bug original de QA-23 fue justamente re-etiquetar esas unidades como si
 * fueran soles. Este shape declara la derivación (`avgUnitPrice`/`basisDays`)
 * para que el frontend/usuario nunca la confunda con una proyección directa.
 */
export interface EstimatedRevenue {
  /** Unidades pronosticadas × `avgUnitPrice`, redondeado a centavos. */
  total: number;
  lo: number;
  hi: number;
  /** Ticket promedio por plato (S/) usado para la derivación, redondeado a centavos. */
  avgUnitPrice: number;
  /** Ventana (días) de `sales_history` de la que salió `avgUnitPrice` — ver `AVG_UNIT_PRICE_WINDOW_DAYS`. */
  basisDays: number;
}

/** Unidades pronosticadas (total + banda) — el shape que ya expone `ForecastRangeAnswer`. */
export interface ForecastUnits {
  total: number;
  lo: number;
  hi: number;
}

/**
 * Deriva una {@link EstimatedRevenue} a partir de unidades pronosticadas y el
 * ticket promedio por plato. `null` cuando `avgUnitPrice` es `null` (sin
 * ventas en la ventana de referencia, ver `ForecastingService.getForecastForRange`)
 * — NUNCA se inventa un precio ni se cae a una constante mágica; sin dato
 * real, el chat simplemente omite la estimación en soles y responde solo en
 * unidades (honestidad > completitud, mismo criterio que el resto de
 * respuestas `needsForecast`/`outOfHorizon` de este módulo).
 */
export function estimateRevenue(
  units: ForecastUnits,
  avgUnitPrice: number | null,
  basisDays: number,
): EstimatedRevenue | null {
  if (avgUnitPrice === null) return null;
  return {
    total: round2(units.total * avgUnitPrice),
    lo: round2(units.lo * avgUnitPrice),
    hi: round2(units.hi * avgUnitPrice),
    avgUnitPrice: round2(avgUnitPrice),
    basisDays,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * QA-22 · Los drivers de una `ForecastRun` son POR DÍA — un fin de semana
 * completo (sáb+dom) trae 2 drivers `weekend`, ambos con el MISMO `label`
 * ("Fin de semana"). El chip visual del frontend ya deduplica por label, pero
 * la frase de `answer` los concatenaba tal cual → "Incluye el efecto de Fin
 * de semana, Fin de semana." Esta función deduplica por label (preserva el
 * orden de primera aparición) y arma una lista en español natural: un solo
 * label se devuelve tal cual; 2+ labels distintos se unen con comas y un "y"
 * final (regla de estilo español estándar, no un simple `join(', ')`).
 */
export function formatDriverLabels(labels: string[]): string {
  const distinct = [...new Set(labels)];
  if (distinct.length === 0) return '';
  if (distinct.length === 1) return distinct[0];
  return `${distinct.slice(0, -1).join(', ')} y ${distinct.at(-1) as string}`;
}
