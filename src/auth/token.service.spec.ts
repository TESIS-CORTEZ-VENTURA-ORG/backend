import { JwtService } from '@nestjs/jwt';
import { TokenService } from './token.service';

function readKey(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} no definido — corre: bun run keys:gen`);
  }
  return Buffer.from(value, 'base64').toString('utf8');
}

describe('TokenService (RS256)', () => {
  const jwt = new JwtService({
    privateKey: readKey('JWT_PRIVATE_KEY'),
    publicKey: readKey('JWT_PUBLIC_KEY'),
    signOptions: { algorithm: 'RS256', issuer: 'gastronomia' },
    verifyOptions: { algorithms: ['RS256'], issuer: 'gastronomia' },
  });
  const service = new TokenService(jwt);
  const tenant = '550e8400-e29b-41d4-a716-446655440000';

  it('issue → verifyAccess preserva los claims', async () => {
    const { accessToken, refreshToken } = await service.issue({
      sub: 'user-1',
      tenant_id: tenant,
      roles: ['owner'],
    });
    expect(refreshToken.length).toBeGreaterThan(0);

    const claims = await service.verifyAccess(accessToken);
    expect(claims.sub).toBe('user-1');
    expect(claims.tenant_id).toBe(tenant);
    expect(claims.roles).toEqual(['owner']);
  });

  it('verifyAccess rechaza un token inválido', async () => {
    await expect(service.verifyAccess('no-es-un-jwt')).rejects.toThrow();
  });
});
