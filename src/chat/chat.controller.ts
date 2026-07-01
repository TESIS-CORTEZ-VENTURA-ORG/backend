import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PoliciesGuard } from '../authz/policies.guard';
import { RequireAbility } from '../authz/require-ability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  chatQuerySchema,
  ok,
  type ApiResponse,
  type ChatQueryInput,
  type ChatQueryResponse,
  type JwtClaims,
} from '../shared';
import { ChatService } from './chat.service';

/**
 * E09 · Chat IA — orquestador Text-to-SQL (lado NestJS).
 *
 * CASL: `read Report` — owner y manager pueden consultar, staff no.
 * Esta decisión es coherente con el módulo de forecasting y reports:
 * el chat analítico es una vista de datos del negocio, no una operación POS.
 *
 * Seguridad (backend.md §8.2):
 *   - tenant_id SIEMPRE del JWT (CurrentUser) — nunca del body.
 *   - La pregunta va a core-ai → SQL generado → validación 9 reglas →
 *     ejecución bajo runInTenant (RLS FORCE) + statement_timeout 5s.
 *   - El SQL validado y ejecutado se devuelve en la respuesta para
 *     transparencia y auditoría (el frontend puede mostrarlo opcionalmente).
 */
@Controller('chat')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  /**
   * HU-09-01 · Consulta analítica en lenguaje natural.
   *
   * Body: `{ question: string }` (1-2000 chars).
   * Returns: `{ answer, sql, columns, rows, provider, model }` bajo ApiResponse<T>.
   *
   * El SQL ejecutado se incluye en la respuesta para transparencia — el
   * frontend puede mostrarlo en un panel de "cómo lo calculé" si lo desea.
   */
  @Post('query')
  @HttpCode(200)
  @RequireAbility('read', 'Report')
  async query(
    @CurrentUser() claims: JwtClaims,
    @Body(new ZodValidationPipe(chatQuerySchema)) dto: ChatQueryInput,
  ): Promise<ApiResponse<ChatQueryResponse>> {
    return ok(await this.chat.query(claims.tenant_id, dto.question));
  }
}
