# Rebrand Doc 04 — Migration Strategy ("exact copy" isolation + cutover)

> Planning report (Fable 5, 2026-07-04). See `00-MASTER-PLAN.md` for the synthesis.

## Part 0 — Investigation findings (what the repo actually is)

**Main app** (repo root):
- Next **14.2.18** / React 18 / **NextAuth v4** (JWT, `lib/auth/auth-options.ts` + 11 more auth modules incl. WebAuthn, 2FA, OTP, lockout) / **Prisma 5.22** — schema is **3,436 lines, 122 models, 64 migrations**.
- **180 `page.tsx` + 444 `route.ts`** (~624 route files), **297 lib/ modules** across ~40 domains, **286 components**.
- **PWA**: `@ducanh2912/next-pwa`, custom web-push worker (`worker/`), `cacheOnFrontEndNav` + `aggressiveFrontEndNavCaching`. Matters enormously for cutover.
- **Windows build quirks**: `scripts/run-next.cjs` wraps every next command — `NEXT_BUILD_MEMORY_MB` heap ceiling, webpack persistent cache disabled (EISDIR), **`NEXT_DIST_DIR` override already supported** — a second build dir is a solved problem here.
- **Scheduler**: `lib/ops/web-scheduler.ts` runs in-process; kill switches confirmed: `SNEEK_WEB_SCHEDULER_ENABLED=false`, `SNEEK_DISABLE_WEB_SCHEDULED_FALLBACK=1`. Separate pg-boss worker at `workers/boss.ts`.
- **Deploy shape**: single Next server on port 3000, Postgres `SPS_Main` (localhost), uploads to Cloudflare R2, `.env` at root plus a `".env LIVE SEVER"` variant. (Hygiene note: `.env`, multi-GB zips, 450MB logs in the working tree — a worktree copy will NOT include untracked files like `.env`.)

**`sneek-nextgen/`** (247 tracked files):
- Next **16.2.3**, React **19.2.4**, **NextAuth v5 beta**, **Prisma 7.7** + adapter-pg, Tailwind **v4**, zod 4, pg-boss 12, socket.io.
- Its own **"schema v2"** — 2,624 lines, **114 models vs the live 122**, already divergent (live `Role` has `QA_INSPECTOR`; nextgen's doesn't). References Stripe/Xero integrations that don't exist in the live app.
- Its `src/lib` is a ~20-file **reimplementation skeleton**, not the 297 live modules. Pages are scaffold shells.
- **Verdict: not a usable seed for the rebrand.** It is a *platform rewrite* (multi-tenant SaaS ambition — matches the `saas-phase-1` branch), not a restyle. Adopting it means porting 444 API routes and 297 lib modules onto NextAuth v5 beta + Prisma 7 with a drifted schema — forking the business logic, the exact thing this project must not do. **Keep it parked as R&D reference**; do not build the rebrand in it.
- Isolation precedent already in place: tsconfig + `outputFileTracingExcludes` exclude it. The new parallel tree follows the same pattern in reverse.

## Part 1 — Approach comparison

| | A) Long-lived `redesign` branch | B) Parallel app in `sneek-nextgen/` | C) In-repo parallel route tree (`app/v2/`) | D) Full directory copy |
|---|---|---|---|---|
| **lib/prisma stay single-source** | ✅ (until merge day) | ❌ sync script or workspace rewrite; nextgen already drifted | ✅ automatic — same `@/*` alias, same import graph | ❌ forks *everything* |
| **Drift risk over months** | 🔴 High — live hotfixes touch the same 180 page files you're restyling; end-merge is a 600-file conflict | 🔴 Extreme — two package.json, two schemas, NextAuth v4 vs v5-beta | 🟢 Low — v2 pages are *new files*; live fixes merge cleanly; API/lib fixes apply to both UIs instantly | 🔴 Extreme — nothing merges back |
| **Owner preview** | Needs second checkout anyway | Second port, different auth + Prisma 7 | Same server, `/v2/...`; later per-user cookie flag in prod | Second port |
| **Cutover** | One big-bang merge | Deploy swap; sessions break | **Per-portal file promotion** — incremental, reversible | Swap dirs; re-apply months of fixes by hand |
| **Rollback** | Revert merge (huge) | Swap back; sessions/SW poisoned | Flip a middleware flag / revert a small move commit | Swap back |
| **Scope honesty** | Restyle only ✅ | Silently becomes a full rewrite ❌ | Restyle only ✅ | Restyle at 2× toil |

### 🏆 Firm recommendation: **C, executed with A's branch discipline, using a git worktree to satisfy D's "exact copy" literally**

- Redesigned pages are **new files under `app/v2/…`** importing the *existing* `lib/`, API routes, Prisma client. Zero business-logic fork.
- All work on a long-lived **`redesign` branch** merging **from** `main` weekly. Nothing pushed until authorized.
- The "exact copy running separately" = **`git worktree`** at `E:\sNeek Property Service\Website-redesign` checked out to `redesign`, own dev server on **port 3010**, same DB. It *is* an exact copy — but git keeps it mergeable.
- Cutover = **per-portal file promotion** (`app/v2/admin/*` → `app/admin/*`), never a deploy swap. Server, auth, PWA, scheduler, DB never change identity.

Why not pure A: restyling `app/admin/jobs/page.tsx` *in place* guarantees a conflict with every live hotfix for months. C sidesteps this: the old page keeps receiving hotfixes on `main`; the v2 page is a new path that merges cleanly.

## Part 2 — Detailed plan

### 1. Setup (½ day)

**1a. Branch + worktree**
```
git branch redesign main
git worktree add "E:\sNeek Property Service\Website-redesign" redesign
```
In the worktree (worktrees share `.git` but NOT untracked files):
- Copy `.env` → edit (see §3). **Do not copy `".env LIVE SEVER"`.**
- `npm ci` (own node_modules; Prisma client generates via existing `predev` hook).
- `NEXT_DIST_DIR=.next-redesign` so build artifacts never collide.

**1b. Fork boundary (write into `app/v2/README.md` as law):**

| NEVER fork (import from existing paths) | New under the v2 namespace |
|---|---|
| `lib/**` (297 modules), `app/api/**` (444 routes), `prisma/**`, `middleware.ts` auth logic, `hooks/**`, `worker/**`, NextAuth config | `app/v2/**` pages/layouts, `components/v2/**` (new design system), `styles/v2.css` (new Tailwind layer/tokens) |

Same repo → sharing needs **no monorepo rewrite, no path-alias surgery, no sync scripts** — the existing `"@/*"` alias already resolves `@/lib/...` from a v2 page.

**1c. Design-system isolation** — new tokens under a `v2` Tailwind layer (Tailwind 3 stays; don't bundle a Tailwind-v4 migration into a rebrand). `components/v2/ui/*` may start as restyled copies of `components/ui/*` — components are presentation, they're *allowed* to fork. ESLint `no-restricted-imports` in `app/v2` forbidding non-v2 component imports once the primitives are ported.

**1d. Routing & guard rails**
- v2 pages mirror canonical paths 1:1 (`app/v2/admin/jobs/page.tsx` ↔ `app/admin/jobs/page.tsx`) — promotion becomes a mechanical `git mv`.
- Extend `middleware.ts` matcher so `/v2/*` inherits the same role gates as its canonical twin (thin prefix-strip before the existing role check).
- Gate `/v2` behind ADMIN-only or a `sneek_preview` cookie so it's invisible to real clients/cleaners even after merging to `main`.
- Keep v2 out of PWA runtime caches: exclude `/v2` from `workboxOptions.runtimeCaching`.

**1e. Preview harness** — `.claude/launch.json` entry:
```json
{ "name": "redesign-preview",
  "runtimeExecutable": "npm", "runtimeArgs": ["run", "dev", "--", "-p", "3010"],
  "port": 3010 }
```
Owner reviews side-by-side: `localhost:3000/admin/jobs` vs `localhost:3010/v2/admin/jobs`.

**1f. sneek-nextgen** — leave tracked & excluded as-is; optionally lift its plan/schema-v2 notes into `docs/` as future-SaaS reference. Do not delete during the rebrand.

### 2. Sequencing & review gates

Order: **design system → public site → client portal → admin → cleaner mobile → QA/laundry/maintenance**. Public site is low-auth, high-brand-impact, teaches the design system; client portal is the paying-customer face; admin is the bulk (~60% of pages) and benefits from a matured kit; cleaner mobile is PWA-critical and riskiest, so it goes late with the most rehearsed process.

Each phase ends with a **review gate**: (1) owner walkthrough on :3010 with live data; (2) route-parity checklist (diff `find app -name page.tsx` against `app/v2`); (3) Playwright suites (`test:e2e`, `test:visual`, `test:a11y`) duplicated against `/v2`; (4) sign-off, then **merge `redesign` → `main`** for that portal's v2 files only (still cookie-gated). Weekly `main` → `redesign` merges throughout.

### 3. Data & auth on the copy

- **Same DB, same `NEXTAUTH_SECRET`, same host** — NextAuth v4 JWT cookies are host-scoped (ports ignored), so a login on :3000 is valid on :3010. Do **not** rotate the secret mid-program.
- **Worktree `.env` deltas** (the only edits vs live):
  ```
  SNEEK_WEB_SCHEDULER_ENABLED=false
  SNEEK_DISABLE_WEB_SCHEDULED_FALLBACK=1
  NEXT_DIST_DIR=.next-redesign
  APP_URL=http://localhost:3010/
  ```
  Never run `workers/boss.ts` from the worktree → exactly one scheduler + one pg-boss fleet (the live one). No double emails/SMS/digests.
- **Write safety**: the v2 UI calls the same 444 API routes — clicking "delete client" on :3010 deletes the real client. Policy: phases 1–2 read-mostly on live DB; for admin/cleaner phases restore a snapshot into `SPS_Redesign` and point the worktree's `DATABASE_URL` there for destructive testing; final UAT per portal on live DB with the owner driving.
- **No new migrations from the redesign branch — ever.** Schema/API changes land on `main` first, then merge down. This single rule eliminates the "in-flight migration" class of cutover problems.

### 4. Cutover & rollback

Per-portal, three steps, no DNS/port/deploy change ever:
1. **Shadow** (1–2 weeks/portal): v2 merged to `main`, deployed, cookie-gated. Staff opt in via `/api/preview/enable` (middleware rewrites `/admin/*` → `/v2/admin/*` for cookie holders). Real usage, instant opt-out.
2. **Promote**: single commit — `git mv app/v2/admin/* app/admin/*` (old pages deleted in the same commit; API routes untouched), middleware rewrite removed, build with headroom, deploy.
3. **Rollback**: `git revert` of that one commit + rebuild (~minutes). DB/auth/APIs never changed → rollback has no data implications. Keep the previous `.next-prod` for even faster repoint via `NEXT_DIST_DIR`.
- **Side-by-side duration**: program ~10–14 weeks; any portal runs old+new simultaneously only during its shadow window.
- **PWA on promote day** (cleaner portal especially): bump SW version, verify update flow, add a build-id assertion — a `/api/version` check in the app shell forcing `location.reload()` after SW update when served build id ≠ running build id. Tell cleaners to close/reopen the installed PWA once.

### 5. Risk register (top 10)

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Drift**: months of live hotfixes vs redesign | v2 = new files (no per-file conflicts); weekly main→redesign merges; parity re-diff each gate |
| 2 | **Auth/session incompatibility** | None by construction (same NextAuth v4/secret/middleware); NextAuth v5 / Next 15+ upgrades explicitly banned inside the rebrand |
| 3 | **PWA SW cache poisoning at cutover** | SW version bump per promote; build-id reload assertion; `/v2` excluded from runtime caches during shadow; cleaner portal last, with comms |
| 4 | **Windows build memory** (~2× pages during transition) | `NEXT_BUILD_MEMORY_MB=8192` for transition builds; old pages deleted at each promotion so page count decays |
| 5 | **Double schedulers/workers** from preview | §3 env kill-switches committed as `.env.redesign.example`; never run workers from worktree; verify on boot via scheduler log line |
| 6 | **Destructive writes from preview against live DB** | Snapshot DB `SPS_Redesign` for build/test; live DB only for supervised UAT |
| 7 | **Template/DB compat**: schema/API "quick fixes" sneaking in via redesign branch | Hard rule: schema & API changes land on `main` first; CI check that `prisma/migrations` and `app/api` diffs vs `main` are empty on the redesign branch |
| 8 | **Scope creep into a rewrite** (the sneek-nextgen gravity well) | Written scope charter: rebrand = pages/components/styles only; platform upgrades are a separate post-rebrand project |
| 9 | **Route-parity gaps** (deep links, `accept-invite`, `force-password-reset`, `rate/[jobId]`, email-linked pages) | Scripted parity diff per gate; grep email/notification templates for every URL emitted and test each against v2 |
| 10 | **Long-lived branch entropy / accidental push** | Weekly merges keep delta small; per-portal merges shrink the branch; "no push until authorized" applies to `redesign` too |

(Honorable mentions: `.env` secrets in working tree — don't let the worktree copy leak into a commit; the 3.3GB zips must never enter the worktree.)

### 6. Effort & milestones

Effort: **M0 Setup S · M1 Design system M · M2 Public M · M3 Client L · M4 Admin XL · M5 Cleaner L · M6 QA/Laundry/Maintenance M · promotions S each · PWA hardening S.**

1. **M0 (S)** — branch + worktree + env kill-switches + launch.json + parity-diff script + scope charter.
2. **M1 (M)** — v2 tokens + `components/v2/ui` kit + showcase page; **owner approves the brand direction here**, before any portal work.
3. **M2 (M)** — public site in v2; **Gate 1**.
4. **M3 (L)** — client portal; **Gate 2**; first `main` merge + first shadow rehearsal with staff accounts.
5. **M4a (L)** — admin core (jobs, calendar, clients, properties). **M4b (L)** — admin long tail; **Gate 3**.
6. **M5 (L)** — cleaner mobile PWA screens + offline behavior verified on a real phone; **Gate 4**.
7. **M6 (M)** — QA, laundry, maintenance portals; **Gate 5**.
8. **M7 (S)** — promotions in order: public → client → admin → QA/laundry/maintenance → cleaner (last), 1–2 week shadow each, rollback drill executed for real before the first promotion.
9. **M8 (S)** — cleanup: delete empty `app/v2`, remove preview middleware, retire the worktree, decide sneek-nextgen's fate separately.
10. **M9 (S)** — post-cutover watch: error logs, SW update telemetry, build-memory baseline re-measured.

**Bottom line**: build the rebrand as a parallel `app/v2` route tree on a `redesign` branch, previewed from a git-worktree "exact copy" on port 3010 with schedulers disabled, sharing the live `lib/`, API routes, Prisma schema and NextAuth untouched; cut over portal-by-portal by promoting files, never by swapping servers. Reject `sneek-nextgen/` as the rebrand vehicle.
