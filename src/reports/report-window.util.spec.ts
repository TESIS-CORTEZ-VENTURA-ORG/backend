import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import {
  lastNLimaDays,
  limaDayKey,
  limaDayStart,
  resolveWindow,
  startOfLimaDay,
} from './report-window.util';

describe('report-window.util (E07)', () => {
  it('startOfLimaDay = medianoche local de Lima (UTC-5) en instante UTC', () => {
    // 2026-06-14T03:00:00Z = 2026-06-13T22:00 en Lima → inicio del día 13 = 05:00Z.
    const at = new Date('2026-06-14T03:00:00Z');
    expect(startOfLimaDay(at).toISOString()).toBe('2026-06-13T05:00:00.000Z');

    // 2026-06-14T10:00:00Z = 2026-06-14T05:00 en Lima → inicio del día 14 = 05:00Z.
    const at2 = new Date('2026-06-14T10:00:00Z');
    expect(startOfLimaDay(at2).toISOString()).toBe('2026-06-14T05:00:00.000Z');
  });

  it('limaDayKey usa el día local (Lima), no el día UTC', () => {
    // Antes de medianoche Lima del 13 (03:00Z del 14) sigue siendo el 13 en Lima.
    expect(limaDayKey(new Date('2026-06-14T03:00:00Z'))).toBe('2026-06-13');
    expect(limaDayKey(new Date('2026-06-14T10:00:00Z'))).toBe('2026-06-14');
  });

  it('resolveWindow sin params → [medianoche local hoy, now]', () => {
    const now = new Date('2026-06-14T18:30:00Z'); // 13:30 Lima
    const w = resolveWindow(undefined, undefined, now);
    expect(w.from.toISOString()).toBe('2026-06-14T05:00:00.000Z');
    expect(w.to).toBe(now);
  });

  it('resolveWindow con ISO from/to los respeta tal cual', () => {
    const w = resolveWindow(
      '2026-06-01T00:00:00-05:00',
      '2026-06-30T23:59:59-05:00',
    );
    expect(w.from.toISOString()).toBe('2026-06-01T05:00:00.000Z');
    expect(w.to.toISOString()).toBe('2026-07-01T04:59:59.000Z');
  });

  it('resolveWindow con from > to → 400', () => {
    expect(() =>
      resolveWindow('2026-06-30T00:00:00Z', '2026-06-01T00:00:00Z'),
    ).toThrow(BadRequestException);
  });

  it('limaDayStart parsea una clave de día a su medianoche local (Lima) en UTC', () => {
    // medianoche del 9 jun en Lima = 05:00Z del 9 jun. Es el inverso de limaDayKey.
    const start = limaDayStart('2026-06-09');
    expect(start.toISOString()).toBe('2026-06-09T05:00:00.000Z');
    expect(limaDayKey(start)).toBe('2026-06-09');
  });

  it('lastNLimaDays(7) = 7 claves ascendentes terminando en hoy (Lima)', () => {
    const now = new Date('2026-06-14T18:30:00Z'); // 14 en Lima
    const days = lastNLimaDays(7, now);
    expect(days).toHaveLength(7);
    expect(days[6]).toBe('2026-06-14');
    expect(days[0]).toBe('2026-06-08');
    // estrictamente ascendentes
    expect([...days].sort()).toEqual(days);
  });
});
