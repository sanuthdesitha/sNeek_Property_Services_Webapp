# sNeek application change rules

## Establish context before editing

- Read `docs/SYSTEM.md` and the relevant domain documentation. For the September–October 2026 changes, start with `docs/qa/recent-changes-review-2026-10-09.md`.
- Check Git status and the actual commit before using a handover. Supplied PDFs describe a snapshot, not proof of deployment or current behavior.
- The root Next.js app is the operational product. `mobile/` and `sneek-nextgen/` are separate applications; do not assume root changes reach them.
- Map the existing page, authorization, service, persistence, and tests before introducing anything new. Extend the existing workflow where it serves the same user need.

## Preserve business and authorization boundaries

- Reuse domain services and transactions. Property care executes through existing JobTasks; bag observations supplement LaundryTask; stock requests do not place purchases or prove delivery.
- Revalidate current permissions and entity scope on the server. Keep actual actor, effective role, retained account, impersonation, and client subject distinct. ADMIN and OPS_MANAGER are not interchangeable.
- Protected API routes must call the live local session/role guards (or an audited wrapper). Middleware supplies trusted scope metadata; do not make API access depend on an HTTP callback to the application itself. ADMIN has full feature rights independently of OPS packs, while revoked users and impersonated targets must retain their actual restrictions.
- Never convert missing evidence, counts, costs, dates, or provider configuration into success or zero. Retain explicit reasons and human review.
- Preserve evidence originals, scoped receipts, removal tombstones, job/form revisions, and historical submissions. AI proposals are not approved assignments or deductions.
- Preserve issued/paid financial records and immutable rate snapshots. Use existing money and billing policies; do not reconstruct financial arithmetic in UI components.
- Use the existing notification intent pipeline for supported scopes. Select transports explicitly; an inbox reminder must not silently become email, SMS, or device push. Queued is not delivered.

## UI and code standards

- Follow `docs/style/operational-ui.md` and Estate primitives/tokens. Integrate related controls into existing property, supplies, laundry, finance, and settings screens.
- Register settings destinations in the shared settings catalog and relevant existing category. Never place feature buttons above page headings; job-specific actions belong in their job section. Preserve role-filtered navigation, mobile selectors and old deep links.
- Use a lazy disclosure for secondary operational tools. Preserve drafts when collapsed; reset state when property/job/account scope changes. Retain old URLs for compatibility.
- One page heading and main landmark per portal page. Embedded workspaces use panel mode; standalone routes retain their navigation and title.
- Cancel obsolete reads and check cancellation after parsing the response. Do not let late responses populate a different entity. Freeze editable fields and scope selection during saves; preserve failed drafts and idempotency keys for explicit recovery.
- Separate loading, failure, empty, stale, and success states. Format history in the configured organization timezone; keep calendar dates unshifted.
- Keep functions readable, use named types for domain data, and avoid new untyped state or compressed one-line implementations. Do not reformat unrelated files.

## Verify and document

- Add focused regression tests for changed behavior, especially races, authorization, retries, and unknown states. Run TypeScript, the relevant tests, and a production build.
- Every database schema change must include a forward migration in `prisma/migrations` in the same commit. Verify `npx prisma migrate deploy` on a fresh disposable database and an existing migrated database, repeat it to confirm no pending changes, and compare migration history with `schema.prisma`. Preserve data and existing useful indexes; do not rely on `db push` or rewrite applied migrations.
- Database tests must use a disposable loopback PostgreSQL database on port 55439. Several suites clear fixture-wide settings; never use production, shared development data, or run these concurrently with browser fixtures in the same database.
- Exercise affected UI in Chromium at 390px and 1280px, light and dark. Check keyboard controls, overflow, draft retention, and errors. State what was actually inspected.
- Update the relevant section and Change Log in `docs/SYSTEM.md`, plus the review record, in the same change. Report failures, skips, missing provider credentials, and unverified deployment honestly.
- Preserve pre-existing edits and generated assets. Do not commit credentials, fixture data, browser output, or generated service workers. Deployment and external messages require appropriate authorization.

## Tutorials

- Every page with a tour lists its controls in `lib/tutorials/targets.ts`; the control carries `{...tourTarget("<id>")}` (one `data-tour` attribute, nothing else). Never point a tour at a CSS selector.
- Any visible change to a page with a tour updates the tour in the same change: bump the tour `version` in `lib/tutorials/registry.ts`, set `since` on new or changed steps (they show once as What's new), add a line to `lib/tutorials/releases.ts`, and run `npx tsx scripts/tutorials/update-fingerprints.ts`. A change people cannot see takes `--no-visible-change <tourKey> "<reason>" "<name>"`; administrators read that reason in Settings › System › Tutorials.
- `tests/lib/tutorials-up-to-date.test.ts` fails when a step's target is missing from the source or a page's registered targets change without the tour. Do not edit the fingerprint file by hand to silence it.
- Practice screens run the real components inside `PracticeBoundary`; they never write. Step text stays at 25 words or fewer and repeats the rule the system enforces.
