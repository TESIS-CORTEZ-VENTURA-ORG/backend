import { describe, expect, it } from 'vitest';
import {
  aggregateMenuItem,
  aggregateTotalDemand,
  dataQualityFor,
  type SalesRow,
} from './sales-aggregation.util';

// Helper: fila de venta en un día local (Lima) a mediodía (evita cruces de día
// por el offset UTC-5 en los tests).
function row(
  day: string,
  qty: number,
  menuItemId: string | null = null,
  dishName = 'Lomo Saltado',
): SalesRow {
  return {
    soldOn: new Date(`${day}T12:00:00-05:00`),
    menuItemId,
    dishName,
    qty,
  };
}

describe('dataQualityFor', () => {
  it('clasifica por amplitud en días', () => {
    expect(dataQualityFor(0)).toBe('insufficient');
    expect(dataQualityFor(179)).toBe('insufficient');
    expect(dataQualityFor(180)).toBe('few_shot');
    expect(dataQualityFor(364)).toBe('few_shot');
    expect(dataQualityFor(365)).toBe('good');
  });
});

describe('aggregateTotalDemand', () => {
  it('serie vacía cuando no hay filas', () => {
    const s = aggregateTotalDemand([]);
    expect(s.points).toEqual([]);
    expect(s.observations).toBe(0);
    expect(s.spanDays).toBe(0);
    expect(s.dataQuality).toBe('insufficient');
  });

  it('suma la qty del mismo día local', () => {
    const s = aggregateTotalDemand([
      row('2024-01-01', 3),
      row('2024-01-01', 2),
    ]);
    expect(s.points).toEqual([{ ds: '2024-01-01', y: 5 }]);
    expect(s.observations).toBe(1);
    expect(s.spanDays).toBe(1);
  });

  it('zero-fill de los días sin ventas entre el primero y el último', () => {
    const s = aggregateTotalDemand([
      row('2024-01-01', 4),
      row('2024-01-04', 6),
    ]);
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

  it('ordena ascendente aunque las filas lleguen desordenadas', () => {
    const s = aggregateTotalDemand([
      row('2024-01-03', 1),
      row('2024-01-01', 1),
      row('2024-01-02', 1),
    ]);
    expect(s.points.map((p) => p.ds)).toEqual([
      '2024-01-01',
      '2024-01-02',
      '2024-01-03',
    ]);
  });
});

describe('aggregateMenuItem', () => {
  const A = '11111111-1111-1111-1111-111111111111';
  const B = '22222222-2222-2222-2222-222222222222';

  it('filtra por menuItemId y excluye filas sin enlace', () => {
    const s = aggregateMenuItem(
      [
        row('2024-01-01', 2, A, 'Ceviche'),
        row('2024-01-01', 9, B, 'Lomo'),
        row('2024-01-01', 7, null, 'Plato Fantasma'),
      ],
      A,
    );
    expect(s.seriesId).toBe(A);
    expect(s.label).toBe('Ceviche');
    expect(s.points).toEqual([{ ds: '2024-01-01', y: 2 }]);
  });

  it('etiqueta con el nombre más reciente del plato', () => {
    const s = aggregateMenuItem(
      [
        row('2024-01-01', 1, A, 'Ceviche'),
        row('2024-02-01', 1, A, 'Ceviche Mixto'),
      ],
      A,
    );
    expect(s.label).toBe('Ceviche Mixto');
  });

  it('serie vacía si el plato no tiene ventas', () => {
    const s = aggregateMenuItem([row('2024-01-01', 1, B)], A);
    expect(s.points).toEqual([]);
    expect(s.observations).toBe(0);
  });
});
