import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma/prisma.service';
import {
  type AppRole,
  type NotificationType,
  type SetPreferenceInput,
} from '../shared';

type Tx = Prisma.TransactionClient;
type NotificationRow = Prisma.NotificationGetPayload<object>;
type PreferenceRow = Prisma.NotificationPreferenceGetPayload<object>;

const DEFAULT_LIMIT = 50;
// Default por canal cuando el usuario no tiene preferencia explícita (HU-10-03).
const DEFAULT_IN_APP = true;
const DEFAULT_EMAIL = false;

// E10×E08 (notificaciones proactivas del forecast) · Ventana de supresión
// anti-spam para notificaciones "de condición" (no de evento puntual como
// low_stock, que ya es idempotente por "crossing" — ver `InventoryService.
// notifyIfCrossedLowStock`). Un forecast puede correr varias veces al día
// (manual + cron semanal) y recomputar el MISMO shortfall; sin esta ventana,
// cada corrida generaría una notificación nueva para la misma condición vigente.
const DEDUP_WINDOW_HOURS = 24;

/** Entrada para crear una notificación (service-to-service, HU-10-01). */
export interface CreateNotificationInput {
  // null/ausente = broadcast (todos los del tenant); si no, dirigida.
  userId?: string | null;
  type: NotificationType;
  title: string;
  body: string;
  data?: Prisma.InputJsonValue;
}

// HU-10-01 · Notificación tal como la consume el frontend (campana/bandeja).
export interface NotificationView {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Prisma.JsonValue | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationListView {
  items: NotificationView[];
  unreadCount: number;
}

// HU-10-03 · Preferencia por tipo y canal.
export interface PreferenceView {
  type: string;
  inApp: boolean;
  email: boolean;
}

export interface PreferenceListView {
  items: PreferenceView[];
}

/**
 * E10×E08 · Entrada para crear una notificación DIRIGIDA a todos los usuarios
 * del tenant con alguno de `roles` (p. ej. `forecast_shortfall` → solo
 * owner/manager: las compras no son decisión de `staff`). `dedupKey`
 * identifica la CONDICIÓN que dispara la notificación (p. ej. el insumo en
 * shortfall); mientras exista una notificación vigente con el mismo
 * (`type`, `dedupKey`) no se crea otra — ver `isDedupSuppressed`.
 */
export interface CreateForRolesInput {
  roles: AppRole[];
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  dedupKey: string;
}

function toView(n: NotificationRow): NotificationView {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    data: n.data ?? null,
    readAt: n.readAt ? n.readAt.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
  };
}

function prefToView(p: PreferenceRow): PreferenceView {
  return { type: p.type, inApp: p.inApp, email: p.email };
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * HU-10-01 · Crea una notificación abriendo su propia transacción. Pensado
   * para llamadas service-to-service que no están ya dentro de un `runInTenant`.
   * Respeta la preferencia del usuario (in-app off → omite). Devuelve la vista
   * creada o `null` si se omitió por preferencia.
   */
  async create(
    tenantId: string,
    input: CreateNotificationInput,
  ): Promise<NotificationView | null> {
    return this.prisma.runInTenant(tenantId, (tx) =>
      this.createTx(tx, tenantId, input),
    );
  }

  /**
   * HU-10-01 · Variante tx-aware: crea la notificación dentro de la transacción
   * del llamador (espeja `RecipesService.costPerYieldTx` / el auto-consumo de
   * stock de `BillingService`), de modo que la notificación se enlace al mismo
   * commit que el evento que la dispara (p. ej. el movimiento de inventario que
   * cruza el stock mínimo). Respeta la preferencia in-app del usuario destino.
   */
  async createTx(
    tx: Tx,
    tenantId: string,
    input: CreateNotificationInput,
  ): Promise<NotificationView | null> {
    const userId = input.userId ?? null;

    // HU-10-03 · Respeta el opt-out in-app. DIRIGIDA: si el usuario destino tiene
    // la preferencia de ese tipo con inApp=false → se omite. BROADCAST (userId
    // null): no hay un destinatario único; se omite si EXISTE una preferencia de
    // ese tipo con inApp=false en el tenant (opt-out explícito). En el piloto
    // (mono-usuario por tenant) esto equivale a respetar la preferencia del
    // usuario; el filtrado por-destinatario de broadcasts en tenants multi-
    // usuario es alcance futuro (ver spec E10).
    if (await this.inAppOptedOut(tx, tenantId, userId, input.type)) {
      return null;
    }

    const created = await tx.notification.create({
      data: {
        tenantId,
        userId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data ?? Prisma.JsonNull,
      },
    });
    return toView(created);
  }

  /**
   * E10×E08 · Crea una notificación DIRIGIDA (una fila por usuario) para todos
   * los usuarios del tenant con alguno de `input.roles` — usado por triggers
   * "de condición" que no deben llegar a `staff` (p. ej. `forecast_shortfall`:
   * las compras son decisión de owner/manager). Antispam vía `dedupKey` (ver
   * `isDedupSuppressed`); si la condición ya está vigente, devuelve `[]` sin
   * crear nada. Tx-aware, mismo criterio que `createTx` (respeta la preferencia
   * in-app de cada destinatario).
   */
  async createForRolesTx(
    tx: Tx,
    tenantId: string,
    input: CreateForRolesInput,
  ): Promise<NotificationView[]> {
    if (await this.isDedupSuppressed(tx, input.type, input.dedupKey)) {
      return [];
    }

    // RLS acota el tenant (misma tx del caller) — nunca se filtra tenantId acá.
    const recipients = await tx.user.findMany({
      where: { deletedAt: null, roles: { hasSome: input.roles } },
      select: { id: true },
    });

    const data = {
      ...(input.data ?? {}),
      dedupKey: input.dedupKey,
    } as Prisma.InputJsonValue;

    const created: NotificationView[] = [];
    for (const recipient of recipients) {
      const view = await this.createTx(tx, tenantId, {
        userId: recipient.id,
        type: input.type,
        title: input.title,
        body: input.body,
        data,
      });
      if (view) created.push(view);
    }
    return created;
  }

  /**
   * E10×E08 · ¿Ya existe una notificación "vigente" con el mismo
   * (`type`, `dedupKey`)? Vigente = no leída (el destinatario todavía no la vio)
   * O creada dentro de `DEDUP_WINDOW_HOURS` (aunque ya se haya leído, no se
   * re-crea de inmediato — evita "confirmar y volver a notificar" en el mismo
   * ciclo). El filtro JSON (`path`/`equals`) requiere Postgres (ver
   * `backend.md` §2 — el provider de Prisma acá es siempre `postgresql`).
   */
  private async isDedupSuppressed(
    tx: Tx,
    type: NotificationType,
    dedupKey: string,
  ): Promise<boolean> {
    const windowStart = new Date(Date.now() - DEDUP_WINDOW_HOURS * 3_600_000);
    const existing = await tx.notification.findFirst({
      where: {
        type,
        data: { path: ['dedupKey'], equals: dedupKey },
        OR: [{ readAt: null }, { createdAt: { gte: windowStart } }],
      },
      select: { id: true },
    });
    return existing !== null;
  }

  /**
   * HU-10-03 · ¿El canal in-app está desactivado para este (tipo, destinatario)?
   * Dirigida (userId): mira la fila exacta del usuario. Broadcast (userId null):
   * verdadero si EXISTE alguna preferencia de ese tipo con inApp=false en el
   * tenant (opt-out explícito). Ausencia de fila = default in-app activo.
   */
  private async inAppOptedOut(
    tx: Tx,
    tenantId: string,
    userId: string | null,
    type: NotificationType,
  ): Promise<boolean> {
    if (userId) {
      const pref = await tx.notificationPreference.findUnique({
        where: { tenantId_userId_type: { tenantId, userId, type } },
      });
      return pref ? !pref.inApp : false;
    }
    const optOut = await tx.notificationPreference.findFirst({
      where: { type, inApp: false },
    });
    return optOut !== null;
  }

  /**
   * HU-10-01 · Bandeja del usuario: sus notificaciones dirigidas (`userId`) más
   * las broadcast (`userId = null`), desc por `createdAt`. `unreadOnly` filtra
   * las no leídas y `limit` acota la lista; `unreadCount` SIEMPRE cuenta TODAS
   * las no leídas en el alcance del usuario (ignora ambos filtros) → es el badge.
   */
  async listForUser(
    tenantId: string,
    userId: string,
    opts: { unreadOnly?: boolean; limit?: number } = {},
  ): Promise<NotificationListView> {
    const scope: Prisma.NotificationWhereInput = {
      OR: [{ userId }, { userId: null }],
    };
    return this.prisma.runInTenant(tenantId, async (tx) => {
      const rows = await tx.notification.findMany({
        where: opts.unreadOnly ? { ...scope, readAt: null } : scope,
        orderBy: { createdAt: 'desc' },
        take: opts.limit ?? DEFAULT_LIMIT,
      });
      const unreadCount = await tx.notification.count({
        where: { ...scope, readAt: null },
      });
      return { items: rows.map(toView), unreadCount };
    });
  }

  /**
   * HU-10-01 · Marca una notificación como leída. Debe pertenecer al usuario o
   * ser broadcast (si no, 404). Idempotente: re-marcar conserva el `readAt`
   * original.
   */
  async markRead(
    tenantId: string,
    userId: string,
    id: string,
  ): Promise<NotificationView> {
    return this.prisma.runInTenant(tenantId, async (tx) => {
      const found = await tx.notification.findFirst({
        where: { id, OR: [{ userId }, { userId: null }] },
      });
      if (!found) {
        throw new NotFoundException('Notificación no encontrada');
      }
      if (found.readAt) {
        return toView(found);
      }
      const updated = await tx.notification.update({
        where: { id: found.id },
        data: { readAt: new Date() },
      });
      return toView(updated);
    });
  }

  /** HU-10-01 · Marca TODAS las no leídas del usuario (suyas + broadcast). */
  async markAllRead(
    tenantId: string,
    userId: string,
  ): Promise<{ updated: number }> {
    return this.prisma.runInTenant(tenantId, async (tx) => {
      const res = await tx.notification.updateMany({
        where: { OR: [{ userId }, { userId: null }], readAt: null },
        data: { readAt: new Date() },
      });
      return { updated: res.count };
    });
  }

  /**
   * HU-10-03 · Preferencias del usuario (solo las persistidas). Los tipos sin
   * fila usan el default (inApp=true, email=false), que el frontend aplica.
   */
  async getPreferences(
    tenantId: string,
    userId: string,
  ): Promise<PreferenceListView> {
    const rows = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.notificationPreference.findMany({
        where: { userId },
        orderBy: { type: 'asc' },
      }),
    );
    return { items: rows.map(prefToView) };
  }

  /** HU-10-03 · Upsert de la preferencia (usuario, tipo); respeta el default. */
  async setPreference(
    tenantId: string,
    userId: string,
    dto: SetPreferenceInput,
  ): Promise<PreferenceView> {
    const row = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.notificationPreference.upsert({
        where: {
          tenantId_userId_type: { tenantId, userId, type: dto.type },
        },
        create: {
          tenantId,
          userId,
          type: dto.type,
          inApp: dto.inApp ?? DEFAULT_IN_APP,
          email: dto.email ?? DEFAULT_EMAIL,
        },
        update: {
          ...(dto.inApp !== undefined ? { inApp: dto.inApp } : {}),
          ...(dto.email !== undefined ? { email: dto.email } : {}),
        },
      }),
    );
    return prefToView(row);
  }
}
