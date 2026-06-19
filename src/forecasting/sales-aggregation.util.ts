// E08 · Agregación PURA de demanda diaria desde filas de `sales_history` (sin DB)
// → testeable. Convierte el histórico de ventas en una serie temporal regular y
// zero-filled lista para `core-ai` (`POST /forecast/run`, `history:[{ds,y}]`).
//
// El proyecto opera solo en America/Lima (CLAUDE.md §6, UTC-5 sin DST). Los
// timestamps (`sold_on`) se guardan en UTC; el bucketing por día se hace en la
// zona del tenant. La lógica de día local se replica aquí (no se importa el
// módulo `reports`) para no cruzar la frontera de módulos (backend.md §3), igual
// que hace `sales-history.service`.

// America/Lima = UTC-5 fijo (sin horario de verano). Offset en minutos.
const LIMA_OFFSET_MINUTES = -5 * 60;
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

// Umbrales de calidad para forecasting (HU-11-03 / E08): el histórico habilita
// few-shot a partir de ~6 meses y "buena calidad" a partir de ~12 meses.
const FEW_SHOT_MIN_DAYS = 180;
const GOOD_MIN_DAYS = 365;

/** Fila mínima de `sales_history` necesaria para agregar demanda. */
export interface SalesRow {
  soldOn: Date;
  menuItemId: string | null;
  dishName: string;
  qty: number;
}

/** Punto de la serie temporal: `ds` = día local `YYYY-MM-DD`, `y` = unidades. */
export interface HistoryPoint {
  ds: string;
  y: number;
}

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

/** Clave de día local (Lima) `YYYY-MM-DD` para un instante UTC. */
function limaDayKey(at: Date): string {
  const local = new Date(at.getTime() + LIMA_OFFSET_MINUTES * MS_PER_MINUTE);
  return utcMidnightMsToDayKey(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()),
  );
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
 * Construye una serie diaria zero-filled a partir de la demanda por día. Rellena
 * con 0 los días sin ventas entre el primero y el último (un día sin venta es
 * demanda 0, no un hueco — los modelos esperan una serie regular).
 */
function buildDailySeries(byDay: Map<string, number>): {
  points: HistoryPoint[];
  spanDays: number;
} {
  if (byDay.size === 0) return { points: [], spanDays: 0 };

  const keys = [...byDay.keys()].sort();
  const firstMs = dayKeyToUtcMidnightMs(keys[0]);
  const lastMs = dayKeyToUtcMidnightMs(keys[keys.length - 1]);
  const spanDays = Math.round((lastMs - firstMs) / MS_PER_DAY) + 1;

  const points: HistoryPoint[] = [];
  for (let ms = firstMs; ms <= lastMs; ms += MS_PER_DAY) {
    const ds = utcMidnightMsToDayKey(ms);
    points.push({ ds, y: byDay.get(ds) ?? 0 });
  }
  return { points, spanDays };
}

function seriesFrom(
  rows: SalesRow[],
  seriesId: string,
  label: string,
): AggregatedSeries {
  const byDay = new Map<string, number>();
  for (const row of rows) {
    const key = limaDayKey(row.soldOn);
    byDay.set(key, (byDay.get(key) ?? 0) + row.qty);
  }
  const { points, spanDays } = buildDailySeries(byDay);
  return {
    seriesId,
    label,
    points,
    observations: byDay.size,
    spanDays,
    dataQuality: dataQualityFor(spanDays),
  };
}

/** Demanda diaria agregada de TODO el menú (una sola serie). */
export function aggregateTotalDemand(rows: SalesRow[]): AggregatedSeries {
  return seriesFrom(rows, 'total', 'Demanda total');
}

/**
 * Demanda diaria de un plato concreto. Filtra por `menuItemId` (enlace exacto del
 * importador); las filas sin enlace (`menuItemId=null`) no pertenecen a ningún
 * plato del catálogo y se excluyen del forecasting por plato. La etiqueta usa el
 * nombre más reciente visto para ese plato.
 */
export function aggregateMenuItem(
  rows: SalesRow[],
  menuItemId: string,
): AggregatedSeries {
  const matched = rows.filter((r) => r.menuItemId === menuItemId);
  const label = labelForMenuItem(matched) ?? menuItemId;
  return seriesFrom(matched, menuItemId, label);
}

function labelForMenuItem(rows: SalesRow[]): string | null {
  let latest: SalesRow | null = null;
  for (const row of rows) {
    if (latest === null || row.soldOn.getTime() >= latest.soldOn.getTime()) {
      latest = row;
    }
  }
  return latest?.dishName ?? null;
}
