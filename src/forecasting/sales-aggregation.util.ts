// E08 · Zero-fill PURO de una serie de demanda diaria (sin DB) → testeable.
//
// El bucketing por día local (Lima) y la suma de unidades los hace Postgres
// (GROUP BY en `forecasting.service`), que es donde está el dato y escala. Acá
// solo se rellenan los días sin ventas con 0 (un día sin venta es demanda 0, no
// un hueco — los modelos esperan una serie regular) y se clasifica la calidad.

const MS_PER_DAY = 24 * 60 * 60_000;

// Umbrales de calidad para forecasting (HU-11-03 / E08): el histórico habilita
// few-shot a partir de ~6 meses y "buena calidad" a partir de ~12 meses.
const FEW_SHOT_MIN_DAYS = 180;
const GOOD_MIN_DAYS = 365;

/** Total de unidades de un día local: `ds` = `YYYY-MM-DD`, `y` = unidades. */
export interface DailyTotal {
  ds: string;
  y: number;
}

/** Punto de la serie temporal (mismo shape que consume `core-ai`). */
export type HistoryPoint = DailyTotal;

export type DataQuality = 'insufficient' | 'few_shot' | 'good';

/** Serie de demanda diaria agregada, lista para inferir. */
export interface AggregatedSeries {
  seriesId: string;
  label: string;
  points: HistoryPoint[]; // diarios, zero-filled, ascendentes
  observations: number; // días con al menos una venta
  spanDays: number; // amplitud inclusiva (primer..último día con venta)
  dataQuality: DataQuality;
}

/** Clasifica la calidad del histórico por su amplitud en días. */
export function dataQualityFor(spanDays: number): DataQuality {
  if (spanDays >= GOOD_MIN_DAYS) return 'good';
  if (spanDays >= FEW_SHOT_MIN_DAYS) return 'few_shot';
  return 'insufficient';
}

function dayKeyToUtcMidnightMs(dayKey: string): number {
  return new Date(`${dayKey}T00:00:00Z`).getTime();
}

function utcMidnightMsToDayKey(ms: number): string {
  const d = new Date(ms);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Construye una serie diaria zero-filled a partir de los totales por día que
 * devuelve la query (uno por día con ventas, ya en la zona del tenant). Rellena
 * con 0 los días sin ventas entre el primero y el último.
 */
export function zeroFillDailySeries(
  daily: DailyTotal[],
  seriesId: string,
  label: string,
): AggregatedSeries {
  const byDay = new Map<string, number>();
  for (const d of daily) {
    byDay.set(d.ds, (byDay.get(d.ds) ?? 0) + d.y);
  }

  if (byDay.size === 0) {
    return {
      seriesId,
      label,
      points: [],
      observations: 0,
      spanDays: 0,
      dataQuality: dataQualityFor(0),
    };
  }

  const keys = [...byDay.keys()].sort();
  const firstMs = dayKeyToUtcMidnightMs(keys[0]);
  const lastMs = dayKeyToUtcMidnightMs(keys[keys.length - 1]);
  const spanDays = Math.round((lastMs - firstMs) / MS_PER_DAY) + 1;

  const points: HistoryPoint[] = [];
  for (let ms = firstMs; ms <= lastMs; ms += MS_PER_DAY) {
    const ds = utcMidnightMsToDayKey(ms);
    points.push({ ds, y: byDay.get(ds) ?? 0 });
  }

  return {
    seriesId,
    label,
    points,
    observations: byDay.size,
    spanDays,
    dataQuality: dataQualityFor(spanDays),
  };
}
