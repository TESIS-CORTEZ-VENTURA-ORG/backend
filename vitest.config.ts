import swc from 'unplugin-swc';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// Unit tests. SWC transforms decorators + emits metadata so NestJS DI works
// (it reads `experimentalDecorators` / `emitDecoratorMetadata` from tsconfig.json).
// loadEnv inyecta .env en process.env de los tests (bun no lo propaga a los workers).
export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts'],
    env: loadEnv('test', process.cwd(), ''),
  },
  plugins: [swc.vite()],
});
