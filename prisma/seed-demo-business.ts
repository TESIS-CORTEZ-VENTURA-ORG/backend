import { Prisma, PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';

/**
 * Seed de DATOS DE NEGOCIO de demo — "Cevichería El Timón" (caso de estudio).
 *
 * Puebla el tenant del usuario `rcortezadmin@gmail.com` con un restaurante peruano
 * coherente y CON VIDA: insumos con stock, recetas con BOM, carta de platos, salón
 * con mesas, CIF del mes, histórico de ventas SINTÉTICO (18 meses, terminando
 * AYER — ver el generador documentado en el paso 7 de `main()`, artefacto
 * metodológico auditable para la tesis, NUNCA presentado como data real) y, sobre
 * todo, ventas REALES (Order → OrderItem → Sale → Payment) de HOY y de los
 * últimos 7 días para que el dashboard del owner/manager muestre números reales
 * (Venta hoy, tickets, top platos, margen bruto, stock bajo, mesas ocupadas,
 * sparkline 7d).
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
//
// UNIT COSTS — precios de mercado Lima 2025 (fuente: Mercado Mayorista de Frutas
// y La Parada, cotizaciones distribuidoras de pescado, referencias MINAGRI):
//   - Seafood: lenguado S/40/kg, pulpo limpio S/30/kg, langostinos S/33/kg,
//     conchas S/32/kg (corrección de S/45–60 → precios reales de distribuidor).
//   - Verduras: limón S/8/kg (volátil 4–12), cilantro S/12/kg (hojas), camote S/3.5/kg.
//   - Abarrotes: arroz S/4.5/kg, aceite S/9/L.
//   - Carnes: lomo de res S/32/kg (pulpa limpia distribuidor mayorista), pollo S/17/kg.
//   - Pisco: S/40/L (botella 750ml ≈ S/30, costo puro de insumo).
// `low: true` fuerza stock < minStock (alimenta lowStockCount del dashboard).
//
// SHELF_LIFE_DAYS_BY_CATEGORY (Lote B4, vida útil de insumos MVP sin lotes) —
// un valor representativo por categoría (no un CRUD todavía, ver
// `Ingredient.shelfLifeDays`); rangos de referencia del negocio:
//   - Pescados y Mariscos: 2-3 días (perecible extremo, cadena de frío corta).
//   - Carnes: 4-5 días (refrigerado, sin congelar).
//   - Verduras: 5-7 días (hoja/fruta fresca, vida más larga que el mar).
//   - Abarrotes/Bebidas: 180+ días (secos/envasados, prácticamente no vencen
//     en el horizonte operativo del negocio).
// Categorías fuera de este mapa quedan `shelfLifeDays: null` (no perecible o
// sin configurar) a propósito — NO se inventa un valor por defecto genérico.
const SHELF_LIFE_DAYS_BY_CATEGORY: Record<string, number> = {
  'Pescados y Mariscos': 3,
  Carnes: 5,
  Verduras: 6,
  Abarrotes: 200,
  Bebidas: 220,
};

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
    unitCost: 40,
    stock: 12,
    minStock: 8,
  },
  {
    sku: 'PES-002',
    name: 'Pulpo',
    unit: 'kg',
    category: 'Pescados y Mariscos',
    unitCost: 30,
    stock: 4,
    minStock: 6,
    low: true,
  },
  {
    sku: 'PES-003',
    name: 'Camarones',
    unit: 'kg',
    category: 'Pescados y Mariscos',
    unitCost: 33,
    stock: 7,
    minStock: 5,
  },
  {
    sku: 'PES-004',
    name: 'Conchas de abanico',
    unit: 'kg',
    category: 'Pescados y Mariscos',
    unitCost: 32,
    stock: 3,
    minStock: 5,
    low: true,
  },
  {
    sku: 'VER-001',
    name: 'Limón',
    unit: 'kg',
    category: 'Verduras',
    unitCost: 8,
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
    unitCost: 9,
    stock: 6,
    minStock: 3,
  },
  {
    sku: 'VER-005',
    name: 'Cilantro',
    unit: 'kg',
    category: 'Verduras',
    unitCost: 12,
    stock: 2,
    minStock: 4,
    low: true,
  },
  {
    sku: 'VER-006',
    name: 'Camote',
    unit: 'kg',
    category: 'Verduras',
    unitCost: 3.5,
    stock: 20,
    minStock: 8,
  },
  {
    sku: 'VER-007',
    name: 'Choclo',
    unit: 'kg',
    category: 'Verduras',
    unitCost: 4,
    stock: 14,
    minStock: 6,
  },
  {
    sku: 'ABA-001',
    name: 'Arroz',
    unit: 'kg',
    category: 'Abarrotes',
    unitCost: 4.5,
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
    unitCost: 32,
    stock: 9,
    minStock: 6,
  },
  {
    sku: 'CAR-002',
    name: 'Pechuga de pollo',
    unit: 'kg',
    category: 'Carnes',
    unitCost: 17,
    stock: 11,
    minStock: 6,
  },
  {
    sku: 'BEB-001',
    name: 'Pisco quebranta',
    unit: 'L',
    category: 'Bebidas',
    // S/30 botella 750ml → S/40/L costo puro de insumo.
    unitCost: 40,
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
//
// FOOD COST TARGET BANDS (food cost = ingredientCost / price):
//   - Platos de mar (Ceviches, Tiradito, Pulpo, Arroz): 30–38%
//   - Criollos (Lomo Saltado, Ají de Gallina, Causa Limeña): 28–35%
//   - Bebidas (Pisco Sour, Chicha Morada): 18–26%
//
// BOM DESIGN RATIONALE:
//   - effQty = qty × (1 + wasteFactor); ingredientCost = Σ effQty × unitCost.
//   - Porciones calibradas con precios de mercado Lima 2025 para que cada plato
//     caiga dentro de su banda objetivo. Se priorizó plausibilidad física
//     (ceviche ~200–220g de pescado, tiradito presentación generosa, lomo saltado
//     porción generosa para justificar precio de restobar).
//   - Pisco Sour: BOM simplificado (no incluye clara de huevo ni jarabe de goma
//     por ausencia de esos SKUs); la qty de pisco (90ml) absorbe ese costo diferencial
//     para mantener el food cost en banda (≈18%).
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
    // ingredientCost ≈ S/13.32 → food cost ≈ 31.7% (target 30–38%)
    // PES-001: 0.22×1.10×40=9.68 | VER-001: 0.20×8=1.60 | VER-002: 0.10×4=0.40
    // VER-003: 0.03×9=0.27 | VER-005: 0.02×12=0.24 | VER-006: 0.15×3.5=0.525
    // VER-007: 0.15×4=0.60
    name: 'Ceviche Clásico',
    emoji: '🐟',
    category: 'Entradas',
    price: 42,
    prepMinutes: 15,
    bom: [
      { sku: 'PES-001', qty: 0.22, waste: 0.1 }, // 220g lenguado plated + 10% merma
      { sku: 'VER-001', qty: 0.2 }, // 200g limón (leche de tigre generosa)
      { sku: 'VER-002', qty: 0.1 }, // 100g cebolla
      { sku: 'VER-003', qty: 0.03 }, // 30g ají limo
      { sku: 'VER-005', qty: 0.02 }, // 20g cilantro
      { sku: 'VER-006', qty: 0.15 }, // 150g camote
      { sku: 'VER-007', qty: 0.15 }, // 150g choclo
    ],
  },
  {
    // ingredientCost ≈ S/16.81 → food cost ≈ 32.3% (target 30–38%)
    // PES-001: 0.13×1.10×40=5.72 | PES-002: 0.13×30=3.90 | PES-003: 0.13×33=4.29
    // VER-001: 0.20×8=1.60 | VER-002: 0.10×4=0.40 | VER-006: 0.12×3.5=0.42
    // VER-007: 0.12×4=0.48
    name: 'Ceviche Mixto',
    emoji: '🦐',
    category: 'Entradas',
    price: 52,
    prepMinutes: 18,
    bom: [
      { sku: 'PES-001', qty: 0.13, waste: 0.1 }, // 130g lenguado + 10% merma
      { sku: 'PES-002', qty: 0.13 }, // 130g pulpo
      { sku: 'PES-003', qty: 0.13 }, // 130g camarones
      { sku: 'VER-001', qty: 0.2 }, // 200g limón
      { sku: 'VER-002', qty: 0.1 }, // 100g cebolla
      { sku: 'VER-006', qty: 0.12 }, // 120g camote
      { sku: 'VER-007', qty: 0.12 }, // 120g choclo
    ],
  },
  {
    // ingredientCost ≈ S/14.57 → food cost ≈ 31.7% (target 30–38%)
    // PES-001: 0.28×1.10×40=12.32 | VER-001: 0.18×8=1.44 | VER-004: 0.04×9=0.36
    // VER-005: 0.015×12=0.18 | ABA-002: 0.03×9=0.27
    name: 'Tiradito de Lenguado',
    emoji: '🍣',
    category: 'Entradas',
    price: 46,
    prepMinutes: 12,
    bom: [
      { sku: 'PES-001', qty: 0.28, waste: 0.1 }, // 280g lenguado (presentación generosa) + 10% merma
      { sku: 'VER-001', qty: 0.18 }, // 180g limón (leche de tigre)
      { sku: 'VER-004', qty: 0.04 }, // 40g ají amarillo (crema)
      { sku: 'VER-005', qty: 0.015 }, // 15g cilantro
      { sku: 'ABA-002', qty: 0.03 }, // 30ml aceite (aliño)
    ],
  },
  {
    // ingredientCost ≈ S/8.80 → food cost ≈ 31.4% (target 28–35%)
    // VER-006: 0.40×3.5=1.40 | CAR-002: 0.35×17=5.95 | VER-004: 0.05×9=0.45
    // VER-001: 0.08×8=0.64 | ABA-002: 0.04×9=0.36
    name: 'Causa Limeña',
    emoji: '🥔',
    category: 'Entradas',
    price: 28,
    prepMinutes: 20,
    bom: [
      { sku: 'VER-006', qty: 0.4 }, // 400g camote (base similar a papa amarilla)
      { sku: 'CAR-002', qty: 0.35 }, // 350g pollo deshilachado (relleno generoso)
      { sku: 'VER-004', qty: 0.05 }, // 50g ají amarillo
      { sku: 'VER-001', qty: 0.08 }, // 80g limón
      { sku: 'ABA-002', qty: 0.04 }, // 40ml aceite
    ],
  },
  {
    // ingredientCost ≈ S/14.31 → food cost ≈ 29.8% (target 28–35%)
    // CAR-001: 0.35×1.05×32=11.76 | VER-002: 0.15×4=0.60 | ABA-001: 0.20×4.5=0.90
    // ABA-002: 0.06×9=0.54 | VER-005: 0.02×12=0.24 | VER-004: 0.03×9=0.27
    name: 'Lomo Saltado',
    emoji: '🥩',
    category: 'Principales',
    price: 48,
    prepMinutes: 18,
    bom: [
      { sku: 'CAR-001', qty: 0.35, waste: 0.05 }, // 350g lomo (porción generosa restobar) + 5% merma
      { sku: 'VER-002', qty: 0.15 }, // 150g cebolla
      { sku: 'ABA-001', qty: 0.2 }, // 200g arroz
      { sku: 'ABA-002', qty: 0.06 }, // 60ml aceite wok
      { sku: 'VER-005', qty: 0.02 }, // 20g cilantro
      { sku: 'VER-004', qty: 0.03 }, // 30g ají amarillo
    ],
  },
  {
    // ingredientCost ≈ S/17.955 → food cost ≈ 33.2% (target 30–38%)
    // ABA-001: 0.25×4.5=1.125 | PES-003: 0.25×33=8.25 | PES-004: 0.22×32=7.04
    // VER-004: 0.05×9=0.45 | VER-002: 0.10×4=0.40 | ABA-002: 0.05×9=0.45
    // VER-005: 0.02×12=0.24
    name: 'Arroz con Mariscos',
    emoji: '🍤',
    category: 'Principales',
    price: 54,
    prepMinutes: 25,
    bom: [
      { sku: 'ABA-001', qty: 0.25 }, // 250g arroz
      { sku: 'PES-003', qty: 0.25 }, // 250g camarones
      { sku: 'PES-004', qty: 0.22 }, // 220g conchas de abanico
      { sku: 'VER-004', qty: 0.05 }, // 50g ají amarillo
      { sku: 'VER-002', qty: 0.1 }, // 100g cebolla
      { sku: 'ABA-002', qty: 0.05 }, // 50ml aceite
      { sku: 'VER-005', qty: 0.02 }, // 20g cilantro
    ],
  },
  {
    // ingredientCost ≈ S/10.74 → food cost ≈ 29.8% (target 28–35%)
    // CAR-002: 0.42×17=7.14 | VER-004: 0.15×9=1.35 | ABA-001: 0.22×4.5=0.99
    // ABA-002: 0.06×9=0.54 | VER-002: 0.08×4=0.32 | VER-001: 0.05×8=0.40
    name: 'Ají de Gallina',
    emoji: '🍛',
    category: 'Principales',
    price: 36,
    prepMinutes: 30,
    bom: [
      { sku: 'CAR-002', qty: 0.42 }, // 420g pechuga (porción generosa + salsa)
      { sku: 'VER-004', qty: 0.15 }, // 150g ají amarillo (base de la salsa)
      { sku: 'ABA-001', qty: 0.22 }, // 220g arroz
      { sku: 'ABA-002', qty: 0.06 }, // 60ml aceite
      { sku: 'VER-002', qty: 0.08 }, // 80g cebolla
      { sku: 'VER-001', qty: 0.05 }, // 50g limón
    ],
  },
  {
    // ingredientCost ≈ S/18.10 → food cost ≈ 31.2% (target 30–38%)
    // PES-002: 0.44×1.25×30=16.50 | ABA-002: 0.08×9=0.72 | VER-002: 0.06×4=0.24
    // VER-001: 0.08×8=0.64
    // waste=0.25: el pulpo pierde ~20–25% durante cocción y limpieza de ventosas.
    name: 'Pulpo al Olivo',
    emoji: '🐙',
    category: 'Principales',
    price: 58,
    prepMinutes: 22,
    bom: [
      { sku: 'PES-002', qty: 0.44, waste: 0.25 }, // 440g pulpo plated + 25% merma cocción
      { sku: 'ABA-002', qty: 0.08 }, // 80ml aceite de oliva (salsa)
      { sku: 'VER-002', qty: 0.06 }, // 60g cebolla
      { sku: 'VER-001', qty: 0.08 }, // 80g limón
    ],
  },
  {
    // ingredientCost ≈ S/4.32 → food cost ≈ 18.0% (target 18–26%)
    // BEB-001: 0.09×40=3.60 | VER-001: 0.09×8=0.72
    // Nota: BOM simplificado (sin huevo/azúcar — SKUs no sembrados). Los 90ml de
    // pisco representan el costo "all-in" de la bebida (pisco 65ml + absorción
    // proporcional de clara de huevo S/0.50 y jarabe de goma S/0.10).
    name: 'Pisco Sour',
    emoji: '🍸',
    category: 'Bebidas',
    price: 24,
    prepMinutes: 5,
    bom: [
      { sku: 'BEB-001', qty: 0.09 }, // 90ml pisco (incluye absorción costos no sembrados)
      { sku: 'VER-001', qty: 0.09 }, // 90g limón (jugo + extra para presentación)
    ],
  },
  {
    // ingredientCost ≈ S/3.00 → food cost ≈ 25.0% (target 18–26%)
    // BEB-002: 0.25×12=3.00 — sin cambio, ya estaba en banda.
    name: 'Chicha Morada',
    emoji: '🟣',
    category: 'Bebidas',
    price: 12,
    prepMinutes: 3,
    bom: [{ sku: 'BEB-002', qty: 0.25 }], // 250ml concentrado
  },
];

/**
 * Non-uniform popularity weights — indexed parallel to DISHES array (length=10).
 *
 * PURPOSE: makes dish sales non-uniform so the Menu Engineering report (Kasavana-Smith
 * matrix) shows ALL FOUR quadrants: Star / Plowhorse / Puzzle / Dog.
 *
 * MATH (N=10 dishes, popularityCutoff = 0.70/10 = 7%):
 *   An item is "high popularity" if its share of total units sold ≥ 7%.
 *   An item is "high profitability" if its CM ≥ avgCM (simple average).
 *   avgCM ≈ S/27.81 (unweighted mean of price − ingredient cost across all 10 dishes).
 *
 * QUADRANT ASSIGNMENT (shares approximate DISH_WEIGHTS / 100):
 *   Stars      (high pop ≥7%, high CM ≥ S/27.81):
 *     Ceviche Clásico (15%), Ceviche Mixto (18%), Tiradito (8%), Lomo Saltado (17%)
 *   Plowhorses (high pop ≥7%, low CM < S/27.81):
 *     Pisco Sour (12%), Chicha Morada (13%)
 *   Puzzles    (low pop <7%, high CM):
 *     Arroz con Mariscos (6%), Pulpo al Olivo (3%)
 *   Dogs       (low pop <7%, low CM):
 *     Causa Limeña (4%), Ají de Gallina (4%)
 *
 * Applied in buildLines() (real June sales → used by prime-cost + menu-engineering)
 * AND in the 6-month salesHistory loop (forecasting coherence).
 */
const DISH_WEIGHTS = [
  15, // idx 0 Ceviche Clásico     → Star      (CM S/28.68 > S/27.81)
  18, // idx 1 Ceviche Mixto       → Star      (CM S/35.19)
  8, // idx 2 Tiradito de Lenguado→ Star      (CM S/31.43)
  4, // idx 3 Causa Limeña        → Dog       (CM S/19.20)
  17, // idx 4 Lomo Saltado        → Star      (CM S/33.69)
  6, // idx 5 Arroz con Mariscos  → Puzzle    (CM S/36.05)
  4, // idx 6 Ají de Gallina      → Dog       (CM S/25.26)
  3, // idx 7 Pulpo al Olivo      → Puzzle    (CM S/39.90)
  12, // idx 8 Pisco Sour          → Plowhorse (CM S/19.68)
  13, // idx 9 Chicha Morada       → Plowhorse (CM S/ 9.00)
] as const;

/** Sum of all weights (= 100 for easy percent reading). */
const DISH_WEIGHT_TOTAL = DISH_WEIGHTS.reduce(
  (s: number, w: number) => s + w,
  0,
); // 100

/**
 * Samples a dish index (0..9) proportional to DISH_WEIGHTS using the deterministic
 * PRNG. Replaces the uniform randInt in buildLines() and salesHistory seeding.
 */
function weightedPickDishIndex(): number {
  const r = rnd() * DISH_WEIGHT_TOTAL;
  let cum = 0;
  for (let i = 0; i < DISH_WEIGHTS.length; i++) {
    cum += DISH_WEIGHTS[i];
    if (r < cum) return i;
  }
  // Floating-point edge case: return last index.
  return DISH_WEIGHTS.length - 1;
}

const ZONES = [
  { name: 'Salón', position: 0 },
  { name: 'Terraza', position: 1 },
];

// HU-01-10 · Horarios de atención (bugfix 2026-07-02 — QA scout: la config del
// local mostraba "Cerrado" todos los días). Restobar-karaoke típico de Lima:
// cerrado los lunes (día 1), abierto martes(2)–domingo(0) en dos franjas
// (almuerzo + cena/karaoke). Días 0=domingo..6=sábado (businessHoursSchema,
// src/shared/tenant/settings.ts). Dos entradas por día porque el schema
// modela una franja (open/close) por fila, no un rango con corte de almuerzo.
const OPEN_DAYS = [2, 3, 4, 5, 6, 0] as const; // martes..sábado, domingo
const BUSINESS_HOURS = OPEN_DAYS.flatMap((day) => [
  { day, open: '12:00', close: '16:00' }, // almuerzo
  { day, open: '19:00', close: '23:30' }, // cena + karaoke
]);

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

// OVERHEAD ALIGNMENT — "Sueldos de planilla" is the TOTAL LABOUR COST TO THE
// EMPLOYER (costo laboral total), not just base salaries. For a Lima restobar
// this includes:
//   Base salaries (13 employees):       S/23,650
//   EsSalud 9%:                         S/ 2,129
//   CTS 8.33%:                          S/ 1,971
//   Gratificaciones Jul+Dic 16.67%:     S/ 3,944
//   SCTR + seguro de vida ~2%:          S/   473
//   Horas extras / reemplazos ~5%:      S/ 1,183
//   Uniformes / EPP / beneficios ~10%:  S/ 2,365
//   TOTAL costo planilla:               S/35,715 → rounded to S/35,700
//
// P&L prime-cost target (period 2026-06, revenue ≈ S/137,846):
//   laborCost% = 35,700 / 137,846 ≈ 25.9%  (target band 24–30%) ✓
//   foodCost%  ≈ 30.2%  (fixed by BOM, target 30–33%)          ✓
//   primeCost% ≈ 56.1%  (target 55–62%, status 'good' ≤60%)    ✓
//
// Total CIF = 6,500 + 1,800 + 35,700 + 950 + 600 + 850 = S/46,400/mes.
const OVERHEADS = [
  { concept: 'Alquiler del local', amount: 6500 },
  { concept: 'Luz y agua', amount: 1800 },
  { concept: 'Sueldos de planilla', amount: 35700 },
  { concept: 'Gas y combustible', amount: 950 },
  { concept: 'Marketing y publicidad', amount: 600 },
  { concept: 'Servicios y limpieza', amount: 850 },
];

/** Valid position codes for the Employee model (mirrored from the Zod schema). */
type EmployeePosition = 'mozo' | 'cocina' | 'caja' | 'otro';

type EmployeeSeed = {
  firstName: string;
  lastName: string;
  /** 8-digit Peruvian DNI — @@unique per tenant. */
  dni: string;
  position: EmployeePosition;
  /** Monthly base salary in PEN (≥ RMV S/1,130). */
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
 * Thirteen-employee roster for Motif Restobar Karaoke — reflects a realistic
 * busy Lima restobar (2024-2026):
 *   - 4 cocina  (chef + sous chef + 2 cocineros de línea)
 *   - 5 mozos   (atención al salón y terraza)
 *   - 2 caja    (turnos mediodía / noche)
 *   - 1 barra   (bartender)
 *   - 1 encargado / administración
 *
 * Base salaries (PEN/mes): sum = S/23,650.
 * Total employer cost (planilla): base × 1.351 (EsSalud 9% + CTS 8.33% +
 * gratificaciones 16.67% + SCTR ~1%) = S/31,950 → see OVERHEADS.
 *
 * DNIs are deterministic 8-digit codes, all unique within this tenant.
 * One employee (Carlos Quispe, mozo) is linked to the staff@motif.pe platform account.
 */
const EMPLOYEES: EmployeeSeed[] = [
  // Encargado / administración
  {
    firstName: 'Jorge',
    lastName: 'Tapia Ramos',
    dni: '71293845',
    position: 'otro',
    salary: 3500,
    phone: '943210987',
    hiredAt: '2021-11-05',
  },
  // Cocina (4)
  {
    firstName: 'Renzo',
    lastName: 'Palomino Cruz',
    dni: '68291047',
    position: 'cocina', // chef / jefe de cocina
    salary: 2600,
    phone: '965432109',
    hiredAt: '2023-06-20',
  },
  {
    firstName: 'David',
    lastName: 'Mamani Condori',
    dni: '73829164',
    position: 'cocina', // sous chef
    salary: 2200,
    phone: '956341087',
    hiredAt: '2023-09-01',
  },
  {
    firstName: 'Ana',
    lastName: 'Rojas Sánchez',
    dni: '62847391',
    position: 'cocina', // cocinera de línea
    salary: 1800,
    phone: '947231890',
    hiredAt: '2024-03-15',
  },
  {
    firstName: 'Valeria',
    lastName: 'Huanca Flores',
    dni: '53742816',
    position: 'cocina', // cocinera de línea
    salary: 1700,
    phone: '954321098',
    hiredAt: '2024-01-10',
  },
  // Mozos / atención (5)
  {
    firstName: 'Carlos',
    lastName: 'Quispe Mamani',
    dni: '72834951',
    position: 'mozo',
    salary: 1500,
    phone: '987654321',
    hiredAt: '2023-03-15',
    linkStaff: true, // maps to the seeded staff@motif.pe user account
  },
  {
    firstName: 'Pedro',
    lastName: 'Ccallo Flores',
    dni: '84726193',
    position: 'mozo',
    salary: 1450,
    phone: '938274651',
    hiredAt: '2023-11-20',
  },
  {
    firstName: 'Sandra',
    lastName: 'Vega Mora',
    dni: '61829347',
    position: 'mozo',
    salary: 1400,
    phone: '929163847',
    hiredAt: '2024-05-10',
  },
  {
    firstName: 'Luis',
    lastName: 'Torres Paz',
    dni: '79382614',
    position: 'mozo',
    salary: 1400,
    phone: '918274365',
    hiredAt: '2024-06-01',
  },
  {
    firstName: 'María',
    lastName: 'Condori Quispe',
    dni: '56193847',
    position: 'mozo',
    salary: 1350,
    phone: '907162534',
    hiredAt: '2025-01-15',
  },
  // Caja (2)
  {
    firstName: 'Lucía',
    lastName: 'Torres Vásquez',
    dni: '45618273',
    position: 'caja',
    salary: 1700,
    phone: '976543210',
    hiredAt: '2022-08-01',
  },
  {
    firstName: 'Rosa',
    lastName: 'Mamani León',
    dni: '58362941',
    position: 'caja',
    salary: 1550,
    phone: '895632147',
    hiredAt: '2023-07-01',
  },
  // Barra (1)
  {
    firstName: 'Kevin',
    lastName: 'Ríos Castillo',
    dni: '67284931',
    position: 'otro', // bartender
    salary: 1500,
    phone: '884521963',
    hiredAt: '2022-12-01',
  },
];

const PAYMENT_METHODS = ['cash', 'yape', 'card', 'plin'] as const;

/** Type guard mirroring BillingService.isPaymentMethod (src/billing/billing.service.ts). */
function isPaymentMethod(m: string): m is (typeof PAYMENT_METHODS)[number] {
  return (PAYMENT_METHODS as readonly string[]).includes(m);
}

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

  // Last complete calendar month (Lima): used to seed overhead costs AND a full
  // month of real Sales so the "Costeo y márgenes" view defaults to realistic margins.
  // Costing is retrospective — the current month-to-date always has too few units,
  // making cifPerUnit explode. The last complete month has ~450+ sales → cifPerUnit ≈ S/5–8.
  const localNow = new Date(now.getTime() + LIMA_OFFSET_MIN * MS_PER_MINUTE);
  const nowYear = localNow.getUTCFullYear();
  const nowMonth = localNow.getUTCMonth() + 1; // 1-indexed
  const lastMonthYear = nowMonth === 1 ? nowYear - 1 : nowYear;
  const lastMonthNum = nowMonth === 1 ? 12 : nowMonth - 1; // 1-indexed
  const lastMonthPeriod = `${lastMonthYear}-${String(lastMonthNum).padStart(2, '0')}`;
  // Date.UTC uses 0-indexed months; passing lastMonthNum (1-indexed) gives month+1 day-0 = last day of lastMonth.
  const daysInLastMonth = new Date(
    Date.UTC(lastMonthYear, lastMonthNum, 0),
  ).getUTCDate();

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
    data: {
      name: TENANT_NAME,
      igvRate: 0.18,
      currency: 'PEN',
      businessHours: BUSINESS_HOURS as unknown as Prisma.InputJsonValue,
    },
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
        // Lote B4 · vida útil por categoría (ver SHELF_LIFE_DAYS_BY_CATEGORY);
        // `undefined` categoría fuera del mapa → null (no perecible/sin config).
        shelfLifeDays: SHELF_LIFE_DAYS_BY_CATEGORY[ing.category] ?? null,
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

  // 6) CIF (overhead) del período actual Y del último mes completo.
  // El costeo es retrospectivo: la vista "Costeo y márgenes" hace default al mes
  // anterior. Sembrar CIF en ambos períodos garantiza que whichever el usuario
  // seleccione tenga prorrateo de costos indirectos disponible.
  const periodsForCif = [lastMonthPeriod, period];
  for (const cifPeriod of periodsForCif) {
    for (const o of OVERHEADS) {
      await prisma.overheadCost.create({
        data: {
          tenantId: TENANT_ID,
          period: cifPeriod,
          concept: o.concept,
          amount: o.amount,
        },
      });
    }
  }
  console.log(
    `  ✓ ${OVERHEADS.length * 2} CIF: períodos ${lastMonthPeriod} + ${period}`,
  );

  // 7) Histórico de ventas SINTÉTICO (sales_history) — GENERADOR PARAMETRIZADO
  //    (Lote B2 — artefacto metodológico, no "data bonita"). El histórico
  //    anterior (~6 meses, sin correlación con el calendario peruano) hacía
  //    que el backtest CON contexto exógeno saliera LEVEMENTE PEOR que sin
  //    contexto (-0.55%) — la tesis defiende el forecast contextual como su
  //    aporte central, así que este generador tenía que dejar de ser
  //    cosmético y pasar a ser un artefacto auditable por el jurado.
  //
  // ============================================================================
  // MODELO GENERATIVO (por plato × día):
  //
  //   qty = round( baseQty(plato)
  //                × weekdayMultiplier(día)   -- estacionalidad semanal
  //                × eventUplift(día)         -- feriados/eventos gastronómicos
  //                × paydayUplift(día)        -- quincena / fin de mes
  //                × (1 + gaussianNoise) )
  //
  // - baseQty(plato): igual que antes de este lote — randInt(2,9) escalado
  //   por la popularidad relativa del plato (DISH_WEIGHTS), para que el
  //   histórico sea coherente con la mezcla no uniforme de ventas.
  // - weekdayMultiplier: constantes nombradas en WEEKDAY_MULTIPLIER. Lunes es
  //   el día más flojo por lejos (coincide con OPEN_DAYS/BUSINESS_HOURS —
  //   cerrado para walk-ins), pero NO es cero exacto — ver "AJUSTE
  //   DOCUMENTADO" debajo de la tabla, es una corrección deliberada, no un
  //   descuido.
  // - eventUplift/paydayUplift: fechas y nombres copiados TAL CUAL de
  //   `team-core-ai/app/forecasting/features/calendar.py` (leído SOLO como
  //   referencia — este archivo no importa/ejecuta Python). Los feriados
  //   OFICIALES (`holidays.PE`) se excluyen a propósito: el propio docstring
  //   de `calendar.py` documenta que la mayoría no mueve específicamente la
  //   demanda de un restaurante; los que sí (Fiestas Patrias, Navidad...) ya
  //   están en el calendario gastronómico curado de abajo.
  // - gaussianNoise: Box-Muller con la MISMA PRNG determinista `rnd()` que
  //   usa el resto de este seed (nunca `Math.random()`) — reproducible:
  //   correr el seed dos veces el mismo día produce EXACTAMENTE la misma data.
  //
  // TRANSPARENCIA (objeción del jurado — "usted diseñó la correlación que
  // después midió"): cada constante de abajo es NOMBRADA y trae una
  // justificación de una línea. Ninguna magnitud es caricaturesca (la más
  // alta es 1.8×, Fiestas Patrias); los feriados de fin de año son una CAÍDA
  // documentada (las familias cenan en casa), no "todo para arriba" — esa
  // asimetría es justo lo que hace la simulación defendible. `sales_history`
  // NUNCA se presenta como data real: este bloque, el docstring de arriba de
  // este archivo y `specs/e08/HU-08-08-accuracy.spec.md` lo dicen explícito.
  // ============================================================================

  // --- estacionalidad semanal ---------------------------------------------
  // Índice = Date#getUTCDay() del día LOCAL Lima (0=dom..6=sáb). Motif es un
  // restobar-karaoke: almuerzos flojos entre semana, arranca jueves, pico
  // viernes/sábado noche, domingo almuerzo familiar.
  //
  // AJUSTE DOCUMENTADO (Lote B2 — primera corrida real del experimento):
  // la primera versión de este generador ponía Lunes en `null` (CERRADO,
  // cero filas — coincide con OPEN_DAYS/BUSINESS_HOURS de más arriba). Al
  // correr el backtest real (`POST /forecasting/run`) el modelo salía PEOR
  // que el baseline SeasonalNaive. Investigando la causa: NO era que el
  // contexto exógeno no ayudara (`model_smape` SÍ salía < `model_smape_no_
  // context`, la comparativa que le importa a la tesis) — el problema era un
  // artefacto de la métrica SMAPE (`forecast-validation.util.ts` /
  // `app/metrics.py`): cuando el real es EXACTAMENTE 0, cualquier predicción
  // no-exactamente-cero anota el 200% (el máximo posible) sin importar la
  // magnitud — y LightGBM (a diferencia de SeasonalNaive, que copia el mismo
  // lunes de la semana anterior y por eso SIEMPRE acierta el 0 exacto) casi
  // nunca predice un 0.0 literal. Con 2 lunes exactos dentro de un holdout de
  // 14 días, ese artefacto por sí solo explica gran parte del salto de SMAPE.
  // Corrección: Lunes pasa a ser el día más flojo por MUCHO (no cero) —
  // representa actividad residual real y plausible (eventos privados /
  // catering, el local no recibe público en general) y evita la patología de
  // la métrica sin inventar una correlación nueva ni tocar los uplifts que
  // sí son el objeto de estudio.
  const WEEKDAY_MULTIPLIER: Record<number, number> = {
    0: 1.15, // domingo — almuerzo familiar
    1: 0.15, // lunes — sin público general; actividad residual (eventos privados/catering)
    2: 0.85, // martes — el día más flojo CON público
    3: 0.9, // miércoles
    4: 1.05, // jueves — arranca el pull de karaoke
    5: 1.35, // viernes — noche de karaoke
    6: 1.45, // sábado — pico de la semana
  };

  // --- calendario gastronómico (uplift multiplicativo) --------------------
  // Magnitudes conservadoras, documentadas para el capítulo de metodología —
  // NO ajustadas a ningún export POS real (Motif no tiene histórico real
  // mayor a unas semanas en producción).
  const FIESTAS_PATRIAS_UPLIFT = 1.8; // 28-29 jul — las fechas patrias son, según reportes anecdóticos de restobares limeños, la semana más fuerte del año (asunción conservadora de la simulación).
  const DIA_DE_LA_MADRE_UPLIFT = 1.6; // 2º domingo de mayo — ampliamente citado como el día más fuerte del año para restaurantes en Perú.
  const DIA_DEL_CEVICHE_UPLIFT = 1.6; // 28 jun — temáticamente central para una carta de cevichería (Ceviche Clásico/Mixto son "Stars" del menu engineering).
  const DIA_DEL_PADRE_UPLIFT = 1.3; // 3º domingo de junio — salida familiar, uplift menor que el Día de la Madre.
  const SAN_VALENTIN_UPLIFT = 1.4; // 14 feb — noche de pareja, encaja con el perfil bar/karaoke del local.
  const DIA_DEL_PISCO_SOUR_UPLIFT = 1.35; // 2º sábado de febrero — promociones de bar de pisco.
  const HALLOWEEN_CRIOLLA_UPLIFT = 1.3; // 31 oct — Halloween + Canción Criolla, noche de disfraces/bar.
  // Feriados de fin de año: CAÍDA documentada (las familias cenan en casa) —
  // asimetría honesta, no "todo para arriba" (lo que volvería la simulación
  // caricaturesca).
  const NOCHEBUENA_DIP = 0.55; // 24 dic — cena familiar en casa.
  const NAVIDAD_DIP = 0.7; // 25 dic — almuerzo familiar, servicio de noche flojo.
  const NOCHEVIEJA_DIP = 0.5; // 31 dic — fiestas de casa, no restobares.
  const ANO_NUEVO_DIP = 0.75; // 1 ene — día de recuperación lento.

  // --- quincena / fin de mes (uplift) --------------------------------------
  const QUINCENA_DAY = 15;
  const PAYDAY_WINDOW_RADIUS_DAYS = 1; // mismo radio que calendar.py::_PAYDAY_WINDOW_RADIUS_DAYS
  const QUINCENA_UPLIFT = 1.15; // día 14-16 — impulso modesto de sueldo quincenal.
  const FIN_DE_MES_UPLIFT = 1.12; // último día del mes ±1.

  // --- ruido gaussiano ------------------------------------------------------
  // Desvío estándar relativo del ruido multiplicativo aplicado a cada
  // plato/día. 12%: suficientemente grande para que un modelo naive
  // (lag/día-de-semana) no pueda "memorizar" perfectamente la señal de
  // calendario (lo que volvería sin sentido la comparativa con/sin
  // contexto), y suficientemente chico para que los multiplicadores de
  // arriba sigan siendo la señal dominante.
  const GAUSSIAN_NOISE_STD = 0.12;

  /** N-ésimo día-de-semana del mes (mirror de calendar.py::_nth_weekday_of_month).
   *  `weekday` sigue la convención de Date#getUTCDay() (0=dom..6=sáb); `n` es 1-based. */
  function nthWeekdayOfMonth(
    year: number,
    monthIdx0: number,
    weekday: number,
    n: number,
  ): { month: number; day: number } {
    const firstDow = new Date(Date.UTC(year, monthIdx0, 1)).getUTCDay();
    const daysUntil = (weekday - firstDow + 7) % 7;
    return { month: monthIdx0, day: 1 + daysUntil + (n - 1) * 7 };
  }

  type GastroEvent = { uplift: number; label: string };

  /** Calendario gastronómico curado de UN año — fechas/nombres copiados TAL
   *  CUAL de `team-core-ai/app/forecasting/features/calendar.py::
   *  _gastro_events_for_year` (referencia de solo lectura). Clave 'MM-DD'
   *  (el año se resuelve aparte, igual que el resto de este generador). */
  function gastroEventsForYear(year: number): Map<string, GastroEvent> {
    const SAT = 6;
    const SUN = 0;
    const mmdd = (monthIdx0: number, day: number): string =>
      `${String(monthIdx0 + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const pisco = nthWeekdayOfMonth(year, 1, SAT, 1); // febrero
    const madre = nthWeekdayOfMonth(year, 4, SUN, 2); // mayo
    const padre = nthWeekdayOfMonth(year, 5, SUN, 3); // junio
    return new Map<string, GastroEvent>([
      [
        mmdd(pisco.month, pisco.day),
        { uplift: DIA_DEL_PISCO_SOUR_UPLIFT, label: 'Día del Pisco Sour' },
      ],
      [mmdd(1, 14), { uplift: SAN_VALENTIN_UPLIFT, label: 'San Valentín' }],
      [
        mmdd(madre.month, madre.day),
        { uplift: DIA_DE_LA_MADRE_UPLIFT, label: 'Día de la Madre' },
      ],
      [
        mmdd(padre.month, padre.day),
        { uplift: DIA_DEL_PADRE_UPLIFT, label: 'Día del Padre' },
      ],
      [
        mmdd(5, 28),
        { uplift: DIA_DEL_CEVICHE_UPLIFT, label: 'Día del Ceviche' },
      ],
      [
        mmdd(6, 28),
        { uplift: FIESTAS_PATRIAS_UPLIFT, label: 'Fiestas Patrias' },
      ],
      [
        mmdd(6, 29),
        { uplift: FIESTAS_PATRIAS_UPLIFT, label: 'Fiestas Patrias' },
      ],
      [
        mmdd(9, 31),
        {
          uplift: HALLOWEEN_CRIOLLA_UPLIFT,
          label: 'Halloween / Día de la Canción Criolla',
        },
      ],
      [mmdd(11, 24), { uplift: NOCHEBUENA_DIP, label: 'Nochebuena' }],
      [mmdd(11, 25), { uplift: NAVIDAD_DIP, label: 'Navidad' }],
      [mmdd(11, 31), { uplift: NOCHEVIEJA_DIP, label: 'Nochevieja' }],
      [mmdd(0, 1), { uplift: ANO_NUEVO_DIP, label: 'Año Nuevo' }],
    ]);
  }
  // Cache por año (el generador recorre 18 meses ⇒ a lo sumo 3 años distintos).
  const gastroEventsByYear = new Map<number, Map<string, GastroEvent>>();
  function gastroEventFor(localDay: Date): GastroEvent | undefined {
    const year = localDay.getUTCFullYear();
    let events = gastroEventsByYear.get(year);
    if (!events) {
      events = gastroEventsForYear(year);
      gastroEventsByYear.set(year, events);
    }
    const mmdd = `${String(localDay.getUTCMonth() + 1).padStart(2, '0')}-${String(localDay.getUTCDate()).padStart(2, '0')}`;
    return events.get(mmdd);
  }

  /** Uplift de quincena/fin de mes para un día LOCAL (mirror de
   *  calendar.py::_merge_payday_window, radio ±1 día). Contempla el fin de
   *  mes del mes ANTERIOR (p. ej. 31-dic → 1-ene sigue en ventana). */
  function paydayUplift(localDay: Date): number {
    const t = localDay.getTime();
    const y = localDay.getUTCFullYear();
    const m = localDay.getUTCMonth();
    const within = (anchorMs: number): boolean =>
      Math.abs(t - anchorMs) <= PAYDAY_WINDOW_RADIUS_DAYS * MS_PER_DAY;
    const quincenaAnchor = Date.UTC(y, m, QUINCENA_DAY);
    const finDeMesAnchor = Date.UTC(y, m + 1, 0); // último día de ESTE mes
    const finDeMesPrevAnchor = Date.UTC(y, m, 0); // último día del mes ANTERIOR
    if (within(quincenaAnchor)) return QUINCENA_UPLIFT;
    if (within(finDeMesAnchor) || within(finDeMesPrevAnchor))
      return FIN_DE_MES_UPLIFT;
    return 1;
  }

  /** Muestra N(0, stdDev) vía Box-Muller, usando la MISMA PRNG determinista
   *  `rnd()` (nunca Math.random()) — necesario para reproducibilidad exacta. */
  function gaussianNoise(stdDev: number): number {
    const u1 = Math.max(rnd(), Number.EPSILON); // evita log(0)
    const u2 = rnd();
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return z0 * stdDev;
  }

  /** 'YYYY-MM-DD' de un día LOCAL Lima (mismo shape que target_date/sold_on
   *  bucketing en `ForecastingService.dailyTotals`). */
  function limaDateKey(localDay: Date): string {
    const y = localDay.getUTCFullYear();
    const m = String(localDay.getUTCMonth() + 1).padStart(2, '0');
    const d = String(localDay.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // Non-uniform history: the average weight per dish is DISH_WEIGHT_TOTAL / N = 10.
  // A dish's baseQty is scaled by (weight/avgWeight) so popular dishes accumulate
  // higher historical sales — matching the real-sales non-uniform mix and producing
  // coherent forecasting shopping suggestions.
  const HIST_AVG_WEIGHT = DISH_WEIGHT_TOTAL / DISH_WEIGHTS.length; // 10

  // --- ventana del histórico: 18 meses terminando AYER ---------------------
  // `sales_history` NUNCA incluye HOY: las ventas de hoy y de los últimos 7
  // días son ventas REALES (Order→Sale, paso 8) — una fuente independiente,
  // no una continuación del histórico sintético.
  const HISTORY_MONTHS = 18;
  const yesterday = new Date(today.getTime() - MS_PER_DAY);
  const yesterdayLocal = new Date(
    yesterday.getTime() + LIMA_OFFSET_MIN * MS_PER_MINUTE,
  );
  const historyStartLocalMs = Date.UTC(
    yesterdayLocal.getUTCFullYear(),
    yesterdayLocal.getUTCMonth() - HISTORY_MONTHS,
    yesterdayLocal.getUTCDate(),
  );
  const historyStart = new Date(
    historyStartLocalMs - LIMA_OFFSET_MIN * MS_PER_MINUTE,
  );
  const totalHistoryDays =
    Math.round((yesterday.getTime() - historyStart.getTime()) / MS_PER_DAY) + 1;

  const historyRowsData: Prisma.SalesHistoryCreateManyInput[] = [];
  // 'YYYY-MM-DD' (Lima) → Σ qty de todos los platos ese día. Reusado por el
  // paso 7e (ForecastRun históricas para /forecasting/accuracy) para no
  // recalcular la demanda real dos veces.
  const dailyActualTotal = new Map<string, number>();
  let daysWithSales = 0;

  for (
    let ms = historyStart.getTime();
    ms <= yesterday.getTime();
    ms += MS_PER_DAY
  ) {
    const soldOn = new Date(ms);
    const localDay = new Date(ms + LIMA_OFFSET_MIN * MS_PER_MINUTE);
    const dow = localDay.getUTCDay();
    // `WEEKDAY_MULTIPLIER` cubre las 7 claves (0-6) — `?? 1` es solo defensa
    // de tipos, nunca se ejerce en la práctica.
    const weekdayMult = WEEKDAY_MULTIPLIER[dow] ?? 1;

    const eventUplift = gastroEventFor(localDay)?.uplift ?? 1;
    const payUplift = paydayUplift(localDay);
    const dateKey = limaDateKey(localDay);
    let dayTotal = 0;

    for (let dishIdx = 0; dishIdx < menuItems.length; dishIdx++) {
      const mi = menuItems[dishIdx];
      if (!mi) continue;
      // Popularity-aware skip: rare dishes appear fewer days than popular ones.
      // skipThreshold = (weight/total) × 5 → inclusion rates:
      //   Ceviche Mixto (18): 90% | Lomo (17): 85% | Pisco Sour (12): 60%
      //   Arroz Mariscos (6): 30% | Pulpo al Olivo (3): 15% | Dogs (4): 20%
      const weight = DISH_WEIGHTS[dishIdx] ?? HIST_AVG_WEIGHT;
      const skipThreshold = (weight / DISH_WEIGHT_TOTAL) * 5;
      if (rnd() > skipThreshold) continue;

      // Scale quantity by relative popularity (vs the average weight of 10).
      const popularityScale = weight / HIST_AVG_WEIGHT;
      const baseQty = Math.max(1, Math.round(randInt(2, 9) * popularityScale));
      const noiseFactor = 1 + gaussianNoise(GAUSSIAN_NOISE_STD);
      const qty = Math.max(
        1,
        Math.round(
          baseQty * weekdayMult * eventUplift * payUplift * noiseFactor,
        ),
      );

      const unitPrice = mi.price;
      const total = unitPrice.mul(qty);
      historyRowsData.push({
        tenantId: TENANT_ID,
        soldOn,
        dishName: mi.name,
        menuItemId: mi.id,
        qty,
        unitPrice,
        total,
        externalRef: `synthetic-${dateKey}-${mi.id.slice(0, 8)}`,
      });
      dayTotal += qty;
    }

    if (dayTotal > 0) {
      dailyActualTotal.set(dateKey, dayTotal);
      daysWithSales++;
    }
  }

  // Batch insert — createMany en chunks en vez de miles de `create` uno-a-uno
  // (18 meses × 10 platos ≈ varios miles de filas; uno-a-uno sería lento).
  const CREATE_MANY_CHUNK = 2000;
  for (let i = 0; i < historyRowsData.length; i += CREATE_MANY_CHUNK) {
    await prisma.salesHistory.createMany({
      data: historyRowsData.slice(i, i + CREATE_MANY_CHUNK),
    });
  }
  console.log(
    `  ✓ ${historyRowsData.length} filas de histórico SINTÉTICO ` +
      `(${HISTORY_MONTHS} meses, ${totalHistoryDays} días, ${daysWithSales} ` +
      `con ventas — RNG determinista, ver bloque "MODELO GENERATIVO")`,
  );

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
    // Series de 6 meses que TERMINAN en el unitCost actual de cada insumo
    // (índice 0=más antiguo ~-6meses, índice 5=más reciente ≈ unitCost actual).
    // Lenguado: tendencia alcista gradual → 40 actual.
    // Pulpo/Camarones: corrección a la baja desde precios previos sobreestimados;
    //   serie volátil terminando en precio real de distribuidor Lima 2025.
    // Lomo de res: fluctuación razonable terminando en 32 (precio mayorista).
    const priceSeriesByName: Record<string, number[]> = {
      'Pescado fresco (lenguado)': [34, 36, 37, 38, 39, 40],
      Pulpo: [26, 24, 28, 26, 30, 30],
      Camarones: [28, 30, 31, 32, 31, 33],
      'Lomo de res': [27, 29, 30, 31, 30, 32],
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
  // `observations`/`spanDays`/`dataQuality` reflejan el histórico REAL recién
  // generado en el paso 7 (18 meses ⇒ spanDays > GOOD_MIN_DAYS=365 de
  // `sales-aggregation.util.ts` ⇒ 'good', ya no 'few_shot').
  {
    const forecastStart = new Date(today.getTime() + MS_PER_DAY); // mañana Lima
    const points = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(forecastStart.getTime() + i * MS_PER_DAY);
      const localD = new Date(d.getTime() + LIMA_OFFSET_MIN * MS_PER_MINUTE);
      const ds = limaDateKey(localD);
      // Estacionalidad semanal: sábado (dow=6) y domingo (dow=0) venden ~40% más.
      const dow = localD.getUTCDay();
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
        observations: daysWithSales, // días con al menos una venta en el histórico sintético
        spanDays: totalHistoryDays,
        dataQuality: 'good', // 18 meses > GOOD_MIN_DAYS=365
        points: points as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });
    console.log(
      `  ✓ ForecastRun completada sembrada (id=${forecastRun.id.slice(0, 8)}, ` +
        `horizon=14, yhat_total=${points.reduce((s, p) => s + p.yhat, 0)} platos)`,
    );
  }

  // 7e) ForecastRun HISTÓRICAS (Lote B2) — para que GET /forecasting/accuracy
  // (HU-08-08) tenga fechas YA TRANSCURRIDAS que comparar contra `sales_history`.
  // Antes de este lote, sales_history quedaba congelado ~8 días antes de "hoy" y
  // ninguna corrida sembrada tenía target_date <= último día con ventas, así que
  // el endpoint siempre respondía `needsMoreData:true` (documentado como
  // limitación conocida en `specs/e08/HU-08-08-accuracy.spec.md`). Ahora que el
  // histórico llega hasta AYER (paso 7), se siembran DOS corridas `completed`
  // "pasadas" cuyos `points` caen dentro de esa ventana ya transcurrida:
  //   - Run A (hace ~15 días): horizon=14, predice los 14 días que terminan AYER.
  //   - Run B (hace ~8 días): horizon=14, re-predice los últimos 7 días
  //     transcurridos (+7 días aún futuros) — el merge multi-corrida de
  //     `getAccuracy` hace que B (más reciente) GANE esos 7 días solapados
  //     sobre A, exactamente el escenario que documenta el spec.
  // Los `yhat` se derivan de la demanda REAL simulada (`dailyActualTotal`,
  // calculada en el paso 7) más un error gaussiano realista — nunca son
  // idénticos al real (evita un SMAPE ≈0% que "huela a trampa"). Si algún día
  // igual queda con `actual=0` (caso borde: los 10 platos se salteron ese
  // día), se predice 0 exacto en vez de aplicar el error — evita el 200% de
  // SMAPE que penaliza CUALQUIER predicción no-cero contra un real
  // exactamente 0 (ver el "AJUSTE DOCUMENTADO" en el paso 7, mismo motivo por
  // el que el lunes dejó de ser cero exacto).
  {
    const HIST_RUN_ERROR_STD = 0.1; // desvío del error simulado del pronóstico — realista (SMAPE resultante de un dígito alto/dos bajos), sin ser una trampa.
    const BAND_LO_FACTOR = 0.82;
    const BAND_HI_FACTOR = 1.18;

    // Fallback para fechas del horizonte aún futuras al momento del seed
    // (solo aplica a Run B): promedio de los últimos 14 días CON ventas —
    // nunca se compara contra `sales_history` (accuracy solo mira
    // target_date <= último día con ventas), solo debe ser plausible si
    // alguien consulta /forecasting/predictions.
    const recentTotals = [...dailyActualTotal.values()].slice(-14);
    const recentAvgDailyTotal = recentTotals.length
      ? recentTotals.reduce((s, v) => s + v, 0) / recentTotals.length
      : 42;

    type SeedPoint = {
      target_date: string;
      yhat: number;
      yhat_lo: number;
      yhat_hi: number;
    };

    function buildHistoricalPoints(
      forecastStart: Date,
      horizon: number,
    ): SeedPoint[] {
      return Array.from({ length: horizon }, (_, i) => {
        const d = new Date(forecastStart.getTime() + i * MS_PER_DAY);
        const localD = new Date(d.getTime() + LIMA_OFFSET_MIN * MS_PER_MINUTE);
        const dateKey = limaDateKey(localD);
        const isElapsed = d.getTime() <= yesterday.getTime();

        let yhat: number;
        if (isElapsed) {
          const actual = dailyActualTotal.get(dateKey) ?? 0; // 0 = lunes cerrado, no "sin dato"
          if (actual === 0) {
            yhat = 0; // un modelo real predice ~0 en un día siempre cerrado
          } else {
            const errorFactor = 1 + gaussianNoise(HIST_RUN_ERROR_STD);
            yhat = Math.max(0, Math.round(actual * errorFactor));
          }
        } else {
          // Aún no transcurre — heurística simple (nivel reciente × estacionalidad
          // semanal), no comparada por /accuracy.
          const dow = localD.getUTCDay();
          const weekdayMult = WEEKDAY_MULTIPLIER[dow] ?? 1;
          yhat = Math.round(recentAvgDailyTotal * weekdayMult);
        }

        return {
          target_date: dateKey,
          yhat,
          yhat_lo: Math.round(yhat * BAND_LO_FACTOR),
          yhat_hi: Math.round(yhat * BAND_HI_FACTOR),
        };
      });
    }

    const HORIZON = 14;
    // Run A: completedAt hace 15 días ⇒ su horizonte de 14 días (empieza al día
    // siguiente) cae EXACTAMENTE en [hoy-14 .. hoy-1] — el histórico completo
    // transcurrido, alineado con `yesterday` (último día con `sales_history`).
    const runACompletedAt = new Date(today.getTime() - 15 * MS_PER_DAY);
    const runAStart = new Date(runACompletedAt.getTime() + MS_PER_DAY);
    const runAPoints = buildHistoricalPoints(runAStart, HORIZON);

    // Run B: completedAt hace 8 días ⇒ re-predice los últimos 7 días
    // transcurridos (gana sobre Run A ahí) + 7 días aún futuros.
    const runBCompletedAt = new Date(today.getTime() - 8 * MS_PER_DAY);
    const runBStart = new Date(runBCompletedAt.getTime() + MS_PER_DAY);
    const runBPoints = buildHistoricalPoints(runBStart, HORIZON);

    const historicalRuns = [
      { completedAt: runACompletedAt, points: runAPoints, label: 'A (-15d)' },
      { completedAt: runBCompletedAt, points: runBPoints, label: 'B (-8d)' },
    ];

    for (const run of historicalRuns) {
      const created = await prisma.forecastRun.create({
        data: {
          tenantId: TENANT_ID,
          scope: 'total',
          horizon: HORIZON,
          engine: 'ml',
          status: 'completed',
          model: 'LightGBM',
          baseline: 'SeasonalNaive',
          observations: daysWithSales,
          spanDays: totalHistoryDays,
          dataQuality: 'good',
          points: run.points as unknown as Prisma.InputJsonValue,
          contextStatus: 'full',
          createdAt: run.completedAt,
          completedAt: run.completedAt,
        },
      });
      console.log(
        `  ✓ ForecastRun histórica sembrada [${run.label}] (id=${created.id.slice(0, 8)}) ` +
          `para GET /forecasting/accuracy`,
      );
    }
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
      // Non-uniform selection: popular dishes (Stars/Plowhorses) are chosen more
      // often than Puzzles/Dogs, mirroring real restobar ordering patterns.
      // weightedPickDishIndex() samples from DISH_WEIGHTS proportionally.
      let idx = weightedPickDishIndex();
      let guard = 0;
      while (used.has(idx) && guard++ < 10) idx = weightedPickDishIndex();
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

  // 8c) Ventas del ÚLTIMO MES COMPLETO (para costeo con márgenes realistas y
  //     para alimentar prime-cost + menu-engineering con datos de junio 2026).
  //
  // CIF TOTAL (junio): S/46,400 (incluyendo sueldos planilla S/35,700).
  // Note: revenue for prime-cost includes step-8b June 25-30 tickets too (~S/16k),
  // so total June revenue ≈ S/137,800 (step 8c ≈ S/121,276 + step 8b June ≈ S/16,570).
  // cifPerUnit ≈ S/46,400 / 3,500 ≈ S/13.3 (total June dish-units step 8b+8c).
  // Per-dish net margin = price − foodCost − cifPerUnit:
  //   Ceviche Clásico: S/42 − S/13.32 − S/13.3 = S/15.38 ✓
  //   Chicha Morada:   S/12 − S/ 3.00 − S/13.3 = −S/4.30 (thin but realistic:
  //   cheap drink subsidised by premium dishes — good thesis talking point).
  //
  // PRIME COST objetivo (junio, período 2026-06):
  //   revenue ≈ S/137,846 · foodCost% ≈ 30.2% · laborCost% ≈ 25.9%
  //   → primeCost% ≈ 56.1% (status 'good')
  //
  // Estos records son Sale.status='issued' con issuedAt dentro de lastMonthPeriod,
  // que es exactamente lo que unitsSoldByDish() filtra. Son registros REALES
  // (Order → OrderItem → Sale → Payment), no entradas de salesHistory.
  {
    let lastMonthSalesCount = 0;
    let lastMonthRevenue = new Prisma.Decimal(0);

    for (let day = 1; day <= daysInLastMonth; day++) {
      // Lima midnight for this day = Date.UTC with 0-indexed month (lastMonthNum-1)
      // at 05:00 UTC (Lima is UTC-5, so 00:00 Lima = 05:00 UTC).
      const dayStart = new Date(
        Date.UTC(lastMonthYear, lastMonthNum - 1, day, 5, 0, 0),
      );
      // Weekend boost: sábados/domingos venden ~20% más (realismo estacional).
      const dow = new Date(
        dayStart.getTime() + LIMA_OFFSET_MIN * MS_PER_MINUTE,
      ).getUTCDay();
      const isWeekend = dow === 0 || dow === 6;
      const dailyCount = isWeekend ? randInt(18, 22) : randInt(14, 18);

      for (let i = 0; i < dailyCount; i++) {
        // Horario realista de restaurante: mediodía–medianoche Lima.
        const hour = randInt(12, 23);
        const minute = randInt(0, 59);
        const issuedAt = atLimaTime(dayStart, hour, minute);
        const docType: 'boleta' | 'factura' =
          rnd() > 0.88 ? 'factura' : 'boleta';
        const methods: (typeof PAYMENT_METHODS)[number][] = [
          pick(PAYMENT_METHODS),
        ];
        const total = await emitSale({
          issuedAt,
          tableId: pick(tableIds),
          docType,
          lines: buildLines(),
          methods,
        });
        lastMonthSalesCount++;
        lastMonthRevenue = lastMonthRevenue.add(total);
      }
    }
    console.log(
      `  ✓ ${lastMonthSalesCount} ventas del mes anterior (${lastMonthPeriod}, ` +
        `S/ ${lastMonthRevenue.toFixed(2)})`,
    );
  }

  // 8d) Cierre Z histórico — bugfix 2026-07-02 (QA scout: "turno zombie" abierto
  // desde el 1 de junio acumulando S/144,884).
  //
  // ROOT CAUSE: BillingService.aggregateOpenWindow() (src/billing/billing.service.ts)
  // treats the "open shift" window as everything since the LAST cash_closes row
  // (or all-time if none exists). This seed created real Sale rows spanning the
  // previous ~37 days (steps 8b + 8c) but never inserted a closing cash_closes
  // row, so the very first historical sale became the start of a shift that
  // never closes — exactly the zombie the QA scout found.
  //
  // FIX: close that historical window explicitly with ONE immutable cash_closes
  // row (closedAt = today's Lima midnight), replicating aggregateOpenWindow()'s
  // exact aggregation (Σ sale.total for issued sales, Σ payment.amount per
  // method, issued/void counts) so the numbers on the row are internally
  // consistent with what the app itself would have computed. After this, the
  // ONLY open shift left is today's (step 8a) — reasonable amounts (~S/1-2k).
  {
    const historicalSales = await prisma.sale.findMany({
      where: { tenantId: TENANT_ID, issuedAt: { lt: today } },
      include: { payments: true },
      orderBy: { issuedAt: 'asc' },
    });

    if (historicalSales.length > 0) {
      const byMethod: Record<(typeof PAYMENT_METHODS)[number], Prisma.Decimal> =
        {
          cash: new Prisma.Decimal(0),
          card: new Prisma.Decimal(0),
          yape: new Prisma.Decimal(0),
          plin: new Prisma.Decimal(0),
        };
      let totalGross = new Prisma.Decimal(0);
      let salesCount = 0;
      let voidCount = 0;
      const firstIssuedAt = historicalSales[0].issuedAt;

      for (const sale of historicalSales) {
        if (sale.status === 'void') {
          voidCount++;
          continue;
        }
        salesCount++;
        totalGross = totalGross.add(sale.total);
        for (const payment of sale.payments) {
          if (isPaymentMethod(payment.method)) {
            byMethod[payment.method] = byMethod[payment.method].add(
              payment.amount,
            );
          }
        }
      }

      await prisma.cashClose.create({
        data: {
          tenantId: TENANT_ID,
          openedAt: firstIssuedAt,
          closedAt: today,
          salesCount,
          voidCount,
          totalGross,
          byMethod: {
            cash: byMethod.cash.toFixed(2),
            card: byMethod.card.toFixed(2),
            yape: byMethod.yape.toFixed(2),
            plin: byMethod.plin.toFixed(2),
          } as unknown as Prisma.InputJsonValue,
        },
      });

      console.log(
        `  ✓ cierre Z histórico: ${salesCount} ventas (S/ ${totalGross.toFixed(2)}) ` +
          `cerradas hasta hoy — el turno abierto actual cubre SOLO hoy`,
      );
    }
  }

  // 9) Órdenes "vivas" (cuentas abiertas) en las mesas ocupadas, SIN Sale.
  // Tiempos realistas relativos a AHORA para que el mapa muestre una MEZCLA de
  // estados (no un mar de "demorada"): mesas recién sentadas, una demorada (>2h)
  // y una pidiendo la cuenta (por cobrar). El front marca demorada con umbral 2h.
  // Bugfix 2026-07-02 (QA scout: mesas "ocupadas" 5-8h atrás inflaban la espera
  // del KDS a 286 min). Todas las franjas quedan por debajo de 30 min — mezcla
  // realista de estados operativos SIN disparar el umbral de "demorada" (2h) ni
  // ninguna espera irreal para una demo en vivo.
  const liveScenarios = [
    { minutesAgo: 6, status: 'sent_to_kitchen', bill: false }, // recién pidió
    { minutesAgo: 14, status: 'served', bill: false }, // comiendo
    { minutesAgo: 22, status: 'served', bill: false }, // terminando
    { minutesAgo: 27, status: 'served', bill: true }, // por cobrar
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
      const l = lines[li];
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
