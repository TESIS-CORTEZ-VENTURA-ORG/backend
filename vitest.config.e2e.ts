import swc from 'unplugin-swc';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// End-to-end tests (boot the full Nest app via FastifyAdapter + Supertest).
// loadEnv inyecta .env en process.env de los tests (bun no lo propaga a los workers).
export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    env: loadEnv('test', process.cwd(), ''),
  },
  plugins: [swc.vite()],
});
