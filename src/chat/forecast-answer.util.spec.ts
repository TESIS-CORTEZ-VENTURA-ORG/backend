import { describe, expect, it } from 'vitest';
import { estimateRevenue, formatDriverLabels } from './forecast-answer.util';

describe('estimateRevenue (QA-23)', () => {
  it('derives total/lo/hi by multiplying units × avgUnitPrice, rounded to centavos', () => {
    const result = estimateRevenue({ total: 91, lo: 76, hi: 109 }, 25.5, 30);
    expect(result).toEqual({
      total: 2320.5,
      lo: 1938,
      hi: 2779.5,
      avgUnitPrice: 25.5,
      basisDays: 30,
    });
  });

  it('returns null when avgUnitPrice is null (no sales in the reference window) — never invents a price', () => {
    expect(
      estimateRevenue({ total: 91, lo: 76, hi: 109 }, null, 30),
    ).toBeNull();
  });

  it('rounds to exactly 2 decimals even with a repeating-decimal price', () => {
    const result = estimateRevenue({ total: 3, lo: 3, hi: 3 }, 1 / 3, 30);
    expect(result?.total).toBe(1);
    expect(result?.avgUnitPrice).toBe(0.33);
  });

  it('zero units produces zero revenue, not null', () => {
    const result = estimateRevenue({ total: 0, lo: 0, hi: 0 }, 20, 30);
    expect(result).toEqual({
      total: 0,
      lo: 0,
      hi: 0,
      avgUnitPrice: 20,
      basisDays: 30,
    });
  });
});

describe('formatDriverLabels (QA-22)', () => {
  it('a single label is returned as-is', () => {
    expect(formatDriverLabels(['Fin de semana'])).toBe('Fin de semana');
  });

  it('the exact QA-22 repro: 2 identical labels (weekend sat+sun) collapse to 1, no duplication', () => {
    expect(formatDriverLabels(['Fin de semana', 'Fin de semana'])).toBe(
      'Fin de semana',
    );
  });

  it('2 distinct labels join with "y", not a comma', () => {
    expect(formatDriverLabels(['Fin de semana', 'Quincena del 15'])).toBe(
      'Fin de semana y Quincena del 15',
    );
  });

  it('3+ distinct labels use commas plus a final "y" (natural Spanish list)', () => {
    expect(
      formatDriverLabels([
        'Fiestas Patrias',
        'Fin de semana',
        'Quincena del 15',
      ]),
    ).toBe('Fiestas Patrias, Fin de semana y Quincena del 15');
  });

  it('duplicates mixed with distinct labels: dedupe first, then join', () => {
    expect(
      formatDriverLabels(['Fin de semana', 'Fin de semana', 'Quincena del 15']),
    ).toBe('Fin de semana y Quincena del 15');
  });

  it('empty list returns an empty string', () => {
    expect(formatDriverLabels([])).toBe('');
  });
});
