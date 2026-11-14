# Recent changes: code and workflow review — 9 October 2026

### Follow-up: unattended iCal execution (2026-10-23)

- Inspected current local/remote main `4a46acc2`, PR 25 and its diff, root instructions, worker/service/manual API paths, Compose/Docker startup, shared heartbeat and diagnostics. Workspace `.agents` and `.codex` directories contain no additional instructions/skills. PR 25 fixed imports but did not prove an enabled queue consumer or deployed scheduled run. The saved environment uses local development configuration, not production runtime access.
- Reproduced a distinct stalled-body defect: after headers, the fetch timeout was cleared and four pending response bodies blocked the fifth feed. Before-fix regression failed with four fetches instead of five. The existing 15-second deadline now covers body consumption; the regression passes with all five runs recording ERROR. The source defect is established; its role in the live incident is unknown.
- Added an optional worker registration allowlist and production/iCal-only commands. Master/per-job kill switches remain stronger; the default full worker and four-hour Sydney cadence are unchanged. Compose now forwards operator scopes/kill switches and no longer claims a web fallback exists. Added read-only handler-capability/AUTO/MANUAL diagnostics and a runtime status command. Existing cron rows/manual success no longer label a stopped worker active. No domain sync policies, schema or migrations changed.
- Final focused regression run: **52 passed in nine files**, covering feed timeout/isolation, real worker import exits, allowlist/kill switches, registration, heartbeat expiry/capabilities, AUTO versus MANUAL status, unavailable reads, diagnostic display, live authorization and timing rules.
- Real PostgreSQL/pg-boss smoke: **one passed**, using fresh migrated disposable `127.0.0.1:55439/ical_unattended`, actual worker subprocess and local HTTP-304 feed. Only the fixture database cron was accelerated to one minute. Independent AUTO SUCCESS records at **12:28:08.035 and 12:29:08.130 UTC**, completed at 12:28:08.064 and 12:29:08.138, with two feed fetches, no MANUAL runs and no jobs/laundry/invoices created. No page or handler was invoked to cause the runs. After stopping the worker, read-only status correctly reported STALE/unconfirmed and exited 1 despite retained schedules and successful AUTO history. This does not validate a changed-booking import or production's four-hour interval.
- Chromium fixture checks use the real diagnostics component with mocked read responses at 390px/1280px, light/dark; no horizontal overflow, stale-worker/manual-success distinction and HTTP-503 error display. No editable inputs were added. Full authenticated production navigation remains unverified.
- Standalone TypeScript initially found Set-spread compatibility errors in the new heartbeat call; replaced with `Array.from`. **Final standalone TypeScript passed. Production build passed (735 generated pages, exit 0, 430 seconds)** with existing lint/Tailwind/dependency warnings and expected database-unavailable messages from the deliberately closed loopback URL. The 13 existing notification-health consumer tests and 11 middleware boundary tests also passed, for **76 focused tests across 13 files, plus the one real scheduled smoke**. `git diff --check` passed. Full repository suite and production/provider/changed-booking tests were not run. Logs, scheduled evidence and browser captures are under `/workspace/scratch/ical-unattended/`.
- Blocked read: `GET https://api.github.com/repos/sanuthdesitha/sNeek_Property_Services_Webapp/deployments` through `gh api` returned **Forbidden**; it did not mutate anything and was not retried. No production hosting process/log/database access is available, no merge/PR publication/deployment was performed, and production cause/configuration/feed history remains unverified. The production issue requires authorized deployment plus new successful AUTO history for every enabled feed across an actual four-hour Sydney boundary with browsers closed. P11 duplicates were not treated as sync evidence or changed.
- Publication follow-up: the owner explicitly authorized a **draft PR** and subsequently accepted the existing normal sync effects. Deployment remains conditional on authorized runtime access and queue compatibility, with no queue initialization/upgrade or credential/access change authorized. The preserved patch, all 20 file digests and unchanged remote main were reverified before publication. Self-review/security review found no blocking correctness/auth/data-exposure issue in the diff; no production acceptance is claimed.
- Pre-publication checks: **76 focused tests passed again** with V8 coverage; touched-file ESLint passed without warnings/errors. A clean-base comparison ran 67 prior tests successfully and showed no decline in the measured existing-file metrics. Current whole-file lines/branches/functions: worker 98.67/96.12/100; heartbeat 100/96/100; new status reader 100/100/100; legacy sync 22.09/54.05/25.8; diagnostics client 63.25/50/75; diagnostics API 33.2/7.69/50. The CLI wrapper reports 0 instrumented coverage (its real isolated runtime invocation is recorded above). These focused suites do not establish 95% coverage across legacy files; no repository coverage threshold or required coverage gate is configured. Coverage and baseline logs are in `/workspace/scratch/ical-unattended/publication-*`.

## Scope and evidence

The user corrected the request: review the recent Codex changes as a whole, reuse existing features, and match existing UI/UX. Weather is excluded. Sources are the supplied **sNeek Web App Living Change Log** and **sNeek Developer Handover**, both identifying `882b5fce`, their implementation commits, current root-app code, and local tests. The earlier local checkout was `2077359d`; it was fast-forwarded to `882b5fce` before this work.

This is a source/fixture review of the 34 changelog entries plus the three subsequent evidence changes. Merge/no-op entries are explicitly identified below. “Retain” means the reviewed boundary and regression tests support keeping the behavior; it does not certify every production state or every line of the feature. No production data, provider delivery, deployment, or mobile release was verified.

## Architecture decisions

The root product is Next.js 14 / React 18 with Prisma/PostgreSQL and existing role-specific Estate portals. Existing services already own evidence, JobTasks, laundry runs, shopping/stock ledgers, notifications, and billing. New parallel state machines would duplicate these authorities. `mobile/` and `sneek-nextgen/` are separate applications.

The principal UI defect was integration: new tools appeared as links above existing page headers, requiring users to leave the workflow, sometimes offering ADMIN-only tools to OPS_MANAGER. The secondary defects were obsolete asynchronous responses and ambiguous loading/error states.

### Repairs

- Property memory/care now opens within **Property → Jobs & history**, alongside existing deep-clean planning, cadence, and job history. Clients open their scoped care history within the existing property page; office notes and edit controls remain hidden.
- Urgent-stock reporting/review now opens within **Inventory & supplies** and the cleaner's existing **Supplies** hub. ADMIN-only controls are not offered to OPS_MANAGER.
- Individual bag observations now open within Laundry → Tracking (consolidated in the settings follow-up below), cleaner job laundry context, and the administrator's laundry investigation. Existing LaundryTask transitions remain authoritative.
- Turnover cost review opens within the existing **Finance overview**, restricted to ADMIN. It does not reprice jobs, change payroll, or edit invoices.
- A shared lazy disclosure uses Estate controls, avoids additional page headings/main landmarks, and keeps drafts mounted while collapsed. Existing standalone URLs remain compatible.
- Late parsed responses no longer replace a newly selected job/property/run. Property care and stay-preparation editors reset with scope; holiday reads are cancelled and old previews removed. Pending saves disable fields and scope selectors so a response cannot clear a newer draft.
- Loading/failed custody and stock reads no longer claim “no observations”, “no reports”, or “no upcoming clean”. Failed custody writes retain editable input for explicit retry.
- Laundry team filtering happens before the 100-run query limit, reusing the existing visibility resolver. Unrelated teams' recent runs cannot crowd an authorized team's runs out of the list.
- Stock reminders use the existing transactional notification-intent pipeline with explicit **INBOX** transport and shopping preferences. They no longer create uncategorized raw PUSH rows. Dispatch remains worker-dependent; an enqueued reminder is not proof of delivery.
- Embedded custody, profit and stock history receive the server's organization timezone. Holiday history uses policy timezone, and embedded property care receives the same configured timezone as its standalone route.
- The compact operational components were formatted into readable code; custody/profit list state uses service-derived types. Existing untyped domain structures remain a broader maintenance limitation, not an excuse to replace the domain engines.

## Entry-by-entry disposition

| Commit | Change | Review decision / existing destination |
| --- | --- | --- |
| `882b5fce` | Compact evidence review, selected-photo removal | Retain in admin job review and cleaner photo pool; selection/removal and office reason/confirmation regression coverage. |
| `d6f8f258` | Audited stale draft references | Retain locked shared-draft update, original retention, actor audit, version/assignment checks and tombstones. |
| `f31f5b42` | Persistent draft photo removal | Retain server-confirmed detachment; never revive discarded keys through stale local recovery. |
| `13485ec8` | Turnover readiness cap | Retain shared 15:00 cap with earlier actual arrival preserved; iCal and job-window tests cover both. |
| `fec54c3a` | Estate operational styling, stay disclosure | Extend with reusable embedded panel/disclosure; keep existing stay-preparation guest-count placement. |
| `8cda1f01` | Previously confirmed laundry evidence submission | Retain server evidence reconciliation under the final submission contract; no duplicate upload requirement. |
| `c2345e92` | Bag custody, profit, truthful report status | Repair scope races, role entry points, embedding, timezone and laundry query scoping; retain separate physical/financial attestations. |
| `527ec369` | Evidence baseline merge | No independent feature to rewrite; review resulting evidence implementation. |
| `647d88bb` | Incoming-stay estimates and towels | Retain read-only estimates, unknown quantities and long-stay guidance; reset editor on property/job change. |
| `5479aa9b` | Server-confirmed evidence recovery | Retain matching actor/job/form/key/destination receipts, no invented acknowledgements. |
| `2dfb6701` | Parallel evidence recovery history | Same resulting implementation as above, not a second workflow. |
| `8be50ad4` | Property care | Embed in property history, reset/cancel scoped edits; retain JobTask lifecycle, inspection/cleaning distinction and paid-time/readiness guards. |
| `f065c903` | Reviewed holiday rates | Cancel obsolete reads, clear previews while loading, freeze pending forms, format policy timezone; retain immutable snapshots and billed/paid locks. |
| `f6da0cb8` | Urgent stock and reminders | Integrate in supplies, distinguish load failure, suppress obsolete responses and use existing inbox delivery intents. |
| `f5e7bdef` | Scoped workers/cache isolation | Retain account-bound worker and cache rules; no new offline mutation queue. |
| `2e184dcc` | Retained accounts | Retain explicit consent, password/MFA authority, scoped cookies, expiry/revocation and isolation. |
| `05bade78` | Truthful device answers / Jackson P3 | Retain confirmed vs exception outcomes with reasons and narrow applicability; do not mark unknown devices as working. |
| `b663a8cd` | Deployment retry | No source feature; no deployment conclusion drawn. |
| `0cd779bf` | Saved laundry receipts / area evidence | Retain versioned receipts and destination checks in the existing laundry evidence flow. |
| `27224773` | Operations remediation / laundry investigation | Extend existing investigation with bag disclosure; preserve factual milestones, scoped evidence and copy-before-send behavior. |
| `7d8b70af` | Abandoned-upload preflight | Retain distinction between active upload and historical failed attempt; final server validation remains required. |
| `2077359d` | Low-storage upload support | Retain session/video fallback and originals; missing local backup is not evidence of an unuploaded server file. |
| `d3aafe80` | Ollama diagnostics | Retain Settings integration, bounded local transport, encrypted configuration and separate generation/vision checks. Live Ollama unavailable here. |
| `51376db0` | Recovery/photo assignment/shopping UI | Retain explicit human assignment and existing shopping surfaces; no silent AI application. |
| `b3ab39e2` | Shopping stock/billing batches | Retain actual purchases, held-stock/delivery allocations and reviewed client charges; preserve invoice revision/paid guards. |
| `b336a1d5` | Video recovery / personal stock | Retain evidence originals and audited existing held-stock corrections. |
| `6c529548` | Legacy AI photo verification | Retain scoped legacy-file verification before analysis; AI cannot establish ownership. |
| `5f66a879` | Social caption generation | Retain proposal preview and explicit apply in existing social draft form; no generation-triggered publication. |
| `c8e20541` | AI provider support | Retain explicit provider selection and no silent cloud fallback; model availability is separate from configuration. |
| `31035a06` | Legacy report photos in memory | Retain existing property-memory source aggregation and scoped source provenance. |
| `7c257e24` | Photo recognition / reviewed QA deductions | Retain proposals and office review before financial effects; no new automatic deductions. |
| `e13964bf` | Campaign personalization / client laundry | Retain per-recipient rendering/HTML escaping and existing client laundry workflow; no real campaign sent. |
| `80157bea` | V2 recovery / invoice job selection | Retain started-job eligibility and client/date/already-invoiced guards; no historical repricing. |
| `007eb853` | V2 evidence/review workflows | Retain existing receipt, authorization and reviewed-action boundaries, covered by suite. |
| `ec604a5e` | V2 reliability/recovery | Retain existing action-receipt and recovery mechanisms; do not create a second retry engine. |
| `5f64e918` | Redesign merge | No independent feature; evaluate merged implementation. |
| `12a1d267` | Portal uploads / VA access / admin navigation | Retain shared navigation and portal scope; do not broaden VA into financial approvals. |

## Verification and limits

Baseline at `882b5fce`: 6,882 tests passed, one assertion failed (uncategorized urgent-stock PUSH producer), six database suites refused the wrong fixture port, one test skipped. The database refusal was an environment setup mismatch, not six application failures. A new disposable PostgreSQL instance was initialized on **127.0.0.1:55439**, with migrations applied. No safeguard was weakened. Initial rerun: all database suites passed; the custody UI test was updated to await its loaded form.

Final automated verification:

| Check | Result |
| --- | --- |
| Complete Vitest suite with isolated PostgreSQL | **6,929 passed; 1 skipped; 623 files passed, 1 skipped**. The existing `draft-store` test skips without IndexedDB in its test environment. |
| Focused final UI/API regressions | **19 passed**, including delayed JSON, failed save retry, draft retention and scope changes. |
| TypeScript (`--noEmit --incremental false`) | Exit 0. |
| ESLint | Exit 0 with 196 documented warnings. |
| Real-database browser workflows | 4 passed, including admin/cleaner/client paths and authorization rejection. |
| Evidence review / photo-removal browser fixtures | 11 passed across 320/390/1440px. |
| Production build | **Final run exit 0; 761 generated pages.** |
| Diff whitespace check | Passed. |
 Test logs and screenshots are retained outside the checkout in `/workspace/scratch/recent-review/`.

Browser verification: four real-database workflows cover holiday preview/apply/revert and billed locks; bag observation/cost review and role denial; property care planning/evidence plus the client read-only view; and cleaner stock reporting/action/history plus assignment removal. The two extended multi-page tests use a 90-second overall budget; an initial 30-second budget expired during combined navigation/capture. Individual assertions and scope checks remain in place. Eleven additional browser tests exercise recent office evidence review and selected-photo removal at 320/390/1440px.

Visual checks captured 390px and 1280px in light/dark for care, holiday, custody, stock and profit, including the integrated care and finance surfaces. Inspected care mobile-light/desktop-dark, stock mobile-dark/desktop-light, holiday mobile-dark, custody mobile-light, and profit mobile-light/desktop-dark. Inspection moved the supplies tool below the existing heading/tabs; updated captures confirm that correction. No horizontal overflow was detected; labelled native inputs retain 44px minimum height and visible focus. Screenshots use local fixtures and available fonts; this is not a comparison against production screenshots.

The existing `npm run lint` had no root ESLint configuration and opened an interactive setup prompt. Added `next/core-web-vitals` and registered the already-installed TypeScript plugin so existing rule directives resolve. Legacy unescaped text and `module` variable names are warnings during adoption, not silently disabled. Renamed the marketing template action from `useTemplate` to `applyTemplate` so it is not falsely treated as a hook. Final lint exits 0 with **196 warnings** (including pre-existing hook dependencies and image optimization); this is not a warning-free baseline. External storage, real email/SMS/push, Ollama/OpenAI, production migrations and actual mobile devices are not configured for this review. Browser requests are isolated to the local fixture server. No claim of 95% touched-file coverage is made without a measured report. Generated service-worker assets are build output and are excluded from the authored change set.

Reproduce from the root app after applying migrations to a separate disposable database:

```sh
SNEEK_TEST_DATABASE_URL=postgresql://sneek@127.0.0.1:55439/sneek_review_test npm test -- --maxWorkers=4 --minWorkers=1
npx tsc --noEmit --incremental false
npm run lint
NODE_OPTIONS=--max-old-space-size=4096 npm run build
```

For real-database browser checks, start an isolated app on `http://localhost:3002` with that database, `NEXTAUTH_URL` set to the same origin, and workers/schedulers disabled. Run `e2e/{property-care,urgent-stock,holiday-rates,operations-ledgers}.spec.ts` sequentially with `PORT=3002`, `SNEEK_TEST_SERVER_ORIGIN=http://localhost:3002`, and the same `SNEEK_TEST_DATABASE_URL`. Run unit/database suites separately from these browser fixtures. The office/photo browser fixtures use `e2e/cleaner/draft-evidence-review.config.ts` and `e2e/cleaner/bulk-auto-assign.config.ts`; they do not need a database.

## Future change contract

Read `AGENTS.md` and `docs/style/operational-ui.md`. Before implementation, record the existing destination, service, current actor/entity authority, persistence, unknown states and test plan. Prefer an existing tab/section; add a standalone workflow only for a distinct user need. Check async scope changes and failure recovery as carefully as the successful path. Update this record and `docs/SYSTEM.md` with evidence, not an assumption that generated code is deployed or a configured provider works.


## Follow-up: settings and action placement

The user's follow-up identified the unexplained custody log, scattered public
holiday rate buttons and the tall settings navigation. The revised Estate settings
shell preserves the existing forms and tab URLs, with a searchable category
landing page, a single desktop category row and only the selected category's
section links. Phones use a grouped selector with 44px controls. Searching does
not unmount the active form. Navigation receives metadata only, not credential
values. The property-form editor retains its existing ADMIN/OPS_MANAGER boundary.

Public holiday rates now belong to Money; the property form belongs to Operations.
Older editor routes redirect into that shell. Job-specific holiday review appears
inside Money for ADMIN, carries the job ID and provides a return link. Classic
settings offers the canonical editor inside Finance. Individual bag tracking is
explained as an optional physical-label observation history: its global entry is
only on Tracking, and existing per-job/investigation entries remain. It does not
replace run pickup/delivery actions, change bag data or widen permissions.

The overview renders the already-loaded safe summary without a second settings
request. Settings search opts out of saved-text suggestions so the popup cannot
cover the mobile selector. The classic job response supplies a server-derived
`reviewHolidayRates` presentation capability using the effective role; the browser
must not infer it from a primary-role JWT. This does not replace mutation guards.

Follow-up checks:

- **64 focused tests passed** across seven component, API and domain suites,
  including settings search, draft retention, role-filtered navigation, encoded
  job context, effective-versus-primary role metadata, financial edit/delete guards,
  holiday policy and property-form configuration.
- **4 browser workflows passed** with an isolated server/database: settings
  navigation and legacy redirects, OPS_MANAGER visibility, job/laundry action
  placement, and holiday preview/apply/revert/billed protection.
- Captured overview, Money and Laundry settings at **390px and 1280px, light/dark**.
  Inspected mobile overview/light, overview/dark, Money/dark, Laundry/dark and
  desktop overview/light and Money/light. No page overflow, one h1, 44px search
  controls and keyboard focus checked in each capture. Compact phone cards and
  opting out of the saved-text popup were refinements from this inspection.
- ESLint: exit 0 with the existing **196 warnings**. Production build: **exit 0,
  761 pages generated**, including its TypeScript check. Standalone
  `tsc --noEmit --incremental false` also passed. Diff whitespace check passed.
- Initial browser attempts required narrower accessible-name locators and a clean
  dev-server restart after overlapping dev caches. The dedicated
  `e2e/settings-navigation.config.ts` now requires an explicitly started isolated
  server and allows cold compilation in its 120-second workflow budget; it never
  starts the ordinary port-3000 development server as a fallback.

Reproduce browser checks after starting the fixture server on port 3002:

```sh
PORT=3002 PLAYWRIGHT_BROWSERS_PATH=/workspace/.cloud-setup/browsers \
SNEEK_TEST_SERVER_ORIGIN=http://localhost:3002 \
SNEEK_TEST_DATABASE_URL=postgresql://sneek@127.0.0.1:55439/sneek_review_test \
npx playwright test --config=e2e/settings-navigation.config.ts --project=chromium-desktop
```

Logs and screenshots: `/workspace/scratch/settings-redesign/`. No deployment or
external delivery was performed.

## Follow-up: return navigation and operations-manager access

The next request asked for the last visited view/step to override defaults when
returning, until a full refresh, and for operations-manager feature switches and
reusable levels. Implemented per-manager packs and overrides; existing admin-only
boundaries remain protected. No permission expansion into owner-only services was
assumed.

The root layout now scopes transient view memory by user, role, retained account,
impersonation and record path. Bare links restore remembered queries; explicit
queries win. Jobs writes its latest state before navigating and suppresses
personal/team defaults on return. Shared classic Tabs and Estate workspaces reuse
the same storage lifetime. Refresh clears transient navigation values, preserving
saved views and form/evidence drafts. Classic and Estate client Jobs replace their old
unscoped localStorage preferences and remember the selected calendar month.
New onboarding surveys switch to their saved draft URL. QA's guided steps
remember position only alongside an available local draft; missing/corrupt drafts
return to the first step. Booking keeps its existing draft recovery protocol.

Settings → Access → Roles now has searchable Off / View only / Manage controls,
four built-in packs, custom packs and per-manager overrides. Base role references
are collapsed below the editable controls. The classic Roles section links to
this canonical editor. Configuration is an audited, revisioned AppSetting with
transaction-level serialization; concurrent first saves and stale updates cannot
overwrite one another. Failed saves retain the draft; conflicts require reload.

Middleware replaces untrusted path/method headers and checks API/page access.
`requireSession` independently checks fresh policy after identity/impersonation
resolution. Admin and alternate worker endpoint ownership lives in one catalog;
unmapped admin routes fail closed. Shared upload tools have a Files/media gate,
with additional job/property preview checks. Blocked navigation and search record
categories are omitted; settings subfeatures remain reachable when their overview
is off. Accounts holding ADMIN keep administrator authority. These are workspace
permissions, not field-level redaction or delegation of admin-only services.

Verification:

- Full unit/component/API run: **6,856 passed**, 114 conditional tests skipped.
  Then ran all database suites separately on disposable loopback port 55439:
  **113 passed across 17 suites**. The remaining skipped test is the existing
  `tests/lib/draft-store.test.ts`, skipped because this runner has no IndexedDB.
- **85 focused tests passed** for policy ownership/aliases, server and middleware
  guards, retained identities, search, permission editor conflicts/custom packs,
  shared tabs/state and navigation. Final classic Jobs/month and memory checks:
  **8 passed**, including ignoring the old cross-account persistent preference.
- **Two browser workflows passed**: Jobs list/detail return and full-refresh reset;
  manager Off/View-only/Manage changes with real API rejection and a successful
  revision-protected job update. The permissions workflow passed again after the
  reference matrix was collapsed. Captured 390px/1280px light/dark with computed
  theme and overflow checks; inspected all four combinations across the runs.
- Scope limits: representative browser coverage is Jobs and Settings. QA draft
  submission, every individual workspace, real-device bfcache and the separate
  `mobile/` / `sneek-nextgen/` apps were not comprehensively browser-tested here.
- Earlier checks exposed a first-save database race (fixed with the transaction
  lock), test storage leaking between cases (isolated in setup), outdated router
  mocks (updated), and brittle browser labels/nonexistent GET and empty PATCH
  fixtures (corrected to accessible controls and real endpoint/update contracts).
  A dev hot-reload race was resolved with a clean server; TypeScript must run
  without a concurrent dev restart deleting generated types.

The browser config intentionally requires a separately started disposable server:

```sh
PLAYWRIGHT_BROWSERS_PATH=/workspace/.cloud-setup/browsers \
SNEEK_TEST_SERVER_ORIGIN=http://localhost:3002 \
SNEEK_TEST_DATABASE_URL=postgresql://sneek@127.0.0.1:55439/sneek_review_test \
npx playwright test --config=e2e/navigation-permissions.config.ts
```

Logs: `/workspace/scratch/navigation-*.log` and
`/workspace/scratch/navigation-permissions/`. No deployment or external delivery.

The final classic/QA navigation changes also passed **36 focused tests** covering
shared memory, classic calendar return, QA ownership and scoring. The first
TypeScript check caught a QA step-list declaration-order error; that was fixed
before the final build. Existing QA hook-dependency lint warnings remain; no new
lint errors were introduced.

Final gates: production build **exit 0**, **764 pages generated**, including its
TypeScript check; ESLint remains at the existing **196 warnings**, with no new
warnings from the navigation/permissions changes. Diff whitespace check passed.
The last Estate client preference and staff filter-scope corrections passed
**14 focused component tests**; their targeted lint check was clean. The final
build log is `/workspace/scratch/navigation-build-verified.log`.

## Operational refinement follow-up: status, PIN delegation, laundry and live data

The follow-up addresses the owner's concrete reports rather than treating weather as scope. Mapped classic laundry `app/admin/laundry/page.tsx`, Estate workspaces, the shared week feed, per-user PIN storage, existing sensitive verification, invoice row locks/consumable release, GPS collection and the global request indicator.

Confirmed defects:

- The admin laundry “Today” tab was the entire active loaded window; totals mixed Sydney wall-clock and absolute dates, failed reads became empty arrays, and evidence was available only on completed cards. The new view lacked classic task report, replacement-evidence and handoff details.
- Dashboard server totals had no visible-page refresh.
- GPS heartbeats fabricated a fresh timestamp for indefinitely cached coordinates. Overlapping location snapshots could also overwrite newer readings.
- The global request toast closed in 900 ms on success and 1800 ms on error; HTTP failures were labelled Done and long-running requests inherited the toast's default expiry.
- OPS had its own PIN storage but no explicit sensitive-action grants. The former permission packs only restricted existing roles.
- Finance exposed delete/reverse controls for documents the server correctly protected, without a reconciled Xero correction workflow.

Implemented shared status tints and workflow progress, explicit sensitive-action grants in custom packs/per-manager overrides, personal-PIN server checks, local reconciled Xero void with retained audit/document/link, clearer invoice action eligibility, laundry date/search/status controls, cancellation and error states, handoff context and task-scoped Reports, audited photo replacement, genuine GPS heartbeat measurements, serialized Estate location reads and visible dashboard refresh. The modern laundry permanent/completed deletion path now requires the same credential and grant check; ordinary board suppression retains its existing permission rules.

No live invoice, external Xero record, email, production setting or deployment is changed by this review. Real device background GPS and external provider delivery still require an environment with those integrations.

Final follow-up verification:

- Full suite: **6,875 passed**, 114 conditional skips. Separately ran all **113 database tests successfully** against disposable loopback port 55439; the remaining IndexedDB-dependent test stays conditionally skipped in Node.
- After the full run, focused tests additionally passed for visible-page refresh, semantic correction-dialog content, rejecting older/untracked raw location updates, and closing an existing stream after feature permission revocation. The final targeted stream/policy/map/dialog run passed **27 tests**; correction/payment guard cases passed in the final edge run as well.
- Browser workflow passed with real disposable database fixtures: admin job progress, laundry details/search/task-scoped reports, owner grant editing, manager setting a personal PIN, denied job deletion without grant, and granted Xero reconciliation preserving invoice ID/link plus audit. Jobs, Laundry, permissions and the correction dialog captured at 390/1280 pixels in light/dark, with horizontal overflow assertions. The last dialog wrapper and raw-map/auth-stream refinements were covered by targeted tests after these captures.
- Earlier build found an import preceding the classic page's client directive; corrected. Earlier full-suite failures were outdated owner-only deletion expectations and a dashboard fixture missing the router mock; corrected and the subsequent full run passed. The final production build, including the stream-auth refinement, passed with the existing lint warnings (plus build-time runtime warnings). TypeScript passed as part of the build; all 764 static pages generated.
- Evidence: `/workspace/scratch/operations-unit-verified.log`, `operations-db-verified.log`, `operations-final-edges.log`, `operations-stream-verified.log`, `operations-review/browser-final.log`, and `operations-review/*-{390,1280}-{light,dark}.png`. Final build log: `/workspace/scratch/operations-release-build.log`.

Remaining limits: no real-device GPS/background-permission test, live Google Maps credential check, external Xero mutation or email-delivery test was performed. The Xero override intentionally records a confirmed manual external correction and never deletes paid/issued history. Changes are local and uncommitted; no deployment or external messages were performed.

### Follow-up: vector job workflow and consolidated Jobs filters

Shared job detail progress now uses SVG milestone icons and a connected responsive rail. Estate Jobs list/board blocks carry small status-specific vectors; animation is finite and disabled for reduced motion. A pause remains static. Status follows server snapshots, refreshed every 15 seconds while visible and on focus, with stale/error feedback and obsolete-response protection.

All Jobs filtering lives in one native collapsible disclosure; Clear filters now also clears search/status/date scope. Selecting a date shortcut clears custom dates to avoid competing controls. Display/saved-view tools remain separate. No data schema or workflow transition changed.

Validation for this follow-up: 53 focused tests passed (workflow semantics, URL/filter state, clearing, background failure/recovery and stale responses). Dedicated Chromium workflow passed against the disposable loopback database, checking keyboard collapse, real persisted status changes appearing in list/board, progress semantics and reduced-motion CSS. Captured/reviewed 390px and 1280px light/dark screenshots with no horizontal page overflow; corrected filter grid crowding found during visual review. Evidence: `/workspace/scratch/job-vectors/`. Background status freshness is polling (15 seconds plus focus), not a server-push guarantee. No deployment performed.

Final follow-up production build passed (exit 0), including TypeScript and lint; existing repository lint warnings remain. Build log: `/workspace/scratch/job-vectors/build.log`. `git diff --check` passed.

### Follow-up: Jobs view options menu

Moved team-default, personal saved-view and display controls into a closed-by-default panel reached through the heading's three-dot Jobs options → View options menu. The panel preserves mounted loaders and drafts. Added labelled personal-view actions, an active layout summary, keyboard focus handling and Reset appearance (preserves filtering). Existing publication confirmation, revision handling and admin/operations permission boundaries remain in the original components/services.

Focused validation: 87 tests passed across workspace URL/options, column choices, personal views and shared defaults. Includes a regression proving team defaults apply while options remain closed. Standalone TypeScript passed before final browser/build verification.

Browser validation passed: Jobs options opens from the heading menu, focus moves into the panel, team controls hide after Done, and view/status behaviour remains intact. Screenshots at 390px/1280px in light/dark passed overflow checks and were visually reviewed. A separate navigation workflow confirmed list/board restoration, detail-tab restoration and refresh reset. The initial cold-development run timed out before client hydration; the test now waits for the hydrated Export control before interacting and passed on rerun. Final focused tests were rerun after the menu focus adjustment. Logs: `/workspace/scratch/job-view-options/`; screenshots: `/workspace/scratch/job-vectors/view-options-*`. No external publication or deployment was performed.

Final production build passed (exit 0), including TypeScript and generation of all 764 static pages. Existing repository lint/dependency warnings remain. Final `git diff --check` passed. Build evidence: `/workspace/scratch/job-view-options/build.log`.


### Follow-up: cleaner evidence, multi-device sessions and job workflow

Implemented same-account shared receipt synchronization (10-second visible polling and focus), preserving local answers and checking races before restore. Manual bulk moves use one snapshot and three bounded workers; thumbnails select and a separate popup previews media. Older-form evidence owned by the same cleaner/job can be explicitly revalidated against the current form with an audit and retained original capture context. Own-reference removal preserves the original and creates a tombstone. Cross-account/job attachments remain restricted.

Cleaner changes include compact route/briefing, Sydney job date, stage restoration with refresh reset, SVG stage icons, property access only in Setup, references only Travel/Setup, removal of duplicate stale laundry briefing, selected-job Start driving and embedded current-property urgent stock. Charging proof extends the effective Jackson Airbnb form after rotation filtering, reusing suitable existing checks and preserving P3's Ring exception. Shared status icons extend across the affected classic/Estate cleaner, client, laundry and QA lists; this does not certify every portal or every external integration.

Verification so far:
- Separate Chromium contexts with intercepted shared API receipts passed photo discovery, assignment propagation, removal propagation and in-page preview checks at 390/1280 pixels, light/dark. This tests browser isolation and receipt reconciliation; it does not test real S3 transfers or two physical phones.
- Cleaner overview/setup: four Chromium viewport/theme cases passed and screenshots reviewed, with no horizontal overflow.
- Existing bulk AI/manual assignment: four browser tests passed at 320/390/1440 pixels, preserving explicit acceptance and reversibility.
- Cleaner form layout: three browser tests passed. Office evidence review: four passed, including partial failure/retry and wrong-reference confirmation.
- Initial full suite found 19 failures in three suites: route direct invocation needed default props; dashboard tests needed the refresh/router boundary and compact-route assertions; draft lifecycle read counts needed to include evidence-only focus reads. These were repaired and their targeted rerun passed.
- Stage-memory integration initially allowed a pre-hydration transition to save Setup as the remembered step; guarded transitions until initialization and added a navigate-away/return regression. Latest focused run: 89 tests passed across five suites.
- The initial standalone TypeScript run reported a charging-field flatMap inference error; the final build also surfaced it after the page-entry correction. Added an explicit FormField generic and reran standalone checking before the final build. Results are recorded below.

Logs and screenshots: `/workspace/scratch/cleaner-refinement/` and `test-results/{multi-device,cleaner-overview,bulk-auto-assign,job-clean-ui,draft-evidence-review}/`. No deployment or external messages performed. Real-device background GPS, provider delivery, and production media transfers remain unverified.

Final regression results: 6,904 tests passed across 625 suites; 114 tests in 18 suites were skipped by the default configuration. The six shared-draft database tests passed separately against the disposable loopback database. The added sync cases cover unchanged snapshots, late responses after unmount, and failure/recovery; all nine sync/device focused tests passed. Sixteen Chromium cases passed across multi-device, cleaner overview, bulk assignment, cleaner form and office review harnesses. The first production-build attempt exited after compilation/lint output without a diagnostic; a fresh final build was started. No deployment occurred.

The diagnostic build identified a generated Next.js PageProps error: a default page argument widened the route signature to include undefined. Removed that default and updated direct-call test fixtures to supply props. This is a page-entry typing correction; the selected-job route behavior is unchanged. A final production build follows this correction.

Final verification completed: standalone TypeScript exited 0; the corrected route/workspace regression run passed 92 tests, and charging tests passed 4. Production Next.js build exited 0, including TypeScript, lint and all 764 static pages. The last build invoked the same Next.js build command and repository filesystem preload directly with NEXT_DIST_DIR=.next-prod.__build to retain the existing cache; it did not promote the staged artifact or deploy. Existing lint/dependency warnings remain. Final build log: `/workspace/scratch/cleaner-refinement/build-complete.log`. Final `git diff --check` passed.


### Follow-up: settings-driven browser and install icons

Replaced the static favicon/manifest wiring with shared logo rendering from Company & brand's existing light-background logo. Kept the manifest URL and application identity stable. PNG sizes cover favicon, Apple and Android, with a separate maskable variant contained within the Android safe circle. Root metadata references versioned URLs; the manifest and dynamic icons bypass service-worker runtime caching. Sources are limited to the saved configuration, public image files, branding storage keys, or validated public HTTPS URLs with redirect denial and bounded reads. Failures return a usable bundled icon without retaining a failure cache.

Initial verification: 13 focused tests passed, including image dimensions/pixels, safe padding, manifest identity, version changes, fallback and invalid-source checks. Standalone TypeScript passed. Browser and final production-build results follow below. Actual Android/iOS installation is not simulated by Chromium metadata checks; existing shortcuts may need to be re-added.

Final brand-icon verification: 16 focused tests passed. Core routes are 100% covered for lines/branches/functions; the image helper is 98.24% lines, 87.93% branches, 100% functions. Branch coverage remains below the advisory 95% target; no mandatory repository coverage gate is configured and no baseline comparison was measured. Metadata layout and settings copy are exercised by build/browser checks, not included in those coverage figures. Production build passed (764 pages), including TypeScript and lint with existing warnings. A real production-server Chromium test against the disposable loopback database passed all four viewport/theme combinations and verified public manifest/icon responses, Apple metadata and branding URL changes; fixture settings were restored. Phone-light and desktop-dark screenshots were visually reviewed. Initial browser startup failed because the runner used the e2e directory; the config now sets the repository working directory and passed. Logs: `/workspace/scratch/brand-icons/`. Physical Android/iOS installation and deployed storage credentials remain unverified.


### Follow-up: owner Jobs and shared permission loading failures

The owner reported the generic Jobs error and then “Permissions are temporarily unavailable” in calendar sync and Test as. Regression tests reproduce the middleware callback network failure that produces that shared message. Production logs are unavailable, so the underlying production DNS/proxy/network condition is not independently confirmed.

The fix keeps central middleware authorization and routes both root and retained session validation to the deployment-controlled `NEXTAUTH_URL_INTERNAL`. The existing Next runner sets loopback at its actual port for start/dev when no override exists. This removes the public-host network dependency without bypassing API checks; custom launchers must supply their trusted internal origin. Cookie selection still follows the public NextAuth configuration. Callbacks reject redirects, time out after five seconds and treat upstream 5xx as unavailable rather than revoked credentials. No Jobs-specific exemption remains.

Added owner Jobs API tests using the real session/permission guard for reads, inactive/deleted users, demoted ADMIN tokens with OPS Jobs disabled and cleaner assignment scope. Middleware regressions cover internal routing for Jobs/calendar sync/unlock, retained identity, disabled OPS features and fail-closed outages. Runner tests verify port selection and preservation of explicit configuration. Jobs UI distinguishes 401/403/503/other server failures and malformed data without exposing raw error bodies; Retry retains filters.

Verification results follow below.

Focused verification: 73 tests passed across middleware, retained-account handling, live Jobs authorization, Jobs UI recovery and launcher configuration; standalone TypeScript passed. Focused coverage measured middleware at 66.29% lines / 71.87% branches / 54.54% functions and Jobs workspace at 81.88% lines / 87.96% branches / 30% functions. These full-file figures are below the advisory 95% target, include substantial unrelated routing/UI and are not a claim of full application coverage. No repository threshold is configured. Logs and coverage are under `/workspace/scratch/jobs-loading/`.

Production build passed (764 pages; existing lint/dependency warnings). A real production-server Chromium test against the disposable database passed: owner Jobs returns its fixture, calendar-sync history returns 200, correct-password Test as unlock succeeds, and Jobs recovers from a synthetic 503 without losing its filter. The first browser run exposed a harness limitation: production's Secure unlock cookie is not automatically sent by Playwright's API client over local HTTP. The test now explicitly round-trips that signed proof and checks the Secure attribute; application cookie security was not changed. Jobs was captured at 390/1280px in light/dark with no horizontal overflow; phone-light and desktop-dark captures were visually reviewed. Fixtures were removed. No external calendar pulls, actual impersonation or production mutations were performed. Live hosting rollout and production DNS/proxy conditions remain unverified.

### Follow-up: deployable migration completeness

The permission transport and branding changes did not alter the database schema. An audit nevertheless found older drift by replaying all 127 committed migrations into a disposable shadow database and comparing against `schema.prisma`: four FK deletion rules, onboarding defaults, two missing declared indexes, two useful migrated indexes absent from the schema, and the migrated blog-tags default absent from the schema.

Added transactional forward migration `20261009120000_reconcile_schema_contract`; no applied migration was edited. Existing useful indexes and the blog-tags default are now represented in the schema rather than removed. The SQL changes no stored rows or column types. FK replacement and index creation take ordinary PostgreSQL locks during this one-off deployment. `npx prisma migrate deploy`, `npm run db:deploy`, and the existing `scripts/migrate-once.sh` consume the same migration directory. `AGENTS.md` now requires forward migrations and fresh/upgrade/repeat parity verification for future schema work.

Verified on disposable PostgreSQL at loopback port 55439: upgrade from 127 to 128 migrations succeeded; a second deploy reported no pending migrations; all 128 migrations deployed successfully from empty; both databases report no difference against the Prisma schema. Prisma validation and Client generation passed. Fifteen regression tests passed, including four real-database checks proving that job deletion cannot cascade away QA/evidence and property deletion preserves shopping-line quantities/costs. No production database was accessed. No UI changed, so browser screenshots and JavaScript coverage percentages do not apply to this schema/SQL change. Build verification follows below. Logs are in `/workspace/scratch/migration-review/`.

Final production build passed, including TypeScript/lint and generation of 764 pages, with existing warnings. Temporary shadow/fresh databases were removed; the reusable review database remains migrated. Production deployment/migration was not run from this environment.

### Follow-up: Jobs filter disclosure memory

Removed the permanently controlled `open` attribute that could reopen filters on data updates. The native disclosure now restores an account/view-context-scoped browser preference on mount/context change and records toggle events. Only the display choice is stored, not records or filter selections. It persists across page refresh as requested, independently of navigation-memory query reset. Storage denial is caught; first use stays expanded. No schema or migration changes.

The 35 focused Jobs workspace tests passed, including collapse through a response-driven rerender, remount restoration for both choices and isolation between account contexts. Production browser coverage adds keyboard collapse, full-page return, reload, expanded-state restoration and collapsed screenshots at 390/1280 in light/dark. Final verification follows below.

Final verification: 35 focused tests passed; workspace coverage is 82.10% lines / 86.93% branches / 30.98% functions (below the advisory 95% target, no configured hard gate). Production build passed with TypeScript/lint and 764 pages. The first build hit a transient Google Fonts URL parsing failure; font CSS was checked and the repeat build passed. An intermediate browser run against the previous build was not accepted as verification. The final real-production-server Chromium run passed disclosure persistence, reload, keyboard and 390/1280 light/dark checks; phone-light and desktop-dark captures were visually inspected. Service workers are blocked in this fixture test to avoid background worker replacement reloads; service-worker behavior is not claimed tested. Fixture data was removed. Logs: `/workspace/scratch/jobs-loading/filter-*`.

### Follow-up: remove the shared API callback failure for Owner Admin

The owner continued reporting “Permissions are temporarily unavailable” across pages after the transport fix. That message can still originate from the redundant API middleware callback. The earlier change improved the callback destination but did not eliminate that dependency. Removed the HTTP callback from the API branch; protected handlers retain the real `requireRole` → `requireSession` → live user/role/impersonation → `enforceOpsRequest` chain. Explicit ADMIN bypasses manager policy packs; the existing held-ADMIN exemption remains. No revoked-session, retained-account or read-only impersonation bypass was added. Page and retained-account validation transports remain in place; an unavailable OPS page validation still fails closed.

Audited all 487 feature-classified API route files. Protected handlers use the local guard directly or through Jobs-view, invoice-payee and route-local authorization helpers; three alias routes re-export guarded cases handlers. The two intentionally public exceptions are the signed Resend webhook and bounded/rate-limited upload-failure diagnostics. Their existing verification remains unchanged. No business API depends solely on the removed callback. Future route rules now explicitly require local authorization.

Added regressions for an unreachable callback across Admin reads/writes, trusted scope headers, retained identity, read-only impersonation, owner reads with a failed policy store, revoked/deleted owners, demotion and restricted impersonated managers. The production browser fixture intentionally uses a closed port for `NEXTAUTH_URL_INTERNAL` and exercises owner Properties, Laundry, Finance, Settings, Jobs and Test as; its final outcome is recorded below. This is not a production-host connection or production database test. No migration is required.

Focused verification: 66 tests passed, including the real-database OPS policy update/audit regression. Coverage measured middleware at 68.04% lines / 67.24% branches / 54.54% functions and policy at 95.41% lines / 87.50% branches / 66.66% functions; these remain below the advisory 95% target in some metrics, with no mandatory repository threshold. Production build/browser results follow below. Logs: `/workspace/scratch/jobs-loading/admin-rights-*`.

Final verification: production build passed (764 pages), including TypeScript and lint with existing warnings. The production-server Chromium regression passed with the session HTTP callback deliberately unreachable: owner Properties, Laundry, Finance and Settings pages returned 200; Jobs API returned real fixture records; calendar history returned 200; Test as accepted the correct owner password; Jobs retry/filter-memory behavior passed at 390/1280 in light/dark. Phone-light capture was visually reviewed. Fixture data was removed. Live hosting and the production database remain unverified; no production credentials were used.

### Late form clock-out preservation and mobile cropping

- Root cause: both cleaner interfaces captured fresh GPS after any successful form submission; the GPS endpoint overwrote job coordinates unconditionally. Closing a previously-read TimeLog also lacked a conditional stopped-state guard in manual, submit and geofence paths.
- Stop responses now carry the segment they actually closed. Late forms return no segment and never request GPS; stopped-clock wrap-up says “Submit form”. Server GPS writes validate current assignment, latest owned segment, recent stop, and unchanged job context. Concurrent or repeated captures keep the first saved location and actual stop timestamp. Historical coordinates without a timestamp remain preserved. A real later shift can record a new location.
- No migration or production database write. Previously overwritten locations cannot be reconstructed by this patch. GPS is optional and captures arriving more than 120 seconds after the stop are deliberately ignored rather than misattributed.
- Dashboard and Live Ops mobile grids now explicitly shrink to one column; spanning dashboard panels can shrink, and card headers wrap their actions. Wide tables retain their own scroll container. Browser checks examine panel rectangles as well as document width, because global clipping can hide overflow.
- Regression verification: 105 focused tests, including seven disposable PostgreSQL retention/concurrency cases; four real StageWrapup Chromium checks at 390/1280 in light/dark, keyboard submission and active/stopped labels. Coverage sample before the last two edge cases: GPS route 96.42% lines / 83.33% branches, checkout service 94.73% / 91.66%, submit route 81.12% / 78%, whole wrap-up component 40.76% / 57.37%. These focused tests do not establish 95% coverage across the large legacy components; no required coverage gate is configured.
- Production build and its TypeScript check passed. Authenticated Chromium regression passed against that build: owner Jobs loading, permission callback outage, retry/filter retention, and Dashboard/Live Ops panel bounds at 390/1280 in light/dark. Phone screenshots visually inspected; desktop Live Ops also inspected. Google Maps key absent in fixtures, so map fallback/layout was exercised, not live provider tiles. Existing lint, Tailwind and dependency warnings remain. Live hosting deployment is not observable from this environment.

### Photo and large-video upload recovery

- Confirmed code failure: durable transfer failures aborted their multipart allocation, while subsequent evidence recovery only attempted HEAD/attachment. That made an incomplete object permanently fail on Retry. Phone compression failures separately blocked originals above 150 MB. The user subsequently confirmed both photos and videos fail.
- Preserve durable allocations; resume the same key using saved prepared bytes and server-listed parts. Renew signed URLs, recover completed objects after lost responses, and recreate a previously aborted upload only after explicit missing-upload plus missing-object confirmation. Permission and unknown storage errors cannot trigger blind retransmission. Inline Retry works after field remount/reload and keeps successful attachments deduplicated. Concurrent field recovery reads are shared to avoid scanning the full local evidence store once per field.
- Optional original-video fallback now includes large clips. Presigned parts still assemble into one media file; neither compression nor transfer creates multiple form attachments. Transient streaming-proxy failures are classified as retryable, and transfer sockets have a bounded timeout.
- Tests cover partial success, expired/aborted allocations, completion races, incorrect part/object size, unrelated keys/owners, revoked/unauthenticated access, storage failures, preparation fallback, evidence persistence and submission coordination. Chromium uses the real media component, IndexedDB and upload client with simulated storage responses: photo and video failures, full reload, keyboard Retry, one final attachment, and no retransmission of acknowledged video parts at 390/1280 in light/dark. Synthetic undecodable video bytes deliberately test the actual original-file fallback; photo input is PNG. This is not a test of a physical phone's codec stack or production object storage.
- Production storage credentials/logs and hosting deployment remain unavailable. The precise live upload error/status was not supplied, so observed live storage or ingress configuration problems cannot be ruled out. No production files or database records were modified; no migration required.
- Verification: 239 distinct focused regression tests passed (including cancellation during transfer, timed-out sockets, signed-URL expiry and completion failure); eight browser interruption/reload/retry cases passed. Phone dark video and desktop light photo screenshots inspected. Focused coverage sample before the final four transport cases: upload proxy 100% lines / 79.16% branches, resume route 97.43% / 86.66%, evidence client 97.7% / 79.03%, multipart client 92.93% / 73.75%, whole media component 72.4% / 69.14%. These focused suites do not demonstrate 95% whole-file coverage across legacy UI; no required coverage threshold is configured.
- Final release-source production build passed, including TypeScript validation and all 765 generated pages. Final-source eight-case Chromium run passed after the shared-read optimization. Existing lint/Tailwind/dependency warnings remain; live deployment and production storage behavior are unverified.


### Follow-up: automatic iCal worker startup (2026-10-18)

- Reproduced the deployed-style command `npx tsx workers/boss.ts` failing on the `server-only` import from `lib/db.ts` before either safety gate or schedule registration. Re-running with the existing `--tsconfig tsconfig.scripts.json` reaches both disabled-worker exits successfully. Compose already opts its worker in; Dockerfile-only startup serves only the web app. Live topology, logs, heartbeat and feed history are unavailable, so the production cause is not asserted.
- Changed only the existing Compose/development worker commands and their documented invocations. Retained worker opt-in and master/per-job kill switches, inert web scheduler, all scheduling frequencies and domain handlers. Automatic iCal remains every four hours in Sydney and selects enabled integrations with non-null URLs; manual sync retains actor attribution and role checks.
- 31 focused tests passed: real subprocess startup imports/safety exits, mocked worker registration and iCal disable switch, real automatic/manual sync service entry paths with mocked database/fetch (304 success and isolated fetch error), manual authorization, scheduler boundary and iCal timing rules. No live database/provider was contacted. No UI changed; browser screenshots are not applicable. Initial test expectation used `FAILED` instead of the existing `ERROR` run status; corrected the test, without changing application behavior.
- Final verification: standalone TypeScript passed; production build passed (735 static pages, exit 0) with existing lint/Tailwind warnings and expected database-unavailable messages from the deliberately closed loopback database URL. `git diff --check` passed. Logs: `/workspace/scratch/ical-worker/`. No live worker scheduling, external calendar delivery, merge or deployment was performed.


### Follow-up: cleaner upload recovery deadlines (2026-10-28)

See `docs/qa/cleaner-upload-reliability-2026-10-28.md`. Verified repository `sanuthdesitha/sNeek_Property_Services_Webapp`, starting clean on branch `work` at `afba905f8f5d8bf7d9bf7ea144e419950920224f`. The shared multipart client bounded only transfer response headers; setup, resume, completion and attachment could stall indefinitely, and fallback receipt reads outlived the transfer timer. Retry could also abort an existing multipart allocation if local metadata persistence failed. Focused fixes preserve original bytes, receipt scope, exact-key resumption, tombstones and server authorization. Historical “Job evidence changed” was not assumed to be this incident's cause. Verification and remaining limits are recorded in the linked review; no live job/form submission, storage configuration change or deployment was performed.


Final upload follow-up coverage: 341 focused tests and 11 browser fixture tests passed. Changed source files each exceed the unchanged 95% coverage gate: evidence client 100% lines / 99.73% branches / 100% functions, multipart client 100% / 98.13% / 100%, request helper 100% / 100% / 100%. Added recovery boundary tests preserve storage/receipt scope, terminal removals and partial batch successes; unrelated draft-lifecycle failures independently reproduce on the base commit and remain documented separately. TypeScript and lint passed; the final production rebuild is recorded in the linked review.

### Follow-up: automation stopped in single-container deployments (2026-11-10)

- Reported symptom: iCal auto sync and other main features stopped working. Starting checkout `4f89558` (main), clean.
- Cause established in source: commit `2722477` (4 October) made `lib/ops/web-scheduler.ts` inert. Until then it was the documented default for a web-only container. The Dockerfile `CMD` and a platform start command of `npm run start` start only Next.js, so such a deployment ran none of the 42 scheduled jobs afterwards. The hosting account shows a Dokploy VPS; its container configuration and logs could not be read from here, so the production topology is inferred, not observed.
- Fix: `npm run start` launches `scripts/embedded-worker.cjs`, which supervises `workers/boss.ts` as a sibling process with crash backoff and the existing operator switches. Compose `web` keeps `SNEEK_WORKERS_DISABLED=true`. iCal sync is hourly. Device pushes older than six hours and campaigns more than 24 hours overdue are not replayed after an outage.
- Also fixed: `npm run db:seed` / `db:seed:demo` crashed on the `server-only` guard; four draft-lifecycle tests used a submit fixture without the server clock-out confirmation introduced on 9 October; the retained-accounts database test depended on an ambient `NEXTAUTH_SECRET`.
- Verified: real supervisor run against a fresh migrated disposable database on `127.0.0.1:55439` logged `pg-boss started` and `All workers registered`, stored the `ical-sync` schedule as `0 * * * *` Australia/Sydney with 42 schedules in total, and wrote a heartbeat advertising `ical-sync`. Focused tests for the supervisor, start script, worker startup/registration, mobile outbox and campaign sender pass. Baseline full suite before these edits: 7,240 passed, 12 failed in three files (the four stale lifecycle tests, three missing-secret failures, and five caused by this change's first draft of the start script); all three files pass after the fixes. Standalone TypeScript passes.
- Not verified: the production deployment, its environment switches, feed responses, or an unattended AUTO run in production. After deploying, confirm the three startup log lines and a new AUTO sync run in Admin → System diagnostics.

### Follow-up: placement, Estate conformity and portal sweep (2026-11-10/11)

Request: check recent features, make them match the Estate UI and sit in practical places. Method: seeded disposable database `127.0.0.1:55439/sneek_ui`, production build served by the real start command, Chromium.

**Found and fixed**

- Urgent stock was a card wedged between the tab bar and the active tab on Inventory and Supplies. It is now a tab on both (ADMIN-only on Inventory, enforced by the server tab normaliser as well as the tab list).
- The shared feature disclosure used a text "+"/"−" ghost button. It is now an Estate card row with icon, purpose line and chevron; its accessible name is unchanged. Bag tracking, turnover profit and client property care moved after the workspace they supplement.
- Classic Inventory, Restock, admin Property and client Property had bare links above the heading; they are header actions now. The Cleaners page's bare "addresses" link is a header action and the addresses page uses Estate primitives.
- Estate screens using plain utilities rendered classic grey/teal. The skin now maps the classic variables to Estate tokens and sets `color-scheme: dark` in Obsidian.
- `Permissions-Policy` had `camera=()` and `microphone=()`. The crawl logged "camera is not allowed in this document" on the cleaner Quick scan page. Same-origin camera and microphone are allowed again; a middleware test asserts it.
- `/v2/admin/properties/[id]?tab=…` was ignored (the Inventory → By Property link pointed at it). Explicit links now win over the remembered tab.
- Page-header actions could not wrap, so Properties, Reports, Live map, Route map and Website overflowed at 390px (65–189px). The Reports theme row also overflowed. Both wrap now.
- Approvals had no page heading; the cleaner job title and the onboarding survey number were not the page `h1`.
- The cleaner job page opened with a seven-step status rail that pushed the stage controls below the first phone screen. It is a slim segmented bar below 640px.
- Laundry calendar took "today" from the runtime clock, so a browser in another timezone failed hydration (React #425/#422 in the crawl). It uses the Sydney day on both sides.
- Property care showed "Retry loading" while still loading; it appears only after a failure.
- iCal: an unchanged feed cleared its ETag/Last-Modified, forcing a full re-import next run; interrupted runs stayed `RUNNING` forever. Both fixed with tests.

**Verified**

- TypeScript `--noEmit`: pass. ESLint on touched files: 0 errors, 5 existing-style warnings.
- Full Vitest suite on disposable PostgreSQL: 7,267 passed, 1 failed, 2 skipped across 659 files. The one failure was the addresses page test asserting the old empty-state text; it is updated and passes. The suite was not rerun in full after that one-line test edit.
- Production build: pass, 765/765 pages.
- Real start command with the embedded worker: web ready, `pg-boss started`, 42 schedules, fresh heartbeat.
- Production crawl at 390px, after the fixes that preceded it: admin 153 pages, cleaner 29, client 30, laundry 13, QA 7. No failed API calls and no page errors except the laundry calendar hydration error fixed above. Remaining pages without an `h1`: the onboarding wizard and the form builder (full-screen editors), left as they are.
- After the final rebuild: 16 changed screens × 390px/1280px × light/dark = 64 checks, all with no horizontal overflow, exactly one `h1` and no console errors. Screenshots inspected by eye: admin Inventory urgent-stock tab (1280 dark), cleaner job (390 dark), plus earlier captures of Inventory, Finance with the profit panel open, cleaner Supplies urgent tab (390 light), and admin Property.

**Not done / limits**

- The maintenance portal was not crawled (no seeded maintenance login). The classic (v1) portals were changed only where a feature link was misplaced; they were not crawled.
- The seeded data is small. Screens that need real volumes, submitted forms, laundry runs, invoices or media were checked for loading and layout, not for every state.
- Keyboard operation and draft retention were not re-exercised by hand in this pass; the existing component tests for those behaviours pass.
- `e2e/urgent-stock.spec.ts` was updated for the tab but the real-database Playwright suites were not run.
- Raw-styled markup remains inside some panels (`property-deep-clean-planning`, `vision-settings`, `photo-review-panel`, `quantity-exceptions`, `started-work-review`). The theme bridge gives them Estate colours; their layout was not redesigned.
- Nothing was deployed. Production behaviour, including the iCal feeds, is unverified until this branch is deployed and an AUTO sync run appears in Admin → System diagnostics.

### Follow-up: remaining portals, operations-manager access, maintenance and the activity bar (2026-11-11)

Request: apply the same checks and fixes to the cleaner, client, laundry, operations-manager and maintenance portals, and replace the upload/loading indicators with one summary bar in the Estate style. Starting point: `main` at `0062632` after PR 28. Method as before: disposable seeded database on `127.0.0.1:55439`, production build served locally, Chromium. A maintenance worker login and five maintenance items were added to the fixture database only.

**Operations manager**

- Compared every parameterless GET API (218 routes) as ADMIN and as OPS_MANAGER. Fourteen differed. Twelve are intended ADMIN-only areas (Ollama setup, holiday rates, integration credentials, permission packs, settings audit, invoice numbering, system diagnostics, Test-as unlock, turnover profit, urgent-stock administration, bag custody, Xero). Two were defects: `/api/auth/2fa/settings` (401) and `/api/auth/webauthn/credentials` (403). Cause and fix are in `docs/SYSTEM.md`; both return 200 for a manager now.
- `/v2/admin/activity` and `/v2/admin/diagnostics` rendered "Application error: a server-side exception" for a manager. They, the form builder and Cleaner addresses now redirect to an explanation. Activity log, Diagnostics and Test as are hidden from a manager's menu and still shown to an administrator. An administrator opening a cleaner-only page gets `/unauthorized` instead of a server error.

**Maintenance**

- Defect: the worker dashboard, Replacements, Log, the visit page shell and the badge-count API listed every maintenance item in the business. Verified with an unassigned fixture item titled "SECRET other contractor job": after the fix it appears on none of the four worker screens, its visit page does not render its title, and the badge counts are the worker's own (3 and 3).
- Tickets list, dashboard stat grid and visit page order reworked as described in `docs/SYSTEM.md`.
- Note: `recommendedAction` defaults to `REPLACE` in the schema, so an item created without an action counts as a replacement. Left unchanged; it is existing data policy, not something this pass should silently alter.

**Activity bar**

- Browser check with simulated slow responses at 390px dark (cleaner job page) and 1280px light (admin Reports): five concurrent uploads produced one bar reading "Uploading 3 of 5 files" with "2/5", then "5 files uploaded" (with "· Report PDF ready" when a report ran alongside), and it closed by itself. Four uploads with two HTTP 500s produced one alert: "2 of 4 uploads did not finish. Check the details and retry." No toast was rendered in either run. Screenshots of the working (390 dark) and failed (1280 light) states were inspected.
- The cleaner capture now reports to the bar. Its integration is covered by component and unit tests; it was not exercised with a real camera or real storage here, because no storage provider is configured in this environment.

**Verified**

- TypeScript `--noEmit`: pass. ESLint on touched files: 0 errors, 1 pre-existing warning.
- Full Vitest suite on disposable PostgreSQL: **7,314 passed, 2 skipped, 661 files passed**. Run before the final one-line stat-card class change; TypeScript and the production build were rerun after it.
- Production build: pass, 765/765 pages (one earlier attempt failed on a Google Fonts download and passed on retry without changes).
- Crawl at 1280px after the fixes: cleaner 29 pages, client 30, laundry 13, QA 7, maintenance 9, operations manager 134. No failed API calls, page errors or horizontal overflow. Pages without an `h1` remain the onboarding wizard and form builder.
- Crawl at 390px for maintenance (9 pages): clean.

**Not done / limits**

- Laundry and QA were swept for errors and layout; their list queries were not audited for per-worker scoping the way maintenance was.
- The classic (v1) portals were not crawled. Classic screens keep their own upload widgets (`components/ui/upload-dropzone.tsx` and the v1 cleaner job page show per-file progress); the single bar still summarises their requests, but those inline bars were not removed.
- Custom operations-manager permission packs (View only, Off) were not exercised in the browser; the fixture manager has the default full pack. The existing middleware and policy tests for packs pass.
- The real-database Playwright suites were not run. Nothing was deployed.

### Follow-up: client approvals and the cleaner, client and laundry access review (2026-11-11)

Request: fix the client portal not showing approvals waiting on the client, then look deeper for UI, code and security issues in the cleaner, client and laundry portals. Starting point: `main` at `2d4fdc7` after PR 29.

**Client approvals.** Reproduced the cause in code and in the browser. The Approvals page lists `ClientApproval` records; the navigation badge counted the client's own job requests awaiting the office. With one PENDING approval created as admin on the fixture database, the client's badge now reads 1, the list shows it, and the dashboard's "Requires attention" and property "Approval inbox" agree. One access rule is shared by list, respond, counter and badge.

**Method for the review.** Three independent read-only reviews covered `app/api/client/**`, `app/api/cleaner/**` with `app/api/jobs/**` and `app/api/uploads/**`, and `app/api/laundry/**` with the laundry pages and shared routes. Every finding acted on below was re-read in the code before it was changed. Findings are code-reading results; none was exploited against production.

**Fixed (each with a test unless noted)**

- Email-matched approval access with an unverified, self-changed email. Found while tracing approvals, not by the reviews.
- Role gate admitted on a held role while handlers scoped by the active role.
- Cleaner job list and job form returned client price, raw office notes, every cleaner's payout and pay rate, colleague and client emails.
- Cleaner shopping reimbursements were offered to every cleaner when no payer was recorded.
- Laundry: invoice scope widened to all properties on an empty match; Today, Stats, Reports and Invoices pages and badge counts unscoped; cleaner-only access guide entries and client email sent to the browser.
- Stock scan endpoints open to any signed-in user. Verified on the build: client and laundry receive 403, cleaner 200.
- Client portal: assistant property scope on task requests, cases and preferred cleaner; case module and reply settings; report and link claims on cases; staff and cleaner emails in cases, messages and cleaner options; expired quote acceptance; payment return address and outstanding amount; shopping run property claims.
- Notification inbox clear deleted everyone's notifications for office roles. GPS arrival could be rewritten with a client flag. Resumed upload folder not validated. (No new test for these three; existing suites pass.)

**Verified**

- TypeScript `--noEmit`: pass. ESLint on touched files: 0 errors, 2 pre-existing-style warnings.
- Full Vitest suite on disposable PostgreSQL after the final edits: **7,348 passed, 2 skipped, 665 files passed**.
- Production build: pass, 765/765 pages.
- On the build, as fixture users: client badge and approvals list; client 403 on the three stock scan routes; cleaner form and list payloads contain none of `fixedPrice`, `internalNotes`, `reworkPayAmount`, `adminOverrideNote` and no email other than the cleaner's own; laundry invoice preview for an unseen property returns no rows; laundry pages render.
- Crawl at 390px after the fixes: cleaner 29 pages, client 30, laundry 13. No failed API calls, page errors or overflow.
- UI: client home, cleaner home and laundry home stat cards no longer stack one per row on a phone; client approval job type is sentence-cased; property view toggle shows its active state.

**Reported and NOT fixed at the time.** These were real or plausible and needed either a product decision or a larger change than was safe to make blind. **All but the storage-bucket question and the push-token item were resolved on 2026-11-11; see "Follow-up: owner decisions and the remaining list" below.**

Cleaner
- Property access and alarm codes are returned for any job with a live assignment, including unaccepted offers, jobs months ahead and completed jobs. There is no time or status window anywhere.
- Job submit, damage, lost-found, pay-adjustment and invoice-proof routes accept evidence object keys without checking the caller owns them.
- `uploads/presign`, `direct` and `presign-multipart` accept any `folder` from any signed-in role.
- A cleaner's shopping run becomes reimbursable as soon as a personal payment method and a cost are saved, including a draft with no receipt and no office approval. Rows may name any property, which raises a pending client charge.
- Reschedule and approval requests and draft deletion have no upper job-status bound. Location pings accept a future timestamp.
- If the storage bucket is public (`S3_PUBLIC_BASE_URL` in the example points at a public R2 URL), knowing an object key is the only control. Deployment not inspected.

Client
- List endpoints ignore visibility switches the single-record endpoints honour: cleaner names, laundry notes/meta/photos, report PDF links.
- Stock and shopping routes read the global module switches, not the per-client overrides; stock thresholds can be edited regardless of the setting.
- Stock runs return the requester's email. Case transition reasons and metadata reach the client unfiltered. The job task-requests list returns office-source tasks and event notes.
- Invoice pay and payment-link do not check the finance visibility switch.

Laundry
- The legacy flat access fields (lockbox, codes, parking) are shown to laundry on every property regardless of the "same as cleaner" setting. This is long-standing visible behaviour, so it was not removed without a decision.
- Driver location pings are attached to the first laundry task of the day globally, which can surface a driver's position on an unrelated job.
- Drop-off evidence keys and `supplierId` are accepted without ownership or existence checks.
- The lost-found detail returns guest contact and the office timeline to the reporting cleaner (possibly intended).

Shared
- `User.notes` was both the cleaner's "notes to admin" on their own profile and the office's staff note in the Accounts hub. **Resolved in the follow-up below.**
- The mobile push device endpoint reassigns an existing token to the caller.

**Limits.** Routes the reviews could not fully trace are not cleared: the 1,187-line cleaner submit route beyond key validation, damage investigation field stripping, client purchases and referrals, laundry invoice PDF building, and several helper bodies. Assistant (VA) fixes were not exercised in the browser; there is no VA login in the fixture data. The real-database Playwright suites were not run. Nothing was deployed.

### Follow-up: separate office notes from a person's own notes (2026-11-11)

The owner authorised a database change for the shared notes field, on condition that existing data is preserved.

- Change: new nullable `User.adminNotes`; migration `20261111120000_user_admin_notes` adds the column and copies each non-blank `notes` value into it. `User.notes` is not modified. The office notes route and both Accounts hub editors use the new column; the person's own note is shown to the office read-only.
- Migration verification on disposable PostgreSQL `127.0.0.1:55439`:
  - Existing migrated database with data (7 users, 2 with notes, one of them whitespace only): the checksum over every `notes` value was identical before and after (`fbbd3109…`); the non-blank note was copied to `adminNotes`; the whitespace-only note was left alone and not copied.
  - Repeat `migrate deploy`: no pending migrations.
  - Fresh empty database: all 129 migrations applied; repeat reports none pending.
  - `prisma migrate diff` from the migrated database to `schema.prisma`: no difference.
- Behaviour on the production build: the admin saved an office note and saw it after reload; the cleaner's profile page and `/api/me/profile` contained neither that text nor an `adminNotes` key, and still showed the cleaner's own note; a cleaner `PATCH /api/me/profile` carrying both `notes` and `adminNotes` changed only their own note.
- TypeScript: pass. Full Vitest suite: **7,354 passed, 2 skipped, 666 files**. Production build: pass, 765 pages.
- Not verified: the production database. Notes the office wrote before this change remain in the affected person's own notes field, where they were already visible to them; this change does not and cannot tell the two apart.

### Follow-up: owner decisions and the remaining list (2026-11-11)

Request: decisions on the five open items (access codes get a window from acceptance until a day after the clean; shopping reimbursement waits for approval; split the notes; laundry sees the same codes as cleaners, tidied; check evidence ownership and explain how), plus "fix all the items on the list". Method: same disposable database `127.0.0.1:55439/sneek_ui` and production build as above. No schema change in this round.

**Decisions implemented**

1. Access window: `lib/properties/access-window.ts`. Open from acceptance until the end of the day after the clean (Sydney), and whenever the job is under way. Applied to the briefing, the job form and the property access guide. Outside it the codes are absent and a reason is returned and shown.
2. Reimbursement approval: a cleaner's personally paid run is `PENDING_APPROVAL` until the office approves; only `READY` reaches pay or an invoice; a later cost change needs approval again. "Approve reimbursement" on the admin run detail.
3. Notes split: done in the previous follow-up.
4. Laundry access: laundry reads cleaner-audience entries on every property; the stop card shows one "Property access" panel.
5. Ownership: the uploader's id is the second-last segment of every stored key and is set by the server. Submitted keys must belong to the caller, a cleaner assigned to the same job, or office staff. Refusal is 403 `FOREIGN_UPLOAD_REFERENCE` before any write.

**The list**

| Item | Outcome |
| --- | --- |
| Access codes with no window | Fixed (decision 1) |
| Evidence keys accepted without ownership | Fixed: submit, damage, damage report, lost and found, pay requests, invoice proof, shopping receipts, laundry photos, client task-request attachments |
| Upload folder open to any role | Fixed: field roles refused office folders. A deny-list, not a per-role allow-list, because the mobile client's folders were not inventoried |
| Shopping reimbursable without approval; rows naming any property | Fixed (decision 2); rows must be existing active properties |
| Reschedule/approval requests without a status bound | Fixed |
| Draft deletion without a status bound | Not changed. An existing regression test documents that clearing a submitted job's draft is intended; it removes no submission or evidence |
| Future-dated location pings | Fixed (cleaner and laundry, two-minute tolerance) |
| Public storage bucket | Not a code matter and not inspected. If the bucket is public, a key is the only control on reading a file; the ownership check stops a key being *attached* by someone else, not *read*. Needs a deployment check |
| Client lists ignoring visibility switches | Fixed for jobs, laundry, reports and property detail, in API and pages |
| Stock/shopping reading global switches; threshold edits unenforced | Fixed. `allowInventoryThresholdEdits` defaults to off, so clients lose threshold editing until it is switched on |
| Stock-run requester email; case reasons and metadata; task-request list | Fixed |
| Invoice pay and payment-link without the finance switch | Fixed |
| Laundry legacy flat access fields | Kept by decision 4 |
| Driver pings attached to an unrelated job | Fixed; client job response reads only assigned people's pings |
| Laundry evidence keys and `supplierId` | Fixed |
| Lost-and-found detail to the reporting cleaner | Guest name, contact and value removed; office workflow notes removed; comments kept |
| Push device token reassignment | Not changed. A token identifies one phone; moving it to whoever signs in on that phone is the correct handover |

**Tests added or changed.** `tests/lib/access-window.test.ts`, `tests/lib/shopping-reimbursement-approval.test.ts`, `tests/lib/upload-ownership.test.ts`, `tests/lib/client-list-projection.test.ts`, `tests/lib/lost-found-reporter-redaction.test.ts`, `tests/api/portal-follow-up-guards.test.ts`; new cases in `tests/api/cleaner-damage-authority.test.ts` and `tests/api/cleaner-submit-form-contract.test.ts`; fixtures updated in the access-audience, briefing, laundry next-stop, laundry viewer-scope and client laundry page tests. The damage test's bare photo keys were replaced with keys in the real upload layout.

**Verification**

- TypeScript: pass.
- Vitest: 7,281 passed without a database; the 19 database-backed files (124 tests) passed against disposable `sneek_review_test` on port 55439, run serially. 7,405 passed in total, 2 skipped (an opt-in iCal schedule smoke test and an IndexedDB-only suite).
- Production build: pass, 765 pages.
- Chromium on the production build, 390px and 1280px, light and dark:
  - Cleaner job with an unaccepted offer: briefing, form and access guide returned no codes and the stated reason; the offer card says access appears on acceptance; one h1; no horizontal overflow.
  - Laundry route stop: the "Property access" panel opened by keyboard and showed lockbox, codes and parking; one h1; no overflow.
  - Admin shopping run in `PENDING_APPROVAL`: status label, explanation and "Approve reimbursement" present at all four sizes; activating it by keyboard set `READY` and removed the button. A clipped button label in that card at 390px was fixed (the row now wraps).
  - Client jobs, laundry and property pages rendered with one h1, no error state and no overflow.
- API on the production build: a cleaner's lost-and-found photo and damage-report media under another account's id returned 403; a cleaner upload to `branding` returned 403; a future-dated ping was dropped; a shopping row naming an unknown property returned 404; client invoice pay with finance hidden returned 403; client stock runs reported `canEditThresholds: false`.

**Not verified**

- A cleaner shopping run submitted as COMPLETED with a receipt: the server checks the receipt exists in storage and this environment has no bucket. Approval was exercised on an in-progress run with a cost; the status rule itself is unit-tested.
- The accepted and expired access-window states in the browser (the fixture job is an unaccepted offer for today). Both are unit-tested.
- The pay-request and invoice-proof ownership refusals in the browser; they use the same helper as the routes that were exercised.
- Client lists with switches turned off in the browser; the projections are unit-tested.
- The mobile app, the production database, the storage bucket's public/private setting, and deployment. Nothing was deployed.

### Follow-up: departing guest contact (2026-11-11)

Request: show the departing guest's contact details where only the upcoming guest's were shown.

- Change: `buildCleanerDepartingGuest`; `departingGuest` and departing contact fields on the cleaner job form response; "Departing guest" row in the cleaner Call sheet and block in the property info drawer; departing guest contact shown openly on the Estate admin job detail.
- Tests: `tests/lib/departing-guest-summary.test.ts`, `tests/components/cleaner-contact-sheet-guests.test.tsx`.
- TypeScript: pass. Vitest: 7,289 passed without a database plus 124 database-backed tests on disposable port 55439; 2 skipped. Production build: pass, 765 pages.
- Chromium on the production build at 390px and 1280px, light and dark, with a fixture booking on the job: the Call sheet (opened by keyboard) listed the departing guest; the drawer showed the block with a working `tel:` link and check-out time; the admin card showed name, phone and email; one h1 and no horizontal overflow on each. The cleaner API response contained neither the guest's email nor the reservation code.
- Not verified: a job with both an arriving and a departing guest in the browser (the fixture has no incoming booking; ordering and labels are covered by the component test); the classic pages, which were not changed; the mobile app; production data. Check-out time is shown in the viewer's device timezone, the same as the existing arrival time.


### Follow-up: Invoices and pay — admin redesign phase 0 and Money sub-phase (a) (2026-11-11)

Request: the first build phase of `docs/plans/admin-redesign-2026-11.md` — shared list building blocks, then list, paging, sort, bulk and the merge of the three Money entries, with no change to invoice rules. The owner asked mid-phase to follow the approved concept (`Money.dc.html`) closely and to defer the production build, full suite and browser checks to one pass at the end of the project.

Changed
- Shared UI: `EDataTable`, `EBulkBar`/`EBulkButton`, `EFilterChips`, `EFilterPopover`, `ERowMenu`, `EPagination`, `EPill` in `components/v2/ui/`; `lib/admin/list-query.ts`.
- API: `GET /api/admin/invoices` gains `?paginated=1`, `?view=context`, `?view=stats` (the original shape is kept when none is given); new `POST /api/admin/invoices/bulk` and `GET /api/admin/invoices/export`. PATCH/send/Xero push logic moved verbatim into `lib/billing/client-invoice-{patch,send,xero}.ts`; the single routes now delegate to them.
- Screen: `/v2/admin/finance` is "Invoices and pay" with five tabs; `/v2/admin/payroll` and `/v2/admin/cleaner-invoices` redirect; one sidebar entry; badges fixed (client invoices to send + cleaner invoices awaiting review). `estate-invoices.tsx` split into `components/v2/admin/finance/invoices/*` (largest file 335 lines).
- Deliberate behaviour changes: Void and Reverse ask for confirmation; Re-send offered for SENT/PART_PAID; "Force status" and the editor's duplicate Push to Xero removed from the screen (API untouched); the default chip is "Needs action"; operations-manager gating of `?tab=payroll|adjustments|time` follows the payroll feature (was finance); the old KPI strip moved into the Pay runs and Overview tabs.
- Departures from the concept, for honesty: no dollar "Ready to bill" figure (a count of finished jobs on no non-void invoice; charges depend on rates), and its button is "Create a draft" (the generator does one client at a time); no "missing rates" badge on Drafts; "Paid this month" is invoices with a PAID stamp this month as recorded here, not payments pulled from Xero; the Xero badge shows "last sync" only when a sync time is stored; the Due column shows the date printed on the PDF for unsent invoices instead of "On send"; Xero states are "In Xero", "Pending or failed" and "Not in Xero" (no "synced" — there is no pull); "Download PDFs" omitted from the bulk bar (no multi-PDF endpoint; it would mean looping downloads in the browser); an "All" chip added after "Void"; a Clear button added to the bulk bar.

Verified
- TypeScript (`npx tsc --noEmit -p .` with a 6 GB heap): pass.
- New tests: `tests/lib/list-query.test.ts`, `tests/lib/finance-merge-routing.test.ts` (redirects, tab ownership, nav fallback), `tests/lib/admin-attention-money.test.ts`, `tests/api/admin-invoices-list.test.ts`, `tests/api/admin-invoices-bulk.test.ts`, `tests/components/estate-data-table.test.tsx`, `tests/components/invoice-row-actions.test.tsx`, `tests/components/invoice-list.test.tsx`.
- Targeted run of the new tests plus every existing file covering touched code (all of `tests/components`, the invoice/started-work/cleaner-invoice/ops/receivables/attention API and lib tests): 187 files, 1,689 tests, all passing. `tests/components/invoice-generation-summary.test.tsx` was updated on purpose: the generator is no longer opened by a "Generate invoice" button on the list, so the test renders the moved dialog directly; its assertions are unchanged.

Not verified in this phase (deferred by the owner to one final pass)
- Production build, the full Vitest suite and the database-backed suites.
- Chromium at 390px and 1280px, light and dark, including keyboard sorting, chips, paging, bulk approve with mixed results, the row menu, the three old URLs and an operations manager's view.
- Xero: no provider credentials. Bulk Xero push is covered by mocked tests only; the Xero connection badge has not been seen against a real connection.
- Email: bulk send was not exercised against a provider.
- Note: a checkpoint commit (`fe562dd`, "WIP: shared list components …") appeared on the branch during this work; it was not made by this change, and the remaining work is uncommitted in the working tree.

### Follow-up: Invoices and pay — Money sub-phase (b), invoice editor page (2026-11-11)

Request: the next step of `docs/plans/admin-redesign-2026-11.md` — the invoice editor becomes a page at `/v2/admin/finance/invoices/[id]`, matching the approved concept `InvoiceEditor.dc.html`, with no change to invoice rules, transitions, numbering, money arithmetic or the schema. The owner asked to defer the production build, the full suite and browser checks to one pass at the end of the project.

Changed
- Page and read model: `app/v2/admin/finance/invoices/[id]/page.tsx` (was the read-only summary; `components/v2/shared/invoice-summary-page.tsx` is kept for the client portal), `GET /api/admin/invoices/[id]?view=editor`, `lib/billing/client-invoice-{editor,editor-types,checks,history,stage,access,guards}.ts`, `getClientInvoiceListRow` in `client-invoice-list.ts`.
- Extracted, behaviour unchanged: `startedWorkRefusal` (what `assertStartedWorkReviewed` throws), `billedJobLinesWhere` (the generator's double-billing rule), `invoiceTotalsMismatch` (from `getClientInvoice`), and the PATCH's Xero/payment lock predicates and messages (`client-invoice-guards.ts`, now imported by `client-invoice-patch.ts`).
- Screen: `components/v2/admin/finance/invoices/editor/*` (largest file 277 lines) and the shared `components/v2/ui/stage-bar.tsx` (`EStageBar`). The editor modal (`invoice-editor.tsx`) and its line row are deleted. List rows' Review / "Review and edit" and the invoice number link to the page with `?back=` so the back link keeps the list's filters; approve and Xero push from the list and the page share `invoice-direct-actions.ts`; the send dialog accepts the page's "To".
- Deliberate behaviour changes: editing is a page with explicit "Save draft" (several line edits in one PATCH) instead of a per-line ✓ save; the old "Group by property" button (which saved a clustered order) is now a view toggle showing the PDF's own grouping, and dragging reorders within a section; financial actions wait while edits are unsaved; an operations manager with finance read access sees a view-only editor instead of controls that 403.
- Departures from the concept: Bill to, Period and Due are read-only (no API to change them; Due is created + payment terms, as printed); no Client reference, Add finished jobs, Add discount or Add note to client (no field or service); Send has a "To" field and states that the PDF is always attached, without the payment-link or push-on-send options; the Xero card shows the configured account code (no account name is stored) and says payments are not read back; the checklist marks rates, other invoices and totals as advice ("Check") because approval does not enforce them; the subtitle shows the last-changed time instead of "saved N seconds ago"; the add-line placeholder does not offer picking a job or saved item; section rows count lines, not jobs.

Verified
- TypeScript (`npx tsc --noEmit -p .` with a 6 GB heap): pass.
- New tests: `tests/lib/client-invoice-checks.test.ts` (checklist versus the real approve PATCH, including unresolved and changed started-work reviews, an unreadable snapshot, a pending Xero reservation, advice checks that do not block, unreadable checks shown as unknown; read-only reasons equal the PATCH refusals), `tests/lib/client-invoice-editor-rules.test.ts` (stage bar for every status including pending Xero and VOID, primary-action reuse, menu contents, back-link sanitising, line drafts, section reordering), `tests/components/invoice-editor-page.test.tsx` (one h1, primary action, refused save keeps the draft and retries the identical request, fields frozen during a save, a lost add-line response is not resent, read-only and void presentation, Review as a link), `tests/api/admin-invoice-editor-route.test.tsx` (page and `?view=editor` role list, ops finance off/read/manage, ADMIN independent of packs, 404), `tests/lib/client-invoice-history.test.ts`.
- Targeted run of those plus every existing test file covering touched code (invoice list and row actions, started-work reconciliation and boundary, shopping protection, invoice list/bulk/PDF/reconciliation routes, generation, summary page, portal search, finance routing, ops guards and policy, data table): 29 files, 324 tests, all passing. No existing test was changed.

Not verified (deferred by the owner to one final pass)
- Production build, the full Vitest suite and the database-backed suites.
- Chromium at 390px and 1280px, light and dark: layout against the concept, the stacked columns and the table's own scroll at 390px, keyboard drag on the handle, the row and line menus, the leave-page prompt, the started-work panel inside the page, and dark-mode contrast of the stage bar and tinted unsaved rows.
- Xero and email providers: no credentials; push, send and payment receipts were not exercised beyond mocked tests.
- The leave-page prompt covers browser unload and the back link only; other in-app links (sidebar) navigate without asking.

### Follow-up: Forms library — one Forms page, draft versions and bulk edits (2026-11-11)

Request: the library half of the Forms step of `docs/plans/admin-redesign-2026-11.md` (items 16–18), matching the approved concept `FormsLibrary.dc.html`: one library at `/v2/admin/forms` with five tabs, draft versus live versions, groups and tags, Checks, real figures and bulk edits with a preview; no change to what cleaners see, how submissions validate or what jobs resolve to. The builder redesign is the next step. The owner asked to defer the production build, the full suite and browser checks to one pass at the end of the project.

Changed
- Schema: migration `20261111150000_form_template_library` — enum `FormTemplateVersionKind`, tables `FormTemplateVersion` and `FormTemplateGroup`, `FormTemplate.groupId` (FK, ON DELETE SET NULL) and `FormTemplate.tags`, indexes, and one PUBLISHED baseline version row per existing template copied verbatim (dated at its `updatedAt`). No existing row changed. Found beforehand: no version table existed; `lib/phase4/template-versions.ts` (API only) versions by sibling FormTemplate rows and switches `isActive`, which changes job resolution, so it was not extended; it is unchanged.
- Services: `lib/forms/template-{drafts,publish,history,groups,checks,questions,bulk-edits,bulk,bulk-lifecycle,bulk-types,errors}.ts`, `library-{list,usage,figures,types,tab-counts}.ts`, `submission-stats.ts`, `form-stats-data.ts`, `duplicate-template-service.ts`; `lib/admin/forms-redirects.ts`; `FORMS_TAB_FEATURES` and the nav fallback in `lib/rbac/ops-catalog.ts`.
- API: new `GET /api/admin/form-templates/library`, `GET …/questions`, `POST …/bulk`, `GET|POST …/groups`, `PATCH|DELETE …/groups/[groupId]`, `GET|PUT|DELETE …/[id]/draft`, `GET …/[id]/versions`, `POST …/[id]/versions/[versionId]/restore`. `…/[id]/publish` and `…/[id]/duplicate` now delegate to shared services (same role lists and rules; publish also applies a draft and accepts an optional edit token; a missing template answers 404 instead of 400).
- Screen: `app/v2/admin/forms/page.tsx` (tabs), `components/v2/admin/forms/library/*` (largest file 243 lines). `/v2/admin/qa-templates`, `/v2/admin/templates`, `/v2/admin/checklists`, `/v2/admin/forms/stats` redirect. One "Forms" sidebar entry replaces four. `QaTemplatesManager` takes `canWrite`. `components/v2/admin/forms/management/estate-forms-list.tsx` is deleted (every function moved into the Job forms tab: list, search, archived view, duplicate, publish, archive, unarchive, delete with PIN, stats link).
- Deliberate behaviour changes: the builder's "Save draft" saves a DRAFT version (`PUT …/draft`, same 409 stale guard, token = the draft's `updatedAt`) instead of overwriting the live schema; publishing makes it live as a new version and the builder shows "Publish changes" for a live form with a saved draft; the edit page opens the draft. Operations managers no longer see QA-template create/edit/reset buttons or an active switch the API refuses (API unchanged). On the merged page QA templates are gated by `quality` and message templates by `communications`, as before the merge. The old forms list's per-row buttons are one Edit plus a row menu.
- Departures from the concept: no Compare toggle (not built) and no List toggle on its own; no Import button (no import function exists); "New form ▾" is a menu of links to the existing creators; an extra "Tags" bulk button (there was no other way to tag forms); row menus beside Edit and rename/delete menus beside groups (the old functions had to stay reachable); Avg time and Completion headers are not sortable (computed for the page's rows only); the version line adds the job type; Completion is the mean share of required, always-shown questions answered (the stats tab's per-field definition, averaged); the "Barcode question never answered" style badge is shown as a separate "Never answered: …" warning line under Checks (≥20 submissions in 90 days since the live version; conservative exclusions) and is not counted by "Has problems"; after a bulk apply the whole selection stays selected so the per-form results stay on screen (the list conventions say keep refused rows selected); no "Ideas" note.

Migration verification (disposable PostgreSQL 16 at 127.0.0.1:55439, user `sneek`)
- Fresh: `createdb -h 127.0.0.1 -p 55439 -U sneek forms_fresh`; `DATABASE_URL=postgresql://sneek@127.0.0.1:55439/forms_fresh npx prisma migrate deploy` → all migrations applied including `20261111150000_form_template_library`; repeated → "No pending migrations to apply."; `npx prisma migrate diff --from-url postgresql://sneek@127.0.0.1:55439/forms_fresh --to-schema-datamodel prisma/schema.prisma --exit-code` → "No difference detected.", exit 0.
- Existing migrated `sneek_ui` (3 templates): md5 over every FormTemplate row (id, version, schema, name, updatedAt, isActive) before = after = `ff6ca923fbaec379fe7b3250593e5279`; `migrate deploy` applied only the new migration; repeated → "No pending migrations to apply."; `migrate diff … --exit-code` → "No difference detected.", exit 0; each template has one PUBLISHED baseline row with the same version and an identical schema.
- `npx prisma generate` run after the schema change.

Verified
- TypeScript (`NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .`): pass on the final run. An earlier run during this work showed 3 errors, all in `components/v2/admin/jobs/jobs-view-tabs.tsx` and `jobs-workspace.tsx` (another engineer's in-progress Jobs work in the same tree, not touched here); they were gone by the final run.
- New tests: `tests/lib/form-library-edits.test.ts` (checks; matching by id and wording; never guessing between two matches; edits do not mutate input; refusal of edits that add an error; add-section ids and placement; find-and-replace never touches ids; option used by a condition), `tests/lib/form-library-figures.test.ts` ("–" with too little data; time and completion definitions; usage check threshold and live-version window; Used by resolution order), `tests/api/form-library-routes.test.ts` (list paging/sort/filter validation and roles; every write route ADMIN only before any service call; bulk cap and schema; 409 stale draft; restore replace flag; publish token), `tests/lib/forms-merge-routing.test.ts` (four redirects keep parameters incl. `templateId`/`weeks`; old tab values; ops feature per tab, API not steerable; nav fallback), `tests/components/qa-templates-gating.test.tsx`, `tests/components/form-builder-drafts.test.tsx` (save goes to the draft with the token, never PATCH; publish waits for a save and sends the token), `tests/components/forms-bulk-panels.test.tsx` (picker limited to the selection; save only after a matching preview; per-form reasons), and `tests/db/form-template-library.test.ts` on the disposable `forms_fresh` database (`SNEEK_TEST_DATABASE_URL=postgresql://sneek@127.0.0.1:55439/forms_fresh`): a saved draft leaves the live row and `resolveEffectiveJobForm` unchanged; stale save refused and one draft per form; publish raises the version, records it and the resolver then returns the new schema; restore keeps history and refuses to replace a draft unasked; bulk dry run changes nothing; bulk apply saves drafts only for matching forms with per-form outcomes and leaves live forms alone; bulk publish refuses two defaults of one job type; groups and ungroup on delete; list paging, sort, question search, problems filter and "–" figures.
- Updated on purpose: `tests/components/forms-authority-surface.test.tsx` (the old `EstateFormsList` cases now exercise the Job forms library and the merged page: read-only for operations managers, one h1, write controls from held roles) and `tests/api/audit-form-template-pages.test.tsx` (its database stub gains `formTemplateVersion`, plus a case that the editor opens the draft with the draft's token). No assertion about admission was weakened.
- Targeted run of the new tests plus existing files covering touched code (form-template auth and pages, form-templates contract, resolve-effective-job-form, list-query, lint-template, template-concurrency, ops middleware and policy, finance routing, legacy form builder, impact notes, live-location auth, ops permissions, schema and migration-retention on `forms_fresh`): 25 files, 207 tests, all passing.

Not verified (deferred by the owner to one final pass)
- Production build and the full Vitest suite; database suites other than those listed.
- Chromium at 390px and 1280px, light and dark: layout against the concept, groups panel stacking, the table's own scroll, the bulk bar wrapping, keyboard use of filters, row and group menus, panel draft retention when switching bulk actions, the stats tab's GET form staying on its tab, the four redirects, an operations manager's tabs.
- The usage check and the figures were exercised with fixtures only, not against production-sized submission data; the list reads every template's schema per request (fine for tens to low hundreds of forms).

### Follow-up: Quality hub — QA issues, accountability and QA performance on one page (2026-11-11)

Request: the Quality step of `docs/plans/admin-redesign-2026-11.md` (items 12, 13), matching the approved concept `Quality.dc.html`: one hub at `/v2/admin/quality` with one period control and one shared filter set, five stat cards, and Review queue, Issues, Cleaners, Inspectors, Categories and Coaching tabs; one service with one period helper and the groupings over one filtered query; no change to QA scoring, deduction, bonus, false-confirmation penalty or coaching rules and no schema change. The owner asked to defer the production build, the full suite and browser checks to one pass at the end of the project.

Changed
- Service: `lib/quality/{types,period,filters,where,authority,groupings,cleans,facts,summary,cleaners,cleaner-signals,streaks,inspectors,categories,issue-rows,issue-list,inspections,rectify,bulk-fix,redirects,legacy,http}.ts`; `lib/laundry/team-metrics.ts`. Extracted, behaviour unchanged: the rectify transaction from `PATCH /api/admin/qa/issues/[id]` (`lib/quality/rectify.ts`, which the route now calls), the accountability streak arithmetic (`summariseAccountabilityStreak` in `lib/workforce/performance.ts`, used by `getPerformanceMetrics`), the quick-score candidate filter (`quickScoreCandidateWhere` in `lib/qa/auto-score.ts`, same base filter, optional narrowing).
- API: new `GET /api/admin/quality/{summary,issues,issues/export,options,cleaners,inspectors,categories,inspections}`, `POST /api/admin/quality/issues/bulk`, `GET /api/admin/laundry/team-metrics`. `GET /api/admin/qa/issues` keeps its shape (rows via the shared mapper); `/api/admin/accountability/qa-performance` is a thin caller of the inspector grouping (shape and order kept); `/api/admin/accountability/overview` keeps its shape, uses the shared period helper, the batched streaks and the laundry helper. `/api/admin/qa/awaiting` accepts optional `propertyId`/`q`. Callers checked by grep: classic `components/admin/{qa-issues-workspace,accountability-dashboard,qa-performance-dashboard}.tsx`, the Approvals centre and classic approvals page (PATCH issue), no `mobile-app/` callers.
- Screen: `app/v2/admin/quality/page.tsx`, `components/v2/admin/quality/hub/*` and `issues/*` (largest file 221 lines), `quick-score-queue.tsx` (select all / clear / sort, cancellable read, hub filters), `components/v2/admin/laundry/laundry-team-metrics.tsx` on `/v2/admin/laundry/stats`. The three old pages redirect with their parameters; the v2 accountability, QA performance and QA issues components are deleted (classic ones untouched). Sidebar: the QA Issues, Accountability and QA Performance entries are gone; Quality is badged with the new `qualityHub` count (`lib/admin/attention-counts.ts`).
- Deliberate behaviour changes: period boundaries are Sydney calendar days (the routes used rolling `now − N×24h`); cleaner "Cleans" and "Score" use submitted cleans scheduled in the period (the overview counted reviews created in the window); the Quality badge adds issues awaiting rectification; quick score refreshes the hub's figures instead of `router.refresh()`; the false-confirmation Confirm label shows the configured deduction (was hard-coded −10); QA inspectors reach the Issues tab only (the old register's read-only access) and an operations manager with a read-only quality pack sees no actions.
- Departures from the concept: severity pills read minor / major / critical (the system's severities) instead of low / med / high; the row action for a waiting bonus reads "Review bonus" (bonuses are proposed by the nightly job under the existing rules, so the decision the hub can offer is approve / decline through the existing endpoint; there is no manual "propose" flow to call); "Start coaching" appears when the existing recurring-issue pattern flags a category and no coaching is open; the search placeholder is "Search cleaner, property or job" because the one search applies to every tab; the by-category bars colour only the top category red; Export downloads the issues CSV for the period and filters; the cleaner name cell has an expand chevron and a "Not an active cleaner" note where relevant; a caption under each table states its basis; a footer links to the laundry metrics; no "Ideas" note or sidebar regroup.
- N+1: streak/last-5/last-10 cost one query per visible cleaner (was `getPerformanceMetrics`, about a dozen queries, per cleaner); "latest 10 completed jobs per cleaner" is not expressible as one Prisma query without raw SQL, so it was not merged further.

Verified
- TypeScript (`NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .`): pass on the final run. Earlier runs during this work showed errors only in `components/v2/admin/forms/library/forms-bulk.tsx` and `components/v2/admin/jobs/jobs-view-tabs.tsx` (other engineers' in-progress work in the same tree); they were gone by the final run.
- ESLint over every new and changed Quality file: clean.
- New tests (9 files, 49 tests): `tests/lib/quality-period.test.ts` (Sydney-day fixed periods, custom and end-only ranges, previous-period rules, DST boundary, refusals, classic leniency), `tests/lib/quality-groupings.test.ts` (cleaner / inspector / category groupings agree with the totals; open-fix, flag and QA-fix definitions; null fix cost and minutes without records; clean totals; 8-week trend gaps never 0; authoritative review priority; coaching suggestion and one-action rule), `tests/lib/quality-hub-service.test.ts` (summary, cleaners, inspectors and categories report the same issue total for one fixture; inactive cleaner with issues still a row; no score for no data; no delta without previous reviews; one streak query per cleaner), `tests/api/quality-hub-issues.test.ts` (server paging and sort, real total, count and rows share the where, sort allow-list and filter values refused, inspector read allowed, 401/403, bulk ADMIN/OPS only, per-row outcomes through the shared rectify, malformed bodies, CSV and refusal above the cap, options from the database), `tests/api/quality-rectify-shared.test.ts` (PATCH rectify still pays the QA as a PENDING adjustment, never the admin; manager fix creates no money; inspector-only rectify kept), `tests/components/quality-hub-routing.test.tsx` (three redirects keep params, from/to become the same custom period, nav has one Quality entry with the real badge and keeps Reports), `tests/components/quality-hub-actions.test.tsx` (expanded row reads the cleaner's open issues with the hub filters, Mark fixed / Propose deduction open the detail, Confirm calls the existing PATCH, read-only viewers see no actions; Start coaching posts to the coaching route with the pattern; failed coaching save keeps the draft; Review bonus PATCHes the pay adjustment; stat cards show "–" / "Not enough data" and no delta without previous data; loading versus failure), `tests/components/quality-hub-state.test.ts`, `tests/components/quality-hub-page-access.test.tsx` (roles, inspector view, ops read-only pack, no invented deduction).
- Existing test files covering touched code, run with the new ones: attention counts (component and money), laundry page scope, laundry stats, performance, rectification and rectification payee, worker registration, streaks, list-query, client layout gates, client navigation refresh, client attention scope, maintenance item scope — 23 files, 199 tests, all passing. No existing test was changed.

Not verified (deferred by the owner to one final pass)
- Production build, the full Vitest suite and the database-backed suites (no database test was added; the hub's queries were exercised against mocked Prisma only).
- Chromium at 390px and 1280px, light and dark: layout against the concept (stat cards wrapping, tab row scrolling, filter row wrapping, the Cleaners table's own scroll and expanded row at 390px, sparkline colours in dark mode), keyboard use of the period panel, filter popovers, sort headers, expand buttons and dialogs, the custom-period draft, the bulk bar's status select on the dark bar, and the redirects in a browser.
- No production data: figures were checked with fixtures only.

### Follow-up: Jobs list — view tabs, visible filters, peek panel and server board (2026-11-11)

Request: the Jobs step of `docs/plans/admin-redesign-2026-11.md` (item 2), matching the approved concept `Jobs.dc.html`, plus merging the job detail's duplicated Quality block.

Changed
- Service: `lib/jobs/{list-filters,list-include,list-sort,date-scope,view-presets,view-counts,list-row-extras,board-lanes,job-reminder,cleaner-suggestions,cleaner-suggestions-load,peek-summary,peek-types}.ts`. Moved unchanged in meaning: the `/api/jobs` where builder, include and default orderings; the single-job remind logic (now `sendJobReminder`, used by the single and bulk routes).
- API: paginated `GET /api/jobs` gained the `parseListQuery` sort allow-list (unknown sort/dir → 400), comma-separated `status` (unknown → 400), `ids` (≤ 500), `counts=1` (one grouped count query) and `extras=1` (`guestIn`, `charge` via `computeClientCharge`). New `GET /api/admin/jobs/board`, `GET /api/admin/jobs/[id]/peek`, `GET /api/admin/jobs/[id]/cleaner-suggestions`, `POST /api/admin/jobs/bulk-remind`, all ADMIN / OPS_MANAGER through live `requireRole` (and so the Jobs ops pack). Non-paginated `/api/jobs`, the cleaner scope and `redactJobForCleaner` unchanged.
- Screen: `components/v2/admin/jobs/*` split into workspace (260 lines), header, view tabs, filter bar, status filter, view options, table, row menu, board, bulk bar, bulk-remind and status dialogs, quick assign, peek panel and sections, and their hooks (largest new file 211 lines). `components/v2/ui/side-panel.tsx` (`ESidePanel`, reusable). `EDataTable` gained optional group rows, row click, active row and cell padding (existing callers unchanged). `SavedViewsControls` split into a self-loading wrapper and `SavedViewsPanel` (list and selection owned by the page). `view-options-menu.tsx` and `EJobRow` removed. `app/v2/admin/jobs/[id]/page.tsx`: the second Quality block merged into the first (no content lost).
- Deliberate behaviour changes: row Manage/Open buttons → menu items, row click previews; sort select → column headers (`sort` values gain `property_desc`, `client`, `client_desc`, `type`, `type_desc`, `status_desc`); filters always visible (no disclosure, its stored preference is ignored); status filter accepts any set of statuses; date shortcut "Next 7 days" (`dateScope=week`) added; board lanes and totals from the server; bulk reminders in one request with per-job outcomes; selection cleared on filter change.
- Departures from the concept: the Unassigned pill keeps the app's status tone (warning) rather than the concept's red; group rows read "Today · Thu 12 Nov" (the shared Sydney-day label) instead of "Thursday 12 November"; a status vector icon sits beside the status pill (kept for the existing job-vector behaviour); a disabled suggestion reads "Clash" for a time clash and "Unavailable" for a day or hours outside the saved roster; suggestions omit travel distance and QA score (no distance service over stored coordinates; no batch QA-score function); Cleaner, Guest in and Charge headers are not sortable (not database columns); "Import or bulk create" opens the same create page as "New job" (bulk create lives there); "Cancel job" opens the Schedule tab's "Skip this clean" (no cancelled status exists); Reschedule is absent from the bulk bar (no bulk-safe reschedule service); saved-view tabs show no count; a Property chip appears only while a property filter is active (its picker sits in the Client chip).

Verified
- TypeScript (`NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .`): pass. An earlier run showed errors only in `components/v2/admin/forms/library/*` (another engineer's in-progress work); the final run was clean.
- New tests: `tests/lib/jobs-view-presets.test.ts` (presets, current-tab rule, grouped count SQL, Sydney-day bounds, no invented totals), `tests/lib/jobs-list-route-v2.test.ts` (sort allow-list refusal, every order, all-status and unknown-status filter, ids, counts, extras with "No rate", legacy array shape, cleaner redaction unchanged, board lane counts from one groupBy), `tests/api/jobs-bulk-remind.test.ts` (per-row outcomes incl. partial email, truthful wording, input and role refusal, single route responses), `tests/lib/cleaner-suggestions.test.ts` (ranking, clash, leave/outside hours, unknown times, limits), `tests/components/side-panel.test.tsx` (focus in, Escape and close return focus, sheet Tab containment), `tests/components/job-peek-panel.test.tsx` (tabs on demand, suggestions with a disabled Clash, stale loads aborted on job change, failure and retry).
- Updated on purpose: `tests/components/jobs-workspace-url.test.tsx` (rewritten for tabs, chips, header sorting, peek and selection export; refresh/stale/503/malformed/debounce/restore cases kept), `tests/components/jobs-columns.test.tsx`, `tests/components/jobs-density.test.tsx`, `tests/components/admin-job-row.test.tsx` (now test the table row: one primary action, row click vs nested controls, menu destinations); e2e selectors in `e2e/job-vectors.spec.ts`, `e2e/navigation-permissions.spec.ts`, `e2e/jobs/scroll-local.spec.ts` updated for the new controls but not run.
- Run together (37 files, 489 tests, all passing): every `tests/components/jobs-*`, `tests/lib/jobs-*`, `tests/api/jobs-*` file, admin job row, estate data table, invoice list, audit notification producers, audit report authorization, job detail tabs, cleaner job redaction, ops middleware and request guard, account middleware, job manage save safety; plus ops policy, view memory, maintenance scope and job money.

Not verified (deferred by the owner to one final pass)
- Production build, the full Vitest suite, Playwright (including the three updated e2e specs) and database suites; the grouped count SQL and the board `groupBy` ran against mocked Prisma only, not PostgreSQL.
- Chromium at 390px and 1280px, light and dark: the table's own horizontal scroll, tab and chip wrapping, the side panel as a column at 1280px and a full-height sheet at 390px, the bulk bar's sticky position above the mobile tab bar, drag and drop on the board, keyboard use of chips, menus and the panel, scroll restoration with the panel open.

### Follow-up: Invoices and pay — Money sub-phase (c), credit notes and server-side invoice locks (2026-11-11)

What changed (details in `docs/SYSTEM.md`, "Credit notes, blank invoices, discounts and server-side invoice locks")
- Server-side content lock shared with the editor (`invoiceContentLock`): content edits refused on SENT, PART_PAID, PAID and VOID with a message pointing to credit notes.
- Server-side PIN/password (`verifySensitiveAction`, 423 on refusal, 403 while impersonating) for removing a line and deleting an invoice. Reconcile / void already verified it server-side (unchanged). Standard Void has no PIN prompt.
- Client reference / PO (new column), note to client (new column, not `metadata.notes`), DISCOUNT lines (amount or percentage, basis stored, never below zero), blank invoices, credit notes (own `CN-` rail, partial and limit-checked, Xero `ACCRECCREDIT`, owing reduced, "Fully credited" display state), Reverse only for APPROVED.
- PDF due day from the list's function (organisation timezone); invoice email button opens the client portal invoice page.
- Pre-existing problems fixed in this step: 400 instead of 401/403 on GET/DELETE `/api/admin/invoices/[id]` and POST `…/send`; unreadable started-work snapshot broke the GET route and editor (now read only, approval refused); single send and Xero push wrote no audit row; bulk rows never appeared in an invoice's history (now one row per affected invoice plus the existing request row); the CSV export escaped negative amounts as formulas; the old screen's Refresh button had been dropped from the list.

Migration verification (disposable PostgreSQL 127.0.0.1:55439, user `sneek`)
- Fresh: `createdb money_fresh`; `npx prisma migrate deploy` applied all 131 migrations; repeat: "No pending migrations to apply"; `npx prisma migrate diff --from-url …/money_fresh --to-schema-datamodel prisma/schema.prisma --exit-code`: "No difference detected" (exit 0).
- Existing `sneek_ui` (130 applied, the new one pending): inserted five fixture invoices (DRAFT, SENT, PART_PAID with a payment ledger, PAID, VOID) and five lines; md5 of every pre-existing column of every ClientInvoice and ClientInvoiceLine before and after deploy: identical (`41a4093d…` / `d29ac94d…`). New columns: all INVOICE, all nulls. Repeat deploy: nothing pending; diff: no difference (exit 0). CHECK constraint refused a credit note without `creditsInvoiceId`. Fixtures deleted afterwards. `npx prisma generate` run.

Verified
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .`: clean.
- 58 test files (every existing invoice/billing/receivables/Xero/finance/portal file touched plus five new `invoice-step-c-*` files): 711 tests passed. Existing tests updated on purpose: Reverse on SENT/PART_PAID/PAID (transitions, row actions, editor menu), sends with no lines now refused (started-work boundary fixture given a line), mocks extended for the new PIN check, credit read, per-invoice bulk rows, `kind` in client scope and summary queries.

Not verified
- Xero credit-note push: mocked only (no provider credentials); the real `PUT /CreditNotes` payload, and allocation in Xero, are unexercised.
- Production build, full Vitest suite, browser checks at 390/1280 light/dark (deferred by the owner to the final pass): editor reference field, discount and note dialogs, credit-note links, "New invoice ▾" blank and credit-note dialogs, Fully credited pills.

## Follow-up: Insights (admin redesign step 14, 2026-11-11)

What changed
- `/v2/admin/reports` is now Insights (sidebar label renamed; route and page guard unchanged). Tabs Business, Properties, Clients, Cleaners, Time and cost, and the existing Client report PDFs manager. Services in `lib/insights/*`, API `GET /api/admin/insights/*`, components `components/v2/admin/insights/*`. Definitions and exclusion rules: `docs/SYSTEM.md`, "Insights".
- Revenue is the scheduled charge (`computeClientCharge`), cleaner cost the recorded pay (`computeJobPaySummary`); margin only over cleans with both; QA and issue figures reuse the Quality hub's clean set, authoritative-review rule and issue period. Missing inputs are excluded and counted; figures below the minimum basis are withheld; no change is shown without comparable data.
- Operations managers: Insights follows the `reports` feature (`insights` added to the ops catalog); financial fields need `finance` and are omitted server-side.
- PDFs tab: laundry visibility toggle, bulk visibility / regenerate / delete (`POST /api/admin/reports/bulk`, per-row outcomes), single delete confirmation moved to the shared `EConfirmModal`, write controls disabled for a read-only reports pack, filters in the URL; old manager links (and the Cases screen's `?reportId=` link) open the PDFs tab. Single report routes now call `lib/reports/admin-report-actions.ts` (same behaviour).
- "Email monthly" was not built (no schedule, stored recipient or settings destination exists to send it through the notification pipeline).

Verified
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .`: no errors.
- 21 test files, 170 tests passed: new `insights-period`, `insights-measures`, `insights-findings`, `insights-csv-and-url`, `insights-routes`, `report-bulk`, `reports-manager`, `insights-page-access`; existing report-route, ops-catalog/policy, quality and merge-routing files. `quality-hub-routing` updated on purpose for the "Insights" nav label.

Not verified
- Production build, full Vitest suite and browser checks (Chromium 390/1280, light/dark, keyboard) deferred by the owner to the final pass. No database-backed test ran: the loaders (`lib/insights/load-facts.ts`, `receivables.ts`) are exercised only through mocks, so query shapes against a real schema are covered by TypeScript only.
- Figures against production-like data (e.g. how many cleans lack a start time, time log or pay rate) were not inspected.

## 2026-11-11 — Existing problems fixed (backlog under the owner's standing rule)

What changed
- Jobs Invoice filter, "Not invoiced" tab and its count: a line on a VOID invoice no longer counts as invoiced (`lib/jobs/invoiced-rule.ts`, mirroring `billedJobLinesWhere`, pinned by a test). Job detail notes when every invoice line is on a voided invoice. INVOICED status still counts; deletion / reset guards unchanged.
- Job reminder (single and bulk): audit stores `requested`, `deliveryState` (QUEUED / PROVIDER_ACCEPTED) and `deliveryConfirmed: false`; single route keeps 404 / 409 / 400 and `sent` / `failed`, adds `deliveryState` and `message`; toast says queued / accepted; browser-push error after the inbox notice no longer counts as not reminded; email HTML escaped. Not moved to the intent pipeline (cleaner recipients need a new authorization adapter, no phone-app transport, external transports are env opt-in) — owner decision.
- `EField` (admin kit, settings kit, worker kit) ties its label and hint to a single control child (`components/v2/admin/field-association.tsx`); other children render unchanged. Quality screens use `EField` again.
- `GET /api/admin/qa/issues`: `from` / `to` are inclusive Sydney calendar days (`sydneyCreatedAtFilter`), DST-safe; 500s no longer echo internal messages.
- Quality hub: Coaching tab hidden when its endpoints would refuse the manager (quality or accounts pack), create / update only with quality manage, full-page link only with workforce, "Review bonus" only with payroll manage; coaching workspace shows explicit no-access / failure / cleaner-list states and cancels stale reads; refused evidence photos show "Photo unavailable".
- Old template-versions API: create and rollback answer 410 pointing to the Forms library versions / restore; read route kept; write functions removed.
- Removed leftover "Estate preview" / "Estate workspace" footers and the superseded `forms/builder/new-template.tsx`.

Verified
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .`: no errors.
- New and affected tests: `jobs-invoiced-rule`, `jobs-view-presets` (updated, it encoded the void rule), `jobs-bulk-remind`, `audit-v03-notification-producers` (response shape updated), `estate-field-label`, `qa-issues-sydney-range`, `quality-hub-coaching-access`, `legacy-template-versions-gone`, plus every existing test file importing the touched modules (50 files, 616 tests) and `tests/components` (167 files) — all passed.

Not verified
- Production build, full Vitest suite and browser checks (Chromium 390/1280, light/dark, keyboard) deferred by the owner to the final pass. No database-backed test ran for the VOID rule's SQL; it is checked as generated SQL / Prisma `where` only.

## Follow-up: Calendar (admin redesign step 3, 2026-11-11)

What changed
- `/v2/admin/calendar` rebuilt to the approved design: "Calendar" heading with a real summary line, Previous / Today / Next, Day | Week | Month | Agenda (Week default ≥1024px, Day below), chip row (Rows: cleaners / properties, Client, Status, Show laundry runs, Show guest arrivals, drag hint). URL state for view, date, rows, filters and toggles; rows and toggles also saved per view scope (a full refresh resets view parameters app-wide).
- Week = resource grid (Unassigned lane, every active cleaner plus anyone with work in range, "N h this week" on the stated hours basis, "Not rostered" from saved availability — no leave data exists, laundry-runs row linking to Laundry for that day). Day = rows across hours with a "No time" column. Month kept, "+N more" opens that day. Agenda = a fortnight from the cursor day, stated in the header. Phones: Week/Day as a day-by-day list grouped by row.
- `GET /api/admin/calendar` returns only the asked days (≤ 45; 400 otherwise), slim shape, drafts excluded, UTC-midnight calendar dates unshifted. The page no longer calls `/api/jobs` (unchanged itself).
- Moves (drag with mouse/pen, or "Move or reassign…" from every chip menu): read-only `POST /api/admin/calendar/check-move` → confirmation with clashes / roster / booking / notices → the Schedule tab's reschedule endpoint and/or the assign endpoint as the server planned. Started, finished, skipped and draft jobs are not offered for moving and say why. No optimistic success; mid-save chips are frozen and not redrawn by the 60 s / focus refresh; failures stay on screen.
- Small shared changes: `dayAvailabilityBlocker` exported from `lib/jobs/cleaner-suggestions.ts`; `rescheduleWindowError` extracted from `applyReschedule` (same check, same message); the reassignment client-note dialog extracted from `AssignCleanersModal` into `reassign-note-dialog.tsx` (same behaviour) and reused after a drag reassignment; Laundry reads `?date=`.
- Removed: `components/v2/admin/calendar/estate-schedule.tsx`, the now-unused `lib/calendar/agenda-window.ts` and its test (the agenda no longer starts "today within the cursor month").
- Existing problems fixed in this area: the unbounded job load; a failed fetch rendering an empty calendar; "+N more" switching to Agenda; the agenda description promising a fortnight while listing the month; drafts shown on the calendar; the calendar not refreshing after a QA inspector was assigned from it (the panel only refreshes the server route).

Verified
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .`: no errors.
- New tests: `tests/lib/calendar-rules.test.ts` (ranges, span cap, DST change date, hours basis, late, guest arrival, chip categories, move rule, rows by cleaner/property, drops, refresh merge, day axis, URL round-trip, ops permission), `tests/api/admin-calendar-range.test.ts` (roles, bounds, span cap, unshifted days across the DST change, slim shape, drafts, rows and hours, filters, laundry, move block and arrival), `tests/api/calendar-check-move.test.ts` (clash, roster, booking note, non-movable statuses, agreement with the real assign route and `applyReschedule`), `tests/components/calendar-workspace.test.tsx` (visible range only, error not empty, grid, peek, keyboard move, drop calls only check → reschedule → assign, refused and failed moves leave the chip, mid-save refresh, "+N more", URL and saved toggles), `tests/components/laundry-calendar-day-link.test.tsx`, `tests/components/assign-reassign-note.test.tsx`. With the existing files covering touched code (job peek panel, cleaner suggestions, reschedule contract and safety, assignment draft, ops policy and middleware, laundry dashboard and investigation, admin task sync): 18 files, all passed.

Not verified
- Production build, full Vitest suite and browser checks (Chromium 390/1280, light/dark, keyboard, real pointer drag) deferred by the owner to the final pass. Drag was tested with synthetic pointer events in jsdom only. No database-backed test: queries are covered through mocks and TypeScript.

## Follow-up: Accounts (admin redesign step 11, 2026-11-11)

Scope: `/v2/admin/accounts` rebuilt as drawn (one table, role tabs with counts including Needs attention, filters, export, bulk bar, person panel with sections edited in place) and the full account page reusing the same sections; `PATCH /api/admin/users/[id]/pay`; `POST /api/admin/users/bulk`; `GET /api/admin/users/export`; `GET /api/admin/users?paginated=1` and `GET /api/admin/users/[id]`. Details in `docs/SYSTEM.md` → "Accounts: one table for every login…". No schema change.

Rules kept
- Role/permission, impersonation, 2FA/PIN and pay arithmetic unchanged. ADMIN-only writes stay ADMIN-only (pay rate is new and ADMIN-only); OPS_MANAGER keeps the office note and resend invite and sees no control that would answer 403. Bank/ABN and rate visibility unchanged (ADMIN, OPS_MANAGER). The paginated list, export and person read never select password hashes, 2FA secrets, invitation tokens or the admin PIN.
- Rate change writes only `User.hourlyRate` plus an audit row; payroll payouts, cleaner invoice submissions, assignment snapshots and settled pay are untouched (tested). No "Applies from" date (needs an effective-dated rate table, i.e. a migration).

Existing problems fixed (with tests)
- No guard against disabling or demoting the last active admin (race between two admins): added, in-transaction under an advisory lock, for the account PATCH and bulk disable.
- VA screens' account menu (`account-actions-menu.tsx`) sent Reset password, Reset 2FA and Delete without the PIN/password the routes verify, so they always failed (423); Reset password also asked for a password the route ignores. Fixed.
- Client logins had no profile (the detail page 404'd for CLIENT): they now have the panel and the page.
- Edited ABN and extended-profile bank details were never displayed on the account page (it showed only the User-row fields); both are shown now, labelled by source.
- Account activity timestamps were formatted in the browser's timezone; now Australia/Sydney.

Verification
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .`: no errors at the time of the last run.
- New tests: `tests/lib/accounts-list-rules.test.ts` (tabs, old `?tab=` mapping, Needs attention rules, counts, missing figures, column omission, filters, sort allow-list and nulls-last, paging, CSV escaping and omitted columns), `tests/api/admin-users-list.test.ts` (old array shape unchanged, paginated shape, 400 on unknown/hidden sort, office roles only, export), `tests/api/admin-user-pay.test.ts` (ADMIN only, bounds, audit, frozen records untouched, snapshot and job-type rate win in `computeCleanerPay`), `tests/api/admin-users-bulk.test.ts` (per-person outcomes, self and last-admin refused, OPS limits, cap), `tests/api/admin-user-guards.test.ts` (last-admin on PATCH; reset password, reset 2FA and delete still 423 without PIN/password), `tests/components/accounts-person-panel.test.tsx` (failed save keeps draft, freeze during save, late response not applied to another person, OPS controls, admin actions, PIN sent, client login panel), `tests/components/accounts-hub.test.tsx` (old tab link, counts and summary, one h1, dash for missing, OPS sees no Invite / admin bulk actions, export href), `tests/components/account-actions-menu.test.tsx` (VA menu sends the PIN). Existing related files (notes, accounts stats, VA team manager, test-as unlock, impersonation, ops policy/middleware/guards, sensitive-action grants and the files grep found for users/roles/VA/impersonation): all passed; two database suites were skipped (no disposable database in this run).

Not verified
- Production build, full Vitest suite and browser checks (Chromium 390/1280, light/dark, keyboard) deferred by the owner to the final pass. No database-backed test of the list queries; they are covered through mocks and TypeScript.

## Command and Live ops redesign (2026-11-11)

Scope: `/v2/admin` (Command) and `/v2/admin/ops` (Live ops) rebuilt to the approved designs; `/v2/admin/ops/map` redirects. Details in `docs/SYSTEM.md`, "Command and Live ops: work queue, filtered counters, one live feed (2026-11)".

Rules kept
- Inline actions call existing endpoints with their existing bodies only: continuation approve/decline, shopping reimbursement approve (`READY`), assignment through the Jobs peek panel. No assignment, continuation, pay, clock or notification rule changed; no schema change.
- Access: live `requireRole` on the page and on `GET /api/admin/command/[section]` (mapped to the dashboard pack) and `GET /api/admin/ops/live-board` (same pack as the Live ops page). Queue rows, tiles and actions are filtered server-side by the viewer's ops packs; money needs finance (pay also payroll); a read-only impersonation gets no actions.
- Unknown is never zero: failed tiles show "—", failed queue sources are named, failed money figures are listed, a failed section shows its own Retry; a refused action keeps its row with the server's reason.

Behaviour changed on purpose
- The old Command failed as a whole on any query error; sections now fail alone. `tests/components/admin-command-reliability.test.tsx` was rewritten for this (its legacy guarantees kept: no false empty state, no private error text, every approval category surfaced with its link, no "all clear" while work is pending).
- "Money this month" and the revenue-today figure are shown only to finance/payroll viewers (previously anyone who could open Command saw revenue today and outstanding invoices). Owner to confirm.
- "Invoiced" in the design is shown as "Paid this month" (no existing invoiced-this-month figure; adding one is a money rule).
- Live ops planning lists (dispatch blockers, QA and stale cases, new leads, laundry exceptions, expiring documents, immediate attention) are now rows in Command's work queue; Live ops keeps a counted "Also needs attention" link row.

Existing problems fixed (with tests)
- Live ops "today" used the server's local clock; counters were lengths of lists capped at 8; two components polled the same location feed; stale-case links used a `?jobId=` filter the Cases page ignored (now `?open=<caseId>` of the new Cases inbox); leads and documents linked to list pages instead of the record.
- `getAdminAttentionSummary` (new cases since yesterday) and the cleaner and client attention cut-offs used server-local day boundaries; now Sydney keys (`tests/lib/immediate-attention-days.test.ts`).

Verification
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .`: no errors at the last run.
- New tests: `tests/lib/work-queue-rules.test.ts`, `tests/lib/work-queue.test.ts`, `tests/lib/command-sections.test.ts`, `tests/lib/live-board-rules.test.ts`, `tests/lib/live-board.test.ts`, `tests/lib/live-feed-and-redirect.test.ts`, `tests/lib/immediate-attention-days.test.ts`, `tests/api/command-section-route.test.ts`, `tests/components/live-ops-feed.test.tsx`, rewritten `tests/components/admin-command-reliability.test.tsx`. Existing related suites (attention counts, dashboard metrics, live status/positions, live-location auth, client/cleaner attention, client job progress, ops policy, portal search, route plan) pass.

Not verified
- Production build, full Vitest suite and browser checks (Chromium 390/1280, light/dark, keyboard, map rendering with a real Maps key, the SSE stream against a live server) deferred to the final pass. No database-backed test of the new queries.

## Follow-up: Money (d) Xero status and payment pull, (e) cleaner invoices on the shared design (2026-11-11)

Scope: details in `docs/SYSTEM.md` → "Xero status and payment pull; cleaner invoices on the shared design". No schema change and no migration (state in `ClientInvoice.metadata.xeroSync`, Xero payments in `metadata.payments[]`, last run in `AppSetting` `xeroInvoiceSync`, `APPROVED` as a string status).

What changed
- Xero reads for ACCREC invoices (batched by IDs, ≤ 50) and ACCRECCREDIT credit notes; typed failures for every read problem; a 429 retried once after Retry-After ≤ 60 s.
- Hourly `xero-invoice-sync` worker job (:20 Sydney) and `POST /api/admin/invoices/xero-sync`; new Xero payments recorded through `patchClientInvoice` (method XERO, Xero payment id once, existing PAID settlement); discrepancies (void/deleted in Xero, totals differ, over/prepayments, credits not known here, vanished payment, would exceed total, Xero PAID but not settled) left for review; failed reads stored as "Xero state unknown: …". No client receipt email for a payment read from Xero.
- Screens: real Xero states in the list column, Xero filter, CSV, editor card (with Refresh from Xero), stage-bar notes, header badge (stored last successful run only).
- Pre-existing fixes: Stripe webhook records the amount charged and settles by payments + credits, idempotent per checkout session, never assumes the full amount; `POST /api/client/invoices/[id]/pay` stores the amount charged on its attempt row. What clients are charged is unchanged. The header badge's "last sync" was a token-refresh time; the cleaner portal showed a reversed invoice as "Submitted"; rejecting a payment claim on an invoice already in Xero was refused (now returns it to In Xero); the PATCH accepted a send-back or void of a PAID_CLAIMED invoice (releasing work the payee says was paid), which the screen never offered — now refused.
- Cleaner invoices: APPROVED step (ADMIN only, 403 for operations managers), one transition table used by every route, the bulk route and the screen, audit row per transition; push and payment need APPROVED (legacy XERO_PUSHED rows can still be paid); paged list with chips, search, payee and period filters, real stats, bulk approve / push / CSV with per-row outcomes; review page with stage bar, snapshot lines, notes, proof, comparison and history; admin PDF from the submission snapshot. A payee may claim payment on APPROVED. The old 834- and 677-line components are split (largest new file 315 lines).

Verified (this run)
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .`: no errors in these paths (errors seen only in other engineers' in-flight files: `lib/dashboard/work-queue-sources.ts`, and transient TS6053 for deleted accounts components).
- New tests: `tests/lib/xero-invoice-sync-rules.test.ts`, `tests/lib/xero-read-transport.test.ts`, `tests/lib/xero-invoice-sync-service.test.ts`, `tests/api/invoice-xero-payment-path.test.ts`, `tests/api/invoice-xero-sync-route.test.ts`, `tests/lib/stripe-checkout-payment.test.ts`, `tests/lib/client-invoice-xero-display.test.ts`, `tests/lib/cleaner-invoice-transitions.test.ts`, `tests/api/cleaner-invoice-list-bulk-pdf.test.ts`, `tests/api/cleaner-invoice-pay-claim-approved.test.ts`, `tests/components/cleaner-invoice-review.test.tsx`, plus the worker schedule test added to `tests/lib/worker-registration.test.ts`.
- Existing tests updated on purpose: `cleaner-invoice-admin-transitions` and `cleaner-invoice-export-guards` (push and payment now need APPROVED; fixtures moved to APPROVED/XERO_PUSHED, SUBMITTED added to the refusals), `cleaner-invoice-delivery-review` (rewritten for the paged table; same rules), `admin-attention-money` (badge statuses now the Needs action set), `invoice-step-c-history-owing` (asserts the amount charged on the attempt row), `worker-registration` (mocks the new job).
- 100 files covering touched code (xero, invoice, cleaner-invoice, payroll, settlement, attention, worker/scheduler, stripe, ops catalog, approvals, editor and list components): 1,164 passed, 3 skipped; the skipped database suite `tests/db/client-invoice-started-jobs.test.ts` was then run on a fresh disposable database on 127.0.0.1:55439 (migrations deployed): 3 passed; database dropped afterwards.

Not verified
- Nothing was exercised against real Xero or Stripe (no provider credentials here). Every Xero rule is covered with a mocked client only.
- Production build, full Vitest suite and browser checks (Chromium 390/1280, light/dark, keyboard) deferred by the owner to the final pass.

First real Xero run: what to check
- Response shape: that `GET Invoices?IDs=…&page=1` returns `Payments` (PaymentID, Date, Amount, Status), `AmountPaid`, `AmountCredited` and `UpdatedDateUTC` for each invoice; if Payments are absent in the list response, every invoice with Xero payments will read "Xero state unknown: listed payments but no amount paid" or record nothing — check one invoice paid in Xero.
- That ids are matched (case-insensitive) and none come back "missing".
- Totals: invoices pushed GST-exclusive may differ from the stored total by Xero's per-line rounding; any difference over half a cent is flagged "Totals differ" — review the first few flagged before deciding whether a tolerance is needed (owner decision).
- Rate limits: with many invoices, watch for "rate limit" unknowns; the run is bounded to 200 invoices + 20 credit notes per hour.
- The token: without `offline_access` there is no refresh token, so after ~30 minutes every scheduled run reads "No active Xero connection, or its sign-in has lapsed" (state unknown) until someone reconnects. Expect this to be the common state until offline access is granted in the Xero app.
- Who appears in History: scheduled runs are attributed to the earliest active administrator account and labelled "Xero sync (scheduled)".

## Follow-up: Cases inbox and Laundry pipeline (2026-11-11)

Scope: details in `docs/SYSTEM.md` → "Cases inbox and Laundry pipeline". No schema change and no migration.

What changed
- Cases: four-column inbox; queues with real counts (`lib/cases/queues.ts`, incl. "Needs my reply"); `GET /api/admin/cases?shape=summary` (summaries only, server paging and allow-listed sort; old shape unchanged without `shape`); `GET /api/admin/cases/[id]/linked`; `POST /api/admin/cases/bulk` (per-row outcomes through `applyCaseUpdate`, which `PATCH /api/admin/cases/[id]` now also uses); create validates job/property/client links; `/v2/admin/cases/[id]` redirects to `?open=` (damage notifications linked there and got a 404); `?caseId=` from the client page opens the case.
- Laundry: Pipeline lanes (`GET /api/admin/laundry/pipeline`, `lib/laundry/pipeline*.ts`), moves (`POST /api/admin/laundry/reschedule`, stale-write guard per row, audit row), `GET /api/admin/laundry/[taskId]` for linked runs, optional `expectedUpdatedAt` on the admin edit PATCH (sent by the edit dialog), Statistics tab (`GET /api/admin/laundry/stats`; `/v2/admin/laundry/stats` redirects), Add run over `POST /api/admin/laundry`, By property restyled, polling only on Pipeline lanes and Drivers live.
- Pre-existing fixes: live laundry stops used the server's local midnight (now the Sydney day); the admin laundry edit could overwrite a newer change; stat captions misdescribed their scope; the case notification link 404.

Verified (this run)
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .`: no errors.
- New tests: `tests/lib/case-queues.test.ts`, `tests/api/admin-cases-summary-route.test.ts`, `tests/lib/case-bulk-and-update.test.ts`, `tests/lib/case-linked-context.test.ts`, `tests/components/cases-inbox.test.tsx`, `tests/api/cases-legacy-links.test.ts`, `tests/lib/laundry-pipeline.test.ts`, `tests/lib/laundry-reschedule-and-pipeline-server.test.ts`, `tests/api/admin-laundry-pipeline-routes.test.ts`, `tests/components/laundry-pipeline-workspace.test.tsx`.
- Existing tests updated on purpose: `tests/components/admin-laundry-investigation-entry.test.tsx` (Investigate is the "By property" tab on the shared feed) and `tests/components/laundry-calendar-day-link.test.tsx` (`?date=` opens the Pipeline day).
- Existing tests covering touched code (cases, damage, laundry, ops policy, restorable state, command reliability, client laundry): all passed.

Not verified
- Production build, full Vitest suite and browser checks (Chromium 390/1280, light/dark, keyboard, overflow, draft retention) deferred by the owner to the final pass. No database run: routes and services are tested with mocked Prisma only.

## Follow-up: Notifications in one place (admin redesign, owner decision second set item 1, 2026-11-11)

Changed
- Manual job reminder (`lib/jobs/job-reminder.ts`) on the notification pipeline via `lib/notifications/office-sends.ts`: explicit `JOB_ASSIGNED_CLEANER` scope (`recipient-scopes.ts`), re-checked in `deliverInboxIntent` / `deliverProviderIntent`; INBOX intent delivered inline (`inline-dispatch.ts`) with an explicit `mobilePushCategory` so the phone app's row (`PUSH`, `SENT`, `mobile-outbox:pending:jobs`) is still produced; email / browser push via the pipeline only when `SNEEK_NOTIFICATION_OUTBOX_TRANSPORTS` lists them, else the previous direct send (claimed once, recorded). Truthful per-recipient outcomes in the response and the audit row; pipeline failure reports everyone as not reminded.
- Envelope: optional `mobilePushCategory`, `recipientPreferences: "IGNORE"` (existing envelopes and hashes unchanged).
- Catalog `lib/notifications/catalog*.ts` (45 types) + per-type controls (`type-controls.ts`, AppSetting, audited) + switch resolver (`catalog-switches.ts`).
- `/v2/admin/notifications` extended (Comms center becomes the one area): Types, Delivery log, Health, Preferences. Every former Comms center control kept (control center and overrides → Preferences; classic log, review queue, Clear log → Delivery log; manual dispatch, resend, test push → Health). Nav entry "Notifications" (Configuration); settings destination "All notifications"; notification settings tabs show a pointer and keep working.
- New routes: `GET/PATCH /api/admin/notifications/catalog`, `POST .../catalog/test`, `GET .../deliveries`, `GET .../health`, `POST .../actions/{staff-message,laundry-nudge,client-delay,guest-message}`.
- Composer sends (`/api/admin/messages/send`) recorded in the delivery log.

Parity (former Comms center, `git show origin/main:components/v2/admin/comms/comms-center.tsx`)
- Control center → Preferences (same component). Manual dispatch → Health disclosure (same component). Delivery log → Delivery log tab "Classic log" disclosure (same component) plus the new unified table. Delivery queue → Delivery log "Review queue" disclosure (same component; `e2e/notifications/intent-queue-local.spec.ts` updated to the new location). Header "Test push" → Health. Header "Clear logs" → Delivery log "Clear log", same endpoint and confirmation (no PIN existed). Header "Refresh" → each tab's reload / Retry.

Verified (this run)
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .`: no errors.
- New tests: `tests/lib/notification-catalog.test.ts`, `tests/lib/notification-office-sends.test.ts`, `tests/lib/notification-entity-scope.test.ts`, `tests/lib/notification-paths-controls.test.ts`, `tests/lib/notification-delivery-log.test.ts`, `tests/lib/notification-office-actions.test.ts`, `tests/api/notifications-area-routes.test.ts`, `tests/api/messages-send-record.test.ts`, `tests/components/notifications-area.test.tsx`.
- Existing tests updated on purpose: `tests/api/jobs-bulk-remind.test.ts` and `tests/api/audit-v03-notification-producers.test.ts` (the reminder's inbox row is now a pipeline intent; same recipients, category, wording and "not sent" absorption).
- 67 notification-related test files (notification, outbox, intent, reminder, push, email, SMS, mobile, worker, dispatch, settings navigation): 66 passed, 1 skipped (DB suite); plus every test importing the changed modules: 24 passed, 4 skipped (DB suites).

Not verified
- DB suites (`tests/db/*`) skipped: no `SNEEK_TEST_DATABASE_URL` set in this run (other engineers' fixtures share the working tree). Production build, full Vitest suite and browser checks (Chromium 390/1280, light/dark, keyboard, overflow, draft retention) deferred to the final pass. No real message sent; providers mocked. Production env (`SNEEK_NOTIFICATION_OUTBOX_TRANSPORTS`, worker jobs, provider keys) not inspected.

## Follow-up: Lost and found and urgent stock (admin redesign sections 9 and 10, 2026-11-11)

Changed
- Lost and found page rebuilt as drawn (`components/v2/admin/lost-found/*`; old `lost-found-board.tsx` removed): stage tabs with real counts over the unchanged statuses, filters, server paging and sorting, CSV export, bulk Move to storage / Mark unclaimed / Donate or dispose with per-item answers, item panel with stage bar, photos and lightbox, job link, guest card from the job's booking (edit, pick another booking), Next step, Stored at, Est. value, every old action, Reopen, timeline with comments; Log an item for the office.
- Guest import on create (`lib/lost-found/create.ts`, used by the cleaner route and the office route); BOOKING / MANUAL source; system timeline entry; redaction extended to the new fields.
- Transition table and Reopen (`lib/lost-found/transitions.ts`, `mutations.ts`); holding period setting (`lib/lost-found/settings.ts`, Settings → Operations → Lost and found).
- Message guest: Send by email / text through the notification step's `guest-message` action (ADMIN; moves to Guest contacted only when the provider accepted); copy / mailto / sms / tel and "Mark guest contacted" otherwise; Tell client is copy-and-record only (no pipeline path).
- Urgent stock: first Stock tab (`components/v2/admin/inventory/urgent/*`), all-property list (`lib/inventory/urgent-stock-list.ts`), bulk (`urgent-stock-bulk.ts`), one next action per stage (`urgent-stock-actions.ts`), need panel with stay preparation; storage moved to `UrgentStockNeed` / `UrgentStockEvent` (`urgent-stock-store.ts`) with every export of `lib/inventory/urgent-stock.ts` kept; stay preparation reads the table; `/urgent-stock` redirects administrators; Inventory nav badge (REPORTED, administrators).
- Existing problems fixed: a status move back from a decision silently erased the decision (now Reopen with a reason, decision kept in the entry; archiving keeps the decision); the board's search was case-sensitive and missed property names; found-date filters used server-local midnight (now organisation calendar days); the job on an item was plain text (now a link); the property filter only listed properties on the loaded rows.

Migration `20261111200000_lost_found_guest_urgent_stock_tables` — verification (Postgres 127.0.0.1:55439)
- Fresh: `createdb lf_fresh`; `DATABASE_URL=…/lf_fresh npx prisma migrate deploy` → "All migrations have been successfully applied."; repeated → "No pending migrations to apply."; `npx prisma migrate diff --from-url …/lf_fresh --to-schema-datamodel prisma/schema.prisma --exit-code` → "No difference detected." (exit 0).
- Existing `sneek_ui` (at `20261111180000`): fixtures inserted first — items (a) empty guest + job with booking (two rows, one whitespace-only), (b) existing guest name / contact-only text, (c) no job, (d) job without booking, (e) booking without name or phone; urgent stock JSON: open need with pointer and three events (incl. reminder with null actor), closed need with an offset `observedAt` and 12.5 purchase quantity, legacy need missing optional keys, and malformed rows (bad stage, string value, key/id mismatch, missing property, "not a date", "2026-13-45" date, missing remindersSent, count stored as text) plus four unreadable events (orphan, bad time, array value, reportId mismatch) and a receipt. Checksums (md5 of every pre-existing column per item, of all AppSetting rows, of all LostFoundEvent rows) recorded before.
- `migrate deploy` → applied; repeated → no pending; diff → "No difference detected." (exit 0).
- After: only the two (a) rows changed (guest from booking, `guestSource` BOOKING, `reservationId` set, name trimmed); (b) rows got MANUAL with every pre-existing column checksum unchanged; (c), (d), (e) unchanged (no source); AppSetting and LostFoundEvent checksums unchanged (old JSON rows kept). Needs: 11 JSON rows → 3 copied + 8 left in AppSetting (all eight malformed ones), ids, stages, versions, counts, `observedAt` text, reminders, reporter (from the REPORTED event) and `openPairKey` (from the pointer) as stored. Events: 8 JSON rows → 4 copied + 4 left (the unreadable ones), notes from the stored reason/note, `fromStage` null (unknown). Count query (in SYSTEM.md) returned 8 / 4. Fixtures then removed from `sneek_ui` (the migration stays applied there).
- `npx prisma generate` run. No `db push`; no applied migration rewritten.

Verified (this run)
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .`: no errors.
- New tests: `tests/lib/lost-found-guest-transitions.test.ts`, `tests/lib/lost-found-holding.test.ts`, `tests/components/lost-found-format.test.ts`, `tests/api/lost-found-office.test.ts`, `tests/db/lost-found.test.ts`, `tests/lib/urgent-stock-actions.test.ts`, `tests/api/urgent-stock-office.test.ts`, `tests/components/urgent-needs-table.test.tsx`, `tests/lib/admin-attention-urgent.test.ts`; office list / bulk / table-parity cases added to `tests/db/urgent-stock.test.ts` (same file as the reminder test because the reminder worker reads every open need).
- Existing tests updated on purpose: `tests/db/urgent-stock.test.ts` and `tests/db/stay-preparation.test.ts` count and clean the new tables instead of `urgent_stock_v1:open:` / `event:` AppSetting rows (storage moved); `tests/lib/lost-found-reporter-redaction.test.ts` gained the new fields.
- Every test file touching lost and found, urgent stock, stay preparation, inventory, attention counts, settings navigation and the guest message (101 files, 1093 tests) passed with `SNEEK_TEST_DATABASE_URL` on the disposable `lf_fresh` database. All database suites together: 140 passed, 1 skipped, 1 failed — `tests/db/form-template-library.test.ts` (Template builder work in progress; not this step).

Not verified
- Production build, full Vitest suite and browser checks (Chromium 390/1280, light/dark, keyboard, overflow, draft retention) deferred to the final pass. No real guest email or SMS sent (providers mocked in tests).

## Forms builder step (2026-11-11)

Scope: `/v2/admin/forms/[id]/edit` rebuilt to the "Template builder" design; typed schema and strict save check; per-room repeat; server validation warnings on cleaner submit; field type audit, barcode scanner, searchable dropdown; QA template revisions, overlap warning, duplicate, delete; legacy PATCH routed to drafts; classic builder retired with redirects. See `docs/SYSTEM.md`, "Form builder: outline, questions, shared settings, versions and test as cleaner".

Behaviour changed on purpose
- Publishing (single, builder and bulk) is refused while the form has a check error or fails the strict save check (`CHECKS_FAILED` / `INVALID_SCHEMA`, 422). Previously only bulk publish checked.
- Saving a draft refuses unknown question types and malformed rules (legacy aliases accepted). Restore skips the check.
- `PATCH /api/admin/form-templates/[id]` saves `schema` / `serviceType` to the draft instead of the live form.
- Cleaner submit stores `data.__validationWarnings` for extended rules; no new rejections (`ENFORCE_EXTENDED_FORM_VALIDATION = false`).
- `/admin/forms/[id]/edit`, `/admin/forms/new`, `/admin/forms/stats` redirect to v2; the classic forms page's builder tab only links to the v2 builder.

Tests updated on purpose
- `tests/components/form-builder-drafts.test.tsx` rewritten for autosave and the publish dialog (same intent: draft-only saves with the token, publish with the current token, not while unsaved).
- `tests/api/audit-form-template-pages.test.tsx`: the legacy edit page now redirects (admission unchanged).
- `tests/components/forms-authority-surface.test.tsx`, `tests/components/qa-templates-gating.test.tsx`: controls moved (links to the v2 builder; QA Edit/Reset in the row menu).
- `tests/components/device-status-input.test.tsx`: import path only.
- `tests/components/form-builder.test.tsx` deleted with the classic builder it tested.

Not verified
- Production build, full Vitest suite and browser checks (Chromium 390/1280, light/dark, keyboard drag, camera scanner on a phone, overflow) deferred to the final pass. Database tests not run (no disposable database in this session).

## Live ops follow-up step (2026-11-11)

Scope: owner decisions third set items 2, 3, 5 and fourth set item 1, plus the deferred Laundry nudges, Accounts bulk Message and the Cases Refresh parity item. See `docs/SYSTEM.md`, "Live ops follow-up: delay notice, clock pause, decline reason, QA issue from a case, laundry nudges, bulk message (2026-11-11)". No schema change.

Behaviour changed on purpose
- `PATCH /api/admin/job-continuations/[id]` refuses `REJECT` without a non-blank `decisionNote` (400); `decideContinuationRequest` refuses it too. Approve unchanged.
- The laundry nudge route refuses a second nudge of the same kind for the same run within 30 minutes (409 with the first time) unless the idempotency key is the same.
- `clockOutCleaner` takes an optional `note` (only written when given; the cleaner's Stop is unchanged).
- The client delay notice and laundry nudge audit rows record the idempotency key.
- Quality hub Issues search also matches an exact issue id; Issues table gains a "Raised from" column.
- `CaseLinkedContext.cleaners` entries carry the user id.

New server surface
- `GET /api/admin/notifications/actions/client-delay` (ADMIN; preview, sends nothing).
- `POST /api/admin/jobs/[id]/pause-clock` (ADMIN; 409 "No running clock").
- `POST /api/admin/quality/issues` and `GET /api/admin/quality/issues/case-options` (ADMIN; OPS_MANAGER with quality at manage).
- Catalog entry `jobs.clock_paused_by_office`.

Tests updated on purpose
- `tests/components/live-ops-feed.test.tsx` and `tests/components/admin-command-reliability.test.tsx`: Decline now goes through the reason dialog before the server's refusal is shown (same intent: the row stays and shows the server's reason).
- `tests/lib/notification-office-actions.test.ts`: the db mock gained `auditLog.findFirst` for the cool-down read.
- `tests/api/cleaner-start-preserves-briefing.test.ts`: added a case resuming a job the office paused.

New tests
- `tests/api/admin-clock-pause.test.ts`, `tests/api/admin-client-delay-notice.test.ts`, `tests/api/admin-continuation-decline-reason.test.ts`, `tests/api/raise-qa-issue-from-case.test.ts`, `tests/lib/laundry-nudges.test.ts`, `tests/components/live-ops-follow-up.test.tsx`, `tests/components/cases-refresh-and-qa.test.tsx`, `tests/components/office-actions-ui.test.tsx`.

Not verified
- Production build, full Vitest suite, database tests and browser checks (Chromium 390/1280, light/dark, keyboard, overflow) deferred to the final pass at the owner's request. No real message was sent (providers mocked in tests).

## Quality design completion, Wave C (2026-11-11)

Scope: the Quality half of Wave C (owner decision, sixth set). See `docs/SYSTEM.md`, "Quality design completion: manual bonus proposal, both row actions, Low / Medium / High (Wave C, 2026-11-11)". No schema change; automatic bonus, deduction, scoring and coaching rules unchanged.

Rules added or access changed
- New `POST /api/admin/quality/bonus-proposals`: a manual quality bonus as a PENDING pay adjustment (paid only after the existing approval). Access mirrors the pay-adjustment create route (ADMIN; OPS_MANAGER with payroll at manage) plus quality at manage for this path; refused while impersonating; CLEANER payees only.
- New bounds: $5 to $200 in whole cents; reason required (3–1000). A pending bonus for the cleaner (automatic or manual) refuses with 409 unless acknowledged.
- "Review bonus" now also lists manual quality bonuses (the "bonus due" streak badge stays automatic only).

Behaviour changed on purpose
- Severity reads Low / Medium / High on the admin Quality hub, the Cases "Raise QA issue" dialog and its internal case note; stored, API and query values unchanged. The Quality CSV gains a "Severity label" column after "Severity".
- Cleaners rows show one button (Start coaching, Review bonus or Propose bonus) and the other applicable actions in a row menu.
- Expanded cleaner row dates read "6 Nov" (year outside the current year).

Tests updated on purpose
- `tests/components/quality-hub-coaching-access.test.tsx`: the access object gains `canProposeBonus` (added a case for the payroll rule).
- `tests/components/quality-hub-actions.test.tsx`: the pending-bonus fixture carries `origin: "automatic"`.

New tests
- `tests/api/quality-bonus-proposals.test.ts`, `tests/components/quality-hub-bonus-actions.test.tsx`, `tests/lib/quality-severity.test.ts`.

Verified: `npx tsc --noEmit -p .` clean; the Quality, pay-adjustment, accountability, streak, rectification, approval-history and Cases QA test files pass (27 files, 298 tests), plus the ops-policy and route-guard audits.

Not verified
- Production build, full Vitest suite, database tests and browser checks (Chromium 390/1280, light/dark, keyboard, overflow, the row menu inside the scrolling table) deferred to the final pass at the owner's request.

## Jobs and Calendar design completion, Wave A (2026-11-11)

Scope: Wave A of the owner's sixth decision set. See `docs/SYSTEM.md`, "Jobs and Calendar: design completion, Wave A (2026-11)". No schema change; scheduling, assignment, status and charge rules unchanged; all writes go through the existing reschedule, job-create and assign code.

Rules added or access changed
- New `POST /api/admin/jobs/view-counts` (ADMIN, OPS_MANAGER; read-only, POST for the body): saved-view tab totals. An operations manager with Jobs "view" gets none (POST needs manage) — fails closed.
- New `POST /api/admin/jobs/bulk-reschedule` (ADMIN; OPS_MANAGER with Jobs manage AND Calendar manage, matching the single reschedule and the Calendar move check). At most 100 jobs.
- New `POST /api/admin/jobs/import` (ADMIN, OPS_MANAGER with Jobs manage, as job creation). At most 200 rows / 200 KB. Each created row writes an `AuditLog` receipt (`JOB_CSV_IMPORT_ROW`).
- `POST /api/admin/calendar/check-move` accepts `toStartTime` / `shiftMinutes`; a time move of a job with a separate end time is refused (the reschedule service writes only start and due).
- Guest in and Charge sorts refuse a filtered set above 5,000 jobs (400, `SORT_SET_TOO_LARGE`).
- The admin job create moved unchanged into `lib/jobs/admin-create.ts`; `POST /api/admin/jobs` calls it.

Behaviour changed on purpose
- Cleaner, Guest in and Charge headers sort (list and board). Day rows read "Thursday 12 November", today "… · today". Unassigned is in the danger tone on the Jobs list, board and peek only. Bulk bar gains Reschedule. "Import or bulk create" opens a dialog instead of linking to the New job page. Suggested cleaners add a straight-line distance with its basis and the 30-day QA score, and use them as tie-breaks. Calendar chips drag on touch after press-and-hold and show a grip; Day-view drops can change the time; the Calendar keeps its view (always) and date (same session, same day) across a refresh — a documented exception in `docs/style/operational-ui.md`.

Tests updated on purpose
- `tests/lib/jobs-list-route-v2.test.ts`: cleaner/guestIn/charge are no longer "unknown sorts"; the refusal cases use other unknown values.
- `tests/components/jobs-workspace-url.test.tsx`: the three headers now sort and send `sort=charge|cleaner|guestIn`; the bulk bar includes Reschedule; "Import or bulk create" is a button opening the dialog with the bulk-create deep link.
- `tests/api/calendar-check-move.test.ts`: added time-change cases.

New tests
- `tests/lib/jobs-computed-sort.test.ts`, `tests/lib/jobs-saved-view-counts.test.ts`, `tests/lib/cleaner-suggestions-signals.test.ts`, `tests/lib/jobs-bulk-reschedule.test.ts`, `tests/lib/calendar-time-drop.test.ts`, `tests/lib/jobs-csv-import.test.ts`, `tests/lib/jobs-admin-create-once.test.ts`, `tests/lib/jobs-day-label.test.ts`, `tests/lib/calendar-touch-drag.test.ts`, `tests/lib/jobs-wave-a-route-coverage.test.ts`, `tests/components/calendar-touch-time-restore.test.tsx`.

Verified: `npx tsc --noEmit -p .` clean; the Jobs, Calendar, suggestions, saved-views and view-memory test files plus the new ones pass, except failures that are not Wave A's: `tests/lib/jobs-invoiced-rule.test.ts`, `tests/lib/jobs-route-filters.test.ts` (3 cases) and `tests/lib/jobs-view-presets.test.ts` (1 case) assert the previous `lib/jobs/invoiced-rule.ts` shape, which changed in an earlier commit outside this wave (Finance path). The Cleaner sort SQL was planned (EXPLAIN only) on the disposable 55439 database; no rows were read or written.

Not verified
- Production build, full Vitest suite, database tests and browser checks (Chromium 390/1280, light/dark, keyboard, overflow; real touch devices for press-and-hold and scroll suppression; Day-view drop positions with real layout) deferred to the final pass at the owner's request. No import was run against a real database.

## Forms design completion, Wave B (2026-11-12)

Scope: Wave B of the owner's sixth decision set plus the owner's decision to make extended submit validation switchable. See `docs/SYSTEM.md`, "Forms design completion: Compare, Import/Export, Table, Stock count, effects, Monthly (Wave B, 2026-11-12)". No schema change.

Rules added or access changed
- New `GET /api/admin/form-templates/compare` (ADMIN, OPS_MANAGER; read only, 2–4 forms).
- New `GET /api/admin/form-templates/export` and `POST /api/admin/form-templates/import` (ADMIN). Import creates new draft forms only (`isActive: false`), ≤ 1 MB / 20 forms / 500 questions per form, strict save check per form, audit `FORM_TEMPLATE_IMPORTED`.
- New question types `table` and `stock_count`: their answer rules are enforced (rejected) by the cleaner submit route from the first release (`invalidFields`, rules `table` / `stock-count`).
- New question effects. Stock count "raises an urgent stock need below N": an urgent need is raised after commit as the submitting cleaner, once per submission and item, through the additive `reportUrgentStockFromSubmission` in `lib/inventory/urgent-stock.ts` (scope proven by the submission; the existing `reportUrgentStock` body was moved unchanged into a shared internal function). Yes / No "opens a damage report": the submit route opens one private damage case per such answer when the cleaner has not submitted a damage report for the job and sent no damage items.
- New cadence "Monthly" (`frequency: "MONTHLY"`) using `PropertyRotationState.lastCompletedAt`.
- `settings.formValidation` (default off). New `GET/PUT /api/admin/form-templates/validation-setting` (read ADMIN/OPS_MANAGER, write ADMIN, audit `FORM_VALIDATION_ENFORCEMENT`) and `GET /api/cleaner/jobs/[id]/form-validation` (assigned cleaner). When on, extended checks reject except for jobs the cleaner first clocked in on before the switch-on moment.
- Notification catalogue: `submission.urgent_stock_review` (inbox only) added to "Urgent stock need".

Behaviour changed on purpose
- Library Checks include "never answered" as warnings, so "Has problems" counts them; errors and warnings are separate pills; chip label "Has problems: errors or warnings".
- Avg time and Completion headers sort over the whole filtered set ("–" last); refused above 20,000 submissions.
- Builder header name is editable in place (metadata PATCH, stale-write guard).
- Monthly / Table / Stock count / effects change nothing for forms that do not use them; existing every-Nth rotation, published forms and stored submissions are untouched.

Tests updated on purpose
- `tests/lib/form-schema-save-and-publish.test.ts`: "table" and "MONTHLY" are real now; the refusal rows use "grid" and "WEEKLY".
- `tests/components/form-field-type-audit.test.tsx`: cases for `table` and `stock_count` (the audit requires one per registered type).

New tests
- `tests/api/cleaner-submit-form-effects.test.ts` (structured validation, urgent queueing below/at threshold, unstocked skip, damage case once / covered by report / not on No, enforcement both sides of the switch-on boundary), `tests/lib/submission-urgent-stock.test.ts`, `tests/lib/urgent-stock-from-submission.test.ts`, `tests/lib/forms-structured-and-effects.test.ts`, `tests/lib/rotation-monthly.test.ts`, `tests/lib/resolve-monthly-form.test.ts`, `tests/lib/form-validation-enforcement.test.ts`, `tests/lib/form-library-compare-transfer.test.ts`, `tests/lib/form-library-whole-set.test.ts`, `tests/components/inline-form-name.test.tsx`, `tests/components/form-effects-renderer.test.tsx`, `tests/api/form-validation-setting-route.test.ts`.

Verified: `npx tsc --noEmit -p .` clean for these paths; 128 related test files (forms, templates, submit incl. all contract tests unchanged, renderer, rotation, stock, damage, checklist, notification catalogue, library and builder routes, settings) pass, 1284 tests.

Not verified
- Production build, full Vitest suite, database tests and browser checks (Chromium 390/1280, light/dark, keyboard): Compare table overflow at 390px (it scrolls inside its card), the Import dialog, the table cards on a phone, the damage prompt inside the clean stage, the inline rename focus return, the enforcement card.
- The classic `/cleaner/jobs/[id]` page does not render Table or Stock count controls (the v2 renderer does); a form using them should only be filled in the v2 cleaner app.
- The raw SQL warning counts (`lib/forms/validation-warning-stats.ts`) were not run against a database.

## Finance decisions (2026-11-12)

Scope: owner decisions of 2026-11-11 (second set 2–6; third set 4, 6, 8) and two existing problems (Xero `offline_access`; classic cleaner-invoice screen). Details: `docs/SYSTEM.md`, "Finance decisions".

Behaviour deliberately changed
- The INVOICED job status alone no longer makes a job "invoiced" (Jobs filter, Not invoiced count, Ready to bill, generator, Money tab). Fully credited invoices stop billing their jobs.
- Voiding / deleting a draft / fully crediting returns INVOICED jobs to their previous status (audit) or COMPLETED.
- Voiding a credit note is refused when its invoice's work has since been billed on another live invoice.
- A line on a VOID invoice no longer blocks job delete, QA reset or option reset; a line on a non-void invoice now also locks evidence in the option reset (before, only the INVOICED status did).
- `sentAt` is the first send; re-sends go to `metadata.resentAt[]`. Past rows restamped by a re-send cannot be repaired.
- Command's Money this month adds "Invoiced this month" (first row); the stats strip adds the same card.
- Due dates use per-invoice terms (snapshot, else client terms, else default); overdue is resolved per invoice in SQL.
- Insights revenue = invoiced (ex GST, net of credit notes) + not yet invoiced (scheduled charge), split shown; findings and CSV updated.
- Finance summary excludes and flags cleans with no pay rate instead of costing them at $40/h. Pay itself is unchanged.
- Xero-read payments send the client receipt; scheduled Xero rows show as "System: Xero sync (scheduled)"; `offline_access` requested.
- Classic `/admin/cleaner-invoices` and `/admin/finance?tab=invoices` redirect to Invoices and pay.

Migration verification (`20261112090000_finance_decisions`, PostgreSQL 16 on 127.0.0.1:55439)
- Fresh: `createdb fin_fresh` → `DATABASE_URL=…/fin_fresh npx prisma migrate deploy` → "All migrations have been successfully applied."; repeated → "No pending migrations to apply."; `npx prisma migrate diff --from-url …/fin_fresh --to-schema-datamodel prisma/schema.prisma --exit-code` → "No difference detected." (exit 0). Repair record: count 0.
- Existing `sneek_ui` (already at `20261111200000`; its own data had 0 INVOICED jobs and no invoices, so fixture clients, jobs, invoices in every status (DRAFT, APPROVED, SENT, PART_PAID, PAID, VOID), a full and a partial credit note were added first): md5 of every pre-existing column of Client, ClientInvoice, ClientInvoiceLine, of non-repaired Job rows (all columns) and of Job identity columns, before and after deploy → identical; index list md5 identical. Results: issued invoices (SENT/PART_PAID/PAID/VOID, incl. the sent credit note) got `paymentTermsDays = 14`, drafts/approved stayed null; the fully credited invoice got `creditedInFullAt`; 3 legacy jobs repaired (no line; only on VOID; only on the fully credited invoice); INVOICED jobs on SENT and DRAFT invoices unchanged. Repeat deploy → no pending; migrate diff → no difference (exit 0). The fixtures were deleted afterwards; the repair record row in `sneek_ui` still says count 3 (fixture ids).
- Production count before deploy (works on the schema after the credit-notes migration):
  `SELECT COUNT(*) FROM "Job" j WHERE j."status"::text='INVOICED' AND NOT EXISTS (SELECT 1 FROM "ClientInvoiceLine" l JOIN "ClientInvoice" i ON i."id"=l."invoiceId" WHERE l."jobId"=j."id" AND i."kind"::text='INVOICE' AND i."status"::text<>'VOID' AND NOT COALESCE((SELECT SUM(ABS(c."totalAmount"))>0.005 AND SUM(ABS(c."totalAmount"))+0.005>=i."totalAmount" FROM "ClientInvoice" c WHERE c."creditsInvoiceId"=i."id" AND c."kind"::text='CREDIT_NOTE' AND c."status"::text IN ('APPROVED','SENT')),false));`
  If production does not yet have `ClientInvoice.kind` (credit-notes migration not deployed), use: `SELECT COUNT(*) FROM "Job" j WHERE j."status"::text='INVOICED' AND NOT EXISTS (SELECT 1 FROM "ClientInvoiceLine" l JOIN "ClientInvoice" i ON i."id"=l."invoiceId" WHERE l."jobId"=j."id" AND i."status"::text<>'VOID');`

Checks run
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .` → clean at the end (earlier runs showed errors only in others' in-progress files: `lib/forms/structured-answers.ts`, `components/v2/admin/calendar/use-chip-drag.ts`, `lib/cleaner/submission-followups.ts`).
- 256 existing and new test files covering invoices, billing, receivables, finance, insights, Xero, payroll, pay, delete/reset guards, jobs filters, clients, accounts, workers, notifications catalog, settings → 3,023 tests passed.
- `tests/db` on the disposable `fin_fresh` database (`--no-file-parallelism`): 21 files passed incl. new `tests/db/finance-decisions.test.ts`; 1 skipped (its own condition); 1 failed: `tests/db/form-template-library.test.ts` (Forms, another engineer's in-progress area).
- Tests updated because they encoded the old behaviour on purpose: `jobs-invoiced-rule`, `jobs-route-filters`, `jobs-view-presets` (INVOICED status no longer counts), `client-invoice-generation` (live-invoice recheck), `admin-invoices-list` (per-invoice overdue ids), `command-sections` (Invoiced this month row), `insights-csv-and-url` (revenue labels), `invoice-xero-payment-path` (system label and marker), `insights-page-access` (Email monthly state), `started-work-financial-boundary` and `invoice-step-c-xero-send` (send now stamps under a transaction), `worker-registration` (new job).

Mocked only / not verified
- Xero (offline_access, refresh, receipts, system marker) and every email: mocked providers only; nothing real was sent and nothing ran against Xero. The owner must reconnect Xero once after deploy.
- Production build, full Vitest suite and browser checks (Client 360 Payment terms card, Settings → Monthly Insights email, Insights header, Finance stats strip at 5 cards, Accounts "No pay rate" chip, Xero reconnect alert; 390/1280, light/dark) were not run in this step.
- The embedded web scheduler (`lib/ops/web-scheduler.ts`) does not run `insights-monthly-email` (nor `xero-invoice-sync`): a dedicated worker is needed for the monthly email.

## Insights design completion (Wave C, 2026-11-12)

Scope: the Insights half of Wave C in `docs/plans/admin-redesign-2026-11.md` plus an element-by-element pass against `Insights.dc.html`. No schema change; read-only analytics; no money, business or access rule changed. Details: `docs/SYSTEM.md`, "Insights design completion … (Wave C, 2026-11-12)".

Changed
- Overrun finding adds "At the current rate this property makes $N per clean." from `marginPerClean` = (revenue − cleaner cost) ÷ cleans over the margin's basis; basis count in the finding's basis line; "not enough data" and no number below 3; computed and sent only with finance access.
- Business preview sorts in place: the first five of the whole property set in the chosen order via the properties route (`pageSize=5`); "All N properties" keeps the order. Shared ordering in `lib/insights/property-order.ts`; new non-financial sort key `ratio` ("Actual vs planned" column on Properties).
- Client filter is the shared `EFilterPopover` chip with a searchable, keyboard-operable list (`EFilterPopover` gains optional `emptyValue`; other callers unchanged).
- Margin badge bands from named thresholds (`lib/insights/margin-band.ts`), number always shown.
- Design pass: header order (… Export, Email monthly), Email monthly as a state button opening the owner-only setting, subtitle "compared with September", findings in a row, card definitions in one disclosure, chart legend badges in the header and solid gold bars, actual-hours danger above 110%.

Existing problems fixed
- Without finance, the preview ranked by time over plan but "All N properties" opened name order; Time and cost's "All N properties" did the same. Both now open `ratio` highest first.
- Actual hours were red at exactly 110% of planned; the design marks only above it.

Checks run
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .` → no errors in Insights files; remaining errors only in Wave D Money paths in progress (`components/v2/admin/finance/invoices/invoice-filters.tsx`, `lib/billing/client-invoice-list.ts`).
- Vitest: `tests/lib/insights-design-completion.test.ts` (new), `tests/components/insights-header-controls.test.tsx` (new), `tests/api/insights-routes.test.ts` (2 new cases), and the existing `insights-*`, `finance-decisions-rules`, `worker-registration`, `insights-page-access` files → 12 files, 109 tests passed. No existing test was changed or weakened.
- ESLint on the touched files: clean.

Not run (owner asked to save time)
- Production build, full Vitest suite, browser checks. For the final browser pass: Business tab at 390/1280, light/dark — findings row and money sentence, cards with the disclosure, chart header legend wrapping at 390, preview header sort (busy state, error retry, URL survives refresh), "All N properties" order, Client chip popover (search, arrows, Escape, overflow at 390), Email monthly button for ADMIN and for an operations manager, PDFs tab with no header controls.


## Money design completion (Wave D, 2026-11-12)

Scope: Wave D in `docs/plans/admin-redesign-2026-11.md` (list and editor differences from `Money.dc.html` / `InvoiceEditor.dc.html`). No schema change, no migration. Details: `docs/SYSTEM.md`, "Money design completion … (Wave D, 2026-11-12)".

Changed
- Ready to bill dollar figure and "Create N drafts" (`POST /api/admin/invoices/generate-batch`, idempotent per key); drafts with missing rates counted; Xero push failures recorded as FAILED with reason (Synced / Push pending / Push failed / not yet checked); "On send" in Due and a provisional due line on the admin PDF preview; bulk Download PDFs (`POST /api/admin/invoices/pdf-archive`); Owing sorted in SQL.
- Editor: Bill to / Period / Due on drafts (PATCH `clientId`, `period`, `paymentTermsDays`), Add finished jobs (`GET/POST /api/admin/invoices/[id]/jobs`), send options (`includePaymentLink`, `pushToXero`), autosave with the PATCH stale-write guard (`expectedUpdatedAt`, 409 `STALE_INVOICE`), add-line suggestions and saved invoice items (`/api/admin/invoices/saved-items`), Xero account name, approval checks enforced on drafts.

Rules added (business / money / access; owner asked for the design to be made real)
- A DRAFT is not approved, sent directly or marked paid while a job line's job has no client rate (or a line amount is not a number), a job is on another live invoice or twice on it, the stored total does not match the lines, or any of these cannot be checked. Existing APPROVED/SENT invoices are unaffected.
- A draft's Bill to may change only when every job belongs to the new client (and no shopping allocation, property-grouped manual line or started-work snapshot ties it); never on a credit note.
- An invoice-specific payment-terms override set on a draft is kept at first send (the snapshot does not overwrite it).
- A send asking for a payment link is refused when no gateway could serve it; push-after-send never undoes a send.
- Xero OAuth now also requests `accounting.settings.read` (opt out `XERO_REQUEST_SETTINGS_READ=false`).

Existing behaviour changed on purpose, and the tests updated for it
- `tests/lib/client-invoice-checks.test.ts`: rates / other invoice / totals were advice ("Check") on a draft; they now block approval (new cases for double lines, unknown, and approved invoices staying advisory).
- `tests/api/invoice-step-c-patch.test.ts`: the partial credit-note approval now needs lines that match its total; mock gains `$executeRaw`.
- `tests/api/started-work-financial-boundary.test.ts`: the non-started draft send fixture now has matching totals (GST off); mock gains `$executeRaw`.
- `tests/lib/invoice-step-c-xero-send.test.ts`: mock gains `$executeRaw` (the approval rule takes the billing lock).
- `tests/api/admin-invoices-list.test.ts`: needs-action includes FAILED reservations; new case separating `pending` and `failed`.
- `tests/api/admin-invoices-bulk.test.ts`: the send route now passes explicit default options.
- `tests/lib/client-invoice-xero-display.test.ts`: new labels (Synced, Synced · paid in Xero, In Xero · not yet checked, Push failed) and stage notes.
- `tests/lib/finance-decisions-rules.test.ts`: the scope string gains `accounting.settings.read`, with an opt-out case.
- `tests/components/invoice-editor-page.test.tsx`: PATCH bodies carry `expectedUpdatedAt`; the new-line description is a combobox; fixtures gain the new fields.

Checks run
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .` → no errors.
- Vitest, 178 files (every non-DB test file mentioning invoice / billing / receivables / finance / xero, plus the four new Wave D files) → 2,269 passed, 1 failed: `tests/lib/notification-paths-controls.test.ts` ("shows no banner once the transports are on the pipeline"), in notification / settings code this step did not touch (other engineers' work in progress).
- DB tests on a fresh disposable database (`moneyd_fresh` on 127.0.0.1:55439, `prisma migrate deploy` from empty, `prisma migrate diff --exit-code` → no difference): `tests/db/money-wave-d.test.ts` (6), `client-invoice-started-jobs`, `finance-decisions`, `holiday-rates` → 25 passed.

Not run / not verified
- Production build, the full Vitest suite and browser checks (owner asked to save time). For the final browser pass, at 390px and 1280px, light and dark: stats cards (Ready to bill with button, Drafts pill), Create drafts dialog (loading, outcomes list, retry), Due "On send", Owing header sort, Xero cell states and reasons, bulk Download PDFs result panel, editor header fields (Bill to select width at 390, period inputs wrapping, Due hint), Add finished jobs dialog, add-line combobox (keyboard, list in flow), Send card options and reasons, Xero card name / reason, checklist links, autosave states and conflict banner, Billing schedule → Saved invoice items disclosure.
- Xero (push failure recording, account name read, new scope), Stripe payment link and email are mocked only. First real Xero use: reconnect Xero once (now also for `accounting.settings.read`); if the app refuses the scope, set `XERO_REQUEST_SETTINGS_READ=false` and the card shows "name unavailable".

## Wave E without a database change (2026-11-12, uncommitted step)

Scope: the Wave E items of `docs/plans/admin-redesign-2026-11.md` that need no schema change. No Prisma schema change, no migration. Details: `docs/SYSTEM.md`, "Wave E without a database change".

Changed
- Cases "Create repair quote" → `/v2/admin/quotes/new?fromCase=` pre-filled on the server (client, address, title, description, case image evidence); the created quote is linked by a `FROM_CASE` quote event and an internal case note in its own transaction; the case lists "Quote Q-… created", the quote shows "From case …". Nothing is sent.
- Laundry "Chase supplier" on runs over turnaround: preview `GET /api/admin/laundry/[taskId]/supplier-chase`, send `POST /api/admin/notifications/actions/supplier-chase` (ADMIN, stored contact only, 30-minute cool-down per run, masked audit, truthful states); Copy / `mailto:` / `tel:` for everyone who can open the run. New shared `lib/notifications/external-recipient.ts` (guest message moved onto it unchanged).
- Command "Send reminder" for an expiring document → `REQUEST_DOCUMENT` with `documentId` (explicit transports, one per document per day, replay of the same key).
- Lost and found "Tell client" sent from the app (`POST /api/admin/lost-found/[id]/send-client-notice`, ADMIN, new pipeline scope `LOST_ITEM_PROPERTY_CLIENT`, client switch honoured, timeline records real states); Property column and sort menu sort by property name across pages.
- Forms: Results and stats → Submissions (server paging, sort, filters, PDF, submission view with answers, media, laundry, report preview, history; administrators edit, add / remove / restore media). `/admin/forms` redirects with its tabs mapped; `components/forms/checklists-workspace.tsx` removed.
- Office submission views show Table answers as a table and Stock count as "item · counted N unit"; the classic cleaner job page renders both types with the shared controls (not redirected; reason in SYSTEM.md).
- A monthly question already shown on a clean at the property this month that is submitted but not approved is not shown again; due again after that clean is reset or rejected.
- Design: Laundry tiles moved into Statistics and lane cards carry their exception action; Cases "Client can" as one choice; Live ops late row "Tell client"; Command lost-item row opens the item.

Existing problems fixed (standing rule)
- `REQUEST_DOCUMENT` wrote its notice as "SENT" and fired email / SMS without recording the answers or escaping the title; it now returns and audits each transport's real state (catalog `workforce.document_request`, `workforce.document_request_sms`).
- Submission edits overwrote answers with no history; removing submission media deleted the stored file; added media had no ownership check; internal `__` fields could be overwritten. Now: before/after audit, originals kept as restorable tombstones, ownership checked, internal fields refused.
- Quote reference images (create and PATCH) accepted any storage key; now the case's evidence or own / office uploads only.
- The app-sent guest message's timeline entry said "recorded by the office"; it now says sent by the app.

Rules added (who can do what) — for the owner
- Chase supplier and Tell client: administrators send; operations managers copy and record (mirrors the guest message). Owner decision still open for all three.
- Submissions editing in the Forms page is shown to administrators only (as the classic page); the PATCH route still admits operations managers as before (used by the job pages).

Existing behaviour changed on purpose, and the tests updated for it
- `tests/components/forms-authority-surface.test.tsx`: the classic Forms page now redirects (tab map and refusal cases).
- `tests/api/lost-found-office.test.ts`, `tests/components/lost-found-format.test.ts`: a client message is now sendable by an administrator when the client has a login.
- `tests/components/live-ops-follow-up.test.tsx`: the row button reads "Tell client" (dialog unchanged).
- `tests/lib/case-linked-context.test.ts`, `tests/components/cases-refresh-and-qa.test.tsx`: linked context gains `quotes`.
- `tests/lib/work-queue.test.ts`: lost-item row href opens the item; new Send reminder case.

Checks run
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .` → no errors.
- New focused tests: `tests/api/case-repair-quote.test.ts` (7), `tests/api/laundry-supplier-chase.test.ts` (11), `tests/api/document-reminder.test.ts` (6), `tests/api/lost-found-client-notice.test.ts` (9), `tests/api/form-submissions-office.test.ts` (12), `tests/components/structured-answer-display.test.tsx` (9), `tests/lib/monthly-pending-clean.test.ts` (7), `tests/db/lost-found-property-sort.test.ts` (3, PostgreSQL) → all passed.
- Existing tests covering the touched code (notifications catalog / office sends / entity scope / paths, work queue, Command, laundry pipeline and nudges, lost and found, cases, forms resolution and submit, field type audit, renderers, live ops) → all passed.
- DB tests on my own fresh disposable database (`wave_e_fresh` on 127.0.0.1:55439, `prisma migrate deploy` from empty): `lost-found-property-sort`, `lost-found`, `form-template-library`, `laundry-early-evidence` → passed.

Not run / not verified
- Production build, the full Vitest suite and browser checks (owner asked to save time). Final browser pass, 390px and 1280px, light and dark: quote builder "From case" notice and prefill; case Next steps quote list and "Client can" select; laundry lane card actions (wrapping at 390px), Chase supplier dialog (disabled reasons, outcomes), Statistics tab tiles; Command Send reminder dialog; Lost and found Tell client send block, Property sort; Forms → Results and stats → Submissions table (62rem horizontal scroll at 390px), submission side panel (edit, media remove confirm, restore, history, report preview); classic cleaner page Table / Stock count controls with classic tokens; Live ops "Tell client".
- Email / SMS providers mocked only; no real message sent.


## Wave E with the database: People, Jobs, Calendar, Quality (2026-11-12)

Scope: effective-dated pay rates with one Pay editor, required documents per role, last seen for everyone, leave and days off, a real Cancel job with Restore, end-time-keeping day-view drops, QA template copies. Details: `docs/SYSTEM.md`, "Wave E with the database".

Migration `20261112120000_wave_e_people_jobs` (forward only, additive; `ALTER TYPE "JobStatus" ADD VALUE 'CANCELLED'` with nothing in the same migration writing or comparing it).
- Fresh database `wavee_fresh` (127.0.0.1:55439): `migrate deploy` → all 135 applied; repeated → "No pending migrations to apply"; `migrate diff --from-url … --to-schema-datamodel prisma/schema.prisma --exit-code` → "No difference detected", exit 0.
- Existing `sneek_ui`: checksums (row JSON minus the new columns and lastSeenAt) of User, Job, QaFormSubmission, JobAssignment, ClientInvoice, ClientInvoiceLine, Payout, PayrollRun, AuditLog identical before/after; repeat deploy no pending; diff empty, exit 0. That copy holds no rated users and no inspections, so the backfills were exercised on a seeded database: users with rates 34.5 / 40 got one BACKFILL row each effective 1970-01-01 (a user without a rate got none); an inspection before the first revision got the first revision's "before" schema with revision 0, one between revisions got the second's with revision 1, both RECONSTRUCTED; a user with a trusted device got lastSeenAt, the others stayed null. `npx prisma generate` run.

Job-status enumerations audited (root app; `app/`, `lib/`, `components/`; 218 files mention a job status). Decision per kind:
- Changed to leave CANCELLED out (or refuse it): invoice generator (`lib/billing/client-invoices.ts`, `NOT status CANCELLED`, also covers the time-logged and started-work branches); Jobs list where-builder default and "active" group (`lib/jobs/list-filters.ts`) and built-in tab counts (`lib/jobs/view-counts.ts`); calendar load (`lib/calendar/load.ts`, plus `url-state` "Cancelled" group, `presentation` chip category, `move-rules`); Live ops board (`lib/ops/live-board.ts`); daily briefing email (`lib/ops/daily-briefing.ts`); branch scorecards, schedule analytics and reschedule overlap count (`lib/phase4/analytics.ts`); commercial SLA breaches (`lib/phase3/commercial-sla.ts`); cleaner briefing day queries (`lib/briefing/cleaner-briefing.ts`); booking capacity (`lib/booking/requests.ts`) and public availability (`lib/public-site/availability.ts`); open rework de-duplication (`lib/qa/outcome-approvals.ts`, `lib/qa/rework-jobs.ts`, `lib/qa/admin-rework.ts`); geofence auto-pause (`lib/gps/departure-clockout.ts`); task carry-forward targets (`lib/job-tasks/service.ts`); iCal sync never updates or revives a cancelled job (`lib/ical/sync.ts`); classic dashboard queries and tone map (`app/admin/page.tsx`); plain status edits (`app/api/admin/jobs/[id]/route.ts`), bulk status (`lib/jobs/bulk-status-store.ts`) and the Jobs status dialog targets (`STATUS_CHANGE_TARGETS`); assign, bulk assign, auto-dispatch (`lib/ops/dispatch.ts`) and `applyReschedule` refuse a cancelled job.
- Extended (labels / tones / schemas): `lib/jobs/status-labels.ts` ("Cancelled"), `lib/jobs/status-presentation.ts`, calendar chip maps, `lib/calendar/types.ts` and `lib/jobs/peek-types.ts` (`leave` kind).
- Inclusion lists, kept (CANCELLED is outside them, so already excluded): payroll (`lib/finance/payroll.ts`, `lib/payroll/engine.ts`, `lib/phase4/payruns.ts`), cleaner invoices (`lib/cleaner/invoice.ts`), finance summary, Ready to bill and invoice stats, Quality/Insights clean basis (`lib/quality/where.ts` SUBMITTED_JOB_STATUSES), every reminder (`lib/ops/reminders.ts`, `cleaner-day-reminders`, `missed-clock-in-sweep`, `unfinished-reminders`, `lib/jobs/job-reminder.ts`), safety check-ins, stale en-route, tomorrow prep, live locations, accounts open assignments, board lanes (a cancelled job is in no lane), view presets, SLA case auto-resolve (a cancelled job is "not active", so its SLA case heals — intended), suggestion history.
- Cleaner-scoped queries (`app/api/cleaner/**`, `app/v2/cleaner/**`, `app/cleaner/**`, mobile APIs) exclude by `notIn [COMPLETED, INVOICED]` plus an active assignment: safe without edits because a cancel releases the assignments. `app/cleaner/**` is outside this step's paths and was not edited.
- Kept on purpose: property pending tasks (`app/api/admin/properties/[id]/pending-tasks`) still lists open tasks on a cancelled job so the office can move them; Command "status counts" (`lib/dashboard/command-glance.ts`, other engineer's path) lists each status including Cancelled; client portal job pages show the job as "Cancelled" (honest; no client notice is sent automatically); equality checks (`status === X`) are unaffected; recurring generation counts a cancelled job as existing, so it is not re-created.

Tests run (all pass):
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .` → clean.
- New: `tests/db/wave-e.test.ts` (7, PostgreSQL `wavee_fresh`, `--no-file-parallelism`), `tests/lib/wave-e-rules.test.ts` (14), `tests/lib/wave-e-session.test.ts` (3), `tests/lib/wave-e-cancel-notice.test.ts` (1), `tests/api/job-assignment-leave.test.ts` (3), end-time cases in `tests/lib/calendar-time-drop.test.ts`.
- Every existing test file referencing a touched module: 293 files, 3,223 passed, 9 skipped (DB-gated), 0 failed. DB-backed: wave-e, finance-decisions, money-wave-d, holiday-rates, client-invoice-started-jobs, schema, migration-retention, jobs-saved-views-store, property-care → 54 passed.
- Updated on purpose (behaviour changed): admin-user-pay, admin-users-bulk (history rows, Applies from), calendar-check-move and calendar-time-drop (end-time drops now move), jobs-route-filters, jobs-list-route-v2, jobs-saved-view-counts, jobs-view-presets, jobs-workspace-url (twelve statuses; cancelled out by default), cleaner-briefing-audience (CANCELLED in the day exclusion). Mock-only additions (`userPayRate`, `staffLeave`, audit `count`, `qaFormSubmission.findFirst`) in 15 test files.

Not run / not verified
- Production build, the full Vitest suite and browser checks (owner asked to save time). Final browser pass, 390px and 1280px, light and dark: person panel Pay (date input, history list, Remove), Leave and days off form, Documents "required" rows, Settings → Required documents (checkbox grid at 390px), Accounts "Never signed in" / "Not recorded yet"; Jobs row menu "Cancel job…", peek "Cancel job" (danger outline) and Restore block, bulk bar "Cancel job" (bar width at 390px), cancel dialog (focus trap, reason kept on error), job page cancelled notice and Danger tab; assign modal / quick assign / bulk assign "Assign anyway"; calendar "Leave" / "Day off" cells, Status "Cancelled" filter, struck-through cancelled chips, end-time drop confirmation text; QA amending notice with the template-copy line.
- No real message sent (notification pipeline mocked in tests).


## Office sends for operations managers; document request transport choice (2026-11-12, uncommitted step)

Scope: owner decisions A and B of 2026-11-12 (`docs/plans/admin-redesign-2026-11.md`, "Owner decisions, ninth set"). No Prisma schema change, no migration. Details: `docs/SYSTEM.md`, "Office sends for operations managers and the document request transport choice".

Changed
- A: Chase supplier (pack `laundry`), Message guest and lost-item Tell client (pack `lost-found`), client delay notice and clock pause (pack `jobs`) may be sent by an operations manager holding that pack at manage; ADMIN unchanged; refused while impersonating (also for administrators) and for revoked accounts. One rule (`lib/notifications/office-send-rules.ts`) checked on every send route and preview with the live session guard and live pack levels (`lib/notifications/office-send-permission.ts`). The three notifications-area send routes now belong to the page's pack in `opsRequestFeature`. Audit rows add `actorRole`; limits, cool-downs, idempotency, masking unchanged. UI shows Send by the same rule; Copy stays for everyone.
- B: Accounts "Request document" (Compliance board and a person's Documents section) and Command "Send reminder" share one Inbox / Email / SMS choice (multi-select, each disabled with the reason), "Don't ask again" per office user (AppSetting `office_send_transports_v1:<userId>`), a visible "Sending by: … · Change · Ask me again" line, and a reset in Notifications → Preferences ("Your sending choices", `GET`/`DELETE /api/me/send-transports`). Options: `GET /api/admin/workforce/document-request?userId=`; the reminder preview carries the same options. The route resolves transports: named → saved → inbox only.

Behaviour changed on purpose (for the owner)
- A `REQUEST_DOCUMENT` that names no transports and whose sender saved no choice now goes to the inbox only. Before, it also sent email (when the person had an address) and SMS (when they had a phone). The new dialogs always name their transports. The classic `/admin/workforce` hub's request form names none, so from there it is now inbox only (or the sender's saved choice). Automatic onboarding requests keep the old set.
- `REQUEST_DOCUMENT` without a document id is now refused while impersonating (the reminder path already was), so the request and the saved choice belong to the real person.

Existing behaviour changed on purpose, and the tests updated for it
- `tests/api/admin-client-delay-notice.test.ts`, `tests/api/admin-clock-pause.test.ts`, `tests/api/laundry-supplier-chase.test.ts`, `tests/api/lost-found-client-notice.test.ts`, `tests/api/lost-found-office.test.ts`, `tests/api/notifications-area-routes.test.ts`, `tests/components/lost-found-format.test.ts`: ADMIN-only assertions replaced by the pack rule (OPS with pack → allowed and audited with its role; OPS with the pack View only / Off → 403 with the reason; revoked → 401; impersonated → 403).
- `tests/components/live-ops-follow-up.test.tsx`: the workspace takes `canNotifyClient` / `canPauseClock` instead of `canAdminister`.
- `tests/api/document-reminder.test.ts`: the plain request without transports is inbox only; explicit transports case added; preview carries `options`.

Checks run
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .` → no errors.
- New: `tests/lib/office-send-rules.test.ts` (10), `tests/api/document-request-transports.test.ts` (8), `tests/components/document-request-dialog.test.tsx` (7).
- Every existing test file covering the touched code (45 files incl. the notification catalog, notifications area, ops middleware / policy, work queue, Command, live ops, lost and found, laundry nudges, accounts person panel) → 398 passed. ESLint on the new and changed files → clean.

Not run / not verified
- Production build, full Vitest suite and browser checks (not requested in this step). Browser pass, 390px and 1280px, light and dark: Request document dialog from Compliance and from the person panel (choices, reasons, Don't ask again, Sending by line, Change / Ask me again, results list), Command Send reminder with a saved choice, Notifications → Preferences "Your sending choices", Live ops as an operations manager with and without the Jobs pack, Lost and found Send as a manager with the pack, Laundry Chase supplier Send as a manager with the pack.
- Providers mocked; no real message sent.


## Wave F: urgent stock, lost and found, Wave E database leftovers (2026-11-12, uncommitted step)

Scope: Stock tabs as drawn; "Add to shopping run" and "Ask cleaner to buy" on urgent needs; the job on a need; operations managers on urgent stock by their inventory pack; lost items still New after 14 days; Cases "Add charge to invoice"; laundry planned pickup / drop clock times; stock count answers setting on-hand through count observations. Details: `docs/SYSTEM.md`, "Wave F: urgent stock shopping runs and buy asks …". Designs used: `Stock.dc.html`, `LostFound.dc.html`, `Cases.dc.html`, `Laundry.dc.html` from the session's design folder.

Migration `20261112180000_wave_f_stock_cases_laundry` (forward only, additive: nullable columns, two new tables, two CHECK constraints, one backfill that fills only empty columns).
- Fresh `wavef_fresh` (127.0.0.1:55439): `migrate deploy` → all 135 applied (134 earlier + this one); repeated → "No pending migrations to apply"; `migrate diff --from-url … --to-schema-datamodel prisma/schema.prisma --exit-code` → "No difference detected" (exit 0).
- Existing `sneek_ui`: status showed only this migration pending; checksums (row text, new columns excluded) of UrgentStockNeed, UrgentStockEvent, ClientInvoice, ClientInvoiceLine, LaundryTask, PropertyStock, StockTx, ShoppingRun, ShoppingRunLine, IssueTicket, FormSubmission, Job identical before and after; repeat deploy no pending; diff exit 0. (`sneek_ui` holds few rows: 1 job, 1 laundry task, 25 stock rows, 1 shopping run.)
- Backfill checked on `wavef_backfill` (migrated to Wave E, fixtures inserted, then Wave F applied): a form-raised need with a matching submission, property and reporter got its job and submission; a wrong reporter, a wrong property and a manual report stayed null.
- `npx prisma generate` run.

Tests run:
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .` → clean. ESLint on the new and changed Wave F files → clean.
- New: `tests/db/wave-f.test.ts` (9) and `tests/db/wave-f-case-charge.test.ts` (3) on `wavef_fresh`, `--no-file-parallelism`; `tests/lib/wave-f-rules.test.ts` (12); `tests/components/wave-f-ui.test.tsx` (3); `tests/api/wave-f-routes.test.ts` (3); new cases in `tests/lib/notification-office-sends.test.ts` (inbox-only send) and `tests/lib/notification-entity-scope.test.ts` (ask scope).
- DB-backed existing suites with the new ones: urgent-stock, stay-preparation, lost-found, lost-found-property-sort, finance-decisions, money-wave-d, client-invoice-started-jobs, wave-e, schema, notification-intents, ops-permissions, three laundry suites → 16 files, 87 passed.
- Every non-DB test file referencing a touched module (162 files, incl. the notification catalog) → 1,715 passed, 1 failed: `tests/lib/client-invoice-editor-rules.test.ts` ("mark-sent" in the editor menu), which comes from another engineer's uncommitted invoice "Mark as sent" change in the tree (`invoice-model.ts`, `client-invoice-patch.ts` audit, and that test file itself are being edited); not a Wave F path.
- Updated on purpose (behaviour changed): `urgent-needs-table` (an acknowledged need offers "Add to shopping run", as drawn), `admin-attention-urgent` and `urgent-stock-office` (operations managers with the pack get the badge and the redirect), `cleaner-submit-form-effects` (count observations recorded in the submit transaction), `rotation-completion` / `rotation-monthly` fixtures (approval now also applies count observations).

Design comparison (Urgent stock and Lost and found). Matched: header, summary ("… must arrive before the next clean", with the real 48-hour window stated), tab names and order, stage chips with counts, Property filter, columns, "Reported by … during job …", row Next action incl. "Add to shopping run", bulk bar with "Add to one shopping run", panel subtitle "needed before Thu 10:00", stage bar, Counted / Par / Suggested / Reported by, actions Acknowledge / Add to shopping run / Ask cleaner to buy. Kept different, with reasons: search box and the extra tabs (On-hand, Scan tasks, Suppliers) stay (functions in use); the panel keeps Requested, Shopping run and Cleaner asked rows and Confirm at property / Resolve (real states the drawing omits); Stay preparation stays a lazy disclosure (secondary tool rule) rather than inline text; history has no "Office notified" line (the inbox notice is not stored as a need event); "Reported by client" cannot occur (clients have no urgent report path). Lost and found: the drawing has no New-age chip; one was added as asked, and the summary appends "· N still new after 14 days" only when there are some.

Not run / not verified
- Production build, the full Vitest suite and browser checks (not requested). Browser pass needed at 390px and 1280px, light and dark: Urgent needs tabs, Add to shopping run dialog (radio list, quantities, results), Ask cleaner dialog (cleaner select, transports, outcome list), Withdraw ask, need panel rows; cleaner job screen "Can you buy these?" and Supplies → Shopping; Stock counts → Counts from job forms (table overflow at 390px); Cases "Add charge to invoice" dialog and charge list; laundry "Set planned times" form in the run panel and card text; Lost and found chip, badge and panel note.
- No real message sent (pipeline and providers mocked in tests). Deployment not done.

## Parity audit fixes (2026-11-12, uncommitted step)

Scope: restore functions lost in the admin redesign (baseline `1fb4077`): invoice "Mark as sent (not emailed)" and "Group by property" saving the order; Quality rating mix, "Mgmt review queue" and the review queue counters; laundry team metrics for quality-pack viewers; Accounts KPI strip; `/urgent-stock` for operations managers (already done by Wave F); dead accountability notification links. Details: `docs/SYSTEM.md`, "Parity audit fixes: functions restored after the admin redesign". No schema change, no migration.

Tests run:
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .` → clean.
- New: `tests/lib/invoice-mark-sent.test.ts` (4), `tests/api/quality-parity-audit.test.ts` (7), `tests/components/approvals-queue-deep-link.test.tsx` (2), `tests/lib/accounts-overview-kpis.test.ts` (2); new cases in `invoice-editor-page` (3), `invoice-row-actions` (2), `quality-hub-service` (4), `quality-hub-actions` (7), `quality-hub-page-access` (1), `accounts-hub` (2).
- `tests/db/invoice-mark-sent.test.ts` (2), `tests/db/finance-decisions.test.ts` and `tests/db/money-wave-d.test.ts` on my own fresh disposable database `parity_fresh` (127.0.0.1:55439, `prisma migrate deploy` from empty, dropped afterwards) → 13 passed.
- Every non-DB test file referencing a touched module (75 files: invoices, quality, accounts, approvals, notifications, ops catalog, urgent stock) → 766 passed after updating fixtures on purpose (exact action lists now include `mark-sent`; summary and cleaner fixtures carry `managementReview` and `ratingMix`).

Not run / not verified
- Production build, the full Vitest suite and browser checks (not requested in this step). Browser pass needed at 390px and 1280px, light and dark: invoice row menu and editor menu "Mark as sent (not emailed)" dialog (refusal shown in the dialog), "Group by property" on a draft and a sent invoice; Quality six stat cards (grid at 390px / 1280px), the expanded cleaner row's rating mix, Review queue counters, "Laundry team and suppliers" disclosure (keyboard, table overflow at 390px); Approvals opened from the card; Accounts KPI strip.
- No real message sent; deployment not done.

## Owner decisions: urgent stock rights, need-opened notice, applied stock counts on reset (2026-11-12, uncommitted step)

Scope: owner's tenth set (`docs/plans/admin-redesign-2026-11.md`): (1) operations managers with the inventory pack at manage may Resolve, bulk Close and change the urgent-stock reminder settings; (2) the "urgent need opened" inbox notice also reaches operations managers with the pack; (3) resetting a job whose form's stock counts were applied asks the office to reverse or keep them; (4) lost items still New stay a separate count (no change). Details: `docs/SYSTEM.md`, "Owner decisions: urgent stock rights, need-opened notice, applied stock counts on reset". No Prisma schema change, no migration (`prisma/` untouched; `migrate diff --from-url <fresh db> --to-schema-datamodel prisma/schema.prisma --exit-code` → "No difference detected").

Tests run:
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .` → clean. ESLint on the changed files → no errors (one pre-existing warning in `job-reset-dialog.tsx`).
- DB-backed, on my own fresh disposable database `sneek_decisions_1794454185` (127.0.0.1:55439, `prisma migrate deploy` from empty), `--no-file-parallelism`: new `tests/db/owner-decisions-stock.test.ts` (13) with `urgent-stock`, `wave-f`, `stay-preparation`, `notification-intents` → 5 files, 45 passed.
- New non-DB: `tests/lib/stock-count-reset-rules.test.ts` (5), `tests/components/stock-count-reset-dialog.test.tsx` (3), `tests/components/qa-reset-stock-count-choice.test.tsx` (1), `tests/components/urgent-office-manage-controls.test.tsx` (2); new cases in `tests/lib/notification-entity-scope.test.ts` (3) and `tests/lib/jobs-bulk-status.test.ts` (1).
- Every existing non-DB test file covering touched code (urgent stock service, policy, actions, routes and UI; job reset, QA reset, job PATCH and bulk status; QA submit, admin QA score, photo review, authority; notification scopes, office sends, catalog; rotation) plus the new ones → 43 files, 422 passed. Notification catalog test passes.
- Changed on purpose: `tests/db/wave-f.test.ts` (a manager with manage now resolves; was refused), `tests/lib/urgent-stock-policy.test.ts` and `tests/lib/urgent-stock-actions.test.ts` (policy parameter `isAdmin` renamed `mayResolve`, same assertions). Fixtures given an empty stock-count reader (the new query; no assertion weakened): `tests/api/qa-reset-financial-guard.test.ts`, `tests/lib/jobs-bulk-status.test.ts`.

Rules added / changed (for the owner)
- Resolve, bulk Close, reminder settings: ADMIN, or OPS_MANAGER with the inventory pack at manage; read refused; target's rights while impersonated; audit records role (and the impersonating administrator).
- "Urgent need opened": admins and managers with inventory read or manage, one inbox notice each, pack re-checked at dispatch, preferences respected. Reminders unchanged (administrators only).
- A reset that takes an approved job out of Completed with applied counts requires "Reverse" or "Keep" (Reset job, QA reset, job status edit: 409 naming the counts); bulk status refuses those jobs; QA verdicts keep the counts and record that no choice was made. Reversal only without a newer stock record; nothing deleted; a reversed count is not re-applied.

Not run / not verified
- Production build, the full Vitest suite and browser checks (not requested). Browser pass needed at 390px and 1280px, light and dark: Reset job dialog with applied counts (table overflow at 390px, radio group keyboard and focus, Reset disabled until chosen, 409 re-ask), QA reset dialog on the classic job page (Radix dialog, table, radios), Stock → Urgent needs as an operations manager with manage (Reminder settings button, panel Resolve, bulk Close) and with read (none of them), Counts from job forms "Reversed when the job was reset"; the job edit form's toast for the 409 (long message).
- No real message sent (inbox delivery exercised against the test database only). Deployment not done.

## Owner reports: lost and found photos, laundry partners as suppliers, laundry team requests, account email resends (2026-11-12, uncommitted step)

Scope: the owner's four reports (`docs/SYSTEM.md` section of the same name). Migration `20261112210000_laundry_partner_links` (additive, nullable: `LaundrySupplier.stockSupplierId` unique, `User.laundrySupplierId` FK SET NULL + index).

Root causes and fixes
- A, lost and found images: stored links are `S3_PUBLIC_BASE_URL/<key>`; the app otherwise signs private-bucket keys on demand. The redesign's fallback (`/api/uploads/access`) refuses cleaners (job-scoped keys only) and non-office roles, and the cleaner gallery and Log item preview had no fallback. Now `GET /api/lost-found/[id]/photo?key=` (item access re-checked, key must be the item's own) redirects to a 10-minute signed link everywhere a lost item photo is shown, with "Image could not be loaded" + Retry when it fails. Could not reproduce against production storage (no credentials here; the seeded DB has no lost-found photos).
- B: laundry partners listed in Inventory › Suppliers (read model, edit/link/team from the list, runs link); laundry users linked to a partner by `User.laundrySupplierId`.
- C: pickup / drop-off / return / photo requests address the run's partner team through new scope `LAUNDRY_TASK_SUPPLIER_TEAM` (queue + dispatch), catalog `laundry.team_request`; cleaners asked only about the bags; disabled with reason + Chase supplier when no portal users; laundry portal "Requests from the office".
- D: Account emails section and routes (invitation link, password reset link, sign-up code; fresh token, 5-minute cool-down, audit with provider state, Copy invitation link); sender rules ADMIN / OPS_MANAGER with Staff accounts at manage, never impersonating, never to a higher role.
- Pre-existing, fixed with tests: "Resend invite" sent a sign-up code to people invited by link (useless to them) and let an OPS_MANAGER resend to an ADMIN without a pack check; forgot password had no rate limit and put the person's name unescaped into the email HTML; the laundry supplier chase draft for "no portal users" did not exist.

Tests run
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .` → clean. ESLint on every changed source file → no errors, no warnings.
- Migration: `prisma migrate deploy` on a fresh database `sneek_mig_fresh` (136 applied), on an existing migrated copy `sneek_mig_base` and on `sneek_ui` (1 applied each), repeated on all three → "No pending migrations"; `prisma migrate diff --from-url <db> --to-schema-datamodel prisma/schema.prisma --exit-code` → 0 on all three.
- DB-backed on my own fresh database `sneek_owner_reports_1` (127.0.0.1:55439), `--no-file-parallelism`: new `tests/db/laundry-partners.test.ts` (4) with `lost-found`, `lost-found-property-sort`, `owner-decisions-stock`, `wave-e`, `wave-f`, `laundry-quantity-pickup`, `laundry-failed-pickup`, `laundry-early-evidence` → 9 files, 59 passed.
- New non-DB: `tests/api/lost-found-photo-route.test.ts` (8), `tests/components/lost-found-photo.test.tsx` (3), `tests/lib/laundry-team-requests.test.ts` (6), `tests/lib/laundry-partner-directory.test.ts` (3), `tests/components/estate-suppliers-laundry-partners.test.tsx` (3), `tests/api/account-emails.test.ts` (11), `tests/components/account-emails-section.test.tsx` (2); new cases in `laundry-dashboard` (2), `admin-users-bulk` (1).
- Every non-DB test file covering touched code plus `tests/lib/server-client-value-imports.test.ts` → 40 files, 393 passed.
- Changed on purpose (owner's business change, not weakened): `tests/lib/laundry-nudges.test.ts` and `tests/components/office-actions-ui.test.tsx` (an overdue pickup the cleaner marked ready and the missing drop photo now go to the laundry team, not the cleaner; dialog button reads "Send request"), `tests/components/wave-f-ui.test.tsx` ("Driver Tom" → "Laundry team · Tom" / "<partner> · Tom"), `tests/api/admin-users-bulk.test.ts` (resend now answers "Sign-up code sent." and refuses an administrator for a manager), `tests/components/accounts-hub.test.tsx` (bulk button "Resend invitation"), `tests/lib/office-send-rules.test.ts` (new `account_email` → accounts). Fixtures given the new reads: `laundry-supplier-chase` (empty partner team), `laundry-dashboard` (empty request audit).

What the owner must check in production (A)
- Settings › Integrations / environment: `S3_BUCKET_NAME` (or the saved bucket), `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (or saved keys) and `S3_ENDPOINT` must be able to sign GET for keys under `lost-found/`. If the photo route answers 503 `STORAGE_UNAVAILABLE` (visible in the browser network tab as the image request), storage is not configured for signing.
- Uploads from the office "Log item" dialog go through `/api/uploads/direct`, which writes with the ENVIRONMENT S3 client and bucket, while signing prefers credentials saved in Settings › Integrations. If Settings holds a different bucket or account than the environment, those photos are in the env bucket and signed reads point at the other one. Not changed here (it would move where new uploads go); check that both point to the same bucket, or ask for the direct-upload route to use the settings-first client.
- The bucket's CORS is not involved (plain image GETs), and the page CSP already allows `https:` images.

Not made real / risks
- The laundry team answers "when will it be back?" has no reply field in the portal; the team answers by doing the run's existing actions (or the office uses Chase supplier). The Queue has no deep link to one run; "Answer on the Queue" opens the board.
- Laundry team requests use the cleaner nudge's gate (ADMIN and OPS_MANAGER), not the Laundry pack at manage (Chase supplier's gate). Report rather than change: making them pack-gated would change access.
- Temporary-password emails are not resendable by design (the reset link replaces them). VA invitations and document requests keep their own resend paths. Self-service sign-in and two-step codes are not listed in the history.
- Existing people who should be on a partner's team must be linked once in Inventory › Suppliers › Edit partner; until then every team request is disabled with the reason and Chase supplier is offered.
- Browser pass needed at 390px and 1280px, light and dark: Lost and found table thumbnails and item panel (failure tile with Retry, lightbox failure), cleaner item detail thumbnails; Inventory › Suppliers table overflow at 390px and the partner editor (team list scroll, disabled linked options); Laundry lane cards with a disabled team button plus reason and Chase supplier (wrapping), run panel facts; laundry portal Today "Requests from the office"; Accounts person Activity tab "Account emails" (confirm block, result, history wrapping of long addresses), bulk "Resend invitation".
- Production build and the full suite not run (as instructed). No real message sent (providers mocked). Deployment not done.

## Properties list and property page redesign (2026-11-12)

Scope: the approved boards "Properties" and "Property full page" (`docs/SYSTEM.md`, "Properties list and property page redesign (2026-11-12)"). No schema change, no migration. Uncommitted at the time of writing (the lead checkpoint-commits).

What changed
- List: `app/v2/admin/properties/page.tsx` + `components/v2/admin/properties/list/*`; `GET /api/admin/properties?shape=list`, `GET /api/admin/properties/export`, `POST /api/admin/properties/bulk`, `GET /api/admin/properties/:id/preview`; services `lib/properties/portfolio-*.ts`, `bulk*.ts`, `laundry-team.ts`, `form-overrides.ts` (extracted from the form-overrides route, behaviour unchanged), `preview*.ts`, `links.ts`. `properties-portfolio.tsx` deleted (no other importer).
- Property page: `property-detail.tsx` (orchestrator) + `detail/*`; `GET /api/admin/properties/:id/overview` with `lib/properties/coming-up.ts`, `documents.ts`, `overview.ts`, `detail-tabs.ts`.
- Fixed on the way: notes could not be cleared (empty notes were sent as "absent"); the door code field only showed a legacy plaintext copy, never the encrypted one (now read from and written to the encrypted column); a save that touched accessInfo could drop a legacy plaintext code that existed nowhere else (the laundry, documents and bulk paths now carry it into the encrypted column).

Tests run
- New: `tests/lib/property-portfolio-rules.test.ts`, `tests/lib/property-coming-up.test.ts` (incl. documents), `tests/lib/property-deep-links.test.ts`, `tests/api/properties-portfolio.test.ts` (list totals/chips/stats/paging, unknown sort and chip → 400, 401, legacy array shape unchanged, owing omitted without finance), `tests/api/properties-bulk.test.ts` (per-row outcomes for all three actions, merge not rebuild, legacy code carried, invalid account / template refused, 20-property sync cap, 403 and malformed body).
- Updated on purpose (labels as drawn, not weakened): `tests/components/property-pending-task-safety.test.tsx` — tabs are now `role="tab"` named "Checklist and forms" / "Jobs and history"; deep-clean planning is asserted on "Care and planning" where it moved; the heading is found by role because the name now also shows in the Details card.
- Existing files covering touched code, plus `tests/lib/server-client-value-imports.test.ts`: property deep-clean planning, cadence ledger, checklist profile save, audit operating UI, navigation memory, checklist-profile safety, property task safety, iCal dispatch paths, live session gates, authorized operations, property jobs rollup, deep-clean planning API/page, property cadence ledger API, calendar workspace, audit route role, ops middleware — all pass.
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .`: clean (final run). ESLint on every file I changed: no errors. 21 test files, 160 tests pass.
- Not run (as instructed): production build, full suite, browser pass.

Not made real / risks
- Documents and additional details is shown only when the property already has access files or intake answers; "Add file" therefore cannot add a first file to a property that has none (the board's card would otherwise be an empty promise). Uploaded files go to the access files list (last write wins if two people add at once).
- Map view stays the count plus the ops map link: no embedded map exists in the admin.
- Lifetime value and average rating come from the existing stats endpoint and are shown to operations managers as before (no finance gate there); only the new "owing" figure is finance-gated.
- The list reads the whole active portfolio per request (as the old page did); fine at today's size, would need stored sort keys at several thousand properties.
- Browser pass needed at 390px and 1280px, light and dark: list table overflow, chip row wrap, filter popovers, bulk bar and dialogs, preview panel as a sheet, property header actions, key facts wrap, tab bar scroll, Coming up table scroll, card edit forms and the rail stacking under the main column.

## Admin job page "Job full view" (2026-11-12)

Scope: the approved boards "Job full view" (`Main.dc.html`) and "Job page in four states" (`JobDetailStates.dc.html`); details in `docs/SYSTEM.md`, "Admin job page: "Job full view" redesign (2026-11-12)". No schema change, no migration, no new route or permission. Uncommitted at the time of writing.

What changed
- `app/v2/admin/jobs/[id]/page.tsx` rewritten to compose; rules in `lib/jobs/job-page/*`; components in `components/v2/admin/jobs/detail/*`.
- Shared/touched: `ERowMenu` (optional `heading`, `badge`, `footnote`, `triggerVariant`, `openSignal`; existing callers unchanged), `JobManagePanel` (new `template` section; the `danger` section removed, its Reset/Delete now in the header menu), `RestoreJobControl` (logic moved into `useRestoreJob` + `RestoreJobConflicts`; peek panel unchanged), `JobReminderButton` (controllable), `QuickQaReview` (`intent`, `triggerLabel`, `disabledReason`; empty score refused). `job-cancel-section.tsx` deleted (only the old page used it).
- Fixed: $0 pay for a cleaner without a rate or hours; Delete refreshed a deleted job (404); encrypted access/alarm codes and `accessInfo` were serialised to the browser; hard-coded timezone for history and briefing proof; guest check-in formatted in the server's timezone.

Tests run
- New: `tests/lib/job-page-actions.test.ts` (status → primary table over every status, secondary buttons, reminder rule, badge, More menu groups and disabled reasons incl. invoiced cancel, started-job cancel for an operations manager, view-only, cancelled menu), `tests/lib/job-page-deep-link.test.ts` (every old tab, `?view=` precedence, `#chat`), `tests/lib/job-page-timeline.test.ts` (timeline per state, stage bar, blockers), `tests/lib/job-page-money.test.ts` (unknown, estimate, locked, rate-card sources; key facts), `tests/components/job-header-actions.test.tsx` (header per state, menu headings/reasons/footnote, dialogs open, arrival opens Reschedule or the menu, restore conflicts and retry), `tests/components/job-disclosure.test.tsx` (lazy mount, draft kept, opens from hash).
- Existing, passing: `tests/lib/job-detail-tabs.test.ts`, `tests/lib/server-client-value-imports.test.ts`, `tests/lib/jobs-invoiced-rule.test.ts`, `tests/components/job-manage-save-safety.test.tsx`, `job-peek-panel`, `estate-data-table`, `admin-job-row`, `draft-evidence-review`, `photo-review-panel`, `job-extras-save-messaging`, `stock-count-reset-dialog`, `assign-reassign-note`, `office-actions-ui`, `audit-operating-ui`, `audit-media-access`, `legacy-cleaner-draft-boundary`, `cleaner-job-workspace-page`, `live-ops-follow-up`.
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .`: no errors.
- Not run (as instructed): production build, full suite, browser pass.

Differences from the boards and risks: listed in the plan's status block (`docs/plans/admin-redesign-2026-11.md`, "Job full view").

## Cleaner portal redesign (2026-11-12)

Scope: approved boards "Cleaner portal" (`CleanerPortal.dc.html`) and "One job, four moments" (`CleanerJobFlow.dc.html`); details in `docs/SYSTEM.md`, "Cleaner portal redesign: five tabs, Today, Supplies, Pay, More and the job screen (2026-11-12)". No schema change, no migration, no API route added or changed. Uncommitted at the time of writing.

What changed
- Navigation: `components/v2/cleaner/portal/*` (nav lists, tab badges, More menu, segment tabs, ask-count hook); `app/v2/cleaner/layout.tsx`; `app/v2/cleaner/more/page.tsx` (menu instead of redirect); `lib/navigation/mobile-tabs.ts` (cleaner row); `components/v2/portal/portal-shell.tsx` (optional `mobileOnly`, `tabActivePrefixes`, `immersive`, `hideMobileMenuButton`; other portals unchanged).
- Screens: Today (`app/v2/cleaner/page.tsx`, `components/v2/cleaner/today/today-cards.tsx`, `lib/cleaner/today-view.ts`), Supplies (`app/v2/cleaner/supplies/page.tsx`, `components/v2/cleaner/supplies/*`, `lib/cleaner/supplies-view.ts`), Pay (`app/v2/cleaner/pay/page.tsx`, `components/v2/cleaner/pay/*`, `lib/cleaner/pay-view.ts`; `/invoices` and `/pay-requests` now redirect), Jobs/Calendar List / Month switch, Team hub `?tab=` deep link.
- Job screen (presentation only): `job-header.tsx`, `stage-nav.tsx`, `stage-footer.tsx` (sticky bar, Set up clock-in placement), `stage-wrapup.tsx` split into `laundry-handoff.tsx`, `submit-blockers.tsx`, `submitted-summary.tsx`; `action-fab.tsx` (urgent stock row, board order and labels, 44px targets); `parts.tsx` (`ClockCard.showClockIn`); `job-workspace.tsx` composition only (rail under the header, back link moved into the header, offline banner wording, workflow strip removed).

Tests run
- New: `tests/components/cleaner-portal-redesign.test.tsx` (tab destinations and order, every former destination has a home, immersive path, tab badges, More menu completeness and role filtering, Today clock card states, summary wording, Before you submit jump links and on-phone separation, clock-in reasons, supplies legacy tabs and module refusal, pay lines adding up, guest countdown).
- Changed: `tests/components/cleaner-shift-home.test.tsx` — two label assertions only: the summary line now reads "1 accepted job today · 2 offers waiting" (drawn wording), and the removed stat tiles' "Unavailable" ×3 is replaced by the honest "Your shift could not be loaded." summary.
- Existing, passing unchanged: `job-workspace-draft-lifecycle` (52), `wrapup-preflight`, `portal-shell`, `portal-navigation`, `cleaner-calendar-page`, `server-client-value-imports` and every other non-database test file naming the cleaner portal, job workspace, drafts, offline, clock, laundry status or purchase asks (301 files run together; the only failures were `tests/api/admin-invoices-bulk.test.ts` and `tests/lib/ops-notification-producers.test.ts`, both in other engineers' in-progress admin invoice and notification work, not touched here).
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .`: no errors in cleaner/portal paths (3 errors remain in others' files: `clients-columns.tsx`, `wording/template.ts`, `portfolio-facts.ts`).
- Not run (as instructed): production build, full suite, database suites, browser pass at 390/1280 light/dark.

## Access and permissions redesign (2026-11-12)

Scope: Settings › Access and permissions (board "Access and permissions"), the per-person access model, the capability catalog and evaluator, delegated administrator capabilities (owner decision 2026-11-12), client assistant teams on this screen. No schema change, no migration (the existing `ops_feature_permissions_v1` JSON store holds levels incl. Full, per-person capability switches and grants, with its revision guard).

- Model: `lib/rbac/ops-policy.ts` (levels `off|read|manage|full`, `capabilities`, preset `audience`), `lib/rbac/capabilities.ts` (catalog with enforcement points), `lib/rbac/access-evaluator.ts` (single evaluator, `accessWithin`), `lib/rbac/can.ts`, `lib/rbac/delegated-admin.ts`, `lib/rbac/delegated-edit.ts`, `lib/rbac/access-diff.ts`, `lib/rbac/access-draft.ts`, `lib/rbac/access-plain-language.ts`, `lib/rbac/access-directory.ts`, `lib/rbac/access-screen-types.ts`, `lib/rbac/invoice-capabilities.ts`, `lib/rbac/capability-http.ts`.
- Enforcement points changed (one evaluator call each): invoice PATCH/bulk/send/credit-note, job cancel, message composer send, `officeSendDecision`, `urgentOfficeAllowed`, `verifySensitiveAction`, reset-password and disable-2fa routes, impersonate and test-as unlock routes, `resolveImpersonation`, Test as page, `enforceOpsRequest`, middleware page check (`opsGrants`), validate-session and retained validate.
- UI: `components/v2/admin/settings/access/*`, page `app/v2/admin/settings/access/page.tsx`; settings catalog entry `roles` now opens it; removed `ops-permissions-section.tsx`, `roles-section.tsx` (and the base role reference table).
- Tests (new): `tests/lib/access-parity.test.ts` (19), `tests/lib/access-evaluator.test.ts` (14), `tests/lib/delegated-guardrails.test.ts` (11), `tests/api/ops-permissions-route.test.ts` (8), `tests/api/delegated-admin-routes.test.ts` (5), `tests/components/access-permissions.test.tsx` (8, replaces `tests/components/ops-permissions.test.tsx`), `tests/db/access-permissions.test.ts` (2, run on a disposable `perms_fresh` database at 127.0.0.1:55439).
- Tests changed (mocks only, assertions unchanged): the office-send route tests, `admin-users-bulk`, `admin-invoices-bulk` (add `getOpsPolicy` to the `ops-access` mock: the shared evaluator reads the live policy); `admin-user-guards`, `started-work-financial-boundary` (mocked session now states role ADMIN, since the reset routes admit OPS_MANAGER to their guard and the send route asks the evaluator).
- Known unrelated failure: `tests/api/notifications-area-routes.test.ts` "send test to me" (2 tests) fails with or without this change; the route is being edited by another engineer.
- Not run (as instructed): production build, full suite, browser pass at 390/1280 light/dark.

## People directory, client page, person page, client assistants, account emails (2026-11-12)

Scope: approved boards People (`PeopleDirectory.dc.html`), Client (`ClientDetail.dc.html`), Cleaner (`CleanerDetail.dc.html`), Client assistants (`AssistantWorkspace.dc.html`), Account emails (`Invitations.dc.html`); details in `docs/SYSTEM.md`, "People: clients and cleaners in one directory". No schema change, no migration.

What changed
- People page: `app/v2/admin/accounts/page.tsx`, `components/v2/admin/people/*` (directory, tabs, account-list tab, clients, invitations, assistants, suppliers section, fact strip, read hook, formatting), `lib/people/*` (tabs, counts, cleaner figures, clients list/summary/bulk/page data, account emails list, assistant teams).
- New routes: `GET /api/admin/clients/directory`, `POST /api/admin/clients/bulk`, `GET /api/admin/clients/[id]/summary`, `GET /api/admin/users/account-emails`, `GET /api/admin/va-teams`. All `requireRole([ADMIN, OPS_MANAGER])`; middleware packs by path (clients pack for `/api/admin/clients/*` and `/api/admin/va-teams`, accounts pack for `/api/admin/users/*`).
- Account list: `lib/accounts/list/{types,derive,service,tabs}.ts` (Jobs this week, Owed, office includes Maintenance, partners = Laundry, `logins` alias); `accounts-columns.tsx`, `accounts-view.ts`, `accounts-url.ts` (People writes its own tab value); `lib/accounts/viewer.ts` (`canSeeClients`, `canSeeWorkforce`, `canOpenPeople`, person `canMessageStaff`).
- Client page: `app/v2/admin/clients/[id]/page.tsx`, `components/v2/admin/people/client-page/*`, `ClientActions` `renderTrigger` prop. Person page: `person-full-page.tsx`, `person-actions.tsx` (`personItems`, `hideTestAs`), `components/v2/admin/people/person-page/*`.
- Redirects: `app/v2/admin/{clients,cleaners,workforce,users}/page.tsx`.

Tests run
- New: `tests/lib/people-rules.test.ts` (18: tabs and old links, redirect targets with query strings, client filters/sorts/paging/figures/money gating/CSV, account email next step and permission rules incl. upward and impersonation refusals, URL state), `tests/api/people-routes.test.ts` (11: redirects with query strings and no-lockout, directory paging/400/403/CSV ids, bulk PIN and grant, per-client outcomes, account emails route), `tests/components/people-directory.test.tsx` (8: one h1, tabs and counts, Clients columns/figures/Not recorded, chip → server filter, bulk bar, clients-pack gating, account emails states, team panel never-allowed rule, admin-only edit, failed save keeps the draft).
- DB (`SNEEK_TEST_DATABASE_URL=postgresql://sneek@127.0.0.1:55439/sneek_people_1112`, fresh and migrated, `--no-file-parallelism`): `tests/db/people-directory.test.ts` (5: client money by Finance rules incl. credit note and overdue, summary invoices/rates/teams, account emails from audit rows and invitations, assistant member states, Jobs this week / Owed with pay gating) and `tests/db/wave-e.test.ts` (7) pass.
- Changed: `tests/lib/accounts-list-rules.test.ts` (office role filter now includes Maintenance; partners has none), `tests/components/accounts-hub.test.tsx` (tab label "Office and other staff 5"). Existing passing: `admin-users-list`, `accounts-person-panel`, `office-actions-ui`, `wave-e-rules`, `finance-decisions-rules`, `server-client-value-imports`.
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .`: no errors in People paths (errors remain only in others' files: `lib/jobs/job-page/*`, `app/v2/admin/jobs/[id]/page.tsx`, `lib/properties/portfolio-facts.ts`, `lib/rbac/ops-catalog.ts`).
- Not run (as instructed): production build, full suite, browser pass at 390/1280 light/dark.
- People tabs (addition): `/v2/admin/accounts?tab=clients` → clients pack, `?tab=cleaners` → workforce pack (`PEOPLE_TAB_FEATURES`, `opsNavigationHref`); tests `tests/lib/people-tab-routing.test.ts` (4). Open issues on the page itself (owned by the People engineer): the server page loads staff birthdays, role counts, the active-client list and shows all tabs to any viewer who reaches it; the Cleaners tab lists through `/api/admin/users` (accounts pack), so a workforce-only manager gets a refused list. Separate Clients/Cleaners/Workforce nav entries should stay until those are fixed.
- People per-pack fix (follow-up): page gates tabs and skips Staff-accounts reads without that pack; workforce Cleaners list route `GET /api/admin/people/cleaners` (+ `/export`) forces cleaners; old Clients/Cleaners/Workforce pages redirect for their pack; their nav entries removed (Coaching kept). Tests: `tests/api/people-pack-access.test.ts` (8), `tests/lib/people-tab-routing.test.ts` (5); `tests/api/people-routes.test.ts` "keeps the old list" case updated to the new rule (clients-pack manager now redirected; old list kept for a viewer People does not admit).

## Notification types and wording (2026-11-12)

- Scope: `/v2/admin/notifications` "Types and wording" as drawn (`NotificationTemplates.dc.html`); wording layer `lib/notifications/wording/**`; routes `app/api/admin/notifications/wording/**`; test send `lib/notifications/test-send.ts` and `app/api/admin/notifications/catalog/test/route.ts`. No schema change.
- Senders moved to the one render function (smallest targeted edits, wording unchanged without an override): `lib/jobs/cancel-notice.ts`, `lib/jobs/job-reminder.ts`, `lib/ops/reminders.ts` (2-hour SMS), `lib/ops/unfinished-reminders.ts`, `lib/ops/cleaner-day-reminders.ts`, `lib/laundry/failed-pickup.ts`, `lib/notifications/office-actions.ts`, `lib/notifications/client-delay-preview.ts`, `lib/inventory/urgent-stock-ask-notify.ts`, `lib/workforce/document-request-send.ts`.
- Behaviour notes: the cleaner day-reminder email now HTML-escapes property name, address and timing notes (it did not before; identical output for ordinary text). Send test to me now carries the type's live wording with sample data (subject "[Test] <title>") and is offered for every type with editable wording, not only the four marked testable; it now requires the notifications pack at Manage for operations managers (owner decision 2026-11-12).
- Page fixes: no stale data shown for a new request while it loads; delivery log, delivery detail, recent deliveries and Health times in the organisation timezone; delivery log date filter in organisation days.
- Tests added: `tests/lib/notification-wording.test.ts` (registry covers every catalog type, defaults valid, template language never executes, escaping, refusal rules, SMS length, syntax conversion), `tests/lib/notification-wording-parity.test.ts` (byte parity per wired type and transport), `tests/lib/notification-wording-store.test.ts` (versions, restore, reset, 409, 400, audit, email-template parts, overrides on every transport, invalid override and store failure fall back), `tests/api/notification-wording-routes.test.ts` (ADMIN; OPS at Manage allowed; view only / no pack 403; impersonation 403; regenerate proposal never saved, rejected proposals, no provider; test-send truthfulness), `tests/components/notification-wording-editor.test.tsx` (draft kept across tabs, chip insertion at the caret, required-variable refusal, 409 keeps the draft, proposal Use fills only, read-only). Changed with the behaviour: `tests/components/notifications-area.test.tsx` (new screen), `tests/api/notifications-area-routes.test.ts` (test subject is the live wording; the "no test" example is now `job.changed`).
- Verified: `npx tsc --noEmit` clean in these paths (remaining errors only in another engineer's in-progress laundry files: `app/v2/laundry/page.tsx`, `lib/laundry/supplier-chase-rules.ts`). 217 notification-related test files: all pass except 7 tests in others' in-progress work (`tests/components/laundry-dashboard.test.tsx`, `tests/components/office-actions-ui.test.tsx`, `tests/lib/laundry-nudges.test.ts` from the new TEAM_MOVE_PICKUP kind; `tests/lib/portal-navigation.test.ts`). `tests/lib/server-client-value-imports.test.ts` passes.
- Not done: production build, full suite and the browser pass (390/1280, light/dark) were not run here. No real message was sent; the AI provider and SMS/email providers are mocked in tests.

## QA portal, maintenance portal, sign in and public pages (2026-11-12)

Scope: boards `QaPortal.dc.html`, `MaintenancePortal.dc.html`, `PublicAndAuth.dc.html`; details in `docs/SYSTEM.md`, "QA portal, maintenance portal, sign in and public pages redesign (2026-11-12)". No schema change, no migration, no API change, no authentication logic change.

What changed
- Navigation: `components/v2/qa/portal/{qa-nav.ts,qa-more-menu.tsx}`, `components/v2/maintenance/portal/{maintenance-nav.ts,maintenance-more-menu.tsx}`, `components/v2/portal/more-menu-list.tsx`, `lib/navigation/{portal-more,tabbed-nav}.ts`, `lib/navigation/mobile-tabs.ts` (qa and maintenance fifth tab = More), `app/v2/{qa,maintenance}/layout.tsx`, `app/v2/{qa,maintenance}/more/page.tsx` (menus, no longer redirects).
- QA: `app/v2/qa/page.tsx`, `components/v2/qa/today/{qa-visit-order,early-start-dialog}.tsx`, `lib/qa/visit-order-view.ts`, `app/v2/qa/pay/page.tsx`, `lib/qa/pay-view.ts`, `app/v2/qa/rework/page.tsx`; targeted edits in `qa-inspection-workspace.tsx` (step labels, proposals sentence, `#know-before-you-go` anchor, 44px step buttons) and `qa-self-rework-workspace.tsx` (labels).
- Maintenance: `app/v2/maintenance/page.tsx`, `components/v2/maintenance/today/new-assignments.tsx`, `components/v2/maintenance/visit/{visit-cost-card,outcome-choice,offline-notice}.tsx`, `lib/maintenance/{visit-outcomes,visit-stages,tickets-by-day}.ts`, targeted edits in `visit-workspace.tsx` and `tickets-workspace.tsx`; shared `components/v2/portal/maintenance-assignment-actions.tsx` labels ("Can't take it", "Other price").
- Sign in and public: `app/v2/login/page.tsx` (markup), `components/auth/biometric-sign-in-button.tsx` (layout-only `layout` prop, default unchanged), `app/accept-invite/[token]/{page,layout}.tsx`, `components/auth/accept-invite-form.tsx`, `app/(auth)/reset-password/page.tsx` (markup), `components/v2/public/{auth-frame.tsx,public-menu.ts}`, `components/v2/public/estate-public-shell.tsx` (menu), `app/v2/onboarding/page.tsx`, `components/v2/onboarding/onboarding-fields.tsx`, `lib/onboarding/steps.ts`.

Fixed by default (existing problems)
- QA Pay showed an inspection with no rate as "$0.00" with a badge; it now reads "Office to fix" and the period headline says it is not final.
- QA Rework turned a failed database read into "Nothing flagged"; it is now an alert with Retry.
- Onboarding showed an empty form when its load failed; it now shows an alert with Retry. Saving offline now keeps the answers with a clear message.
- Invitation expiry used the viewer's timezone and a date only; it is shown in Sydney time with the hour.
- Public menu button was 36px without `aria-expanded`; now 44px with state. Sign in and onboarding now have one main landmark.

Tests
- New: `tests/components/qa-maintenance-portal-redesign.test.tsx` (12: QA and maintenance tab order, More completeness against the old nav, role filtering, `/more` URLs render menus, Office to fix never $0.00 in the view model, the Pay page and planned visits, visit order readiness/next/move, all seven outcomes equal the Prisma enum as radios, visit stages from recorded times, tickets by Sydney day), `tests/components/public-auth-redesign.test.tsx` (9: passkey above the unchanged email/password form, hint, one main; four invitation problem states with one Go to sign in link; invitation form checks and identical POST body; reset page incomplete link, mismatch and identical body; onboarding steps per role and missing-field step; public menu links).
- Changed with the behaviour: `tests/components/qa-dashboard.test.tsx` (three drawn figures with the same ownership, failure isolation and Sydney-day assertions; Rework open uses the PENDING definition; inspectors open the All inspections disclosure), `tests/components/maintenance-tickets.test.tsx` (toggle names By day / By stage; assertions unchanged).
- Existing, unchanged and passing: `v2-login`, `credentials-sign-in`, `audit-auth-login`, `auth-path-middleware`, `maintenance-dashboard`, `maintenance-section`, `qa-queue-readiness`, `photo-review-panel`, `portal-navigation`, `server-client-value-imports` (see the area run in the hand-over report).
- Not run (as instructed): production build, full suite, browser pass at 390/1280 light/dark.

## Client portal redesign (2026-11-12)

Scope: boards `ClientPortal.dc.html` and `ClientPortalDesktop.dc.html`; details in `docs/SYSTEM.md`, "Client portal redesign (2026-11-12)". No schema change, no migration, no change to payment, approval, dispute or quote decision logic.

What changed
- Navigation: `components/v2/client/portal/{portal-nav.ts,request-sheet.tsx,header-actions.tsx,more-menu.tsx,more-account.tsx,segment-links.tsx}`, `app/v2/client/layout.tsx`, `app/v2/client/more/page.tsx`, `lib/client/portal-modules.ts`, `lib/navigation/mobile-tabs.ts` (client line only), `lib/navigation/redirect-query.ts`, redirects in `app/v2/client/{money,services,disputes}/page.tsx`. Shared: `components/v2/portal/portal-shell.tsx` gained an optional `headerActions` prop (other portals unchanged); `components/v2/portal/use-attention-counts.ts` parses optional `portal.modules`.
- Home/dashboard: `app/v2/client/page.tsx`, `lib/client/home-dashboard.ts`, `components/v2/client/home/*`; Properties page hosts the pinned portfolio.
- Property page: `app/v2/client/properties/[id]/page.tsx`, `components/v2/client/property/*`.
- Approvals/quotes: `app/v2/client/approvals/page.tsx`, `components/v2/client/approvals-board.tsx`, `components/v2/client/approvals/*`, `lib/client/quotes-waiting.ts`; `components/v2/client/quotes-board.tsx` and `app/v2/client/quotes/page.tsx` accept `?quote=&intent=` (focus only).
- Money: `app/v2/client/finance/page.tsx`, `components/v2/client/money/*`, `lib/billing/client-portal-money.ts`, read-only fields in `lib/billing/client-portal-finance.ts`, `components/v2/client/pay-invoice-button.tsx` (label/width props).
- Clean, messages, settings: `app/v2/client/jobs/[id]/page.tsx`, `components/v2/client/{job-action-hub,job-skip-action,messages-thread,settings-panel}.tsx`, `app/v2/client/settings/page.tsx`, `app/v2/client/calendar/page.tsx` (names switch).
- Route: `app/api/client/attention-counts/route.ts` adds the unread messages count and module switches.

Fixed by default (existing problems)
- Clean page looked jobs up by client only, so a property-scoped assistant could open another property's clean by URL; it now uses `propertyScopeWhere`.
- Clean page showed invoice lines to an assistant without the invoice grant.
- Calendar page showed cleaner names with the per-client names switch off.
- Approval, property activity and laundry confirmation times were formatted in server time; now Sydney.
- Home listed the six oldest laundry tasks ever; the redesigned table shows the open (else latest) run per property.
- Retired client URLs dropped their query string on redirect.

Tests
- New: `tests/components/client-portal-redesign.test.tsx` (tab order, More/rail/sheet completeness against every `app/v2/client` route, assistant limits, module switches, redirects with query), `tests/components/client-visibility-redesign.test.tsx` (names switch on the calendar, property tabs per switch and reports grant, Book a clean here grant, assistant scope on the clean page, server-filtered More), `tests/components/client-approvals-quotes-messages.test.tsx` (quotes listed and linked, expired quote, unreadable quotes never "All clear", History segment, saved/retry with the same request id, mismatched receipt), `tests/lib/client-portal-money.test.ts` (Due/Overdue/Not yet sent/Part paid/Paid/Fully credited/credit note, unknown terms, pay-first order).
- Changed with the behaviour (same guarantees, new labels or placement): `client-dashboard` (rewritten for the phone Home and dashboard: failures stay unavailable and are listed, no zero money, VA hiding and scoping, names switch, approvals switch, live clean and decisions), `client-approvals-board` (Approve carries the amount, counter opens from Offer other price, history on its segment), `client-finance-reliability` (Paid badge, row links, single Pay now; page called with props), `client-layout-gates` (Cleans label, booking via the Request sheet, sheet withheld until access is confirmed), `client-attention-scope` (unread messages count, module switches, failure), `portal-navigation` (client tabs).
- Run and passing: TypeScript; 62 client/portal/VA/finance/navigation test files (905 tests) including every existing client-portal file and `server-client-value-imports`.
- Not run (as instructed): production build, full suite, database tests (`tests/db/client-message-receipt.test.ts` needs the loopback database; the message API is unchanged), browser pass at 390/1280 light/dark.

## Suppliers directory, laundry pipeline actions and laundry partner portal (2026-11-12)

Boards "Suppliers" and "Laundry partner portal", built as drawn on today's laundry-partner links. Details: `docs/SYSTEM.md`, "Suppliers directory, laundry partner pipeline actions and the laundry partner portal (2026-11-12)".

Schema: one forward migration, `20261112230000_laundry_team_request_replies` (new table `LaundryTeamRequestReply`, FKs to `LaundryTask` cascade and `User` set null, unique idempotency key, CHECK constraints on answer, time and return day). Verified on 127.0.0.1:55439: fresh `createdb` database, `migrate deploy` applied all 137 migrations, a second deploy reported no pending migrations, `migrate diff --from-url … --to-schema-datamodel prisma/schema.prisma --exit-code` reported no difference; existing `sneek_ui` copy: the one pending migration applied, repeated deploy clean, diff empty, row checksums of `LaundryTask` and `User` unchanged; `prisma generate` run.

Review points:
- Authorization: the reply route is LAUNDRY only and refuses impersonation; the service re-checks the run with `laundryTaskScope` and requires the person to have been asked or to be on the run's partner team now. Team requests keep ADMIN/OPS_MANAGER and the no-impersonation rule; the directory route keeps ADMIN/OPS_MANAGER. Stop pages read the run through the week feed's visibility and redaction.
- Unknown states: partner figures that cannot be computed are omitted ("not available"); on-time and actual turnaround are null without data; no schedule fields exist and the panel says so; a pickup with a 409 or no answer is "may or may not have been recorded".
- Transports: INBOX added to team requests (inbox without push); PUSH implies the inbox row; email goes to the team logins' addresses. Email or SMS to the partner's own contact remains Chase supplier (administrators send). Nothing reports read or delivered.
- An answer from the laundry team never changes the run; "Yes, 15:30" does not set the planned time.
- Tests run and passing: TypeScript (`tsc --noEmit -p .`, exit 0 on the final run); 59 focused files incl. every existing laundry and supplier test, office actions, wording parity, portal navigation and `server-client-value-imports` (508 passing; `tests/lib/notification-wording.test.ts` fails only on `job.changed/tasks-added`, another engineer's in-progress wording); 7 database files on a fresh disposable database (39 passing).
- Not run (as instructed): production build, full suite, browser pass at 390/1280 light/dark.

## Approvals, Quotes and pricing, Settings home, Activity log and Growth (2026-11-12)

Boards: Approvals, Quotes and pricing, Settings, Activity, Growth (built); Quote builder full page and Messages (not built in this step). Uncommitted; no schema change; nothing in `lib/rbac/**`, `prisma/**` or the excluded paths edited. Details: `docs/SYSTEM.md`, "Approvals, Quotes and pricing, Settings home, Activity log and Growth redesign (2026-11-12)".

- Approvals: every queue keeps its own decision controls (moved into side-panel files, same routes and bodies). Bulk only where nothing is chosen per request; each row runs the existing route handler in process, and operations managers are checked against the single route's access area. Fixed with it: queue counts were page lengths capped at 50 (now real counts, oldest rows read first); the pay decision note labelled "Visible to the cleaner" was saved to the private admin note (now `decisionMessage` when ticked); deleting a decided record only had a browser-side PIN check (now verified by the route).
- Quotes and pricing: server-paged pipeline (leads without quotes + quotes), margin Unknown instead of zero, bulk Send / Mark lost with per-row outcomes, pricing tabs reusing the existing editors and PIN lock; `/v2/admin/pricing` redirects. Old pipeline component removed (every action mapped; see the report's parity table).
- Settings home: all destinations from the shared catalog with the same role filter; badges only from stored Xero sign-in and SMS failures.
- Activity log: actual person vs testing-as from `after.impersonatedBy`; rows without that marker cannot be told apart and show the signed-in account, as before.
- Growth: real counts per workspace the viewer may open; opens "not recorded" until provider events exist.
- Tests run and passing: TypeScript (`tsc --noEmit -p .`, exit 0); 21 focused files / 161 tests (new: approvals bulk lib + route, history delete PIN, approvals workspace, quotes pipeline lib + routes, quote new prefill, settings home, activity log, growth summary; existing: approvals deep link, approval history, ops middleware / policy / request guard, settings navigation, case repair quote, pay claim, page denial, work queue, server/client import scan).
- Not run (as instructed): production build, full suite, browser pass at 390/1280 light/dark. No real external messages sent.

### Second pass: every in-code type made editable (2026-11-12)

- Now Editable (were In code): job.changed, job.clock_changes, job.qa_and_accountability, office.cleaner_requests, office.field_alerts, office.client_requests, office.reports_generated, stock.submission_low_stock, stock.urgent_need, maintenance.assignment, office.ical_alerts, client.job_updates, client.post_job, workforce.updates; leads.alerts is Editable parts (website form emails are form-field data). job.cleaner_requests_decided became Editable (its extra-pay template moved to office.cleaner_requests, where the producer actually uses it). In code by design: insights.monthly_email, system.provider_tests.
- Shared in-app/SMS templates (`settings.notificationTemplates`: Job Assigned, Job Updated, Extra Pay Request, Case Created/Updated, summaries, laundry, stock, shopping, New Profile) are parts on their types; saving writes the shared template.
- Producers changed (one targeted edit each; no logic changed): lib/notifications/client-job-notifications.ts, lib/inventory/urgent-stock.ts, lib/cleaner/submission-urgent-stock.ts, lib/inventory/stock-count-observations.ts, lib/cleaner/submission-low-stock.ts, app/api/admin/jobs/[id]/route.ts, app/api/admin/jobs/[id]/reset/route.ts, lib/phase4/analytics.ts, lib/job-tasks/service.ts, lib/time/auto-clockout.ts, lib/gps/departure-clockout.ts, lib/ops/auto-pause.ts, app/api/admin/jobs/[id]/time-logs/[timeLogId]/route.ts, lib/reports/admin-report-actions.ts, lib/ical/notifications.ts, app/api/public/quote-view/[token]/request-addon/route.ts, app/api/public/quote-view/[token]/respond/route.ts, app/api/admin/leads/[id]/counter-offer/route.ts, app/api/admin/maintenance/[id]/assign/route.ts, app/api/admin/maintenance/[id]/assignees/route.ts, app/api/admin/maintenance/assignments/[id]/route.ts, lib/maintenance/assignment-email.ts, app/api/cleaner/jobs/[id]/gps-checkin/route.ts, lib/ops/safety-checkins.ts, app/api/maintenance/route.ts, app/api/maintenance/[id]/visit/route.ts, app/api/maintenance/assignments/[id]/route.ts, lib/cases/damage-maintenance-sync.ts, app/api/cleaner/jobs/[id]/approval-request/route.ts, app/api/cleaner/jobs/[id]/reschedule-request/route.ts, app/api/cleaner/jobs/[id]/start/route.ts, app/api/cleaner/jobs/[id]/submit/route.ts, app/api/admin/job-early-checkouts/route.ts, lib/ops/pending-pay-approval-reminders.ts, app/api/client/booking/route.ts, app/api/client/jobs/[id]/skip-request/route.ts, app/api/client/messages/route.ts, app/api/client/approvals/[id]/counter/route.ts, app/api/client/approvals/[id]/respond/route.ts, app/api/admin/messages/job/[jobId]/relay/route.ts, lib/notifications/accountability.ts, lib/accountability/streaks.ts, lib/qa/rework-transfers.ts, app/api/cleaner/rework-offers/[assignmentId]/respond/route.ts, app/api/qa/jobs/[id]/pickup/route.ts, lib/damage/void.ts, lib/ops/follow-up-sequences.ts, lib/notifications/client-automation.ts, app/api/admin/qa/invites/route.ts, lib/workforce/service.ts, lib/workforce/quiz.ts, app/api/admin/workforce/hiring/applications/[id]/email/route.ts, app/api/admin/job-continuations/[id]/route.ts, app/api/cleaner/job-early-checkouts/[id]/route.ts, lib/time/adjustment-requests.ts, lib/notifications/pay-adjustments.ts, app/api/admin/pay-adjustments/[id]/route.ts.
- Behaviour notes: email bodies that previously inserted values raw now escape them (same rendering for ordinary text; an apostrophe passed as a value becomes `&#39;`); job-edit "what changed" items and task lists are escaped; the hiring email subject no longer shows `&amp;` for a position with "&".
- Tests: parity `tests/lib/notification-wording-parity-more.test.ts` and `tests/lib/notification-wording-parity-decisions.test.ts`; `notification-wording.test.ts` (all defaults valid, url format). Updated: `tests/api/notifications-area-routes.test.ts` (the "no test" example is now insights.monthly_email, since job.changed has wording), `tests/lib/notification-wording-store.test.ts` (job.offer's email part found by transport). Results: `npx tsc --noEmit` clean; 237 notification-related test files, 2451 tests, all pass, including the import scan. Production build, full suite and browser pass not run.

## Quote full page and Messages (2026-11-12)

Boards: "Quote full page: detail and edit combined", "Messages". Uncommitted; no schema change; no API route changed; nothing in `prisma/**`, `lib/rbac/**`, `app/v2/admin/layout.tsx`, the quotes pipeline list, the notifications area or portals edited. Details: `docs/SYSTEM.md`, "Quote full page and Messages redesign (2026-11-12)".

- Money: totals, GST and discount arithmetic moved unchanged into `components/v2/admin/quotes/builder/payload.ts` and are tested against the old inline code; the discount route still finalises discounts on save; margin uses the existing `estimateMargin` with only the cost share sent to the browser (the rack rate and cleaner cost stay server-side behind the rate-card PIN).
- Authorization: page role lists unchanged (ADMIN, OPS_MANAGER); the composer send stays behind `messages.compose_send` on the send route; the page reads the same capability to explain a disabled Send.
- Unknown states: "Client opened: Not recorded", "Pricing source not recorded", "Margin unknown", unread counts "N+" at the list cap, composer outcomes never read as delivered ("handed over, delivery not confirmed"; provider-not-configured is "Not sent").
- Fixed existing problems: the detail page's Notes box showed and re-saved the raw `[[META]]` block; the edit page let a saved quote "change" its lead or become a new lead and silently ignored it; sending asked for the recipient in a browser prompt; reply templates could post raw `{{variables}}`; quote timeline times used the viewer's timezone.
- Not built as drawn (reasons in the step report): autosave (no stale-write guard on the quote PATCH); "Office notes" (no internal notes field; the field is the client-facing quote notes, labelled so); "Change" button on Addressed to; "Reschedule to 09:00" and "Attach" in the thread (no existing action or attachment support on client messages); "Composed messages" is a link to the delivery log.
- Tests run and passing: TypeScript (`tsc --noEmit -p .`; remaining errors only in other engineers' in-progress files: `lib/laundry/invoice.ts`, `app/api/me/admin-pin/route.ts`); 5 new focused files (46 tests); every test file matching quote / messages / compose (92 files, 1124 passing, 20 skipped DB tests) including `server-client-value-imports`. Failing outside this step: `tests/api/case-repair-quote.test.ts` (2) after another engineer's in-progress quote-number change to `app/api/admin/quotes/route.ts`.
- Not run (as instructed): production build, full suite, browser pass at 390/1280 light/dark. No real external messages sent.

### Third pass: the "editable parts" types made fully editable (2026-11-12)

- Now Editable: job.offer, job.skipped_or_cancelled, job.cleaner_invoice, office.cases, office.sla_and_summaries, office.new_profile, laundry.updates, stock.alerts, stock.shopping_and_orders, office.lost_found_report, client.documents, client.approvals, account.invitations, leads.alerts. Still parts by design: account.security (fixed two-step security wording), laundry.report_email (generated table). In code: insights.monthly_email, system.provider_tests.
- Producers changed (one targeted edit each): app/api/admin/jobs/[id]/assign/route.ts, app/api/admin/jobs/bulk-assign/route.ts, app/api/admin/dispatch/auto-assign/[jobId]/apply/route.ts, app/api/cleaner/jobs/[id]/assignment-response/route.ts, lib/email-templates.ts (`buildBulkAssignedEmail` optional texts), app/api/admin/jobs/[id]/skip/route.ts, lib/ical/sync.ts, lib/cleaner/invoice-admin-notify.ts, lib/cases/follow-up.ts, lib/ops/sla.ts, app/api/admin/phase3/commercial-sla/run/route.ts, lib/ops/daily-briefing.ts, lib/ops/tomorrow-prep.ts, app/api/auth/register/verify-otp/route.ts, app/api/me/onboarding/route.ts, lib/laundry/cleaner-status.ts, lib/laundry/reminders.ts, lib/laundry/sync-draft.ts, app/api/laundry/[taskId]/route.ts, app/api/admin/laundry/[taskId]/route.ts, lib/inventory/stock.ts, lib/ops/stock-alerts.ts, app/api/scan-tasks/route.ts, lib/inventory/notifications.ts, lib/inventory/client-shopping-notifications.ts, app/api/admin/inventory/shopping-list/email/route.ts, app/api/admin/inventory/shopping-runs/[id]/po/email/route.ts, app/api/admin/inventory/shopping-runs/[id]/reimbursement/email/route.ts, app/api/admin/phase3/supplier-orders/email/route.ts, app/api/cleaner/lost-found/route.ts, lib/notifications/documents.ts, app/api/admin/jobs/[id]/quote-extras/route.ts, app/api/admin/client-approvals/route.ts, app/api/admin/pay-adjustments/[id]/send-to-client/route.ts, app/api/admin/clients/route.ts, app/api/admin/clients/[id]/invite/route.ts, app/api/admin/leads/[id]/create-client/route.ts, app/api/admin/va-invites/route.ts, app/api/public/lead/route.ts, app/api/public/contact/route.ts. Not touched: app/v2/admin/quotes/**, app/v2/admin/messages/**, quotes and messages components.
- Tests: `tests/lib/notification-wording-parity-third.test.ts` (parity per part). Results: tsc clean; 238 notification-related test files: 234 pass; 7 tests fail only in other engineers' in-progress work (`tests/api/admin-user-guards.test.ts`, `tests/api/case-repair-quote.test.ts`, `tests/components/laundry-dashboard.test.tsx`, `tests/lib/laundry-team-replies.test.ts`; none of their files were edited here). Import scan passes.

## QA and maintenance owner decisions (2026-11-13)

Owner decisions of 2026-11-12: inspector visit order with an office lock, "Fail" replacing Major / Critical, maintenance outcomes merged to the five drawn, rework list scope. Uncommitted. Migrations `20261113020000_qa_day_order`, `20261113021000_qa_fail_verdict`, `20261113022000_maintenance_outcome_merge`. Details: `docs/SYSTEM.md`, "QA and maintenance owner decisions".

- Authorization: inspector reorder is `requireRole([QA_INSPECTOR])` (live), refused while impersonated, own active visits for that Sydney day only, stale-write guarded (`expectedOrder`), audited; office reorder and lock clear keep ADMIN / OPS_MANAGER with quality at manage through the live ops check. An inspector's order never sets or overrides an office lock; both paths serialise on one advisory lock per inspector-day.
- Scoring: Fail deducts `failDeduction` (unsaved: the organisation's Major, default 10); Serious deducts `seriousFailDeduction` (unsaved: Critical, default 25) and carries every Critical-only consequence (management review and notice, streak break, performance and brief "critical"). Stored as MAJOR / CRITICAL with `failVerdict` / `serious` (CHECK constraints), so Quality hub bands and every count work across both scales. Verdicts off the assignment's scale are refused (409), never re-mapped. No stored inspection row is changed; verified byte-identical on a seeded copy.
- Maintenance: FIXED + REPLACED → REPLACED_OR_REPAIRED, OTHER → NEEDS_FOLLOWUP; every original copied to `originalOutcome` before the enum swap; history shows "originally: …"; the visit route maps an earlier value from an old screen and refuses unknown text.
- Rework: inspectors' list, Today figure and Rework badge are scoped in the query; office sees all with Mine / All when they also inspect; offer-back progress from the rework clean's status or the cleaner offer, nothing guessed.
- Tests run and passing: TypeScript (`tsc --noEmit -p .`, clean at the time of the run); new `tests/lib/qa-fail-verdict.test.ts`, `tests/lib/maintenance-outcome-merge.test.ts`, `tests/lib/qa-rework-list.test.ts`, `tests/api/qa-visit-order-route.test.ts`, `tests/api/maintenance-visit-outcome-merge.test.ts`, `tests/components/qa-visit-order-reorder.test.tsx`, DB-backed `tests/db/qa-maintenance-decisions.test.ts` (disposable `qamaint_test`); every QA / quality / maintenance / accountability / rework test file plus the server-client import scan (105 files, 1075 tests); DB suites schema, migration-retention, wave-e, wave-f. Updated on purpose: `tests/components/qa-maintenance-portal-redesign.test.tsx` (five outcomes), `tests/components/qa-dashboard.test.tsx` (scoped rework figure, `inspectorMayReorder`), `tests/lib/maintenance-ticket-stage.test.ts` (OTHER no longer exists).
- Migrations: fresh database, seeded copy at the previous migration (all seven outcomes, Major / Critical inspections, assignments in every state), existing `sneek_ui` (already deployed by a parallel engineer); repeat deploy nothing pending; `migrate diff` no difference.
- Not run (as instructed): production build, full suite, browser pass at 390/1280 light/dark. No real external messages sent. The cutover label "13 Nov 2026" is the migration date, not a verified deployment date.

## Laundry owner decisions (2026-11-13)

Owner decisions on the laundry partner portal: the laundry team may add weight, price and drop-off photos; a team "Yes, <time>" sets the planned time; "Ready to return" is a status; laundry partners have pickup and drop schedule fields. Left uncommitted in the working tree (the lead checkpoint-commits). Migrations `20261113010000_laundry_ready_to_return_status` (enum value only, its own file) and `20261113010100_laundry_partner_schedule`. Details and the full status enumeration audit are in `docs/SYSTEM.md`, section "Laundry owner decisions … (2026-11-13)".

- Authorization: the three new portal routes (`weight-price`, `dropoff-photos`, `ready-to-return`) call the live `requireRole([LAUNDRY])`, refuse impersonation, and in one locked transaction recheck active account, the laundry visibility rule, the partner rule (a run held by another partner is refused) and the run version. Each write is audited with the actor (confirmation event + AuditLog). Photo keys must be the caller's own uploads. The schedule route is ADMIN and OPS_MANAGER, version-checked and audited.
- Money: the partner's price goes to `LaundryTask.dropoffCostAud`. No `ClientInvoice` or line reads it; the DB test checksums every invoice and line row before and after. A drop that leaves price or weight empty keeps the entered value (previously these were reset to null). The run panel shows "Entered by <name>" only while the stored figure is still the partner's entry.
- Planned time from an answer: only CONFIRMED with a valid `HH:mm`, only while the leg is open, in the reply transaction, audited `source: LAUNDRY_TEAM_ANSWER`. Never a date or status; a replay does not apply it again.
- READY_TO_RETURN: every enumeration was audited and decided. It is treated as PICKED_UP wherever the question is "picked up, not delivered", has its own label where statuses are named, needs no change where `notIn`/`nativeEnum`/drop-keyed code already handles it, and is not edited in the client portal (out of scope; those screens fall back to "READY TO RETURN" with a neutral tone). A run can still go from PICKED_UP to DROPPED directly. A cleaner's late update cannot move a ready set back.
- Schedule: descriptive defaults only. They prefill the planned TIME of new runs (window start, stated days only, never key-lost runs, never when a time exists), and the lookup is best-effort outside the creating transaction. Dates, the planner's date and turnaround rules, exceptions and existing runs are unchanged (DB test: planner create keeps the draft dates; an update keeps an office time).
- Migrations verified: fresh `laundry2_fresh` deploy (then again with the later parallel migrations), existing `sneek_ui` with checksums of pre-existing LaundryTask / LaundrySupplier / LaundryConfirmation / LaundryTeamRequestReply rows equal before and after (the database holds one laundry task and no partners, so the existing-row check is thin), a repeat deploy with nothing pending, and `migrate diff` with no difference on both. Earlier, before the parallel migrations were applied, the fresh database showed only other engineers' QA, maintenance, PIN and quote models.
- Tests run and passing: `tsc --noEmit -p .` clean; new `tests/lib/laundry-owner-decisions-1113.test.ts` (19), `tests/db/laundry-owner-decisions-1113.test.ts` (8, PostgreSQL 55439, `--no-file-parallelism`), `tests/components/laundry-partner-entries.test.tsx` (7); 79 related existing files (laundry, suppliers, calendar, portfolio, reports, status presentation, office actions, accountability) and `tests/lib/server-client-value-imports.test.ts`; existing laundry DB suites (`laundry-early-evidence`, `laundry-quantity-pickup`, `laundry-partners`, `laundry-failed-pickup`, `schema`). Changed on purpose: one expectation in `tests/components/laundry-dashboard.test.tsx`.
- `tests/db/laundry-team-replies.test.ts` and `tests/db/migration-retention.test.ts` first failed because their fixtures write columns from the parallel QA and maintenance migrations, which were not yet on the test database. Once the full migration chain was deployed, all 8 laundry, schema and retention DB files passed (42 tests).
- Not run (as instructed): production build, full suite, browser pass at 390/1280 light/dark. No real external messages sent. Deployment not verified.

## Client portal, approvals and own PIN owner decisions (2026-11-13)

Owner decisions of 2026-11-13: booking prefill from a property, client-visible quote numbers, clean-page costs behind the finance switch, payment return to the new finance page, administrator-only delete of decided approvals, bulk approval of pay requests as asked, and a personal PIN for every administrator and operations manager. Also the client label for the new laundry status READY_TO_RETURN. Uncommitted. Migrations `20261113030000_quote_reference_number` and `20261113031000_user_security_pin`. Details: `docs/SYSTEM.md`, "Client portal, approvals and own PIN owner decisions (2026-11-13)".

- Authorization: `?propertyId=` is used only when it is in the server's scoped property list (`propertyScopeWhere`, active); anything else shows a notice. Approval-record delete checks the live session for ADMIN (primary or extra) before the PIN; the list returns `canDeleteRecords` and the menu hides Delete for others. Bulk pay approval runs each row through the existing single route in process, after `planPayApprovals` (waiting, valid amount, receipt, no client approval pending or declined, confirmed amount unchanged) and the Payroll access check for operations managers. Own PIN: the checked id must be the signed-in person and no Test-as ticket may be active. PIN set, change and remove need the current password and are refused while testing. Administrator reset is `requireRole([ADMIN])`, not on oneself, only for ADMIN / OPS_MANAGER holders, confirmed with the administrator's own PIN.
- Transition (stated exactly): there was no shared PIN in code. Existing personal PIN hashes are copied to `UserSecurityPin`. A person with a PIN uses it (a password alone is now refused). A person without one gives their password once with a new PIN at their next sensitive action, or sets one in Profile. Nobody is locked out.
- Money and records: no invoice, payment or rate snapshot changes. Quote numbers are added to existing quotes only. A checksum of every other quote column, taken on a seeded copy before and after the migration, was identical (`188b6716…`). The settings JSON holding the old hashes is left untouched.
- Migrations verified: fresh `cap_fresh_qpin` deploy, repeat deploy nothing pending, `migrate diff` no difference. Seeded copy `cap_exist_qpin` migrated to the previous migration, with 4 quotes (out-of-id order and a tie) and profiles with a valid hash, a null hash, a malformed hash and a deleted user. After deploy the quotes were numbered 1–4 in creation order (tie by id), QUOTE counter 4, only the valid hash of an existing user copied, other quote columns checksum equal, repeat deploy nothing pending, `migrate diff` no difference. Existing `sneek_ui` (0 quotes, 0 PIN rows): deploy (this also applied the three parallel QA / maintenance migrations that were pending there), repeat nothing pending, `migrate diff` no difference. At that time `migrate diff` showed no other engineer's in-progress models.
- Tests run and passing: `tsc --noEmit -p .` (clean on the final run; an earlier run showed one error in another engineer's `lib/laundry/partner-schedule-server.ts`, since fixed by them); the new and changed files listed in SYSTEM.md; DB-backed `tests/db/own-pin-and-quote-number.test.ts` on `cap_fresh_qpin` with `--no-file-parallelism`; every test file mentioning PIN, sensitive actions, approvals, quotes, booking, client finance, checkout, rebook or the client laundry views, plus `tests/lib/server-client-value-imports.test.ts`.
- Not converted: the laundry protected-removal dialog (laundry area, not edited) still has a single PIN field. A person without a PIN gets the readable setup refusal there.
- Not run (as instructed): production build, full suite, browser pass at 390/1280 light/dark. No real payments or messages (Stripe mocked). Deployment not verified.

## Quote autosave and office notes (2026-11-13)

Owner decisions: "Reopen as draft" confirmed as built (no change); autosave on the quote full page behind a new stale-write guard; office notes on quotes that the client never sees. Left uncommitted in the working tree.

- Guard: `PATCH /api/admin/quotes/[id]` accepts `expectedUpdatedAt`; in one transaction a mismatch is 409 `STALE_QUOTE` with `currentUpdatedAt` and no write, and a match writes with `updateMany … where updatedAt = <stored>` so two saves on one version cannot both land (DB-tested). No token = the old unconditional update (pipeline, v1, mobile). Unreadable token = stale. Live `requireRole([ADMIN, OPS_MANAGER])` unchanged.
- Autosave applies only while the quote's status is Draft (coordinator decision, same day). Sent, Accepted, Declined and Converted quotes keep the explicit save as before ("Unsaved changes" + Save changes, token sent); the shared-quote notice says changes go live when Save changes is pressed.
- Autosave (Drafts): debounced 1.5 s, serialised (newest wins with the new token), not while invalid, not on new or converted quotes, never sends or changes status; Saving… / Saved N seconds ago / Not saved + Retry (not repeated until the draft changes) / conflict banner (Reload theirs, Keep my edits and retry); primary actions save first and wait; leave warning only while unsaved; typed text usable during a background save, explicit saves freeze. Status changes, the converted details save and Copy public link send the token. Send, convert, add-on accept / dismiss and delete are separate routes, unchanged.
- Discount: the page re-applies a staged discount after every save (the PATCH rewrites lines without it, as before). The discount route now returns `updatedAt` and adds its timeline event only when the stored discount changed. A refused re-apply is reported as "saved, but the discount was not applied; the saved quote has no discount until this is fixed" and kept unsaved with Retry.
- Sent quotes: editing rule unchanged (only converted quotes are locked; the public page is live), but no autosave, so nothing reaches the client without a deliberate Save. Remaining risks: an Accepted quote's price can still change by an explicit Save; the stored quote briefly lacks its discount between the PATCH and the discount route; "Keep my edits and retry" after a client's add-on request overwrites the client-appended notes line with the office's notes text.
- Office notes: `Quote.internalNotes` (nullable TEXT, migration `20261113040000_quote_internal_notes`, no backfill). Edited on the quote page ("Office notes (not shown to the client)", separate from the client-visible notes), read-only in the pipeline panel, audited `QUOTE_INTERNAL_NOTES_UPDATED` (actor, before, after) in the write's transaction. Absent from the public payload and page props, PDF, email body and attachments, documents mailer, My quotes, Approvals / dashboard, message template variables; one test per surface. Not searchable (the pipeline search does not cover notes).
- Migrations verified: fresh `quote_notes_fresh` deploy, repeat deploy nothing pending, `migrate diff --exit-code` no difference; existing `sneek_ui` (no quotes) deployed, repeated, no difference; seeded copy `quote_notes_seeded` (two quotes at the previous migration) with every other quote column checksum-identical before and after; `npx prisma generate` run.
- Tests run and passing: `tsc --noEmit -p .` clean; new `tests/api/quote-patch-stale-guard.test.ts` (13), `tests/api/quote-internal-notes-client-surfaces.test.ts` (9), `tests/components/quote-autosave.test.tsx` (17, incl. Draft-only rules and no autosave on Sent / Accepted / Declined), `tests/db/quote-autosave-internal-notes.test.ts` (3, PostgreSQL 55439 `quote_notes_fresh`); every existing quote test file, the message-variable and campaign tests, `tests/db/schema.test.ts`, `tests/db/migration-retention.test.ts` and `tests/lib/server-client-value-imports.test.ts`. Changed on purpose: `tests/components/quote-full-page.test.tsx` (Mark won body carries the token).
- Not run (as instructed): production build, full suite, browser pass at 390/1280 light/dark. No real messages sent. Deployment not verified.

## Parity gaps restored: cleaner figures, notification group filter, role reference (2026-11-13)

Audit against the pre-redesign baseline `8c753d3` found three dropped functions; all three are restored. Uncommitted. No schema change. Details: `docs/SYSTEM.md`, "Parity gaps restored: cleaner figures, notification group filter, role reference (2026-11-13)".

- People › Cleaners: Customer rating, Reliability, Attendance and Hours, 30 d columns (Rating and Reliability on by default on the Cleaners tab, the others in Columns), server sorts with unknown sorts still 400, CSV columns, and the Avg quality / Avg rating header figures. Same source as the old roster (`getPerformanceMetrics(id, 30)`, bounded and time-boxed; completed time logs for hours); no data, error or timeout is null ("–"), never 0. Visible with the workforce pack (the old roster's access; ADMIN always), including the cleaner-only route; pay gate unchanged. Old Quality and Jobs sorts map to the existing QA, 30 d and Jobs, 30 d sorts. Figures cached 60 s per server process.
- Notifications › Types and wording: Group filter (popover, counts per group) beside search and status chips; not in the URL, as before.
- Access and permissions: collapsed read-only "What each role can do by default" (role summaries, base permission matrix, Only administrators), generated from `lib/rbac/permissions.ts`, the ops-manager default levels and `ADMIN_ONLY_ACTIONS`; corrected for Full-level sensitive deletes, admin-only role guards and the Manage default.
- Tests run and passing: `tsc --noEmit -p .` clean; new `tests/lib/people-cleaner-performance.test.ts` (12), `tests/components/notification-type-group-filter.test.tsx` (2), `tests/lib/role-reference.test.ts` (4), `tests/components/access-role-reference.test.tsx` (1); existing people, accounts list, users list, pack access, access and ops policy, notification wording / catalog / area tests and `tests/lib/server-client-value-imports.test.ts` (32 files in all).
- Not run (as instructed or by constraint): `tests/db/people-directory.test.ts` (shared disposable database in use by a verification run), production build, full suite, browser pass at 390/1280 light/dark (so the 1280px fit of the two extra default columns is not visually confirmed). Deployment not verified.

## Owner decisions: void and credit notes, invitations, assistant moves, Message team, folding figures, laundry Today (2026-11-13)

Six owner decisions. Uncommitted in the working tree. Details: `docs/SYSTEM.md`, "Owner decisions: sensitive void and credit notes, revocable invitations, assistant team moves, Message team, folding figures, laundry Today (2026-11-13)".

- Void and credit notes: `invoices.void_credit` is now a Full-tier sensitive capability (Finance at Full or the explicit grant; ADMIN always) and every void (invoice or credit note, `PATCH … status VOID`) and credit-note creation (`POST …/credit-note`) checks the capability and then the acting person's own PIN on the server; administrators are asked for their PIN as on the other sensitive actions. No bulk void or bulk credit note exists. UI dialogs use the shared own-PIN prompt; the actions are disabled with the reason for people without the capability. Effect after deploy: operations managers at Finance Manage lose void and credit notes until an administrator grants Full or the capability. Parity test updated with the recorded exception.
- Invitations: `UserInvitation.revokedAt` / `revokedById` (migration `20261113050000_invitation_revoked`, two nullable columns and a foreign key, no data change). Revoke from Invitations rows, detail panel, bulk and Assistants rows, confirmed; same rights as resend; audited. The accept page and API answer a distinct "withdrawn" state; accepting now claims the invitation conditionally, so a revoke and an accept cannot both land. Resend issues a fresh invitation.
- Assistant team moves: administrators only (as the screen's other team changes; the pre-existing team-grant PATCH also allows operations managers with the clients pack and was not changed), same client only, one transaction, audited with before and after team; access follows the new team on the next request (nothing cached).
- Message team: dialog to the assigned cleaners only, explicit Inbox / Push / SMS with reasons and "Don't ask again", pipeline scope `JOB_ASSIGNED_CLEANER` re-checked at queue and dispatch and before SMS, accepted / skipped / failed per person and transport, one send per request key, limits per sender and per job, audited on the job; rights by the office-send rule (`job_team_message`: ADMIN, or OPS_MANAGER with Jobs at Manage; never while impersonating). Catalog `job.office_message` and editable wording.
- Folding figures: one shared `CollapsibleFigures`; People tabs, client invoice figures, pay runs and Quality hub. Properties, cleaner invoices (four tiles each), Jobs, Approvals and Urgent stock checked and unchanged.
- Laundry Today: today's runs from the Runs board's own query and rule (`classifyRuns` moved to `lib/laundry/run-classification.ts`); other days' failed, flagged and overdue runs stay on Runs, Tracking, Queue and History, linked from Today.
- Migrations verified on PostgreSQL 127.0.0.1:55439: fresh `decisions5_fresh` (146 migrations applied, repeat "No pending migrations to apply", `migrate diff --exit-code` "No difference detected"); existing `sneek_ui` (applied only `20261113050000_invitation_revoked`, repeat nothing pending, diff no difference); `prisma generate` done. Data preserved: additive nullable columns only.
- Tests run and passing: `tsc --noEmit -p .` clean; the new and changed test files listed in SYSTEM.md; a 284-file batch of every notification, invoice, access, people, assistant, account, laundry, job-page, office-send, PIN, parity, approvals, Quality hub, money, wording, catalog, transport and import-scan test file (2854 tests); DB-backed on `decisions5_fresh` with `--no-file-parallelism`: the new `tests/db/invitation-revoke-and-va-move.test.ts` plus `finance-decisions`, `own-pin-and-quote-number`, `money-wave-d`, `people-directory` and six laundry DB suites (62 tests).
- Not run (as instructed): production build, full suite, browser pass at 390/1280 light/dark. Providers mocked; no real messages. Deployment not verified.

## Tone band replaces the coloured left line (2026-11-13)

Owner decision: design B, the tinted title band, colour set 1 "Honey and wine". Visual only, no schema change. Details: `docs/SYSTEM.md`, "Tone band replaces the coloured left line (owner decision, 2026-11-13)"; rule in `docs/style/operational-ui.md`.

- Tokens `--e-band-{attention,problem,good,info}-{bg,line,fg,muted,pill}` in light and Obsidian dark; computed contrast for every text pair is at least 5.47:1 (light) and 7.47:1 (dark).
- Shared `components/v2/ui/tone-band.tsx`; `EAlert` follows it; about 45 v2 files converted; `EDataTable` active row is a soft tint without the inset line.
- Deliberate exceptions (allowlisted in the scan test): dividers, drawer edges, timelines, nested-question guide, blog lead quote. Pending: `components/v2/cleaner/pay-requests-panel.tsx` (parallel pay-request fix).
- Tests run and passing: `tsc --noEmit -p .` clean; new `tests/components/tone-band.test.tsx` (10) and `tests/lib/no-left-accent-lines.test.ts` (2); `tests/lib/server-client-value-imports.test.ts`; 40 existing test files that render the changed components (453 tests). No existing test asserted the old left-border classes.
- Not run (as instructed): production build, full suite, browser pass at 390/1280 light/dark, so the band rendering is not visually confirmed. Deployment not verified.
- Note: the working tree was snapshotted by another session into WIP commits (`ff63e0f`, `fe8815b`) that mix this change with the pay-request fix; this change itself was not committed by its author.

## Cleaner pay is the requested amount (2026-11-13)

Owner rule: once the client approves a charge (or a counter-offer) at a different amount, the cleaner is still paid what they requested. Details: `docs/SYSTEM.md`, "Cleaner pay is the requested amount, not the client charge (owner rule, 2026-11-13)". No schema change, no migration.

- Before: `lib/pay-adjustments/display.ts` made the client approval's amount the `primaryDisplayAmount`, which pre-filled the Approvals panel and one-click Approve (`lib/admin/approvals/rows.ts` `payAskedAmount`), bulk "Approve as asked" (`lib/admin/approvals/bulk.ts`, including its `expectedAmounts` check), Finance › Pay adjustments and the classic workspace. The PATCH route stored whatever amount it was sent. No automatic approval existed.
- Now: requested amount everywhere; client charge read only beside the field; server default = requested; above request = administrator override with reason only, audited `PAY_ADJUSTMENT_PAID_ABOVE_REQUEST`; same rule on Decided › Change amount; client approval records only read; cleaner surfaces never read them.
- Existing approved or paid records were not changed. Review (read only): `npx tsx scripts/review-paid-above-request.ts`, Approvals › Decided › "Paid above request", or in production:

```sql
SELECT a."id", u."email" AS "cleanerEmail", a."title", a."requestedAmount", a."approvedAmount", a."reviewedAt"
FROM "CleanerPayAdjustment" a
JOIN "User" u ON u."id" = a."cleanerId"
WHERE a."status" = 'APPROVED'
  AND a."includedInPayrollRunId" IS NULL
  AND a."includedInCleanerInvoiceId" IS NULL
  AND a."approvedAmount" IS NOT NULL
  AND ROUND(a."approvedAmount"::numeric, 2) > ROUND(a."requestedAmount"::numeric, 2)
  AND (a."source" IS NULL OR a."source" NOT IN ('QA_RECTIFICATION_PAY', 'RECTIFICATION_DEDUCTION', 'REWORK_DEDUCTION', 'STREAK_5', 'STREAK_10', 'MONTHLY_RANK_1', 'MONTHLY_RANK_2'))
ORDER BY a."reviewedAt" DESC NULLS LAST, a."id";
```

- Fixture result: the query returned 0 rows on `sneek_ui` and `sneek_review_test` (both hold no pay requests), so it was exercised on real data only through `tests/db/cleaner-pay-requested-amount.test.ts`. Production count not run (no production access).
- Also: the cleaner Pay requests "From the office" note now uses `toneNoticeClass("attention")`; the pending entry above is closed and removed from the scan allowlist.
- Known and not changed: an office user may still edit a request's requested amount (the "full edit" of the request, audited `EDIT_PAY_ADJUSTMENT`) and then approve up to it; the Decided tab Change amount dialog has no override control, so an administrator above-request correction is made from the decision panel or Finance (the server accepts `overrideAboveRequest` there).
- Tests run and passing: `tsc --noEmit -p .` clean; the new and changed files listed in SYSTEM.md; every existing test file mentioning pay adjustments, pay requests, extra pay, approvals or client approvals (68 files) plus `tests/lib/server-client-value-imports.test.ts`, `tests/lib/no-left-accent-lines.test.ts`, `tests/components/tone-band.test.tsx`; the DB test on a fresh disposable `sneek_payrule_test` (migrate deploy applied all, `migrate diff --exit-code` no difference).
- Not run (as instructed): production build, full suite, browser pass at 390/1280 light/dark. Deployment not verified.

## Admin phone layout: shared shell and primitives, Command and Jobs (2026-11-13)

Owner approved the admin phone boards. This part builds the shared phone behaviour (below 640px) and applies it to Command and Jobs. Details: `docs/SYSTEM.md`, "Admin phone layout"; rules for other pages: `docs/style/operational-ui.md`, "Phone layout".

- Shell: admin phone bar is Command, Jobs, Calendar, Approvals, More. More is a bottom sheet built from the rail's own filtered entries (role, permission packs, `adminOnly`), grouped like the rail, with badges, "Find a page" and a dot on the tab. The drawer's menu button is hidden below 640px for admin only. From 640px up to the rail the old bar (with Properties) and the drawer are kept, a deliberate choice so 640px+ stays unchanged; the requested `hideMobileMenuButton` prop would have hidden the drawer at 640–1023px too.
- Approvals badge: verified that the existing `approvals` attention count is the sum of all fifteen Approvals queues (`lib/admin/attention-counts.ts`); unchanged.
- Primitives: listed in SYSTEM.md. All phone changes are `max-sm:` classes or phone-only components; existing component tests still pass unchanged.
- Tests run and passing: `tsc --noEmit -p .` has no error in any file of this change (the last run reported one error in `lib/gps/tracking-window.ts`, another session's work in progress, not touched here); new `tests/components/phone-primitives.test.tsx` (11), `tests/components/phone-more-sheet.test.tsx` (9), `tests/components/jobs-command-phone.test.tsx` (3); the whole `tests/components` directory (231 files, 1823 tests) before the new files, then the touched-area files again after; `tests/lib/server-client-value-imports.test.ts`, `tests/lib/no-left-accent-lines.test.ts`, `tests/lib/portal-navigation.test.ts`.
- Not run (as instructed): production build, full suite, browser pass at 390/1280 light/dark. Nothing was inspected visually; jsdom does not apply CSS, so the `max-sm:` layouts (docked bars, sheets, card grid, hidden checkboxes) are checked only by class assertions. Deployment not verified.
- For the browser pass: the docked bulk bar and New job bar over the last list item and over iOS safe areas; the More sheet height on short phones; Jobs filter sheet with long client lists; the side panel scroll restore after closing; that 640–1023px still shows the drawer and the Properties tab; EModal/EConfirmModal sheets with the PIN fields and the keyboard open.

## Scheduling rules: visible, locked, versioned (2026-11-14)

Owner request: show the laundry and job auto-scheduling rules, make them changeable, keep them exactly as they are, locked, backed up, with undo and restore. Details: `docs/SYSTEM.md`, "Scheduling rules: visible, locked, versioned".

- Zero behaviour change: literals moved unchanged to `lib/scheduling-rules/constants.ts`; version 1 is seeded from the live settings on first read (never by the migration). Proved by `tests/lib/scheduling-rules-parity.test.ts` (41), `tests/lib/scheduling-rules-runtime.test.ts` (12) and by every existing test file covering the touched code passing with no expectation change (planner, key-lost, plan protection, plan approval, sync paths, iCal times, reminders, nudges, auto-pause, ops producers, day reminders, missed clock-in, deep clean, dispatch, worker registration, access parity, sensitive grants, wording store, settings routes, laundry DB tests).
- Quirks kept and shown on the screen, not fixed: cancelled jobs count as the next clean and as iCal same-day conflicts; recurring window starts on the UTC date; planner dates depend on the process time zone; `maxOutdoorDays` drives two rules; the no-due-time expected-finish display keeps 15:00.
- Locked flow: `scheduling.rules_edit` grant capability and sensitive action (ADMIN only by default), own PIN to unlock (15 min) and again to publish, reason, reviewed dry run, two-step confirm, effective day from tomorrow, stale check (409), 10-minute cool-down (429), pre-publish snapshot, audit. Existing runs and jobs keep their version unless "re-plan" is ticked.
- Safety of the old paths: `saveAppSettings` now reads and writes in one transaction under an advisory lock and always keeps the rule-owned fields, so the generic settings PATCH (reports `schedulingRulesIgnored`) and the whole-blob settings restore cannot change them. Behaviour change for unrelated settings: a database read failure during a generic save now fails the save instead of merging the request over defaults.
- Migration `20261114010000_scheduling_rule_versions` (additive): `migrate deploy` on a fresh `sched_rules_fresh` and on the existing `sneek_ui` (which also received the other session's `20261114020000_live_location_tracking`), repeated with "No pending migrations", `migrate diff --exit-code` "No difference detected" on both.
- DB tests on `sched_rules_fresh` with `--no-file-parallelism`: `tests/db/scheduling-rules.test.ts` (7) and the existing laundry, own-PIN and stock DB tests (33) pass.
- Not run (as instructed): production build, full suite. No browser pass at 390/1280 light/dark was done (no server was started in this shared tree); the screen is covered by jsdom tests only (`tests/components/scheduling-rules-workspace.test.tsx`). Deployment not verified.
- For the browser pass: the unlock PIN prompt and the publish confirmation on a phone with the keyboard open; long rule sentences and quirk notices at 390px; the review panel's sample lists; the file input on iOS; dark mode tone bands on "Changed in your draft" cards.
- Owner action after deploy: open Settings › Operations › Scheduling rules once (or let the first worker tick / iCal sync do it) to create version 1 from the live settings; check it reads as expected; download a first backup.

## Admin phone layout: Access, Notifications, Suppliers, Approvals, Settings home, Activity log, Growth (2026-11-13)

Boards M-Permissions, M-Notifications, M-SuppliersApprovals, M-SettingsActivityGrowth. Details: `docs/SYSTEM.md`, same title.

- Layout only, below 640px; from 640px up the same markup (desktop branches are unchanged, phone parts are gated by `useIsPhone` or `max-sm:`). One extra element exists at every width from the shared `EFilterBar` (its hidden phone Filter button) and, on Activity, a `sm:hidden` "More activity actions" menu.
- Access level sheet reuses `AccessLevelControl`/`AccessCapabilities`; a test proves the phone save payload equals the desktop matrix payload. A bug found while testing was fixed before delivery: the sheet closed when a folded area changed level (row remount); the sheet state is now held by the list.
- Approvals phone bulk total sums the same asked amounts the existing confirm dialog sums (UI arithmetic already present there, not new policy).
- Tests: the four new `tests/components/admin-phone-*.test.tsx` files (20 tests) and every existing test rendering a touched component (access, role reference, approvals workspace and deep link, bulk pay, notifications area, type group filter, wording editor, notification tools, own PIN prompts, pay request amount, settings home, laundry partner entries, office actions, live ops follow-up, phone primitives) pass; `server-client-value-imports` and `no-left-accent-lines` pass; `tsc` clean.
- Not run (as instructed): production build, full suite, servers. No Chromium pass at 390/1280 light/dark was done; deployment not verified.
- For the browser pass: the docked Access unsaved bar over the last area row and the PIN sheet with the keyboard open; the level sheet radio row at 320px; notification editor field widths and the variable chips; supplier card band in dark mode; the approvals queue sheet height (tall) and the bulk bar over the last card; Settings home order with `display: contents`; Activity filter sheet submit (GET navigation) and the full-screen detail scroll restore; Growth action bar over the Outbound messages block.

## Admin phone layout: Calendar, Cases, Lost and found, Invoices and pay, invoice editor (2026-11-13)

Boards M-CalendarLiveOps (Calendar only), M-CasesLostFound, M-Money, M-InvoiceEditor. Details: `docs/SYSTEM.md`, same title.

- Layout only, below 640px; desktop branches unchanged, phone parts gated by `useIsPhone` or `max-sm:`. Elements present at every width: the shared `EFilterBar`'s hidden Filter button (calendar, client invoices, lost and found) and wrapper `div`s with ids around the editor's checks / send / Xero / history cards and `max-sm:hidden` wrappers around the editor fields and lines table.
- One read changes on a phone only: Calendar Day view requests its week (the range Week already uses) so the week strip can count each day; the agenda still lists only that day.
- Calendar move sheet calls `/api/admin/calendar/check-move` with the drag's request and saves through `useCalendarMove().confirm` (proved for assign and for reschedule with `toStartTime`; refusals save nothing). Invoice total bar: Review → Approve (PATCH status) on a draft, Send on approved (existing dialog), Record payment on sent. Line Move up uses the existing `reorderLineIds` save within the property section.
- Tests: `tests/components/calendar-phone.test.tsx` (8), `invoice-editor-phone.test.tsx` (8), `admin-phone-money-cases-lost-found.test.tsx` (10), and every existing test rendering a touched component (calendar workspace and touch/time restore, invoice editor page, invoice list and row actions, money wave D, summary/generation, client finance reliability, pay request amount, cases inbox and refresh/QA, lost-found photo/format, approvals workspace, cleaner invoice review, cadence settings, editor rules, case queues, calendar rules, editor route): 31 files, 296 tests pass. `server-client-value-imports` and `no-left-accent-lines` pass; `tsc` clean.
- Not run (as instructed): production build, full suite, servers. No Chromium pass at 390/1280 light/dark was done; deployment not verified.
- For the browser pass: week strip width at 320px; the move sheet with the keyboard open (date/time inputs, iOS time picker step); the docked total bar over the last line card and the bulk bar over the last invoice card; the section switcher's sticky offset under the admin header (`top-16`); the Invoice details sheet holding the draft fields; case switcher plus composer height; Filter sheets with date inputs; pay adjustment ⋯ menu position near the bottom of the screen.

- Follow-up (same day): a cleaner's laundry update or submission now always commits when the rules cannot be read (run not planned, `LAUNDRY_RUN_NOT_PLANNED` audit, job page Laundry stage notice, hourly retry plans the run and replays the outcome); the Safeguards save merges `qaAutomation` (no more reset of `assignedOnly`/`createIssueTicket`). Verified: `tsc` clean; `tests/db/scheduling-rules-cleaner.test.ts` plus the laundry and rules DB tests on `sched_rules_final`; 35 affected unit/route/component files incl. both scans; `tests/lib/settings-qa-automation-merge.test.ts`. No browser pass.

## Admin phone layout: Job page, Properties, People, Quotes and Messages (2026-11-13)

Boards M-JobDetail, M-Properties, M-People2, M-QuotesMessages. Details: `docs/SYSTEM.md`, same title.

- Layout only, below 640px; desktop branches unchanged. Phone parts are gated by `useIsPhone` or `max-sm:`; `PhoneFold` and `PhoneCarousel` render their children unwrapped until the viewport is known to be a phone. Elements present at every width: the shared `EFilterBar`'s hidden Filter button, the sticky phone title row and the end-of-page spacer on the job page (`sm:hidden`), `id` attributes added as section-switcher targets (`job-details`, `quote-step-*`, `quote-status`) and wrapper divs around the quote builder sections (no visual change). The job header keeps its first-child spacing with `sm:!mt-0` because the phone title row now precedes it.
- Job "Send back for rework" on a phone links to the Submitted stage instead of opening from the docked bar: the bar's backdrop blur would trap the non-portaled `EModal` inside it. The stage carries the same button.
- Tests: `tests/components/job-page-phone.test.tsx` (10), `tests/components/admin-pages-phone.test.tsx` (7), a new case in `messages-page.test.tsx`, and every existing test rendering a touched component (job header actions, job disclosure, client visibility, cleaner job workspace, legacy draft boundary, messages, people directory, property pending tasks, quote autosave and full page, property deep links and portfolio rules, people rules and routes, quotes pipeline, account emails, person panel, owner decisions dialogs, growth summary): pass. `tests/lib/server-client-value-imports.test.ts` and `tests/lib/no-left-accent-lines.test.ts` pass. `npx tsc --noEmit` passes. `tests/db/people-directory.test.ts` not run (needs the disposable database; other DB work may be using it).
- Not run (as instructed): production build, full suite, servers. No Chromium pass at 390/1280 light/dark was done; deployment not verified.
- For the browser pass: sticky stack on the job page (app bar, title row, section switcher at `top-[6.75rem]`) and `scroll-mt-44` landings; the docked job bar with three controls at 320px; the job More sheet height with long Danger zone reasons; property / client / person sticky tabs over content in dark mode; assistants cards with both menus; the quote total bar text truncation with long autosave states; the Messages bar not covering the reply box.

## Live location: tracking window, notice, reliable capture, office views (2026-11-14)

Details: `docs/SYSTEM.md` A8, same title. Defaults pending owner confirmation (the owner did not answer; recorded to the owner): Live ops on the Dashboard pack with in-route filtering (drivers: Laundry, continuations: Approvals, actions: Jobs at manage); location mandatory to start with a versioned recorded notice, never blocking finishing; cleaners from on the way to clock-out on today's job, never paused without their own clock, never impersonated; drivers only on an ACTIVE route today; client sees the cleaner on the way only with `Client.showCleanerLiveLocation` (default off); 7-day retention incl. maintenance pings; `mobile-app/` untouched.

- Defects from the investigation fixed: geofence judged an arbitrary assignment (now the ping's job, tracked status, property radius, accuracy, hysteresis — shared by ingest, departure, Live ops, board, job badge); phone clock skew dropped every fix (now corrected with `sentAt`; backlog stored as history, never live; named drop reasons); tracking ran while paused and on old jobs (window enforced on every ingest route and probe); laundry pings accepted without a route and anchored to unrelated jobs (ACTIVE route required, tagged with the route); one teammate's stale ping classified a team job (per-cleaner); in-memory `distinct` on every poll (UserLastLocation); stream missed late flushes (cursor on receive time); Live ops on the System pack (Dashboard); office laundry Live tab showed the viewer's own route and "Share GPS" (driver map); impersonated sessions recorded the admin's location as the cleaner's (refused in tracker, ingest, check-in, check-out, start); teammates and resumes bypassed the off-site gate (per-segment gate); driver capture stopped on any GPS error and had no queue (shared tracker); driving mode doubled capture and claimed location stopped while paused; classic page re-stamped old fixes as now; the "location off" banner was never rendered; auto clock-out notice reached administrators only by direct delivery (pipeline, OPS_MANAGER with Jobs pack); client saw the cleaner's position with no switch; maintenance pings were kept forever; nobody was told they were tracked.
- Schema: migration `20261114020000_live_location_tracking` (additive): `LocationPingSource` enum; `CleanerLocationPing.receivedAt` (backfilled = timestamp), `source` (LAUNDRY users' rows backfilled LAUNDRY_ROUTE), `clientId` with unique (userId, clientId), `laundryRouteId`, indexes on receivedAt and timestamp; `UserLastLocation` backfilled from the newest retained ping per person; `LocationTrackingNotice`; nullable `TimeLog.start*/stop*`; `Client.showCleanerLiveLocation` default false.
- Migration verification on loopback PostgreSQL 55439 (user `sneek`): fresh `liveloc_fresh` — `migrate deploy` applied all migrations, repeat "No pending migrations", `migrate diff --from-url … --to-schema-datamodel prisma/schema.prisma --exit-code` "No difference detected". Existing data: `liveloc_existing` built from every migration before this one (schema from HEAD), seeded with pings for a cleaner and a laundry user, a job, two time logs and a client; checksums of ping/job/timelog/client rows identical before and after deploy; backfill checked (UserLastLocation newest per person, LAUNDRY_ROUTE source, receivedAt = timestamp); repeat deploy no pending; diff no difference. `sneek_ui` had already received this migration from another session's deploy (checksum matches the file); deploy repeat no pending, diff no difference, row checksums unchanged. `npx prisma generate` run.
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .` passes.
- Tests: new `tests/lib/live-location-pure.test.ts` (23: tracking window incl. impersonation, old jobs, paused without clock, drivers; geofence policy; skew/backlog/drop reasons; staleness; tracker decisions; stream cursor; ops-manager access with and without each pack; per-segment start location; map grouping), `tests/lib/live-location-services.test.ts` (9: geofence job selection/accuracy/radius; notice acknowledgement incl. version and impersonation; client switch default off; indicator wording; JOB_OFFICE scope by Jobs pack), `tests/db/location-ingest.test.ts` (4, DB: idempotent ingest, forward-only last location, reported state and refusal after clock-out, segment stop location once). Extended: live board (per-cleaner, approximate never off site, pack filter), tracker lifecycle (permission-off report, hide keepalive flush, window closed, Retry restart, 429 retained), start route (notice, fix or tag, per-segment off-site gate, impersonation). Updated because they encoded the old behaviour on purpose: `ops → system` (command-section-route, command-sections tiles), tracking under impersonation and the bare-array body (gps-tracker-lifecycle), PAUSED tracked without a clock and impersonation tracked (cleaner-active-job, cleaner-active-job-route), old ping route internals (audit-authorized-operations, portal-follow-up-guards), live trip without a client switch (client-job-projection), start without a fix (start-preserves-briefing, db/cleaner-action-receipts), checkout payload, live positions staleness, laundry live and worker mocks. Run green: 45 related files (531 tests) incl. both scans (`server-client-value-imports`, `no-left-accent-lines`), notification catalog and wording parity; 24 further files touching changed code (215 after the projection update); DB files `checkout-location`, `cleaner-action-receipts`, `location-ingest` on disposable `liveloc_fresh` with `--no-file-parallelism`.
- Not run (as instructed): production build, full suite. No Chromium pass at 390/1280 light/dark (no server started in this shared tree): the notice dialog, indicator, driver map, trail control and segment list are covered by jsdom/unit tests only. Real-device GPS (background, permission revoke, iOS/Android) not tested; Google Maps rendering not checked; no external message sent (pipeline mocked in tests). Deployment not verified.
- For the browser and device pass: notice dialog length and buttons at 390px with dark mode; indicator band under the cleaner header and in the laundry shell (no overflow); "Location is off" + Retry after revoking permission mid-job (finishing must still work); Live ops rings/grouping/trail button over the person card; laundry Live tab map + list at 390px; job page segment rows at 390px; resume after a pause asks for a fix and the off-site prompt for a teammate; driving mode "On my way" with the notice; route builder "Start route"; hide/return the tab and see "App in the background" in Live ops.
- Owner actions after deploy: tell cleaners and laundry drivers that location is now required to start and shown while they work (the notice appears at their next start and is recorded); decide per client whether to switch on "Show the cleaner's live location while they are on the way" (off for everyone); confirm or change the six defaults; consider the NSW Workplace Surveillance Act notice requirements with your adviser (written notice before tracking starts); check managers' packs — Live ops now follows Dashboard, so a manager with Dashboard but not System now sees it, and one without Dashboard no longer does.

## Admin phone layout: Stock, Quality, Insights, Forms library and Template builder (2026-11-13)

- Scope: boards M-LaundryStock (Stock only; Laundry admin pages untouched), M-PeopleQuality (Quality only; People untouched), M-InsightsForms. Below 640px only; from 640px up the markup is unchanged apart from `max-sm:hidden` on desktop-only wrappers and the sanctioned `EFilterBar` / `CollapsibleFigures` wrappers. No request, permission, data or wording change; the builder's draft, autosave, undo and version logic is unchanged (presentation and navigation only). Details in `docs/SYSTEM.md`, "Admin phone layout: Stock, Quality, Insights, Forms library and Template builder".
- New: `components/v2/admin/phone-stacked-table.tsx`, `phone-back-bar.tsx`; `quality/hub/cleaners-phone.tsx`; `forms/library/forms-header-actions.tsx`, `forms-groups-picker.tsx`; `forms/builder/builder-phone.tsx`. `ImportFormsButton` gained `openRequest` / `hideTrigger`; `NewFormMenu` items are shared via `newFormItems`; the builder's settings editor JSX is built once and rendered in the desktop pane and the phone editor.
- Tests added: `tests/components/admin-phone-stock.test.tsx` (filter sheet, docked Report a need, gear, need-screen actions and menu, stacked tables, desktop unchanged), `admin-phone-quality.test.tsx` (cleaner cards → cleaner screen with rating mix, categories and issue actions, Start coaching dialog; issue card actions; one filter sheet incl. status filters; desktop table, columns and inline filters unchanged), `admin-phone-insights-forms.test.tsx` (Insights ⋯ with Export and Email monthly; Forms ⋯ Import opens the same dialog, docked New form, groups picker; builder stacked navigation, section Move down equals `moveSectionBy`, question Move up, the phone editor's draft PUT schema equals the desktop one for the same edit, every header action in ⋯ with Test/Publish docked, Add a question sheet; desktop panes unchanged). Run green with every existing test rendering a touched component (urgent stock, quality hub ×6, insights ×2, forms authority/bulk, builder drafts, held stock, operations integration, Wave F, suppliers phone) and both scans (`server-client-value-imports`, `no-left-accent-lines`): 25 files. TypeScript: no errors in touched files (errors remain in other engineers' in-progress laundry, AI and client-portal files).
- Not run (as instructed): production build, full suite, servers. No Chromium pass at 390/1280 light/dark.
- Known gap: a modal `EBottomSheet` cannot host portalled menus or confirmation dialogs (Radix disables outside pointer events), so the Forms groups picker is an in-page disclosure rather than the drawn sheet.
- For the browser pass: Urgent needs filter sheet and docked bar over the last card; need screen foot bar inside the full-screen panel (safe area, history above it, Withdraw ask inline); stacked Stock tables (long item names, action cells, empty rows); Quality cleaner screen with the docked action above the tab bar and IssueDetail / coaching dialogs opening over it; issue card "⋯" menu position; Insights ⋯ sheet links (CSV download from the sheet); Forms docked New form menu opening upwards; groups picker disclosure; builder screens at 390px: outline arrows, QuestionsPane header row wrapping, bulk bar vs docked Test/Publish, PropertiesPanel height inside the editor screen, Add a question sheet, preview frame width, InlineFormName rename in the narrow header, dark mode for all of the above.

### Follow-up: start without a location fix (2026-11-14)

- Split: permission refused or notice not accepted → refused (unchanged). Permission granted and notice accepted but no fix after the normal attempt (TIMEOUT / UNAVAILABLE / UNSUPPORTED) → allowed with a required reason (3–200 chars; quick choices or typed); recorded on the segment as `NO_FIX` with the device error (clock-in/resume), audited for on the way and route starts; office told by inbox (`location.start_without_fix`, JOB_OFFICE); first later live fix stored as a late start location (`GPS_LATE`, `TimeLog.startLocationAt`; route: `LAUNDRY_ROUTE_LATE_FIX` audit); shown as "Started without a location fix" on the job page and Live ops, never on/off site. Off-site reason gate unchanged; nothing new rate-limited.
- Migration `20261114041000_timelog_late_start_location` (one nullable column): deployed on `liveloc_fresh` and `liveloc_existing` (with the other sessions' new migrations), repeat "No pending migrations", diff "No difference detected", seeded row checksums unchanged; `prisma generate` run. Not deployed to `sneek_ui` by me.
- Tests: start route (no-fix allowed with reason, audit and office notice; PERMISSION_DENIED, empty reason and unaccepted notice refused), new `tests/components/location-gate.test.tsx` (5: fix, permission refused, notice, no-fix with chosen reason, Other typed and cancel), DB `location-ingest` (late start location once, backlog never qualifies, route late fix once). Re-run: 46 live-location files incl. both scans (538 tests) and the other 24 files touching changed code (218 tests), DB files on `liveloc_fresh` (34). tsc: no errors in my files; the remaining errors are in other sessions' in-progress files (`lib/ai/provider/generate.ts`, `lib/laundry/run-page-load.ts`, `app/v2/admin/laundry/runs/[id]/page.tsx`).
- For the device pass: the no-fix dialog at 390px with the keyboard open (Other), a real indoor timeout, and the late location appearing on the job page.

## Admin phone layout: Live ops (2026-11-14)

Board "Admin phone: Calendar and Live ops" (Live ops half). Details: `docs/SYSTEM.md`, same title.

- Layout only, below 640px; from 640px up the same markup (phone parts gated by `useIsPhone`; the list/map split and carousels are `max-sm:` classes). No `components/v2/ui` primitive changed; reused `EFilterChips` (carousel), `PhoneActionSheet`, `useIsPhone`, `isPhoneNow`.
- Placed differently from the drawing: the map screen keeps the page header and the List / Map switch rather than a separate "‹ Live map" back bar (the page has one h1; the switch is the way back); the person card's Tell client opens the job's Messages tab — the confirmed delay notice stays on the late exception row, where its dialog already lives; the drawn "Safety confirmed" line on the driver row is not shown because the board has no safety data per driver; the map legend keeps the shared staleness wording ("Live < 3 min") rather than the drawn "Fresh < 2 min".
- Tests: `tests/components/admin-phone-live-ops.test.tsx` (5: list/map screens, chips and layers reachable, every exception action reachable on the card or under More incl. Reassign and Review clock, person card actions, unchanged from 640px up), plus `live-ops-feed`, `live-ops-follow-up`, `live-feed-and-redirect`, `phone-primitives` and both scans — 7 files, 44 tests pass. tsc: no errors in touched files (one error remains in another session's `components/v2/admin/settings/settings-navigation.tsx`).
- Not run (as instructed): production build, full suite, servers. No Chromium pass at 390/1280 light/dark; Google Maps not rendered in tests.
- For the browser pass: the map becoming visible after being laid out hidden (grey tiles until the re-fit; check `refitKey`), the docked person card over pins and the trail controls at 390px, the header with the switch, stream pill, layer chips and Plan routes wrapping, the More sheet over the bottom tab bar, and the late row's tinted background in dark mode.

## AI provider layer (2026-11-14)

Step 1 of the AI rebuild (owner: "rebuild the AI photo verification and all related to AI… allow to change the model local/cloud… connect Hermes or Claude"). Design and rules: `docs/SYSTEM.md`, "AI provider layer". Defaults pending owner confirmation: cloud photo sending off per feature; providers Anthropic, OpenAI, OpenAI-compatible https, local Ollama; only administrators change AI settings.

- Built: `lib/ai/provider/` (routing schema and resolution, `generateStructured`, adapters, encrypted keys, shared rate limits, `AiCall` audit, monthly usage, stamp masking, `AiTask` worker queue), routes `/api/admin/ai/settings` (GET/PUT with revision guard), `/api/admin/ai/credentials` (password, encrypted), `/api/admin/ai/tests` and `/tests/[id]` (queued real tests), Settings "AI" category and `components/v2/admin/settings/ai-section.tsx`, pg-boss job `ai-tasks`. Photo comparison, photo assignment, notification wording and the social composer moved onto the layer; prompts, schemas, thresholds and the reviewer approval route are unchanged.
- Defects fixed: the Anthropic text paths (composer, wording) sent no structured-output schema; the composer sent no system prompt. A deselected-provider failure on a queued photo review now keeps its specific reason.
- Behaviour changes by owner rule: photo features on a cloud provider are unavailable until "Allow photos to go to a cloud provider" is switched on for that feature (existing OpenAI/Anthropic photo setups stop sending photos until then); 429/5xx are retried at most twice (previously never; `tests/lib/openai-vision.test.ts` updated to the new rule); an invalid answer gets one repair request (two OpenAI test fixtures now answer the repair the same way).
- Migration `20261114040000_ai_provider_layer` (tables `AiCall`, `RateLimitWindow`, `AiTask`; append-only trigger on `AiCall`; additive). `prisma migrate deploy` on fresh `ai_layer_fresh` (all migrations applied) and on existing `sneek_ui` (applied `20261114040000_ai_provider_layer` together with another engineer's `20261114041000_timelog_late_start_location`); both repeated with "No pending migrations"; `prisma migrate diff --from-url … --to-schema-datamodel prisma/schema.prisma --exit-code` reported "No difference detected" for both. The trigger refused UPDATE and DELETE in psql. `npx prisma generate` run.
- Tests: new `tests/lib/ai-provider-generate.test.ts` (22: routing order, deselection, refusals with audit, reserved features, images refused for cloud/allowed for Ollama/synthetic flag, stamp blacked out for cloud only, one repair without echoing the answer, retry rules, Ollama never retried, audit fields without prompt or image bytes, cost estimate never $0 when unknown), `tests/lib/ai-stamp-mask.test.ts` (3, geometry pinned to stamp.ts), `tests/lib/ai-provider-credentials.test.ts` (7: environment fallback, encrypted round trip, last-four only, audit without key, fail closed without ENCRYPTION_KEY, planted plaintext refused, revision guard and audit, invalid routing refused), `tests/api/ai-settings-routes.test.ts` (8: password, impersonation, non-admin, attempt limit, no ENCRYPTION_KEY, 409 with current, test queue ownership), `tests/components/ai-settings-section.test.tsx` (5: defaults shown, unknown cost not $0, stale save keeps draft and both resolutions, failed key save keeps typed key and clears password, queued test polled to completion, read failure with Retry), `tests/db/ai-provider-layer.test.ts` (3, on disposable `127.0.0.1:55439/ai_layer_fresh`: 25 concurrent reservations allow exactly 10, AiCall append-only, queued test processed once and readable only by its requester; its AiCall rows stay in the disposable database because the table is append-only). Existing tests gained only a store test double (`tests/helpers/ai-provider-store-mock.ts`) or a key-aware database mock; no assertion was removed. Run together with every existing AI, photo-review, wording, composer, Ollama, submission, settings-navigation file and both scans: **46 files, 639 tests passed**. `tsc --noEmit` passed.
- Not done in this step: Chromium pass at 390/1280 light/dark (not run; UI checked only through component tests), real provider calls (none made; no credentials used), production build and full suite (not run, as instructed). Photo assignment still waits inside the request (bounded) rather than on the worker.

## Laundry run full page, Change state and Void (2026-11-14)

- Scope: owner request to void skipped or flagged laundry runs (off the schedule and invoices), to mark what actually happened on a run, and to open each run as a full page. See docs/SYSTEM.md "Laundry run full page, Change state and Void (2026-11-14)". Left uncommitted.
- Defaults pending owner confirmation: Change state for ADMIN and OPS_MANAGER with Laundry at manage; Void and Undo void ADMIN only with own PIN (administrator capability `laundry.void`, grantable like the other administrator capabilities); voidable = Skipped, Flagged, or a failed pickup still Pending or Confirmed; locked once on an emailed laundry report; voided runs leave the partner's Invoices too; replacement run not built.
- Enforcement: routes `POST /api/admin/laundry/runs/state`, `/runs/void`, `/runs/void/undo`, `GET /runs/done-by` (live `requireRole` + `requireCapability`; void and undo also `verifySensitiveAction` with the actual actor); service `lib/laundry/run-corrections.ts` (row lock, version check, correction row, audit with actor, role and the administrator behind Test-as); DB CHECK `LaundryTask_void_complete_check`; guards in the planner, cleaner status, status route, admin PATCH, both delete routes, planned times and bag custody.
- Query audit: every `LaundryTask` read was decided (explicit `voidedAt: null`, already excluded as SKIPPED_PICKUP, shown as Voided, or shown as skipped); the list is in docs/SYSTEM.md.
- Migration `20261114030000_laundry_run_void`: `prisma migrate deploy` on a fresh `createdb laundry_void_fresh` and on the existing `sneek_ui`, repeated with "No pending migrations"; `prisma migrate diff --from-url … --to-schema-datamodel prisma/schema.prisma --exit-code` reported "No difference detected" on both at the time. Later diffs show only other sessions' in-progress models (AiCall, RateLimitWindow, AiTask, SubmissionMedia.capturedAt), not touched here. `prisma generate` run.
- Tests run: `tsc --noEmit` (clean except other sessions' errors in `lib/ai/provider/store.ts` and `components/v2/admin/settings/settings-navigation.tsx`); new `tests/lib/laundry-run-corrections.test.ts` (34), `tests/components/laundry-run-actions.test.tsx` (4), `tests/db/laundry-run-void.test.ts` (8, PostgreSQL 55439, `--no-file-parallelism`); every laundry unit, component and API test file, scheduling parity and runtime tests, access parity, delegated guardrails, capability tests, job page tests, calendar tests and both scans: 699 of 700 pass; the one failure is `tests/components/estate-suppliers-laundry-partners.test.tsx` (Suppliers phone layout, "multiple Needs attention buttons"), in files not touched here. Laundry, scheduling, access and PIN DB suites pass on the disposable database.
- Not done: Chromium pass at 390px and 1280px, light and dark (not run in this step); production build and full suite (not run, as instructed); no real external messages (the inbox notice is mocked in tests).
- Risks for the browser pass: the run page's header, stage bar and seven facts at 390px; the Change state sheet height on a phone; the ⋯ menu on lane cards beside the existing request buttons; the phone lane segmented control; the "Voided N" chip only appears when runs were voided in the last 30 days.

## Photo integrity checks (2026-11-14)

Step 2 of the AI rebuild; design in `docs/SYSTEM.md`, "Photo integrity checks".

- Built: `lib/media/photo-integrity.ts` (sha-256, stamp-insensitive 64-bit difference hash, minimal EXIF DateTimeOriginal/OffsetTimeOriginal reader), `lib/media/photo-integrity-queue.ts` (pg-boss `media-integrity`), `lib/media/photo-integrity-flags.ts`, `GET /api/qa/jobs/[id]/photo-integrity`, `components/v2/qa/photo-integrity-flags.tsx` (lazy disclosure inside the photo review panel; the admin job page file was not edited).
- Migration `20261114050000_photo_integrity` (six nullable `SubmissionMedia` columns, three indexes; no backfill in SQL). `prisma migrate deploy` on a fresh `ai_integrity_fresh` (every migration applied), and on existing `sneek_ui` and `ai_layer_fresh` (applied `20261114050000_photo_integrity`); each repeated with "No pending migrations"; `migrate diff … --exit-code` "No difference detected" for all three.
- Tests: `tests/lib/photo-integrity.test.ts` (6: exact hash, re-stamped and re-encoded picture within 2 bits while a different picture differs by more than 6, Hamming edge cases, EXIF with offset and without offset in the business zone, no camera data means no capture time, non-image refused), `tests/lib/photo-integrity-flags.test.ts` (6: same file and near-identical in the job, reuse from an earlier clean scoped to the property and excluding the job, clock window with grace and only for recorded camera times, unchecked and unreadable photos kept visible, no submission; worker stores facts and fixed reasons for unsupported and unreadable photos), `tests/api/photo-integrity-route.test.ts` (3: office roles, inspector assignment and hidden links, refused roles), `tests/components/photo-integrity-flags.test.tsx` (3: no request until opened, flags and unchecked photos shown, reset on job change, retry on failure). Existing photo review panel and route tests pass unchanged.
- Limits: most stamped evidence carries no camera time (the stamp re-saves photos without EXIF), so the clock comparison rarely applies until the device reads the camera time before stamping (not built). Near-identical thresholds are strict (2 of 64 bits) to avoid flagging the same spot photographed every clean; that also means a heavily cropped or edited reuse may not be flagged. Not run: Chromium pass, production build, full suite.

## AI photo verification rebuilt (2026-11-14)

Step 3 of the AI rebuild; design in `docs/SYSTEM.md`, "AI photo verification rebuilt". No schema change.

- Built: `checkFieldPhotos` and the field-check schema (`lib/ai/vision.ts`), the per-field queue (`lib/ai/photo-review.ts`), configurable deduction points (`minorPoints`/`majorPoints` in `ai_vision_v1`, read from each review's snapshot), `FormField.aiCriteria` with one targeted addition to the builder's Example media section (`components/v2/admin/forms/builder/properties-panel.tsx`), the agreement report (`lib/ai/photo-review-evaluation.ts`), per-property opt-out (`lib/ai/photo-review-opt-out.ts`, `/api/admin/ai/photo-review-opt-out`, `components/v2/admin/photo-review-opt-out.tsx`), review panel outcomes, reasons, criteria, confidence band, numbered region boxes and quiet 5-second polling. Photo check settings saves are now audited and refused while testing as someone.
- Approval route: only the deduction call now passes the review snapshot's points; every rule is unchanged (`tests/api/qa-photo-review.test.ts` passes unchanged apart from a settings read in its transaction double).
- Tests: `tests/lib/photo-review-field-checks.test.ts` (17: schema accepts meets/issue/cannot tell with reason and refuses six malformed answers and missing photos; one request per field with neutral ids, criteria as quoted data and the snapshot model; deselected provider refused before any request; criteria-only field checked; outcome, region, band, reference key and reason stored; field with nothing to judge against not checked without a request; opted-out property stopped with the reason and never queued; unreadable opt-out list queues nothing; default points identical to the original rule over 500 generated cases; configured points; agreement labels per model with no default percentage), `tests/components/photo-review-field-checks-panel.test.tsx` (3: outcomes, reason, criteria, band and region box geometry; preview uses the review's points; polling every 5 s without a loading flash, stopping once ready), `tests/api/photo-review-opt-out.test.ts` (3: revision guard, audit and queue view; unknown property, impersonation and non-admin refused, office read; unreadable list fails closed). Existing queue test switched its provider double from per-photo comparison to per-field checks with the same assertions (`tests/lib/photo-review-queue.test.ts`); the vision settings route test now expects the actor on save.
- Whole AI set run together after step 3: **56 files, 736 tests passed**; `tests/db/ai-provider-layer.test.ts` on the disposable database passed again (3). `tsc --noEmit` passed after each step.
- Not done: Chromium pass at 390/1280 light/dark (only component tests), real provider calls (none; accuracy on real photos unmeasured), production build and full suite (not run, as instructed). The confidence-band numbers (0.4/0.7/0.9) and the strictness of "high only" by default are defaults pending owner confirmation.
- Steps 4 to 6 (agent identity, MCP read tools, write tools with approvals, OAuth) are not built; the design, including `AgentActionRequest`, is in `docs/SYSTEM.md`, "Agent connection (Hermes, Claude): design, not built yet".

## Agent connection: read-only MCP server, tokens, Settings › Access › Agents (2026-11-14)

Step 4 of the AI rebuild, from main at `e6805be`; design and rules in `docs/SYSTEM.md`, "Agent connection (Hermes, Claude)". Defaults pending owner confirmation: ADMIN only with own PIN, never while testing as someone; never wider than the creator's live access; tokens shown once, hashed, expiring, revocable at once; reads only, no approvals needed; no write tools.

- Built: `lib/agents/` (`scopes.ts`, `access.ts` token hashing and live authentication, `tools.ts` twelve read tools, `mcp.ts` JSON-RPC MCP server, `admin.ts` create/rotate/revoke/pause/list, `admin-http.ts` ADMIN + own PIN guard), `POST /api/agent/mcp` (GET/DELETE 405), `/api/admin/agents` and `/api/admin/agents/[id]`, page `/v2/admin/settings/agents` with `components/v2/admin/settings/agents/agents-workspace.tsx`, settings catalog entry under Access.
- MCP: implemented directly (JSON-RPC 2.0, Streamable HTTP with JSON responses, stateless); `@modelcontextprotocol/sdk` was not added.
- Deviation from the earlier design: agents are not `User` rows (no sign-in path, not in people lists); `AuditLog` gained no columns because there are no agent writes yet; administrator actions are audited under the administrator. No IP allowlist yet. `AgentActionRequest` is left for step 6 (an additive table then).
- Migration `20261114060000_agent_connection` (`AgentProfile`, `AgentToken`, `AgentAuditEntry` with an append-only trigger). `prisma migrate deploy` on a fresh `agents_fresh` (all migrations applied) and existing `sneek_ui` (applied), both repeated with "No pending migrations"; `migrate diff … --exit-code` "No difference detected" for both; the trigger refused UPDATE in psql; `prisma generate` run.
- Tests: `tests/lib/agent-access.test.ts` (17: token randomness, prefix and hash-only storage; live token accepted and last use recorded; ten refusals: missing, foreign, unknown, revoked token, revoked agent, expired, paused, deactivated creator, minute limit, daily budget; shared limit keys; administrator reads all packs, others none; operations manager limited to read-or-above areas; packs withheld when the creator loses an area, everything when disabled or demoted; unknown pack names ignored), `tests/lib/agent-mcp.test.ts` (21: initialize, scoped tools/list, ping, notification; 401 refusal audited without the token; batch, unknown method and tool refused; no write tools exist; out-of-scope tool denied and audited; each of ten tools needs its scope; staff and client lookup separate; audit summary keeps only known argument names; "not recorded" and untrusted marking; every tool runs and no output contains a sensitive key or a planted canary value; no query selects a sensitive field; agent tokens only reach the MCP route and `lib/auth/session.ts` reads no Authorization header), `tests/api/agent-admin-routes.test.ts` (5: list with the real MCP address for ADMIN only; create only after own PIN with the token returned once; wrong PIN 423, impersonation and non-admin 403 with nothing changed; wider-than-creator refused; rotate, revoke and pause each need the PIN), `tests/components/agents-workspace.test.tsx` (5: list with effective and withheld access, prefix only, last use, recent calls, real connection guide, no h1 inside the workspace; create with PIN, only the creator's packs selectable, token shown once and copied in the MCP configuration, then removed; refused PIN keeps the prompt and clears only the PIN; phone width keeps every action reachable without tables; load failure with Retry), `tests/db/agent-connection.test.ts` (3, disposable `agents_fresh`: create, authenticate, rotate, revoke with admin audit and no token in any audit; expiry, pause and deactivated creator; 65 concurrent requests allow exactly 60, an MCP call writes one append-only audit row). With both scans, settings navigation and the AI provider tests: **12 files, 102 tests passed**; database tests 6 passed. `tsc --noEmit` passed.
- Not done: a real MCP client session against a running server (no servers run, as instructed), Chromium pass at 390/1280 light/dark (component tests only), OAuth for the Claude apps connector, write tools, production build and full suite.

## Assistant in the app (2026-11-14)

Step 5 of the AI rebuild; design in `docs/SYSTEM.md`, "Assistant in the app". No schema change.

- Built: `lib/assistant/ask.ts`, `lib/assistant/explain-and-draft.ts`, `lib/assistant/http.ts`; routes `/api/admin/assistant/ask`, `/api/admin/assistant/draft`, `/api/qa/jobs/[id]/photo-review/explain`; `components/v2/admin/command/ask-panel.tsx` (added below the Command heading in `app/v2/admin/page.tsx`), `components/v2/shared/ai-help.tsx` (Explain and Draft with AI), wired into the photo review panel, the photo checks disclosure, the message composer (client recipients) and the quote office notes (one prop added to `StatusCard`, passed from the quote workspace). Routing registry: `assistant` now built, new `explain_flag` and `draft_reply`; older saved routing reads with defaults.
- Tests: `tests/lib/assistant.test.ts` (12: unavailable without any request when off or unconfigured; only tools the signed-in person can read are offered and run, with that person's live access; citations kept only for returned records, with links; client text passed as untrusted and flagged; bad arguments and unknown tools handled without guessing; hourly limit becomes unavailable; no readable area means unavailable; Explain uses stored facts without storage keys; integrity flags explained and unknown ids refused; drafts wrap client words as untrusted and forbid promising refunds; quote notes forbid recalculating prices), `tests/api/assistant-routes.test.ts` (3: Ask as the signed-in person, unavailable as 200, refused while testing as someone; drafts need message or quote access; Explain keeps inspector assignment), `tests/components/assistant-panels.test.tsx` (4: answer with record links and kept question; unavailable separate from error with retry; draft reaches the editor only on "Use this draft"; Explain and its unavailable state). Updated for the new behaviour: the settings route test now expects eight features; the settings screen shows one "Not built yet"; the provider test now treats only agent summaries as reserved and checks an older routing row still reads. Photo review, photo checks, messages and quote component tests and both scans pass (16 files, 87 tests in the affected set); `tsc --noEmit` passed.
- Not done: Chromium pass at 390/1280 light/dark, real provider calls, production build, full suite. Step 6 (agent write requests with approval) is not started.

## Agent actions: requests that wait for a person's approval (2026-11-14)

Step 6 of the AI rebuild, on top of `3db1610`; design and rules in `docs/SYSTEM.md`, "Agent actions: requests that wait for a person's approval". Defaults pending owner confirmation: write packs off by default and capped at the creator's live Manage access; 24-hour expiry; approvers are ADMIN, or OPS_MANAGER with Approvals at Manage and the action's own areas at Manage (reject needs the same right); never while testing as someone; "Pause all agents" stops creation and approval (reject still allowed); inbox-only notice to eligible approvers; agent requests not counted in the Approvals badge.

- Built: `lib/agents/write-scopes.ts`, `action-catalog.ts` (arguments and read-only dry runs), `action-requests.ts` (create WAITING, idempotency, status, expiry sweep), `action-execute.ts` (decisions; imported only by the approval route), `action-admin.ts`, `action-views.ts`, `action-http.ts`; write and status tools in `lib/agents/tools.ts`, annotations and instructions in `lib/agents/mcp.ts`; write packs in `access.ts`/`admin.ts` and the Agents screen; `GET /api/admin/agent-requests`, `POST /api/admin/agent-requests/[id]`; the "Agent requests" tab (`?tab=agents`) on Approvals; scope `AGENT_ACTION_APPROVER` in `lib/notifications/recipient-scopes.ts`, `lib/notifications/agent-requests.ts`, catalog `agent.action_request` with editable wording; worker job `agent-request-expiry`; ops-catalog sections `agent-requests` (Approvals) and `agents` (owner; the existing ADMIN-only agents API was unmapped, which failed the route-coverage test).
- Tools: `request_reschedule_job`, `request_case_note`, `request_create_case`, `request_acknowledge_stock_need`, `get_action_request`. Left out (no safe domain service; not reimplemented): assign or reassign a cleaner (rules inside the assign route), job internal note (single replaceable field read to cleaners, written only by the job edit route), draft client message (no stored-draft concept).
- Migration `20261114070000_agent_action_requests` (`AgentProfile.writeAreas`, `AgentActionRequest` with a guard trigger, `AgentActionEvent` append-only). `prisma migrate deploy` on a fresh `agent_actions_fresh` (all migrations applied) and on the existing `sneek_ui` (applied the new migration); both repeated with "No pending migrations to apply."; `migrate diff --from-url … --to-schema-datamodel prisma/schema.prisma --exit-code` "No difference detected." for both; `prisma generate` run.
- Tests: `tests/db/agent-actions.test.ts` (12, disposable database `agent_actions_test`: idempotent key including a simultaneous pair, reused key refused, one notice; refused dry run stores nothing; expiry by sweep and at approval; stale case refused as FAILED with events and audit; executed note through the case service as the approving manager, managers with Cases at read or Approvals at read refused; client-invisible office case opened; refused while impersonating; PIN asked only where an action declares one; pause blocks creation and approval, reject still works; withdrawn write pack fails the request; reschedule runs with the preview's version and refuses a changed job, manager without Calendar at manage refused; database guards on history), `tests/lib/agent-actions.test.ts` (10: write packs capped by live Manage access; write tools listed only with their pack and not read-only; a call stores a WAITING request and runs no domain service; repeated key with JSONB key order; refusals store nothing; status tool scoped to the agent and lapsed requests shown expired; import walk finds no path from the MCP route to the executor; only the approval side imports it), `tests/lib/agent-request-notice.test.ts` (5: INBOX only, scope and event id; catalog and wording; scope rule), `tests/components/agent-requests-tab.test.tsx` (8, including phone), plus updated `tests/components/agents-workspace.test.tsx` (6), `tests/api/agent-admin-routes.test.ts` (6), `tests/lib/agent-mcp.test.ts` (21), `tests/lib/agent-access.test.ts` (17), `tests/db/agent-connection.test.ts` (3).
- Known failure outside this change: `tests/lib/ops-policy.test.ts` route coverage still fails for `app/api/admin/assistant` (step 5 left it unmapped, so operations managers are refused there by the fail-closed rule); not changed here because the right pack is an owner decision.
- Not done: Chromium pass at 390/1280 light/dark (component tests only), a real MCP client session against a running server, production build, full suite, OAuth for the Claude apps connector (not available).

## Deployment status for PR #35 and PR #36 (2026-11-13)

The owner reported that every Dokploy deployment for these merges shows as cancelled. Neither merge changed the Dockerfile or `scripts/run-next.cjs`. The cause was not established from the repository: the hosting connector was unavailable, so no deployment log was read. Production therefore does not yet run this code, and the eight migrations from `20261114010000_scheduling_rule_versions` to `20261114070000_agent_action_requests` have not been applied there. This entry was merged to start a fresh deployment at the owner's request. Deployment remains unverified until a build finishes and `sh /app/scripts/migrate-once.sh` has been run.

## Live ops map pins (2026-11-14)

Owner request: "redo how the pins are shown in the map like in the artifact live ops". Designs read: `LiveOps.dc.html` (`.pin`) and `M-CalendarLiveOps.dc.html` (`.pin`).

- Changed: `components/v2/admin/ops/estate-ops-map.tsx` (people, drivers and properties drawn as DOM pins in one OverlayView; Marker/SymbolPath removed for them; rings, trail, fit, refit, card overlay unchanged), new `ops-map-pins.ts` (pure model), `ops-map-pin-views.tsx` (pills, stack, property glyph, key), `ops-map-overlay.ts`; `estate-ops-map-parts.ts` gained `driverInfoHtml` (moved unchanged); `live-ops-workspace.tsx` passes `board.jobs` to the map. No feed, API, permission, schema, `lib/gps/**`, `mobile-app/` or `sneek-nextgen/` change.
- Old marker meaning → new: age colour (live/aging/stale) → badge full/faded/greyed plus "stale fix" text when stale (ring keeps tier colour); hollow approximate dot → dashed pill border plus "approx."; hollow "no GPS, at job address" → hollow badge plus "no GPS"; selected bigger dark-stroked dot → ring plus `aria-pressed`; driver arrow → gold one-letter badge plus "Driver …"; small-circle spread → stacked group with "+N"; brown property dot → neutral house glyph, named at zoom 15+ or with a job today. All states are also in each pin's accessible name / title.
- Property job state comes from today's board rows matched by property name (and suburb when the row has one); ambiguous names stay undecorated. This is a heuristic because the board carries no property id; no query was added.
- Tests: `tests/lib/ops-map-pins.test.ts` (17), `tests/components/ops-map-pins.test.tsx` (7, includes a fake `google.maps` for overlay, tap → select + info window, layer toggles, keyboard Enter/Space), plus the existing `admin-phone-live-ops`, `live-ops-feed`, `live-ops-follow-up`, `live-location-pure`, `google-maps`, `server-client-value-imports`, `no-left-accent-lines`: all pass. `tsc --noEmit` clean; eslint on changed files clean.
- Visual check: a stand-alone harness (esbuild bundle of the real pin components and model, Tailwind with the Estate tokens, on a plain stand-in background) in Chromium at 390 and 1280 px, light and dark, including keyboard focus, Enter selection, an expanded "+N" group and a zoomed-out view; no horizontal page overflow, no console errors. The real Google map was not rendered (no Maps key here), so tile contrast, InfoWindow placement over pills and OverlayView behaviour in a live browser are not verified.
- Not done: production build, full suite, deployment. Pins are 26 px high as designed, below the 44 px touch target.


## Airbnb turnover v3 draft form (2026-11-13)

Owner request: "generate a proper foolproof form like v3 … to cover every angle which can be loopholes in cleaning". Built as a draft only, in the engine's existing format; the owner reviews and publishes. Design and limits: `docs/SYSTEM.md`, "Airbnb turnover v3 form"; owner guide `docs/forms/airbnb-turnover-v3.md`.

- Read first: `FormTemplate`/`FormTemplateVersion`, `lib/forms/types.ts`, `template-schema.ts`, `template-checks.ts`, `lint-template.ts`, `field-types.ts`, `visibility.ts`, `validate-submission.ts`, `repeat-sections.ts`, `property-conditions.ts`, `rotation-schema.ts`, `standard-sections.ts`/`normalize-schema.ts`, `template-transfer(-server).ts`, the submit route, the quick-actions menu, the Laundry handoff card, and the fixture's `airbnb-turnover-v1` (only Airbnb form in `sneek_ui`; v2 exists only as a seed file).
- Built: `docs/forms/airbnb-turnover-v3.json`, `docs/forms/airbnb-turnover-v3.md`, `lib/forms/stock-item-binding.ts`, `lib/forms/form-file-seed.ts`, `scripts/seed/airbnb-turnover-v3.ts`. No change to the builder (another agent is working there), the cleaner workspace, `mobile-app/`, `sneek-nextgen/` or the schema.
- Read-time traps avoided and tested: any question or section whose key or label says "balcony" is hidden without a balcony (only balcony-gated items use the word); rules on a key containing "laundry" fall back to the laundry outcome (no rule watches one); Ring/Minut wording turns a question into a device check (only explicit `deviceStatus` questions are device checks); section id `final-inspection` has its own gate (not used); a required checkbox does not block by default, so proofs are photos, Yes / No with "details when No", selects and counts.
- Tests: `tests/lib/airbnb-turnover-v3-template.test.ts` (18 passed: import parser accepts it with 0 renamed keys and 0 check errors; strict save check, Checks and lint clean; no standard sections injected; unique keys before and after per-room expansion; every condition points at an existing key or supported property fact; required photos have minimums and stamp tags; every section has an always-shown required proof; no orphan sections; per-room rules stay in their room; read-time traps; AI criteria on every high-severity photo, within 1000 characters; Test as cleaner: an honest 2-bed submits, an empty form is blocked, rooms scale and absent features are not asked, problem answers ask for evidence, arrival damage would open the damage report; every-clean photos for a 2-bed ≤ 40; SKU binding). `tests/db/airbnb-turnover-v3-import.test.ts` (3 passed on a fresh `v3form_fresh` after `prisma migrate deploy`, and 3 passed on `sneek_ui`: dry run creates nothing; apply creates one inactive CUSTOM draft with no version rows and one audit row, stock counts bound to real item ids, opens unchanged in the builder reader, no other template row changed; re-run skips; job resolution never selects it). `tsc --noEmit` passed.
- Fixture: the seed script was run on `sneek_ui` (dry run, `--apply`, `--apply` again → skipped). Draft `Airbnb turnover v3` now exists there (inactive, unpublished, library version 2); every other FormTemplate row was compared before and after and is unchanged.
- Not done: Chromium check of the form on a phone (no builder or workspace change, but the form itself was not viewed in a browser), timing a real clean (the time estimate is from photo counts), production build, full suite, publishing, deployment. Listing example photos are not supplied; the owner adds them.

## Template builder on a phone: question rows, editor scroll, Stock count save (2026-11-14)

Owner report with phone screenshots (about 390 px, production): (1) a question row put handle, checkbox, type, wording, "Min 1" / "Required", chevron and "⋯" on one line, so "Arrival walkthrough video" rendered one letter per line; (2) the question editor was cut off at the bottom and Move up / Move down sat under the docked Test / Publish bar ("the forms builder doesn't scroll the options panel"); (3) a red banner "…counts. Your edits are kept here. Retry" while editing a Stock count; also the question title was truncated twice.

- Causes. (1) `question-row.tsx`: the wording button was `flex: 1 1 0%` in a flex line, so the badges and fixed columns took the space and the wording shrank to a sliver. The same happened on desktop in the three-pane centre column at 1280 px (seen in Chromium). (2) `form-builder.tsx`: the editor frame had `max-h` + `overflow-hidden` but was not a flex column, so the properties panel's `h-full` never resolved, its body never scrolled, and everything below the max-height was clipped, on desktop and phone alike. On a phone, the Test / Publish bar's spacer was rendered with the header (top of the page), so the end of the page did not clear the bar. (3) The builder's draft autosave ran the publish-strict check, which refuses a Stock count without an item. A new Stock count has no item until one is picked, so every autosave failed with `The draft was not saved: "…" is a Stock count that does not say which item it counts.` (and the banner repeated "The draft was not saved"); on a phone the item picker was below the clipped part of the editor, so it could not be reached either.
- Fixes. (1) Rows choose their layout by the question list's width (CSS size container on the list, `[@container(min-width:34rem)]` variants): narrow lists get a two-line card (wording alone on line 1, up to three lines; type and badges on line 2; expand under "⋯"; 44 px targets on a phone); lists of 34rem or more keep the one-line row, with the wording at least 7.5rem. Also 44 px on a phone for "Select all", "Expand all", "Section settings" and the panel's Duplicate / Delete; the sub-field label input got `min-w-0`. (2) Editor frame is a bounded flex column from 640 px (panel body scrolls to its last field); in normal flow on a phone (page scrolls). `BuilderPhoneActionBar` is rendered at the end of the page plus a safe-area clearance (4.5rem more while the bulk bar owns the bottom). The question name shows once (title bar, wrapping up to three lines; the panel header hides its copy below 640 px). (3) `validateFormSchemaForSave(schema, { allowIncomplete })` and `SaveDraftInput.allowIncomplete`, passed only by `PUT /api/admin/form-templates/[id]/draft`: unfinished setups (Stock count without item, choice column without choices, column without label, fixed table without rows; `structuredFieldFindings`) are kept in the draft. They stay Checks errors; `assertPublishable`, the legacy PATCH, import, copy to forms, saved blocks and bulk edits are unchanged and strict; malformed settings and duplicate stock items are still refused on the draft. Banner text via `draftFailureReason` (reason stated once). Stock count item list: a refused or unexpected read is a named failure with Try again (never an empty list); empty catalogue and "no item chosen yet; cannot be published until chosen" are stated; un-choosing the item drops its copied unit. Inventory settings card: unexpected reply is a failure, not an empty catalogue.
- Tests: `tests/components/admin-phone-insights-forms.test.tsx` (15: row grid/one-line classes, editor normal flow and dock clearance, desktop bounded frame), `tests/components/form-builder-drafts.test.tsx` (10: banner states the reason once; stock list read failure named), `tests/api/form-builder-routes.test.ts` (16: draft PUT now saves an unfinished Stock count, malformed still 422, legacy PATCH still 422), `tests/lib/forms-structured-and-effects.test.ts` (15), `tests/lib/form-schema-save-and-publish.test.ts` (15: publish still refuses), plus `form-field-type-audit`, `inline-form-name`, `forms-bulk-panels`, `form-builder-ops`, `form-library-compare-transfer`, `form-template-impact-notes`, `forms-templates`, `form-library-routes`, `form-templates`, `audit-form-template-pages`, `server-client-value-imports`, `no-left-accent-lines`: 17 files, all passed. `tsc --noEmit` clean.
- Browser check (Chromium, real app via `next dev` on 3051 against the disposable `sneek_ui` database, a throwaway template created and deleted afterwards): 390×844 light and dark (questions screen, editor top, editor bottom with all panels open, the title bar, un-choosing the Stock count item: autosave "draft saved just now", no banner), 1280×720, 1280×900 and 1600×900 light and dark. Measured: no horizontal scroll at any size; phone row wording 204 px wide on one/two lines; Move down bottom 656 px vs docked bar top 723 px; desktop panel body scrolls and its last section is visible at 720 and 900; 1280 centre pane uses the two-line card (wording 287 px), 1600 keeps the one-line row.
- Not done: production build, full suite, `tests/db/*` (not run), keyboard-only pass in the browser, deployment. The production banner was not reproduced against production data; the cause is established from the message text and code and reproduced in tests and locally. Commit `291c16c` (made by another session during this work) already contains part of these changes; the rest is uncommitted.

## Phone audit pass: backends and small phone defects (2026-11-15)

Owner request: "Fix all the backends now, redo the small UIs missed." Method: production build (`NEXT_DIST_DIR=.next-audit`, port 3041, fixture database `sneek_ui` on 55439, `TZ=Australia/Sydney`, workers disabled) crawled with Playwright/Chromium at 390px for admin, ops, cleaner, client, laundry, QA and maintenance: every static page under `app/v2/<portal>` plus record pages (job, laundry run, property, client, maintenance item, form, user, shopping run, performance, and a case and quote created during the pass). Recorded: own `/api/**` responses ≥400, failed or >15s pending requests, console/page errors, visible error text, one h1, horizontal overflow (including content clipped by the page), squeezed text, small and unlabeled tap targets; each tab switcher clicked (round 1); each admin page's phone primary action/dialog opened (not submitted). Three crawl rounds (before fixes, after the first rebuild, after the final rebuild). Screenshots were looked at as contact sheets; 10+ pages in dark; changed pages at 1280 light.

**Counts (390px, excluding harness artifacts).** Round 1: 4 API refusals on 2 pages, 1 hydration error (appeared after a write flow), 0 5xx, 0 ADMIN 403; about 30 visual defects. Final round: the same correctly-refused requests remain (QA pool job 403 ×2, client opening a cleaner's shopping run 404) with gated UI; 0 page errors; 1 overflow left (forms statistics, out of scope). Harness artifacts ignored: workbox `reading 'waiting'` page error (service workers blocked by the harness) and `swe-worker-*.js` ERR_FAILED after generated service-worker files were removed from `public/`.

**Write flows (admin, API through the signed-in session or the UI).** Create case 201 and internal note 200 (case page renders the note); bulk reschedule preview 200, apply to +2 days 200 and back 200; laundry run state Confirmed → Picked up 200 (first attempt correctly refused: "Choose who did it.") and back to Waiting for pickup 200 (fixture now PENDING rather than CONFIRMED, and the job carries a manual-reschedule mark); stock need reported through the Report a need sheet 200; draft quote 201 (the UI correctly refuses a quote without a recipient). Client case list 403 "Cases are hidden for this client." (module hidden in fixture visibility, expected).

| Role | Page | Finding | Cause | Fix / reason left |
|---|---|---|---|---|
| QA | `/v2/qa/jobs/[id]` (pool job) | 403 photo-review, raw "FORBIDDEN" text; panel above the h1 | Correct server refusal (owned assignment required); page inserted the panel before the workspace | Panel moved under the workspace; 403 shows "AI photo review opens once this inspection is assigned to you.", photo checks not mounted, Refresh disabled |
| QA | same | 403 progress shown as "No cleaner clocked in yet / Unknown" | Failed read rendered as data | `progressRead` state: refused/failed notice, loading state, polling stops after 403, reset per job |
| QA | same | Title cut to "The Bondi S…" | `truncate` | Wraps below 640px |
| Client | `/v2/client/shopping/[id]` (other owner's run) | 404, no h1 | Correct scoping | h1 added to the not-found state |
| Client | `/v2/client/laundry` | React #425/#422 hydration error | Latest update time formatted in runtime zone | Formatted in the Sydney zone like the rest of the page |
| Admin/ops | Diagnostics | `pg_stat_statements` prisma error in server log | Extension absent on fixture database | Expected; page already says "not enabled" |
| Admin | `/v2/admin/inventory` | "Urgent needs 0" tab after reporting a need while header said 1 | Server-rendered count not refreshed after client writes | Writes call `router.refresh()` |
| Cleaner | `/v2/cleaner/quality` | Blank below heading | Card returned null for empty and for failed reads | Loading, empty and failed (retry) states; home keeps hiding when empty but says when the read failed |
| Cleaner, admin, laundry, client | job/queue/history cards | Coloured left line | `statusBlockStyle` `borderInlineStart`, not caught by the scan | `statusTintStyle` in v2; scan extended |
| Admin | Scheduling rules | "Eligible cleans" one letter per line | Unshrinkable tone-card pill | Pill capped at 55%, wraps |
| Admin | Laundry run, job, quote | Stage labels squeezed ("Confirmed" overflowing) | Six to eight flex cells at 390px | `EStageBar` three-column grid on phones |
| Admin, laundry, QA | Stat tiles | Mid-word breaks ("CANDIDATE S", "RELIABILIT Y", "OUTSTANDI NG") | 0.28em eyebrow beside icon | Phone eyebrow 10px/0.1em (important over the skin rule), icon 28px |
| Admin | Hiring | Role title and meta squeezed under the buttons | `flex-1` basis 0 in a wrapping row | Info takes the full row on phones |
| Admin | Compliance | Action buttons overflow left; "Clear" in red | `justify-end` without wrap; fixed danger tone | Wrap; tone follows the count |
| Admin | Shopping run (admin) | Client charges panel above the h1; "paid by CLEANER" | Panel order; raw scope | Panel under the figures; scope in words |
| Cleaner | Shopping run | No h1 (h2 title); six full-width tiles; "NOT_REQUIRED", "PENDING" | — | h1, two-column tiles on phones, enum labels |
| Client | Job page | Progress panel above the h1; seven-column timeline squeezed; "AIRBNB TURNOVER" | Inserted panel; title-case kept capitals | Progress under the heading (compact on phones, timeline from 640px); proper casing |
| Client | Inventory | Eight-column table scrolled sideways | — | Stacked list on phones |
| Client | Reports | "PROPERTY" label overlapped by chip | 64px label | 80px label |
| Admin | Blog | Table scrolled sideways, titles cut | — | `ETableShell phoneStack`, titles wrap |
| Laundry | Today | "Plan route" pushed off screen | Non-wrapping control group | Wraps |
| Maintenance | Tickets by day | Past day of resolved tickets labelled overdue | Label ignored status | Overdue only while a ticket on that day is open |
| Admin | Laundry run (1280) | "Change state…" twice in the header | Outline button not suppressed when it is the primary | Suppressed (not re-inspected in a browser after the final build) |
| Cleaner, admin | Invoices, property setup guide | 24px/28px tap targets | — | 44px/40px on phones |
| Admin | Forms statistics | "Start rejecting…" button overflows card at 390px | Forms library | Left: out of scope (forms library owner) |
| Admin | Onboarding | Opening `/v2/admin/onboarding/new` creates a blank draft every visit (two created by this crawl) | Wizard POSTs on mount (v1 behaviour) | Left: owner decision |
| Cleaner | Job page (offered job) | Opening PATCHes an empty draft ("Draft save confirmed") | Draft autosave on open | Left: needs the cleaner form owner; no data loss observed |

**Admin Maintenance page (not restyled; designer owns it).** At 390px: list rows put the checkbox, title, Open button and status select on one line so titles break one or two words per line ("SECRET / other / contractor / job"); descriptions are cut to "The …"; four stat tiles stack full width before any work (no figure fold); filters are four stacked full-width selects with no Filter sheet; no phone primary action; row and select-all checkboxes are 16px; the detail page has a 14px checkbox and long assignment panels. No breakage (all reads 200, no errors), so nothing was changed there.

**Changed files.** `app/v2/qa/jobs/[id]/page.tsx`, `components/v2/qa/photo-review-panel.tsx`, `components/v2/qa/qa-inspection-workspace.tsx`, `components/v2/cleaner/qa-feedback-card.tsx`, `app/v2/cleaner/quality/page.tsx`, `lib/jobs/status-presentation.ts`, `components/shared/job-status-progress.tsx`, `app/v2/cleaner/jobs/page.tsx`, `components/v2/admin/jobs/job-row.tsx`, `components/v2/laundry/laundry-board.tsx`, `components/v2/laundry/history-board.tsx`, `components/v2/client/laundry/laundry-workspace.tsx`, `components/v2/client/jobs-board.tsx`, `app/v2/client/jobs/[id]/page.tsx`, `app/v2/client/inventory/page.tsx`, `app/v2/client/reports/page.tsx`, `components/v2/ui/tone-band.tsx`, `components/v2/ui/stage-bar.tsx`, `components/v2/ui/primitives.tsx`, `components/v2/admin/estate-kit.tsx`, `components/v2/admin/website/blog/blog-workspace.tsx`, `components/v2/cleaner/shopping-run-workspace.tsx`, `components/v2/client/shopping/run-workspace.tsx`, `components/v2/admin/inventory/estate-shopping-run-detail.tsx`, `components/v2/admin/inventory/urgent/urgent-needs-workspace.tsx`, `components/v2/admin/hiring/pipeline/hiring-pipeline.tsx`, `components/v2/admin/workforce/compliance-board.tsx`, `components/v2/laundry/route-map.tsx`, `lib/maintenance/tickets-by-day.ts`, `components/v2/admin/laundry/run/laundry-run-page.tsx`, `components/v2/cleaner/invoices-panel.tsx`, `components/v2/admin/properties/property-setup-guide-editor.tsx`, tests and docs. No schema, route, permission or request change.

**Verification.** New `tests/components/phone-audit-2026-11-15.test.tsx` (10); extended `tests/lib/no-left-accent-lines.test.ts`; run with the touched suites (`laundry-run-actions`, `tone-band`, `qa-maintenance-portal-redesign`, `client-portal-redesign`, `client-visibility-redesign`, `admin-phone-stock`, `urgent-office-manage-controls`, `photo-review-panel`, `cleaner-shift-home`, `cleaner-shopping-actual-purchases`, `client-job-projection`, `status-presentation`, `job-page-timeline`) plus `server-client-value-imports` and `ops-policy`: 17 files, 155 tests pass. `tsc --noEmit` clean. Production build passed three times. Full suite not run. Not checked: keyboard traversal beyond the dialogs' focus traps, real device Safari, provider-backed screens (Maps, push, email, Xero, AI providers are not configured here and show explicit "not configured" states), deployment. The last two small edits (laundry run duplicate button, blog title wrap) were type-checked and unit-tested but not re-inspected in a browser.


## AI configuration page rebuilt (2026-11-15)

**What changed.** `/v2/admin/ai` is the one AI page (boards AiConfiguration, AiConfigurationStates, M-AiConfiguration). New `components/v2/admin/ai/*` (workspace, providers, features, photo checks, usage, overview, key dialog, test hook, model), `lib/ai/provider/status.ts`; `app/api/admin/ai/settings/route.ts` (OPS read, hints hidden, `status`, 409 `savedBy`), `lib/ai/provider/admin-http.ts` (`requireAiReader`), `app/v2/admin/settings/page.tsx` (redirects for `?tab=ai` and `?tab=ollama`), settings catalog, `lib/rbac/ops-catalog.ts` (`SETTINGS_TABS.ai`), Ollama tool link. Removed (functions moved onto the page): `components/v2/admin/settings/ai-section.tsx`, `components/v2/admin/photo-review-opt-out.tsx` and the old section test. `components/v2/admin/vision-settings.tsx` stays only for the existing e2e fixture.

**Old control → new place.** Provider key save/remove (password) → provider card / phone provider sheet, Add / Replace / Remove key (own PIN, shared `EConfirmDialog`). Compatible base address and name → compatible card, "Endpoint address and name". Default text provider/model → Section 1 defaults card. Per-feature on/off, provider, model, photo switch, hourly limit → Section 2 row (and feature sheet). Per-feature cloud deadline → Section 1 "Cloud deadline" (all) and the feature's Settings. Run a real test → row "Test", feature sheet "Run a test", provider "Test connection". Model prices → Section 4 Model prices. Usage table → Section 4. Stale-write choices → conflict card. Photo analysis provider and vision model, "Check provider and saved model" → photo feature Settings (when using the photo default). Compare/assign workflow switches → photo feature Settings. Use prior photos → Points and batches "Learn rooms…". Dedicated recognition → Points and batches. Photos per batch, minimum confidence, maximum deduction, minor/major points → Photo checks cards (minimum confidence as the band select plus "Exact minimum confidence"). Opted-out properties → Properties opted out, Manage dialog. Agreement report → Agreement with inspectors. Property photo memory → "Review photo memory ›" disclosure. Social composer status → Social post drafts row. Ollama tab → "Ollama setup ›" on the Local Ollama card (`?section=ollama`). "Refresh status" → not kept (the page reads live; reload refreshes).

**Key dialog request (to join with the credential-route change).** `POST /api/admin/ai/credentials` with `{ provider, apiKey, security }` or `{ provider, clear: true, security }`, where `security` is `ConfirmResult.credentials` from `EConfirmDialog tier="sensitive"`: `{ pin }`, or `{ password }` while the person has no PIN (the field name the laundry void and other tier C routes use, and the one the reworked credential route reads). The route file was not edited here. A refusal shows "Not saved. …" with the key kept.

**Tests.** `tests/components/ai-configuration-workspace.test.tsx` (16: first run, configured, failing/blocked/limit/conflict states, freeze and failed draft, test queued→passed, recorded failure and Test off while dirty, add and remove key bodies, ops read-only, phone sheets, every old control reachable, Ollama deep link, loading/failure/retry, Not known), `tests/components/ai-configuration-page.test.tsx` (3, rewritten), `tests/components/ai-settings-destination.test.ts` (3), `tests/api/ai-settings-read-access.test.ts` (6), `tests/lib/ai-provider-status.test.ts` (5); with `ai-settings-routes`, `ai-vision-settings`, `vision-settings`, `ai-provider-generate`, `ai-provider-credentials`, `settings-navigation`, `settings-home`, `admin-phone-settings-activity`, `server-client-value-imports`, `no-left-accent-lines`, `ops-policy`. TypeScript clean. Production build and the full suite not run (as instructed).

**Inspected in Chromium** (dev server on 3081, disposable fixture rows in `sneek_ui` removed afterwards, fake environment keys, no provider calls, worker disabled): first-run and configured page, provider sheet / provider cards, Photo comparison settings sheet, add-key dialog, key refusal and the failing / blocked / limit states, ops read-only, at 390px and 1280px, light and dark; one h1, one main, no horizontal overflow at either width. Not verified: real provider tests and the worker; keyboard-only walk-through beyond the shared dialogs; the key save end-to-end (blocked on the credential-route change).


## Admin Maintenance redesign (2026-11-15)

**What changed.** `/v2/admin/maintenance` and `/v2/admin/maintenance/[id]` rebuilt from boards Maintenance, MaintenanceDetail and M-Maintenance (see SYSTEM.md "Admin Maintenance redesign"). New `GET /api/admin/maintenance` and `/export`; `POST /api/maintenance/bulk` answers per item and can assign one visit worker; `APPROVE_PAY_CHANGE` is ADMIN-only; Command work queue kind `maintenance-unassigned`; `EDataTable` gained optional `leadCellClassName`. Removed `maintenance-workspace.tsx` and `role-assignments-panel.tsx` (their functions moved into the hub, panel, assign sheet and Who is on this). No schema change.

**Defaults pending owner confirmation.** Airbnb-only as today; nobody assigned for more than 2 days in Command; a declined price keeps the item open; an approved price adds no invoice line; only ADMIN approves a higher worker price.

**Tests.** New `tests/components/admin-maintenance.test.tsx` (12), `tests/api/admin-maintenance-routes.test.ts` (9: list auth/400s, OPS vs ADMIN price approval, bulk per-item status and assign), `tests/lib/maintenance-admin-list.test.ts` (12: attention rules, filters, organisation week/month, sort, stages, view, wording, visit time); extended `tests/lib/work-queue.test.ts` (+2) and the `no-left-accent-lines` allowlist (two removed). Run with `server-client-value-imports`, `ops-policy`, `work-queue-rules`, every existing maintenance suite and the suppliers suite: 32 files, 312 tests passed. `tsc --noEmit` clean apart from another agent's generated `.next-aicfg` types. Production build and the full suite not run (instructed).

**Inspected in Chromium** (dev server on 3061 against `sneek_ui`, read only; `.next-maint` deleted, the `tsconfig.json` include line it added removed): list, filter sheet (390), side panel, item page, assign sheet and People and trades at 390px and 1280px in light and dark. One h1 and one main landmark on both pages, no horizontal page overflow. The demo data has four open items, one worker, no photos, no events and no price requests, so the price-request band, photo galleries and long histories were checked in component tests, not on screen. Not verified: email or portal notice delivery, CSV download in a browser, bulk Undo against a live database, OPS_MANAGER in the browser.



## Simpler confirmations: three tiers, no typed words (2026-11-14)

**What changed.** Board "Confirmations and deletes" built across the app (see SYSTEM.md "Simpler confirmations"). Shared pieces: `components/v2/ui/confirm-dialog.tsx` (`EConfirmDialog`, tiers ordinary / destructive / sensitive, reason, Add details, error, phone sheet), `components/v2/ui/reason-picker.tsx`, `components/v2/ui/undo-toast.tsx`, `components/v2/shared/own-pin-fields.tsx` (the one credential field, five states), `lib/confirmations/reasons.ts` (plain module), `lib/security/route-verification.ts`. `EConfirmModal` keeps its props and renders the new dialog; `confirmPhrase` is ignored. No schema change, no migration.

**Defaults applied, pending owner confirmation.** (1) With no PIN the account password alone confirms; never when a PIN exists; lockout, Test-as refusal and rate limits unchanged; `SENSITIVE_ACTION_CONFIRMED` audit names the credential. (2) Invoice and credit-note void require a quick-pick reason (`voidReason`, `CLIENT_INVOICE_VOIDED` audit; no record or amount changes). (3) Draft invoice line removal: no PIN, tier B, Undo for plain manual lines; past DRAFT unchanged; the draft status is rechecked under the row lock. (4) Cleaner submitted-invoice delete is tier C (`cleaner_invoices.delete`, Payroll Manage tier so rights are unchanged). (5) Quick picks fixed in the product.

**Server rule changes.** Reasons without minimums: reconcile (min 10 → 1), laundry void (3 → 1), damage void (10 → 1), delivery review evidence (10 → 1), draft evidence review (10 → 1). Newly required: invoice/credit-note `voidReason`, laundry undo-void `reason`, approvals history `note` for edit and delete. PIN now verified by the action's route: quote extras DELETE, checklist module DELETE, shopping-run PATCH that removes a receipt, va-teams team DELETE and member DELETE, cleaner invoice DELETE (new), damage VOID (new). AI credentials route: `security: { pin } | { password }` through `verifySensitiveAction` (legacy top-level `password` read as `security.password`). `GET /api/me/admin-pin` adds `attemptsLeft`, `timezone`, and `code: ACTUAL_ACTOR_REQUIRED` on its testing refusal. The Xero reconcile route still requires the correction reference (3+ characters), so the dialog keeps it visible and required.

**Inventory (board rows → final state).**

| Dialog | Final | Notes |
|---|---|---|
| Reconcile Xero invoice | Done, C + reason | Quick pick; reference stays visible and required (server requires it); note under Add details; no VOID |
| Void invoice / Void credit note | Done, C + reason | Separate choice lists; reason sent and audited |
| Issue credit note (draft) | Done, C | Via `EConfirmModal requireSecurity` |
| Delete invoice | Done, C | Copy shortened |
| Remove invoice line | Done, B (draft) / C (issued) | Undo only for plain manual draft lines |
| Reverse to draft, Mark as sent, Mark as paid | Done, A | |
| Cleaner invoice: reverse | Done, B | Optional reason to the cleaner NOT added: the route has no field for it (would change what the action stores) |
| Cleaner invoice: delete | Done, C | New server check |
| Cleaner invoice: reject claim | Done, A | |
| Cleaner invoice: review delivery | Done, required, no minimum | |
| Pay adjustment: recall, reopen | Done, A | Reopen has no reason field today; none added |
| Pay adjustment: delete | Done, B | "C once approved" NOT done: would add a new PIN rule and sensitive key |
| Approvals: change decided amount | Done, A + reason | Server now requires the note |
| Approvals: delete decided record | Done, C + reason | No DELETE word |
| Agent request approve/reject | Done (shared field) | Own dialog; credential field states come from the shared field |
| Delete job | Done, C | No DELETE word |
| Reset job | Done (shared field) | Own dialog keeps its choices |
| Remove job extra | Done, C | PIN now verified by the extras route |
| Delete job template | Done, B | |
| Draft evidence review | Done, A, reason required no minimum | Browser confirm replaced |
| Deactivate property | Done, C | |
| Key lost mode | Done, A | |
| Delete client | Done, C | No DELETE word |
| Mark clients inactive (bulk) | Done (shared field) | |
| Maintenance resolve / dismiss | Not done | Maintenance pages belong to another agent |
| Delete case | Done, C | No DELETE word |
| Void laundry run(s), Undo void | Done, C + reason | Effects under a disclosure; emailed-report refusal replaces the button |
| Decide skip or delete request | Unchanged | A choice dialog, already one step |
| Delete laundry partner | Done, B | |
| Void damage submission | Done, C + reason | New server PIN check; mode stays a choice |
| Reset password, Reset 2FA, Reset someone's PIN | Done, C | |
| Delete account (person page, accounts menu) | Done, C | No DELETE word |
| Remove assistant (Assistants tab and team manager) | Done, C | Browser confirm replaced; members route verifies the PIN |
| Delete assistant team | Done, C | No DELETE word; team route verifies the PIN |
| Access review and save, scheduling rules, agents, pricing page lock | Done via the shared field | Settings files not edited (another agent) |
| Delete payment gateway | Partly | Shared dialog and field apply; the gateway route still relies on the verify-endpoint pre-check (settings file not mine to edit) |
| AI provider key add/replace/remove | Server done | Request shape above; client is the AI page agent's `ai-key-dialog.tsx` |
| Clear notification logs | Done, B | "This cannot be undone" |
| Delete form template | Done, C | |
| Delete checklist library module | Done, C | PIN now verified by the route; classic `/admin/checklists/library` delete will be refused until it sends a PIN |
| Delete checklist library item | Done, B, no Undo | Undo not safe: the server deletes at once and the editor does not hold every field to recreate it |
| Delete forms group | Done, B | |
| Form builder delete question(s), section | Done, B + Undo | Undo steps the document back while still the last change |
| Form builder discard / replace draft | Done, B | |
| QA template delete / reset to default | Done, B / A | |
| Message template delete | Done, B | |
| Hiring delete section, question | Done, B + Undo | |
| Campaign, plan, email campaign, blog post, report(s), automation rule delete | Done, B | Through `EConfirmModal` |
| Email campaign send to one | Done, A | |
| Shopping run remove receipt | Done, C | PIN now verified by the shopping-run route |
| Delete stock supplier | Done, B | |
| Withdraw pay request, Set these to zero | Done, A | |
| Discard stock count (cleaner, client) | Done, B | Client DISCARD word removed |
| Delete chat message, Remove passkey | Done, B | |
| QA remove damage entry, flagged area | Done, B + Undo | |
| Client remove assistant team | Done, B | REMOVE word removed |
| Client remove assistant | Done, B | |

**Not in scope / not done.** Classic pages using `components/shared/two-step-confirm-dialog.tsx` (classic jobs, laundry, properties, clients, users, cases, quotes, notifications, reports) keep their typed phrase; they share only the credential field, so their no-PIN path now asks for the password alone. `window.confirm` prompts outside the inventory (job manage, payroll process, pricing editor, lost-and-found guest, cleaner portal) and minimum-length rules outside the listed dialogs (cancel job 3, property photo memory 3, laundry Change state 3, started-work review 10, QA early start 10) are unchanged.

**Tests.** New: `tests/db/confirmation-credential-rule.test.ts` (5, PostgreSQL 55439), `tests/api/simpler-confirmations-routes.test.ts` (22), `tests/components/confirm-tiers.test.tsx` (16). Changed on purpose: `tests/db/own-pin-and-quote-number.test.ts` (password alone now confirms with no PIN), `tests/db/laundry-run-void.test.ts` (undo void needs a reason), `tests/api/ai-settings-routes.test.ts` (own-PIN credential instead of a bcrypt password check), `tests/api/approvals-history-delete-pin.test.ts` (reason sent; new reason tests), `tests/api/cleaner-invoice-admin-transitions.test.ts` (delete sends the PIN; new PIN tests), `tests/api/cleaner-invoice-delivery-review.test.ts` and `tests/components/cleaner-invoice-delivery-review.test.tsx` (no minimum), `tests/api/invoice-step-c-patch.test.ts` (draft removal without PIN, APPROVED with PIN, race, void audit), `tests/api/invoice-void-credit-sensitive.test.ts` (voidReason), `tests/api/quote-extras-finance-guards.test.ts` (PIN on the route), `tests/api/own-pin-routes.test.ts` (timezone, testing code), `tests/components/own-pin-prompts.test.tsx`, `accounts-person-panel.test.tsx`, `access-permissions.test.tsx` (password alone), `account-actions-menu.test.tsx` (no DELETE word), `checklist-library-save.test.tsx` and `job-extras-save-messaging.test.tsx` (PIN sent with the action, no verify pre-check), `draft-evidence-review.test.tsx` (dialog instead of browser confirm), `owner-decisions-1113-dialogs.test.tsx` (void needs a reason).

## Xero stays connected (2026-11-15)

Owner report: "it only connects for 30 mins from xero." Section: `docs/SYSTEM.md` › "Xero connection stays connected (2026-11-15)".

**Cause, proved before the fix** (`tests/lib/xero-token-lifecycle.test.ts` first block, run against the old `lib/xero/client.ts`: 3 of 3 failed — two concurrent calls made 2 token exchanges; a 503 renewal returned "No active Xero connection" and stored "SIGN_IN_LAPSED"; a 401 was thrown, not renewed and retried). Also: connections made before `offline_access` (2026-11-11) have no refresh token; no keep-alive for the 60-day unused expiry; tokens plaintext; status said "Connected" for a lapsed connection.

**Fix.** `lib/xero/token-service.ts` (single-flight lease + compare-and-set on `tokenVersion`, encrypted persist before use, transient vs terminal classification, tenant check), `lib/xero/keepalive.ts` + worker job `xero-token-keepalive` (daily 03:47 Sydney), `lib/xero/connection-status.ts`, `lib/xero/reconnect-notice.ts` (catalog `xero.reconnect_needed`, inbox only, administrators, once per outage), `lib/xero/credentials.ts`; `lib/xero/client.ts` routes every call through one `xeroCall` (401 → renew once → retry once). Settings › Xero card `components/v2/admin/settings/xero-connection-card.tsx`. Migration `20261115050000_xero_token_lifecycle`. Not changed: push payloads, money arithmetic, issued/paid records; failed pushes stay retryable through the existing Retry paths with their idempotency keys.

**Verification.**
- `npx prisma migrate deploy` on fresh `xero_token_fresh` and `xero_token_fresh2`, on a database at the previous migration with a legacy no-refresh-token row and a renewable row (`xero_token_backfill`: backfill gave NEEDS_RECONNECT/NO_REFRESH_TOKEN and CONNECTED with `connectedAt`/`lastRefreshedAt` copied), and on `sneek_ui`; repeated: "No pending migrations to apply"; `prisma migrate diff --from-url … --to-schema-datamodel prisma/schema.prisma --exit-code` exit 0 on each. Note: deploy also applied another agent's pending `20261115060000_sending_safeguards` to `sneek_ui`.
- Tests (Xero mocked; no credentials here): `tests/lib/xero-token-lifecycle.test.ts` 19, `tests/db/xero-token-refresh.test.ts` 4 (PostgreSQL 55439, fresh database, two Prisma clients as two processes, `--no-file-parallelism`), `tests/lib/xero-reconnect-notice.test.ts` 3, `tests/components/xero-connection-card.test.tsx` 5, `tests/lib/xero-connect-exchange.test.ts` 3; existing Xero/finance/notification/worker suites (35 files, 356 tests) pass except `notification-catalog` "lists every file that sends a notification", which fails on `lib/maintenance/assign-notice.ts` (another agent's in-progress file, not this change). Changed on purpose: `tests/lib/finance-decisions-rules.test.ts` (sign-in wording and the NEEDS_RECONNECT rule), `tests/lib/xero-read-transport.test.ts` (mock gains `updateMany`/notice).
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .`: clean on the final run (an earlier run showed one error in `lib/ops/tomorrow-prep.ts` from another agent's in-progress work, since resolved).
- Not done: production build (not requested), browser inspection of the settings card at 390/1280 light/dark (jsdom component tests only), anything against real Xero.

## Sending safeguards and repeated-email audit (2026-11-15)

Scope, causes and defaults: `docs/SYSTEM.md`, "Sending safeguards and the repeated-email audit". Migration `20261115060000_sending_safeguards` (additive: `OutboundMessageEvent`, `OutboundSafeguardIncident`).

**Verification.**
- Migrations:
  - `npx prisma migrate deploy` on a freshly created `sneek_sg_fresh2` applied all 156, including the new one. A second run reported "No pending migrations to apply". `prisma migrate diff --from-url … --to-schema-datamodel prisma/schema.prisma --exit-code` reported "No difference detected" (exit 0).
  - On `sneek_ui` the migration was already recorded (applied 12:06 UTC by a concurrent session). Repeat: no pending; diff exit 0.
- Regression tests, each shown to FAIL on the code at `acff1d5` and pass now:
  - `tests/lib/qa-auto-score-once.test.ts` (3; old code: 3 AUTO reviews and 3 notifications in 3 hours)
  - `tests/lib/tomorrow-prep-once.test.ts` (3; old code: 6 emails for 2 cleaners over 3 failed runs)
  - `tests/lib/job-reminders-claim.test.ts` (4; old code: 3 emails in 3 ticks)
  - `tests/lib/follow-up-once.test.ts` (2)
- Safeguards:
  - `tests/lib/safeguards-decide.test.ts` 16
  - `tests/lib/outbound-provider-imports.test.ts` 2 (no provider access outside the four chokepoints)
  - `tests/lib/worker-guard.test.ts` 4 (alert once, skip overlapping tick, retried three times sends once)
  - `tests/api/sending-safeguards-routes.test.ts` 6
  - `tests/components/sending-safeguards-screen.test.tsx` 6 (includes phone)
  - `tests/db/sending-safeguards.test.ts` 8 (fresh PostgreSQL 55439, `--no-file-parallelism`): caps under 12 concurrent senders (exactly 5 allowed); duplicate; breaker with one incident, one admin email and one inbox notice; pause/resume; emergency stop with the security email still sent; hold and release once; suppressed never delivered; recipient cap and disabled account.
- Existing notification, work-queue, worker, settings, server-client-imports, no-left-accent and ops-policy suites, together with the new ones: 86 files, 797 tests, 796 pass. The 1 failure is `tests/lib/notification-catalog.test.ts`: `lib/maintenance/assign-notice.ts` is not listed in the catalog. That file predates this change (Maintenance work at `acff1d5`) and was left to that work. Updated for the gate: `tests/lib/mobile-outbox-delivery.test.ts`, `tests/lib/ops-notification-producers.test.ts`, `tests/lib/work-queue.test.ts` (plus a new card test).
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .`: clean.
- Browser check (`e2e/admin/sending-safeguards.spec.ts`, system Chrome, esbuild fixture with mocked routes): 390px and 1280px, light and dark. One h1; no horizontal overflow; keyboard Enter opens the PIN dialog; a refused PIN keeps the dialog with the reason; Escape closes; an out-of-bounds limit draft is kept with its problem. Screenshots were inspected; one double label ("Scheduled job: Scheduled job:") was fixed. The fixture renders the dialog portal outside its `.dark` wrapper, so the dark dialog was not inspected in true dark.

**Not done or not verifiable.**
- No production build or full suite (not requested).
- No production logs, so the ranking of causes is from code and the real volume per cause is unknown.
- No real provider sends (Resend is mocked; no Twilio, Cellcast, VAPID or Expo credentials here).
- Deployment is not verified.
- Another agent committed these files part-way in commits `48431dd` and `586c754`. This session did not commit.

**Follow-up (same day).** (1) Classic `/admin/checklists/library` module delete collects the credential with the classic confirm dialog and sends `{ security }`. Callers checked for every tightened route (app/admin, app/cleaner, app/client, app/laundry, app/qa, components, lib, hooks; `mobile/` excluded): quote-extras DELETE (only `job-extras-panel`), checklist module DELETE (v2 editor, classic page: fixed), shopping-run PATCH (v2 run desk; the Command work-queue "Approve" sends only `cleanerReimbursementStatus`, no receipts, so no PIN), va-teams team/member DELETE (v2 team manager, Assistants tab; the client portal uses `/api/client/va-teams`, unchanged), damage VOID (only the admin investigation), cleaner-invoice DELETE (only the v2 dialog), invoice/credit-note void (v2 dialogs; classic `components/admin/client-invoices-page.tsx` Void button and status menu: fixed, PIN plus reason; its delete: fixed, PIN), undo laundry void (only `run-requests.ts`), approvals history edit/delete (only `approvals-history.tsx`). No agent executor or worker calls these routes over HTTP. Not fixed: the classic invoice page's line removal past DRAFT sends no PIN (refused before this change too). (2) Payment gateway delete verifies `{ security }` on the route; v2 Settings section and the classic gateways page send it (the verify-endpoint pre-check has no callers left). (3) Admin Maintenance resolve / dismiss (single and bulk) moved to `EConfirmDialog` tier A with the optional note; behaviour unchanged. (4) `two-step-confirm-dialog.tsx` asks for no typed phrase (no route requires one) and accepts `reasonChoices`. Tests: new `tests/components/confirm-followups.test.tsx` (5); `tests/api/simpler-confirmations-routes.test.ts` gains the gateway route (25); `tests/components/admin-maintenance.test.tsx` updated (question title, tier A eyebrow).


## First-save drafts and the cloud photo PIN (2026-11-14)

Scope: `docs/SYSTEM.md`, "First-save drafts and the cloud photo PIN". Owner: "do what's best" on three open decisions. No schema change, no migration.

**Verification.**
- New regression tests, each shown to FAIL on the code before this change and pass now where noted:
  - `tests/components/onboarding-wizard-first-save.test.tsx` (4; all 4 fail on the old wizard): opening creates nothing and an empty Save Draft creates nothing; the first autosave creates one draft with an `Idempotency-Key`, moves to `?edit=<id>` and does not re-read over the typed answers; a failed first save keeps the answers, shows Retry, and Retry reuses the key; Next shares the pending create.
  - `tests/api/onboarding-survey-create-idempotency.test.ts` (4): key stored beside `formMeta`, a repeat key returns the existing draft without a second create, missing/malformed keys ignored, live role guard.
  - `tests/components/job-workspace-draft-lifecycle.test.tsx` (+3, 55 total; the first two fail on the old workspace): an offered job saves nothing on open or when the tab is hidden, and still nothing after accepting until a change; an accepted job saves nothing on open and autosaves the first edit; recovered device work the server lacks is still saved without another edit.
  - `tests/api/cleaner-shared-draft-atomicity.test.ts` (+1, 55 total): PATCH on an offer answers 409 `OFFER_NOT_ACCEPTED`, writes nothing and keeps an existing draft; accepted saves as before. The simulated assignment read was changed on purpose to accept PATCH's `responseStatus` select.
  - `tests/api/ai-settings-routes.test.ts` (+5, 14 total): turning cloud photos on verifies the PIN with `ai.cloud_photos` before saving and never stores `security`; wrong/missing PIN 423, nothing saved; turning off and other changes need no PIN; refused while testing as someone before any PIN check; a locked-save mismatch answers 423.
  - `tests/lib/ai-provider-credentials.test.ts` (+1, 8 total): `saveAiRouting` refuses an unconfirmed switch, saves a confirmed one with `AI_CLOUD_PHOTOS_ALLOWED`, turning off writes only `AI_SETTINGS_UPDATED`.
  - `tests/components/ai-configuration-workspace.test.tsx` (+2, 19 total): the PIN dialog opens only when a save turns photos on, a refused PIN keeps the dialog, reason and draft, the second PIN saves; a limit change saves without a dialog or `security`.
  - `tests/lib/first-save-draft-rules.test.ts` (6): the plain rules.
- Existing suites run together with the new ones (onboarding, cleaner job workspace/draft/identity/lock/merge/local/save/evidence, AI settings/provider/vision/composer, confirmations, own PIN, sensitive grants, delegated guardrails, access evaluator/guide/parity/permissions, ops-permissions route, `server-client-value-imports`, `no-left-accent-lines`): 51 files, 630 tests, all pass. `tests/api/ai-settings-read-access.test.ts` mock gains the new error class.
- `tests/db/confirmation-credential-rule.test.ts` on a fresh disposable database (`sneek_firstsave_1114`, PostgreSQL 127.0.0.1:55439, `prisma migrate deploy` then the test with `--no-file-parallelism`): 5 pass. The Prisma JSON path lookup used for the onboarding idempotency key (`adminOverrides.path ["draftCreateKey"]`) was checked against the same real database (hit and miss correct). The database was dropped afterwards.
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .`: clean.

**Not done or not verifiable.**
- No production build or full suite (not requested).
- No browser inspection at 390px/1280px light/dark: jsdom component tests only. The new onboarding status line and the AI PIN dialog use existing Estate primitives and the shared `EConfirmDialog`.
- Existing empty onboarding drafts were not removed: there is no existing clean-up path (only the single-survey Delete), so data was left alone.
- The new `ai.cloud_photos` capability is tier "grant" (required by the sensitive-action to capability map); Settings, AI stays ADMIN-only, so a grant does not open it to anyone else. It will appear in the administrator capability list on the access screen.
- Deployment not verified. This session did not commit.


## Damage report record page and New invoice panel (2026-11-15)

Scope: `docs/SYSTEM.md`, "Damage report record page and New invoice panel". Boards "Damage report" and "New invoice" (approved). Owner: "build designs with my defaults". No schema change, no migration.

**Owner defaults applied, pending owner confirmation.** (1) Releasing a damage report tells the client: inbox and email ticked by default, SMS off, transports chosen on each release, through the notification pipeline (new catalog type `client.damage_released`, editable wording). (2) Airbnb Resolution Centre claims not built; kept in case notes. (3) Anyone with Cases access may release, as before. (4) A job with no rate may be left off a new draft by an explicit tick and is listed on it as "not billed: no rate" (`metadata.notBilled`, shown in the editor); otherwise the generator still refuses the client. (5) New invoice period starts the day after the client's last live invoice ended, else the 1st of the month.

**Verification.**
- New tests: `tests/lib/damage-record-model.test.ts` (11: estimate total leaves blanks out and states coverage, unknown is not $0, originals and marked-up copies both kept for the office, client preview carries no estimate / internal note / reviewer / send-back history / originals, history incl. pre-log fallback, release message states never "read", progress stages); `tests/api/damage-record-route.test.ts` (14: live role guard on every read/write, refusal reads/writes nothing, close without releasing = REVIEW close with no message, silent release, check → release → message order, refusal before release when notifications are off, no message while testing as someone else, failed message keeps the release, take back, send back verifies the own PIN in the same request and records nothing without it, estimate scoped to the report, client preview, 404); `tests/lib/damage-release-notice.test.ts` (12: catalog entry and defaults, editable wording for inbox/email/SMS, inbox-only never becomes push/email/SMS, SMS only when ticked with scope re-check, out-of-scope SMS skipped, notifications off refused, empty list silent, repeat key not audited twice, preview wording, decision audit actions, audit in the release transaction, estimate refused for another report's item and logged); `tests/components/damage-record-page.test.tsx` (8, incl. phone); `tests/db/new-invoice-panel.test.ts` (7, PostgreSQL: preview equals what the generator bills with charge sources and no amount for an unrated job; draft through the panel identical to the existing generator's for the same selection; unrated job refused unless named, then left off and listed; unnamed unrated still refused; one draft per request key; issued invoice untouched; period default); `tests/api/new-invoice-route.test.ts` (11: guards, preview, keyed vs old unkeyed create, unknown fields refused, period rule); `tests/components/new-invoice-panel.test.tsx` (6, incl. double click sends one request, retry reuses the key, phone docked button).
- Updated: `tests/components/admin-phone-money-cases-lost-found.test.tsx` (the phone chooser now opens the panel).
- Run and passing: the above plus `tests/lib/notification-catalog.test.ts`, `notification-wording*.test.ts`, `server-client-value-imports.test.ts`, `no-left-accent-lines.test.ts`, `ops-policy.test.ts`, all `tests/lib/damage-*.test.ts`, `client-invoice-*.test.ts`, `audit-damage-report-readonly.test.ts`, `tests/api/simpler-confirmations-routes.test.ts`, `tests/components/invoice-generation-summary.test.tsx`. The DB test ran on a fresh disposable database `dmginv_test` (127.0.0.1:55439, `prisma migrate deploy`).
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .`: no errors in files of this change; remaining errors are in other agents' in-progress files (`lib/email-design/*`, `lib/jobs/admin-create.ts`, `components/v2/admin/jobs/new-job/*`, `components/v2/admin/onboarding/*`, `components/v2/cleaner/practice/*`, `lib/jobs/new-job/*`).
- Browser: `next dev` on 3141 against `sneek_ui` with fixture rows made through the damage services (draft, submit, send back, resubmit, estimates) and fixture jobs/invoice; Chromium screenshots at 1280 and 390, light and dark, of both pages and their dialogs and states (scratchpad `dmg-inv/`). Fixture rows were removed afterwards.

**Not done or not verifiable.** No production build or full suite (not requested). Email/SMS providers are not configured locally, so release messages were not sent end to end; the inbox path is covered by tests only. The client portal's own damage page still formats its times in the viewer's browser timezone (unchanged). Deployment not verified; nothing committed.


## Property onboarding workspace and client link (2026-11-16)

Scope: `docs/SYSTEM.md`, "Property onboarding workspace and client link". Boards "Property onboarding", "Property onboarding steps", "M-PropertyOnboarding" (approved). Owner: build the designs with the owner's defaults. Migration `20261116050000_onboarding_workspace` (additive: three survey columns plus `lastSaved*`, two tables, a data step copying old bed text into the room list's note).

**Owner defaults applied, pending owner confirmation.** Access required before activation; clients may type codes (encrypted, office review before activation); a client rate above zero for the main job type required; laundry partner access left as today (the access model has no laundry time window, so "lockbox on run days" was not built); standard stock lists for 1, 2 and 3+ bedrooms (fixed in code); first draft jobs off by default when a calendar link is saved; client link with no login, 7 days, revocable; office told by inbox only; empty drafts reviewed by an administrator, never deleted automatically.

**Migration check.** `npx prisma migrate deploy` on a freshly created database (`onb_fresh`) and on `sneek_ui`: applied; repeated: "No pending migrations to apply"; `npx prisma migrate diff --from-url <db> --to-schema-datamodel prisma/schema.prisma --exit-code`: exit 0 on both. Re-run after other agents added `20261116030000_tutorial_progress`: see the final lines of this entry.

**Tests.**
- `tests/lib/onboarding-workspace-rules.test.ts` (19): readiness (access and main rate required, legacy access counts, a missing or zero rate is not a rate, unreviewed client code blocks, 2:1 weighting, skipped steps, checklist marks), per-field patches, encrypted codes never in history or the office view, client codes wait for review, a stored code survives a save without one, the room note is `scenarios.bedConfig`, house-rules mapping, schema refusals (unknown fields, zero rate, client save without pricing/partner/notes), rooms migration keeps old text, missing numbers stay null, stock lists.
- `tests/db/onboarding-workspace.test.ts` (8, `SNEEK_TEST_DATABASE_URL` = fresh `onb_fresh`, `--no-file-parallelism`): activation parity (two identical legacy surveys, one through `approveSurvey`, one through Activate: identical property fields, decrypted codes, access guide, calendar link (off), jobs, laundry run, checklist profile, stock rows and warnings; only the workspace's client rate differs); safe to press twice; activation refused without access, without the main rate (survey stays a draft) and from a stale revision; per-field autosave with history and the stale-save conflict naming the other person while keeping both edits; stock list with par levels, rows without a par level not created, missing reorder level reported; client link (HMAC token hash, masked recipient, 7-day expiry, SMS refused when not configured, page without office fields or any existing code, client code encrypted and not in history, office entries and unticked parts refused, revoke, expiry); rate limit; "I'm finished" queues INBOX-only intents once and activates nothing; the migration's data step; the empty-draft listing.
- `tests/api/onboarding-workspace-auth.test.ts` (6): live role guard ADMIN and OPS_MANAGER on read/save/activate/links/board, ADMIN only for the empty-draft review, 401/403 run nothing, no links while impersonating, explicit transport required, routes mapped to the onboarding pack.
- `tests/components/onboarding-workspace.test.tsx` (5): Start onboarding creates nothing on open, first save with one Idempotency-Key for the retry, URL moves to the OB number; field saved on leaving it with the revision seen; stale-save notice with Compare; failed save kept and resent by Retry; readiness lists what is missing with Activate disabled; phone checklist opens a full-screen step with docked Previous/Next; one h1.
- Existing suites rerun and passing: `onboarding-wizard-first-save`, `onboarding-survey-create-idempotency`, `first-save-draft-rules`, `scheduling-rules-parity` (lib/scheduling-rules unchanged), `scheduling-rules-runtime`, `laundry-supplier-chase`, `confirm-tiers`, `confirm-followups`, `auth-path-middleware`, `ops-middleware`, `account-middleware`, `notification-wording-parity`, `notification-wording-store`, `notification-wording`, `server-client-value-imports`, `no-left-accent-lines`, `ops-policy`. `notification-catalog.test.ts` fails only on another agent's in-progress `lib/email-design/test-send.ts` (not listed by a catalog entry); the onboarding producers are listed.
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .`: no errors in files of this change (remaining errors are in other agents' in-progress files).


## Email design system (2026-11-16)

Scope: `docs/SYSTEM.md`, "Email design system: one layout, blocks, Email look, editor". Boards "Email design system", "Email catalogue", "Email editor", "Email editor, phone" (approved). Owner: "build designs with my defaults". **No schema change, no migration.**

**Built.** One block renderer and base layout (`lib/email-design/`), rendered again at send time inside `sendEmailDetailed` (published version and look, Company details, plain-text part, missing required values refuse the send before the safeguards); Email look page (ADMIN, PIN to publish); the editor inside Notifications › Types and wording (`?type=…&email=…`); versioned AppSetting store; campaign one-click unsubscribe (marketing only); administrator password reset by one-time link; Xero reconnect also by email (explicit INBOX + EMAIL).

**Moved to blocks (38 designs):** the 30 shared templates; sign-in code, 2FA confirm code, 2FA recovery link, administrator 2FA reset, invitation link, password reset; bulk job offers; QA result; Xero reconnect (new). **New layout, HTML body (old path, still working and editable where it was):** wording-layer email parts, `wrapEmailHtml` callers (maintenance assignment, quote extras), route fragments, lifecycle and finance-editor emails, raw-HTML campaigns. **Unchanged:** full documents with no spec (Monthly Insights). No email is dropped: everything still passes `sendEmailDetailed`; only an empty required value refuses, with an explicit "Not sent" result.

**Owner defaults applied, pending owner confirmation.** Estate deep green; presets plus contrast-checked custom colour; replies to the office inbox (security: no reply-to); sign-in and sign-up codes not in the subject; invoice PDF still attached; operations managers draft and test only; publishing from a phone with the same PIN; Xero reconnect emailed once per outage; campaign unsubscribe.

**Verification.**
- New tests: `tests/lib/email-design-renderer.test.ts` (11), `tests/lib/email-design-catalog.test.ts` (107: every template keeps its old values, every design passes its checks and renders without missing values, locked content, code not in subject, contrast), `tests/lib/email-design-send.test.ts` (9: send-time render, prefix kept, published version and look used, missing value refused without provider call, security no reply-to, HTML body on layout, campaign headers, opt-out, operational mail unaffected), `tests/lib/email-unsubscribe.test.ts` (5), `tests/api/email-design-routes.test.ts` (11: publish ADMIN + PIN, wrong PIN 423, ops refused, impersonation refused, ops drafts, view-only refused, restore/reset drafts only, test to self only, Email look ADMIN + PIN), `tests/db/email-design-store.test.ts` (6, fresh database: drafts not live, publish v2 audited and idempotent, restore/reset, stale 409, checks block publish, security fixed, send path uses published version and look, admin reset link single use, 30-minute expiry, no temporary password, rate limit 429, expired link refused).
- Updated: `xero-reconnect-notice`, `notification-wording-store` (raw HTML refused for moved templates, Reset allowed), `account-emails`, `delegated-admin-routes`, `campaign-sender`, `campaign-personalization` mocks.
- Run: 65 files / 812 tests across notification, wording, email, campaign, Xero, provider-import scan, `server-client-value-imports`, `no-left-accent-lines`, `ops-policy`, finance-template (`notification-template-push`), route suites: 811 pass, 1 fail — `notification-paths-controls` "no banner once on the pipeline", caused by another agent's uncommitted catalog entry `client.damage_released` (SMS fallback), not by this change. DB: `email-design-store` + `sending-safeguards` 14/14 on `email_design_fresh` (127.0.0.1:55439, `--no-file-parallelism`).
- Migrations: `npx prisma migrate deploy` on fresh `email_design_fresh` (all applied, repeat: none pending) and `sneek_ui` (none pending, twice); `migrate diff --exit-code` 0 on both.
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .`: clean.
- Screenshots: all 38 designs plus a legacy body and a campaign, 600px and 360px, light and dark (dark through `prefers-color-scheme`), in the scratchpad `emails/shots`; compared a dozen with the catalogue board and fixed: card overflow at 600px, dark wordmark (ink), dark brand derivation (Forest → #74BEA0, board #8CC5A6), photo strip widths, QA wording. Editor, security view, Types and Email look in Chromium at 1280/390, light and dark (`next dev` on 3101, `sneek_ui`): one h1 and main, no horizontal overflow, typed `{{x}} <b>` stays text, value chip inserted, autosave saved; desktop preview squeezed into phone layout → now scaled. The test draft was deleted afterwards.

**Not done or not verifiable.** No production build or full suite (not requested). No real provider call: Resend not configured, so test sends, List-Unsubscribe in real inboxes, Outlook/Gmail rendering and dark inversion were not checked in real clients. Logo upload is a link field, not a file upload. Not built: inbox note to other administrators on publish (board question), "Compare" view of versions (versions can be restored), per-person unsubscribe in operational mail. Wording-layer email parts, finance-editor and lifecycle emails remain HTML bodies on the new layout. The classic settings raw template editor still exists. Deployment not verified; not committed by this session.

## New job page (2026-11-15)

Boards "New job" and "New job on a phone". See `docs/SYSTEM.md` → "New job page: one page, five phone steps, read-only previews".

**Built.** `/v2/admin/jobs/new`: desktop page with seven numbered sections and a summary rail; phone in five steps with a docked Next. Read-only preview routes under `/api/admin/jobs/new-job/` (options, property, day, duplicate) with the live role guard; create through the existing `POST /api/admin/jobs` + `createAdminJobOnce` with an `Idempotency-Key` receipt, optional `skipPreferredCleaner` / `sendBookingConfirmation`, and `followUps` in the response; special tasks and notices on create through the job page's own task service and stamps; browser draft with restore and property-change reset; several dates with per-day keys; Repeats on the recurring-rule API and a read-only rules list on the property page; Duplicate (header and the job page's More menu); classic `/admin/jobs/new` redirects. The tutorial `data-tour` targets of the old form (`admin.jobs.create.property/service/when/cleaner/submit`) are carried on the replacements. No schema change; scheduling rules and their parity tests untouched.

**Owner defaults applied, pending owner confirmation.** Preferred cleaner still auto-offered and said on screen, with "leave unassigned and skip"; second job the same day after tier A; per-job "do not send" for the booking email; recurring rules created here and listed on the property page; ops managers same rights on phone and desktop; several dates on the phone, one property.

**Verification.**
- Tests: `tests/lib/new-job-draft.test.ts` (16), `tests/lib/new-job-create-service.test.ts` (9, old vs new path parity at the service boundary, replay, choices, tasks, notices), `tests/api/new-job-routes.test.ts` (10, key handling, 401/403 from the guard, query limits, 404), `tests/lib/new-job-rights.test.ts` (6), `tests/components/new-job-page.test.tsx` (13, validation focus, create with key, assign call, tier A clash, retry reuses the key, property-change reset, late response ignored, draft restore, choices, view-only, phone steps and Back), `tests/db/new-job.test.ts` (10 on disposable `newjob_test` at 127.0.0.1:55439: previews write nothing, missing values null, row-for-row parity of job/assignment rate snapshot/offer/laundry/notifications between the old and new paths, clash visible, concurrent double submit = one job, batch retry creates only missing days, choices, special tasks as JobTasks, duplicate lookup, one recurring rule per id). Updated `tests/lib/jobs-admin-create-once.test.ts` and `tests/lib/job-page-actions.test.ts` for the added follow-ups and the "Duplicate" menu entry. Jobs, scheduling-rules parity/runtime, key-lost, cleaner-suggestions, server-client-value-imports, no-left-accent-lines and ops-policy suites: 96 files, 1121 tests passed.
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .`: clean (exit 0) on the final run.
- Browser (next dev on 3121, Chromium headless shell, sneek_ui): 1280 light and dark, 390 light and dark, admin and ops manager: validation, property, what, when with calendar band, who with ranked cleaners, laundry preview, extras, client email, restore draft, saved, clash band and tier A dialog/sheet, several dates, repeats, duplicate dialog. One h1 and no horizontal overflow on every capture. One real job created end to end (JOB-001000 on the fixture: OFFERED, preferred cleaner assignment with the 60 rate snapshot, no laundry task, receipt audit row, booking email logged FAILED because no provider key). Temporary fixture rows (two reservations, a client rate, property hours/rate/preferred cleaner) were removed afterwards; the job was kept.

**Not verified.** No production build or full suite (not requested). No email provider configured, so the booking confirmation was never accepted by a provider. Deployment not done. The phone tab bar is not hidden (needs a shell change). Laundry preview does not count other dates picked on the page.


## In-app tutorials: welcome, page tours, practice, Help, What's new (2026-11-16)

Scope: `docs/SYSTEM.md`, "In-app tutorials". Boards: Tutorials, Admin tours, Phone tours, Tutorials settings. Migration `20261116030000_tutorial_progress` (additive: `TourProgress`, `UserTourPreference`, `TourSetting`, two enums).

**Verification.**
- `npx prisma migrate deploy` on a freshly created database (twice: second run "No pending migrations") and on `sneek_ui`; `prisma migrate diff --from-url … --to-schema-datamodel prisma/schema.prisma --exit-code` exit 0 on both. Disposable databases were dropped.
- New tests: `tests/lib/tutorials-engine.test.ts` (20: ordering, admin order/hidden steps, routes, auto-start rules, existing-person intro card, welcome once, Don't show again, Continue, What's new only changed steps / revision / wording-only, permission skips, missing-target skip, resume, deferral), `tests/lib/tutorials-registry.test.ts` (83: ≤25 words, unique ids, practice labelling, one welcome per role), `tests/lib/tutorials-up-to-date.test.ts` (74: every step target exists in the scanned source; per-tour fingerprint vs `lib/tutorials/fingerprints.json` with fix instructions; change detection; release notes valid), `tests/components/tutorials-practice.test.tsx` (10: guard stops POST/PUT/PATCH/DELETE, Request objects, server-action POST, XHR, beacon, form post, geolocation; only `/api/me/tours` passes; restore; the practice job walked through the real stages via the tour, clicking check-in and submit, with zero mutating requests), `tests/components/tutorial-provider.test.tsx` (7: shell renders and starts nothing when the progress read fails or has an unexpected shape; intro card; page tour with focus, aria-describedby, arrow keys, missing control skipped and recorded, Done records DONE; Escape → Continue; deferral over an open dialog and one tour at a time; nothing while testing as someone; reduced-motion and phone flags), `tests/api/tutorials-routes.test.ts` (9: live session, own rows only, impersonation never reads/writes, cross-origin, unknown tour/role, admin-only writes, OPS view, registry-only targets, reset), `tests/db/tutorials-store.test.ts` (8, fresh database on 127.0.0.1:55439 with `--no-file-parallelism`).
- Existing suites run with them: `server-client-value-imports`, `no-left-accent-lines`, `ops-policy`, portal shell, admin nav, phone More sheet (including the lead's new Sign out test), client/cleaner/QA/maintenance portal redesigns, client layout gates, quality hub routing, settings catalog tests: 19 files, 313 tests pass. Tests for every component that received a target (data table, jobs workspace/views/columns/density/rows, invoice list/editor/phone/route, approvals workspace/deep link/phone, client approvals board/quotes, cleaner stages/wrap-up/job workspace/page/shift home, form renderers, location gate, laundry portal, phone primitives, command sections): 35 files, 416 tests pass.
- Fixed during review at the lead's request: the shell crashed in tests whose `next/navigation` mock had no `useRouter`, and when `/api/me/tours` was unmocked (state shape undefined). The provider now validates the response shape (anything else = "show no tour") and uses the router/pathname hooks optionally.
- Browser (Chromium, `next dev` on 3111 against `sneek_ui`), screenshots in the session scratchpad `tours/`: cleaner 390 light (welcome by keyboard, practice job 8 steps incl. check-in and receipt, Today tour, Escape → "Tour 2/5", Help) and 1280 dark; admin 1280 light and 390 dark (welcome, Command tour, Send an invoice 5 steps on the practice INV-P001, Create a job 5 steps on the real form, Jobs tour, Help); laundry 390 light (welcome, practice stop: "Practice: nothing was sent or saved." under Confirm, Today tour); client 390 dark (welcome, Approvals tour with the tab target low on screen, tip docked at the top). Network logging during every practice walkthrough: no POST/PUT/PATCH/DELETE left the browser (`/api/me/tours`, the person's own tour progress, is excluded by design). No horizontal overflow at either width. Settings › System › Tutorials at 1280 light/dark (admin) and 390 dark (operations manager: one h1, view-only note, editor fieldset disabled).
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .`: no errors in the tutorial files; the one remaining error is in another agent's in-progress `lib/hiring/hire.ts` (`reviewedById`).

**Not done or not verifiable.**
- Client "approve a quote" and cleaner "request extra pay" ship as guided tours, not practice (quote decisions are links into the quote page; the practice job's last step covers the request). QA practice later (owner default). QA and maintenance have welcomes and Help only: the boards give no page wording.
- On a real practice screen some components still show their own state for the sample (the invoice send dialog's PDF preview cannot load a sample PDF). The send was not completed in the browser because the dialog requires its review switch; the guard's refusal is covered by tests and visible on the laundry stop.
- The cleaner check-in and location steps are reworded from the board so they match the enforced rule. The What's new composer marks existing steps; Preview shows cards, not the live page.
- No production build or full suite (not requested). Deployment not verified. This session did not commit (the lead's WIP checkpoint holds earlier work).
