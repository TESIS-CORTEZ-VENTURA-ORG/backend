import { PrismaService } from './prisma.service';

describe('PrismaService.runInTenant (R3)', () => {
  it('rechaza un tenantId que no es UUID antes de tocar la DB', async () => {
    const service = new PrismaService();
    let called = false;
    await expect(
      service.runInTenant('no-es-uuid', () => {
        called = true;
        return Promise.resolve('nope');
      }),
    ).rejects.toThrow();
    expect(called).toBe(false);
  });
});
