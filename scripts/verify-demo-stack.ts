export const REQUIRED_SMOKE_ENV_NAMES = [
  'FRONTEND_URL',
  'BACKEND_URL',
  'CORE_AI_URL',
] as const;

export const BACKEND_DEPLOY_ENV_NAMES = [
  'DATABASE_URL',
  'DATABASE_URL_AUTH',
  'REDIS_URL',
  'CORE_AI_URL',
  'CORE_AI_TIMEOUT_MS',
  'PORT',
  'JWT_PRIVATE_KEY',
  'JWT_PUBLIC_KEY',
] as const;

type SmokeEnvName = (typeof REQUIRED_SMOKE_ENV_NAMES)[number];

export type DemoStackService = 'frontend' | 'backend' | 'core-ai' | 'database';

export interface DemoStackCheck {
  service: DemoStackService;
  url: string;
  expectation: string;
}

export interface DemoStackCheckResult {
  service: DemoStackService;
  ok: boolean;
  status?: number;
  expectation?: string;
  error?: string;
}

export interface MissingEnvReport {
  ok: false;
  missing: SmokeEnvName[];
  message: string;
}

export interface DemoStackResult {
  ok: boolean;
  missingInputs: SmokeEnvName[];
  checks: DemoStackCheckResult[];
  failedServices: DemoStackService[];
}

type SmokeEnv = Partial<Record<SmokeEnvName, string | undefined>>;
type CheckRunner = (check: DemoStackCheck) => Promise<DemoStackCheckResult>;

const REDACTED = '<redacted>';
const MISSING = '<missing>';
const FETCH_TIMEOUT_MS = 10_000;

export function redactValue(value: string | undefined): string {
  return value && value.trim().length > 0 ? REDACTED : MISSING;
}

export function buildMissingEnvReport(
  env: SmokeEnv,
): MissingEnvReport | { ok: true; missing: [] } {
  const missing = REQUIRED_SMOKE_ENV_NAMES.filter((name) => !env[name]?.trim());

  if (missing.length === 0) {
    return { ok: true, missing: [] };
  }

  return {
    ok: false,
    missing,
    message: `Missing required deployment inputs: ${missing.join(', ')}`,
  };
}

export function normalizeServiceUrl(baseUrl: string, path = '/'): string {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  return new URL(normalizedPath, normalizedBase).toString();
}

export function buildDemoStackChecks(
  env: Required<SmokeEnv>,
): DemoStackCheck[] {
  return [
    {
      service: 'frontend',
      url: normalizeServiceUrl(env.FRONTEND_URL, '/'),
      expectation: 'Vercel frontend responds without local services',
    },
    {
      service: 'backend',
      url: normalizeServiceUrl(env.BACKEND_URL, '/api/health'),
      expectation: 'Render backend health endpoint responds',
    },
    {
      service: 'core-ai',
      url: normalizeServiceUrl(env.CORE_AI_URL, '/health'),
      expectation: 'Render core-ai health endpoint responds',
    },
    {
      service: 'database',
      url: normalizeServiceUrl(env.BACKEND_URL, '/api/health'),
      expectation:
        'Supabase database is linked through backend deployment configuration',
    },
  ];
}

export async function fetchDemoStackCheck(
  check: DemoStackCheck,
): Promise<DemoStackCheckResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(check.url, {
      method: 'GET',
      signal: controller.signal,
    });

    return {
      service: check.service,
      ok: response.ok,
      status: response.status,
      error: response.ok ? undefined : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      service: check.service,
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown check failure',
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runDemoStackChecks(
  env: SmokeEnv = process.env,
  runner: CheckRunner = fetchDemoStackCheck,
): Promise<DemoStackResult> {
  const missingReport = buildMissingEnvReport(env);

  if (!missingReport.ok) {
    return {
      ok: false,
      missingInputs: missingReport.missing,
      checks: [],
      failedServices: [],
    };
  }

  const configuredEnv = env as Required<SmokeEnv>;
  const checks = buildDemoStackChecks(configuredEnv);
  const results = await Promise.all(
    checks.map(async (check) => ({
      ...(await runner(check)),
      expectation: check.expectation,
    })),
  );
  const failedServices = results
    .filter((result) => !result.ok)
    .map((result) => result.service);

  return {
    ok: failedServices.length === 0,
    missingInputs: [],
    checks: results,
    failedServices,
  };
}

function redactEvidence(text: string | undefined): string {
  if (!text) {
    return '';
  }

  return text
    .replace(/https?:\/\/\S+/gi, REDACTED)
    .replace(/([A-Za-z0-9._%+-]+=)[^\s,;]+/g, `$1${REDACTED}`)
    .replace(/token[^\s,;]*/gi, `token=${REDACTED}`)
    .replace(/secret[^\s,;]*/gi, REDACTED)
    .replace(/postgres(?:ql)?:\/\/\S+/gi, REDACTED)
    .replace(/redis:\/\/\S+/gi, REDACTED);
}

export function formatDemoStackReport(result: DemoStackResult): string {
  const lines = [
    'Demo stack verification',
    `Required smoke inputs: ${REQUIRED_SMOKE_ENV_NAMES.join(', ')}`,
    `Backend deploy env names: ${BACKEND_DEPLOY_ENV_NAMES.join(', ')}`,
    `Input values: ${REQUIRED_SMOKE_ENV_NAMES.map((name) => `${name}=${redactValue(process.env[name])}`).join(', ')}`,
  ];

  if (result.missingInputs.length > 0) {
    lines.push(
      `Missing required deployment inputs: ${result.missingInputs.join(', ')}`,
    );
  }

  lines.push(`Demo stack ready: ${result.ok ? 'yes' : 'no'}`);

  for (const check of result.checks) {
    const status = check.status ? `HTTP ${check.status}` : 'no-status';
    const expectation = check.expectation ? ` — ${check.expectation}` : '';
    const detail = check.error ? ` — ${redactEvidence(check.error)}` : '';
    lines.push(
      `${check.service}: ${check.ok ? 'PASS' : 'FAIL'} (${status})${expectation}${detail}`,
    );
  }

  if (result.failedServices.length > 0) {
    lines.push(`Failed dependencies: ${result.failedServices.join(', ')}`);
  }

  return lines.join('\n');
}

export async function main(): Promise<number> {
  const result = await runDemoStackChecks();
  console.log(formatDemoStackReport(result));
  return result.ok ? 0 : 1;
}

if (require.main === module) {
  void main().then((exitCode) => {
    process.exit(exitCode);
  });
}
