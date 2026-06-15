import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { Audited } from '../audit/audited.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PoliciesGuard } from '../authz/policies.guard';
import { RequireAbility } from '../authz/require-ability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  ok,
  tenantSettingsSchema,
  type ApiResponse,
  type JwtClaims,
  type TenantSettingsInput,
} from '../shared';
import { TenantsService, type TenantSettingsView } from './tenants.service';

@Controller('tenants')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get('settings')
  @RequireAbility('read', 'Setting')
  async get(
    @CurrentUser() claims: JwtClaims,
  ): Promise<ApiResponse<TenantSettingsView>> {
    return ok(await this.tenants.getSettings(claims.tenant_id));
  }

  @Patch('settings')
  @RequireAbility('update', 'Setting')
  @Audited('settings.update')
  async update(
    @CurrentUser() claims: JwtClaims,
    @Body(new ZodValidationPipe(tenantSettingsSchema)) dto: TenantSettingsInput,
  ): Promise<ApiResponse<TenantSettingsView>> {
    return ok(await this.tenants.updateSettings(claims.tenant_id, dto));
  }
}
