import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// End-to-end tests (boot the full Nest app via FastifyAdapter + Supertest).
export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
  },
  plugins: [swc.vite()],
});
