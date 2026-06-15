/**
 * Contrato compartido (Zod v4 = única fuente de verdad). Importable por
 * cualquier módulo. Se moverá a `packages/shared` al crear el monorepo.
 */
export * from './api/api-response';
export * from './auth/app-role';
export * from './auth/auth.schema';
export * from './auth/tokens';
export * from './tenant/jwt-claims';
export * from './tenant/settings';
export * from './catalog/ingredient';
export * from './catalog/unit';
export * from './catalog/category';
export * from './catalog/supplier';
export * from './catalog/recipe';
