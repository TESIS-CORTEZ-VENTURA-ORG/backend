import { z } from 'zod';
import { appRoleSchema } from '../auth/app-role';

/**
 * Claims del JWT RS256 (backend.md §4, Capa 1). El `tenant_id` SIEMPRE sale de
 * aquí — nunca del path, query ni body. Es el origen de la verdad del tenant.
 *
 * Nota: las claves van en snake_case porque son el formato del JWT (wire
 * contract producido por Better-Auth), no variables internas.
 */
export const jwtClaimsSchema = z.object({
  sub: z.string().min(1),
  tenant_id: z.uuid(),
  roles: z.array(appRoleSchema).min(1),
});

export type JwtClaims = z.infer<typeof jwtClaimsSchema>;
