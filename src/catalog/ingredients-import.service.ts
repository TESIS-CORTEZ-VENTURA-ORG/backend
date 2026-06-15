import { BadRequestException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../platform/prisma/prisma.service';
import { parseCsv } from '../common/csv.util';

const MAX_IMPORT_ROWS = 5000;

// Cada fila del CSV (las celdas llegan como texto → unitCost se coacciona).
const importRowSchema = z.object({
  sku: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1),
  type: z.string().trim().min(1),
  unit: z.string().trim().min(1),
  unitCost: z.coerce.number().nonnegative().optional(),
  category: z.string().trim().min(1).optional(),
});
type ImportRow = z.infer<typeof importRowSchema>;

// Alias de cabecera (normalizada) → campo canónico. Soporta ES/EN.
const HEADER_ALIASES: Record<string, keyof ImportRow> = {
  sku: 'sku',
  codigo: 'sku',
  name: 'name',
  nombre: 'name',
  type: 'type',
  tipo: 'type',
  unit: 'unit',
  unidad: 'unit',
  unitcost: 'unitCost',
  unit_cost: 'unitCost',
  costo: 'unitCost',
  cost: 'unitCost',
  category: 'category',
  categoria: 'category',
};
const REQUIRED_FIELDS: (keyof ImportRow)[] = ['sku', 'name', 'type', 'unit'];

export interface ImportError {
  line: number;
  message: string;
}
export interface ImportReport {
  total: number;
  created: number;
  updated: number;
  failed: number;
  errors: ImportError[];
}

function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita acentos
    .replace(/\s+/g, '');
}

@Injectable()
export class IngredientsImportService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * HU-02-02 · Importa insumos desde CSV. Valida cada fila (formato + duplicados
   * en el archivo), importa las válidas (upsert por SKU → idempotente/rerunnable)
   * y devuelve un reporte con la línea exacta de cada error.
   */
  async importCsv(tenantId: string, content: string): Promise<ImportReport> {
    const records = parseCsv(content);
    if (records.length === 0) {
      throw new BadRequestException('El archivo está vacío');
    }

    // Mapea cabeceras → índice de columna (por nombre, no por posición).
    const colOf = new Map<keyof ImportRow, number>();
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

    const dataRecords = records.slice(1);
    if (dataRecords.length > MAX_IMPORT_ROWS) {
      throw new BadRequestException(
        `El archivo excede el máximo de ${MAX_IMPORT_ROWS} filas`,
      );
    }

    const errors: ImportError[] = [];
    const valid: ImportRow[] = [];
    const seenSkus = new Set<string>();

    for (const rec of dataRecords) {
      const raw: Record<string, string> = {};
      for (const [field, col] of colOf) {
        const value = (rec.cells[col] ?? '').trim();
        if (value !== '') {
          raw[field] = value;
        }
      }
      const parsed = importRowSchema.safeParse(raw);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const field = issue.path.length ? `${String(issue.path[0])}: ` : '';
        errors.push({ line: rec.line, message: `${field}${issue.message}` });
        continue;
      }
      if (seenSkus.has(parsed.data.sku)) {
        errors.push({
          line: rec.line,
          message: `SKU duplicado en el archivo: ${parsed.data.sku}`,
        });
        continue;
      }
      seenSkus.add(parsed.data.sku);
      valid.push(parsed.data);
    }

    let created = 0;
    let updated = 0;
    if (valid.length > 0) {
      const result = await this.prisma.runInTenant(tenantId, async (tx) => {
        let c = 0;
        let u = 0;
        for (const row of valid) {
          // SKU es único por tenant aun si está soft-deleted → buscar sin filtrar deletedAt.
          const existing = await tx.ingredient.findFirst({
            where: { sku: row.sku },
          });
          if (existing) {
            await tx.ingredient.update({
              where: { id: existing.id },
              data: {
                name: row.name,
                type: row.type,
                unit: row.unit,
                category: row.category ?? null,
                deletedAt: null, // reimportar un SKU borrado lo reactiva
                ...(row.unitCost !== undefined
                  ? { unitCost: row.unitCost }
                  : {}),
              },
            });
            u += 1;
          } else {
            await tx.ingredient.create({
              data: {
                tenantId,
                sku: row.sku,
                name: row.name,
                type: row.type,
                unit: row.unit,
                category: row.category ?? null,
                unitCost: row.unitCost ?? 0,
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
    };
  }
}
