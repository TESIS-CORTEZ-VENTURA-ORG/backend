import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma/prisma.service';

export interface AuditEntry {
  tenantId: string;
  userId: string;
  action: string;
  ip: string | null;
  userAgent: string | null;
  meta?: Record<string, unknown>;
}

export interface AuditLogView {
  id: string;
  action: string;
  userId: string;
  ip: string | null;
  createdAt: string;
  meta: unknown;
}

/** Persiste/lee el audit log inmutable (HU-01-09). Vía runInTenant (RLS). */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.runInTenant(entry.tenantId, (tx) =>
        tx.auditLog.create({
          data: {
            tenantId: entry.tenantId,
            userId: entry.userId,
            action: entry.action,
            ip: entry.ip,
            userAgent: entry.userAgent,
            meta:
              entry.meta === undefined
                ? Prisma.JsonNull
                : (entry.meta as Prisma.InputJsonValue),
          },
        }),
      );
    } catch (error) {
      // No se rompe la acción de negocio, pero NO es catch silencioso: se loguea.
      this.logger.error(
        `No se pudo registrar audit "${entry.action}"`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async list(tenantId: string, limit = 50): Promise<AuditLogView[]> {
    const rows = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: limit }),
    );
    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      userId: row.userId,
      ip: row.ip,
      createdAt: row.createdAt.toISOString(),
      meta: row.meta,
    }));
  }
}
