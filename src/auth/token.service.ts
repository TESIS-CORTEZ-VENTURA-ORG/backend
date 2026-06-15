import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  jwtClaimsSchema,
  type AppRole,
  type AuthTokens,
  type JwtClaims,
} from '../shared';

const ACCESS_TTL = '15m';
const REFRESH_TTL = '7d';

/** Emite/valida JWT RS256 (backend.md §4). Claims: sub, tenant_id, roles. */
@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService) {}

  async issue(input: {
    sub: string;
    tenant_id: string;
    roles: AppRole[];
  }): Promise<AuthTokens> {
    const claims = {
      sub: input.sub,
      tenant_id: input.tenant_id,
      roles: input.roles,
    };
    const accessToken = await this.jwt.signAsync(claims, {
      expiresIn: ACCESS_TTL,
    });
    const refreshToken = await this.jwt.signAsync(
      { sub: input.sub },
      { expiresIn: REFRESH_TTL },
    );
    return { accessToken, refreshToken };
  }

  async verifyAccess(token: string): Promise<JwtClaims> {
    const decoded = await this.jwt.verifyAsync<Record<string, unknown>>(token);
    return jwtClaimsSchema.parse(decoded);
  }
}
