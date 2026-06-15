import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthzModule } from '../authz/authz.module';
import { PlatformModule } from '../platform/platform.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * Gestión de usuarios del tenant. Importa AuthModule (TokenService → JwtAuthGuard)
 * y AuthzModule (CaslAbilityFactory → PoliciesGuard) para el gating RBAC.
 */
@Module({
  imports: [PlatformModule, AuthModule, AuthzModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
