import { describe, expect, it } from 'vitest';
import {
  mostRelevantDriver,
  planShortfallNotifications,
} from './forecast-shortfall.util';
import type { ForecastDriver, ShoppingSuggestionItem } from '../shared';

const item = (id: string, shortfall: string): ShoppingSuggestionItem => ({
  ingredientId: id,
  name: `Insumo ${id}`,
  unit: 'kg',
  currentStock: '1',
  forecastConsumption: '2',
  shortfall,
  suggestedQty: shortfall,
});

const driver = (
  date: string,
  label: string,
  impact_pct: number | null,
): ForecastDriver => ({ date, kind: 'holiday', label, impact_pct });

describe('planShortfallNotifications', () => {
  it('sin shortfalls → mode none', () => {
    expect(planShortfallNotifications([], 3)).toEqual({ mode: 'none' });
  });

  it('shortfalls ≤ límite → una notificación por insumo', () => {
    const suggestions = [item('a', '5'), item('b', '3')];
    const plan = planShortfallNotifications(suggestions, 3);
    expect(plan.mode).toBe('individual');
    if (plan.mode === 'individual') {
      expect(plan.items).toHaveLength(2);
      expect(plan.items[0].ingredientId).toBe('a');
    }
  });

  it('shortfalls > límite → UNA notificación agrupada con los más críticos', () => {
    const suggestions = [
      item('a', '10'),
      item('b', '8'),
      item('c', '6'),
      item('d', '4'),
    ];
    const plan = planShortfallNotifications(suggestions, 3);
    expect(plan.mode).toBe('grouped');
    if (plan.mode === 'grouped') {
      expect(plan.items).toHaveLength(3);
      expect(plan.items.map((i) => i.ingredientId)).toEqual(['a', 'b', 'c']);
      expect(plan.totalCount).toBe(4);
      expect(plan.extraCount).toBe(1);
    }
  });

  it('exactamente en el límite → individual (no agrupado)', () => {
    const suggestions = [item('a', '5'), item('b', '3'), item('c', '1')];
    const plan = planShortfallNotifications(suggestions, 3);
    expect(plan.mode).toBe('individual');
  });
});

describe('mostRelevantDriver', () => {
  it('sin drivers → null', () => {
    expect(mostRelevantDriver([])).toBeNull();
  });

  it('prioriza el mayor |impact_pct| sobre el orden cronológico', () => {
    const drivers = [
      driver('2026-07-10', 'Fin de semana', 5),
      driver('2026-07-28', 'Fiestas Patrias', 35),
      driver('2026-07-12', 'Evento gastronómico', -10),
    ];
    expect(mostRelevantDriver(drivers)?.label).toBe('Fiestas Patrias');
  });

  it('sin impacto conocido en ninguno → cae al primero (cronológico)', () => {
    const drivers = [
      driver('2026-07-10', 'Fin de semana', null),
      driver('2026-07-28', 'Fiestas Patrias', null),
    ];
    expect(mostRelevantDriver(drivers)?.label).toBe('Fin de semana');
  });

  it('impacto negativo grande también gana (compara valor absoluto)', () => {
    const drivers = [
      driver('2026-07-10', 'Lluvia fuerte', -40),
      driver('2026-07-12', 'Feriado menor', 5),
    ];
    expect(mostRelevantDriver(drivers)?.label).toBe('Lluvia fuerte');
  });
});
