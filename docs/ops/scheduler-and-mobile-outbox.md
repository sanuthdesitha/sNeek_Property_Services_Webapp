# Dedicated scheduling and mobile notifications

Page rendering no longer runs scheduled operations. `lib/ops/web-scheduler.ts` is an inert compatibility shim. Its old environment flags cannot reactivate it. This removes the scheduler side effect from ordinary page views, including impersonation; other routes still require their own read/write review.

## Deployment prerequisite (not performed by this change)

Run the dedicated `workers/boss.ts` process with `SNEEK_WORKERS_ENABLED=true`, and without `SNEEK_WORKERS_DISABLED=true`. The worker deliberately remains opt-in. Check `SNEEK_DISABLED_JOBS` and worker diagnostics. After registration, each worker records its own AppSetting heartbeat every minute. Notification tools shows missing/stale heartbeats (three-minute threshold), and whether a live worker has mobile dispatch enabled. Web reads never start or refresh a heartbeat. Merely starting the web server is insufficient: a web-only deployment will no longer run automation or mobile outbox delivery. No environment settings or running deployments were changed here.

All `boss.schedule` registrations now explicitly specify `Australia/Sydney`, including DST transitions. Existing schedules are updated when the worker registers them. Marketing dispatch runs every five minutes; the Google review cache refresh is daily. Existing iCal four-hour cadence remains unchanged. A five-minute `auto-clockout-sweep` owns the former page-load clock cutoff work. `submission-followup-dispatch` processes the cleaner submission QA/report receipts every five minutes; it must not replay client sends or submit forms. Finance automation retains its own due-date and authorization controls; this change does not enable auto-send.

## Worker startup correction (2026-10-18)

Use `npx tsx --tsconfig tsconfig.scripts.json workers/boss.ts` for a dedicated worker (Compose and `npm run workers:dev` now select this configuration). Plain `tsx workers/boss.ts` throws on the `server-only` import in `lib/db.ts` before reaching the worker opt-in checks or registering schedules. The existing CLI config handles that marker outside Next.js; the application/client-bundle guard remains unchanged.

This is a reproduced source startup defect, not confirmation of the live deployment's failure. A Dockerfile-only deployment still starts just the web app. Inspect the actual worker command, startup logs and fresh heartbeat; a pg-boss schedule row alone does not prove a live worker. Keep `SNEEK_WORKERS_ENABLED`, `SNEEK_WORKERS_DISABLED` and `SNEEK_DISABLED_JOBS` under the existing operator policy. Do not enable the full worker merely to restore iCal if other automation has intentionally been disabled.

The existing iCal handler remains `syncAllIcal()` at `0 */4 * * *` in `Australia/Sydney`, selecting enabled integrations with a non-null URL and recording `AUTO` runs. It does not use the legacy 40-minute due helper. Each feed failure is isolated. Manual Sync now uses the same per-property service, records `MANUAL` and the actor, and remains available independently of the worker. Verify a successful AUTO run and updated `lastSyncAt` after a scheduled tick in the deployed environment; manual success alone does not validate automatic scheduling. No deployment or environment change is performed by this correction.

## Unattended iCal follow-up (2026-10-23)

Main at `4a46acc2` includes PR 25's import/startup correction. Its enabled worker starts against a disposable migrated PostgreSQL database; that correction alone does not establish the deployed topology. Dockerfile `CMD` runs only the web server. Page navigation and the compatibility hook never run automatic work. Old Compose comments and diagnostics incorrectly described a web fallback or labelled persisted schedule rows as an active worker; these claims are corrected.

A second source defect was reproduced: the 15-second feed deadline was cleared on response headers, leaving body consumption unbounded. Four stalled bodies exhausted all sync pool slots and a fifth feed never started. The deadline now includes the body; all stalled runs terminate with ERROR and release slots. This defect is proven in a regression test, but no production logs establish whether it caused the reported incident.

### Deployment configuration for review

Before starting a production worker, use an authorized read to confirm the existing `pgboss.version` matches schema **20** for the installed pg-boss 9.0.3. pg-boss can initialize or upgrade its own schema during `start()`; do not start against a missing/incompatible schema under a no-production-migrations restriction. Provisioning/upgrading that schema requires separate authorization. No Prisma schema change is needed by this patch.

No deployment is performed by this change. For a separate long-running worker using the same image/revision and database as the web app, the production command is `npm run workers:start`. To enable only iCal, use `npm run workers:ical`, with explicitly configured `SNEEK_WORKERS_ENABLED=true`, `SNEEK_WORKERS_DISABLED=false` and an operator-reviewed `SNEEK_DISABLED_JOBS` that does not contain `ical-sync`. The iCal command sets `SNEEK_ENABLED_JOBS=ical-sync`; master and per-job disable flags still win. It registers no other domain handlers. Do not replace an existing full worker's scope without reviewing its other responsibilities. Multiple workers share stored schedules; an allowlist controls this process's handlers, not another worker's handlers.

iCal-only limits worker handlers; the sync service still applies its existing reservation/job, assignment, pruning, notification and settings-controlled laundry effects. Review current integration options and organization settings read-only before enabling it. Under the current production-data restrictions, owner authorization must cover the intended sync effects; deployment approval alone should not be taken as permission to perform prohibited operational changes.

For Compose, the existing worker service now forwards `SNEEK_WORKERS_DISABLED`, `SNEEK_DISABLED_JOBS` and optional `SNEEK_ENABLED_JOBS`. Set the allowlist to `ical-sync` only when that is the intended service scope. Keep the web-only master disable flag. No migrations, billing run, laundry change, assignment/status change, or sync invocation belongs in deployment verification commands.

### Runtime verification

1. Confirm the deployed image commit, separate worker replica/process, restart policy, actual start command, database target and effective safety switches. Inspect startup logs for `pg-boss started` and registered handler `ical-sync`. Do not print environment files, feed URLs or credentials.
2. In that worker's already configured runtime, run `npx tsx --tsconfig tsconfig.scripts.json scripts/ical-sync-status.ts`. This only reads shared heartbeat and recent AUTO/MANUAL history, outputs IDs/status/timestamps without URLs or error bodies, and exits nonzero for unavailable reads or an unconfirmed iCal handler. An older worker heartbeat lacks handler capability and remains unconfirmed. Admin System diagnostics exposes the same evidence. Heartbeats prove liveness, not successful feed synchronization.
3. Check stored `pgboss.schedule` for name `ical-sync`, cron `0 */4 * * *`, timezone `Australia/Sydney`. Cron rows alone do not prove execution. The scheduled times are 00:00, 04:00, 08:00, 12:00, 16:00 and 20:00 Sydney; polling adds seconds of delay. A stopped worker does not provide general catch-up for a missed cron tick.
4. Record each enabled feed's latest AUTO run and `lastSyncAt`, keep all browsers closed and do not invoke manual sync. Observe the next actual four-hour boundary and confirm **new** AUTO records, SUCCESS/completion timestamps and advancing `lastSyncAt` for each feed. Inspect ERROR/RUNNING outcomes rather than counting pg-boss completion as feed success. The status script shows only the latest 20 AUTO records across feeds; use the existing per-property sync history for a larger portfolio. A recent MANUAL success is independent evidence.

Local verification used the actual worker, pg-boss 9.0.3 and migrated disposable `127.0.0.1:55439/ical_unattended`, with a local HTTP-304 feed. Only the disposable cron row was accelerated to one minute. Two unattended AUTO SUCCESS records occurred on separate wall-clock ticks with no manual request/page render and no jobs/laundry/invoices created. The opt-in regression is `ICAL_SCHEDULE_SMOKE=1 DATABASE_URL=<fresh disposable URL> npx vitest run tests/db/ical-unattended.test.ts --maxWorkers=1 --minWorkers=1`. It requires the exact loopback database name/port and should run alone. This is not observation of the production four-hour cadence or a changed-booking import.

Production deployment/log/database access is unavailable in this environment. A read-only GitHub deployments request returned `Forbidden` and was not retried. Production root cause, deployed worker configuration, feed responses and unattended execution remain unverified; do not label the production issue fixed until step 4 succeeds after an authorized deployment.

## Mobile outbox contract

`Notification` PUSH inserts are annotated by Prisma middleware; the middleware performs **no external delivery**. The marker is stored atomically with the notification, so a rolled-back transaction leaves no dispatchable row. `createMany(skipDuplicates)` only queues rows actually inserted. Explicit INBOX intents (`intent-` IDs) remain inbox-only.

The `mobile-notification-dispatch` worker runs every minute. It only scans marked PUSH rows, never replays historical unmarked notifications, and uses a conditional update to claim each row. Sending happens after that claim has committed. Its lease is two minutes. Provider timeouts, mixed acceptance, incomplete responses, crashes after claiming and failures to record acceptance become `UNCERTAIN`; they do not automatically resend.

To avoid a schema migration, PUSH `externalId` reserves these values:

- `mobile-outbox:pending` or `mobile-outbox:pending:<category>`
- `mobile-outbox:claimed:<milliseconds>:<token>`
- `mobile-outbox:ACCEPTED`, `SKIPPED`, `FAILED`, `UNCERTAIN`, `REVIEW_REQUIRED`

Email/SMS external provider IDs and PUSH inbox `deliveryStatus`/read state are unchanged. ACCEPTED means Expo accepted the device requests; it does not prove delivery or reading. Review UNCERTAIN outcomes against provider evidence before any manual resend; the Notification tools Delivery review panel exposes held and failed attempts. No blind resend action is enabled by this patch. No migration/backfill of old notifications is required or performed.

Delivery rechecks active user, role-visible content, current audience/master push settings, active devices and exact category preference. All existing inline raw PUSH producers now declare a category; an AST regression test guards this contract. Uncategorized messages remain in the inbox but are held as REVIEW_REQUIRED for mobile delivery and shown in Notification tools, rather than bypassing preferences. Domain assignment reauthorization still belongs to each producer; a category is not a permission grant.

Cleaner day reminders use a unique committed notificationDispatch receipt per cleaner, job and local date before the legacy multi-channel send. Concurrent ticks cannot send twice. ATTEMPTED is not a delivery claim; consult per-channel logs. Interrupted/uncertain attempts are held for review, not blindly retried.

Laundry daily nudges use a stable notification primary key per Sydney day and driver. Competing invocations cannot insert duplicate inbox/mobile messages. Their immediate web push is attempted once after the successful insert; a lost/failed web-push attempt is not retried implicitly.

## Laundry corrections and previews

Laundry invoice preview GET no longer records preview activity. Explicit downloads retain their existing audit behavior. Return/revert state and evidence now commit in one locked transaction with a stale-snapshot check. Completed-record corrections and undo require ADMIN/OPS_MANAGER; undo needs a reason. Drivers can still perform pickup/return and failed-pickup reporting. Repeated return requests reject rather than overwrite the original timestamp.

The approved planner rechecks state under lock, does not rewrite picked-up/returned/suppressed rows or human flagged requests with receipts, and retains confirmation/notification flags while updating permitted future dates. Reapproving an identical plan writes nothing and only actually changed jobs are eligible for approval notifications. KEY_LOST draft scenarios pass approval validation.

## Verification limits

Unit/component tests use mocked transactions and providers under an isolated, outbound-blocked runner. PostgreSQL lock behavior, provider delivery, worker deployment/re-registration and browser/device smoke tests still require an explicitly authorized staging environment. No production database or provider was contacted.
