import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformModule } from '../platform/platform.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * E10 — Notificaciones in-app (HU-10-01) + preferencias (HU-10-03). Exporta
 * `NotificationsService` para que otros módulos (p. ej. inventory → alerta de
 * stock bajo) creen notificaciones service-to-service. Solo `JwtAuthGuard`: las
 * notificaciones son personales (alcance por `claims.sub`), sin sujeto CASL.
 */
@Module({
  imports: [PlatformModule, AuthModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
