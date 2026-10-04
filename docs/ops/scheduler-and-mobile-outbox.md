# Dedicated scheduling and mobile notifications

Page rendering no longer runs scheduled operations. `lib/ops/web-scheduler.ts` is an inert compatibility shim. Its old environment flags cannot reactivate it. This removes the scheduler side effect from ordinary page views, including impersonation; other routes still require their own read/write review.

## Deployment prerequisite (not performed by this change)

Run the dedicated `workers/boss.ts` process with `SNEEK_WORKERS_ENABLED=true`, and without `SNEEK_WORKERS_DISABLED=true`. The worker deliberately remains opt-in. Check `SNEEK_DISABLED_JOBS` and worker diagnostics. After registration, each worker records its own AppSetting heartbeat every minute. Notification tools shows missing/stale heartbeats (three-minute threshold), and whether a live worker has mobile dispatch enabled. Web reads never start or refresh a heartbeat. Merely starting the web server is insufficient: a web-only deployment will no longer run automation or mobile outbox delivery. No environment settings or running deployments were changed here.

All `boss.schedule` registrations now explicitly specify `Australia/Sydney`, including DST transitions. Existing schedules are updated when the worker registers them. Marketing dispatch runs every five minutes; the Google review cache refresh is daily. Existing iCal four-hour cadence remains unchanged. A five-minute `auto-clockout-sweep` owns the former page-load clock cutoff work. `submission-followup-dispatch` processes the cleaner submission QA/report receipts every five minutes; it must not replay client sends or submit forms. Finance automation retains its own due-date and authorization controls; this change does not enable auto-send.

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
