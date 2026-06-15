import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Audited } from '../audit/audited.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PoliciesGuard } from '../authz/policies.guard';
import { RequireAbility } from '../authz/require-ability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  createPurchaseOrderSchema,
  ok,
  receivePurchaseOrderSchema,
  type ApiResponse,
  type CreatePurchaseOrderInput,
  type JwtClaims,
  type ReceivePurchaseOrderInput,
} from '../shared';
import {
  PurchaseOrdersService,
  type PurchaseOrderView,
} from './purchase-orders.service';

@Controller('purchase-orders')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class PurchaseOrdersController {
  constructor(private readonly purchaseOrders: PurchaseOrdersService) {}

  // HU-05-04 · Crear OC (estado draft) con sus líneas.
  @Post()
  @RequireAbility('create', 'Inventory')
  @Audited('po.create')
  async create(
    @CurrentUser() claims: JwtClaims,
    @Body(new ZodValidationPipe(createPurchaseOrderSchema))
    dto: CreatePurchaseOrderInput,
  ): Promise<ApiResponse<PurchaseOrderView>> {
    return ok(await this.purchaseOrders.create(claims.tenant_id, dto));
  }

  // HU-05-04 · Listar OCs (con líneas + total).
  @Get()
  @RequireAbility('read', 'Inventory')
  async list(
    @CurrentUser() claims: JwtClaims,
  ): Promise<ApiResponse<PurchaseOrderView[]>> {
    return ok(await this.purchaseOrders.list(claims.tenant_id));
  }

  // HU-05-04 · Detalle de una OC.
  @Get(':id')
  @RequireAbility('read', 'Inventory')
  async get(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
  ): Promise<ApiResponse<PurchaseOrderView>> {
    return ok(await this.purchaseOrders.get(claims.tenant_id, id));
  }

  // HU-05-05 (solo estado) · Enviar OC al proveedor (draft → sent).
  // Nota: el email/PDF al proveedor está diferido (servicio de correo externo).
  @Post(':id/send')
  @RequireAbility('update', 'Inventory')
  @Audited('po.send')
  async send(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
  ): Promise<ApiResponse<PurchaseOrderView>> {
    return ok(await this.purchaseOrders.send(claims.tenant_id, id));
  }

  // HU-05-06 · Recepcionar OC (parcial/total): mueve inventario + sube stock.
  @Post(':id/receive')
  @RequireAbility('update', 'Inventory')
  @Audited('po.receive')
  async receive(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(receivePurchaseOrderSchema))
    dto: ReceivePurchaseOrderInput,
  ): Promise<ApiResponse<PurchaseOrderView>> {
    return ok(
      await this.purchaseOrders.receive(claims.tenant_id, claims.sub, id, dto),
    );
  }

  // HU-05-07 · Cancelar OC ({draft, sent} → cancelled).
  @Post(':id/cancel')
  @RequireAbility('update', 'Inventory')
  @Audited('po.cancel')
  async cancel(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
  ): Promise<ApiResponse<PurchaseOrderView>> {
    return ok(await this.purchaseOrders.cancel(claims.tenant_id, id));
  }
}
