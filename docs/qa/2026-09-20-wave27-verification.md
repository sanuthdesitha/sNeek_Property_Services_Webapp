# Wave 27 verification - 2026-09-20

Full serial Vitest run with V8 coverage exited 0: 372 files and 4,520 tests passed; one legacy test skipped. Test execution took 1,017.34 seconds plus coverage report generation. Database cases used the isolated loopback synthetic PostgreSQL database. The final production build, including the invoice follow-up, passed compilation, type validation and 713-page generation in 458 seconds (exit 0).

Coverage below is the final full-run measurement for touched source files. The default skill target is 95% for lines, branches and functions; this repository does not configure a required coverage gate. Below-target coverage is reported honestly rather than treated as a passing 95% gate. No comparable pre-change full coverage measurement is available, so coverage regression cannot be established. Separate Playwright browser journeys are not included in these Vitest metrics. Hooks/workers excluded by the repository coverage include configuration are unavailable, not zero.

| File | Lines | Branches | Functions | 95% target |
| --- | ---: | ---: | ---: | --- |
| hooks/use-online-action.ts | N/A | N/A | N/A | Unavailable |
| workers/boss.ts | N/A | N/A | N/A | Unavailable |
| app/api/cleaner/jobs/[id]/action-recovery/route.ts | 0 | 0 | 0 | Below target |
| app/v2/laundry/tracking/page.tsx | 0 | 0 | 0 | Below target |
| components/v2/admin/comms/comms-center.tsx | 0 | 0 | 0 | Below target |
| components/v2/cleaner/form-navigation.tsx | 0 | 0 | 0 | Below target |
| components/v2/cleaner/form-renderer.tsx | 0 | 0 | 0 | Below target |
| components/v2/cleaner/guided-capture.tsx | 0 | 0 | 0 | Below target |
| components/v2/cleaner/job-stages/stage-clean.tsx | 0 | 0 | 0 | Below target |
| lib/ops/web-scheduler.ts | 0 | 0 | 0 | Below target |
| components/v2/cleaner/capture-advice-notice.tsx | 11.11 | 100 | 0 | Below target |
| app/api/laundry/[taskId]/status/route.ts | 31.78 | 12.24 | 25 | Below target |
| components/v2/cleaner/job-stages/stage-wrapup.tsx | 33.11 | 61.36 | 18.75 | Below target |
| lib/notifications/delivery.ts | 33.46 | 66.66 | 11.11 | Below target |
| components/v2/cleaner/media-capture.tsx | 40.06 | 70.76 | 57.14 | Below target |
| app/api/cleaner/jobs/[id]/submit/route.ts | 52.9 | 62.82 | 90 | Below target |
| lib/notifications/email.ts | 54.18 | 82.35 | 66.66 | Below target |
| lib/laundry/cleaner-status.ts | 55.69 | 40.81 | 66.66 | Below target |
| components/v2/laundry/laundry-action-modal.tsx | 57.99 | 53.84 | 46.15 | Below target |
| app/api/cleaner/jobs/[id]/assignment-response/route.ts | 58.51 | 13.15 | 100 | Below target |
| app/api/cleaner/jobs/[id]/start/route.ts | 60.96 | 51.92 | 100 | Below target |
| lib/laundry/week-feed.ts | 63.5 | 90.9 | 75 | Below target |
| lib/notifications/intent-store.ts | 65 | 91.11 | 66.66 | Below target |
| app/api/cleaner/jobs/[id]/gps-checkin/route.ts | 68.44 | 53.06 | 100 | Below target |
| lib/notifications/engine.ts | 69.79 | 58.2 | 83.33 | Below target |
| app/api/jobs/[id]/form/route.ts | 69.96 | 55.2 | 100 | Below target |
| lib/cleaner/route-order.ts | 79.16 | 86.36 | 80 | Below target |
| components/v2/cleaner/job-workspace.tsx | 79.5 | 75.21 | 42.85 | Below target |
| app/v2/cleaner/page.tsx | 81.03 | 74 | 88.88 | Below target |
| app/api/cleaner/jobs/[id]/laundry-status/route.ts | 83.58 | 77.96 | 100 | Below target |
| app/api/cleaner/jobs/[id]/stop/route.ts | 86.48 | 50 | 100 | Below target |
| lib/cleaner/draft-status-snapshot.ts | 88.88 | 73.91 | 100 | Below target |
| app/api/notifications/log/route.ts | 89.32 | 92.06 | 100 | Below target |
| lib/laundry/quantity-baseline.ts | 90 | 79.31 | 100 | Below target |
| components/v2/cleaner/route-timeline.tsx | 90.11 | 80.81 | 72 | Below target |
| app/api/cleaner/jobs/[id]/clock-out-early/route.ts | 93.42 | 61.53 | 100 | Below target |
| lib/validations/job.ts | 95.53 | 33.33 | 100 | Below target |
| lib/notifications/intent-review.ts | 95.65 | 75 | 100 | Below target |
| lib/cleaner/action-receipt.ts | 95.9 | 90.54 | 100 | Below target |
| components/v2/cleaner/job-offer-actions.tsx | 96.11 | 65.71 | 87.5 | Below target |
| components/v2/cleaner/job-stages/shared.ts | 97.32 | 100 | 0 | Below target |
| lib/notifications/feed.ts | 97.56 | 86 | 100 | Below target |
| lib/cleaner/use-draft-save.ts | 97.87 | 96.77 | 100 | Pass |
| components/v2/portal/portal-shell.tsx | 97.91 | 89.65 | 86.66 | Below target |
| lib/cleaner/shared-job-draft.ts | 97.97 | 97.36 | 100 | Pass |
| lib/laundry/failed-pickup.ts | 98.14 | 75 | 100 | Below target |
| components/v2/cleaner/location-tracker.tsx | 99.25 | 86.45 | 87.5 | Below target |
| app/api/admin/notifications/intents/route.ts | 100 | 77.27 | 100 | Below target |
| app/api/cleaner/location/active-job/route.ts | 100 | 100 | 100 | Pass |
| app/api/client/jobs/[id]/route.ts | 100 | 100 | 100 | Pass |
| app/api/client/messages/route.ts | 100 | 91.02 | 100 | Below target |
| app/api/laundry/quantity-exceptions/route.ts | 100 | 57.89 | 100 | Below target |
| components/v2/admin/comms/intent-queue.tsx | 100 | 77.77 | 55.55 | Below target |
| components/v2/cleaner/active-work-status.tsx | 100 | 96.66 | 100 | Pass |
| components/v2/cleaner/shift-route-overview.tsx | 100 | 87.09 | 75 | Below target |
| components/v2/client/job-chat.tsx | 100 | 83.2 | 77.77 | Below target |
| components/v2/client/job-live-panel.tsx | 100 | 98.98 | 100 | Pass |
| components/v2/client/job-progress.tsx | 100 | 100 | 100 | Pass |
| components/v2/laundry/next-stop-execution.tsx | 100 | 79.31 | 100 | Below target |
| components/v2/laundry/quantity-exceptions.tsx | 100 | 74.24 | 66.66 | Below target |
| components/v2/portal/notification-inbox.tsx | 100 | 93.44 | 85.18 | Below target |
| lib/cleaner/action-contract.ts | 100 | 100 | 100 | Pass |
| lib/cleaner/online-action.ts | 100 | 85.18 | 100 | Below target |
| lib/cleaner/shift.ts | 100 | 100 | 100 | Pass |
| lib/client/job-response.ts | 100 | 100 | 100 | Pass |
| lib/client/message-receipt.ts | 100 | 92.72 | 100 | Below target |
| lib/forms/navigation.ts | 100 | 81.81 | 100 | Below target |
| lib/jobs/clock.ts | 100 | 33.33 | 100 | Below target |
| lib/laundry/bag-count.ts | 100 | 100 | 100 | Pass |
| lib/laundry/quantity-pickup.ts | 100 | 84.44 | 100 | Below target |
| lib/notifications/delivery-lifecycle.ts | 100 | 100 | 100 | Pass |
| lib/notifications/inbox-state-store.ts | 100 | 100 | 100 | Pass |
| lib/notifications/inbox-state.ts | 100 | 100 | 100 | Pass |
| lib/notifications/intent-contract.ts | 100 | 89.47 | 100 | Below target |
| lib/notifications/intent-provider.ts | 100 | 96.05 | 100 | Pass |
| lib/notifications/queue-delivery.ts | 100 | 88.88 | 100 | Below target |
| lib/uploads/capture-advice.ts | 100 | 92.1 | 100 | Below target |

## Invoice follow-up

Requested after the full Wave 27 test pass. The final targeted billing run exited 0: 23 files / 232 tests passed, including three actual PostgreSQL generation tests. Desktop/mobile real invoice UI journeys also passed. This covers started/history selection, selected period/client/property scope, non-void invoice exclusion, classic explicit period basis, generation summaries and the maintenance cap correction. These tests overlap the earlier full suite and are not added to its test count.

| File | Lines | Branches | Functions | 95% target |
| --- | ---: | ---: | ---: | --- |
| lib/billing/client-invoices.ts | 54.38 | 62.5 | 25 | Below target |
| components/v2/admin/finance/estate-invoices.tsx | 39.55 | 48.07 | 10.52 | Below target |
| components/admin/client-invoices-page.tsx | 48.84 | 46.29 | 13.04 | Below target |
