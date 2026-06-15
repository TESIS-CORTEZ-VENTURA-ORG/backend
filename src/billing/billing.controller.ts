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
  splitOrderSchema,
  voidSaleSchema,
  type ApiResponse,
  type JwtClaims,
  type PayOrderInput,
  type SplitOrderInput,
  type VoidSaleInput,
} from '../shared';
import type { OrderView } from '../pos/orders.service';
import {
  BillingService,
  type CashCloseView,
  type CashClosePreview,
  type PreBillView,
  type SaleView,
  type SplitView,
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

  // HU-04-03 · Dividir la cuenta por comensal (cómputo, no persiste).
  @Post('orders/:id/split')
  @RequireAbility('read', 'Sale')
  async split(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(splitOrderSchema)) dto: SplitOrderInput,
  ): Promise<ApiResponse<SplitView>> {
    return ok(await this.billing.split(claims.tenant_id, id, dto));
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

  // HU-04-08 · Preview del cierre Z (ventana abierta, no persiste).
  @Get('cash-close/preview')
  @RequireAbility('read', 'Sale')
  async cashClosePreview(
    @CurrentUser() claims: JwtClaims,
  ): Promise<ApiResponse<CashClosePreview>> {
    return ok(await this.billing.cashClosePreview(claims.tenant_id));
  }

  // HU-04-08 · Cierre Z (cierre del turno): persiste el agregado. manager/owner.
  @Post('cash-close')
  @RequireAbility('update', 'Sale')
  @Audited('cash.close')
  async cashClose(
    @CurrentUser() claims: JwtClaims,
  ): Promise<ApiResponse<CashCloseView>> {
    return ok(await this.billing.cashClose(claims.tenant_id, claims.sub));
  }

  // HU-04-08 · Lista de cierres Z pasados (desc por closedAt).
  @Get('cash-close')
  @RequireAbility('read', 'Sale')
  async listCashCloses(
    @CurrentUser() claims: JwtClaims,
  ): Promise<ApiResponse<CashCloseView[]>> {
    return ok(await this.billing.listCashCloses(claims.tenant_id));
  }
}
