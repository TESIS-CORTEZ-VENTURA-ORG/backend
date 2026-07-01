import { Prisma, PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';

/**
 * Seed de DATOS DE NEGOCIO de demo — "Cevichería El Timón" (caso de estudio).
 *
 * Puebla el tenant del usuario `rcortezadmin@gmail.com` con un restaurante peruano
 * coherente y CON VIDA: insumos con stock, recetas con BOM, carta de platos, salón
 * con mesas, CIF del mes, histórico de ventas (~6 meses) y, sobre todo, ventas
 * REALES (Order → OrderItem → Sale → Payment) de HOY y de los últimos 7 días para
 * que el dashboard del owner/manager muestre números reales (Venta hoy, tickets,
 * top platos, margen bruto, stock bajo, mesas ocupadas, sparkline 7d).
 *
 * Usa el rol admin (BYPASSRLS) — `DATABASE_URL_ADMIN` (postgres) — porque escribe
 * cross-tenant (igual que prisma/seed.ts y los e2e). Es IDEMPOTENTE: borra primero
 * los datos de negocio SOLO de este tenant antes de re-sembrar. NO toca otros
 * tenants. Moneda PEN, IGV 18%, zona America/Lima. NO usar en producción.
 *
 *   bunx prisma generate    (una vez)
 *   bun prisma/seed-demo-business.ts
 */
const url = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL;
const prisma = new PrismaClient({ datasources: { db: { url } } });

// --- objetivo (constantes del enunciado) ---
// Default; se resuelve al id REAL del tenant del usuario demo dentro de main()
// (seed.ts crea el tenant con un id aleatorio → no acoplar a un UUID fijo).
let TENANT_ID = 'f1d26dbd-f90a-4bbe-aa66-c8d3a208df98';
const USER_EMAIL = 'maria@motif.pe';
const USER_NAME = 'María Ventura';
const TENANT_NAME = 'Motif Restobar Karaoke';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'MotifDemo2026';

const IGV_RATE = new Prisma.Decimal('0.18');
const ONE = new Prisma.Decimal(1);

// --- helpers de fecha (America/Lima = UTC-5 fijo, sin DST) ---
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;
const LIMA_OFFSET_MIN = -5 * 60;

/** Instante UTC de la medianoche local (Lima) del día que contiene `at`. */
function startOfLimaDay(at: Date): Date {
  const localMs = at.getTime() + LIMA_OFFSET_MIN * MS_PER_MINUTE;
  const localMidnight = Math.floor(localMs / MS_PER_DAY) * MS_PER_DAY;
  return new Date(localMidnight - LIMA_OFFSET_MIN * MS_PER_MINUTE);
}

/** Un instante UTC a la hora local `hour:minute` del día (Lima) de `dayStart`. */
function atLimaTime(dayStart: Date, hour: number, minute: number): Date {
  return new Date(dayStart.getTime() + (hour * 60 + minute) * MS_PER_MINUTE);
}

/** `YYYY-MM` del mes actual (en Lima). */
function currentPeriod(now: Date): string {
  const local = new Date(now.getTime() + LIMA_OFFSET_MIN * MS_PER_MINUTE);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

// PRNG determinista (mismo seed → mismos datos; reproducible).
let rngState = 0x2f6e2b1;
function rnd(): number {
  rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
  return rngState / 0x7fffffff;
}
function randInt(min: number, max: number): number {
  return min + Math.floor(rnd() * (max - min + 1));
}
function pick<T>(arr: readonly T[]): T {
  return arr[randInt(0, arr.length - 1)];
}

// IGV incluido en el precio: total = precio·qty; subtotal = total/(1+igv); igv = total−subtotal.
function splitIgv(total: Prisma.Decimal): {
  subtotal: Prisma.Decimal;
  igv: Prisma.Decimal;
} {
  const subtotal = total.div(ONE.add(IGV_RATE)).toDecimalPlaces(2);
  const igv = total.sub(subtotal);
  return { subtotal, igv };
}

type UnitSeed = {
  code: string;
  name: string;
  family: string;
  factorToBase: number;
};
const UNITS: UnitSeed[] = [
  { code: 'kg', name: 'Kilogramo', family: 'mass', factorToBase: 1000 },
  { code: 'g', name: 'Gramo', family: 'mass', factorToBase: 1 },
  { code: 'L', name: 'Litro', family: 'volume', factorToBase: 1000 },
  { code: 'ml', name: 'Mililitro', family: 'volume', factorToBase: 1 },
  { code: 'und', name: 'Unidad', family: 'count', factorToBase: 1 },
];

const CATEGORIES = [
  'Pescados y Mariscos',
  'Verduras',
  'Abarrotes',
  'Bebidas',
  'Carnes',
];

// stock/minStock en la unidad declarada; unitCost = PEN por esa unidad.
// `low: true` fuerza stock < minStock (alimenta lowStockCount del dashboard).
type IngSeed = {
  sku: string;
  name: string;
  unit: string;
  category: string;
  unitCost: number;
  stock: number;
  minStock: number;
  low?: boolean;
};
const INGREDIENTS: IngSeed[] = [
  {
    sku: 'PES-001',
    name: 'Pescado fresco (lenguado)',
    unit: 'kg',
    category: 'Pescados y Mariscos',
    unitCost: 38,
    stock: 12,
    minStock: 8,
  },
  {
    sku: 'PES-002',
    name: 'Pulpo',
    unit: 'kg',
    category: 'Pescados y Mariscos',
    unitCost: 45,
    stock: 4,
    minStock: 6,
    low: true,
  },
  {
    sku: 'PES-003',
    name: 'Camarones',
    unit: 'kg',
    category: 'Pescados y Mariscos',
    unitCost: 52,
    stock: 7,
    minStock: 5,
  },
  {
    sku: 'PES-004',
    name: 'Conchas de abanico',
    unit: 'kg',
    category: 'Pescados y Mariscos',
    unitCost: 60,
    stock: 3,
    minStock: 5,
    low: true,
  },
  {
    sku: 'VER-001',
    name: 'Limón',
    unit: 'kg',
    category: 'Verduras',
    unitCost: 6,
    stock: 18,
    minStock: 10,
  },
  {
    sku: 'VER-002',
    name: 'Cebolla roja',
    unit: 'kg',
    category: 'Verduras',
    unitCost: 4,
    stock: 22,
    minStock: 10,
  },
  {
    sku: 'VER-003',
    name: 'Ají limo',
    unit: 'kg',
    category: 'Verduras',
    unitCost: 9,
    stock: 5,
    minStock: 3,
  },
  {
    sku: 'VER-004',
    name: 'Ají amarillo',
    unit: 'kg',
    category: 'Verduras',
    unitCost: 8,
    stock: 6,
    minStock: 3,
  },
  {
    sku: 'VER-005',
    name: 'Cilantro',
    unit: 'kg',
    category: 'Verduras',
    unitCost: 7,
    stock: 2,
    minStock: 4,
    low: true,
  },
  {
    sku: 'VER-006',
    name: 'Camote',
    unit: 'kg',
    category: 'Verduras',
    unitCost: 3,
    stock: 20,
    minStock: 8,
  },
  {
    sku: 'VER-007',
    name: 'Choclo',
    unit: 'kg',
    category: 'Verduras',
    unitCost: 5,
    stock: 14,
    minStock: 6,
  },
  {
    sku: 'ABA-001',
    name: 'Arroz',
    unit: 'kg',
    category: 'Abarrotes',
    unitCost: 4,
    stock: 50,
    minStock: 20,
  },
  {
    sku: 'ABA-002',
    name: 'Aceite vegetal',
    unit: 'L',
    category: 'Abarrotes',
    unitCost: 9,
    stock: 24,
    minStock: 10,
  },
  {
    sku: 'ABA-003',
    name: 'Sal de mesa',
    unit: 'kg',
    category: 'Abarrotes',
    unitCost: 2,
    stock: 12,
    minStock: 4,
  },
  {
    sku: 'CAR-001',
    name: 'Lomo de res',
    unit: 'kg',
    category: 'Carnes',
    unitCost: 42,
    stock: 9,
    minStock: 6,
  },
  {
    sku: 'CAR-002',
    name: 'Pechuga de pollo',
    unit: 'kg',
    category: 'Carnes',
    unitCost: 16,
    stock: 11,
    minStock: 6,
  },
  {
    sku: 'BEB-001',
    name: 'Pisco quebranta',
    unit: 'L',
    category: 'Bebidas',
    unitCost: 35,
    stock: 8,
    minStock: 4,
  },
  {
    sku: 'BEB-002',
    name: 'Chicha morada (concentrado)',
    unit: 'L',
    category: 'Bebidas',
    unitCost: 12,
    stock: 10,
    minStock: 4,
  },
  {
    sku: 'BEB-003',
    name: 'Gaseosa (botella)',
    unit: 'und',
    category: 'Bebidas',
    unitCost: 3,
    stock: 60,
    minStock: 24,
  },
];

// Plato: receta (BOM por SKU+qty en la unidad del insumo) + precio de venta (PEN, IGV incl.).
// Las qty se eligen para dar food cost ~25-40% (margen 60-75%).
type DishSeed = {
  name: string;
  emoji: string;
  category: 'Entradas' | 'Principales' | 'Bebidas' | 'Postres';
  price: number;
  prepMinutes: number;
  bom: { sku: string; qty: number; waste?: number }[];
};
const DISHES: DishSeed[] = [
  {
    name: 'Ceviche Clásico',
    emoji: '🐟',
    category: 'Entradas',
    price: 42,
    prepMinutes: 15,
    bom: [
      { sku: 'PES-001', qty: 0.2, waste: 0.1 },
      { sku: 'VER-001', qty: 0.15 },
      { sku: 'VER-002', qty: 0.08 },
      { sku: 'VER-003', qty: 0.02 },
      { sku: 'VER-005', qty: 0.01 },
      { sku: 'VER-006', qty: 0.12 },
      { sku: 'VER-007', qty: 0.1 },
    ],
  },
  {
    name: 'Ceviche Mixto',
    emoji: '🦐',
    category: 'Entradas',
    price: 52,
    prepMinutes: 18,
    bom: [
      { sku: 'PES-001', qty: 0.12, waste: 0.1 },
      { sku: 'PES-002', qty: 0.08 },
      { sku: 'PES-003', qty: 0.08 },
      { sku: 'VER-001', qty: 0.15 },
      { sku: 'VER-002', qty: 0.08 },
      { sku: 'VER-006', qty: 0.12 },
    ],
  },
  {
    name: 'Tiradito de Lenguado',
    emoji: '🍣',
    category: 'Entradas',
    price: 46,
    prepMinutes: 12,
    bom: [
      { sku: 'PES-001', qty: 0.22, waste: 0.1 },
      { sku: 'VER-001', qty: 0.12 },
      { sku: 'VER-004', qty: 0.03 },
      { sku: 'VER-005', qty: 0.01 },
    ],
  },
  {
    name: 'Causa Limeña',
    emoji: '🥔',
    category: 'Entradas',
    price: 28,
    prepMinutes: 20,
    bom: [
      { sku: 'VER-006', qty: 0.25 },
      { sku: 'CAR-002', qty: 0.1 },
      { sku: 'VER-004', qty: 0.02 },
      { sku: 'VER-001', qty: 0.05 },
      { sku: 'ABA-002', qty: 0.03 },
    ],
  },
  {
    name: 'Lomo Saltado',
    emoji: '🥩',
    category: 'Principales',
    price: 48,
    prepMinutes: 18,
    bom: [
      { sku: 'CAR-001', qty: 0.2, waste: 0.05 },
      { sku: 'VER-002', qty: 0.1 },
      { sku: 'ABA-001', qty: 0.15 },
      { sku: 'ABA-002', qty: 0.04 },
      { sku: 'VER-005', qty: 0.01 },
    ],
  },
  {
    name: 'Arroz con Mariscos',
    emoji: '🍤',
    category: 'Principales',
    price: 54,
    prepMinutes: 25,
    bom: [
      { sku: 'ABA-001', qty: 0.18 },
      { sku: 'PES-003', qty: 0.1 },
      { sku: 'PES-004', qty: 0.08 },
      { sku: 'VER-004', qty: 0.03 },
      { sku: 'VER-002', qty: 0.06 },
      { sku: 'ABA-002', qty: 0.04 },
    ],
  },
  {
    name: 'Ají de Gallina',
    emoji: '🍛',
    category: 'Principales',
    price: 36,
    prepMinutes: 30,
    bom: [
      { sku: 'CAR-002', qty: 0.22 },
      { sku: 'VER-004', qty: 0.05 },
      { sku: 'ABA-001', qty: 0.15 },
      { sku: 'ABA-002', qty: 0.04 },
    ],
  },
  {
    name: 'Pulpo al Olivo',
    emoji: '🐙',
    category: 'Principales',
    price: 58,
    prepMinutes: 22,
    bom: [
      { sku: 'PES-002', qty: 0.2, waste: 0.1 },
      { sku: 'ABA-002', qty: 0.05 },
      { sku: 'VER-002', qty: 0.04 },
    ],
  },
  {
    name: 'Pisco Sour',
    emoji: '🍸',
    category: 'Bebidas',
    price: 24,
    prepMinutes: 5,
    bom: [
      { sku: 'BEB-001', qty: 0.06 },
      { sku: 'VER-001', qty: 0.04 },
    ],
  },
  {
    name: 'Chicha Morada',
    emoji: '🟣',
    category: 'Bebidas',
    price: 12,
    prepMinutes: 3,
    bom: [{ sku: 'BEB-002', qty: 0.25 }],
  },
];

const ZONES = [
  { name: 'Salón', position: 0 },
  { name: 'Terraza', position: 1 },
];

// 10 mesas; 4 'occupied' (alimentan openTables). El resto 'free'.
type TableSeed = {
  code: string;
  zone: string;
  capacity: number;
  status: string;
};
const TABLES: TableSeed[] = [
  { code: 'S1', zone: 'Salón', capacity: 4, status: 'occupied' },
  { code: 'S2', zone: 'Salón', capacity: 4, status: 'occupied' },
  { code: 'S3', zone: 'Salón', capacity: 2, status: 'free' },
  { code: 'S4', zone: 'Salón', capacity: 6, status: 'free' },
  { code: 'S5', zone: 'Salón', capacity: 4, status: 'occupied' },
  { code: 'T1', zone: 'Terraza', capacity: 4, status: 'occupied' },
  { code: 'T2', zone: 'Terraza', capacity: 2, status: 'free' },
  { code: 'T3', zone: 'Terraza', capacity: 4, status: 'free' },
  { code: 'T4', zone: 'Terraza', capacity: 6, status: 'free' },
  { code: 'T5', zone: 'Terraza', capacity: 2, status: 'free' },
];

const OVERHEADS = [
  { concept: 'Alquiler del local', amount: 6500 },
  { concept: 'Luz y agua', amount: 1800 },
  { concept: 'Sueldos de planilla', amount: 9200 },
  { concept: 'Gas y combustible', amount: 950 },
  { concept: 'Marketing y publicidad', amount: 600 },
];

/** Valid position codes for the Employee model (mirrored from the Zod schema). */
type EmployeePosition = 'mozo' | 'cocina' | 'caja' | 'otro';

type EmployeeSeed = {
  firstName: string;
  lastName: string;
  /** 8-digit Peruvian DNI — @@unique per tenant. */
  dni: string;
  position: EmployeePosition;
  /** Monthly salary in PEN. */
  salary: number;
  phone: string;
  /** YYYY-MM-DD; stored as @db.Date. */
  hiredAt: string;
  /**
   * When true, this employee's userId will be set to the staff@motif.pe user id.
   * At most ONE employee may be linked (userId is @unique on the Employee model).
   */
  linkStaff?: true;
};

/**
 * Five demo employees for Motif Restobar — realistic Peruvian names, salaries
 * aligned with Lima hospitality market (PEN, 2024–2025), and varied positions
 * so the Empleados tab shows a complete roster on camera. DNIs are deterministic
 * to keep re-seeds idempotent (cleanTenant() deletes before re-inserting).
 */
const EMPLOYEES: EmployeeSeed[] = [
  {
    firstName: 'Carlos',
    lastName: 'Quispe Mamani',
    dni: '72834951',
    position: 'mozo',
    salary: 1400,
    phone: '987654321',
    hiredAt: '2023-03-15',
    linkStaff: true, // maps to the seeded staff@motif.pe user account
  },
  {
    firstName: 'Lucía',
    lastName: 'Torres Vásquez',
    dni: '45618273',
    position: 'caja',
    salary: 1600,
    phone: '976543210',
    hiredAt: '2022-08-01',
  },
  {
    firstName: 'Renzo',
    lastName: 'Palomino Cruz',
    dni: '68291047',
    position: 'cocina',
    salary: 2200,
    phone: '965432109',
    hiredAt: '2023-06-20',
  },
  {
    firstName: 'Valeria',
    lastName: 'Huanca Flores',
    dni: '53742816',
    position: 'cocina',
    salary: 1850,
    phone: '954321098',
    hiredAt: '2024-01-10',
  },
  {
    firstName: 'Jorge',
    lastName: 'Tapia Ramos',
    dni: '71293845',
    position: 'otro', // encargado de local
    salary: 2800,
    phone: '943210987',
    hiredAt: '2021-11-05',
  },
];

const PAYMENT_METHODS = ['cash', 'yape', 'card', 'plin'] as const;

async function cleanTenant(): Promise<void> {
  // Borra los datos de negocio SOLO de este tenant (orden respetando FKs).
  // Payments/order_items/sale caen por cascade al borrar sale/order, pero somos
  // explícitos para no depender de cascades cruzadas.
  const t = { tenantId: TENANT_ID };
  // Clear employees and notifications first — nothing else in this tenant
  // references them, so order relative to the rest of the cleanup is irrelevant.
  await prisma.employee.deleteMany({ where: t });
  await prisma.notification.deleteMany({ where: t });
  await prisma.payment.deleteMany({ where: t });
  await prisma.sale.deleteMany({ where: t });
  await prisma.orderItem.deleteMany({ where: t });
  await prisma.order.deleteMany({ where: t });
  await prisma.cashClose.deleteMany({ where: t });
  await prisma.diningTable.deleteMany({ where: t });
  await prisma.zone.deleteMany({ where: t });
  await prisma.menuModifier.deleteMany({ where: t });
  await prisma.menuAvailability.deleteMany({ where: t });
  await prisma.menuItem.deleteMany({ where: t });
  await prisma.menuCategory.deleteMany({ where: t });
  await prisma.kitchenStation.deleteMany({ where: t });
  await prisma.recipeVersion.deleteMany({ where: t });
  await prisma.recipeItem.deleteMany({ where: t });
  await prisma.recipe.deleteMany({ where: t });
  await prisma.productSupplier.deleteMany({ where: t });
  await prisma.purchaseOrderItem.deleteMany({ where: t });
  await prisma.purchaseOrder.deleteMany({ where: t });
  await prisma.ingredientPriceHistory.deleteMany({ where: t });
  await prisma.inventoryMovement.deleteMany({ where: t });
  await prisma.supplier.deleteMany({ where: t });
  await prisma.salesHistory.deleteMany({ where: t });
  await prisma.overheadCost.deleteMany({ where: t });
  await prisma.costingClose.deleteMany({ where: t });
  await prisma.forecastRun.deleteMany({ where: t });
  await prisma.ingredient.deleteMany({ where: t });
  await prisma.category.deleteMany({ where: t });
  await prisma.unitOfMeasure.deleteMany({ where: t });
}

async function main(): Promise<void> {
  const now = new Date();
  const today = startOfLimaDay(now);
  const period = currentPeriod(now);

  // Resolver el tenant REAL del usuario demo. seed.ts crea el tenant con un id
  // aleatorio, así que no acoplamos a un UUID fijo (evita P2025 al re-seedear
  // luego de que `bun run test:e2e` trunca users/tenants).
  const demoUser = await prisma.user.findUnique({
    where: { email: USER_EMAIL },
  });
  if (!demoUser) {
    throw new Error(
      `Falta el usuario ${USER_EMAIL}. Corré primero: bun prisma/seed.ts`,
    );
  }
  TENANT_ID = demoUser.tenantId;

  // Resolve the staff user id once so we can link one employee to their account
  // later (step 10). The staff@motif.pe user is created by seed.ts.
  const staffUser = await prisma.user.findUnique({
    where: { email: 'staff@motif.pe' },
    select: { id: true },
  });

  // 0) Usuario + tenant: renombrar + resetear contraseña.
  const passwordHash = await hash(DEMO_PASSWORD, 10);
  await prisma.tenant.update({
    where: { id: TENANT_ID },
    data: { name: TENANT_NAME, igvRate: 0.18, currency: 'PEN' },
  });
  await prisma.user.update({
    where: { email: USER_EMAIL },
    data: {
      name: USER_NAME,
      passwordHash,
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });
  console.log(
    `  ✓ usuario "${USER_NAME}" + tenant "${TENANT_NAME}" (pass reset)`,
  );

  // 1) Limpieza idempotente del tenant.
  await cleanTenant();
  console.log('  ✓ datos de negocio previos del tenant borrados');

  // 2) Unidades + categorías.
  for (const u of UNITS) {
    await prisma.unitOfMeasure.create({
      data: {
        tenantId: TENANT_ID,
        code: u.code,
        name: u.name,
        family: u.family,
        factorToBase: u.factorToBase,
      },
    });
  }
  for (const name of CATEGORIES) {
    await prisma.category.create({ data: { tenantId: TENANT_ID, name } });
  }
  console.log(`  ✓ ${UNITS.length} unidades + ${CATEGORIES.length} categorías`);

  // 3) Insumos.
  const ingBySku = new Map<string, string>();
  for (const ing of INGREDIENTS) {
    const created = await prisma.ingredient.create({
      data: {
        tenantId: TENANT_ID,
        sku: ing.sku,
        name: ing.name,
        type: 'raw',
        unit: ing.unit,
        category: ing.category,
        unitCost: ing.unitCost,
        stock: ing.stock,
        minStock: ing.minStock,
      },
    });
    ingBySku.set(ing.sku, created.id);
  }
  const lowCount = INGREDIENTS.filter((i) => i.low).length;
  console.log(`  ✓ ${INGREDIENTS.length} insumos (${lowCount} bajo mínimo)`);

  // 4a) Estaciones de cocina (KDS): cada categoría de carta despacha a una.
  const STATIONS = ['Cocina Fría', 'Cocina Caliente', 'Barra'] as const;
  const stationByName = new Map<string, string>();
  let stPos = 0;
  for (const name of STATIONS) {
    const s = await prisma.kitchenStation.create({
      data: { tenantId: TENANT_ID, name, position: stPos++ },
    });
    stationByName.set(name, s.id);
  }
  const CATEGORY_STATION: Record<string, string> = {
    Entradas: 'Cocina Fría',
    Principales: 'Cocina Caliente',
    Bebidas: 'Barra',
    Postres: 'Cocina Fría',
  };

  // 4b) Menú: categorías de carta (mapeadas a estación) + recetas (con BOM) + platos.
  const menuCatNames = ['Entradas', 'Principales', 'Bebidas', 'Postres'];
  const menuCatByName = new Map<string, string>();
  let pos = 0;
  for (const name of menuCatNames) {
    const c = await prisma.menuCategory.create({
      data: {
        tenantId: TENANT_ID,
        name,
        position: pos++,
        kitchenStationId: stationByName.get(CATEGORY_STATION[name]) ?? null,
      },
    });
    menuCatByName.set(name, c.id);
  }

  const menuItems: { id: string; name: string; price: Prisma.Decimal }[] = [];
  const stationByMenuItemId = new Map<string, string | null>();
  for (const dish of DISHES) {
    const recipe = await prisma.recipe.create({
      data: {
        tenantId: TENANT_ID,
        name: dish.name,
        kind: 'dish',
        yield: 1,
        emoji: dish.emoji,
        prepMinutes: dish.prepMinutes,
      },
    });
    for (const line of dish.bom) {
      const ingredientId = ingBySku.get(line.sku);
      if (!ingredientId) throw new Error(`BOM: insumo ${line.sku} no existe`);
      await prisma.recipeItem.create({
        data: {
          tenantId: TENANT_ID,
          recipeId: recipe.id,
          ingredientId,
          qty: line.qty,
          wasteFactor: line.waste ?? 0,
        },
      });
    }
    const item = await prisma.menuItem.create({
      data: {
        tenantId: TENANT_ID,
        recipeId: recipe.id,
        menuCategoryId: menuCatByName.get(dish.category) ?? null,
        name: dish.name,
        price: dish.price,
        isActive: true,
      },
    });
    menuItems.push({
      id: item.id,
      name: dish.name,
      price: new Prisma.Decimal(dish.price),
    });
    stationByMenuItemId.set(
      item.id,
      stationByName.get(CATEGORY_STATION[dish.category]) ?? null,
    );
  }
  console.log(`  ✓ ${DISHES.length} platos (receta + BOM + menú)`);

  // 5) Zonas + mesas.
  const zoneByName = new Map<string, string>();
  for (const z of ZONES) {
    const created = await prisma.zone.create({
      data: { tenantId: TENANT_ID, name: z.name, position: z.position },
    });
    zoneByName.set(z.name, created.id);
  }
  const occupiedTables: { id: string; code: string }[] = [];
  for (const t of TABLES) {
    const zoneId = zoneByName.get(t.zone);
    if (!zoneId) throw new Error(`zona ${t.zone} no existe`);
    const created = await prisma.diningTable.create({
      data: {
        tenantId: TENANT_ID,
        zoneId,
        code: t.code,
        capacity: t.capacity,
        status: t.status,
      },
    });
    if (t.status === 'occupied')
      occupiedTables.push({ id: created.id, code: t.code });
  }
  console.log(
    `  ✓ ${ZONES.length} zonas + ${TABLES.length} mesas (${occupiedTables.length} ocupadas)`,
  );

  // 6) CIF (overhead) del período actual.
  for (const o of OVERHEADS) {
    await prisma.overheadCost.create({
      data: {
        tenantId: TENANT_ID,
        period,
        concept: o.concept,
        amount: o.amount,
      },
    });
  }
  console.log(`  ✓ ${OVERHEADS.length} CIF del período ${period}`);

  // 7) Histórico de ventas (~6 meses+) por plato (sales_history) — para forecasting.
  // dayBack=187 para superar el umbral FEW_SHOT_MIN_DAYS=180 de sales-aggregation.util.ts
  // y que el endpoint /forecasting/series devuelva dataQuality='few_shot' o 'good'.
  let historyRows = 0;
  for (let dayBack = 187; dayBack >= 8; dayBack--) {
    const soldOn = new Date(today.getTime() - dayBack * MS_PER_DAY);
    // factor estacional: fines de semana venden más.
    const dow = new Date(
      soldOn.getTime() + LIMA_OFFSET_MIN * MS_PER_MINUTE,
    ).getUTCDay();
    const weekendBoost = dow === 0 || dow === 6 ? 1.6 : 1.0;
    for (const mi of menuItems) {
      // no todos los platos se venden todos los días.
      if (rnd() > 0.85) continue;
      const baseQty = randInt(2, 9);
      const qty = Math.max(1, Math.round(baseQty * weekendBoost));
      const unitPrice = mi.price;
      const total = unitPrice.mul(qty);
      await prisma.salesHistory.create({
        data: {
          tenantId: TENANT_ID,
          soldOn,
          dishName: mi.name,
          menuItemId: mi.id,
          qty,
          unitPrice,
          total,
          externalRef: `hist-${dayBack}-${mi.id.slice(0, 8)}`,
        },
      });
      historyRows++;
    }
  }
  console.log(`  ✓ ${historyRows} filas de histórico (~6 meses+, dayBack=187)`);

  // 7b) Movimientos de inventario type='sale' explotando el BOM POR PLATO de la
  // sales_history sembrada. Alimenta HU-05-11 (ingredient coverage) con consumo
  // REAL por insumo — el widget muestra `avgDailyConsumption`, así que el número
  // debe ser fiel (un jurado de tesis lo va a escrutar).
  //
  // MATH (idéntica en estructura a forecasting shopping-suggestions):
  //   consumo(i, día) = Σ_{fila de venta del día}  qty_plato × BOM(i en su plato)
  // Cada plato aporta SOLO los insumos de SU receta (no se colapsa el BOM global).
  // Se resuelve el BOM a 2 niveles (receta → sub-receta), igual que el servicio de
  // compras. Se incluye el wasteFactor (merma) porque el consumo real lo incluye.
  //
  // WINDOW FIX: cada movimiento se crea con `createdAt: movDate` EXPLÍCITO. El
  // endpoint de cobertura filtra `created_at >= NOW() - INTERVAL '30 days'`; sin
  // fecha explícita Postgres estampa NOW() y la ventana de 30d capturaría los ~90
  // días sembrados (inflando el promedio). Con `movDate` la ventana cubre 30 días
  // calendario reales.
  {
    // Cargar cada plato (menu item activo) con su receta y BOM a 2 niveles —
    // mismo `include` que forecasting.service.shoppingSuggestions() para que el
    // consumo sembrado y la proyección de compras usen la MISMA explosión de BOM.
    const menuItemsWithBom = await prisma.menuItem.findMany({
      where: { tenantId: TENANT_ID, isActive: true, deletedAt: null },
      include: {
        recipe: {
          include: {
            items: {
              include: {
                ingredient: true,
                subRecipe: {
                  include: { items: { include: { ingredient: true } } },
                },
              },
            },
          },
        },
      },
    });

    // Mapa menuItemId → (ingredientId → qtyPerUnit) para SU receta. qtyPerUnit ya
    // incluye la merma (1+wasteFactor). Nivel 2: item.qty×(1+w) × sub.qty×(1+w_sub).
    const perDishBom = new Map<string, Map<string, Prisma.Decimal>>();
    const withWaste = (
      qty: Prisma.Decimal,
      waste: Prisma.Decimal,
    ): Prisma.Decimal => qty.mul(ONE.add(waste));
    const accumulate = (
      bom: Map<string, Prisma.Decimal>,
      ingredientId: string,
      add: Prisma.Decimal,
    ): void => {
      const prev = bom.get(ingredientId);
      bom.set(ingredientId, prev ? prev.add(add) : add);
    };

    for (const mi of menuItemsWithBom) {
      const bom = new Map<string, Prisma.Decimal>();
      for (const item of mi.recipe.items) {
        if (item.ingredientId && item.ingredient) {
          // Insumo de nivel 1.
          accumulate(
            bom,
            item.ingredientId,
            withWaste(item.qty, item.wasteFactor),
          );
        } else if (item.subRecipe) {
          // Sub-receta (nivel 2): distribuir su qty entre sus propios insumos.
          const outer = withWaste(item.qty, item.wasteFactor);
          for (const sub of item.subRecipe.items) {
            if (!sub.ingredientId || !sub.ingredient) continue;
            accumulate(
              bom,
              sub.ingredientId,
              outer.mul(withWaste(sub.qty, sub.wasteFactor)),
            );
          }
        }
      }
      perDishBom.set(mi.id, bom);
    }

    // Recorrer la ventana de 90 días. Para cada día se agregan las filas de venta
    // de sales_history por plato → consumo por insumo → UN movimiento por insumo/día
    // (fechado en `movDate`). Solo hay histórico desde dayBack=8 (ver paso 7), así
    // que los días 1-7 no producen movimientos (sin ventas ⇒ cobertura no los cuenta).
    let movCount = 0;
    for (let dayBack = 90; dayBack >= 1; dayBack--) {
      const movDate = new Date(today.getTime() - dayBack * MS_PER_DAY);
      const dayHistRows = await prisma.salesHistory.findMany({
        where: {
          tenantId: TENANT_ID,
          soldOn: {
            gte: movDate,
            lt: new Date(movDate.getTime() + MS_PER_DAY),
          },
        },
        select: { menuItemId: true, qty: true },
      });
      if (dayHistRows.length === 0) continue;

      // Acumular consumo del día por insumo, explotando SOLO el BOM de cada plato.
      const dailyByIngredient = new Map<string, Prisma.Decimal>();
      for (const row of dayHistRows) {
        if (!row.menuItemId) continue; // fila sin plato asociado → sin BOM
        const bom = perDishBom.get(row.menuItemId);
        if (!bom) continue; // plato sin receta activa
        const dishQty = new Prisma.Decimal(row.qty);
        for (const [ingId, perUnit] of bom) {
          accumulate(dailyByIngredient, ingId, perUnit.mul(dishQty));
        }
      }

      for (const [ingId, consumed] of dailyByIngredient) {
        if (consumed.lte(0)) continue;
        await prisma.inventoryMovement.create({
          data: {
            tenantId: TENANT_ID,
            ingredientId: ingId,
            type: 'sale',
            qty: consumed.neg(),
            note: `Consumo del día ${movDate.toISOString().slice(0, 10)}`,
            createdAt: movDate,
          },
        });
        movCount++;
      }
    }
    console.log(
      `  ✓ ${movCount} movimientos type='sale' (consumo real por plato, fechados)`,
    );
  }

  // 7b-STOCK-RIGHTSIZING: dimensionar stock/minStock de cada insumo en proporción a
  // su consumo REAL de los últimos 30 días, para que el widget de cobertura muestre
  // un `daysLeft` creíble y variado — la mayoría sanos y un subconjunto crítico.
  //
  // Consistencia por construcción: se computa `avgDaily` con la MISMA ventana y el
  // MISMO divisor que el endpoint de cobertura (SUM(ABS(qty)) de type='sale' en
  // `created_at >= NOW() - INTERVAL '30 days'`, dividido por 30). Entonces
  //   stock    = avgDaily × daysOnHand  ⇒  daysLeft = stock/avgDaily = daysOnHand
  // exactamente. Ya NO hay factor artificial: con el consumo por-plato correcto del
  // paso 7b, el shortfall de compras surge naturalmente para el subconjunto crítico.
  //
  // daysOnHand es determinista por índice del array INGREDIENTS (sin Math.random,
  // reproducible). CRITICAL_INDICES recibe 1–3 días (< minStock de 4d) para que las
  // alertas de stock bajo y la lista de compras tengan contenido real.
  {
    // Indices en INGREDIENTS que quedan deliberadamente bajo mínimo (~24% de los
    // insumos con consumo): 1=Pulpo, 3=Conchas, 8=Cilantro, 14=Lomo de res.
    const CRITICAL_INDICES = new Set([1, 3, 8, 14]);

    // Umbral de reorden: 4 días de consumo promedio. Sanos (≥6d) quedan por encima;
    // críticos (1–3d) por debajo → status low/critical.
    const REORDER_DAYS = 4;
    // Divisor idéntico al del endpoint de cobertura (ventana fija 30d).
    const BASE_DAYS = new Prisma.Decimal(30);

    // Consumo real por insumo en la ventana de 30 días — MISMA query que el endpoint
    // de cobertura (inventory.service.ingredientCoverage). Los movimientos de 7b ya
    // están fechados en `movDate`, así que la ventana refleja 30 días calendario.
    const aggRows = await prisma.$queryRaw<
      { ingredient_id: string; total_consumed: string }[]
    >(Prisma.sql`
      SELECT ingredient_id::text,
             SUM(ABS(qty))::text AS total_consumed
      FROM   inventory_movements
      WHERE  tenant_id = ${TENANT_ID}::uuid
        AND  type      = 'sale'
        AND  created_at >= NOW() - INTERVAL '30 days'
      GROUP BY ingredient_id
    `);

    const consumedById = new Map(
      aggRows.map((r) => [
        r.ingredient_id,
        new Prisma.Decimal(r.total_consumed),
      ]),
    );

    let stockUpdated = 0;
    let lowStockCount = 0;
    const coverageLines: string[] = [];

    for (let idx = 0; idx < INGREDIENTS.length; idx++) {
      const ing = INGREDIENTS[idx];
      if (!ing) continue;

      const ingId = ingBySku.get(ing.sku);
      if (!ingId) continue;

      const totalConsumed = consumedById.get(ingId);
      if (!totalConsumed || totalConsumed.lte(0)) {
        // Insumo no usado en ningún BOM activo → sin movimientos de venta.
        // Se conserva el stock/minStock hardcodeado del array INGREDIENTS.
        coverageLines.push(
          `  [SKIP] ${ing.sku}: sin consumo → stock=${ing.stock} ${ing.unit} (hardcoded)`,
        );
        continue;
      }

      // avgDailyConsumption: igual al que computará el endpoint de cobertura.
      const avgDaily = totalConsumed.div(BASE_DAYS);

      // daysOnHand determinista: sanos = 6–18d (spread por idx % 7);
      // críticos = 1–3d (por idx % 3) → quedan bajo el mínimo de reorden (4d).
      const isCritical = CRITICAL_INDICES.has(idx);
      const daysOnHand = isCritical ? 1 + (idx % 3) : 6 + (idx % 7) * 2;

      const newStock = avgDaily.mul(daysOnHand).toDecimalPlaces(3);
      const newMinStock = avgDaily.mul(REORDER_DAYS).toDecimalPlaces(3);

      await prisma.ingredient.update({
        where: { id: ingId },
        data: { stock: newStock, minStock: newMinStock },
      });

      stockUpdated++;
      if (isCritical) lowStockCount++;

      coverageLines.push(
        `  [${isCritical ? 'LOW ' : 'OK  '}] ${ing.sku} ` +
          `avgDaily=${avgDaily.toFixed(3)} ${ing.unit}/d  ` +
          `stock=${newStock.toFixed(3)}  minStock=${newMinStock.toFixed(3)}  ` +
          `daysLeft≈${daysOnHand}`,
      );
    }

    console.log(
      `  ✓ stock/minStock recalculados: ${stockUpdated} insumos ` +
        `(${lowStockCount} bajo mínimo, daysLeft spread: 1-3d / 6-18d):`,
    );
    for (const line of coverageLines) console.log(line);
  }

  // 7c) Proveedores + órdenes de compra RECIBIDAS con precio histórico variable.
  // Alimenta HU-05-12 (ingredient price trend): 6 OC históricas, una por mes,
  // con precios ligeramente variables para simular inflación de insumos.
  {
    const supplierDemo = await prisma.supplier.create({
      data: {
        tenantId: TENANT_ID,
        ruc: '20601234567',
        name: 'Distribuidora Pesquera Lima SAC',
        contactName: 'Carlos Mendoza',
        contactEmail: 'ventas@distpesca.pe',
        leadTimeDays: 2,
        active: true,
      },
    });

    // Los insumos principales con precio variable (simulan variación de mercado).
    const priceSeriesByName: Record<string, number[]> = {
      'Pescado fresco (lenguado)': [32, 34, 35, 36, 38, 40],
      Pulpo: [38, 40, 42, 43, 45, 47],
      Camarones: [44, 46, 48, 50, 52, 54],
      'Lomo de res': [36, 38, 39, 40, 42, 44],
    };

    // Obtener IDs de los insumos por nombre.
    const ingsByName = await prisma.ingredient.findMany({
      where: {
        tenantId: TENANT_ID,
        name: { in: Object.keys(priceSeriesByName) },
      },
      select: { id: true, name: true },
    });
    const ingIdByName = new Map(ingsByName.map((i) => [i.name, i.id]));

    let poCount = 0;
    let phCount = 0;
    for (let monthBack = 6; monthBack >= 1; monthBack--) {
      // Fecha de la OC: aproximadamente monthBack meses atrás.
      const poDate = new Date(today.getTime() - monthBack * 30 * MS_PER_DAY);
      const receiveDate = new Date(poDate.getTime() + 2 * MS_PER_DAY);
      const priceIdx = 6 - monthBack; // índice 0=más antiguo, 5=más reciente

      // Construir líneas de la OC con el precio de ese período.
      const lines: { ingredientId: string; qty: number; cost: number }[] = [];
      for (const [name, prices] of Object.entries(priceSeriesByName)) {
        const ingId = ingIdByName.get(name);
        if (!ingId) continue;
        lines.push({
          ingredientId: ingId,
          qty: 20,
          cost: prices[priceIdx] ?? prices[0],
        });
      }

      if (lines.length === 0) continue;

      // Crear OC directamente en estado 'received' (datos históricos).
      const po = await prisma.purchaseOrder.create({
        data: {
          tenantId: TENANT_ID,
          supplierId: supplierDemo.id,
          status: 'received',
          expectedAt: receiveDate,
          createdAt: poDate,
          updatedAt: receiveDate,
        },
      });

      for (const line of lines) {
        await prisma.purchaseOrderItem.create({
          data: {
            tenantId: TENANT_ID,
            purchaseOrderId: po.id,
            ingredientId: line.ingredientId,
            qtyOrdered: new Prisma.Decimal(line.qty),
            qtyReceived: new Prisma.Decimal(line.qty),
            unitCost: new Prisma.Decimal(line.cost),
            createdAt: poDate,
          },
        });

        // Insertar price-history directamente (simula la recepción histórica).
        await prisma.ingredientPriceHistory.create({
          data: {
            tenantId: TENANT_ID,
            ingredientId: line.ingredientId,
            unitCost: new Prisma.Decimal(line.cost),
            recordedAt: receiveDate,
            source: 'purchase_order',
          },
        });
        phCount++;

        // También actualizar el movimiento de inventario (compra).
        await prisma.inventoryMovement.create({
          data: {
            tenantId: TENANT_ID,
            ingredientId: line.ingredientId,
            type: 'purchase',
            qty: new Prisma.Decimal(line.qty),
            note: `OC histórica ${po.id.slice(0, 8)} (seed)`,
            createdAt: receiveDate,
          },
        });
      }
      poCount++;
    }
    console.log(
      `  ✓ ${poCount} OC históricas (6 meses) + ${phCount} registros de precio`,
    );
  }

  // 7d) ForecastRun COMPLETADA (scope=total, horizon=14) — sembrada directamente
  // para que el endpoint /forecasting/shopping-suggestions devuelva datos reales
  // en la demo sin necesidad de esperar el job asíncrono (BullMQ + core-ai).
  // Los `points` son valores realistas de demanda diaria total (≈ 35-55 platos/día
  // con estacionalidad semanal). Se documenta como dato seeded, no inferido.
  {
    const forecastStart = new Date(today.getTime() + MS_PER_DAY); // mañana Lima
    const points = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(forecastStart.getTime() + i * MS_PER_DAY);
      const ds = (() => {
        const dd = new Date(d.getTime() + LIMA_OFFSET_MIN * MS_PER_MINUTE);
        const y = dd.getUTCFullYear();
        const m = String(dd.getUTCMonth() + 1).padStart(2, '0');
        const day = String(dd.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
      })();
      // Estacionalidad semanal: sábado (dow=6) y domingo (dow=0) venden ~40% más.
      const dow = new Date(
        d.getTime() + LIMA_OFFSET_MIN * MS_PER_MINUTE,
      ).getUTCDay();
      const weekendBoost = dow === 0 || dow === 6 ? 1.4 : 1.0;
      const yhat = Math.round(42 * weekendBoost); // platos totales/día
      return {
        target_date: ds,
        yhat,
        yhat_lo: Math.round(yhat * 0.75),
        yhat_hi: Math.round(yhat * 1.25),
      };
    });

    const forecastRun = await prisma.forecastRun.create({
      data: {
        tenantId: TENANT_ID,
        scope: 'total',
        horizon: 14,
        engine: 'statsforecast',
        status: 'completed',
        model: 'AutoETS',
        baseline: 'SeasonalNaive',
        observations: 179, // filas con ventas en el histórico
        spanDays: 187,
        dataQuality: 'few_shot',
        points: points as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });
    console.log(
      `  ✓ ForecastRun completada sembrada (id=${forecastRun.id.slice(0, 8)}, ` +
        `horizon=14, yhat_total=${points.reduce((s, p) => s + p.yhat, 0)} platos)`,
    );
  }

  // 8) Ventas REALES: Order → OrderItem → Sale → Payment.
  // Correlativos por serie (B001 boleta, F001 factura) — únicos por tenant.
  const correlatives: Record<string, number> = { B001: 0, F001: 0 };

  async function emitSale(params: {
    issuedAt: Date;
    tableId: string;
    docType: 'boleta' | 'factura';
    lines: {
      item: { id: string; name: string; price: Prisma.Decimal };
      qty: number;
    }[];
    methods: (typeof PAYMENT_METHODS)[number][];
  }): Promise<Prisma.Decimal> {
    const { issuedAt, tableId, docType, lines, methods } = params;
    const order = await prisma.order.create({
      data: {
        tenantId: TENANT_ID,
        tableId,
        guests: randInt(1, 4),
        status: 'paid',
        openedAt: new Date(issuedAt.getTime() - 60 * MS_PER_MINUTE),
        createdAt: new Date(issuedAt.getTime() - 60 * MS_PER_MINUTE),
      },
    });
    let total = new Prisma.Decimal(0);
    for (const l of lines) {
      const lineTotal = l.item.price.mul(l.qty);
      total = total.add(lineTotal);
      await prisma.orderItem.create({
        data: {
          tenantId: TENANT_ID,
          orderId: order.id,
          menuItemId: l.item.id,
          name: l.item.name,
          qty: l.qty,
          unitPrice: l.item.price,
          status: 'served',
          createdAt: issuedAt,
        },
      });
    }
    const { subtotal, igv } = splitIgv(total);
    const serie = docType === 'boleta' ? 'B001' : 'F001';
    correlatives[serie] += 1;
    const number = correlatives[serie];
    const sale = await prisma.sale.create({
      data: {
        tenantId: TENANT_ID,
        orderId: order.id,
        serie,
        number,
        docType,
        customer: docType === 'factura' ? 'Cliente Empresa SAC' : null,
        customerDoc: docType === 'factura' ? '20123456789' : null,
        subtotal,
        igv,
        total,
        status: 'issued',
        issuedAt,
        createdAt: issuedAt,
      },
    });
    // Pago(s): si hay 1 método, paga todo; si 2, parte el total.
    if (methods.length === 1) {
      await prisma.payment.create({
        data: {
          tenantId: TENANT_ID,
          saleId: sale.id,
          method: methods[0],
          amount: total,
          createdAt: issuedAt,
        },
      });
    } else {
      const half = total.div(2).toDecimalPlaces(2);
      await prisma.payment.create({
        data: {
          tenantId: TENANT_ID,
          saleId: sale.id,
          method: methods[0],
          amount: half,
          createdAt: issuedAt,
        },
      });
      await prisma.payment.create({
        data: {
          tenantId: TENANT_ID,
          saleId: sale.id,
          method: methods[1],
          amount: total.sub(half),
          createdAt: issuedAt,
        },
      });
    }
    return total;
  }

  function buildLines(): {
    item: { id: string; name: string; price: Prisma.Decimal };
    qty: number;
  }[] {
    const n = randInt(2, 4);
    const lines: {
      item: { id: string; name: string; price: Prisma.Decimal };
      qty: number;
    }[] = [];
    const used = new Set<number>();
    for (let i = 0; i < n; i++) {
      let idx = randInt(0, menuItems.length - 1);
      let guard = 0;
      while (used.has(idx) && guard++ < 10)
        idx = randInt(0, menuItems.length - 1);
      used.add(idx);
      lines.push({ item: menuItems[idx], qty: randInt(1, 3) });
    }
    return lines;
  }

  // Reusamos las mesas 'free' como mesas de paso de las ventas ya cerradas.
  const allTables = await prisma.diningTable.findMany({
    where: { tenantId: TENANT_ID },
  });
  const tableIds = allTables.map((t) => t.id);

  // 8a) Ventas de HOY: ~15 tickets emitidos a lo largo del día.
  let todaySales = 0;
  let todayRevenue = new Prisma.Decimal(0);
  const todayCount = randInt(14, 18);
  // Emitidas en la ventana del día YA transcurrida (00:00 Lima → ahora), así
  // SIEMPRE hay data de hoy sin importar la hora (Motif abre hasta tarde).
  const todaySpan = Math.max(1, now.getTime() - today.getTime());
  for (let i = 0; i < todayCount; i++) {
    const issuedAt = new Date(today.getTime() + rnd() * todaySpan);
    const docType: 'boleta' | 'factura' = rnd() > 0.8 ? 'factura' : 'boleta';
    const methods: (typeof PAYMENT_METHODS)[number][] =
      rnd() > 0.75
        ? [pick(PAYMENT_METHODS), pick(PAYMENT_METHODS)]
        : [pick(PAYMENT_METHODS)];
    const total = await emitSale({
      issuedAt,
      tableId: pick(tableIds),
      docType,
      lines: buildLines(),
      methods,
    });
    todaySales++;
    todayRevenue = todayRevenue.add(total);
  }
  console.log(
    `  ✓ ${todaySales} ventas de HOY (S/ ${todayRevenue.toFixed(2)})`,
  );

  // 8b) Ventas de los 6 días anteriores (sparkline 7d).
  let weekSales = 0;
  for (let d = 1; d <= 6; d++) {
    const day = new Date(today.getTime() - d * MS_PER_DAY);
    const dailyCount = randInt(8, 16);
    for (let i = 0; i < dailyCount; i++) {
      const issuedAt = atLimaTime(day, randInt(12, 22), randInt(0, 59));
      const docType: 'boleta' | 'factura' = rnd() > 0.85 ? 'factura' : 'boleta';
      const methods: (typeof PAYMENT_METHODS)[number][] = [
        pick(PAYMENT_METHODS),
      ];
      await emitSale({
        issuedAt,
        tableId: pick(tableIds),
        docType,
        lines: buildLines(),
        methods,
      });
      weekSales++;
    }
  }
  console.log(`  ✓ ${weekSales} ventas en los 6 días previos (sparkline 7d)`);

  // 9) Órdenes "vivas" (cuentas abiertas) en las mesas ocupadas, SIN Sale.
  // Tiempos realistas relativos a AHORA para que el mapa muestre una MEZCLA de
  // estados (no un mar de "demorada"): mesas recién sentadas, una demorada (>2h)
  // y una pidiendo la cuenta (por cobrar). El front marca demorada con umbral 2h.
  const liveScenarios = [
    { minutesAgo: 25, status: 'sent_to_kitchen', bill: false }, // recién pidió
    { minutesAgo: 55, status: 'served', bill: false }, // comiendo
    { minutesAgo: 165, status: 'served', bill: false }, // demorada (>2h)
    { minutesAgo: 90, status: 'served', bill: true }, // por cobrar
  ];
  const itemStatusByOrder: Record<string, string> = {
    open: 'pending',
    sent_to_kitchen: 'preparing',
    served: 'served',
  };
  let liveOrders = 0;
  for (let i = 0; i < occupiedTables.length; i++) {
    const sc = liveScenarios[i % liveScenarios.length];
    const openedAt = new Date(now.getTime() - sc.minutesAgo * MS_PER_MINUTE);
    const order = await prisma.order.create({
      data: {
        tenantId: TENANT_ID,
        tableId: occupiedTables[i].id,
        guests: randInt(2, 5),
        status: sc.status,
        openedAt,
        sentToKitchenAt: sc.status === 'open' ? null : openedAt,
        createdAt: openedAt,
      },
    });
    const lines = buildLines();
    const sentAt = sc.status === 'open' ? null : openedAt;
    for (let li = 0; li < lines.length; li++) {
      const l = lines[li]!;
      // En una comanda recién enviada, la cocina no arrancó todo: el primer ítem
      // queda "en cola" (pending) y el resto "en preparación" → el KDS muestra
      // ambos estados de forma realista.
      let itemStatus = itemStatusByOrder[sc.status] ?? 'served';
      if (sc.status === 'sent_to_kitchen' && li === 0) itemStatus = 'pending';
      await prisma.orderItem.create({
        data: {
          tenantId: TENANT_ID,
          orderId: order.id,
          menuItemId: l.item.id,
          name: l.item.name,
          qty: l.qty,
          unitPrice: l.item.price,
          status: itemStatus,
          kitchenStationId: stationByMenuItemId.get(l.item.id) ?? null,
          sentToKitchenAt: sentAt,
          preparingAt:
            itemStatus === 'preparing'
              ? new Date(openedAt.getTime() + 3 * MS_PER_MINUTE)
              : null,
          createdAt: openedAt,
        },
      });
    }
    // Una mesa ya pidió la cuenta → estado "por cobrar" (terracotta + pulse).
    if (sc.bill) {
      await prisma.diningTable.update({
        where: { id: occupiedTables[i].id },
        data: { status: 'bill' },
      });
    }
    liveOrders++;
  }
  console.log(`  ✓ ${liveOrders} órdenes vivas en mesas ocupadas (sin emitir)`);

  // 10) Empleados del tenant (demo roster).
  // ONE employee (Carlos Quispe, mozo) links to the staff@motif.pe platform
  // account via userId. The rest have no account — typical for kitchen/cashier
  // roles in a small Peruvian restaurant. userId is @unique on Employee, so
  // at most one row per user.
  let empCount = 0;
  for (const emp of EMPLOYEES) {
    await prisma.employee.create({
      data: {
        tenantId: TENANT_ID,
        firstName: emp.firstName,
        lastName: emp.lastName,
        dni: emp.dni,
        position: emp.position,
        salary: new Prisma.Decimal(emp.salary),
        phone: emp.phone,
        hiredAt: new Date(emp.hiredAt),
        active: true,
        // Link only the flagged employee; null means no platform account.
        userId: emp.linkStaff === true ? (staffUser?.id ?? null) : null,
      },
    });
    empCount++;
  }
  console.log(`  ✓ ${empCount} empleados sembrados`);

  // 11) Notificaciones no leídas (readAt: null) — alimentan el badge de la campana.
  // Se crean DESPUÉS del stock-rightsizing (paso 7b) para que el body refleje los
  // valores reales de stock/minStock que el usuario verá en el panel de inventario.
  {
    // Retrieve post-rightsizing stock values for the two most critical ingredients.
    // We use IDs from the ingBySku map (populated in step 3) to avoid a SKU lookup.
    const pulpoId = ingBySku.get('PES-002');
    const conchasId = ingBySku.get('PES-004');

    const [pulpo, conchas] = await Promise.all([
      pulpoId
        ? prisma.ingredient.findUnique({
            where: { id: pulpoId },
            select: {
              id: true,
              name: true,
              stock: true,
              minStock: true,
              unit: true,
            },
          })
        : Promise.resolve(null),
      conchasId
        ? prisma.ingredient.findUnique({
            where: { id: conchasId },
            select: {
              id: true,
              name: true,
              stock: true,
              minStock: true,
              unit: true,
            },
          })
        : Promise.resolve(null),
    ]);

    /** Returns a Date that is `n` full days before today's Lima midnight. */
    const daysAgo = (n: number): Date =>
      new Date(today.getTime() - n * MS_PER_DAY);

    // Two low_stock alerts for genuinely critical ingredients (guaranteed by
    // CRITICAL_INDICES in the stock-rightsizing block above).
    if (pulpo) {
      await prisma.notification.create({
        data: {
          tenantId: TENANT_ID,
          userId: null, // broadcast — visible to all users of this tenant
          type: 'low_stock',
          title: `Stock crítico: ${pulpo.name}`,
          body: `"${pulpo.name}" tiene ${pulpo.stock.toFixed(2)} ${pulpo.unit} disponible, por debajo del mínimo de ${pulpo.minStock.toFixed(2)} ${pulpo.unit}. Generar orden de compra urgente.`,
          data: {
            route: `/app/inventario/producto/${pulpo.id}`,
            ingredientId: pulpo.id,
            currentStock: pulpo.stock.toFixed(3),
            minStock: pulpo.minStock.toFixed(3),
            unit: pulpo.unit,
          } as unknown as Prisma.InputJsonValue,
          readAt: null,
          createdAt: daysAgo(2),
        },
      });
    }

    if (conchas) {
      await prisma.notification.create({
        data: {
          tenantId: TENANT_ID,
          userId: null,
          type: 'low_stock',
          title: `Stock crítico: ${conchas.name}`,
          body: `"${conchas.name}" tiene ${conchas.stock.toFixed(2)} ${conchas.unit} disponible, por debajo del mínimo de ${conchas.minStock.toFixed(2)} ${conchas.unit}. Revisar y reponer inventario.`,
          data: {
            route: `/app/inventario/producto/${conchas.id}`,
            ingredientId: conchas.id,
            currentStock: conchas.stock.toFixed(3),
            minStock: conchas.minStock.toFixed(3),
            unit: conchas.unit,
          } as unknown as Prisma.InputJsonValue,
          readAt: null,
          createdAt: daysAgo(4),
        },
      });
    }

    // System broadcast — always created, regardless of stock state.
    await prisma.notification.create({
      data: {
        tenantId: TENANT_ID,
        userId: null,
        type: 'system',
        title: 'GastronomIA activo en Motif Restobar',
        body: 'El sistema de rentabilidad está activo. Revisá el dashboard para ver ventas del día, cobertura de stock y proyecciones de demanda para los próximos 14 días.',
        data: { route: '/app/dashboard' } as unknown as Prisma.InputJsonValue,
        readAt: null,
        createdAt: daysAgo(1),
      },
    });

    const notifCount = (pulpo ? 1 : 0) + (conchas ? 1 : 0) + 1;
    console.log(
      `  ✓ ${notifCount} notificaciones no leídas sembradas (badge de campana)`,
    );
  }

  console.log(
    `\nSeed de negocio listo · tenant "${TENANT_NAME}" · login ${USER_EMAIL} / ${DEMO_PASSWORD}`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
