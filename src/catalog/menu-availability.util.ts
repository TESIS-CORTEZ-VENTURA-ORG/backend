// HU-02-13: lógica pura de disponibilidad por horario (sin DB) → fácilmente testeable.

// El proyecto opera solo en PEN / America/Lima (CLAUDE.md §6). UTC-5 sin DST.
export const TENANT_TIMEZONE = 'America/Lima';

export interface AvailabilityWindow {
  dayOfWeek: number | null; // 0=domingo..6=sábado; null = todos los días
  startMinute: number; // minutos desde medianoche
  endMinute: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Día de semana (0=domingo) y minuto del día para un instante, en la zona del tenant. */
export function localDayAndMinute(
  at: Date,
  timeZone: string = TENANT_TIMEZONE,
): { dayOfWeek: number; minuteOfDay: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  const dayOfWeek = WEEKDAY_INDEX[get('weekday')] ?? 0;
  let hour = Number(get('hour'));
  if (hour === 24) hour = 0; // hour12:false puede dar '24' a medianoche
  const minuteOfDay = hour * 60 + Number(get('minute'));
  return { dayOfWeek, minuteOfDay };
}

/**
 * ¿El plato está disponible en (dayOfWeek, minuteOfDay) dadas sus ventanas?
 * Sin ventanas → disponible siempre (comportamiento por defecto).
 * Disponible si ALGUNA ventana cubre el día y la hora ([start, end)).
 */
export function isAvailable(
  windows: AvailabilityWindow[],
  dayOfWeek: number,
  minuteOfDay: number,
): boolean {
  if (windows.length === 0) {
    return true;
  }
  return windows.some(
    (w) =>
      (w.dayOfWeek === null || w.dayOfWeek === dayOfWeek) &&
      minuteOfDay >= w.startMinute &&
      minuteOfDay < w.endMinute,
  );
}
