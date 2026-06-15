import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Observable, concatMap } from 'rxjs';
import { type JwtClaims } from '../shared';
import { AUDITED } from './audited.decorator';
import { AuditService } from './audit.service';

interface AuditableRequest {
  user?: JwtClaims;
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
  params?: Record<string, unknown>;
}

/**
 * Interceptor GLOBAL: tras un handler marcado con @Audited (y autenticado por
 * JwtAuthGuard), registra el evento con actor, IP y user-agent ANTES de responder
 * (concatMap → el audit queda persistido antes de devolver la respuesta).
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const action = this.reflector.get<string | undefined>(
      AUDITED,
      context.getHandler(),
    );
    if (!action) {
      return next.handle();
    }
    const req = context.switchToHttp().getRequest<AuditableRequest>();
    return next.handle().pipe(
      concatMap(async (data: unknown) => {
        const user = req.user;
        if (user) {
          const ua = req.headers['user-agent'];
          await this.audit.record({
            tenantId: user.tenant_id,
            userId: user.sub,
            action,
            ip: req.ip ?? null,
            userAgent: Array.isArray(ua) ? (ua[0] ?? null) : (ua ?? null),
            meta: req.params ? { params: req.params } : undefined,
          });
        }
        return data;
      }),
    );
  }
}
