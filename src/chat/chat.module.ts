import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthzModule } from '../authz/authz.module';
import { PlatformModule } from '../platform/platform.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { CoreAiChatClient } from './core-ai-chat.client';

/**
 * E09 — Chat IA (`chat-orchestrator` en backend.md §5).
 *
 * Este módulo es el lado NestJS del Text-to-SQL. NestJS orquesta
 * (valida, ejecuta bajo RLS, devuelve la respuesta); core-ai infiere
 * (genera el SQL, humaniza la respuesta). No hay imports cruzados con
 * otros bounded contexts — comunicación sólo vía interfaces TypeScript
 * (backend.md §3).
 *
 * PlatformModule provee PrismaService (runInTenant + RLS FORCE).
 * AuthModule  provee JwtAuthGuard (extrae tenant_id del JWT).
 * AuthzModule provee PoliciesGuard + CaslAbilityFactory (gate 'read Report').
 */
@Module({
  imports: [PlatformModule, AuthModule, AuthzModule],
  controllers: [ChatController],
  providers: [ChatService, CoreAiChatClient],
})
export class ChatModule {}
