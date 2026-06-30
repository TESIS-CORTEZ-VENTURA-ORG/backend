import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  BACKEND_DEPLOY_ENV_NAMES,
  REQUIRED_SMOKE_ENV_NAMES,
  buildDemoStackChecks,
  buildMissingEnvReport,
  fetchDemoStackCheck,
  formatDemoStackReport,
  normalizeServiceUrl,
  redactValue,
  runDemoStackChecks,
  type DemoStackCheck,
} from '../../scripts/verify-demo-stack';

const backendRoot = join(__dirname, '..', '..');

describe('backend deploy environment contract', () => {
  it('documents Render backend env names with blank deployment placeholders', () => {
    const envExample = readFileSync(join(backendRoot, '.env.example'), 'utf8');

    for (const name of [
      'DATABASE_URL',
      'DATABASE_URL_ADMIN',
      'DATABASE_URL_AUTH',
      'REDIS_URL',
      'CORE_AI_URL',
      'CORE_AI_TIMEOUT_MS',
    ]) {
      expect(envExample).toContain(`${name}=`);
      expect(envExample).not.toMatch(new RegExp(`${name}=postgres(?:ql)?://`));
      expect(envExample).not.toMatch(new RegExp(`${name}=redis://`));
      expect(envExample).not.toMatch(new RegExp(`${name}=https?://`));
    }
  });

  it('keeps backend env examples free of credential-bearing PostgreSQL URL literals', () => {
    const envExample = readFileSync(join(backendRoot, '.env.example'), 'utf8');

    expect(envExample).not.toMatch(/postgres(?:ql)?:\/\/[^\s`"']+:[^\s`"']+@/i);
    expect(envExample).toContain('DATABASE_URL=');
    expect(envExample).toContain('DATABASE_URL_ADMIN=');
    expect(envExample).toContain('DATABASE_URL_AUTH=');
  });

  it('exposes backend deployment env names by name only', () => {
    expect(BACKEND_DEPLOY_ENV_NAMES).toEqual([
      'DATABASE_URL',
      'DATABASE_URL_AUTH',
      'REDIS_URL',
      'CORE_AI_URL',
      'CORE_AI_TIMEOUT_MS',
      'PORT',
      'JWT_PRIVATE_KEY',
      'JWT_PUBLIC_KEY',
    ]);
  });

  it('adds a deploy:check script that invokes the secret-safe verifier', () => {
    const pkg = JSON.parse(
      readFileSync(join(backendRoot, 'package.json'), 'utf8'),
    ) as {
      scripts: Record<string, string>;
    };

    expect(pkg.scripts['deploy:check']).toBe(
      'bun scripts/verify-demo-stack.ts',
    );
  });
});

describe('secret-safe demo stack verifier helpers', () => {
  it('reports missing smoke input variable names without exposing configured values', () => {
    const report = buildMissingEnvReport({
      FRONTEND_URL: 'https://frontend.example.test',
      BACKEND_URL: '',
      CORE_AI_URL: undefined,
    });

    expect(report.ok).toBe(false);
    expect(report.missing).toEqual(['BACKEND_URL', 'CORE_AI_URL']);
    expect(report.message).toBe(
      'Missing required deployment inputs: BACKEND_URL, CORE_AI_URL',
    );
    expect(report.message).not.toContain('https://frontend.example.test');
  });

  it('redacts secret-like values and keeps absent values explicit', () => {
    const protocol = 'postgresql';
    const credential = ['demo', 'secret'].join(':');
    const hostAndPath = 'db.example.test/app';

    expect(redactValue(`${protocol}://${credential}@${hostAndPath}`)).toBe(
      '<redacted>',
    );
    expect(redactValue('super-secret-jwt-material')).toBe('<redacted>');
    expect(redactValue('')).toBe('<missing>');
    expect(redactValue(undefined)).toBe('<missing>');
  });

  it('normalizes service URLs without printing their values in reports', () => {
    expect(
      normalizeServiceUrl('https://backend.example.test/', '/api/health'),
    ).toBe('https://backend.example.test/api/health');
    expect(
      normalizeServiceUrl('https://core.example.test/base', 'health'),
    ).toBe('https://core.example.test/base/health');
  });

  it('builds checks with dependency names and expectations before fetching', () => {
    const checks = buildDemoStackChecks({
      FRONTEND_URL: 'https://frontend.example.test',
      BACKEND_URL: 'https://backend.example.test',
      CORE_AI_URL: 'https://core.example.test',
    });

    expect(checks.map((check) => check.service)).toEqual([
      'frontend',
      'backend',
      'core-ai',
      'database',
    ]);
    expect(checks.map((check) => check.expectation)).toEqual([
      'Vercel frontend responds without local services',
      'Render backend health endpoint responds',
      'Render core-ai health endpoint responds',
      'Supabase database is linked through backend deployment configuration',
    ]);
  });

  it('converts fetch failures into failed check evidence without leaking URLs', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error('network unavailable');
    };

    try {
      await expect(
        fetchDemoStackCheck({
          service: 'backend',
          url: 'https://backend.example.test/api/health',
          expectation: 'Render backend health endpoint responds',
        }),
      ).resolves.toEqual({
        service: 'backend',
        ok: false,
        error: 'network unavailable',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('PR3 deploy documentation contracts', () => {
  it('documents the Vercel frontend path and required production env names', () => {
    const readme = readFileSync(join(backendRoot, '..', 'frontend', 'README.md'), 'utf8');

    expect(readme).toContain('vercel deploy --dry --cwd frontend');
    expect(readme).toContain('vercel env add NUXT_API_BASE production --cwd frontend');
    expect(readme).toContain('NUXT_API_BASE');
    expect(readme).toContain('Render backend');
    expect(readme).toContain('server/api/**');
  });

  it('documents demo credentials by variable name or placeholder only', () => {
    const readme = readFileSync(join(backendRoot, '..', 'frontend', 'README.md'), 'utf8');

    expect(readme).toContain('NUXT_DEMO_PASSWORD');
    expect(readme).toContain('<redacted>');
    expect(readme).not.toMatch(/password\s*[=:]\s*(?![`"]?NUXT_DEMO_PASSWORD|[`"]?<redacted>)[^\s`<][^\n)]*/i);
  });

  it('provides a secret-safe provider checklist and redacted evidence template', () => {
    const deployDoc = readFileSync(
      join(backendRoot, 'docs', 'deploy-safe-demo.md'),
      'utf8',
    );

    for (const name of [
      'NUXT_SESSION_PASSWORD',
      'NUXT_DEMO_PASSWORD',
      'NUXT_API_BASE',
      'DATABASE_URL',
      'DATABASE_URL_AUTH',
      'REDIS_URL',
      'CORE_AI_URL',
      'CORE_AI_TIMEOUT_MS',
      'JWT_PRIVATE_KEY',
      'JWT_PUBLIC_KEY',
      'CORE_AI_APP_NAME',
      'CORE_AI_DEFAULT_LEVELS',
      'CORE_AI_FORECAST_MAX_HORIZON',
      'CORE_AI_FORECAST_ENGINE',
    ]) {
      expect(deployDoc).toContain(name);
    }

    expect(deployDoc).toContain('vercel deploy --dry --cwd frontend');
    expect(deployDoc).toContain('render services --output json');
    expect(deployDoc).toContain('bun run deploy:check');
    expect(deployDoc).toContain('<redacted>');
    expect(deployDoc).toContain('Rollback');
    expect(deployDoc).not.toContain('postgresql://');
    expect(deployDoc).not.toContain('redis://');
  });
});

describe('demo stack readiness reporting', () => {
  it('checks frontend, backend, core-ai, and database readiness by dependency name', async () => {
    const checks: DemoStackCheck[] = [];
    const result = await runDemoStackChecks(
      {
        FRONTEND_URL: 'https://frontend.example.test',
        BACKEND_URL: 'https://backend.example.test',
        CORE_AI_URL: 'https://core.example.test',
      },
      async (check) => {
        checks.push(check);
        return { service: check.service, ok: true, status: 200 };
      },
    );

    expect(result.ok).toBe(true);
    expect(checks.map((check) => check.service)).toEqual([
      'frontend',
      'backend',
      'core-ai',
      'database',
    ]);
    expect(checks.map((check) => check.url)).toEqual([
      'https://frontend.example.test/',
      'https://backend.example.test/api/health',
      'https://core.example.test/health',
      'https://backend.example.test/api/health',
    ]);
  });

  it('formats ready evidence only when every required service responds', async () => {
    const result = await runDemoStackChecks(
      {
        FRONTEND_URL: 'https://frontend.example.test',
        BACKEND_URL: 'https://backend.example.test',
        CORE_AI_URL: 'https://core.example.test',
      },
      async (check) => ({ service: check.service, ok: true, status: 200 }),
    );

    const formatted = formatDemoStackReport(result);

    expect(result.ok).toBe(true);
    expect(formatted).toContain('Demo stack ready: yes');
    expect(formatted).toContain('frontend: PASS (HTTP 200)');
    expect(formatted).toContain('backend: PASS (HTTP 200)');
    expect(formatted).toContain('core-ai: PASS (HTTP 200)');
    expect(formatted).toContain('database: PASS (HTTP 200)');
  });

  it('records the failed check expectation and affected dependency name', async () => {
    const result = await runDemoStackChecks(
      {
        FRONTEND_URL: 'https://frontend.example.test',
        BACKEND_URL: 'https://backend.example.test',
        CORE_AI_URL: 'https://core.example.test',
      },
      async (check) =>
        check.service === 'database'
          ? {
              service: check.service,
              ok: false,
              status: 503,
              expectation: check.expectation,
              error: 'postgresql demo secret db unavailable',
            }
          : {
              service: check.service,
              ok: true,
              status: 200,
              expectation: check.expectation,
            },
    );

    const formatted = formatDemoStackReport(result);

    expect(result.ok).toBe(false);
    expect(result.failedServices).toEqual(['database']);
    expect(formatted).toContain('Demo stack ready: no');
    expect(formatted).toContain('database: FAIL');
    expect(formatted).toContain(
      'Supabase database is linked through backend deployment configuration',
    );
    expect(formatted).toContain('Failed dependencies: database');
    expect(formatted).not.toContain('secret');
  });

  it('marks demo not ready with the failed dependency name and redacted evidence', async () => {
    const result = await runDemoStackChecks(
      {
        FRONTEND_URL: 'https://frontend.example.test',
        BACKEND_URL: 'https://backend.example.test',
        CORE_AI_URL: 'https://core.example.test',
      },
      async (check) =>
        check.service === 'core-ai'
          ? {
              service: check.service,
              ok: false,
              status: 503,
              error: 'upstream unavailable at token=abc123',
            }
          : { service: check.service, ok: true, status: 200 },
    );

    const formatted = formatDemoStackReport(result);

    expect(result.ok).toBe(false);
    expect(result.failedServices).toEqual(['core-ai']);
    expect(formatted).toContain('Demo stack ready: no');
    expect(formatted).toContain('core-ai: FAIL');
    expect(formatted).not.toContain('https://core.example.test');
    expect(formatted).not.toContain('abc123');
  });

  it('does not run network checks when required smoke inputs are missing', async () => {
    let calls = 0;
    const result = await runDemoStackChecks(
      { FRONTEND_URL: '', BACKEND_URL: 'https://backend.example.test' },
      async () => {
        calls += 1;
        return { service: 'frontend', ok: true, status: 200 };
      },
    );

    expect(calls).toBe(0);
    expect(result.ok).toBe(false);
    expect(result.missingInputs).toEqual(
      REQUIRED_SMOKE_ENV_NAMES.filter((name) => name !== 'BACKEND_URL'),
    );
    expect(formatDemoStackReport(result)).toContain(
      'Missing required deployment inputs: FRONTEND_URL, CORE_AI_URL',
    );
  });
});
