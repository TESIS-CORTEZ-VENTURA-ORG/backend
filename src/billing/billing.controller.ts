import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Audited } from '../audit/audited.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PoliciesGuard } from '../authz/policies.guard';
import { RequireAbility } from '../authz/require-ability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  ok,
  payOrderSchema,
  voidSaleSchema,
  type ApiResponse,
  type JwtClaims,
  type PayOrderInput,
  type VoidSaleInput,
} from '../shared';
import type { OrderView } from '../pos/orders.service';
import {
  BillingService,
  type PreBillView,
  type SaleView,
} from './billing.service';

// E04 — Cobros. Las rutas de cobro cuelgan de la orden (orders/:id) y las de
// consulta/anulación del ticket de sales/:id. Un solo controller (módulo billing).
@Controller()
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  // HU-04-01 · Pre-cuenta (preview, no persiste).
  @Get('orders/:id/pre-bill')
  @RequireAbility('read', 'Sale')
  async preBill(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
  ): Promise<ApiResponse<PreBillView>> {
    return ok(await this.billing.preBill(claims.tenant_id, id));
  }

  // HU-04-02/04/05/06 · Cobrar: emite el ticket + registra pagos; cierra la orden.
  @Post('orders/:id/pay')
  @RequireAbility('create', 'Sale')
  @Audited('sale.pay')
  async pay(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(payOrderSchema)) dto: PayOrderInput,
  ): Promise<ApiResponse<{ order: OrderView; sale: SaleView }>> {
    return ok(await this.billing.pay(claims.tenant_id, id, dto));
  }

  // Listado de tickets (desc por fecha de emisión).
  @Get('sales')
  @RequireAbility('read', 'Sale')
  async list(
    @CurrentUser() claims: JwtClaims,
  ): Promise<ApiResponse<SaleView[]>> {
    return ok(await this.billing.list(claims.tenant_id));
  }

  @Get('sales/:id')
  @RequireAbility('read', 'Sale')
  async get(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
  ): Promise<ApiResponse<SaleView>> {
    return ok(await this.billing.get(claims.tenant_id, id));
  }

  // HU-04-07 · Anular ticket con razón (manager/owner; staff → 403).
  @Post('sales/:id/void')
  @RequireAbility('update', 'Sale')
  @Audited('sale.void')
  async void(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(voidSaleSchema)) dto: VoidSaleInput,
  ): Promise<ApiResponse<SaleView>> {
    return ok(await this.billing.void(claims.tenant_id, id, dto));
  }
}
