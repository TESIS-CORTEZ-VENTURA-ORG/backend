import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AuthDbClient } from './auth-db.client';

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 días

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Refresh tokens opacos con ROTACIÓN y detección de REUSO (HU-01-03).
 * Usa AuthDbClient (gastronomia_auth, BYPASSRLS): la rotación ocurre sin contexto
 * de tenant. Se guarda solo el SHA-256 del token; el reuso de un token revocado
 * revoca toda su familia.
 */
@Injectable()
export class RefreshTokenService {
  constructor(private readonly authDb: AuthDbClient) {}

  async issue(
    tenantId: string,
    userId: string,
    family?: string,
  ): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.authDb.refreshToken.create({
      data: {
        tenantId,
        userId,
        tokenHash: hashToken(token),
        family: family ?? randomUUID(),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      },
    });
    return token;
  }

  /** Rota un refresh token válido. Reuso de uno revocado → revoca la familia. */
  async rotate(
    rawToken: string,
  ): Promise<{ tenantId: string; userId: string; token: string }> {
    const existing = await this.authDb.refreshToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
    });
    if (!existing || existing.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token inválido o expirado');
    }
    if (existing.revokedAt) {
      await this.authDb.refreshToken.updateMany({
        where: { family: existing.family, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token reusado: sesión revocada');
    }
    await this.authDb.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });
    const token = await this.issue(
      existing.tenantId,
      existing.userId,
      existing.family,
    );
    return { tenantId: existing.tenantId, userId: existing.userId, token };
  }

  async revoke(rawToken: string): Promise<void> {
    await this.authDb.refreshToken.updateMany({
      where: { tokenHash: hashToken(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.authDb.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
