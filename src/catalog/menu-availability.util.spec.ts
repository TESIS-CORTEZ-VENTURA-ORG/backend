import { describe, expect, it } from 'vitest';
import {
  isAvailable,
  localDayAndMinute,
  type AvailabilityWindow,
} from './menu-availability.util';

describe('menu-availability.util (HU-02-13)', () => {
  it('localDayAndMinute convierte a la zona del tenant (America/Lima, UTC-5)', () => {
    // 18:00 UTC = 13:00 en Lima → minuto 780.
    const { dayOfWeek, minuteOfDay } = localDayAndMinute(
      new Date('2026-06-15T18:00:00Z'),
    );
    expect(minuteOfDay).toBe(13 * 60);
    expect(dayOfWeek).toBeGreaterThanOrEqual(0);
    expect(dayOfWeek).toBeLessThanOrEqual(6);
  });

  it('un instante antes de medianoche UTC sigue siendo el mismo día en Lima', () => {
    // 03:00 UTC del martes = 22:00 del lunes en Lima.
    const { minuteOfDay } = localDayAndMinute(new Date('2026-06-16T03:00:00Z'));
    expect(minuteOfDay).toBe(22 * 60);
  });

  it('sin ventanas → disponible siempre', () => {
    expect(isAvailable([], 1, 600)).toBe(true);
  });

  it('respeta la ventana [start, end) y el día', () => {
    const lunch: AvailabilityWindow[] = [
      { dayOfWeek: null, startMinute: 12 * 60, endMinute: 15 * 60 },
    ];
    expect(isAvailable(lunch, 3, 13 * 60)).toBe(true); // 13:00 dentro
    expect(isAvailable(lunch, 3, 11 * 60)).toBe(false); // 11:00 antes
    expect(isAvailable(lunch, 3, 15 * 60)).toBe(false); // 15:00 = end (exclusivo)
  });

  it('una ventana acotada a un día solo aplica ese día', () => {
    const weekendOnly: AvailabilityWindow[] = [
      { dayOfWeek: 6, startMinute: 0, endMinute: 1440 }, // solo sábado
    ];
    expect(isAvailable(weekendOnly, 6, 600)).toBe(true);
    expect(isAvailable(weekendOnly, 2, 600)).toBe(false);
  });
});
