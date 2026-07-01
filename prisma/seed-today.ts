/**
 * Seed puntual: genera ventas EMITIDAS de HOY (zona Lima) para el tenant del
 * usuario indicado, para que el dashboard deje de mostrar S/0. Crea la cadena
 * completa: order → order_items → sale (issued) → payment.
 *
 * Conecta como superuser `postgres` (bypassa RLS) para escribir cross-tenant.
 * Ejecutar: bun prisma/seed-today.ts
 */
import { PrismaClient } from '@prisma/client'

const URL = 'postgresql://postgres:postgres@localhost:5432/gastronomia_dev'
const USER_EMAIL = 'rcortezadmin@gmail.com'
const SERIE = 'B001'
const ORDERS_TODAY = 13

const prisma = new PrismaClient({ datasources: { db: { url: URL } } })

const round2 = (n: number): number => Math.round(n * 100) / 100
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]!
const randInt = (a: number, b: number): number => a + Math.floor(Math.random() * (b - a + 1))

// Instante UTC de la medianoche de HOY en Lima (UTC-5).
function limaMidnightTodayUtc(now: Date): Date {
  const lima = new Date(now.getTime() - 5 * 3_600_000)
  return new Date(Date.UTC(lima.getUTCFullYear(), lima.getUTCMonth(), lima.getUTCDate(), 0, 0, 0) + 5 * 3_600_000)
}

async function main(): Promise<void> {
  const user = await prisma.user.findFirst({ where: { email: USER_EMAIL } })
  if (!user) throw new Error(`No existe el usuario ${USER_EMAIL}`)
  const tenantId = user.tenantId
  console.log(`Tenant: ${tenantId} (usuario ${user.name})`)

  const menu = await prisma.menuItem.findMany({ where: { tenantId }, select: { id: true, name: true, price: true } })
  const tables = await prisma.diningTable.findMany({ where: { tenantId }, select: { id: true } })
  if (menu.length === 0) throw new Error('El tenant no tiene platos (menu_items).')
  if (tables.length === 0) throw new Error('El tenant no tiene mesas (dining_tables).')
  console.log(`Platos: ${menu.length} · Mesas: ${tables.length}`)

  // Continúa la numeración de la serie para no chocar con el unique [tenant, serie, number].
  const lastSale = await prisma.sale.findFirst({
    where: { tenantId, serie: SERIE },
    orderBy: { number: 'desc' },
    select: { number: true },
  })
  let nextNumber = (lastSale?.number ?? 0) + 1

  const now = new Date()
  const startToday = limaMidnightTodayUtc(now)
  const elapsedMs = Math.max(60_000, now.getTime() - startToday.getTime()) // al menos 1 min de ventana

  let totalRevenue = 0
  for (let i = 0; i < ORDERS_TODAY; i++) {
    // issuedAt: repartido a lo largo de lo transcurrido HOY, siempre <= ahora.
    const issuedAt = new Date(startToday.getTime() + Math.random() * elapsedMs)

    // 1–4 platos distintos por pedido.
    const nItems = randInt(1, 4)
    const chosen = [...menu].sort(() => Math.random() - 0.5).slice(0, nItems)
    const items = chosen.map((p) => {
      const qty = randInt(1, 3)
      const unitPrice = Number(p.price)
      return { menuItemId: p.id, name: p.name, qty, unitPrice }
    })
    const total = round2(items.reduce((s, it) => s + it.qty * it.unitPrice, 0))
    if (total <= 0) continue
    const subtotal = round2(total / 1.18)
    const igv = round2(total - subtotal)

    const order = await prisma.order.create({
      data: {
        tenantId,
        tableId: pick(tables).id,
        waiterId: user.id,
        guests: randInt(1, 4),
        status: 'paid',
        openedAt: issuedAt,
        sentToKitchenAt: issuedAt,
        items: {
          create: items.map((it) => ({
            tenantId,
            menuItemId: it.menuItemId,
            name: it.name,
            qty: it.qty,
            unitPrice: it.unitPrice,
            status: 'served',
            servedAt: issuedAt,
          })),
        },
      },
    })

    await prisma.sale.create({
      data: {
        tenantId,
        orderId: order.id,
        serie: SERIE,
        number: nextNumber++,
        docType: 'boleta',
        subtotal,
        igv,
        total,
        status: 'issued',
        issuedAt,
        payments: {
          create: { tenantId, method: pick(['cash', 'card', 'yape', 'plin']), amount: total },
        },
      },
    })
    totalRevenue += total
  }

  console.log(`\n✅ ${ORDERS_TODAY} ventas de HOY creadas · ingreso total: S/ ${round2(totalRevenue).toLocaleString('es-PE')}`)
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('❌', e)
    await prisma.$disconnect()
    process.exit(1)
  })
