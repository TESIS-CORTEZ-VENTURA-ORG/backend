import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { PlatformModule } from './platform/platform.module';
import { UsersModule } from './users/users.module';

/** Raíz de composición: importa los módulos por bounded context (backend.md §3). */
@Module({
  imports: [PlatformModule, AuthModule, UsersModule],
})
export class AppModule {}
