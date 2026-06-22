import { Injectable } from '@nestjs/common';
import {
  AbilityBuilder,
  createMongoAbility,
  type MongoAbility,
} from '@casl/ability';
import { type AppRole } from '../shared';

export type AppAction = 'manage' | 'create' | 'read' | 'update' | 'delete';
export type AppSubject =
  | 'User'
  | 'Tenant'
  | 'Setting'
  | 'Report'
  | 'Catalog'
  | 'Recipe'
  | 'Inventory'
  | 'Sale'
  | 'Order'
  | 'Zone'
  | 'Table'
  | 'Kitchen'
  | 'Employee'
  | 'all';
export type AppAbility = MongoAbility<[AppAction, AppSubject]>;

/**
 * Matriz de permisos por rol (backend.md §1, §4):
 *  - owner   → todo.
 *  - manager → lectura amplia + gestión operativa y de catálogo, SIN escribir settings ni usuarios.
 *  - staff   → lectura operativa + catálogo (POS/KDS); sin reportes/usuarios/settings.
 */
@Injectable()
export class CaslAbilityFactory {
  createForRoles(roles: AppRole[]): AppAbility {
    const { can, cannot, build } = new AbilityBuilder<AppAbility>(
      createMongoAbility,
    );

    if (roles.includes('owner')) {
      can('manage', 'all');
    }

    if (roles.includes('manager')) {
      can('read', 'all');
      can('manage', [
        'Catalog',
        'Recipe',
        'Inventory',
        'Sale',
        'Order',
        'Report',
        'Zone', // configurar salón (zonas/mesas)
        'Table',
        'Kitchen',
        'Employee',
      ]);
      cannot(['create', 'update', 'delete'], 'User'); // gestión de usuarios = owner
      cannot(['create', 'update', 'delete'], 'Setting'); // sin escritura en settings
    }

    if (roles.includes('staff')) {
      can('read', [
        'Catalog',
        'Recipe',
        'Inventory',
        'Sale',
        'Order',
        'Zone',
        'Table',
        'Kitchen',
      ]);
      // Operación de POS/KDS: el mesero toma órdenes y opera mesas; el cocinero
      // marca ítems. NO configura el salón (crear/borrar zonas/mesas = manager).
      can(['create', 'update'], 'Order'); // tomar orden, enviar a cocina, anular
      can('update', 'Table'); // abrir mesa, cambiar estado, solicitar cuenta
      can('update', 'Kitchen'); // marcar ítem preparando/listo/servido
      // E04 cobros: el cajero es `staff` → puede cobrar (emitir ticket + pagos).
      // Anular ticket queda en manager/owner (no se da update/delete Sale a staff).
      can('create', 'Sale'); // pre-cuenta, cuenta final, pagos (HU-04-01/02/04/05/06)
    }

    return build();
  }
}
