import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PoliciesGuard } from '../authz/policies.guard';
import { RequireAbility } from '../authz/require-ability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { appRoleSchema, ok, type ApiResponse, type JwtClaims } from '../shared';
import { UsersService, type UserView } from './users.service';

const assignRolesSchema = z.object({ roles: z.array(appRoleSchema).min(1) });
type AssignRolesInput = z.infer<typeof assignRolesSchema>;

@Controller('users')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequireAbility('read', 'User')
  async list(
    @CurrentUser() claims: JwtClaims,
  ): Promise<ApiResponse<UserView[]>> {
    return ok(await this.users.listByTenant(claims.tenant_id));
  }

  @Patch(':id/role')
  @RequireAbility('update', 'User')
  async assignRoles(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(assignRolesSchema)) body: AssignRolesInput,
  ): Promise<ApiResponse<UserView>> {
    return ok(await this.users.assignRoles(claims.tenant_id, id, body.roles));
  }
}
