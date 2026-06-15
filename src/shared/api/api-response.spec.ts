import { z } from 'zod';
import { ok, apiResponseSchema } from './api-response';

describe('api-response', () => {
  describe('ok()', () => {
    it('R2: envuelve data con success=true y sin meta por defecto', () => {
      const res = ok({ id: 1 });
      expect(res).toEqual({ success: true, data: { id: 1 } });
      expect(res.meta).toBeUndefined();
    });

    it('R1: incluye meta cuando se provee', () => {
      const res = ok([1, 2], { totalCount: 2, page: 1 });
      expect(res).toEqual({
        success: true,
        data: [1, 2],
        meta: { totalCount: 2, page: 1 },
      });
    });
  });

  describe('apiResponseSchema()', () => {
    it('R3: valida un envelope correcto', () => {
      const schema = apiResponseSchema(z.object({ name: z.string() }));
      const parsed = schema.parse({ success: true, data: { name: 'Motif' } });
      expect(parsed.data.name).toBe('Motif');
    });

    it('R3: rechaza un data que no cumple el schema interno', () => {
      const schema = apiResponseSchema(z.object({ name: z.string() }));
      expect(() =>
        schema.parse({ success: true, data: { name: 123 } }),
      ).toThrow();
    });
  });
});
