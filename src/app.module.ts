import { Module } from '@nestjs/common';
import { PlatformModule } from './platform/platform.module';

/** Raíz de composición: importa los módulos por bounded context (backend.md §3). */
@Module({
  imports: [PlatformModule],
})
export class AppModule {}
