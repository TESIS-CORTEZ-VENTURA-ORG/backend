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
  type AuthTokens,
  type LoginInput,
  type RegisterInput,
} from '../shared';
import { AuthDbClient } from './auth-db.client';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

const rolesSchema = z.array(appRoleSchema);

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authDb: AuthDbClient,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  async register(input: RegisterInput): Promise<AuthTokens> {
    const tenantId = randomUUID();
    const userId = randomUUID();
    const passwordHash = await this.passwords.hash(input.password);
    try {
      // set-then-insert: runInTenant fija app.tenant_id = tenantId ANTES de insertar,
      // de modo que el WITH CHECK de la policy acepta el nuevo tenant y su owner.
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
    return this.tokens.issue({
      sub: userId,
      tenant_id: tenantId,
      roles: ['owner'],
    });
  }

  async login(input: LoginInput): Promise<AuthTokens> {
    // Lookup sin contexto de tenant (BYPASSRLS): la autenticación precede al tenant.
    const user = await this.authDb.user.findUnique({
      where: { email: input.email },
    });
    if (!user || user.deletedAt) {
      throw new UnauthorizedException('Credenciales inválidas');
    }
    const valid = await this.passwords.verify(
      input.password,
      user.passwordHash,
    );
    if (!valid) {
      throw new UnauthorizedException('Credenciales inválidas');
    }
    return this.tokens.issue({
      sub: user.id,
      tenant_id: user.tenantId,
      roles: rolesSchema.parse(user.roles),
    });
  }
}
