import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { z } from 'zod';
import { AppModule } from './../src/app.module';
import { apiResponseSchema, authTokensSchema } from './../src/shared';

const adminUrl = process.env.DATABASE_URL_ADMIN;
if (!adminUrl) {
  throw new Error('DATABASE_URL_ADMIN no está definido (ver .env)');
}

const TRUNCATE =
  'TRUNCATE TABLE "notification_preferences","notifications","inventory_movements","order_items","orders","dining_tables","zones","menu_modifiers","menu_availability","menu_items","menu_categories","recipe_versions","recipe_items","recipes","product_suppliers","suppliers","ingredients","categories","units_of_measure","audit_logs","refresh_tokens","users","tenants" CASCADE';

describe('Notificaciones in-app + preferencias HU-10-01/03 (e2e)', () => {
  let app: NestFastifyApplication<App>;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const password = 'Secret12345';
  const tokensSchema = apiResponseSchema(authTokensSchema);
  const idSchema = apiResponseSchema(z.object({ id: z.uuid() }));

  const notificationListSchema = apiResponseSchema(
    z.object({
      items: z.array(
        z.object({
          id: z.uuid(),
          type: z.string(),
          title: z.string(),
          body: z.string(),
          data: z.unknown().nullable(),
          readAt: z.string().nullable(),
          createdAt: z.string(),
        }),
      ),
      unreadCount: z.number().int().nonnegative(),
    }),
  );
  const notificationSchema = apiResponseSchema(
    z.object({
      id: z.uuid(),
      type: z.string(),
      readAt: z.string().nullable(),
    }),
  );
  const readAllSchema = apiResponseSchema(
    z.object({ updated: z.number().int().nonnegative() }),
  );
  const preferenceSchema = apiResponseSchema(
    z.object({
      type: z.string(),
      inApp: z.boolean(),
      email: z.boolean(),
    }),
  );
  const preferenceListSchema = apiResponseSchema(
    z.object({
      items: z.array(
        z.object({
          type: z.string(),
          inApp: z.boolean(),
          email: z.boolean(),
        }),
      ),
    }),
  );

  let ownerToken = '';
  let ingredientId = '';

  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (path: string, token: string) =>
    request(app.getHttpServer()).get(path).set(bearer(token));
  const post = (path: string, token: string, body?: unknown) =>
    request(app.getHttpServer())
      .post(path)
      .set(bearer(token))
      .send(body ?? {});
  const patch = (path: string, token: string, body: unknown) =>
    request(app.getHttpServer()).patch(path).set(bearer(token)).send(body);

  const login = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);
    return tokensSchema.parse(res.body).data.accessToken;
  };

  // Cuenta cuántas notificaciones low_stock ve el owner (suyas + broadcast).
  const lowStockCount = async (): Promise<number> => {
    const list = notificationListSchema.parse(
      (await get('/api/notifications', ownerToken).expect(200)).body,
    ).data;
    return list.items.filter((n) => n.type === 'low_stock').length;
  };

  // Mueve el stock (entrada/salida) vía el endpoint de inventario.
  const move = (type: string, qty: number) =>
    post('/api/inventory/movements', ownerToken, {
      ingredientId,
      type,
      qty,
    }).expect(201);

  beforeAll(async () => {
    await admin.$connect();
    await admin.$executeRawUnsafe(TRUNCATE);
    const tenant = await admin.tenant.create({ data: { name: 'Motif' } });
    const passwordHash = await hash(password, 4);
    await admin.user.create({
      data: {
        tenantId: tenant.id,
        email: 'owner@notif.pe',
        name: 'Owner',
        passwordHash,
        roles: ['owner'],
      },
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
    ownerToken = await login('owner@notif.pe');

    // Insumo + umbral mínimo 5. Stock inicial 0 (lo subimos por encima del mín).
    ingredientId = idSchema.parse(
      (
        await post('/api/ingredients', ownerToken, {
          sku: 'TOM',
          name: 'Tomate',
          type: 'raw',
          unit: 'kg',
          unitCost: 5,
        }).expect(201)
      ).body,
    ).data.id;
    await patch(`/api/inventory/levels/${ingredientId}`, ownerToken, {
      minStock: 5,
    }).expect(200);
  });

  afterAll(async () => {
    await admin.$executeRawUnsafe(TRUNCATE);
    await admin.$disconnect();
    await app.close();
  });

  it('arranca sin notificaciones (bandeja vacía, unreadCount 0)', async () => {
    const list = notificationListSchema.parse(
      (await get('/api/notifications', ownerToken).expect(200)).body,
    ).data;
    expect(list.items).toHaveLength(0);
    expect(list.unreadCount).toBe(0);
  });

  it('HU-10-01: una salida que cruza el mínimo genera una notificación low_stock (badge ≥ 1)', async () => {
    // Subir el stock por encima del mínimo (0 → 10, ≥ 5). No cruza hacia abajo.
    await move('purchase', 10);
    expect(await lowStockCount()).toBe(0);

    // Salida que lo deja por debajo (10 → 4, < 5) → CRUZA → notifica.
    await move('sale', -6);

    const list = notificationListSchema.parse(
      (await get('/api/notifications', ownerToken).expect(200)).body,
    ).data;
    const low = list.items.find((n) => n.type === 'low_stock');
    expect(low).toBeDefined();
    expect(low?.title).toBe('Stock bajo: Tomate');
    expect(low?.readAt).toBeNull();
    expect(list.unreadCount).toBeGreaterThanOrEqual(1);
  });

  it('HU-10-01: marcar la notificación como leída baja el unreadCount', async () => {
    const before = notificationListSchema.parse(
      (await get('/api/notifications', ownerToken).expect(200)).body,
    ).data;
    const low = before.items.find((n) => n.type === 'low_stock');
    expect(low).toBeDefined();
    const unreadBefore = before.unreadCount;

    const marked = notificationSchema.parse(
      (await post(`/api/notifications/${low?.id}/read`, ownerToken).expect(201))
        .body,
    ).data;
    expect(marked.readAt).not.toBeNull();

    const after = notificationListSchema.parse(
      (await get('/api/notifications', ownerToken).expect(200)).body,
    ).data;
    expect(after.unreadCount).toBe(unreadBefore - 1);

    // unreadOnly=true ya no la muestra.
    const unread = notificationListSchema.parse(
      (await get('/api/notifications?unreadOnly=true', ownerToken).expect(200))
        .body,
    ).data;
    expect(unread.items.find((n) => n.id === low?.id)).toBeUndefined();
  });

  it('HU-10-01: crossing-only — otra salida estando YA bajo el mínimo NO crea una nueva', async () => {
    const before = await lowStockCount();
    // stock 4 (< 5) → otra salida (4 → 2) sigue por debajo, no cruza.
    await move('sale', -2);
    expect(await lowStockCount()).toBe(before);
  });

  it('HU-10-03: con la preferencia low_stock inApp=false, volver a cruzar NO crea notificación in-app', async () => {
    // Persistir la preferencia: low_stock in-app OFF.
    const pref = preferenceSchema.parse(
      (
        await patch('/api/notifications/preferences', ownerToken, {
          type: 'low_stock',
          inApp: false,
        }).expect(200)
      ).body,
    ).data;
    expect(pref.type).toBe('low_stock');
    expect(pref.inApp).toBe(false);

    // GET preferences refleja inApp=false para low_stock.
    const prefs = preferenceListSchema.parse(
      (await get('/api/notifications/preferences', ownerToken).expect(200))
        .body,
    ).data;
    expect(prefs.items.find((p) => p.type === 'low_stock')?.inApp).toBe(false);

    // Resetear el cruce: subir por encima del mínimo, luego cruzar hacia abajo.
    const before = await lowStockCount();
    await move('purchase', 20); // stock 2 → 22 (≥ 5)
    await move('sale', -20); // 22 → 2 (< 5) → CRUZA, pero la preferencia lo omite

    // low_stock es broadcast (userId=null); existe un opt-out (inApp=false) de
    // ese tipo en el tenant → el broadcast se omite. No hay notificación nueva.
    expect(await lowStockCount()).toBe(before);
  });

  it('HU-10-01: read-all marca todas como leídas (unreadCount 0)', async () => {
    const res = readAllSchema.parse(
      (await post('/api/notifications/read-all', ownerToken).expect(201)).body,
    ).data;
    expect(res.updated).toBeGreaterThanOrEqual(0);

    const list = notificationListSchema.parse(
      (await get('/api/notifications', ownerToken).expect(200)).body,
    ).data;
    expect(list.unreadCount).toBe(0);
  });

  it('marcar una notificación inexistente → 404', async () => {
    await post(
      '/api/notifications/00000000-0000-0000-0000-000000000000/read',
      ownerToken,
    ).expect(404);
  });

  it('sin token → 401', async () => {
    await request(app.getHttpServer()).get('/api/notifications').expect(401);
  });
});
