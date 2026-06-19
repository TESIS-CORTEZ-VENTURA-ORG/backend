import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { App } from 'supertest/types';
import { PrismaClient } from '@prisma/client';
import { AppModule } from './../src/app.module';
import { ForecastScheduler } from './../src/forecasting/forecast.scheduler';

const adminUrl = process.env.DATABASE_URL_ADMIN;
if (!adminUrl) {
  throw new Error('DATABASE_URL_ADMIN no está definido (ver .env)');
}

const TRUNCATE =
  'TRUNCATE TABLE "forecast_runs","sales_history","menu_items","recipes","audit_logs","refresh_tokens","users","tenants" CASCADE';

const at = (day: string): Date => new Date(`${day}T12:00:00-05:00`);

// HU-08-03 — Cron semanal. Requiere DB (BYPASSRLS para enumerar tenants) + Redis.
describe('Forecasting cron semanal — HU-08-03 (e2e)', () => {
  let app: NestFastifyApplication<App>;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  let tenantA = '';
  let tenantB = '';
  let tenantC = '';

  beforeAll(async () => {
    await admin.$connect();
    await admin.$executeRawUnsafe(TRUNCATE);
    tenantA = (await admin.tenant.create({ data: { name: 'A' } })).id;
    tenantB = (await admin.tenant.create({ data: { name: 'B' } })).id;
    // Tenant borrado → NO debe entrar al cron.
    tenantC = (
      await admin.tenant.create({ data: { name: 'C', deletedAt: new Date() } })
    ).id;

    // Algo de histórico para A (no es necesario para que se cree la corrida).
    await admin.salesHistory.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({
        tenantId: tenantA,
        soldOn: at('2024-01-01'),
        dishName: 'D',
        menuItemId: null,
        qty: 5 + i,
        unitPrice: 10,
        total: 10 * (5 + i),
      })),
    });

    const mf = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = mf.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }, 30_000);

  afterAll(async () => {
    await admin.$executeRawUnsafe(TRUNCATE);
    await admin.$disconnect();
    await app.close();
  });

  it('encola una corrida por cada tenant ACTIVO (excluye los borrados)', async () => {
    const scheduler = app.get(ForecastScheduler);
    const result = await scheduler.runWeeklyForecasts();

    // Solo A y B son activos; C está borrado.
    expect(result.tenants).toBe(2);
    expect(result.enqueued).toBe(2);

    // Una corrida creada por tenant activo; ninguna para el borrado.
    expect(
      await admin.forecastRun.count({ where: { tenantId: tenantA } }),
    ).toBe(1);
    expect(
      await admin.forecastRun.count({ where: { tenantId: tenantB } }),
    ).toBe(1);
    expect(
      await admin.forecastRun.count({ where: { tenantId: tenantC } }),
    ).toBe(0);
  }, 30_000);
});
