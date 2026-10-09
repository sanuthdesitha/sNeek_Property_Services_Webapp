# Recent changes: code and workflow review — 9 October 2026

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
