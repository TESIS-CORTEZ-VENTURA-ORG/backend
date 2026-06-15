import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthzModule } from '../authz/authz.module';
import { PlatformModule } from '../platform/platform.module';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { IngredientsController } from './ingredients.controller';
import { IngredientsService } from './ingredients.service';
import { MenuAvailabilityController } from './menu-availability.controller';
import { MenuAvailabilityService } from './menu-availability.service';
import { MenuCategoriesController } from './menu-categories.controller';
import { MenuCategoriesService } from './menu-categories.service';
import { MenuItemsController } from './menu-items.controller';
import { MenuItemsService } from './menu-items.service';
import { MenuModifiersController } from './menu-modifiers.controller';
import { MenuModifiersService } from './menu-modifiers.service';
import { ProductSuppliersController } from './product-suppliers.controller';
import { ProductSuppliersService } from './product-suppliers.service';
import { RecipesController } from './recipes.controller';
import { RecipesService } from './recipes.service';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';
import { UnitsController } from './units.controller';
import { UnitsService } from './units.service';

/** E02 — Catálogo: insumos, unidades, categorías, proveedores, recetas (BOM) y menú. */
@Module({
  imports: [PlatformModule, AuthModule, AuthzModule],
  controllers: [
    IngredientsController,
    UnitsController,
    CategoriesController,
    SuppliersController,
    ProductSuppliersController,
    RecipesController,
    MenuCategoriesController,
    MenuItemsController,
    MenuModifiersController,
    MenuAvailabilityController,
  ],
  providers: [
    IngredientsService,
    UnitsService,
    CategoriesService,
    SuppliersService,
    ProductSuppliersService,
    RecipesService,
    MenuCategoriesService,
    MenuItemsService,
    MenuModifiersService,
    MenuAvailabilityService,
  ],
})
export class CatalogModule {}
