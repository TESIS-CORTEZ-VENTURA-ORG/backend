import { jwtClaimsSchema } from './jwt-claims';

describe('jwtClaimsSchema (R5)', () => {
  const valid = {
    sub: 'user-123',
    tenant_id: '550e8400-e29b-41d4-a716-446655440000',
    roles: ['owner'],
  };

  it('valida claims correctos', () => {
    const parsed = jwtClaimsSchema.parse(valid);
    expect(parsed.tenant_id).toBe(valid.tenant_id);
    expect(parsed.roles).toEqual(['owner']);
  });

  it('rechaza tenant_id que no es UUID', () => {
    expect(() =>
      jwtClaimsSchema.parse({ ...valid, tenant_id: 'abc' }),
    ).toThrow();
  });

  it('rechaza roles vacíos', () => {
    expect(() => jwtClaimsSchema.parse({ ...valid, roles: [] })).toThrow();
  });

  it('rechaza un rol desconocido', () => {
    expect(() =>
      jwtClaimsSchema.parse({ ...valid, roles: ['admin'] }),
    ).toThrow();
  });
});
