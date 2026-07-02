import { describe, expect, it } from 'vitest';
import { classifyIntent } from './intent-classifier.util';

// Fixed anchor so date-range math is deterministic regardless of when the
// suite runs. 2026-07-02 is a Thursday (Lima, no DST).
const TODAY = '2026-07-02';

describe('classifyIntent', () => {
  describe('historical (existing nl2sql flow — regression-safe default)', () => {
    it('question with a domain keyword and no future signal → historical', () => {
      expect(classifyIntent('¿cuáles son mis ventas totales?', TODAY)).toEqual({
        kind: 'historical',
      });
    });

    it('regression: "¿qué insumos están por agotarse?" stays historical', () => {
      // Present-tense inventory check — must keep going through the existing
      // SQL flow (ingredients.stock <= min_stock), NOT the forecast branch.
      expect(classifyIntent('¿Qué insumos están por agotarse?', TODAY)).toEqual(
        { kind: 'historical' },
      );
    });

    it('regression: salary guardrail question stays historical (validator still runs)', () => {
      expect(classifyIntent('¿cuánto le pago a cada empleado?', TODAY)).toEqual(
        { kind: 'historical' },
      );
    });

    it('a domain keyword disambiguates a vague-looking phrase', () => {
      expect(classifyIntent('¿cómo van las ventas de hoy?', TODAY)).toEqual({
        kind: 'historical',
      });
    });
  });

  describe('out_of_domain', () => {
    it('QA-08 repro: "¿quién ganó el mundial?" has no domain keyword and no vague pattern', () => {
      expect(classifyIntent('¿quién ganó el mundial?', TODAY)).toEqual({
        kind: 'out_of_domain',
      });
    });

    it('general knowledge question stays out_of_domain', () => {
      expect(classifyIntent('¿cuál es la capital de Francia?', TODAY)).toEqual({
        kind: 'out_of_domain',
      });
    });
  });

  describe('ambiguous', () => {
    it('QA-08 repro: "¿cómo va todo?" → ambiguous, not a full dump', () => {
      expect(classifyIntent('¿cómo va todo?', TODAY)).toEqual({
        kind: 'ambiguous',
      });
    });

    it('"¿qué tal?" alone → ambiguous', () => {
      expect(classifyIntent('¿qué tal?', TODAY)).toEqual({
        kind: 'ambiguous',
      });
    });

    it('"dame un resumen" without a specific noun → ambiguous', () => {
      expect(classifyIntent('dame un resumen', TODAY)).toEqual({
        kind: 'ambiguous',
      });
    });
  });

  describe('future — explicit range recognition', () => {
    it('"este fin de semana" resolves to the upcoming Sat–Sun (Lima)', () => {
      // TODAY = Thu 2026-07-02 → next Sat = 2026-07-04, Sun = 2026-07-05.
      const intent = classifyIntent(
        '¿cuánto voy a vender este fin de semana?',
        TODAY,
      );
      expect(intent).toEqual({
        kind: 'future',
        range: {
          from: '2026-07-04',
          to: '2026-07-05',
          label: 'este fin de semana',
        },
      });
    });

    it('weekend range includes today when today already IS Saturday', () => {
      // 2026-07-04 is a Saturday.
      const intent = classifyIntent('ventas del fin de semana', '2026-07-04');
      expect(intent).toEqual({
        kind: 'future',
        range: {
          from: '2026-07-04',
          to: '2026-07-05',
          label: 'este fin de semana',
        },
      });
    });

    it('"mañana" resolves to tomorrow', () => {
      expect(classifyIntent('¿cuánto vamos a facturar mañana?', TODAY)).toEqual(
        {
          kind: 'future',
          range: { from: '2026-07-03', to: '2026-07-03', label: 'mañana' },
        },
      );
    });

    it('"pasado mañana" resolves to today+2, not confused with "mañana"', () => {
      expect(
        classifyIntent('¿cuánto se va a vender pasado mañana?', TODAY),
      ).toEqual({
        kind: 'future',
        range: { from: '2026-07-04', to: '2026-07-04', label: 'pasado mañana' },
      });
    });

    it('"esta semana" resolves from today through Sunday', () => {
      expect(classifyIntent('proyección de ventas esta semana', TODAY)).toEqual(
        {
          kind: 'future',
          range: { from: '2026-07-02', to: '2026-07-05', label: 'esta semana' },
        },
      );
    });

    it('"la próxima semana" resolves to next Mon–Sun', () => {
      expect(
        classifyIntent('pronóstico de ventas para la próxima semana', TODAY),
      ).toEqual({
        kind: 'future',
        range: {
          from: '2026-07-06',
          to: '2026-07-12',
          label: 'la próxima semana',
        },
      });
    });

    it('"este mes" resolves from today through end of month', () => {
      expect(classifyIntent('¿cuánto vamos a vender este mes?', TODAY)).toEqual(
        {
          kind: 'future',
          range: { from: '2026-07-02', to: '2026-07-31', label: 'este mes' },
        },
      );
    });

    it('"el próximo mes" resolves to the full next calendar month', () => {
      expect(
        classifyIntent('proyección de ventas del próximo mes', TODAY),
      ).toEqual({
        kind: 'future',
        range: {
          from: '2026-08-01',
          to: '2026-08-31',
          label: 'el próximo mes',
        },
      });
    });

    it('December → next month rolls the year over correctly', () => {
      expect(
        classifyIntent('¿cuánto vamos a vender el próximo mes?', '2026-12-15'),
      ).toEqual({
        kind: 'future',
        range: {
          from: '2027-01-01',
          to: '2027-01-31',
          label: 'el próximo mes',
        },
      });
    });
  });

  describe('future — fallback range (future signal without an explicit date phrase)', () => {
    it('ir-a-infinitive alone falls back to a 7-day window starting tomorrow', () => {
      expect(classifyIntent('¿cuánto vamos a vender?', TODAY)).toEqual({
        kind: 'future',
        range: {
          from: '2026-07-03',
          to: '2026-07-09',
          label: 'los próximos 7 días',
        },
      });
    });

    it('explicit forecast vocabulary alone triggers the fallback window', () => {
      expect(classifyIntent('dame el pronóstico de ventas', TODAY)).toEqual({
        kind: 'future',
        range: {
          from: '2026-07-03',
          to: '2026-07-09',
          label: 'los próximos 7 días',
        },
      });
    });
  });

  describe('accent-insensitivity', () => {
    it('accented and unaccented phrasing classify identically', () => {
      const withAccents = classifyIntent('¿Cuánto voy a vender mañana?', TODAY);
      const withoutAccents = classifyIntent(
        'Cuanto voy a vender manana?',
        TODAY,
      );
      expect(withAccents).toEqual(withoutAccents);
    });
  });
});
