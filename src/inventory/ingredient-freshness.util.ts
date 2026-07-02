// Lote B4 · Vida útil de insumos (MVP SIN modelo de lotes/FEFO real). Lógica
// PURA (sin DB) que combina la cobertura por consumo (HU-05-11) con la vida
// útil restante del insumo — testeable sin mockear Prisma/`runInTenant`. La
// lectura del `shelfLifeDays`/`lastPurchaseAt` y el ensamblado del contrato
// quedan en `InventoryService.ingredientCoverage`.
//
// Regla de negocio central (validada con el usuario): la cobertura EFECTIVA es
// el MÍNIMO entre "cuánto dura el stock al ritmo de consumo" y "cuánto dura el
// stock antes de vencer" — nunca un promedio. Manda la restricción que se
// activa primero (cuello de botella), igual criterio que
// `forecasting/shelf-life-cap.util.ts` para las sugerencias de compra.
import { Prisma } from '@prisma/client';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Umbral "por vencer" (HU-05-11 Lote B4): ≤2 días de vida restante EN VALOR
// ABSOLUTO, o ≤30% de la vida útil TOTAL del insumo (shelfLifeDays) — lo que
// se cumpla primero. El segundo criterio evita que un insumo de vida útil muy
// corta (p. ej. 2 días) recién comprado ya aparezca en "por vencer" el mismo
// día (2 días restantes = 100% de su vida útil, NO ≤30%), mientras que un
// insumo de vida útil larga (p. ej. 180 días) sí avisa quedando ~54 días
// (30% de 180), mucho antes de que el umbral absoluto de 2 días tenga sentido.
const EXPIRING_SOON_ABS_DAYS = new Prisma.Decimal(2);
const EXPIRING_SOON_RATIO = new Prisma.Decimal('0.3');

export type FreshnessStatus = 'fresh' | 'expiring_soon' | 'expired' | null;

export interface FreshnessInput {
  /** Stock on-hand actual del insumo (Decimal-preciso). */
  stock: Prisma.Decimal;
  /** Consumo diario promedio (últimos 30 días, `type='sale'`). */
  avgDailyConsumption: Prisma.Decimal;
  /** Cobertura por consumo (`stock / avgDailyConsumption`); `null` si consumo=0. */
  daysLeft: Prisma.Decimal | null;
  /** Vida útil configurada del insumo (días). `null` = no perecible/sin configurar. */
  shelfLifeDays: number | null;
  /** Fecha del ÚLTIMO movimiento `purchase` del insumo (MVP sin lotes: única
   *  referencia de frescura posible — sin lotes no hay fecha de recepción por
   *  unidad física). `null` si nunca se registró una compra. */
  lastPurchaseAt: Date | null;
  /** Costo unitario del insumo (S/), para valorizar `atRiskQty`. */
  unitCost: Prisma.Decimal;
  /** Inyectable para tests deterministas; default = `new Date()`. */
  now?: Date;
}

export interface FreshnessView {
  lastPurchaseAt: string | null;
  estimatedExpiryAt: string | null;
  freshnessStatus: FreshnessStatus;
  effectiveCoverageDays: string | null;
  atRiskQty: string | null;
  atRiskCost: string | null;
}

/**
 * Combina cobertura por consumo + vida útil restante. Sin `shelfLifeDays`
 * configurado o sin ninguna compra registrada, NO se inventa una estimación:
 * todo lo relacionado a frescura vuelve `null` y `effectiveCoverageDays`
 * degrada al `daysLeft` de siempre (comportamiento HU-05-11 intacto).
 */
export function computeFreshness(input: FreshnessInput): FreshnessView {
  const {
    stock,
    avgDailyConsumption,
    daysLeft,
    shelfLifeDays,
    lastPurchaseAt,
    unitCost,
  } = input;
  const now = input.now ?? new Date();

  if (shelfLifeDays == null || lastPurchaseAt == null) {
    return {
      lastPurchaseAt: lastPurchaseAt ? lastPurchaseAt.toISOString() : null,
      estimatedExpiryAt: null,
      freshnessStatus: null,
      effectiveCoverageDays: daysLeft ? daysLeft.toFixed(1) : null,
      atRiskQty: null,
      atRiskCost: null,
    };
  }

  const estimatedExpiryAt = new Date(
    lastPurchaseAt.getTime() + shelfLifeDays * MS_PER_DAY,
  );

  // Días restantes hasta el vencimiento estimado; SIN clamp (puede ser
  // negativo → ya venció) para poder distinguir 'expired' de 'expiring_soon'.
  const remainingDaysRaw = new Prisma.Decimal(
    estimatedExpiryAt.getTime() - now.getTime(),
  ).div(MS_PER_DAY);

  // Clamp a 0 SOLO para la aritmética de consumo (no se puede "consumir"
  // durante días negativos).
  const remainingDaysClamped = Prisma.Decimal.max(remainingDaysRaw, 0);

  const shelfLifeDecimal = new Prisma.Decimal(shelfLifeDays);
  let freshnessStatus: FreshnessStatus;
  if (remainingDaysRaw.lte(0)) {
    freshnessStatus = 'expired';
  } else if (
    remainingDaysRaw.lte(EXPIRING_SOON_ABS_DAYS) ||
    remainingDaysRaw.lte(shelfLifeDecimal.mul(EXPIRING_SOON_RATIO))
  ) {
    freshnessStatus = 'expiring_soon';
  } else {
    freshnessStatus = 'fresh';
  }

  // Cobertura EFECTIVA = min(consumo, vida útil restante) — el cuello de
  // botella real. `daysLeft=null` (consumo=0) se trata como "infinito": la
  // vida útil restante es la única restricción que manda.
  const effectiveCoverageDays = daysLeft
    ? Prisma.Decimal.min(daysLeft, remainingDaysClamped)
    : remainingDaysClamped;

  // Stock que NO se alcanza a consumir antes de vencer, al ritmo actual:
  // atRiskQty = max(0, stock − avgDailyConsumption·remainingDays).
  const consumedBeforeExpiry = avgDailyConsumption.mul(remainingDaysClamped);
  const atRiskQty = Prisma.Decimal.max(stock.sub(consumedBeforeExpiry), 0);
  const atRiskCost = atRiskQty.mul(unitCost);

  return {
    lastPurchaseAt: lastPurchaseAt.toISOString(),
    estimatedExpiryAt: estimatedExpiryAt.toISOString(),
    freshnessStatus,
    effectiveCoverageDays: effectiveCoverageDays.toFixed(1),
    atRiskQty: atRiskQty.toFixed(3),
    atRiskCost: atRiskCost.toFixed(2),
  };
}
