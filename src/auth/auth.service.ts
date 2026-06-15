import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../platform/prisma/prisma.service';
import {
  appRoleSchema,
  type AppRole,
  type AuthTokens,
  type ChangePasswordInput,
  type LoginInput,
  type RegisterInput,
} from '../shared';
import { AuthDbClient } from './auth-db.client';
import { PasswordService } from './password.service';
import { RefreshTokenService } from './refresh-token.service';
import { TokenService } from './token.service';

const rolesSchema = z.array(appRoleSchema);
const MAX_FAILED_ATTEMPTS = 5;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authDb: AuthDbClient,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  async register(input: RegisterInput): Promise<AuthTokens> {
    const tenantId = randomUUID();
    const userId = randomUUID();
    const passwordHash = await this.passwords.hash(input.password);
    try {
      await this.prisma.runInTenant(tenantId, async (tx) => {
        await tx.tenant.create({
          data: { id: tenantId, name: input.restaurantName },
        });
        await tx.user.create({
          data: {
            id: userId,
            tenantId,
            email: input.email,
            name: input.name,
            passwordHash,
            roles: ['owner'],
          },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('El email ya está registrado');
      }
      throw error;
    }
    return this.issueTokens(userId, tenantId, ['owner']);
  }

  async login(input: LoginInput): Promise<AuthTokens> {
    const user = await this.authDb.user.findUnique({
      where: { email: input.email },
    });
    if (!user || user.deletedAt) {
      throw new UnauthorizedException('Credenciales inválidas');
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException(
        'Cuenta bloqueada temporalmente por intentos fallidos',
      );
    }
    const valid = await this.passwords.verify(
      input.password,
      user.passwordHash,
    );
    if (!valid) {
      await this.registerFailedAttempt(user.id);
      throw new UnauthorizedException('Credenciales inválidas');
    }
    await this.resetFailedAttempts(user.id);
    return this.issueTokens(
      user.id,
      user.tenantId,
      rolesSchema.parse(user.roles),
    );
  }

  async refresh(rawToken: string): Promise<AuthTokens> {
    const rotated = await this.refreshTokens.rotate(rawToken);
    const user = await this.authDb.user.findUnique({
      where: { id: rotated.userId },
    });
    if (!user || user.deletedAt) {
      throw new UnauthorizedException('Usuario no encontrado');
    }
    const accessToken = await this.tokens.issueAccess({
      sub: user.id,
      tenant_id: user.tenantId,
      roles: rolesSchema.parse(user.roles),
    });
    return { accessToken, refreshToken: rotated.token };
  }

  async logout(rawToken: string): Promise<void> {
    await this.refreshTokens.revoke(rawToken);
  }

  /** Cambia la contraseña del usuario autenticado y revoca TODAS sus sesiones. */
  async changePassword(
    userId: string,
    tenantId: string,
    input: ChangePasswordInput,
  ): Promise<void> {
    const user = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.user.findUniqueOrThrow({ where: { id: userId } }),
    );
    const valid = await this.passwords.verify(
      input.currentPassword,
      user.passwordHash,
    );
    if (!valid) {
      throw new UnauthorizedException('La contraseña actual es incorrecta');
    }
    const passwordHash = await this.passwords.hash(input.newPassword);
    await this.prisma.runInTenant(tenantId, (tx) =>
      tx.user.update({ where: { id: userId }, data: { passwordHash } }),
    );
    await this.refreshTokens.revokeAllForUser(userId);
  }

  private async issueTokens(
    userId: string,
    tenantId: string,
    roles: AppRole[],
  ): Promise<AuthTokens> {
    const accessToken = await this.tokens.issueAccess({
      sub: userId,
      tenant_id: tenantId,
      roles,
    });
    const refreshToken = await this.refreshTokens.issue(tenantId, userId);
    return { accessToken, refreshToken };
  }

  // Lockout (HU-01-02): incrementa el contador y bloquea 15 min al 5º fallo.
  // SQL crudo para tocar solo las columnas con grant (sin disparar @updatedAt).
  private async registerFailedAttempt(userId: string): Promise<void> {
    await this.authDb.$executeRaw`
      UPDATE users
      SET failed_login_attempts = failed_login_attempts + 1,
          locked_until = CASE
            WHEN failed_login_attempts + 1 >= ${MAX_FAILED_ATTEMPTS}
            THEN now() + interval '15 minutes'
            ELSE locked_until
          END
      WHERE id = ${userId}::uuid`;
  }

  private async resetFailedAttempts(userId: string): Promise<void> {
    await this.authDb.$executeRaw`
      UPDATE users SET failed_login_attempts = 0, locked_until = NULL
      WHERE id = ${userId}::uuid`;
  }
}
