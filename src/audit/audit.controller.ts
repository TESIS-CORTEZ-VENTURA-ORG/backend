import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PoliciesGuard } from '../authz/policies.guard';
import { RequireAbility } from '../authz/require-ability.decorator';
import { ok, type ApiResponse, type JwtClaims } from '../shared';
import { AuditService, type AuditLogView } from './audit.service';

@Controller('audit')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequireAbility('read', 'Report')
  async list(
    @CurrentUser() claims: JwtClaims,
  ): Promise<ApiResponse<AuditLogView[]>> {
    return ok(await this.audit.list(claims.tenant_id));
  }
}
