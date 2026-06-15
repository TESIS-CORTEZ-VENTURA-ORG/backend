import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashea distinto del texto plano y verifica correctamente', async () => {
    const hashed = await service.hash('MotifDemo2026');
    expect(hashed).not.toBe('MotifDemo2026');
    expect(await service.verify('MotifDemo2026', hashed)).toBe(true);
    expect(await service.verify('contraseña-incorrecta', hashed)).toBe(false);
  });
});
