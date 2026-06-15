import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  listNotificationsQuerySchema,
  ok,
  setPreferenceSchema,
  type ApiResponse,
  type JwtClaims,
  type ListNotificationsQuery,
  type SetPreferenceInput,
} from '../shared';
import {
  NotificationsService,
  type NotificationListView,
  type NotificationView,
  type PreferenceListView,
  type PreferenceView,
} from './notifications.service';

/**
 * E10 — Notificaciones in-app (HU-10-01) + preferencias (HU-10-03). Las
 * notificaciones son PERSONALES: cada usuario lee/marca las suyas (dirigidas)
 * más las broadcast del tenant. Por eso basta `JwtAuthGuard` y el alcance por
 * `claims.sub` — NO se introduce un sujeto CASL nuevo. Crear notificaciones es
 * interno (service-to-service vía `NotificationsService`), sin endpoint público.
 */
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  // HU-10-01 · Bandeja del usuario + contador de no leídas (badge de la campana).
  @Get()
  async list(
    @CurrentUser() claims: JwtClaims,
    @Query(new ZodValidationPipe(listNotificationsQuerySchema))
    query: ListNotificationsQuery,
  ): Promise<ApiResponse<NotificationListView>> {
    return ok(
      await this.notifications.listForUser(claims.tenant_id, claims.sub, {
        unreadOnly: query.unreadOnly,
        limit: query.limit,
      }),
    );
  }

  // HU-10-03 · Preferencias del usuario (las persistidas; el resto usa default).
  @Get('preferences')
  async preferences(
    @CurrentUser() claims: JwtClaims,
  ): Promise<ApiResponse<PreferenceListView>> {
    return ok(
      await this.notifications.getPreferences(claims.tenant_id, claims.sub),
    );
  }

  // HU-10-03 · Configurar una preferencia (tipo × canal).
  @Patch('preferences')
  async setPreference(
    @CurrentUser() claims: JwtClaims,
    @Body(new ZodValidationPipe(setPreferenceSchema)) dto: SetPreferenceInput,
  ): Promise<ApiResponse<PreferenceView>> {
    return ok(
      await this.notifications.setPreference(claims.tenant_id, claims.sub, dto),
    );
  }

  // HU-10-01 · Marcar TODAS como leídas (suyas + broadcast).
  @Post('read-all')
  async readAll(
    @CurrentUser() claims: JwtClaims,
  ): Promise<ApiResponse<{ updated: number }>> {
    return ok(
      await this.notifications.markAllRead(claims.tenant_id, claims.sub),
    );
  }

  // HU-10-01 · Marcar una como leída (debe pertenecer al usuario o ser broadcast).
  @Post(':id/read')
  async read(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
  ): Promise<ApiResponse<NotificationView>> {
    return ok(
      await this.notifications.markRead(claims.tenant_id, claims.sub, id),
    );
  }
}
