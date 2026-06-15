// E07 · Lógica PURA de la ventana de fechas de los reportes (sin DB) → testeable.
//
// El proyecto opera solo en America/Lima (CLAUDE.md §6, UTC-5 sin DST). Los
// timestamps (`issuedAt`, `createdAt`, …) se guardan en UTC; la ventana "de hoy"
// y la agrupación por día se calculan en la zona del tenant.

import { BadRequestException } from '@nestjs/common';

// America/Lima = UTC-5 fijo (sin horario de verano). Offset en minutos.
export const LIMA_OFFSET_MINUTES = -5 * 60;
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

export interface DateWindow {
  from: Date; // instante UTC inicial (inclusive)
  to: Date; // instante UTC final (inclusive del extremo; las consultas usan <= to)
}

/**
 * Resuelve la ventana de un reporte. Si llegan `from`/`to` (ISO con offset) se
 * usan tal cual (instantes UTC). Si faltan, se usa "hoy" en Lima:
 * `from` = medianoche local de hoy, `to` = `now`. Exige `from <= to` (si no, 400).
 */
export function resolveWindow(
  fromIso: string | undefined,
  toIso: string | undefined,
  now: Date = new Date(),
): DateWindow {
  const from = fromIso ? new Date(fromIso) : startOfLimaDay(now);
  const to = toIso ? new Date(toIso) : now;
  if (from.getTime() > to.getTime()) {
    throw new BadRequestException(
      'El rango es inválido: "from" debe ser <= "to"',
    );
  }
  return { from, to };
}

/** Instante UTC de la medianoche (00:00) del día local (Lima) que contiene `at`. */
export function startOfLimaDay(at: Date): Date {
  // Desplaza a hora local, trunca al día, y vuelve a UTC restando el offset.
  const localMs = at.getTime() + LIMA_OFFSET_MINUTES * MS_PER_MINUTE;
  const localMidnightMs = Math.floor(localMs / MS_PER_DAY) * MS_PER_DAY;
  return new Date(localMidnightMs - LIMA_OFFSET_MINUTES * MS_PER_MINUTE);
}

/** Instante UTC de la medianoche local (Lima) de una clave de día `YYYY-MM-DD`. */
export function limaDayStart(dayKey: string): Date {
  // `YYYY-MM-DDT00:00:00` es medianoche local; se le suma el offset para volver a UTC.
  const localMidnightUtc = new Date(`${dayKey}T00:00:00Z`).getTime();
  return new Date(localMidnightUtc - LIMA_OFFSET_MINUTES * MS_PER_MINUTE);
}

/** Clave de día local (Lima) `YYYY-MM-DD` para un instante UTC. */
export function limaDayKey(at: Date): string {
  const local = new Date(at.getTime() + LIMA_OFFSET_MINUTES * MS_PER_MINUTE);
  const year = local.getUTCFullYear();
  const month = String(local.getUTCMonth() + 1).padStart(2, '0');
  const day = String(local.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Lista de claves de día local (Lima) de los últimos `days` días terminando en el
 * día de `now` (incluido), en orden ascendente. p. ej. days=7 → [hoy-6 … hoy].
 */
export function lastNLimaDays(days: number, now: Date = new Date()): string[] {
  const todayMidnight = startOfLimaDay(now);
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    keys.push(limaDayKey(new Date(todayMidnight.getTime() - i * MS_PER_DAY)));
  }
  return keys;
}
