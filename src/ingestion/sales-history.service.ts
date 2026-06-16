import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma/prisma.service';

// Cap defensivo de filas devueltas por la lista (verificación; no es el reporte
// agregado — los totales se calculan sobre TODA la ventana, no sobre la página).
const MAX_LIST_ROWS = 5000;

// America/Lima = UTC-5 fijo (sin DST). Offset en minutos (CLAUDE.md §6). El
// histórico se importa con timestamps UTC; la ventana por defecto ("hoy") se
// calcula en la zona del tenant. Lógica local (sin importar el módulo de E07).
const LIMA_OFFSET_MINUTES = -5 * 60;
const MS_PER_DAY = 24 * 60 * 60_000;

interface DateWindow {
  from: Date;
  to: Date;
}

/**
 * Resuelve la ventana del histórico. `from`/`to` (ISO con offset) se usan tal cual;
 * si faltan, se usa "hoy" en Lima (`from` = medianoche local, `to` = ahora). Exige
 * `from <= to` (si no, 400). Espeja `resolveWindow` de E07, inline para no acoplar
 * módulos (backend.md §3 — los módulos se comunican por interfaces, no por imports).
 */
function resolveWindow(
  fromIso: string | undefined,
  toIso: string | undefined,
  now: Date = new Date(),
): DateWindow {
  const localMs = now.getTime() + LIMA_OFFSET_MINUTES * 60_000;
  const localMidnightMs = Math.floor(localMs / MS_PER_DAY) * MS_PER_DAY;
  const startOfLimaToday = new Date(
    localMidnightMs - LIMA_OFFSET_MINUTES * 60_000,
  );
  const from = fromIso ? new Date(fromIso) : startOfLimaToday;
  const to = toIso ? new Date(toIso) : now;
  if (from.getTime() > to.getTime()) {
    throw new BadRequestException(
      'El rango es inválido: "from" debe ser <= "to"',
    );
  }
  return { from, to };
}

export interface SalesHistoryRow {
  soldOn: string;
  dishName: string;
  menuItemId: string | null;
  qty: number;
  unitPrice: string;
  total: string;
}
export interface SalesHistoryList {
  from: string;
  to: string;
  totalQty: number;
  totalRevenue: string;
  rows: SalesHistoryRow[];
}

@Injectable()
export class SalesHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * HU-11-03 · Lista y agrega el histórico importado en una ventana `?from=&to=`
   * (ISO; si faltan, "hoy" en la zona del tenant — espeja los reportes E07). Los
   * totales (`totalQty`, `totalRevenue`) se calculan sobre TODA la ventana; `rows`
   * se acota a MAX_LIST_ROWS (las más recientes) para verificación.
   */
  async list(
    tenantId: string,
    fromIso: string | undefined,
    toIso: string | undefined,
  ): Promise<SalesHistoryList> {
    const window = resolveWindow(fromIso, toIso);
    return this.prisma.runInTenant(tenantId, async (tx) => {
      const where: Prisma.SalesHistoryWhereInput = {
        soldOn: { gte: window.from, lte: window.to },
      };

      const agg = await tx.salesHistory.aggregate({
        where,
        _sum: { qty: true, total: true },
      });

      const rows = await tx.salesHistory.findMany({
        where,
        orderBy: [{ soldOn: 'desc' }, { id: 'asc' }],
        take: MAX_LIST_ROWS,
      });

      return {
        from: window.from.toISOString(),
        to: window.to.toISOString(),
        totalQty: agg._sum.qty ?? 0,
        totalRevenue: (agg._sum.total ?? new Prisma.Decimal(0)).toFixed(2),
        rows: rows.map((r) => ({
          soldOn: r.soldOn.toISOString(),
          dishName: r.dishName,
          menuItemId: r.menuItemId,
          qty: r.qty,
          unitPrice: r.unitPrice.toFixed(2),
          total: r.total.toFixed(2),
        })),
      };
    });
  }
}
