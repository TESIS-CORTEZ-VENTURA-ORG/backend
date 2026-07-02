import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { computeFreshness } from './ingredient-freshness.util';

const D = (v: string) => new Prisma.Decimal(v);

describe('computeFreshness', () => {
  it('escenario del ticket: 8kg, 0.8kg/día, 3 días de vida útil → atRisk=5.6kg', () => {
    const now = new Date('2026-07-01T12:00:00-05:00');
    const result = computeFreshness({
      stock: D('8'),
      avgDailyConsumption: D('0.8'),
      daysLeft: D('10'), // 8 / 0.8 = 10 días por consumo
      shelfLifeDays: 3,
      lastPurchaseAt: now, // recién comprado: vida útil restante = 3 días exactos
      unitCost: D('40'),
      now,
    });

    // Cuello de botella: min(10, 3) = 3, NUNCA promedio.
    expect(result.effectiveCoverageDays).toBe('3.0');
    // 8 - 0.8×3 = 5.6 kg se van a perder.
    expect(result.atRiskQty).toBe('5.600');
    expect(result.atRiskCost).toBe('224.00'); // 5.6 × 40
    expect(result.freshnessStatus).toBe('fresh'); // 3d > 2d y > 30%·3=0.9d
  });

  it('min(10 vs 3) = 3 — cobertura por consumo NUNCA gana si la vida útil es el cuello de botella', () => {
    const now = new Date('2026-07-01T00:00:00-05:00');
    const result = computeFreshness({
      stock: D('100'),
      avgDailyConsumption: D('10'), // 100/10 = 10 días por consumo
      daysLeft: D('10'),
      shelfLifeDays: 3,
      lastPurchaseAt: now,
      unitCost: D('5'),
      now,
    });
    expect(result.effectiveCoverageDays).toBe('3.0');
  });

  it('sin compras registradas → todo null, effectiveCoverageDays degrada a daysLeft', () => {
    const result = computeFreshness({
      stock: D('5'),
      avgDailyConsumption: D('1'),
      daysLeft: D('5'),
      shelfLifeDays: 3,
      lastPurchaseAt: null,
      unitCost: D('10'),
    });
    expect(result.lastPurchaseAt).toBeNull();
    expect(result.estimatedExpiryAt).toBeNull();
    expect(result.freshnessStatus).toBeNull();
    expect(result.atRiskQty).toBeNull();
    expect(result.atRiskCost).toBeNull();
    expect(result.effectiveCoverageDays).toBe('5.0'); // = daysLeft sin cambios
  });

  it('sin shelfLifeDays configurado (no perecible) → todo null, comportamiento HU-05-11 intacto', () => {
    const now = new Date('2026-07-01T00:00:00-05:00');
    const result = computeFreshness({
      stock: D('50'),
      avgDailyConsumption: D('2'),
      daysLeft: D('25'),
      shelfLifeDays: null,
      lastPurchaseAt: now,
      unitCost: D('4.5'),
      now,
    });
    expect(result.freshnessStatus).toBeNull();
    expect(result.estimatedExpiryAt).toBeNull();
    expect(result.atRiskQty).toBeNull();
    expect(result.effectiveCoverageDays).toBe('25.0');
  });

  it('ya venció (lastPurchaseAt muy antiguo) → expired, todo el stock en riesgo', () => {
    const now = new Date('2026-07-01T00:00:00-05:00');
    const lastPurchaseAt = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 días atrás
    const result = computeFreshness({
      stock: D('4'),
      avgDailyConsumption: D('1'),
      daysLeft: D('4'),
      shelfLifeDays: 3,
      lastPurchaseAt,
      unitCost: D('30'),
      now,
    });
    expect(result.freshnessStatus).toBe('expired');
    expect(result.effectiveCoverageDays).toBe('0.0'); // clamp: no quedan días para consumir
    expect(result.atRiskQty).toBe('4.000'); // nada se alcanzó a consumir → todo en riesgo
    expect(result.atRiskCost).toBe('120.00');
  });

  it('sin consumo (avgDaily=0, daysLeft=null) → vida útil restante manda sola', () => {
    const now = new Date('2026-07-01T00:00:00-05:00');
    const result = computeFreshness({
      stock: D('10'),
      avgDailyConsumption: D('0'),
      daysLeft: null, // cobertura por consumo "infinita"
      shelfLifeDays: 5,
      lastPurchaseAt: now,
      unitCost: D('8'),
      now,
    });
    expect(result.effectiveCoverageDays).toBe('5.0'); // manda la vida útil, no "infinito"
    expect(result.atRiskQty).toBe('10.000'); // nada se consume → todo se pierde
  });

  it('expiring_soon por umbral absoluto (≤2 días, vida útil larga)', () => {
    const now = new Date('2026-07-01T00:00:00-05:00');
    const lastPurchaseAt = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000); // 8 días atrás
    const result = computeFreshness({
      stock: D('20'),
      avgDailyConsumption: D('2'),
      daysLeft: D('10'),
      shelfLifeDays: 10, // quedan 2 días exactos → cumple el umbral absoluto ≤2
      lastPurchaseAt,
      unitCost: D('4'),
      now,
    });
    expect(result.freshnessStatus).toBe('expiring_soon');
  });

  it('expiring_soon por umbral relativo (≤30% de vida útil, insumo de vida larga)', () => {
    const now = new Date('2026-07-01T00:00:00-05:00');
    // shelfLifeDays=180 (abarrotes); quedan 50 días (~27.8% de 180, > 2 absolutos
    // pero ≤ 30% → expiring_soon por el criterio relativo).
    const lastPurchaseAt = new Date(now.getTime() - 130 * 24 * 60 * 60 * 1000);
    const result = computeFreshness({
      stock: D('30'),
      avgDailyConsumption: D('0.5'),
      daysLeft: D('60'),
      shelfLifeDays: 180,
      lastPurchaseAt,
      unitCost: D('4.5'),
      now,
    });
    expect(result.freshnessStatus).toBe('expiring_soon');
  });

  it('fresh cuando queda vida útil de sobra', () => {
    const now = new Date('2026-07-01T00:00:00-05:00');
    const lastPurchaseAt = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000); // 1 día atrás
    const result = computeFreshness({
      stock: D('20'),
      avgDailyConsumption: D('1'),
      daysLeft: D('20'),
      shelfLifeDays: 10, // quedan 9 días: >2 absoluto y >30%·10=3 → fresh
      lastPurchaseAt,
      unitCost: D('4'),
      now,
    });
    expect(result.freshnessStatus).toBe('fresh');
  });
});
