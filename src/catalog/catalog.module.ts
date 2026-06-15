import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthzModule } from '../authz/authz.module';
import { PlatformModule } from '../platform/platform.module';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { IngredientsController } from './ingredients.controller';
import { IngredientsService } from './ingredients.service';
import { ProductSuppliersController } from './product-suppliers.controller';
import { ProductSuppliersService } from './product-suppliers.service';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';
import { UnitsController } from './units.controller';
import { UnitsService } from './units.service';

/** E02 — Catálogo: insumos, unidades, categorías, proveedores y producto-proveedor. */
@Module({
  imports: [PlatformModule, AuthModule, AuthzModule],
  controllers: [
    IngredientsController,
    UnitsController,
    CategoriesController,
    SuppliersController,
    ProductSuppliersController,
  ],
  providers: [
    IngredientsService,
    UnitsService,
    CategoriesService,
    SuppliersService,
    ProductSuppliersService,
  ],
})
export class CatalogModule {}
