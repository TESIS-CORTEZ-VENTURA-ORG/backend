import { describe, expect, it } from 'vitest';
import {
  compareForecastVsActual,
  type ForecastPointLike,
} from './forecast-validation.util';

const p = (
  target_date: string,
  yhat: number,
  yhat_lo: number,
  yhat_hi: number,
): ForecastPointLike => ({ target_date, yhat, yhat_lo, yhat_hi });

describe('compareForecastVsActual', () => {
  it('compara real vs predicho: error %, intervalo y MAPE acumulado', () => {
    const points = [p('2024-01-08', 10, 8, 12), p('2024-01-09', 20, 18, 22)];
    const actual = { '2024-01-08': 11, '2024-01-09': 25 };

    const v = compareForecastVsActual(points, actual);

    expect(v.rows[0]).toMatchObject({
      actual: 11,
      inInterval: true, // 11 ∈ [8,12]
      errorPct: 9.09, // |11-10|/11
      smapePct: 9.52, // |11-10|/((11+10)/2) = 1/10.5
      status: 'compared',
    });
    expect(v.rows[1]).toMatchObject({
      actual: 25,
      inInterval: false, // 25 ∉ [18,22]
      errorPct: 20, // |25-20|/25 = 0.20 → 20%
      smapePct: 22.22, // |25-20|/((25+20)/2) = 5/22.5
      status: 'compared',
    });
    expect(v.summary.comparedDays).toBe(2);
    // MAPE = mean(9.09, 20) = 14.55
    expect(v.summary.mape).toBe(14.55);
    // SMAPE = mean(9.52, 22.22) = 15.87
    expect(v.summary.smape).toBe(15.87);
    expect(v.summary.intervalCoveragePct).toBe(50); // 1 de 2 en intervalo
  });

  it('días sin real disponible quedan pending (no entran al MAPE)', () => {
    const points = [p('2024-01-08', 10, 8, 12), p('2099-01-01', 99, 90, 110)];
    const v = compareForecastVsActual(points, { '2024-01-08': 10 });

    expect(v.rows[1].status).toBe('pending');
    expect(v.rows[1].actual).toBeNull();
    expect(v.summary.comparedDays).toBe(1);
    expect(v.summary.mape).toBe(0); // |10-10|/10 = 0
    expect(v.summary.smape).toBe(0);
  });

  it('real = 0 no rompe el MAPE (se omite ese día del APE) pero SÍ entra al SMAPE', () => {
    const points = [p('2024-01-08', 5, 0, 10)];
    const v = compareForecastVsActual(points, { '2024-01-08': 0 });

    expect(v.rows[0].errorPct).toBeNull();
    // SMAPE no se rompe con real=0 (denominador = (0+5)/2 = 2.5, no 0).
    expect(v.rows[0].smapePct).toBe(200); // |0-5|/2.5 = 2 → 200%
    expect(v.rows[0].inInterval).toBe(true); // 0 ∈ [0,10]
    expect(v.summary.mape).toBeNull(); // ningún día con real > 0
    expect(v.summary.smape).toBe(200);
    expect(v.summary.intervalCoveragePct).toBe(100);
  });

  it('real=0 y predicho=0 → SMAPE también null (único caso indefinido)', () => {
    const points = [p('2024-01-08', 0, 0, 0)];
    const v = compareForecastVsActual(points, { '2024-01-08': 0 });
    expect(v.rows[0].smapePct).toBeNull();
    expect(v.summary.smape).toBeNull();
  });

  it('sin puntos → resumen vacío', () => {
    const v = compareForecastVsActual([], {});
    expect(v.rows).toEqual([]);
    expect(v.summary).toEqual({
      comparedDays: 0,
      mape: null,
      smape: null,
      intervalCoveragePct: null,
    });
  });
});
