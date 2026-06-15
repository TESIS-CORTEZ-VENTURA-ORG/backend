import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthzModule } from '../authz/authz.module';
import { PlatformModule } from '../platform/platform.module';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';

/** E01 tenants — configuración del local (HU-01-10), gating RBAC (owner escribe). */
@Module({
  imports: [PlatformModule, AuthModule, AuthzModule],
  controllers: [TenantsController],
  providers: [TenantsService],
})
export class TenantsModule {}
