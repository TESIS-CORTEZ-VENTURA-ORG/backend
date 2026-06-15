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
import { Audited } from '../audit/audited.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PoliciesGuard } from '../authz/policies.guard';
import { RequireAbility } from '../authz/require-ability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  createMenuItemSchema,
  ok,
  updateMenuItemSchema,
  type ApiResponse,
  type CreateMenuItemInput,
  type JwtClaims,
  type UpdateMenuItemInput,
} from '../shared';
import { MenuItemsService, type MenuItemView } from './menu-items.service';

@Controller('menu/items')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class MenuItemsController {
  constructor(private readonly items: MenuItemsService) {}

  @Get()
  @RequireAbility('read', 'Catalog')
  async list(
    @CurrentUser() claims: JwtClaims,
  ): Promise<ApiResponse<MenuItemView[]>> {
    return ok(await this.items.list(claims.tenant_id));
  }

  @Get(':id')
  @RequireAbility('read', 'Catalog')
  async get(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
  ): Promise<ApiResponse<MenuItemView>> {
    return ok(await this.items.get(claims.tenant_id, id));
  }

  @Post()
  @RequireAbility('create', 'Catalog')
  @Audited('menu.item.create')
  async create(
    @CurrentUser() claims: JwtClaims,
    @Body(new ZodValidationPipe(createMenuItemSchema)) dto: CreateMenuItemInput,
  ): Promise<ApiResponse<MenuItemView>> {
    return ok(await this.items.create(claims.tenant_id, dto));
  }

  @Patch(':id')
  @RequireAbility('update', 'Catalog')
  @Audited('menu.item.update')
  async update(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateMenuItemSchema)) dto: UpdateMenuItemInput,
  ): Promise<ApiResponse<MenuItemView>> {
    return ok(await this.items.update(claims.tenant_id, id, dto));
  }

  @Delete(':id')
  @RequireAbility('delete', 'Catalog')
  @Audited('menu.item.delete')
  async remove(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
  ): Promise<ApiResponse<{ deleted: true }>> {
    await this.items.remove(claims.tenant_id, id);
    return ok({ deleted: true });
  }
}
