import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthzModule } from '../authz/authz.module';
import { PlatformModule } from '../platform/platform.module';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { IngredientsController } from './ingredients.controller';
import { IngredientsService } from './ingredients.service';
import { UnitsController } from './units.controller';
import { UnitsService } from './units.service';

/** E02 — Catálogo: insumos, unidades de medida y categorías (recetas/menú en HUs siguientes). */
@Module({
  imports: [PlatformModule, AuthModule, AuthzModule],
  controllers: [IngredientsController, UnitsController, CategoriesController],
  providers: [IngredientsService, UnitsService, CategoriesService],
})
export class CatalogModule {}
