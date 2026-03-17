# Final QA Report (2026-03-11)

## Scope completed
- Production build and type-safety checks
- Auth guard and API status-code behavior checks
- Role-based endpoint smoke tests (admin/cleaner/client/laundry)
- Create/edit/delete API smoke tests for high-use admin flows
- Static dead-button scan (predeploy script)

## Automated checks run
- `npm run predeploy:check -- --with-build --skip-db`
- `node_modules/.bin/tsc --noEmit`
- Role API smoke via authenticated `curl` cookie sessions

## What passed
- Build passes on Next.js production compile.
- TypeScript compile passes.
- Dead-button scan reports `0` candidates.
- Authenticated role probes passed:
  - Admin: settings/properties/inventory/laundry alerts APIs return `200`.
  - Cleaner: jobs/pay-adjustments/invoice preview APIs return `200`.
  - Client: reports/approvals/shopping APIs return `200`.
  - Laundry: week/history/options APIs return `200`.
- RBAC deny checks passed (`403`) on cross-role access attempts.
- Admin create/delete smoke passed for:
  - Clients
  - Properties
  - Jobs (with ISO datetime payload)
  - Quotes (valid line item schema)

## Fixes made in this QA pass
- Added centralized API error status mapping helper:
  - `lib/api/http.ts`
- Patched routes to return proper auth statuses instead of generic `400`:
  - `app/api/admin/properties/route.ts`
  - `app/api/admin/notifications/log/route.ts`
  - `app/api/admin/inventory/items/route.ts`
  - `app/api/client/reports/route.ts`
  - `app/api/laundry/week/route.ts`
- Hardened predeploy DB probe so it fails fast instead of hanging indefinitely:
  - `scripts/predeploy-check.ts`

## Critical deploy blockers still open
- `APP_URL` is still localhost (`http://localhost:3000`) in current env; must be set to production domain before deploy.
- `pg_dump` is not installed in this environment; full DB backup workflow requires PostgreSQL client tools.
- ESLint is not configured non-interactively (`next lint` prompts setup), so lint cannot be enforced in CI yet.

## Notes from smoke run
- Job create API requires `scheduledDate` as ISO datetime (for example `2026-03-15T00:00:00.000Z`), not date-only string.
- QA-only users were created during test and then disabled (`isActive=false`, `passwordHash=null`) to prevent access while preserving audit references.

## Recommended go-live gate
1. Set production `APP_URL` and auth/email env vars on target host.
2. Install `pg_dump`/`pg_restore` on target host.
3. Run:
   - `npm run predeploy:check -- --with-build`
   - `npm run backup:create -- --include-uploads --upload-offsite`
4. Deploy and migrate.
5. Run post-deploy role smoke on live URL.
