import { describe, expect, it } from 'vitest';
import {
  dataQualityFor,
  zeroFillDailySeries,
  type DailyTotal,
} from './sales-aggregation.util';

const d = (ds: string, y: number): DailyTotal => ({ ds, y });

describe('dataQualityFor', () => {
  it('clasifica por amplitud en días', () => {
    expect(dataQualityFor(0)).toBe('insufficient');
    expect(dataQualityFor(179)).toBe('insufficient');
    expect(dataQualityFor(180)).toBe('few_shot');
    expect(dataQualityFor(364)).toBe('few_shot');
    expect(dataQualityFor(365)).toBe('good');
  });
});

describe('zeroFillDailySeries', () => {
  it('serie vacía cuando no hay días', () => {
    const s = zeroFillDailySeries([], 'total', 'Demanda total');
    expect(s.points).toEqual([]);
    expect(s.observations).toBe(0);
    expect(s.spanDays).toBe(0);
    expect(s.dataQuality).toBe('insufficient');
  });

  it('un solo día', () => {
    const s = zeroFillDailySeries([d('2024-01-01', 5)], 'total', 'x');
    expect(s.points).toEqual([{ ds: '2024-01-01', y: 5 }]);
    expect(s.observations).toBe(1);
    expect(s.spanDays).toBe(1);
  });

  it('rellena con 0 los días sin ventas entre el primero y el último', () => {
    const s = zeroFillDailySeries(
      [d('2024-01-01', 4), d('2024-01-04', 6)],
      'total',
      'x',
    );
    expect(s.points).toEqual([
      { ds: '2024-01-01', y: 4 },
      { ds: '2024-01-02', y: 0 },
      { ds: '2024-01-03', y: 0 },
      { ds: '2024-01-04', y: 6 },
    ]);
    // observations = días CON venta; spanDays = amplitud inclusiva.
    expect(s.observations).toBe(2);
    expect(s.spanDays).toBe(4);
  });

  it('ordena ascendente y suma días repetidos (defensivo)', () => {
    const s = zeroFillDailySeries(
      [d('2024-01-03', 1), d('2024-01-01', 1), d('2024-01-01', 2)],
      'total',
      'x',
    );
    expect(s.points).toEqual([
      { ds: '2024-01-01', y: 3 },
      { ds: '2024-01-02', y: 0 },
      { ds: '2024-01-03', y: 1 },
    ]);
  });

  it('propaga seriesId y label', () => {
    const s = zeroFillDailySeries([d('2024-01-01', 1)], 'item-1', 'Ceviche');
    expect(s.seriesId).toBe('item-1');
    expect(s.label).toBe('Ceviche');
  });
});
