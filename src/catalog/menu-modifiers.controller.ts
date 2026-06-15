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
  createMenuModifierSchema,
  ok,
  updateMenuModifierSchema,
  type ApiResponse,
  type CreateMenuModifierInput,
  type JwtClaims,
  type UpdateMenuModifierInput,
} from '../shared';
import {
  MenuModifiersService,
  type MenuModifierView,
} from './menu-modifiers.service';

// HU-02-11 · Modificadores anidados bajo un plato del menú.
@Controller('menu')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class MenuModifiersController {
  constructor(private readonly modifiers: MenuModifiersService) {}

  @Get('items/:itemId/modifiers')
  @RequireAbility('read', 'Catalog')
  async list(
    @CurrentUser() claims: JwtClaims,
    @Param('itemId') itemId: string,
  ): Promise<ApiResponse<MenuModifierView[]>> {
    return ok(await this.modifiers.listForItem(claims.tenant_id, itemId));
  }

  @Post('items/:itemId/modifiers')
  @RequireAbility('create', 'Catalog')
  @Audited('menu.modifier.create')
  async create(
    @CurrentUser() claims: JwtClaims,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(createMenuModifierSchema))
    dto: CreateMenuModifierInput,
  ): Promise<ApiResponse<MenuModifierView>> {
    return ok(await this.modifiers.create(claims.tenant_id, itemId, dto));
  }

  @Patch('modifiers/:id')
  @RequireAbility('update', 'Catalog')
  @Audited('menu.modifier.update')
  async update(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateMenuModifierSchema))
    dto: UpdateMenuModifierInput,
  ): Promise<ApiResponse<MenuModifierView>> {
    return ok(await this.modifiers.update(claims.tenant_id, id, dto));
  }

  @Delete('modifiers/:id')
  @RequireAbility('delete', 'Catalog')
  @Audited('menu.modifier.delete')
  async remove(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
  ): Promise<ApiResponse<{ deleted: true }>> {
    await this.modifiers.remove(claims.tenant_id, id);
    return ok({ deleted: true });
  }
}
