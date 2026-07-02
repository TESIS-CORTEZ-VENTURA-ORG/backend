// E09×E08 (chat futuro) · Réplica MÍNIMA del cálculo de "día calendario Lima"
// (UTC-5, fijo, sin horario de verano — CLAUDE.md §6). Deliberadamente NO se
// importa `forecasting/forecasting.service.ts` (su `todayLima()` es privado, y
// el criterio del repo es no crear un cross-import solo para esto — mismo
// patrón ya usado en `billing/lima-day.util.ts` §QA-07 / `ingestion`: cada
// bounded context replica la fórmula mínima en vez de acoplarse a otro módulo.
//
// Todas las fechas de este util son strings 'YYYY-MM-DD' (sin hora), porque
// el rango que le interesa al chat de futuro es un día calendario Lima, no un
// instante. La aritmética de días se hace anclando el string a medianoche UTC
// (`T00:00:00Z`) — es seguro porque solo contamos días completos, nunca cruzamos
// un límite de huso horario real en este cálculo.

const LIMA_OFFSET_MINUTES = -5 * 60;
const MS_PER_MINUTE = 60_000;

/** Día calendario Lima (`YYYY-MM-DD`) que contiene el instante `at` (default: ahora). */
export function todayLima(at: Date = new Date()): string {
  const local = new Date(at.getTime() + LIMA_OFFSET_MINUTES * MS_PER_MINUTE);
  const year = local.getUTCFullYear();
  const month = String(local.getUTCMonth() + 1).padStart(2, '0');
  const day = String(local.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Día de la semana (0=domingo..6=sábado) de una fecha 'YYYY-MM-DD', sin hora. */
export function dayOfWeek(dateIso: string): number {
  return new Date(`${dateIso}T00:00:00Z`).getUTCDay();
}

/** `dateIso` + `days` (puede ser negativo), devuelto como 'YYYY-MM-DD'. */
export function addDays(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Último día del mes (`YYYY-MM-DD`) que contiene `dateIso`. */
export function lastDayOfMonth(dateIso: string): string {
  const [year, month] = dateIso.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

/** Primer día del mes SIGUIENTE al que contiene `dateIso`. */
export function firstDayOfNextMonth(dateIso: string): string {
  const [year, month] = dateIso.split('-').map(Number) as [number, number];
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
}
