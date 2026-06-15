# HU-02-05 + HU-02-06 — Proveedores y producto-proveedor

> **Épica:** E02 · **Sprint:** S1/S2 · **Must (02-05) / Should (02-06)** · **Estado:** 🟢 hecho.

## HU-02-05 · CRUD de proveedores (SP 3)
```gherkin
WHEN crea proveedor con RUC, contacto, lead time THEN queda activo y disponible para OCs
AND el RUC se valida (11 digitos) AND no se elimina si tiene OCs historicas (solo se desactiva)
```
**Implementado ✅:** `suppliers` (RLS FORCE; RUC único por tenant; contacto, paymentTerms, leadTimeDays, `active`). CRUD `/api/suppliers`. RUC validado (11 díg → 400). `DELETE` = **soft delete + active=false** (desactiva). *Nota: el chequeo "no eliminar si tiene OCs" se hará en E05 (las OCs no existen aún).*

## HU-02-06 · Asociar productos con proveedores (SP 3)
```gherkin
WHEN se crea relacion en product_suppliers THEN se guarda SKU del proveedor, ultimo precio y si es preferido
```
**Implementado ✅:** `product_suppliers` (RLS FORCE; `@@unique[ingredient,supplier]`). `POST/GET/DELETE /api/ingredients/:id/suppliers` (supplierSku, lastPrice, preferred). Asociación duplicada → 409. *Nota: `last_purchase_price` auto al recepcionar OC → E05.*

## RBAC
Subject **`Catalog`**: owner/manager gestionan, staff lee.

## Trazabilidad → test
`test/suppliers.e2e-spec.ts`: crea 201 / RUC inválido 400 / dup 409 / staff 403; asocia 201 / dup 409 / lista (lastPrice "7.50") / desasocia 200.
