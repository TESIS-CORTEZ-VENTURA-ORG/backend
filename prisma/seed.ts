import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';

/**
 * Seed de DEMO — Motif Restobar Karaoke (caso de estudio de la tesis).
 * Crea el tenant y un usuario por rol (owner/manager/staff) para poder recorrer
 * la app con auth REAL contra la DB. Idempotente (upsert por email).
 *
 * Usa el rol admin (BYPASSRLS) porque crea el tenant + usuarios cross-tenant:
 * `DATABASE_URL_ADMIN` (postgres). Las contraseñas se guardan hasheadas (bcrypt).
 * NO usar en producción.
 *
 *   bunx prisma db seed     (o)     bun prisma/seed.ts
 */
const url = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL;
const prisma = new PrismaClient({ datasources: { db: { url } } });

const TENANT_NAME = 'Motif Restobar Karaoke';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'MotifDemo2026';

const DEMO_USERS: { email: string; name: string; roles: string[] }[] = [
  { email: 'maria@motif.pe', name: 'María Ventura', roles: ['owner'] },
  { email: 'carlos@motif.pe', name: 'Carlos Cortez', roles: ['manager'] },
  { email: 'staff@motif.pe', name: 'Mozo de Salón', roles: ['staff'] },
];

async function main(): Promise<void> {
  let tenant = await prisma.tenant.findFirst({ where: { name: TENANT_NAME } });
  if (!tenant) {
    tenant = await prisma.tenant.create({ data: { name: TENANT_NAME } });
  }

  const passwordHash = await hash(DEMO_PASSWORD, 10);
  for (const u of DEMO_USERS) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, roles: u.roles, tenantId: tenant.id, passwordHash },
      create: {
        tenantId: tenant.id,
        email: u.email,
        name: u.name,
        roles: u.roles,
        passwordHash,
      },
    });
    console.log(`  ✓ ${u.email} (${u.roles[0]})`);
  }

  console.log(
    `\nSeed listo · tenant "${TENANT_NAME}" · contraseña demo: ${DEMO_PASSWORD}`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
