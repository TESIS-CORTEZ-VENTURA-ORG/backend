import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../platform/prisma/prisma.service';
import { parseCsv } from '../common/csv.util';

const MAX_IMPORT_ROWS = 20000;

// Campos canónicos de una fila del histórico de ventas.
type SalesField = 'date' | 'dish' | 'qty' | 'unitPrice' | 'total' | 'ref';

// Alias de cabecera (normalizada) → campo canónico. Soporta ES/EN.
const HEADER_ALIASES: Record<string, SalesField> = {
  date: 'date',
  fecha: 'date',
  dish: 'dish',
  plato: 'dish',
  nombre: 'dish',
  name: 'dish',
  qty: 'qty',
  cantidad: 'qty',
  quantity: 'qty',
  unitprice: 'unitPrice',
  unit_price: 'unitPrice',
  precio: 'unitPrice',
  preciounitario: 'unitPrice',
  price: 'unitPrice',
  total: 'total',
  monto: 'total',
  importe: 'total',
  ref: 'ref',
  externalref: 'ref',
  external_ref: 'ref',
  referencia: 'ref',
};
// `date` y `dish` siempre; además al menos uno de unitPrice/total (validado aparte).
const REQUIRED_FIELDS: SalesField[] = ['date', 'dish', 'qty'];

export interface ImportError {
  line: number;
  message: string;
}
export interface SalesImportReport {
  total: number;
  created: number;
  updated: number;
  failed: number;
  errors: ImportError[];
  dryRun: boolean;
}

// Fila ya validada y normalizada (lista para upsert).
interface ParsedSale {
  soldOn: Date;
  dishName: string;
  qty: number;
  unitPrice: Prisma.Decimal;
  total: Prisma.Decimal;
  externalRef: string | null;
}

function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita acentos
    .replace(/\s+/g, '');
}

// Acepta ISO 8601 (con/ sin offset) o YYYY-MM-DD (medianoche UTC). Devuelve null si
// no es parseable. Un YYYY-MM-DD se ancla a 00:00:00Z (sin ambigüedad de zona).
function parseSoldOn(raw: string): Date | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const d = new Date(`${raw}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Schema de la fila CRUDA (celdas como texto). qty entero > 0; precios ≥ 0.
const rawRowSchema = z.object({
  date: z.string().trim().min(1),
  dish: z.string().trim().min(1),
  qty: z.coerce.number().int().positive(),
  unitPrice: z.coerce.number().nonnegative().optional(),
  total: z.coerce.number().nonnegative().optional(),
  ref: z.string().trim().min(1).optional(),
});

@Injectable()
export class SalesHistoryImportService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * HU-11-03/04/05 · Importa histórico de ventas desde CSV. Valida cada fila
   * (fecha parseable, qty>0, precio≥0, duplicados en el archivo), enlaza el
   * `menuItemId` por match EXACTO de nombre con un plato activo (si no, null) e
   * importa de forma **idempotente**: upsert por `(tenantId, externalRef)` si la
   * fila trae `ref`, o por clave natural `(tenantId, soldOn, dishName, qty,
   * unitPrice)` si no. `dryRun=true` valida y NO escribe nada (HU-11-05).
   */
  async importCsv(
    tenantId: string,
    content: string,
    dryRun = false,
  ): Promise<SalesImportReport> {
    const records = parseCsv(content);
    if (records.length === 0) {
      throw new BadRequestException('El archivo está vacío');
    }

    // Mapea cabeceras → índice de columna (por nombre, no por posición).
    const colOf = new Map<SalesField, number>();
    records[0].cells.forEach((header, i) => {
      const field = HEADER_ALIASES[normalizeHeader(header)];
      if (field && !colOf.has(field)) {
        colOf.set(field, i);
      }
    });
    const missing = REQUIRED_FIELDS.filter((f) => !colOf.has(f));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Faltan columnas requeridas: ${missing.join(', ')}`,
      );
    }
    if (!colOf.has('unitPrice') && !colOf.has('total')) {
      throw new BadRequestException(
        'Falta columna de monto: se requiere "unitPrice"/"precio" o "total"',
      );
    }

    const dataRecords = records.slice(1);
    if (dataRecords.length > MAX_IMPORT_ROWS) {
      throw new BadRequestException(
        `El archivo excede el máximo de ${MAX_IMPORT_ROWS} filas`,
      );
    }

    const errors: ImportError[] = [];
    const valid: ParsedSale[] = [];
    const seenRefs = new Set<string>();
    const seenNaturalKeys = new Set<string>();

    for (const rec of dataRecords) {
      const raw: Record<string, string> = {};
      for (const [field, col] of colOf) {
        const value = (rec.cells[col] ?? '').trim();
        if (value !== '') {
          raw[field] = value;
        }
      }
      const parsed = rawRowSchema.safeParse(raw);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const field = issue.path.length ? `${String(issue.path[0])}: ` : '';
        errors.push({ line: rec.line, message: `${field}${issue.message}` });
        continue;
      }
      const data = parsed.data;

      const soldOn = parseSoldOn(data.date);
      if (!soldOn) {
        errors.push({
          line: rec.line,
          message: `date: fecha inválida (use ISO o YYYY-MM-DD): ${data.date}`,
        });
        continue;
      }
      if (data.unitPrice === undefined && data.total === undefined) {
        errors.push({
          line: rec.line,
          message: 'Falta el monto: indique unitPrice o total',
        });
        continue;
      }

      // Deriva el par precio/total: total = unitPrice·qty; unitPrice = total/qty.
      const qtyDec = new Prisma.Decimal(data.qty);
      const unitPrice =
        data.unitPrice !== undefined
          ? new Prisma.Decimal(data.unitPrice)
          : new Prisma.Decimal(data.total ?? 0).div(qtyDec);
      const total =
        data.total !== undefined
          ? new Prisma.Decimal(data.total)
          : unitPrice.mul(qtyDec);

      const externalRef = data.ref ?? null;

      // Dedup en el archivo: por ref si existe, si no por clave natural.
      if (externalRef !== null) {
        if (seenRefs.has(externalRef)) {
          errors.push({
            line: rec.line,
            message: `ref duplicada en el archivo: ${externalRef}`,
          });
          continue;
        }
        seenRefs.add(externalRef);
      } else {
        const natKey = naturalKey(soldOn, data.dish, data.qty, unitPrice);
        if (seenNaturalKeys.has(natKey)) {
          // Fila idéntica repetida en el mismo archivo → se omite (no es error).
          continue;
        }
        seenNaturalKeys.add(natKey);
      }

      valid.push({
        soldOn,
        dishName: data.dish,
        qty: data.qty,
        unitPrice: unitPrice.toDecimalPlaces(2),
        total: total.toDecimalPlaces(2),
        externalRef,
      });
    }

    let created = 0;
    let updated = 0;
    // HU-11-05 · dryRun: solo validación, no se escribe nada.
    if (!dryRun && valid.length > 0) {
      const result = await this.prisma.runInTenant(tenantId, async (tx) => {
        let c = 0;
        let u = 0;
        // Cache nombre de plato → menuItemId (activo) dentro de la transacción.
        const menuItemByName = new Map<string, string | null>();
        for (const row of valid) {
          const menuItemId = await this.resolveMenuItemId(
            tx,
            menuItemByName,
            row.dishName,
          );
          const existing = await this.findExisting(tx, tenantId, row);
          if (existing) {
            await tx.salesHistory.update({
              where: { id: existing.id },
              data: {
                soldOn: row.soldOn,
                dishName: row.dishName,
                menuItemId,
                qty: row.qty,
                unitPrice: row.unitPrice,
                total: row.total,
                externalRef: row.externalRef,
              },
            });
            u += 1;
          } else {
            await tx.salesHistory.create({
              data: {
                tenantId,
                soldOn: row.soldOn,
                dishName: row.dishName,
                menuItemId,
                qty: row.qty,
                unitPrice: row.unitPrice,
                total: row.total,
                externalRef: row.externalRef,
              },
            });
            c += 1;
          }
        }
        return { c, u };
      });
      created = result.c;
      updated = result.u;
    }

    return {
      total: dataRecords.length,
      created,
      updated,
      failed: errors.length,
      errors,
      dryRun,
    };
  }

  // Enlaza por match EXACTO de nombre con un plato ACTIVO (isActive + no borrado).
  // Si no hay match → null. Cachea el resultado por nombre.
  private async resolveMenuItemId(
    tx: Prisma.TransactionClient,
    cache: Map<string, string | null>,
    dishName: string,
  ): Promise<string | null> {
    const cached = cache.get(dishName);
    if (cached !== undefined) {
      return cached;
    }
    const item = await tx.menuItem.findFirst({
      where: { name: dishName, isActive: true, deletedAt: null },
      select: { id: true },
    });
    const id = item?.id ?? null;
    cache.set(dishName, id);
    return id;
  }

  // Idempotencia (HU-11-04): por (tenantId, externalRef) si hay ref; si no, por
  // clave natural (tenantId, soldOn, dishName, qty, unitPrice). RLS ya acota por
  // tenant, pero filtramos tenantId explícitamente por claridad.
  private async findExisting(
    tx: Prisma.TransactionClient,
    tenantId: string,
    row: ParsedSale,
  ): Promise<{ id: string } | null> {
    if (row.externalRef !== null) {
      return tx.salesHistory.findFirst({
        where: { tenantId, externalRef: row.externalRef },
        select: { id: true },
      });
    }
    return tx.salesHistory.findFirst({
      where: {
        tenantId,
        externalRef: null,
        soldOn: row.soldOn,
        dishName: row.dishName,
        qty: row.qty,
        unitPrice: row.unitPrice,
      },
      select: { id: true },
    });
  }
}

// Clave natural estable para dedup en archivo (sin ref). El instante se serializa
// en ISO para que dos formas equivalentes de la misma fecha colisionen.
function naturalKey(
  soldOn: Date,
  dishName: string,
  qty: number,
  unitPrice: Prisma.Decimal,
): string {
  return `${soldOn.toISOString()}|${dishName}|${qty}|${unitPrice.toFixed(2)}`;
}
