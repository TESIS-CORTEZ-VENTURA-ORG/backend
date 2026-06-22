import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PoliciesGuard } from '../authz/policies.guard';
import { RequireAbility } from '../authz/require-ability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  createEmployeeSchema,
  ok,
  updateEmployeeSchema,
  type ApiResponse,
  type CreateEmployeeInput,
  type JwtClaims,
  type UpdateEmployeeInput,
} from '../shared';
import { EmployeesService, type EmployeeView } from './employees.service';

@Controller('employees')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  @RequireAbility('read', 'Employee')
  async list(
    @CurrentUser() claims: JwtClaims,
  ): Promise<ApiResponse<EmployeeView[]>> {
    const isOwner = claims.roles.includes('owner');
    return ok(await this.employees.list(claims.tenant_id, isOwner));
  }

  @Post()
  @RequireAbility('create', 'Employee')
  async create(
    @CurrentUser() claims: JwtClaims,
    @Body(new ZodValidationPipe(createEmployeeSchema)) dto: CreateEmployeeInput,
  ): Promise<ApiResponse<EmployeeView>> {
    const isOwner = claims.roles.includes('owner');
    return ok(await this.employees.create(claims.tenant_id, dto, isOwner));
  }

  @Get(':id')
  @RequireAbility('read', 'Employee')
  async findOne(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
  ): Promise<ApiResponse<EmployeeView>> {
    const isOwner = claims.roles.includes('owner');
    return ok(await this.employees.findOne(claims.tenant_id, id, isOwner));
  }

  @Patch(':id')
  @RequireAbility('update', 'Employee')
  async update(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateEmployeeSchema)) dto: UpdateEmployeeInput,
  ): Promise<ApiResponse<EmployeeView>> {
    const isOwner = claims.roles.includes('owner');
    return ok(await this.employees.update(claims.tenant_id, id, dto, isOwner));
  }

  @Delete(':id')
  @RequireAbility('delete', 'Employee')
  async remove(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
  ): Promise<ApiResponse<{ deleted: true }>> {
    await this.employees.remove(claims.tenant_id, id);
    return ok({ deleted: true });
  }
}
