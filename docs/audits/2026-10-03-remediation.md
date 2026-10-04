> Current-tree verification supersedes the historical final snapshot below: see [2026-10-03-current-verification.md](2026-10-03-current-verification.md).

# Audit remediation — local patch and verification

Baseline: `2077359d8b8123392729c686bad7e4d5f9e4e9c2`, branch `work`.
User authorization: fix verified audit findings locally; no commit, push, deployment, production calls or settings changes.

## Ownership and preservation

The baseline working tree contained no tracked changes and exactly four untracked files: `public/sw.js`, `public/swe-worker-5c72df51bb1f6ee0.js`, `public/workbox-f1770938.js`, `public/worker-b43188693e81ca6e.js`. Those files are preserved. The subsequent source/test/document changes belong to this remediation, divided among security, jobs/Scope, cleaner forms, finance, QA/maintenance, notifications/laundry and root integration. Counts vary while agents work; they are not unexplained preexisting changes.

Audit evidence: `/workspace/audits/sneek-2026-10-03/audit-{cleaner,finance,jobs-scope,notifications,qa}.md` and operating-guide.html. Detailed implementation/test records: `/tmp/fixes-{cleaner,finance,jobs,notifications,qa,security}.md` as finalized by each owner.

Status meanings: **Fixed + tested** means code and mocked regression coverage exist, with full-suite/build results below; it is not a production guarantee. **Configuration/deployment required** means implementation is tested but inactive for live users until explicitly configured/deployed. **Deferred — decision required** identifies remaining business decisions. **Not reproduced** means the specific runtime symptom was not exercised. This final matrix supersedes provisional owner notes; no status implies production deployment or real-provider verification.

## Finding checklist

| ID | Finding / intended result | Status | Owner / primary evidence |
|---|---|---|---|
| S01 | Resolve admitted role before report/job object scoping; block unrelated active-role bypass | Fixed + tested | security; audit-report-authorization, audit-route-role, jobs-route-filters tests |
| S02 | QA progress/photo review ownership and safe report audience | Fixed + tested | security; audit-qa-progress-auth, qa-photo-review tests |
| S03 | Runtime bootstrap must not bypass stored account, active state or 2FA | Fixed + tested | security; audit-auth-login tests |
| S04 | Privileged API live authorization and SSE revocation | Fixed + tested | security; audit-live-session-gates, audit-live-location-auth tests |
| R01 | Cleaning/damage report GET must not generate/store/allocate verification | Fixed + tested | security; missing cleaning report returns explicit409 |
| J01 | Stable unified task IDs, explicit cancellation, atomic revision-checked Scope save | Fixed + tested | jobs; admin-task-sync, job-edit-safety tests |
| J02 | Narrow metadata/People/report-photo edits preserve schedule and priority | Fixed + tested | jobs; job-edit-safety tests |
| J03 | Invalid timing rejected; reschedule atomic and cleaner notification consistent | Fixed + tested | reschedule-safety and job-edit-safety tests |
| J04 | Completion timestamps preserved unless explicitly edited, including QA | Fixed + tested | jobs and QA |
| J05 | Rotation due fields wired, full catalogue retained, counters once per completed original job | Fixed + tested | jobs/cleaner/QA; rotation-completion, rotation-schema tests |
| J06 | Configurable3/4 completed-clean rotation and property-specific plant instructions | Configuration/deployment required | jobs; existing published templates need reviewed regeneration |
| J07 | Weekly detail and three-calendar-month deep-clean evidence review | Deep-clean direction implemented and mock-tested | Explicitly verified deep-clean completion produces an undated owner-scheduling draft after3 Sydney calendar months. Unknown baseline stays unknown; weekly ledger remains review-only. |
| J08 | Conditional plant care avoids inapplicable required watering | Configuration/deployment required | jobs; compose-frequency tests |
| J09 | Property Add task includes current Sydney day and defaults photo proof on | Fixed + tested | jobs |
| J10 | Draft jobs excluded from dispatch and blocked from cleaner actions/assignment | Fixed + tested | root/security/cleaner/jobs |
| J11 | Destructive deletion/reset restricted and settled history protected | Fixed + tested | ADMIN-sensitive verification; locked job/QA/invoice/payroll/paid-history guards; 11 new delete tests + QA reset suite |
| J12 | Optional/not-applicable Scope task semantics | Fixed + tested | Explicit office opt-in, reason and photo required; neutral disposition/event, no completion stamp/carry-forward; no schema migration |
| C01 | Cleaner home/form GET has no clock closure or rework-template creation | Fixed + tested | cleaner; cleaner-form-resolution tests |
| C02 | Auto-clockout compare-and-set prevents overwritten time/duplicate events | Fixed + tested | cleaner; auto-clockout-claim tests |
| C03 | Start briefing acknowledgement survives first-start confirmation | Fixed + tested | cleaner; cleaner-start-preserves-briefing tests |
| C04 | Required/minimum photo counts enforced consistently on server and client | Fixed + tested | cleaner; cleaner-submit-form-contract tests |
| C05 | Pay/damage/task/carry-forward/draft clear persist inside submission receipt transaction | Fixed + tested | cleaner; transaction failure/rollback assertions |
| C06 | Durable QA/report followups retain failed stages and prevent automatic resubmission | Configuration/deployment required | cleaner; submission-followups tests; worker required |
| C07 | Reset/resubmit cannot deduct inventory twice; explicit correction review shown | Fixed + tested | cleaner; submission-stock tests |
| C08 | Reopened payment requests deduplicated; mandatory damage maintenance atomic/private | Fixed + tested | cleaner; submission pay/private maintenance tests |
| C09 | Page loads/post-submit callbacks cannot erase a newly reopened shared draft | Fixed + tested | cleaner; draft lifecycle tests |
| C10 | Existing core evidence destinations preserved; user alone submits | Fixed + tested | cleaner; existing evidence/shared-draft suites; no automated submission added |
| F01 | Finance/Command/client outstanding use issued unpaid balance consistently | Fixed + tested | finance/root; receivables and dashboard tests |
| F02 | Financial reads do not migrate legacy shopping records | Fixed + tested | finance; unmigrated legacy data returns explicit migration-required failure |
| F03 | Xero status guards and stable provider idempotency keys | Fixed + tested | finance; export interruption/retry tests; real provider untested |
| F04 | Client invoice generation serializes and conditionally claims billable work | Fixed + tested | finance; client-invoice-generation tests |
| F05 | Expected invoices match stable IDs/all valid submissions; no false snapshot variance | Fixed + tested | finance; manual reconciliation disclosed |
| F06 | Send-back releases job exclusion consistently | Fixed + tested | finance; invoice integrity tests |
| F07 | Settled adjustment financial/provenance fields immutable | Fixed + tested | finance |
| F08 | Cleaner invoice all-stream atomic claims precede send; ambiguous sends not retried | Fixed + tested | finance; invoice-claim implementation/tests |
| F09 | Paid/exported invoices protected against destructive status/delete/reverse | Fixed + tested | finance; status/export guard tests |
| F10 | Semimonthly optional draft-only cadence, no automatic client email | Configuration/deployment required | finance; cadence API/calendar tests; not enabled |
| F11 | Cutoff and unfinished billing behavior disclosed; no false completed-work promise | Fixed + tested | finance; automatic generation completed-only, manual workflow requires review |
| F12 | Extras edits idempotent/concurrency checked and client notification opt-in | Fixed + tested | finance |
| Q01 | QA submit resolves owned assignment, blocks self-review and foreign amendments | Fixed + tested | QA; qa-submit-authority tests |
| Q02 | QA detail GET derives template without persistence | Fixed + tested | QA; qa-template-read-safety tests |
| Q03 | Damage GET no draft creation; stable report ID, atomic/idempotent submit | Fixed + tested | QA; damage-persistence-safety tests |
| Q04 | Damage autosave preserves server cost and linked case IDs | Fixed + tested | QA |
| Q05 | QA mandatory rework/pay/case state atomic; report failures durable | Fixed + tested | QA |
| Q06 | Reset protects claimed finance and operational history | Fixed + tested | QA |
| Q07 | QA pickup concurrency and legacy proof validation | Fixed + tested | QA pickup/submit authority and structured rework proof tests |
| M01 | Maintenance attachment same-property/atomic, repairs missing task, cancels old task | Fixed + tested | QA; maintenance-write-safety tests |
| M02 | Maintenance completion requires start/proof, updates linked cases | Fixed + tested | QA |
| M03 | Repeated visit/assignment metadata saves preserve timing and evidence | Fixed + tested | QA; maintenance-assignment-safety tests |
| M04 | Staff case comments default private | Fixed + tested | QA; case-comment-private-default tests |
| N01 | Page rendering cannot start operational scheduler | Configuration/deployment required | notifications; web fallback inert, worker-only scheduling |
| N02 | Worker jobs explicitly Sydney; heartbeat detects missing/stale/disabled dispatcher | Configuration/deployment required | notifications; scheduler-parity, worker-heartbeat and dispatch-status tests |
| N03 | Generic Notification creation never sends devices before transaction commit | Configuration/deployment required | notifications; durable mobile outbox/lease uncertainty tests |
| N04 | Mobile delivery checks active audience/preferences/category | Configuration/deployment required | notifications; raw producer categorization review |
| N05 | Legacy cleaner-day/laundry reminders have durable event/day deduplication | Fixed + tested | notifications |
| L01 | Laundry invoice preview GET no history writes | Fixed + tested | notifications |
| L02 | Return/revert/correction atomic with stale revision and authorization checks | Fixed + tested | notifications; laundry-completion-atomic tests |
| L03 | Plan approval protects completed/suppressed task history and notify state | Fixed + tested | notifications; laundry-plan-protection tests |
| L04 | KEY_LOST accepted; UI driver scope/admin corrections/revert reason aligned | Fixed + tested | notifications |
| U01 | Sydney dates consistent across history/detail; Last clean completed-only, year visible | Fixed + tested | root; service-date, completed-history, browser fixtures |
| U02 | Completed performance windows exclude future/unfinished work | Fixed + tested | root; completed-history tests |
| U03 | Status vocabulary complete; pay-request navigation resolves | Fixed + tested | root |
| U04 | Generic case count distinguished from formal damage reports and load failures | Fixed + tested | root; audit-operating-ui/browser tests |
| U05 | Submitted media captions use snapshot labels; access refresh/error recovery | Fixed + tested | root/cleaner; gallery error UI tests; actual codecs untested |
| U06 | Task-photo report rebuild errors visible; retry preserves saved setting | Fixed + tested | root; audit-operating-ui/browser tests |

| R02 | Concurrent report workers cannot overwrite newer published report | Fixed + tested | Durable job lease/token/revision fence; immutable version keys; report tests17, helper coverage100% |
| C11 | Cross-job stock deductions serialize on property-stock rows | Fixed + tested | cleaner; stock-deduction regression suite |
| C12 | Low-stock automation failures remain visible/recoverable | Fixed + tested | cleaner; durable review record/queue |
| F13 | Settlement/export/edit share locks and revalidate lifecycle | Fixed + tested | finance integration review |
| Q08 | QA amendments reuse stable damage/stock action receipts | Fixed + tested | QA tool-effect tests; explicit correction required for already-materialized changes |
| Q09 | Original cleaner rework offer remains pending until accepted | Fixed + tested | QA offer-response and cleaner start guards |

| S05 | Template write endpoints align with displayed ADMIN-only policy | Fixed + tested | security; explicit OPS denial tests |

## Verification boundary

Unit/API tests use `/tmp/sneek-safe-run.py`: no inherited credentials, unreachable dummy local DB, no provider configuration, Node outbound sockets/fetch blocked, scheduler disabled. No dangerous npm build/start/prebuild scripts run. Focused suites are mocked and do not establish real PostgreSQL locking, provider delivery or production readiness. Final frozen-source suite, coverage, standalone typecheck and staged build are complete; results below. Separate browser fixtures use real components and intercepted requests, not a production-connected app.

Recorded focused results before integration: security115 tests/12files; notifications67/12files; root31 tests/6files and9 browser tests. Agent suites overlap and must not be summed. Baseline whole-suite run showed a stale rebook test and two harness-origin URL failures; URL configuration corrected. Final results will replace this provisional section.

## Integration checkpoints (chronological evidence, latest results supersede earlier runs)

- First integrated run (moving working-tree snapshot):485 files,5516 passed,19 failed across4files,76 skipped. Command query mocks and stock lock mocks corrected with meaningful assertions retained; invoice tests were concurrent with finance reservation edits and are being rerun. This is not a green final run.
- Root focused followups: account stats/Command25 passed; Command/rebooking24 passed; final expanded root suites43 passed plus one test-label typo corrected, Command22 then passed. Counts overlap.
- Browser fixtures:9/9 passed, including Sydney date/case labels, empty/error/403 paths, report generation retry, draft cadence save with no invoice creation/sending and read-only cadence ledger. All HTTP intercepted.
- Staged Next production build exit0, source snapshot before latest report/QA/finance additions. Bypassed npm hooks; no environment files copied; mocked Google font responses; original public worker files excluded. This is compilation evidence, not deployment evidence or final-current-tree coverage.

- Latest baseline rerun with corrected harness URLs:5328 passed,1 preexisting rebooking fixture failure,76 skipped; coverage report generated. The fixture now explicitly selects All before checking past-job permission; it does not weaken the rebook permission assertion.
- Jobs Scope/cadence focused66 tests passed; all completion paths expanded with47 passing bulk/QA regression tests. QA latest no-emit TypeScript exit0. Cleaner low-stock/offer followup tests59,14,6 pass (overlapping suites; not additive totals). Notification/worker focused80 distinct tests across17files passed.
- Final-current-source integrated suite/coverage completed (see final results below). No production smoke test, database migration, service startup, worker activation, dependency installation, commit or deployment performed.

## Remaining findings and exact disposition

| ID | Finding | Final disposition | Blocker / next decision |
|---|---|---|---|
| D01 | Quarterly deep-clean scheduling | Implemented and mock-tested; staging pending | User chose undated owner-scheduled draft. Separate planning record avoids mandatory Job.scheduledDate; explicit verification, +3 Sydney calendar months, deduplication, no autoassignment/dispatch/notification/charge. |
| D02 | Closed half-month invoice cutoff | Implemented and mock-tested; staging pending | User chose following morning16th/1st, at-least-started work. Drafts use full Sydney cutoff days, timestamped start evidence, provisional estimates and explicit office reconciliation/approval. Cleaner pay remains separate/unapproved. |
| D03 | Existing templates/plant/no-photo/tick policy/rotation baselines | Configuration/deployment required | Office must review and republish applicable property templates; no silent mass republish/backfill or live exception change. |
| D04 | New worker-only scheduler and recovery processors | Configuration/deployment required | Approve worker deployment/env and schedule registrations; heartbeat/queue checks. Web-only production would not run them. |
| D05 | Historical legacy shopping/missing rework anchors/QA actions without receipts | Deferred — record review required | No production records read or migrated. Fail-closed behavior prevents silent writes/recreated history. Review affected records before migration/correction. |
| D06 | Refunds, external credit notes, reopened stock quantity corrections | Deferred — explicit reconciliation required | Guarded against silent alteration; office uses deliberate existing correction and bookkeeping workflows. No external reversal implemented/executed. |
| NR01 | Specific live video playback failure/corruption | Not reproduced | No uploaded object, codec, headers or device examined. Expiry refresh/captions/error recovery implemented and browser-tested; actual media diagnosis needs approved staging evidence. |
| NR02 | Exact live dashboard dollar amounts and worker/provider health | Not reproduced | Shared selector and worker diagnostics tested; individual production rows, actual schedule liveness and delivered messages not inspected. |
| V01 | Real PostgreSQL end-to-end/concurrency behavior | Deferred — environment blocker |76 DB tests skip without disposable loopback PostgreSQL. No local binaries or cached postgres image; dependency/image installation was not authorized/performed. |
| V02 | Real email/SMS/Expo/Xero/storage and browser-device delivery | Deferred — staging verification required | Mocked/provider-blocked tests and synthetic browser flows pass; no real provider calls authorized. |
| V03 |95% full-file coverage/no metric regression target | Not met | Comparative coverage attached. Many existing full modules remain below95%; no repository-enforced threshold configured. Coverage is not described as passing. |
| V04 | Repository lint command | Existing setup blocker | No repository ESLint configuration. Temporary installed Next config used for comparison; baseline errors remain and are reported, not suppressed. |

The source fixes are locally reviewable. Calendar automation and the real database/provider end-to-end gates are explicitly incomplete; this patch is not certified production-ready. See `2026-10-03-rollout.md` for migration/configuration, staging gates and rollback safeguards.

## Final verification results (frozen source)

| Check | Result | Evidence / boundary |
|---|---|---|
| Full Vitest suite | **5666 passed;76 skipped;0 failed** |499 passing test files,11 skipped;510 total files. Skipped suites require disposable PostgreSQL. `frozen-tests.log` |
| Browser regressions | **9/9 passed** | Real components in intercepted Chromium fixture; timezone America/Los_Angeles. No full database/provider stack. `browser-tests.log` |
| Standalone TypeScript | **Exit0** | `tsc --noEmit --incremental false`, sanitized environment. `typecheck.log` |
| Production compilation | **Exit0** | Direct Next build, separate final-source snapshot, no npm hooks/environment files; Google fonts mocked and outbound connections blocked. Not a deployable artifact. `build.log` |
| Lint comparison | **22 errors/21 warnings baseline and current; no new errors** | Repository lacks config. Temporary installed Next/core-web-vitals config used; not a clean lint gate. `lint-comparison.json` |
| Coverage | **95% full-file target not met** |221 changed source files measured;201 below95% in at least one metric;18 numeric per-file metric decreases. Full totals: lines21.20% (baseline19.23%), branches73.02% (74.17%), functions45.35% (43.19%). `coverage-comparison.json` |
| Patch whitespace | **Pass** | `git diff --check` |
| Package/schema | **Unchanged** | No package/lockfile/Prisma schema edits; no migration added/executed. |
| Original public workers | **Preserved** | Four initial untracked files excluded from patch/staged builds; mtimes remain before remediation. |

Coverage denominators include large existing modules and newly exercised branches; a numeric decline is not by itself proof that a test was removed. The target and no-regression criterion are nevertheless not certified as passed. No production-ready or real end-to-end delivery claim is made.

Final deliverables are `/workspace/audits/sneek-2026-10-03/remediation/`: full tracked+new-file patch, this checklist, rollout/rollback plan, source manifest, owner reports and test/coverage/lint evidence. All code changes remain uncommitted on branch `work` at the recorded baseline. No push, deployment, production worker activation or live template republish occurred.
