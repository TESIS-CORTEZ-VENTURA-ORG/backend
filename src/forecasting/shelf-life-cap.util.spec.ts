import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  capSuggestedQtyByShelfLife,
  sumForecastUnits,
} from './shelf-life-cap.util';
import type { ForecastPoint } from '../shared';

const D = (v: string) => new Prisma.Decimal(v);

const point = (targetDate: string, yhat: number): ForecastPoint => ({
  target_date: targetDate,
  yhat,
  yhat_lo: yhat,
  yhat_hi: yhat,
});

describe('sumForecastUnits', () => {
  it('suma los primeros N puntos (orden ascendente asumido)', () => {
    const points = [
      point('2026-07-02', 10),
      point('2026-07-03', 20),
      point('2026-07-04', 30),
    ];
    expect(sumForecastUnits(points, 2).toString()).toBe('30'); // 10+20
    expect(sumForecastUnits(points, 3).toString()).toBe('60');
  });

  it('N mayor a la longitud del array → suma todo sin error', () => {
    const points = [point('2026-07-02', 10)];
    expect(sumForecastUnits(points, 99).toString()).toBe('10');
  });
});

describe('capSuggestedQtyByShelfLife', () => {
  it('shelfLifeDays ≥ horizon (sub-ventana = ventana completa) → sin tope', () => {
    // subWindowForecastUnits == totalForecastUnits → ratio=1 → sin cambio.
    const result = capSuggestedQtyByShelfLife({
      shortfall: D('60.6'),
      forecastConsumption: D('61.6'),
      currentStock: D('1'),
      totalForecastUnits: D('280'),
      subWindowForecastUnits: D('280'),
    });
    expect(result.cappedByShelfLife).toBe(false);
    expect(result.suggestedQty.toFixed(1)).toBe('60.6');
    expect(result.uncappedSuggestedQty).toBeNull();
  });

  it('shelfLifeDays < horizon → topa a lo consumible antes del vencimiento', () => {
    // Horizonte 14 días, forecastConsumption=61.6kg (100% de la demanda).
    // shelfLifeDays=2 → sub-ventana cubre solo 20/280 = ~7.14% de la demanda.
    const result = capSuggestedQtyByShelfLife({
      shortfall: D('60.6'), // 61.6 - stock(1)
      forecastConsumption: D('61.6'),
      currentStock: D('1'),
      totalForecastUnits: D('280'), // Σ yhat de 14 días (20/día)
      subWindowForecastUnits: D('40'), // Σ yhat de 2 días (20/día)
    });
    // consumptionWithinShelfLife = 61.6 × (40/280) = 8.8
    // subWindowShortfall = 8.8 - 1 = 7.8
    expect(result.cappedByShelfLife).toBe(true);
    expect(result.suggestedQty.toFixed(2)).toBe('7.80');
    expect(result.uncappedSuggestedQty?.toFixed(1)).toBe('60.6');
  });

  it('stock ya cubre la sub-ventana → tope en 0 (nunca negativo)', () => {
    const result = capSuggestedQtyByShelfLife({
      shortfall: D('10'),
      forecastConsumption: D('20'),
      currentStock: D('15'), // más que lo que se consume en la sub-ventana
      totalForecastUnits: D('100'),
      subWindowForecastUnits: D('20'), // consumptionWithinShelfLife = 4
    });
    expect(result.suggestedQty.toString()).toBe('0');
    expect(result.cappedByShelfLife).toBe(true);
  });

  it('totalForecastUnits=0 → ratio=0, no revienta por división por 0', () => {
    const result = capSuggestedQtyByShelfLife({
      shortfall: D('5'),
      forecastConsumption: D('0'),
      currentStock: D('0'),
      totalForecastUnits: D('0'),
      subWindowForecastUnits: D('0'),
    });
    expect(result.suggestedQty.toString()).toBe('0');
  });
});
