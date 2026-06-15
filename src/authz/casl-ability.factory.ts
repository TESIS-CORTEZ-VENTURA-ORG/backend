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
      ]);
      cannot(['create', 'update', 'delete'], 'User'); // gestión de usuarios = owner
      cannot(['create', 'update', 'delete'], 'Setting'); // sin escritura en settings
    }

    if (roles.includes('staff')) {
      can('read', ['Catalog', 'Recipe', 'Inventory', 'Sale', 'Order']); // POS/KDS
    }

    return build();
  }
}
