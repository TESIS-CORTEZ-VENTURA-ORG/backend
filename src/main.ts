import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  // Todas las rutas bajo /api (contrato backend.md §7).
  app.setGlobalPrefix('api');
  // Bind to 0.0.0.0 so the app is reachable inside containers (Hetzner + Coolify).
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
void bootstrap();
