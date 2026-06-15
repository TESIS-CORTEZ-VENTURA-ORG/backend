import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthzModule } from '../authz/authz.module';
import { PlatformModule } from '../platform/platform.module';
import { IngredientsController } from './ingredients.controller';
import { IngredientsService } from './ingredients.service';

/** E02 — Catálogo. HU-02-01 insumos (recetas/menú en HUs siguientes). */
@Module({
  imports: [PlatformModule, AuthModule, AuthzModule],
  controllers: [IngredientsController],
  providers: [IngredientsService],
})
export class CatalogModule {}
