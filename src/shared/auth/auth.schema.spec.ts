import { loginSchema, registerSchema } from './auth.schema';

describe('auth schemas (R4)', () => {
  it('loginSchema normaliza el email a minúsculas', () => {
    const parsed = loginSchema.parse({
      email: 'Maria@Motif.PE',
      password: 'x',
    });
    expect(parsed.email).toBe('maria@motif.pe');
  });

  it('loginSchema rechaza email inválido', () => {
    expect(() =>
      loginSchema.parse({ email: 'no-es-email', password: 'x' }),
    ).toThrow();
  });

  it('registerSchema exige password de mínimo 8 caracteres', () => {
    expect(() =>
      registerSchema.parse({
        name: 'Maria Quispe',
        email: 'maria@motif.pe',
        password: 'corta',
        restaurantName: 'Motif',
      }),
    ).toThrow();
  });

  it('registerSchema acepta un registro válido y normaliza el email', () => {
    const parsed = registerSchema.parse({
      name: 'Maria Quispe',
      email: 'Maria@Motif.PE',
      password: 'supersegura',
      restaurantName: 'Motif Restobar',
    });
    expect(parsed.email).toBe('maria@motif.pe');
  });
});
