import { z } from 'zod';

/**
 * Tokens emitidos por login/register (contrato con el BFF del frontend).
 * accessToken: 15m · refreshToken: 7d (backend.md §2).
 */
export const authTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});

export type AuthTokens = z.infer<typeof authTokensSchema>;
