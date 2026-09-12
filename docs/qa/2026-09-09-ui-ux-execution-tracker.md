# v2 Improvement Execution Tracker

Updated: 2026-09-13

Scope: all 106 items in `2026-09-09-ui-ux-improvement-proposal.md`. No item is complete merely because code exists. Implemented, automated-tested, browser-verified and external/device-verified are separate milestones. Work remains local unless a later request authorizes publishing.

## Current slice

### Wave 26: Typed evidence, reviewed bulk changes and property portfolio

- Wave 25 was committed as `ec604a5e`. The push attempt was stopped after Git Credential Manager waited without completed authentication; remote publication is not claimed. User authorization to push persists.
- Main cleaner evidence now includes typed template, bulk-pool, task proof, laundry and new carry-forward destinations. Acknowledged destination moves/removals preserve receipt versions; unassigned or no-longer-used evidence blocks submission until explicitly assigned/removed. Recovery uses the current acknowledged destination, and bulk updates preserve concurrent captures. Agent verification: 196 focused tests, five preflight checks, six actual PostgreSQL draft/ledger checks and 20 desktop/mobile real-IndexedDB recovery cases passed. Transport is synthetic; standalone damage/maintenance/lost-found flows remain separate.
- Early laundry sends validate receipt destination, active photo use, form revision, assignment and actor context under the existing job/draft transaction. The service and missing-task planner reuse that transaction; notification effects run after commit. Thirty-three tests passed, including four real PostgreSQL checks covering valid/duplicate sends, competing receipt changes and same-transaction planner creation. A subsequent independent review added a LaundryTask row lock to preserve competing driver pickups, and truthful saved receipts with delivery warnings after post-commit effects fail. Eighteen targeted checks, including six actual PostgreSQL cases, passed; 30 workspace tests cover saved/duplicate/warning wording without automatic resend. No provider was invoked.
- Bulk status review presents each job number/date and exact status, completion-timestamp and assignment consequences. Apply revalidates the reviewed snapshot under row locks, rolls back the whole batch on conflict, and distinguishes unknown outcomes. Thirty-eight new tests, 26 existing Jobs tests, six desktop/mobile browser cases and real PostgreSQL invoicing-race/rollback checks passed. Export previews freeze the exact reviewed CSV, disclose the 5,000-row cap and all-filtered scope, and reject failed or malformed loads. Six export browser cases and 66 final focused tests passed. Date filters now use UTC day-key bounds. Bulk assignment, message drafts and rescheduling remain.
- Client home now leads with authorized property cards and a compact view, personal persisted pins, per-property next service, last completed service/shared report link and pending approvals. Main job summaries honor the Jobs module and progress/report visibility. Preference mutations use owner/scope context, advisory locks and revisions; uncertain saves require reload, and a changed account requires full page reload. Hidden pins remain explicitly clearable. Strict approval summary reads report corrupted records as unavailable. Independent review found and corrected module leakage, stale-account preference rebinding, hidden-pin capacity recovery and false-empty approval summaries. Forty focused property tests plus strict-approval/dashboard regressions passed; both desktop/mobile persistence and real competing preference writes passed. Authoritative guest-readiness and detailed last-result summaries remain beyond this slice.
- Laundry handoff receipts display recorded actor/time, quantities/location/photos, cleaner reason codes/notes and before/after corrections. Names resolve only after authorized task filtering. Eleven final focused receipt tests and both desktop/mobile receipt scenarios passed. Existing confirmation actions record handoffs; the display does not claim unrecorded recipient acceptance. Item 072 meets its stated scope; expected-versus-actual identity tracking belongs to 068/069.
- Combined serial fork-pool regression passed in 525.32 seconds: 339 files passed, one legacy file/test skipped, 4,210 tests passed, including all 21 actual PostgreSQL checks. Three additional portfolio rendering cases and two early-send workspace cases were added after those files ran; their final focused suites passed 15 and 30 tests respectively. Production compilation, type validation and page generation passed in 398 seconds (exit 0) using two page workers; the isolated dev preview was stopped during type validation to release memory. Browser evidence remains the isolated development checks; no production preview was launched. New property coverage before those extra cases was 98.76% lines, 87.75% branches and 91.3% functions; the preferences API/schema each reached 100%, and remaining client branches are documented rather than claimed covered. No whole-programme completion is claimed.

### Wave 25: Verified recovery and workflow checkpoint

- Owner requested completion using agents and authorized pushing after verification on September 13. Existing September work was recovered as uncommitted changes on `redesign`; the 106-item proposal remains the full scope. The wider programme remains open; this wave is a verified checkpoint for the authorized push.
- Form loading/submission share an explicit property projection and revision contract. V2 rejects missing/stale revisions while preserving work; legacy callers without a receipt ledger retain compatibility. Evidence capture for template fields and guided capture now persists originals, prepared files and receipts in actor/job/revision-scoped IndexedDB. Server-owned receipt/tombstone protection serializes attachments, generic saves/clears and submission claims. The initial reviewed slice passed 221 focused tests. Allocated-key reconciliation now persists the allocation before bytes and recovers uncertain completion via exact owned object verification without retransmission. Twelve desktop/mobile real-IndexedDB recovery scenarios passed using synthetic transport; final volatile-original unmount/remount/export checks also passed. Bulk/task/laundry capture integration remains open.
- Submission preflight brings current required-form, laundry, checklist, revision and device synchronization blockers together, with draft-save retry. Offline submission and volatile originals block clock-out attempts. Eleven panel/hook tests and 28 workspace lifecycle tests passed; no live clock-out or provider delivery was performed.
- Notification read controls persist recipient-owned PUSH read state without replacing failed/provider outcomes. Skipped lifecycle emails no longer count as sent; PUSH consent uses web preferences. Device setup is explicit and distinguishes local display checks from provider delivery. Calendar preferences persist. Twelve desktop/mobile browser scenarios passed across notification read/failure handling, device inspection, Jobs scroll restoration and team defaults.
- Recipient follow-up adds personal Needs action/Resolved/clear plus archive/restore independently of provider/job status, with recipient-owned versioned storage and atomic audit records. Delayed mutation acknowledgements cannot replace newer refresh state. All impersonation writes, including the legacy destructive DELETE, are denied. Eighty-six focused checks, both desktop/mobile persistence scenarios and 100% targeted schema/store/API coverage pass. Snooze, domain acknowledgement and retention policy remain open.
- Personal Jobs views, optional columns and scroll restoration now have authenticated reload/Back checks. A mobile layout shift was found and fixed. Team Jobs fallback publication is ADMIN-only outside impersonation and applies to admin/ops. Personal defaults, explicit URLs and current edits take precedence; revision conflicts and audit writes are transactional. This reversible policy assumption was stated during work; no business preference was published by tools.
- Laundry totals distinguish UTC schedule keys from Sydney event instants, cover 23/25-hour DST days and exceed the old 20-row preview. QA adds readiness filters and retryable errors. Maintenance adds a paginated lifecycle board with truthful status outcomes; worker list/count scope matches existing assigned-worker detail authorization, while admin/ops stay broad. Rebooking reauthorizes completed/invoiced non-rework sources and seeds only current authorized property/service into fresh booking validation. Agent regression run: 150 tests passed in 12 files. Laundry next-stop execution now links the existing pickup/drop-off action with recorded quantities, authorized access guides and configured proof requirements. Refresh failures hide stale actions. Six focused tests pass in UTC/Sydney and both desktop/mobile browser scenarios pass.
- Admin Command reports critical read failures, counts unassigned work independently of its preview, exposes existing attention categories and labels incomplete revenue. Client Finance labels latest-20 invoices/latest-50 jobs and distinguishes unbilled estimates/invoice totals from amounts owed, with honest read errors and scoped invoice links.
- Isolated synthetic PostgreSQL on loopback port 55432 passed 14 real DB checks (five saved-view persistence/conflicts, five draft/receipt-ledger locks and four schema checks). Separate real concurrency scripts passed five simultaneous booking requests, conflict/rollback recovery, and competing approval decisions with exact fixture cleanup. Two anonymous form auth tests, six admin personal-view/QA readiness tests and six client finance/rebook/maintenance browser tests passed across desktop/mobile. Fixture-owned data is removed in teardown; no existing business data was used for mutation tests.
- The explicit-exit full run passed 315 files/3,992 tests but failed 14 direct page-invocation tests in one booking file after the Next-required props signature correction. All 68 related booking/rebook/maintenance tests pass after updating empty-props fixtures. Full TypeScript passed after the signature/API fixes; the successful production build and final full suite include the latest notification/recovery changes. Production build passed in 503 seconds, including compilation, type checking and page generation. A parallel final test process later exited with native Windows code 3221225477 before a suite summary; that run is not a pass. The final sequential fork-pool run exited 0 in 516.36 seconds: 321 test files passed, 4,044 tests passed and one legacy test was skipped. All 14 opt-in real database checks were included in this final run. Automatic approval review rejected launching the local production preview (only "blocked by policy" supplied); browser results refer to the isolated development preview.
- Coverage is not universally complete: the notification/Jobs targeted aggregate was 70.96% lines, 80.31% branches and 61.34% functions. New team controls/store/API, context and scroll code separately reached at least 95% across metrics; older workspace/prompt/delivery branches remain gaps. These results do not certify actual phone/provider behavior.
- Final review: staged whitespace checks pass; source was frozen for the successful build/full-suite run. Rebooking (025) and next-stop execution (067) meet their exact proposal requirements and are marked Implemented with unit/browser evidence. Other partial rows identify actual missing behavior, not an assumed requirement for live business pilots.
- Open decisions include global worker visibility policy, live AI provider/model/budget and named outbound test recipients. No external messages have been sent. Unfinished proposal items remain open rather than being relabelled complete.

### Wave 24: Jobs columns and cleaner dialog follow-up

- Implemented optional client/cleaner/schedule list columns with an accessible checkbox menu, personal snapshots and URL state; property/status/actions remain mandatory. The property column retains its responsive minimum width. Invalid URL columns remain visible as an error through unrelated edits and block snapshot writes until corrected/reset. Legacy stored snapshots alone may omit columns; new mutations and acknowledgements remain strict. Team publishing policy remains separate.
- Agent verification passed 146 distinct focused tests and a scoped TypeScript check; independent source review found no actionable issue. Parent full TypeScript and scoped whitespace checks passed. Admin browser verification, including 560px/1100px container boundaries, remains open.
- Fresh full-suite run after Waves 22-24: `npx vitest run --maxWorkers=2 --minWorkers=1` exited 0 in 308.54 seconds: 288 test files passed / 4 skipped, 3,714 tests passed / 14 skipped. Thirteen skips are opt-in DB tests (five Jobs views, four cleaner draft locks, four schema checks); one is the legacy draft-store test. The five Jobs views DB checks passed separately in this wave; the four cleaner draft lock checks were separately exercised in Wave 20, not rerun here. Known AWS SDK v2, performance-mock, React act and dialog-fixture warnings remain. This full-suite result does not certify browser, provider or device behavior.
- Expanded the parent-owned PostgreSQL rollback suite to five passing tests, including legacy v1 snapshots missing columns: reading supplies defaults without rewriting raw storage, a later explicit update persists the chosen columns, and malformed present columns remain an error without replacement. All owned keys were absent afterward. This still does not test independent concurrent transactions.
- Fixed Property info keyboard focus with the existing Radix dialog primitive: entry focus/trap, accessible name and restoration after Escape, Close, backdrop or parent-driven dismissal. The access-image lightbox now also uses an independent Radix modal, isolates background controls and restores the thumbnail; standalone and nested behavior is covered. Parent rerun passed 15 tests across both components. The shared media dialog's existing description warning remains.
- Visible IAB verification on the cleaner job passed: focus entered Close, Escape returned to Property info, and reopening then clicking Close restored that trigger again. No console errors; document client/scroll widths both 476px in the 483px viewport. No form answers, evidence, job status, GPS or provider actions were changed. The agent-owned tab was closed.
- Added a server-only form-revision helper for final assembled schemas and explicit validation context. It preserves array order/IDs/requirements/condition dependencies, canonicalizes object keys and ignores only known presentation data and storage-backed reference URLs. Undefined object properties match JSON omission; invalid arrays, nonfinite values, cycles and custom/executable objects are rejected. Input property values require an explicit JSON-only projection, not raw Prisma records. Parent assembly/reference/revision run passed 58 tests (41 revision cases). It is not yet wired to submission or upload recovery; template selection parity, v1 rollout and commit-time concurrency remain open.
- Next recovery slice: share server-side template resolution, project validation context explicitly, and bind the v2 submit caller to the resolved revision before any status claim. Preserve virtual additional-only display without inventing a persisted FK, keep stale evidence for explicit reconciliation, and treat legacy rollout/commit-time consistency as separate decisions. The 106-item goal remains active; no whole-backlog completion is claimed.

### Wave 23: Personal admin Jobs views

- Implemented item 006's personal-view portion: named filter/search/sort/list-board/density snapshots with Save As, Update, Rename, Delete and personal default/unset. Page, row selection and dialogs are excluded. Jobs-only density preserves the existing responsive row grid. Search and selected-state controls gained accessible names/pressed state.
- Preferences use a versioned per-effective-user AppSetting with transaction advisory locking and revision conflicts. The server derives real/effective-actor context, rejects mismatches and preserves read-only impersonation. Non-JSON authorization denials clear cached views; uncertain mutation results require Reload before another write. Explicit URLs, Reset, Back and edits made before preferences load take precedence over defaults.
- Parent regression run passed 104 tests across seven files; full TypeScript check passed. Independent source review found no actionable issue. Three actual local PostgreSQL rollback tests passed for persistence/JSON validation, stale revisions and malformed-record preservation; exact owned-key count was zero afterward. These tests do not establish independent concurrent-transaction contention or a live browser save journey. The full-suite baseline predates Waves 22/23.
- Team-wide defaults are explicitly separate. The user has been asked who should publish them and whether recipients are all admin/ops users or workforce groups; no publishing permission or membership precedence has been inferred. Column selection and team defaults may remain outside the personal slice.
- Browser verification must use a visible IAB tab for reliable interaction in the current environment. No user-owned business-like records should be mutated for saved-view QA; use isolated test ownership.
- Admin/ops test sign-in remains requested for browser verification. The current cleaner session cannot certify admin controls. A separate visible cleaner job check verified restored progress and timing notices render, Property info opens, and Escape closes it with no console errors. Focus incorrectly returned to BODY; the correction and successful recheck are recorded in Wave 24. No form fields, evidence, job status, GPS or provider actions were changed during this walkthrough.

### Wave 22: Consistent resolved form assembly

- Source inspection confirmed submit omitted displayed quote additionals from its effective schema and normalized normal schemas but not the generated rework branch. Both routes now call `assembleJobForm` for normalization and optional extra-field construction. Additionals retain IDs/order, sanitized labels/instructions and required:false; standard-section opt-outs and root configuration survive. Read failures no longer return a silently unnormalized schema.
- Fixed reference signing for nested child fields, including parents without their own references. Failed signing preserves the original storage key, sibling references still resolve, existing/external URLs remain unchanged and input schemas are not mutated. Nine reference-resolution tests plus nine existing normalizer tests passed with the signing boundary mocked; no provider/browser image-rendering claim is made.
- The virtual `additionals-only` display template is not a persisted submission FK. That existing branch still requires a deliberate resolution; shared assembly alone must not be labeled complete parity. No automatic default template or retention policy has been introduced.
- Final combined verification passed 143 tests across nine files: reference resolution, shared assembly, normalization, field validation/round trip, standard sections, report view model, real POST-handler contracts and route fetch lifecycle/accessibility. TypeScript passed after the form/route corrections. Signing/DB boundaries are mocked; actual submission DB persistence and browser/provider checks remain open. The prior full-suite baseline predates this slice.
- POST-handler verification added: 11 cases execute real POST/assembly/collectors with mocked persistence and post-commit services. They verify rework validation in both layouts, normal submission snapshot additionals, assignment/locked/inactive/missing-template gates and the virtual-fallback rejection. A focused follow-up combining those tests, assembly, references and route fetching passed 45 tests. This does not certify actual DB submission persistence.
- Browser breakthrough: a fresh **visible** IAB tab successfully activates Timeline; hidden-tab failures are insufficient evidence of an application defect. Visible checks confirmed Drive/Timeline, Today/Tomorrow, keyboard custom-date change, travel-mode selection and Schedule/Agenda navigation. Refresh loading state was observed. Empty-route/calendar views rendered coherently at a 483px viewport with no horizontal overflow and no console errors. No job mutations, GPS start or directions-provider actions were executed; the agent-owned tab was closed afterward.
- The browser check found unnamed custom-date and travel-mode inputs. Added `Route date` and `Travel mode` accessible names and a regression test; the new names were verified in the visible browser. Populated timing rows, desktop interaction, draft/recovery journeys and device/provider tests remain open. Direct date `fill` did not retain state in this tool session; keyboard editing did, so only the latter is certified.
- In parallel, a separate agent is assessing item 006 named admin Jobs views and existing per-user persistence/permissions. No saved-view implementation is claimed yet.

### Wave 21: Actor-bound local draft recovery

- The server derives a SHA-256 identity from version, real actor, effective cleaner and job using a structured tuple. The page keys the workspace by this identity and authorized form responses return the same value. A mismatching initial or refreshed form response clears job content, suppresses pending draft saves and requires Reload workspace before proceeding.
- New local recovery envelopes use `cleaner-job-draft-v3:<identity>`, validate their version/identity/state, and read/write/delete only that identity's record. Malformed/misplaced records are preserved rather than overwritten. Storage failures show a local-recovery warning separate from server acknowledgement.
- Older job-only v2 records are neither restored, migrated nor deleted automatically; their owner cannot be established. Their presence is disclosed without displaying their contents. Shared server drafts remain shared between authorized co-cleaners; this does not change their merge policy.
- V2 draft GET/PATCH/DELETE sends `X-Cleaner-Draft-Identity`. The API rejects a supplied identity that differs from the freshly resolved session/job with private 409; PATCH/DELETE compare under the existing draft transaction lock. Headerless classic callers remain compatible. This header is a context consistency check, not an authorization credential; assignment/role/status checks remain necessary.
- Combined verification: 127 tests passed across identity, API atomicity, merge, local store, page scope, workspace lifecycle, coordinator and save transport. Tests cover impersonating actors, legacy/other-identity exclusion, context changes with queued saves, header propagation, invalid storage and quota failure. Independent read-only review found no new actionable issue in the integrated path; TypeScript and scoped whitespace checks passed.
- Fresh full-suite baseline: `npx vitest run --maxWorkers=2 --minWorkers=1` exited 0 in 298 seconds, with 276 test files passed / 3 skipped and 3,524 tests passed / 9 skipped. Eight skipped tests are opt-in database checks; one is the legacy draft-store test. Wave 20 separately exercised four draft-helper checks against actual local PostgreSQL. Dependency/test-harness warnings remain (AWS SDK v2, missing performance mock relation, React act and dialog accessibility fixtures); passing this suite does not establish browser/provider completeness.
- Fresh IAB route check: the old verification tab was absent, so a new read-only tab was created, inspected and closed. Desktop rendering is nonblank and coherent, but Timeline activation still does not change selected mode; no browser error was reported. This is not a save/recovery browser pass. Existing user tab and business-like job were not modified.
- Next contract assessment: resolved recovery revision must account for final normalized rework/additional fields and stable reference keys, not expiring signed URLs. Form read and submit currently assemble schema differently; share that assembly before claiming a common validation revision. Missing/mismatched revisions must preserve evidence for explicit reconciliation, not silently merge into changed destinations. The full durable recovery objective remains unchanged.
- Open: browser/device verification, full form-route execution coverage, resolved form/schema binding, attachment idempotency and receipt recovery, and identity binding on the broader submit/upload workflows. Actor/job isolation alone does not complete the durable queue or items 040/042. No automatic legacy transfer or retention policy was invented.

### Wave 20: Acknowledged cleaner draft saves

- Shared draft PATCH now checks active assignment and the existing locked statuses inside a per-job READ COMMITTED transaction/advisory lock before read/merge/save. Same-editor replacement and cross-editor merging remain unchanged. Standalone save/clear helpers use the same lock, including submit's existing clear call; optional transaction arguments avoid nested transactions.
- Draft API success and error responses are private/no-store with Vary: Cookie, and unexpected diagnostics are sanitized. Client saves require both `ok: true` and a valid acknowledgement timestamp; HTTP errors, network failures and malformed acknowledgements are visible with explicit Retry instead of being silently ignored.
- Initial verification: 56 tests passed across API atomicity, existing merge behavior, client acknowledgement validation and status/retry rendering. Transaction concurrency and rollback are simulated, not actual PostgreSQL checks. TypeScript passed for that initial implementation.
- Workspace mounts are now keyed by effective cleaner and job, preventing reuse of in-memory form state when either changes. Two page tests passed for separate mount keys and active assignment denial. This does not scope the existing job-only localStorage mirror by real/effective actor or form version.
- Review follow-up: added a per-workspace FIFO coordinator with immutable JSON snapshots, edit-time acknowledgement invalidation and reset/unmount guards. Successful submission drops queued saves, ignores old completions and removes the local mirror. A fresh post-submit load releases the temporary guard so server-reopened jobs can become editable again; pre-submit loads cannot release it.
- Local mirroring now runs on edits before the network debounce. Timer cleanup cancels pending timers instead of causing a network save on every edit. Visibility/pagehide delivery is best effort; queued requests are suppressed on unmount and interrupted network requests can still commit server-side. No durable delivery or cross-request idempotency guarantee is implied.
- Combined regression verification now passes 131 tests across nine files: draft API, merge, client acknowledgements, coordinator with real client/deferred responses, status/retry rendering, mount-scope page, real JobWorkspace lifecycle, upload pipeline and draft-store recovery. The 24 workspace cases cover debounce, retry, queued acknowledgement suppression after submit, reopened status, failed restoration, stale loads and non-JSON access denial. Stage presentation and GPS/provider boundaries are mocked; these are not browser/device journeys.
- Actual PostgreSQL follow-up: four opt-in helper tests passed against the validated loopback database. They use synthetic draft keys, rollback every write, observe actual lock contention, verify transaction reuse and check exact owned keys are absent afterward. This verifies helper locking/rollback, not API authorization under live races or the complete submission transaction.
- Restoration correction: initial draft GET must return a valid envelope or explicit null before hydration, local mirroring or autosave can proceed. Failures use Try again; request generations reject stale restore results. Temporary refresh errors keep active upload controls mounted, while 401/403 (including non-JSON responses) clear job content and suppress queued saves before parsing. Reauthorization requires fresh restoration.
- A separate full-suite attempt exited 1 with the three then-unfixed restore cases; those cases now pass in the focused run. No fresh full-suite pass is claimed. Final TypeScript check passed after the restoration/access-denial corrections (3072 MB heap, 16 MB semi-space, no emit/incremental); scoped diff whitespace checks passed.
- Browser save/retry walkthrough, durable upload attachment receipts, real/effective-actor local recovery and submit-wide transactional coordination remain open. The existing signed-in IAB route was inspected, but no new save/submit browser pass was performed against its business-like job. No full offline queue or durable save guarantee is claimed; items 040/042 are not completed by this prerequisite.

### Wave 19: Evidence upload integrity and recovery groundwork

- Fixed shared v2 upload pipeline receipt loss: temporary video cleanup failures no longer reject a completed batch or prevent the next queued video from running. Successful receipts remain available to the caller.
- Videos no longer automatically resend after failure solely because compression reduced them below the photo retry threshold. Direct and multipart results require nonempty string keys and URLs before they can be attached; incomplete success receipts are surfaced for explicit recovery rather than auto-retried.
- Focused pipeline verification: 21 tests passed, including cleanup rejection, small-video no-retry and incomplete direct/multipart receipts. Compression and transport boundaries are mocked; this does not verify device codecs, storage quotas or providers.
- Broader upload regression run passed 36 tests across pipeline, compression, draft-store recovery and upload-dropzone; TypeScript passed after the changes.
- Existing `lib/uploads/draft-store.ts` is not connected to v2 MediaCapture. Item 040 remains Partial: actor/job/form/field-scoped persistence, prepared-file/source preservation, explicit revalidation and attach-receipt recovery still need end-to-end integration. Navigation can still lose in-memory failures. No claim of durable cross-navigation uploads is made.
- Integration assessment: guided capture and bulk assignment bypass MediaCapture; they must use the same recovery controller. StageClean does not pass jobId through to FormRenderer, and the workspace local mirror is keyed only by job. A complete solution must preserve real/effective actor identity, resolved form/schema and typed destination (including task proof and unassigned bulk media).
- Next implementation prerequisite: workspace autosave ignores HTTP status, while draft PATCH performs non-atomic read/merge/save and returns only a timestamp. Uploaded receipts need an idempotent, acknowledged attachment path and reconciliation after lost responses; retrying a known receipt must not resend its blob. No retention, cross-actor transfer, replacement or completed-job exception policy is assumed.

### Wave 18: Pre-arrival prerequisites and access audience isolation

- Added real daily-briefing assembler coverage: 18 cases verify restricted/malformed audiences are excluded, visible and legacy entries remain, filtering happens before limits, reference-image sources remain independent, and accepted/nonremoved Sydney-day scoping is preserved. Spoken-script checks cover hidden-text exclusion and the reference-photo reminder; the current builder does not narrate access notes.
- Per-job briefing history now selects only jobs scheduled before the current job; it is not relabeled as a cleaner-attendance baseline. Briefing and property-access API responses explicitly use private/no-store and Vary: Cookie on success/error; unexpected exceptions return generic 503 errors rather than internal diagnostics.
- Combined verification: 70 tests passed across daily assembler, job briefing API, property-access API, shared access-guide and existing start-briefing tests. All DB/provider boundaries were mocked; no live device/provider claims. Fresh-tab IAB activation remained unresponsive, so route visual interaction remains unverified.
- Final TypeScript check passed after adding the assembler tests and correcting their Vitest generic signature for this repository's installed version.

- Item 037 source assessment found no reliable historical snapshot across access, hazards, timing and task text. Assignment is not attendance, property values are overwritten, and existing hashes cannot reconstruct individual changes. Do not label current instructions as changed or unchanged since a prior visit. A prospective, server-owned baseline design remains required; item 037 stays Planned.
- Fixed an access audience projection defect: the property-access route previously removed audience before filtering. It now filters raw entries before display sanitization. Existing CLEANER/LAUNDRY/BOTH rules, legacy absent audience, laundrySameAsCleaner and property authorization predicates are preserved. Unknown audiences remain hidden.
- Daily briefing fallback instructions and guide-image indicators now apply the same cleaner audience predicate. No access values, provider messages or database records were mutated.
- Verification: 26 API/shared access-guide tests passed, including both reader audiences, same-as-cleaner, assignment/team denial and image-key redaction. TypeScript passed (3072 MB heap, 16 MB semi-space, no emit/incremental); focused diff whitespace checks passed. Daily briefing end-to-end output and portal visual checks remain open.

### Wave 17: Shared cleaner timing and route date contract

- Route request lifecycle corrected: abort plus generation guards prevent stale requests/JSON bodies from replacing newer dates. Responses must contain a valid matching date and valid unique stop records. Loading, wrong-day and failure states hide stale job, offer, directions and reorder actions; Refresh supports recovery. Existing ownership APIs, timing and order rules are preserved.
- Combined verification now passes 128 tests across eight route/timing/calendar files, including 16 lifecycle cases and one integration test mounting the actual Drive/Timeline views without network or GPS work.
- TypeScript passed after the route lifecycle changes using the 3072 MB heap / 16 MB semi-space command recorded below.
- Live switching investigation: ordinary Schedule navigation also fails to activate in the same IAB tab. Temporary Timeline handler logging produced no activation log after Fast Refresh, and was removed. Source review found no cancelling handler or parent mode reset. Cause remains unproven; user was asked whether manual activation works. This is not certified as a route-only bug or a hydration failure.

- Route-mode verification follow-up: shared cleaner segmented buttons now expose `aria-pressed`. New mode-switch test verifies Drive/Timeline mount switching and selected state in both directions; it and the calendar suite pass (11 tests). Live in-app browser still remains in Drive after semantic, keyboard and pointer activation, including a clean reload; captured console shows Fast Refresh but no error. Do not treat the isolated test as resolution of this runtime discrepancy. No job mutations or device/provider actions were performed.

- Final raw planned-time display gaps corrected: Calendar validates its compact start/finish labels, and Timeline uses the shared planned-time summary rather than raw strings. Added calendar regression tests for malformed times and finish-only schedules. This follow-up passed 38 focused tests (calendar, timing summary, route simulation).
- Post-follow-up TypeScript check passed (exit 0). In-app browser eventually rendered the desktop Route page after compilation; current signed-in cleaner had no stops today. Screenshot showed a readable empty state, but Timeline click produced no visible state change. Investigate hydration/control behavior before claiming route interaction or timing-label visual verification. No driving, GPS or job mutations performed.
- Local server was confirmed stopped (no listener on 3010), then restarted loopback-only with scheduler disabled, existing `.next-dev` cache preserved, and hidden process. Logs: `%TEMP%/sneek-wave17-dev.out.log` and `.err.log`. Browser route inspection timed out during compilation; no new route visual pass is claimed.

- Review follow-up: fixed invalid explicit early-arrival overrides incorrectly falling back to standard arrival; unknown arrival stays unconfirmed. Detail banners now validate times through the same summary. Added the missing next-stop panel summary, retained fullscreen timing, and made finish-only planned times visible in Jobs.
- Fresh post-review TypeScript check completed successfully (exit 0) using the 3072 MB heap / 16 MB semi-space command below.
- Route simulation now anchors the first stop on its known access/planned start, and reorder guards identify newly affected jobs rather than only comparing violation counts. Regression coverage now totals 108 passing tests across the five timing/calendar/route files.
- TypeScript succeeded with `node --max-old-space-size=3072 --max-semi-space-size=16 node_modules/typescript/bin/tsc --noEmit --pretty false --incremental false` before the latest review corrections; a fresh check is being run. Interrupted browser session did not verify route/detail: isolated QA assignment was recovered by exact ID, deleted (zero remaining), and cleaner deactivated. Raw invalid planned-time presentation in calendar/timeline remains to be corrected; full route/detail/desktop visual verification remains open.

- Added a shared timing summary to Today, Jobs, Calendar, job-detail timing banners, route timeline and inline Drive mode. Planned times remain separate from guest access/arrival constraints; contradictory windows and malformed times display advisory warnings without changing stored schedules.
- Same-day arrival fields now reach calendar and route DTOs. Route estimates wait for late checkout and use the earlier applicable planned/guest deadline. Invalid estimated durations use the existing two-hour fallback.
- Route page/API use Sydney day boundaries, including DST, preserve active assignment ownership and exclude skipped jobs. Invalid explicit dates return 400; API errors are private/no-store and page read failures offer Retry. Raw internal notes are not returned.
- Verification: 104 focused tests passed across route contracts, simulation, timing summary and calendar page/UI. Mobile browser checks of Today, Jobs and Calendar found matching early/late/conflict labels and no horizontal overflow. Exact temporary assignment removed and QA cleaner deactivated.
- Open verification: route and job-detail visual checks, desktop timing layouts, fullscreen Drive presentation and broader regression coverage. TypeScript first failed with a heap allocation error; a 4096 MB retry exited 1 without diagnostics. No successful current type check is claimed. No GPS/provider behavior tested.

### Wave 16: Cleaner calendar month and timing correctness

- Calendar queries now use the selected Sydney month instead of the oldest 400 assignments. The exact active-assignment ownership predicate is preserved; date grouping uses Sydney days and month boundaries account for DST. Invalid month input falls back to the current Sydney month; supported navigation spans 2000-2100.
- Month/agenda share the same server-loaded month, with URL month navigation and Today. Empty states describe only that month. Read failures render an explicit Retry link rather than a false empty calendar. The month query has no row truncation; very high-volume month performance remains unbenchmarked.
- Calendar rows distinguish planned start/finish from late-checkout earliest-start and early-check-in ready-by constraints. Day buttons expose dates, job counts, selection and today's state to assistive technology. Existing inline offer actions remain outside links.
- Verification: 40 page/component tests passed, covering scoped queries, DST/grouping, malformed month inputs, failure states, timing labels and navigation. Browser checks: isolated cleaner mobile/desktop without overflow, September/October navigation, empty selected-month agenda, Today, timing badges, job detail and Back. Temporary assignment deleted by exact ID (zero remaining), QA cleaner deactivated; no job/offer mutations submitted.
- Remaining for 038: unified timing hierarchy across other lists, routes and job detail, plus missing/contradictory timing resolution. Item 037 change-since-last-visit brief has not been implemented by this slice.
- Final Next.js generated-route type check caught an optional page-argument signature; corrected it to the required PageProps object. TypeScript passed after correction.

### Wave 15: Booking review information

- Added read-only, private/no-store booking-review data with exact client/VA property scope and booking authorization. Price calculation uses the existing booking calculator inputs, only when finance visibility and invoice-view permission allow it. Hidden prices are not calculated or returned; failures and invalid amounts are unavailable rather than zero.
- Review now shows the existing service catalogue overview, access-information presence without codes, validated default guest check-in/out (explicitly not a confirmed cleaning appointment), preliminary service estimate/GST component and scheduling approval conditions. Stale responses are discarded; failure/Retry and focus refresh are explicit. Missing estimates do not impose a new booking policy or block otherwise-authorized requests.
- Verification: 147 tests passed across review API/UI, booking flow and reload recovery; TypeScript passed. Browser walkthroughs checked client live estimate/access/timing, mobile bounds, simulated 503/Retry, and a property-scoped booking-enabled VA without invoice-view permission (hidden pricing DTO and no monetary UI). Desktop had no overflow. No booking POST or provider call; temporary actors deactivated and test team removed.
- Remaining for 026: contractual per-service inclusions/exclusions and property-specific access prerequisites beyond whether information is recorded; actual reservation-specific timing impacts and negotiated-rate/extra-work review. The catalogue overview is not presented as a contractual checklist, and preliminary pricing is not a confirmed quote.

### Wave 14: Scoped same-tab booking recovery

- The server supplies a SHA-256 digest of actor/client/team/property scope and available property IDs. Estate booking uses it to isolate validated sessionStorage drafts and request receipts. Loads perform no writes; malformed envelopes, mismatched payloads and inaccessible storage are distinct from an empty draft.
- Editing notes and selection restore on reload; dates are revalidated and an unavailable saved date is not silently replaced. Unresolved submissions restore as frozen reviews with the exact original body/key and explicit Retry request, never an automatic POST. Confirmed requests restore confirmation; intentionally starting another booking requires clearing that receipt first.
- The request key must be saved before sending. Failed storage writes prevent POST; failed receipt removal prevents another booking. Different actor/client/scope context cannot restore the previous context's draft. This is same-tab reload recovery, not cross-device or guaranteed browser-close persistence; other mutation forms remain outside this slice.
- Verification: 172 tests passed in the six-file booking integration run; a subsequent recovery suite passed 9 tests including one new confirmed-receipt removal failure case. TypeScript and diff checks passed. Existing tests now clear tab storage between cases, matching independent-user test isolation.
- Real browser: failed intercepted POST, page reload, restored notes/frozen review with no auto resend, explicit identical-key/body retry, confirmation after another reload, and cleared notes for a new intentional booking. Mobile/desktop had no horizontal overflow. No live booking POST/provider call; temporary QA user deactivated and browser closed.

### Wave 13: Idempotent booking retries

- Booking POST accepts an optional UUID `Idempotency-Key`. The actor/key identifies a deterministic lead primary key; a normalized client/payload fingerprint rejects reuse for another booking with 409. Current authentication, module visibility and property scope are checked before replay. A transaction advisory lock serializes concurrent attempts; receipt and request are the same database row, with both booking audits committed inside that transaction.
- Replays return the original request ID without another lead, audit or notification attempt. Post-commit notification rejection no longer returns a false booking failure: the committed request is returned with a delivery warning. This does not claim successful provider delivery or crash-safe notification dispatch.
- Estate booking retains its exact submitted body/key in memory, freezes edits after uncertainty and offers explicit Retry request; no automatic resend. A successful intentional new booking uses a new UUID. Access/conflict errors require context reload; missing crypto sends nothing and shows an error.
- Verification: 96 booking UI/route/approval/availability tests and TypeScript passed. `scripts/qa/verify-booking-idempotency.cjs` exercised the real helper against local PostgreSQL: five concurrent attempts created one lead, changed fingerprint was rejected, failed transaction rolled back and retry then succeeded. Two UUID-isolated test leads were deleted by exact ID; no providers called.
- Browser: intercepted first POST failed; only one attempt existed until explicit Retry, which reused the identical body/key and reached confirmation. Mobile/desktop had no horizontal overflow. Temporary actor deactivated. No live booking POST or notification was sent.
- Additional shared-authorizer regression check: 32 client-scope/VA-permission tests passed; diff check passed.
- Remaining: request-key/draft restoration after reload or device change; legacy wizard adoption (header is optional for compatibility); durable notification outbox/crash recovery; broader booking-review details. Receipt retention currently follows lead retention. Item 026 remains Partial.

### Wave 12: VA account context and booking reliability

- VA account banners now distinguish loading, confirmed identity and unconfirmed access. Mismatched actor payloads and failed access cannot label the page with another account's name/team. Impersonation context changes invalidate the navigation identity. Mobile banner, denial and Retry recovery were browser checked; 17 layout/refresh tests passed.
- Booking review now includes server-authorized acting-for and actor identity with the selected property, service and full date. The in-memory form key includes actor/client/team/property scope and available property IDs; this is not persisted draft storage. Property read failures no longer masquerade as an empty account.
- Availability requests abort obsolete work, reject malformed dates, clear stale selections and prevent review until current dates load. Definitive access failures require a context reload. A submit lock prevents same-tick duplicate requests; uncertain results block resending because the existing API can fail after committing a request.
- Browser checks used a temporary property-scoped VA team/user: mobile/desktop review and account labels, one intercepted POST on double-click, pending control lock, availability failure/retry, and scoped VA search. No booking POST reached the server. Full server idempotency, persisted scoped drafts and context-before-mutation coverage beyond booking remain open.
- Final UI integration: 57 tests passed (40 booking reliability, 9 layout gates, 8 navigation refresh), and TypeScript passed. A dropped-response browser check confirmed resend remains blocked. Temporary actors were deactivated and teams removed by exact IDs.
- Follow-up route audit found availability omitted the VA property restriction. The route now intersects requested ID, client ownership, active status and resolved property scope. Nine route tests passed; authenticated local requests returned 404 outside an explicit grant and 200 inside it. Existing policy is unchanged: an empty saved team list means unrestricted, while an empty resolved scope means no allowed property.
- Booking POST now uses the authorized client's ID/contact fields for lead ownership and notifications, not the assistant's own client link; audit/requested-by attribution remains the acting user. Fifteen tests exercise real portal authorization with mocked database/providers, including an unlinked VA, wrongly linked actor, client, denied grants and out-of-scope requests. No live POST/provider delivery was tested. Parent verification: 139 broader client/search tests, 24 booking/availability route tests (9 overlap), TypeScript and diff check passed. Server post-commit notification failure and idempotency remain explicit follow-up work.

### Wave 11: Scoped portal search and invoice destinations

- Added shared header search with authorized navigation results, bounded record groups, debounced requests, cancellation, explicit error/retry and denial states, validated local destinations, keyboard focus restoration and a viewport-bounded dialog. Identity changes clear previous results; Ctrl/Meta+K does not open over another dialog.
- Added private, no-store server search for all eight active roles, preserving client/VA property and module grants, cleaner assignments, QA ownership, maintenance assignment and existing Laundry membership/week/tracking scope. Active-role scope is not a union of held roles. Queries and result sizes are bounded; unreadable permissions fail closed.
- Invoice results now open direct, read-only admin/client summary routes rather than limited finance-list previews. Server authorization excludes draft/void and out-of-scope invoices for client/VA actors. Missing service dates display honestly; no provider or payment actions were added.
- Integrated verification: 105 tests across search API, search UI, portal shell, invoice authorization and invoice rendering passed. TypeScript caught nullable period dates during implementation; the corrected code passed the subsequent check.
- Browser evidence: admin search, record navigation, mobile/desktop bounds and forced failure/retry; isolated invoice search-to-summary on admin and client, missing-period mobile rendering, client draft exclusion/404, sent-fixture visibility and return to finance. Temporary invoice deleted by exact ID (zero remaining); temporary QA actors deactivated. No provider calls or business invoice changes.
- Remaining for 001: QA unclaimed pool, worker invoices, non-admin people search, broader Laundry historical destinations and live walkthroughs for VA/cleaner/QA/Laundry/maintenance. This is not whole-portal or whole-backlog verification.

### Jobs screenshot regression recheck

- Rechecked the existing container-query row fix against the reported vertical property-name collapse. At 390, 768, 1024, 1280, 1440 and 1920px, the property column remained readable (minimum measured width 262px), with no document horizontal overflow; early and late timing tags remained present.
- Browser selection toggled successfully. Manage opened the selected QA job's Schedule page, not a modal. No job mutations were submitted.
- Focused automated verification: 48 tests passed across job-row, workspace state, workspace URL and dialog suites. Desktop and mobile screenshots retained in the local temporary directory as `sneek-jobs-fixed-current.png` and `sneek-jobs-fixed-mobile.png`.

### Wave 10: Jobs dialog accessibility and upload-draft recovery

- Replaced the five hand-built Jobs modals with a shared, locally scoped Radix JobDialog: accessible title/modal semantics, focus trap, Escape/Close, opener focus restoration, 44px close target, scrollable viewport-bounded content and pending-request dismissal protection. Uses the existing Estate styling.
- Browser review caught generic enter-animation transforms overriding centering and reduced-motion behavior. Replaced that animation with an opacity-only 150ms fade and explicit reduced-motion suppression. Rechecked mobile bounds (16px side margins), no animation under reduced motion, keyboard cycling and focus restoration; desktop remained centered.
- All four bulk dialog entry points were opened and closed in the browser without submission. A browser-intercepted bulk-assign request verified busy dismissal protection and recovery after simulated failure; it never reached the server. Screenshots: `C:/Users/User/AppData/Local/Temp/sneek-jobs-dialog-mobile.png` and `sneek-jobs-dialog-desktop.png`. Single-row assignment shares the tested component; its complete business workflow was not executed.
- Ramanujan hardened IndexedDB draft storage: failed/blocked opens are recoverable, stale connections invalidate, pre-request InvalidStateError retry is bounded, aborts reject, and success waits for transaction completion. Writes are never automatically replayed. Parent reviewed and closed the agent.
- Verification: 44 integrated tests across four files, TypeScript and whitespace checks passed. Parent reran the real isolated Chromium script: blob/reload/update/delete, controlled open errors, closed connection, native abort rollback, clone failure and versionchange recovery passed. Real-phone storage pressure/quota, whole offline evidence lifecycle and upload-provider receipt remain unverified.
- QA browser closed and temporary admin deactivated. No dependencies, production build, migrations, provider calls or publishing.

### Wave 9: full-dataset Jobs refinements and database/browser verification

- Sartre moved Jobs search and invoice refinement before database pagination, sharing constraints across count, rows and export. Search includes property/suburb/client/active-cleaner/job number, treats LIKE wildcards literally and is bounded to 200 characters. Typing debounces 300ms; search/invoice changes reset page one. Existing cleaner assignment restrictions and legacy payloads remain intact. Agent reported 53 focused passes; parent reviewed and closed the agent.
- Actual local admin browser: QA Harbour was absent from the initial page but found by search. Invoice yes/no split the one matching result into zero/one without overlap. Search from page two reset page one. Mobile 390px had no horizontal overflow; filtered CSV had a header plus the matching QA job only. Screenshot: `C:/Users/User/AppData/Local/Temp/sneek-jobs-server-search-mobile.png`. Temporary QA admin deactivated; no job changes or provider calls. Existing export cap is 5,000 rows.
- Database schema tests now require explicit `SNEEK_TEST_DATABASE_URL` pointing at local PostgreSQL. All fixtures are created in rollback-only transactions; no broad prefix deletion or arbitrary existing client is used. Four actual PostgreSQL tests passed, including rollback on assertion-body failure and index existence. Post-run exact-ID checks found no fixtures. Normal run explicitly skips without opt-in; remote URL rejection was separately verified.
- `node scripts/qa/verify-upload-drafts.cjs` passed actual Chromium IndexedDB blob save, reload persistence, retry-state update and delete in an isolated browser context. This supplements the skipped jsdom test; it is not real-phone offline/quota validation. The script requires a local dev server and never uses the user's persistent browser profile.
- Local port 3010 was no longer listening. Restarted the existing dev command behavior in a hidden process with scheduler disabled and cache cleanup disabled; app is available at `http://localhost:3010`. No production build, migrations or publishing.
- Parent integration: 56 Jobs tests across four files and TypeScript passed. The earlier 2,864-test fixed-inventory run predates this wave; it is not presented as verification of these newer changes.

### Agent-assisted wave 7: reviewed approval versions and AI configuration

- Approval decisions now submit the version displayed to the client. The transaction checks that version before changing records; stale/missing versions return 409 STALE_APPROVAL. Both classic and v2 boards preserve notes, block stale decisions and require refreshed terms without automatic resubmission.
- `scripts/qa/verify-approval-store-concurrency.cjs` exercises the real approval-store module against local PostgreSQL with an isolated UUID setting and lock namespace. Parallel creates/updates and competing approval decisions passed; its temporary setting was removed. Application approval history was not changed.
- Read-only admin/operations AI configuration exposes provider/model/key-presence and explicitly untested connection status. Existing Anthropic composition validates outputs, bounds provider timeout/retries and returns generic errors. No credentials exposed and no live provider requests performed; credential presence is not health verification.
- Focused verification previously passed 164 tests across seven files. Browser: stale approval fixture required refreshed review with no duplicate POST; AI configuration displayed missing credentials/untested status at mobile and desktop, and client API access returned 403. Temporary QA admin was deactivated after subsequent Jobs verification.
- Artifacts: `wave7-version-review-mobile.png`, `wave7-ai-config-mobile.png`, `wave7-ai-config-desktop.png`. AI evaluation/action gateway, provider connectivity and full approval business workflows remain pending.

### Wave 8: notification history and Jobs restoration

- Notification history supports optional cursor pagination while preserving the legacy array response. Timestamp/id keysets remain recipient-scoped, advance across hidden diagnostics and do not require a cursor record to still exist. The shared inbox appends/deduplicates older pages, preserves rows on failure, retries the failed page and labels search as loaded-history search.
- Notification verification: 40 focused tests passed, including older-page access denial and identity-change cancellation. Actual cleaner endpoint returned a private empty page; browser-only two-page fixture verified older-page 503/retry with both records retained and no mobile overflow. Desktop search narrowed loaded history correctly without overflow. Screenshots `wave8-notification-history-mobile.png` and `wave8-notification-history-desktop.png`. No notification records or provider deliveries were created.
- Feynman implemented Jobs URL filter/sort/date/page/search/list-board state restoration, input validation and stale-response suppression. Parent review required explicit error/Retry and payload validation rather than a false empty state; these are integrated and agent closed.
- Jobs browser: selected QA property and latest sort survived detail -> Back and reload. At 390 pixels, the full property name/timing badges/actions fit. Mocked 503 rendered an error with neither empty-state copy nor pagination counts; Retry recovered real rows without changing URL filters. Screenshots `wave8-jobs-restored-mobile.png` and `wave8-jobs-error-mobile.png`. Temporary QA admin deactivated and browser closed.
- Combined Jobs/notification validation: 79 tests across five files passed; TypeScript passed. Approval/AI/notification integration earlier passed 201 tests across nine files. Real isolated PostgreSQL approval concurrency rechecked successfully; temporary setting removed.
- James then completed a fixed-inventory single-worker non-DB run: 243 files passed, one skipped; 2,864 tests passed, one skipped, exit 0 in 436.79 seconds. All 244 files accounted for with unchanged before/after test/config hashes. Parent inspected stdout and `test-results/vitest-diagnostic-1788937081289/verification.json`; agent closed. Earlier silent exit not reproduced and its cause remains unproven. Database tests excluded because their fixture cleanup is not yet safely isolated; this is not a whole-platform or full database-suite pass.

### Reported Jobs page layout fix

- Replaced viewport-based seven-column rows with panel-width container queries. Compact rows retain property, client, cleaner, date, timing badges, status and visible actions; wide panels retain columns without collapsing the property name.
- Nested controls no longer trigger row navigation when Enter bubbles to the row or board card.
- Verification: three focused component tests and TypeScript passed. Browser checks on the reported QA Harbour Apartment at 390, 768, 1024, 1280, 1440 and 1920 pixels found no horizontal overflow or status/action overlap. Early 13:00 and late 10:30 remained visible; Manage opened the correct job Schedule tab without changing records.
- Screenshots: local temporary QA output `sneek-ux-wave1/jobs-final-{width}.png`. Whole-suite verification remains unresolved: two earlier runs exited without a summary; no whole-suite pass claimed.

### Agent-assisted wave 6

- Singer: persistent in-flow cleaner active-job strip, property/status/resume link, same-workspace hiding, unavailable/Retry, identity-bound serialized probe and GPS disable on failed probe. Parent extended scoped endpoint with property name/private cache headers and integrated the strip inside the shell.
- Aquinas: approval board distinguishes failed/malformed loads from empty history, preserves notes on transient failures, clears denied data, validates payloads and prevents overlapping decision submissions with a synchronous lock. Session changes reset the board.
- Kant: every approval-store mutation uses a transaction-scoped PostgreSQL advisory lock before reading, explicit ReadCommitted and bounded timeout. Removed silent 1000-record history eviction. Simulated concurrent create/update/approve/counter and rollback tests pass.
- Turing: GPS callbacks and queue flushing are scoped to cleaner identity/impersonation, stale callbacks ignored, requests aborted and batches serialized. Local scope metadata never leaves the queue. Legacy/unowned and other-user records remain unsent; raw coordinate logging removed.
- Combined validation: 359 tests across 28 files passed. Parent reviewed all four agents and closed them. Actual local PostgreSQL advisory-lock serialization also passed without record writes; this is not full live approval-flow integration.
- Browser: real local cleaner active job displayed, Resume opened the correct workspace and strip hid there, 503 retry recovered, mobile controls remained unobstructed. Browser-only approval fixtures verified 503 does not show All clear, Retry recovers, rejected response preserves the note, and mobile has no horizontal overflow. No actual approval or GPS submission was performed.
- Artifacts: `wave6-active-job-mobile.png`, `wave6-approval-mobile.png`. Remaining: authoritative timer/save state, real-phone GPS/offline behavior, approval displayed-version concurrency, and broader workflows. No commit/push.

### Agent-assisted wave 5

- Mill: remembered per-user/per-portal collapsible groups, accessible expanded/controls semantics, active-route reveal and search override without changing saved preferences. Parent corrected Set iteration for the repository TypeScript target and added reduced-motion transition suppression.
- Erdos: client home distinguishes unavailable services, reports, properties, inventory, laundry, attention and finance from valid empty/zero data. Partial successes remain visible with Retry; restricted Message ops link is gated consistently.
- Parent: shared maintenance navigation now fails closed and resets on user/role/impersonation changes; shared attention counts serialize polls, abort stale responses, validate counts, clear denied data and refresh on notification events. Cleaner uses the shared count hook.
- Validation: 253 tests across 23 files passed; TypeScript passed. Both agents reviewed/integrated and closed.
- Browser: cleaner mobile collapse/search/reload persistence and desktop keyboard expansion passed, with no horizontal overflow. Client home loaded on mobile without horizontal overflow. Client server-query failures are component-tested, not injected into the live database.
- Artifacts: `wave5-groups-mobile.png`, `wave5-groups-desktop.png`, `wave5-client-mobile.png` in the existing temporary screenshot directory. No commit/push or provider changes.

### Agent-assisted wave 4

- Cicero: shared portal-header recent-notification panel with search, on-open loading, retry/refresh, internal links, serialized event refreshes, session/impersonation isolation and access-denied row clearing. No unread claims or delete actions.
- Kepler: live listener now resets on user/role/impersonation changes, aborts stale history priming, ignores old callbacks, bounds deduplication memory and validates browser-notification destinations. Existing user-initiated permission policy and webdriver suppression preserved.
- Parent: private/no-store history responses, generic retryable database failures, 14 route regressions covering all eight roles, and integrated review/browser checks.
- Combined validation: 211 tests passed across 20 files. Both agents reviewed/integrated and closed.
- Browser: local cleaner login and real empty-history response passed. At 390x844 and 1440x900, browser-only fixtures exercised search, long text, calendar navigation, 503 Retry recovery, 403 row clearing, Escape/focus restoration and no horizontal overflow. Reduced-motion panel has no running animations. Fixtures did not modify database records or call delivery providers.
- Screenshots: `wave4-notifications-mobile.png` and `wave4-notifications-desktop.png` in the existing temporary artifact directory. No visual-regression baseline or full-role walkthrough is claimed.
- Remaining: read/unread lifecycle, pagination beyond recent 200 records, real browser SSE/provider/device receipt, and the wider backlog. No commit/push.

### Agent-assisted wave 3

- Kierkegaard: extracted credentials sign-in helper; explicit NextAuth CSRF rejection retries once only, malformed/login-page success responses rejected. Login controls remain disabled until hydration. Preserved password/2FA/CSRF/lockout checks.
- Hooke: Laundry home distinguishes failed task, route and property lookups from empty data; Retry and compact unavailable metrics preserve partial successes. Scheduled-date semantics left unchanged pending deeper date-model reconciliation.
- Dewey: VA attention counts enforce permission and property scope, omit nondelegable approvals/quotes, exclude mixed-scope invoices consistently with finance. Query failures return 503 without fabricated zero counts or grants.
- Parent: client/VA navigation waits for identity; permission refresh validates payloads, clears grants on failed refresh, clears navigation on denial, serializes requests and discards responses from previous identities. Added Retry status and regression tests.
- Final integrated validation: 165 tests passed across 17 files; TypeScript and whitespace checks passed. All three agents reviewed/integrated and closed.
- Browser: fresh cleaner and VA contexts each reached their correct portal on the FIRST attempt after login fixes. This is two successful local examples, not a guarantee about every deployment/device.
- Browser fault injection: mocked VA attention endpoint 403 removed all portal-menu links; removed the mock and Retry restored granted booking navigation, no horizontal overflow at 390x844. No account grants changed. Artifact `wave3-va-denied.png` in existing screenshot directory.
- Laundry role walkthrough, real 2FA/device verification, production build, and provider delivery remain pending. No commit/push or external provider setup.

### Agent-assisted wave 2

- Goodall: QA dashboard unavailable/retry states, current viewer ownership, explicit team-wide rework label and Sydney timestamp ranges; added 11 component tests including both DST transitions.
- Copernicus: notification SSE revalidation, serialized polling, abort/cancel cleanup, bounded reconnects and user-bound Last-Event-ID replay; added 32 route tests. Parent review caught reconnect-gap loss; replay now also handles long quiet periods by clamping valid old cursors to the last 10 minutes.
- Parent: per-user/per-portal browser favorites that reorder authorized navigation without duplicates; mobile tabs unchanged; storage corruption and unauthorized favorites tested. Reviewed agent changes and ran integration verification.
- Browser evidence: cleaner 1440x900 and 390x844 pin, persist across reload, unpin, correct Favorites/Daily work grouping, no duplicate link and no horizontal overflow. Screenshots in the existing `sneek-ux-wave1` artifact directory: `wave2-favorites-desktop.png` and `wave2-favorites-mobile.png`.
- Recurring first-login redirect on a fresh browser context reproduced; retry succeeds. Not fixed in this wave and not attributed to a cause without evidence.
- QA changes are component-tested, not yet manually verified under a QA account. Stream tests run the route with mocked auth/database and real ReadableStream/timers; they are not proof of real provider/device delivery.
- Final combined verification: 110 tests passed across 11 files; TypeScript passed. Both agents reviewed/integrated and closed. No commits or pushes.

Foundation reliability and navigation: accessible drawer, scoped navigation filtering (not entity search), explicit mobile tabs, correct Maintenance counts/date ranges/error states, role-appropriate notification destinations, and honest unsupported push results.

No new external provider calls, messages, payments or AI transmissions. Existing policies remain unchanged. Maintenance assignment visibility requires a separate policy decision; this slice preserves current access behavior.

## Verification ledger

- Latest fixed-inventory non-DB suite: 2,864 passed, one skipped across 244 files (243 passed, one skipped); exit 0. Evidence: `test-results/vitest-diagnostic-1788937081289/`. Skipped test: `tests/lib/draft-store.test.ts` saves/retrieves draft. `tests/db/**` excluded; unsafe broad prefix cleanup and arbitrary existing-client fixture must be isolated before running. Separate real PostgreSQL approval concurrency check passed with exact temporary-setting cleanup.

- Automated regression suite: 359 passed across 28 files (prior waves plus active-job, GPS lifecycle and approval UI/store concurrency). Earlier baselines: 253 tests across 23 files; 211 tests across 20 files; 165 tests across 17 files; 110 tests across 11 files; 46 tests across 8 files.
- TypeScript: passed (`npx tsc --noEmit --pretty false`).
- Browser: Cleaner desktop 1440x900 and mobile 390x844; search, drawer, Escape/focus restoration, calendar navigation, no horizontal overflow and reduced-motion animation disabled. VA mobile: permitted menu, no Approvals or assistant-management links, no horizontal overflow. First VA login timed out; one retry succeeded; authentication reliability remains worth investigating.
- Provider/device delivery: not tested.
- Production build: not run.
- Git whitespace check: passed.
- Browser artifacts: `C:/Users/User/AppData/Local/Temp/sneek-ux-wave1/` (`cleaner-mobile-drawer.png`, `cleaner-desktop-calendar.png`, `va-mobile-drawer.png`).
- Other role browser walkthroughs, genuine push receipt and real phones: pending.

## Finding-level progress

| Finding | Status | Evidence / remaining work |
| --- | --- | --- |
| F01 | False-success behavior fixed | Regression proves FAILED without a transport. Actual template-push implementation remains pending. |
| F02 | Role/version routing implemented | 15 link cases covered by tests; log and stream resolve house default/personal override. Typed entity metadata and expired-resource UX remain pending. |
| F03 | Partial | Current section/role and recent-notification inbox in shared header. Global entity search and notification read lifecycle remain. |
| F04 | Implemented | Explicit mobile tab map intersected with authorized nav; reorder and missing-grant tests pass. |
| F05 | Implemented; broader a11y audit pending | Radix drawer, accessible close, Escape/focus restoration, resize close and reduced-motion behavior. Component and cleaner browser checks pass. |
| F06 | Fixed | Independent Maintenance count, 20-row preview and View all link; test covers 41 records. |
| F07 | Partial | Maintenance, QA and Laundry unavailable/retry behavior tested; client badge API no longer fabricates zeros on failure. Other dashboards remain. |
| F08 | Partial | Maintenance and QA use shared Sydney ranges; QA 23/25-hour daylight-saving tests pass. Laundry date semantics require follow-up. |
| F09 | Implemented; device validation pending | Removed automatic LiveNotifications permission request; existing user-initiated WebPushSubscriber retained. |
| F10 | Partial | 32 deterministic route tests cover auth/scope change, expiry, concurrency, cleanup and bounded reconnect replay. Actual browser SSE/device delivery still needs dedicated verification; webdriver suppression unchanged. |
| F11 | Partial | Shared navigation filtering exists, not entity/command search. |
| F12 | Partial | Read-only provider/model/key-presence configuration and honest untested status implemented; no live connection, evaluation or action gateway verified. |
| F13 | Policy decision pending | Existing maintenance access remains unchanged. |
| F14 | Implemented for navigation | Search, per-user favorites and remembered group expansion implemented; cleaner desktop/mobile checks and regression tests pass. |

## Backlog

| ID | Proposal | Delivery status | Verification |
| --- | --- | --- | --- |
| 001 | P1 / M: Role-aware command search. | Partial | Wave 11: scoped search for eight roles, 105 integrated tests and admin/client browser checks; category and remaining role walkthrough gaps listed above. |
| 002 | P1 / S: Independent mobile tabs. | Implemented | Unit tests; cleaner and VA browser checks |
| 003 | P1 / M: Searchable grouped sidebar. | Partial | See finding-level progress |
| 004 | P1 / S: Useful header. | Partial | See finding-level progress |
| 005 | P1 / M: Shared entity context. | Planned | Pending |
| 006 | P1 / M: Saved views. | Partial | Personal admin Jobs views, columns and ADMIN-published team fallback implemented; unit, actual DB and desktop/mobile save/reload/precedence checks passed. Team named catalogs and other operational lists remain. |
| 007 | P1 / M: Predictable list-detail navigation. | Partial | Admin Jobs filter/page/view/layout-scoped scroll restoration passes desktop/mobile reload and Back checks after two layout-shift corrections. Queue next/previous and other lists remain. |
| 008 | P0 / M: Honest state vocabulary. | Partial | See finding-level progress |
| 009 | P1 / M: Consistent action semantics. | Planned | Pending |
| 010 | P1 / M: Accessible shared controls. | Partial | Shared navigation and Jobs controls plus Property info/access-image focus fixes implemented. Wave 24: 15 dialog tests; outer drawer focus visually verified. All-portal keyboard/screen-reader and nested-image browser coverage remain open. |
| 011 | P1 / L: Exception-led Command. | Partial | Wave 25 exposes existing attention categories, prevents false all-clear, fixes preview-capped unassigned counts and labels incomplete revenue. Parent/agent reliability tests pass. Per-record deadline/impact/owner ordering and full workflow verification remain. |
| 012 | P1 / L: Unified dispatch workspace. | Planned | Pending |
| 013 | P1 / M: Assignment conflict preview. | Planned | Pending |
| 014 | P1 / M: Batch operations with preview. | Partial | Wave 26 verified status-change and exact CSV export previews with conflicts, unknown outcomes, limits and date-only scope. Bulk assignment, message drafts and rescheduling remain. |
| 015 | P1 / M: Approval workspace extension. | Planned | Pending |
| 016 | P1 / L: Capability matrix. | Planned | Pending |
| 017 | P2 / M: Temporary controlled delegation. | Planned | Pending |
| 018 | P1 / L: Automation control room. | Planned | Pending |
| 019 | P1 / M: Entity audit history. | Planned | Pending |
| 020 | P2 / M: Operational health panel. | Planned | Pending |
| 021 | P2 / L: Capacity planning. | Planned | Pending |
| 022 | P2 / M: Financial explanation panels. | Planned | Pending |
| 023 | P1 / M: Property-first home. | Partial | Wave 26 personal pins, compact portfolio, next service, last completed service/shared reports and strict pending approval summaries pass unit and desktop/mobile persistence/concurrency checks. Authoritative guest readiness and detailed last result remain. |
| 024 | P1 / M: Approval inbox extension. | Partial | Failure/retry, draft retention, duplicate-submit guard, displayed-version rejection and transactional store tested. Full decision-workspace extension remains. |
| 025 | P1 / M: Rebook from a prior clean. | Implemented | Reuses authorized current property/service only, revalidates source and access, then fresh availability/review/price. Helper/page/link and booking regressions plus desktop/mobile browser checks passed. |
| 026 | P1 / M: Clear booking review. | Partial | Waves 12-15: identity, date, scoped retry/recovery, estimate visibility and guest-timing/access-record context. Contractual inclusions, reservation-specific constraints and fuller access prerequisites remain. |
| 027 | P1 / M: Explain schedule changes. | Planned | Pending |
| 028 | P1 / L: Trustworthy progress. | Planned | Pending |
| 029 | P1 / M: Report workspace extension. | Planned | Pending |
| 030 | P1 / M: Property-linked conversations. | Planned | Pending |
| 031 | P2 / M: Property change history. | Planned | Pending |
| 032 | P1 / M: Clear billing buckets. | Partial | Wave 25 labels history limits, unbilled estimates, invoice totals and paid/part-paid states; read errors no longer fabricate hidden access/zero balance. Seven finance/scope tests passed. Full outstanding/overdue/credit/receipt breakdown and reconciliation remain. |
| 033 | P2 / M: Portfolio statement and export. | Planned | Pending |
| 034 | P1 / M: Service preferences with guardrails. | Planned | Pending |
| 035 | P1 / M: Single shift workspace. | Planned | Pending |
| 036 | P1 / M: Persistent active-job strip. | Partial | Property/status/resume strip and failure states tested and cleaner browser checked. Authoritative timer/save state remains. |
| 037 | P1 / M: Pre-arrival brief. | Planned | Pending |
| 038 | P1 / M: Timing hierarchy. | Partial | Waves 16-17 share validated planned/guest timing and contradiction warnings; 128 focused tests and Today/Jobs/Calendar mobile checks pass. Route/detail/fullscreen and desktop timing visual verification remain; live browser activation discrepancy is unresolved. |
| 039 | P1 / L: Adaptive form navigation. | Planned | Pending |
| 040 | P0 / L: Durable evidence queue. | Partial | Wave 26 extends durable originals/receipts, typed moves and recovery to main form/guided/bulk/task/laundry/new carry-forward destinations. Focused, PostgreSQL and 20 IndexedDB browser cases pass. Standalone damage/maintenance/lost-found capture paths remain separate. |
| 041 | P1 / M: Device-aware capture. | Planned | Pending |
| 042 | P0 / L: Offline contracts. | Planned | Pending |
| 043 | P1 / M: Submission preflight. | Implemented | Unified missing-form/task/laundry evidence and synchronization blockers, explicit unused/unassigned evidence handling, and rejection retains the form. Panel/workspace/contract tests pass; main evidence destinations and early-send integration verified in Wave 26. |
| 044 | P1 / M: Recoverable job transitions. | Planned | Pending |
| 045 | P1 / M: Structured issue escalation. | Planned | Pending |
| 046 | P1 / M: Explainable pay timeline. | Planned | Pending |
| 047 | P2 / M: QA coaching loop. | Planned | Pending |
| 048 | P1 / M: GPS and safety clarity. | Planned | Pending |
| 049 | P1 / M: Dedicated assistant home. | Planned | Pending |
| 050 | P0 / M: Durable account context. | Partial | Waves 12/14: truthful banner, review attribution and actor/client/scope-isolated same-tab booking recovery. Cross-session/device drafts and other mutation surfaces remain. |
| 051 | P1 / L: Capability projection. | Partial | Client navigation identity/refresh fail-closed behavior and badge scope tested; full resource capability projection remains |
| 052 | P1 / M: Permission templates. | Planned | Pending |
| 053 | P1 / M: Pending-client decision queue. | Planned | Pending |
| 054 | P1 / M: Invitation lifecycle. | Planned | Pending |
| 055 | P1 / L: Safe scope changes. | Planned | Pending |
| 056 | P2 / M: Handover notes. | Planned | Pending |
| 057 | P2 / M: Client-visible VA activity. | Planned | Pending |
| 058 | P2 / L: Multi-client switching, only after policy design. | Planned | Pending |
| 059 | P1 / M: Readiness-based review queue. | Partial | Wave 25 adds readiness filters, blocked/cancelled action suppression and truthful retry states over existing policies. Component/policy tests and desktop/mobile browser readiness/retry scenarios passed. Real populated inspection workflow and per-worker review remain. |
| 060 | P1 / M: Evidence comparison workspace. | Planned | Pending |
| 061 | P1 / M: Fast scoring with completeness checks. | Planned | Pending |
| 062 | P1 / M: Rework handoff extension. | Planned | Pending |
| 063 | P2 / M: Inspection visit planning. | Planned | Pending |
| 064 | P1 / M: Distinct personal/team metrics. | Implemented for QA home | Ownership/labels component-tested; role browser check pending |
| 065 | P2 / M: Calibration workflow. | Planned | Pending |
| 066 | P1 / M: Inspection pay reconciliation. | Planned | Pending |
| 067 | P1 / M: Next-stop execution view. | Implemented | Dominant valid pickup/drop-off action, audience-filtered access, recorded quantities/location and configured proof summary. Six tests passed in UTC/Sydney and both desktop/mobile action/refresh-error scenarios passed. |
| 068 | P1 / L: Bag/set traceability. | Planned | Pending |
| 069 | P1 / M: Quantity discrepancy workflow. | Planned | Pending |
| 070 | P2 / L: Readiness-linked ETA. | Planned | Pending |
| 071 | P1 / M: Access-failure handling. | Planned | Pending |
| 072 | P1 / M: Cross-role handoff receipt. | Implemented | Wave 26 recorded cleaner/driver handoffs expose actor/time, photo/quantity/location, reasons and correction differences. Eleven final focused tests and desktop/mobile receipt checks pass. No unrecorded dual-party acceptance is implied. |
| 073 | P2 / M: Capacity/load planner. | Planned | Pending |
| 074 | P1 / M: Daily reconciliation. | Planned | Pending |
| 075 | P0 / M: Accurate scoped totals. | Partial | See finding-level progress |
| 076 | P1 / M: Work-order lifecycle board. | Partial | Paginated list/board and scoped counts preserve existing lifecycle/approval/visit outcomes; focused and desktop/mobile ticket checks passed. Explicit diagnosis and accepted/verified closure states still need model/workflow support. |
| 077 | P1 / L: Estimate-to-approval connection. | Planned | Pending |
| 078 | P1 / M: Parts and replacements connection. | Planned | Pending |
| 079 | P1 / M: Visit workspace extension. | Planned | Pending |
| 080 | P2 / L: Asset history. | Planned | Pending |
| 081 | P2 / M: Cleaning and guest-window coordination. | Planned | Pending |
| 082 | P1 / M: Closure verification. | Planned | Pending |
| 083 | P0 / L: Typed event-to-delivery contract. | Partial | See finding-level progress |
| 084 | P1 / L: Persistent role-scoped inbox. | Partial | Shared cursor inbox with recipient-owned persistent PUSH read controls, unread filtering and retry states. Unit and desktop/mobile read-reload checks pass; fuller archive/action/resolution lifecycle is next. |
| 085 | P0 / M: Correct deep links. | Partial | See finding-level progress |
| 086 | P1 / M: Notification lifecycle. | Partial | Recipient-owned read, personal needs-action/resolved and archive/restore implemented with revision/audit guards. 86 focused checks and desktop/mobile persistence pass; new core coverage100%. Snooze, domain acknowledgement and retention remain. |
| 087 | P1 / L: Delivery retry and escalation. | Planned | Pending |
| 088 | P1 / M: Preference clarity. | Partial | Wave 25 clarifies web/device versus delivery state, fixes PUSH web-consent selection and calendar preference persistence. Tests passed; digest/escalation policy and end-to-end delivery remain. |
| 089 | P1 / M: Device notification setup. | Partial | Wave 25 adds explicit permission/registration/own-account checks and user-initiated setup/repair/removal/local test. Silent rebinding is removed and impersonation writes denied. Automated tests passed; actual phone/provider delivery is not certified. |
| 090 | P1 / M: Noise control. | Planned | Pending |
| 091 | P1 / L: Connected record timeline. | Planned | Pending |
| 092 | P1 / L: Mutation-driven refresh. | Planned | Pending |
| 093 | P2 / L: Integration health and replay. | Planned | Pending |
| 094 | P2 / L: Scenario automation editor. | Planned | Pending |
| 095 | P1 / M: AI settings and health. | Partial | Read-only configuration, access/error tests and desktop/mobile checks; live health, budgets and controls remain. |
| 096 | P2 / L: Read-only operations assistant. | Planned | Pending |
| 097 | P2 / M: Job briefing assistant. | Planned | Pending |
| 098 | P2 / M: Communication drafting. | Planned | Pending |
| 099 | P2 / L: Support triage assistance. | Planned | Pending |
| 100 | P2 / L: Report drafting. | Planned | Pending |
| 101 | P3 / L: Evidence quality assistance. | Planned | Pending |
| 102 | P3 / L: Scheduling suggestions. | Planned | Pending |
| 103 | P2 / L: Approved knowledge assistant. | Planned | Pending |
| 104 | P2 / M: Translation and note cleanup. | Planned | Pending |
| 105 | P0 prerequisite / L: AI action gateway. | Planned | Pending |
| 106 | P0 prerequisite / M: AI evaluation and privacy. | Planned | Pending |

## Release gates

- Permissions and money decisions remain server-enforced.
- No lost work, false success, hidden duplicate actions or inaccessible navigation.
- Test desktop/mobile, reduced motion, keyboard flow, failures and role boundaries.
- AI requires provider/data/budget configuration; live outbound verification requires named test recipients.
- Completed slices must update SYSTEM.md and this tracker with actual evidence.
