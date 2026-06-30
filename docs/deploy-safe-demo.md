# Deploy the safe demo stack

This checklist links the GastronomIA demo across Vercel frontend, Render backend, Render core-ai, and Supabase Postgres without exposing secret values. Use provider dashboards or interactive CLI prompts for real values; commits, logs, and SDD evidence should contain variable names and redacted placeholders only.

## Quick path

1. Confirm all provider projects/services exist and point at the intended PR3/base branch boundary.
2. Configure provider environment names from the tables below without putting values on the command line.
3. Dry-run or inspect provider state with read-only commands before any manual production deploy.
4. Run `bun run deploy:check` from `backend/` with URLs supplied by secure local/provider environment.
5. Save the redacted evidence template from this document with every failed check and dependency name.

## Provider checklist

| Provider | Resource | Required confirmation |
|---|---|---|
| Vercel | Frontend project rooted at `frontend/` | Production env names exist and `NUXT_API_BASE` points to the Render backend origin. |
| Render | Backend service | Service has database, Redis, core-ai URL, timeout, port, and JWT key names configured. |
| Render | Core-ai service | Service has core-ai runtime names configured and binds to provider `PORT`. |
| Supabase | Postgres project | Connection strings are stored only as Render environment values. |

## Environment-name matrix

| Target | Environment names |
|---|---|
| Vercel frontend | `NUXT_SESSION_PASSWORD`, `NUXT_DEMO_PASSWORD`, `NUXT_API_BASE` |
| Render backend | `DATABASE_URL`, `DATABASE_URL_AUTH`, `REDIS_URL`, `CORE_AI_URL`, `CORE_AI_TIMEOUT_MS`, `PORT`, `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY` |
| Render core-ai | `CORE_AI_APP_NAME`, `CORE_AI_DEFAULT_LEVELS`, `CORE_AI_FORECAST_MAX_HORIZON`, `CORE_AI_FORECAST_ENGINE`, `PORT` |
| Smoke verifier input | `FRONTEND_URL`, `BACKEND_URL`, `CORE_AI_URL` |

## Safe CLI patterns

These examples are safe because they either avoid values or rely on interactive/provider-secret input. Do not paste secret values into shell history.

```bash
# Vercel frontend inspection and env-name setup
vercel deploy --dry --cwd frontend
vercel env add NUXT_SESSION_PASSWORD production --cwd frontend
vercel env add NUXT_DEMO_PASSWORD production --cwd frontend
vercel env add NUXT_API_BASE production --cwd frontend
vercel deploy --prod --cwd frontend

# Render read-only inspection before manual provider action
render services --output json
render keyvalues list --output json

# Render deploy mutation pattern; use only after human approval, not from SDD apply
render deploys create <service-id>

# Secret-safe smoke verification; provide URLs from secure local/provider environment
bun run deploy:check
```

## Post-deploy smoke verification

Run the verifier only with URL inputs supplied securely. The report must say `Demo stack ready: yes` only when all checks pass:

- `frontend`: Vercel frontend responds.
- `backend`: Render backend `/api/health` responds.
- `core-ai`: Render core-ai `/health` responds.
- `database`: Supabase linkage is represented through the backend health check.

A failed check must block readiness and include the affected dependency name, for example `Failed dependencies: core-ai` or `Failed dependencies: database`.

## Rollback

| Failure | Safe rollback action |
|---|---|
| Vercel frontend regression | Promote the previous successful Vercel deployment or revert the frontend env change in Vercel. |
| Render backend regression | Roll back to the previous successful Render deploy and restore prior provider env values if they changed. |
| Render core-ai regression | Roll back the core-ai service deploy; keep backend `CORE_AI_URL` pointing at the healthy service. |
| Supabase/database connectivity failure | Restore the previous Render database env values or pause release until Supabase health is confirmed. |

## Redacted evidence template

```text
Demo stack verification evidence
Date/time UTC: <timestamp>
Operator: <name-or-role>
Frontend deployment: <redacted>
Backend service: <redacted>
Core-ai service: <redacted>
Supabase project: <redacted>
Command: bun run deploy:check
Input values: FRONTEND_URL=<redacted>, BACKEND_URL=<redacted>, CORE_AI_URL=<redacted>
Demo stack ready: yes|no
Checks:
- frontend: PASS|FAIL — <status> — <redacted detail>
- backend: PASS|FAIL — <status> — <redacted detail>
- core-ai: PASS|FAIL — <status> — <redacted detail>
- database: PASS|FAIL — <status> — <redacted detail>
Failed dependencies: <none|service-name-list>
Rollback performed: <none|action>
```
