import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Unit tests. SWC transforms decorators + emits metadata so NestJS DI works
// (it reads `experimentalDecorators` / `emitDecoratorMetadata` from tsconfig.json).
export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts'],
  },
  plugins: [swc.vite()],
});
