import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { jwtClaimsSchema, type AppRole, type JwtClaims } from '../shared';

const ACCESS_TTL = '15m';

/** Access token JWT RS256 (15m). El refresh es opaco (ver RefreshTokenService). */
@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService) {}

  issueAccess(input: {
    sub: string;
    tenant_id: string;
    roles: AppRole[];
  }): Promise<string> {
    return this.jwt.signAsync(
      { sub: input.sub, tenant_id: input.tenant_id, roles: input.roles },
      { expiresIn: ACCESS_TTL },
    );
  }

  async verifyAccess(token: string): Promise<JwtClaims> {
    const decoded = await this.jwt.verifyAsync<Record<string, unknown>>(token);
    return jwtClaimsSchema.parse(decoded);
  }
}
