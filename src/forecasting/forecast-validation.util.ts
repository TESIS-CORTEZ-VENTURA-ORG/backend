// E08 · HU-08-05 — Comparación PURA predicho vs real (sin DB) → testeable.
//
// Toma los puntos de un pronóstico y la demanda REAL por día (la que el servicio
// agrega de `sales_history`) y produce, por día: predicho vs real, error % (APE)
// y si el real cayó dentro del intervalo q10–q90 (yhat_lo..yhat_hi). El resumen
// agrega el MAPE acumulado y la cobertura del intervalo.

/** Punto de pronóstico (mismo shape que persiste core-ai). */
export interface ForecastPointLike {
  target_date: string;
  yhat: number;
  yhat_lo: number;
  yhat_hi: number;
}

/** Una fila de la validación. `pending` = el día aún no tiene real disponible. */
export interface ValidationRow {
  targetDate: string;
  yhat: number;
  yhatLo: number;
  yhatHi: number;
  actual: number | null;
  errorPct: number | null; // APE; null si el real es 0 (no se puede dividir)
  // SMAPE por día — a diferencia del APE (denominador = real), el denominador es
  // el promedio de |real| y |predicho|, así que solo es null cuando AMBOS son 0
  // (el HU-08-08 accuracy endpoint lo usa porque no se rompe con reales en 0,
  // algo común en insumos/platos de baja rotación).
  smapePct: number | null;
  inInterval: boolean | null; // real ∈ [yhat_lo, yhat_hi]
  status: 'compared' | 'pending';
}

export interface ValidationSummary {
  comparedDays: number;
  mape: number | null; // promedio de los APE (días con real > 0); null si ninguno
  // SMAPE realizado — promedio de `smapePct` (días con real+predicho ≠ 0 ambos 0).
  smape: number | null;
  intervalCoveragePct: number | null; // % de días comparados con el real en el intervalo
}

export interface ForecastValidation {
  rows: ValidationRow[];
  summary: ValidationSummary;
}

const round = (n: number): number => Math.round(n * 100) / 100;

/**
 * Compara cada punto del pronóstico contra el real. Un día es `compared` si su
 * fecha está en `actualByDay` (el servicio incluye ahí solo los días ya
 * transcurridos, con 0 si no hubo ventas); el resto queda `pending`.
 */
export function compareForecastVsActual(
  points: ForecastPointLike[],
  actualByDay: Record<string, number>,
): ForecastValidation {
  const rows: ValidationRow[] = points.map((p) => {
    if (!Object.prototype.hasOwnProperty.call(actualByDay, p.target_date)) {
      return {
        targetDate: p.target_date,
        yhat: p.yhat,
        yhatLo: p.yhat_lo,
        yhatHi: p.yhat_hi,
        actual: null,
        errorPct: null,
        smapePct: null,
        inInterval: null,
        status: 'pending',
      };
    }
    const actual = actualByDay[p.target_date];
    const errorPct =
      actual === 0 ? null : round((Math.abs(actual - p.yhat) / actual) * 100);
    // SMAPE: denominador = promedio de |real| y |predicho| — solo indefinido si
    // AMBOS son 0 (a diferencia del APE, que se rompe con real=0 y predicho>0).
    const smapeDenom = (Math.abs(actual) + Math.abs(p.yhat)) / 2;
    const smapePct =
      smapeDenom === 0
        ? null
        : round((Math.abs(actual - p.yhat) / smapeDenom) * 100);
    return {
      targetDate: p.target_date,
      yhat: p.yhat,
      yhatLo: p.yhat_lo,
      yhatHi: p.yhat_hi,
      actual,
      errorPct,
      smapePct,
      inInterval: actual >= p.yhat_lo && actual <= p.yhat_hi,
      status: 'compared',
    };
  });

  const compared = rows.filter((r) => r.status === 'compared');
  const apes = compared
    .map((r) => r.errorPct)
    .filter((e): e is number => e !== null);
  const smapes = compared
    .map((r) => r.smapePct)
    .filter((e): e is number => e !== null);
  const inInterval = compared.filter((r) => r.inInterval === true).length;

  return {
    rows,
    summary: {
      comparedDays: compared.length,
      mape: apes.length
        ? round(apes.reduce((s, e) => s + e, 0) / apes.length)
        : null,
      smape: smapes.length
        ? round(smapes.reduce((s, e) => s + e, 0) / smapes.length)
        : null,
      intervalCoveragePct: compared.length
        ? round((inInterval / compared.length) * 100)
        : null,
    },
  };
}
