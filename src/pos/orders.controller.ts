import {
  Body,
  Controller,
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
  addOrderItemsSchema,
  ok,
  openOrderSchema,
  updateOrderItemSchema,
  voidOrderSchema,
  type AddOrderItemsInput,
  type ApiResponse,
  type JwtClaims,
  type OpenOrderInput,
  type UpdateOrderItemInput,
  type VoidOrderInput,
} from '../shared';
import { OrdersService, type OrderView } from './orders.service';

@Controller('orders')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  // HU-03-03 · Abrir mesa. El mesero (claims.sub) queda como waiterId.
  @Post()
  @RequireAbility('create', 'Order')
  @Audited('order.open')
  async open(
    @CurrentUser() claims: JwtClaims,
    @Body(new ZodValidationPipe(openOrderSchema)) dto: OpenOrderInput,
  ): Promise<ApiResponse<OrderView>> {
    return ok(await this.orders.open(claims.tenant_id, claims.sub, dto));
  }

  @Get(':id')
  @RequireAbility('read', 'Order')
  async get(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
  ): Promise<ApiResponse<OrderView>> {
    return ok(await this.orders.get(claims.tenant_id, id));
  }

  // HU-03-04/05 · Tomar orden (con modificadores).
  @Post(':id/items')
  @RequireAbility('update', 'Order')
  @Audited('order.add_items')
  async addItems(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addOrderItemsSchema)) dto: AddOrderItemsInput,
  ): Promise<ApiResponse<OrderView>> {
    return ok(await this.orders.addItems(claims.tenant_id, id, dto));
  }

  // HU-03-04/10 · Editar ítem (cantidad / servido / quitar).
  @Patch(':id/items/:itemId')
  @RequireAbility('update', 'Order')
  @Audited('order.update_item')
  async updateItem(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(updateOrderItemSchema))
    dto: UpdateOrderItemInput,
  ): Promise<ApiResponse<OrderView>> {
    return ok(await this.orders.updateItem(claims.tenant_id, id, itemId, dto));
  }

  // HU-03-06 · Enviar comanda a cocina (rutea ítems a sus estaciones).
  @Post(':id/send-to-kitchen')
  @RequireAbility('update', 'Order')
  @Audited('order.send_to_kitchen')
  async sendToKitchen(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
  ): Promise<ApiResponse<OrderView>> {
    return ok(await this.orders.sendToKitchen(claims.tenant_id, id));
  }

  // HU-03-11 · Anular orden con razón (libera la mesa).
  @Post(':id/void')
  @RequireAbility('update', 'Order')
  @Audited('order.void')
  async void(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(voidOrderSchema)) dto: VoidOrderInput,
  ): Promise<ApiResponse<OrderView>> {
    return ok(await this.orders.void(claims.tenant_id, id, dto));
  }
}
