# Foundation Phase Master Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement each sub-plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the F1 design system v2 and F2 cross-cutting infrastructure fixes specified in `docs/superpowers/specs/2026-05-23-foundation-design-system-and-infra-design.md`.

**Architecture:** Seven sequential sub-plans, each shipping an independent PR with passing tests. Plan A lands first because it migrates the schema and CSS tokens every later plan reads from. Plans B and C run in series because primitives must be restyled before shells consume them. Plans D, E, F can run in any order after A (all add new components that don't share files with each other). Plan G is last and validates the system end-to-end.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind, shadcn/ui (existing), Prisma + PostgreSQL (existing), Vitest + Testing Library (new), Playwright + axe-core (new for visual + a11y), Google Maps JS SDK (new), `browser-image-compression` (new), `cmdk` (new), JetBrains Mono via `next/font` (new).

---

## Environment prerequisites

Before any sub-plan executes, the implementing engineer must verify:

1. `git --version` returns a version. (The session that wrote this plan had a broken shell; later sessions must not.)
2. `node --version` is ≥ 22 (matches `Dockerfile`).
3. `npm install` runs clean against the current `package-lock.json`.
4. `npx prisma migrate status` shows no pending migrations on the local DB.
5. `GOOGLE_MAPS_API_KEY` and `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` are set in `.env.local` (needed from Plan D onward).
6. A working PostgreSQL instance accepts connections from `DATABASE_URL`.

If any of these fail, fix them before starting Plan A.

---

## Dependency graph

```
        ┌──────────────────────────────────┐
        │  Plan A: Schema + Design Tokens  │   ← unblocks everything
        └──────────────────────────────────┘
                       │
        ┌──────────────┴───────────────┐
        ▼                              ▼
┌───────────────────────┐     ┌─────────────────────────┐
│ Plan B: Primitives    │     │ Plan D: Address Lookup  │
└───────────────────────┘     ├─────────────────────────┤
        │                     │ Plan E: Uploads         │
        ▼                     ├─────────────────────────┤
┌───────────────────────┐     │ Plan F: Email + GPS     │
│ Plan C: Shells + Nav  │     └─────────────────────────┘
└───────────────────────┘
        │                              │
        └──────────────┬───────────────┘
                       ▼
        ┌──────────────────────────────────┐
        │  Plan G: Audits + Cleanup        │   ← gates "foundation done"
        └──────────────────────────────────┘
```

Plans D, E, F may run in parallel by different engineers; B and C are strictly sequential.

---

## Sub-plan A — Schema migration + design tokens + test bootstrap

**Detailed plan:** `docs/superpowers/plans/2026-05-23-foundation-a-schema-tokens.md` (written, ready to execute)

**Summary:**
- Add new columns to `Property`, `User`, `Client` (`latitude`, `longitude`, `placeId`, `suburb`, `state`, `postcode`).
- Add `User.uiDensity`, `User.emailStatus`, `User.lastSeenAt`.
- New model `UploadFailure`.
- Replace `app/globals.css` token block with new HSL system. Remove decorative gradients on body and float/marquee/scroll-reveal utilities. Keep public marketing utilities for now (Plan G ports them to a marketing-scoped CSS layer).
- Extend `tailwind.config.ts` with new radius scale, `shadow-fab`, status color shortcuts.
- Add JetBrains Mono via `next/font/google`.
- Bootstrap Vitest + Testing Library + jsdom + Playwright config for visual regression + `@axe-core/playwright`. Add `test`, `test:ui`, `test:visual`, `test:a11y` npm scripts.
- Commit a `docs/style/design-tokens.md` source-of-truth doc that mirrors the token CSS.

**Acceptance criteria:**
- Migration applies cleanly with `npm run db:deploy` on a fresh DB.
- `npm test` runs 1 sample test (token resolution) and passes.
- Vite/Playwright/axe configs exist and run.
- Existing pages still render in dev (no crashes, even if visually changed).

---

## Sub-plan B — Component primitives restyle

**Status:** to-be-written when Plan A merges.

**Summary:**
- Restyle `components/ui/button.tsx`, `input.tsx`, `card.tsx`, `dialog.tsx`, `dropdown-menu.tsx`, `tabs.tsx`, `tooltip.tsx`, `toast.tsx`, `select.tsx`, `popover.tsx`, `checkbox.tsx`, `label.tsx` (existing shadcn).
- New primitives: `components/ui/status-pill.tsx`, `form-field.tsx`, `empty-state.tsx`, `loading-state.tsx`, `error-state.tsx`, `fab.tsx`.
- Implement density attribute system: `<DensityProvider>` reads from User pref and applies `data-density` on portal root.
- Each primitive gets a Vitest unit test and a Playwright visual regression test.

**Acceptance criteria:**
- Every primitive has unit + visual tests passing.
- Storybook-equivalent demo page at `/dev/primitives` (gated to dev/admin) renders every primitive variant.
- FAB rules implemented and tested (one per screen, keyboard-hide, modal-hide).

---

## Sub-plan C — Layout shells, navigation, command palette, density preference

**Status:** to-be-written when Plan B merges.

**Summary:**
- Rebuild admin sidebar shell with new tokens, section groupings, collapsible to icon-only.
- Rebuild cleaner/client/laundry mobile shell with bottom-tab nav and FAB rules.
- Rebuild public top-nav.
- Add `cmdk`-based command palette mounted globally; `Cmd/Ctrl+K` opens; data sources: routes index + clients + properties + jobs + quick actions.
- Add global keyboard-shortcut hook + `?` cheatsheet modal.
- Add user-settings page section: density (Compact/Default/Comfortable) + theme (Light/Dark/System) preferences persisted to `User.uiDensity` and `User.themePreference` (new field — added in this plan, not A).

**Acceptance criteria:**
- All four shells render with new tokens, no overflow on the three reference viewports.
- Command palette opens, searches, navigates.
- Density change is live (no reload required).
- Shortcuts work and the cheatsheet shows them.

---

## Sub-plan D — Address autocomplete + geocoding integration

**Status:** to-be-written when Plan A merges (can run in parallel with B/C).

**Summary:**
- New `lib/google-maps/client.ts` — singleton wrapper around the Google Maps JS SDK; lazy-loads on first use.
- New `components/ui/address-autocomplete.tsx` — controlled input with debounced Places Autocomplete (new API), returns the normalized `AddressResult` shape from spec §10.1.
- Server-side `POST /api/geocode/lookup` proxy for cases where we don't want to expose the browser key (e.g. seed scripts, backfill jobs).
- Wire `<AddressAutocomplete>` into: register flow, profile (User + Client), property create/edit, quote create, job create, public-site lead form.
- Backfill script `scripts/backfill/geocode-addresses.ts` that geocodes all existing Property/User/Client rows with null lat/lng. Rate-limited to 50/sec; logs failures to `UploadFailure`-style table (use new `GeocodeFailure` model? Or reuse a general `IntegrationFailure` model — pick during Plan D drafting).
- Document Google Cloud setup in `docs/ops/google-maps.md`: how to issue browser/server keys, restrict by referrer, set the daily quota + budget alert at $20/mo.

**Acceptance criteria:**
- Vitest test mocks the Places API and verifies the component returns the normalized shape.
- E2E Playwright test enters an address on the property-create page and confirms lat/lng saved on the record.
- Backfill script tested against a seeded set; failures recorded.
- Quota documented and applied in the user's GCP console (manual step, checklist in plan).

---

## Sub-plan E — Upload pipeline reliability

**Status:** to-be-written when Plan A merges (parallel with B/C/D).

**Summary:**
- New `lib/uploads/multipart-client.ts` — browser-side S3 multipart with presigned part URLs.
- New `lib/uploads/draft-store.ts` — IndexedDB queue for in-progress and failed uploads.
- Add `browser-image-compression` dep; new `lib/uploads/compress.ts` wrapper.
- Modify `/api/uploads/presign` to accept a `multipart: boolean` hint and return either a single PUT URL or an initiate-multipart-upload payload.
- New `/api/uploads/presign-multipart-part` and `/api/uploads/complete-multipart`.
- New `<UploadDropzone>` primitive replacing all ad-hoc file pickers across the app — handles compression, multipart decision, progress UI, retry with exponential backoff, draft persistence.
- `UploadFailure` model (added in Plan A) writes from server-side failures and the client's last-resort handler.
- New admin page `/admin/system/uploads` listing recent failures with filters.

**Acceptance criteria:**
- Vitest tests for compress + multipart-client + draft-store with mocked S3.
- Playwright E2E: upload a 25 MB image with simulated 3G + one network kill mid-upload → resumes and completes.
- Admin uploads page renders failures, marks resolved.

---

## Sub-plan F — Email deliverability + live GPS tracking

**Status:** to-be-written when Plan A merges (parallel with B/C/D/E).

**Summary:**

*Email:*
- Audit Resend dashboard; document DNS state in `docs/ops/email.md`.
- New `lib/email/suppression.ts` — `isSuppressed(email)`, `suppress(email, reason)`, `unsuppress(email)`. Backed by `User.emailStatus` (added in Plan A).
- Hook Resend webhook (`/api/integrations/resend/webhook`) for bounce/complaint events → suppress address, log to `NotificationLog`.
- Gate `lib/notifications/email.ts` send on `!isSuppressed(toAddress)` for non-transactional categories. Transactional categories (password reset, OTP) bypass suppression but record attempts.
- New admin page `/admin/system/email` — 30-day funnel chart, suppression list with reason + unsuppress button, dead-letter queue list.

*GPS:*
- Modify cleaner portal to use `watchPosition` + 30 s batched POST to `/api/cleaner/location/ping` (accepts array).
- `lib/gps/queue.ts` — in-memory + IndexedDB-backed queue that flushes on network restore.
- Permission denial → persistent banner on cleaner shell.
- New SSE endpoint `GET /api/admin/ops/live-locations/stream` — emits new pings as they arrive (long-poll fallback if SSE unsupported).
- New `lib/gps/geofence.ts` — on incoming ping, check active jobs for cleaner; if within 75 m of property and `arrivedAt` null, set it.
- Admin map `/admin/ops/map` redesigned: subscribe to SSE, render markers with avatar + accuracy circle + staleness color (green <2 min, amber 2–10 min, red >10 min).
- Settings: configurable geofence radius (admin-only), per-cleaner opt-out flag.

**Acceptance criteria:**
- Suppression: hard-bounced address stops receiving subsequent non-transactional sends; recorded in `NotificationLog`.
- Email funnel page renders accurate counts against seeded log data.
- GPS: Playwright + mocked geolocation drives a cleaner ping → SSE receives it → map renders marker → moves marker on next ping.
- Geofence: ping inside 75 m of seeded property updates `TimeLog.arrivedAt`.

---

## Sub-plan G — Audits + cleanup + acceptance gates

**Status:** to-be-written when D/E/F merge.

**Summary:**
- Implement `scripts/audit/broken-links.ts` — Playwright crawler running against `npm run start` build, login as each role from seed accounts, BFS depth 5, output `docs/audits/broken-links-report.md`. Fix or remove every entry.
- Implement `scripts/audit/screenshot-routes.ts` — Playwright across 30–40 reference routes × 3 viewports × light/dark; commits baseline; CI diffs subsequent runs.
- Wire `@axe-core/playwright` into the same screenshot suite — fail on serious/critical.
- Run Lighthouse on `/`, `/admin`, `/cleaner/jobs` mobile; record scores in `docs/audits/lighthouse.md`; ensure ≥90 perf, ≥95 a11y.
- Write `docs/style/copy-guide.md` (banned phrases list, empty-state pattern, button copy rules) from spec §11.
- Build the 15 SVG empty-state illustrations under `components/illustrations/`.
- Final cleanup pass: remove any remaining decorative animation usage in portal routes (marketing pages keep theirs).
- Run all 12 acceptance criteria from spec §16; check each off in a `docs/audits/foundation-acceptance.md`.

**Acceptance criteria:**
- Zero broken links.
- Zero critical/serious axe violations.
- Lighthouse thresholds met.
- All 12 spec acceptance points ✅ in the foundation-acceptance doc.

When this plan merges, sub-project #1 is **DONE** and we open sub-project #2 (F3 — multi-cleaning-type taxonomy).

---

## Open questions reserved for sub-plan drafting time

These do not block Plan A. They get decided when their owning plan is written.

| # | Question | Plan that resolves it |
|---|---|---|
| 1 | Use `User.themePreference` enum field or store preferences as JSON blob on User? | C |
| 2 | Failover email provider — Postmark vs SES? Or leave for V12? | F decides scope; spec defers picking provider |
| 3 | SSE vs WebSocket for live map? SSE is simpler; WebSocket allows bidirectional control commands (e.g. "ping me now"). | F |
| 4 | Geofence radius default — 75 m guess. Tune later? | F |
| 5 | Should the broken-links script run in CI on every PR, or only nightly? | G |
| 6 | Image compression quality threshold — 80% is the spec default. Confirm with a sample run before locking. | E |
| 7 | Reuse a generic `IntegrationFailure` model vs separate `GeocodeFailure`, `EmailFailure`, etc.? | D — proposes generic, alternatives raised in F |

---

## What's next

1. Engineer (or subagent) opens `docs/superpowers/plans/2026-05-23-foundation-a-schema-tokens.md` and executes Plan A end to end.
2. On Plan A merge to `main`, this master plan is updated: Plan A status flips to "merged", a brief retro line is appended below, and Plan B is drafted in full detail.
3. Repeat for B → C → (D, E, F in parallel) → G.

Estimated calendar: Plan A 1–2 days, Plan B 2–3 days, Plan C 2 days, Plans D/E/F 3 days each (parallel ~3 days wall-clock if three engineers), Plan G 2 days. Total ~10–12 working days if parallelized, ~3 weeks single-engineer sequential.

---

## Plan retros (appended after each merge)

### Plan A — 2026-05-24 (pushed, awaiting PR + merge)

**Branch:** `feat/foundation-a-schema-tokens` (15 commits beyond main).

**Status:** Functionally complete. Tests green (7/7 Vitest, smoke E2E). Build passes. Branch pushed.

**Discovered + handled in-flight:**

1. **Inter was never actually loaded.** `globals.css` referenced `var(--font-sans)` and `var(--font-display)` but nothing defined them — site fell back to Segoe UI. Task 7 added Inter alongside JetBrains Mono as a bonus fix.
2. **Pre-existing migration bug blocks shadow DB replay.** `prisma/migrations/20260408220915_add_en_route_notifications_automation/migration.sql` line 8 uses `'JobStatus'::regtype` (unquoted, lowercased by Postgres → fails on fresh shadow DB). `prisma migrate dev` is unusable until this is fixed. **Plan B MUST fix this before any new migration work.**
3. **Schema branch / dev DB drift.** The local dev DB had the QA migration applied (from sibling branch work) but the foundation schema didn't include QA. `prisma migrate diff --from-schema-datasource` wanted to drop QA tables. **Workaround used for this PR only:** hand-wrote additive SQL, applied via `prisma db execute`, recorded via `prisma migrate resolve --applied`. Not a sustainable pattern — Plans B+ should land on a branch where the dev DB and schema are in sync (likely by rebasing onto whatever ships first).
4. **`Inter Display` is not a real Google Fonts family.** Used weighted Inter (500/600/700) for the display variable. If a distinct display cut is wanted, swap to Inter Tight, Manrope, etc. in a follow-up.
5. **Property already had geocode columns** (`latitude`, `longitude`, `suburb`, `state`, `postcode`) — Task 4 only added `placeId` + indexes on Property. `suburb`/`state` on Property are non-nullable (pre-existing); on User/Client they're nullable. Plan D's `<AddressAutocomplete>` will need to handle both shapes.
6. **No ESLint config exists.** `npm run lint` triggers Next's interactive config wizard. Skipped in CI checks. Scaffold an `.eslintrc` in a separate PR.
7. **A11y baseline:** Only 1 violation type (`color-contrast`, 9 nodes) found on `/` — not the 3 the PR template anticipated. Specifically: WhatsApp CTA white-on-green (1.98:1), footer `text-white/40` headings (3.71:1), footer `#617074` copy (3.16:1). All eligible for Plan G fixes.
8. **Build fix required.** Adding `"types": ["vitest/globals"]` to `tsconfig.json` pulled in Vite type conflicts during Next's build. Excluded `vitest.config.ts`, `vitest.setup.ts`, `playwright.config.ts`, `tests/**`, `e2e/**` from the build tsconfig — Vitest uses its own resolution; tests still pass.

**Punch list deferred to later plans:**

- **Plan B prereq:** fix the historic migration bug in `20260408220915_add_en_route_notifications_automation/migration.sql` (1-char-pair change: `'JobStatus'::regtype` → `'"JobStatus"'::regtype`) + reconcile `_prisma_migrations.checksum` via `migrate resolve` so future `prisma migrate dev` calls work.
- **Plan D:** address autocomplete must handle Property's non-nullable `suburb`/`state` vs User/Client's nullable variants.
- **Plan G:** add `.marketing-only` class to public marketing layout root so decorative animations re-activate there only (currently scoped, currently inert everywhere because no consumer applies the class).
- **Plan G:** drive a11y violations to zero — 1 type, 9 nodes captured in `docs/audits/a11y-baseline.md`.
- **Independent follow-up:** scaffold ESLint config; install `gh` CLI on dev machine for PR ergonomics.

**Manual outstanding:** Task 13 (visual route walk by human) and Task 16 step 3 (open PR via GitHub UI — `gh` not installed).

**PR URL when opened:** https://github.com/sanuthdesitha/sNeek_Property_Services_Webapp/pull/new/feat/foundation-a-schema-tokens

