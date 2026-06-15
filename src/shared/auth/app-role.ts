import { z } from 'zod';

/**
 * Roles del JWT (backend.md §1). Autorización fina con CASL en el backend.
 * Idéntico a `AppRole` del frontend (frontend/shared/types/api.ts).
 */
export const APP_ROLES = ['owner', 'manager', 'staff'] as const;

export const appRoleSchema = z.enum(APP_ROLES);

export type AppRole = z.infer<typeof appRoleSchema>;
