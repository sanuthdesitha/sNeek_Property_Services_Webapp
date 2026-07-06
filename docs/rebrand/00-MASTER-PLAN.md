# sNeek Property Services — "ESTATE" Rebrand Master Plan

**Version 1.0 · Planned 2026-07-04 · Status: AWAITING OWNER APPROVAL — nothing implemented, nothing pushed**

This is the synthesis of four deep planning reports (in this folder):

| Doc | Contents |
|---|---|
| `01-inventory-ux-audit.md` | All ~178 pages catalogued, IA critique, new sitemaps per portal, UX debt list, per-portal improvement backlogs |
| `02-design-system-estate.md` | The complete "Estate" luxury design system: brand direction, full token sheet, 26-component redesign spec, signature moments, a11y/perf guardrails |
| `03-templates-editor-architecture.md` | Unified block template model for ALL templates (30 emails, 50 event templates, invoices ×3, quote, reports ×3, SMS, PDFs) + drag-and-drop layout editor spec + library decisions |
| `04-migration-strategy.md` | The "exact copy" isolation strategy, portal-by-portal cutover, risk register |

---

## 1. Executive summary

A total UI/UX rebrand of every page (≈178 routes across admin, cleaner, client, laundry, QA, maintenance portals + public site) and every outbound template (emails, invoices, quotes, reports, forms, SMS, PDFs) onto a single luxury design system — built **in isolation from the live app** and cut over portal-by-portal with instant rollback.

**Brand: "Estate"** — deep estate green `#1E4A3B` + champagne gold `#C0A265` + warm ivory, Fraunces variable serif for display/numerals, Inter for UI. "Obsidian" near-black/gold serves as the dark mode and the ceremonial register (login, PDF covers, confirmations). Each portal gets a mineral accent inside one system (Admin=estate green, Client=champagne, Cleaner=copper, Laundry=delft, QA=aubergine, Maintenance=steel) — which is also the white-label SaaS story.

**Isolation: `app/v2` + git worktree** — new pages as new files on a `redesign` branch, sharing the live `lib/` (297 modules), API routes (444), Prisma schema, and auth untouched. The owner's "exact copy" is a git worktree at `..\Website-redesign` on port **3010** against the same DB (schedulers disabled). Cutover = per-portal file promotion with 1–2 week cookie-gated shadow, one-commit rollback. `sneek-nextgen/` is **rejected** as the vehicle (it is a divergent platform rewrite — Next 16/Prisma 7/NextAuth v5/forked schema) and stays parked.

**Templates: one block-based document model** rendering to email HTML / A4 PDF / web / SMS from one brand-token source, edited in a single drag-and-drop layout editor, with append-only versioning and issue-time snapshots so published invoices/reports can never change retroactively.

---

## 2. Decisions locked by the planning (owner may veto any)

| # | Decision | Choice | Rejected alternatives |
|---|---|---|---|
| D1 | Brand direction | **Estate** (green/champagne/ivory, serif-accented) with Obsidian dark mode | Obsidian-first (fails as daylight ops workspace), Linen (under-powered for status-heavy ops) |
| D2 | Display typeface | **Fraunces** variable (replaces Cormorant Garamond) + keep Inter/JetBrains | — |
| D3 | Form state library | **React Hook Form + zodResolver** for all forms (already installed, zod-aligned) | Formik (effectively unmaintained, second validation idiom) |
| D4 | Schema-driven forms | **Keep the in-house form engine**; block propsSchema→auto RHF inspectors | RJSF (can't express photo-evidence/stamp-tags/property-feature conditionals; would invalidate stored snapshots) |
| D5 | Drag and drop | **dnd-kit everywhere** (already powers the form builder) | react-beautiful-dnd (deprecated/archived — ruled out), Pragmatic DnD (excellent but no sortable preset/a11y out of the box; nothing we need it for) |
| D6 | Isolation approach | **app/v2 route tree on `redesign` branch + git worktree preview on :3010** | Pure branch restyle-in-place (merge hell), sneek-nextgen parallel app (platform rewrite trap), raw dir copy (nothing merges back) |
| D7 | Cutover | **Per-portal file promotion** with cookie-gated shadow, never a server/port/DNS swap | Big-bang deploy swap |
| D8 | Template model | **One `TemplateDoc` block JSON, 4 renderers** (email/pdf/web/sms), brand tokens from AppSettings | Per-channel template systems (status quo: six parallel renderers) |
| D9 | PDF engine | **Keep Playwright pipeline** (`renderPdfFromHtml`) | react-pdf/etc. rewrite |
| D10 | Editor state | **zustand** temporal store (undo/redo) | — |

**Hard rules for the whole program:**
- No pushes until the owner authorizes. All work on `redesign` branch, local.
- NEVER fork `lib/**`, `app/api/**`, `prisma/**`, auth/middleware logic. v2 is presentation only.
- No schema migrations from the redesign branch — schema/API changes land on `main` first.
- No platform upgrades (Next 15+/NextAuth v5/Tailwind v4/Prisma 7) inside the rebrand.
- Every phase ends with an owner review gate on :3010 before the next begins.

---

## 3. New information architecture (summary — full sitemaps in doc 01)

**Admin: 6 areas, everything ≤2 clicks** — `/admin` command dashboard (merges Dashboard+Ops), Operations (Jobs with board/calendar/route as *views*, Quality [QA queue+templates+recleans], Laundry, Maintenance, Cases), Clients (ONE canonical client 360°, Properties, Onboarding, Quotes), Team (unified person record merging Cleaners/Workforce/Accounts-staff, Hiring, Hub, Approvals), Finance (Overview/Invoices/Payroll/Cleaner invoices/Pricing/Reports), Growth (Marketing, Website CMS, Comms center), System (regrouped Settings, Forms & checklists, Activity, Diagnostics). Kills the 19 redirect stubs and the 3 duplicate client-detail routes.

**Client: 6 nav items** — Home, Services (jobs+calendar+booking+quotes), Properties (inventory/shopping/stock/laundry live INSIDE each property), Money, Messages, More. Kills `/client/disputes` orphan and the quotes-page duplication.

**Cleaner: 5 bottom tabs, mobile-first** — Today (route+jobs merged, the only landing), Jobs, Supplies (restock+stock+shopping unified), Pay, More. The 6,507-line job form becomes per-step route segments with a store + draft persistence.

**Laundry:** land on Today run sheet; decompose the 2,484-line dashboard into Today/Runs/Stats. **QA:** Queue/Completed/Profile; QA admin config moves into Admin→Quality. **Maintenance:** keep minimal, adopt cleaner-form step components. **Public:** structure unchanged; quote wizard elevated as the single conversion CTA; all hardcoded marketing colors tokenized.

---

## 4. Unified phase plan (merges all four reports' sequencing)

| Phase | Contents | Effort | Gate |
|---|---|---|---|
| **M0 Setup** | `redesign` branch + worktree at `..\Website-redesign` (port 3010, `.env` deltas: schedulers OFF, `NEXT_DIST_DIR=.next-redesign`), launch.json entry, route-parity diff script, scope charter in `app/v2/README.md` | S | — |
| **M1 Design system** | Estate tokens (new `globals.css` values under v2 layer + Fraunces via next/font), `components/v2/ui` kit (26 primitives per doc 02), chart-kit reskin, `/dev/primitives` v2 gallery as living style guide | M | **Owner approves brand direction on real components** |
| **M2 Public site** | All 20 public pages in v2 + tokenized marketing colors + elevated quote wizard | M | Gate 1 |
| **M3 Templates foundation** | Brand tokens module, block registry + 4 renderers, TemplateDefinition/Version/RenderedDocument migrations (landed on main first), editor MVP on 3 pilot kinds (invoice email, client invoice PDF, one SMS) | L | Pilot artifacts approved |
| **M4 Client portal** | New 6-item IA, dashboard hero, property-scoped features, Money page; client-facing docs (quote, client report, client invoice) on the new template system | L | Gate 2 + first shadow rehearsal |
| **M5 Admin core** | Command dashboard, Jobs (views+saved filters+DataTable primitive), job detail tab rebuild, client 360°, person record | XL | — |
| **M6 Admin long tail** | Finance, payroll, approvals (j/k keyboard), quotes builder, inventory, laundry admin, settings regroup, Comms center; remaining templates migrated (all 30 emails + 50 event kinds seeded) | L | Gate 3 |
| **M7 Cleaner mobile** | Today landing, job form decomposition (per-step segments, reducer store, offline photo queue, sticky action bar), Supplies/Pay tabs; PWA verified on a real phone | L | Gate 4 |
| **M8 Field portals** | Laundry (Today/Runs/Stats + scan-first), QA (queue triage + side-by-side inspection), Maintenance | M | Gate 5 |
| **M9 Promotions** | Portal-by-portal: public → client → admin → QA/laundry/maintenance → cleaner (last, PWA-hardened). Each: 1–2 week cookie shadow → `git mv app/v2/* →` canonical → one-commit rollback available. SW version bump + build-id reload assertion | S each | Rollback drill before first promotion |
| **M10 Cleanup** | Delete legacy pages/builders/stubs, retire worktree, remove preview middleware, legacy `{var}` dialect deprecation, post-cutover watch | S | — |

Overall estimate: **~10–14 weeks** of focused work; both UIs run side-by-side only during each portal's shadow window.

---

## 5. Top risks (full register in doc 04)

1. **Drift** between live hotfixes and redesign → v2 = new files + weekly main→redesign merges + parity re-diff each gate.
2. **PWA cache poisoning at cutover** (cleaners' installed app) → SW version bump, build-id reload assertion, cleaner portal promoted last.
3. **Scope creep into a platform rewrite** (the sneek-nextgen gravity well) → written scope charter; upgrades are a separate post-rebrand project.
4. **Destructive writes from the preview** against live DB → snapshot DB `SPS_Redesign` for build phases; live DB only for supervised UAT.
5. **Email-client fidelity** of new templates → table/inline renderer lineage kept, publish-time lint, test-sends, Outlook/Gmail QA on the email wave.
6. **Windows build memory** with ~2× pages during transition → `NEXT_BUILD_MEMORY_MB=8192`, old pages deleted at each promotion.

---

## 6. What the owner needs to decide to start

1. **Approve brand direction "Estate"** (or pick Obsidian/Linen from doc 02 §1) — final look signed off at the M1 gate on real components either way.
2. **Approve the isolation approach** (app/v2 + worktree on :3010).
3. **Confirm the library stack** (RHF+zod / in-house form engine / dnd-kit).
4. Green-light **M0+M1** to begin.
