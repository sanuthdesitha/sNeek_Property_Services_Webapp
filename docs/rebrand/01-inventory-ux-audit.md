# Rebrand Doc 01 — Inventory + UX Audit

> Planning report (Fable 5 deep audit, 2026-07-04). Read-only audit of `E:\sNeek Property Service\Website` — Next.js 14 App Router, ~178 routed pages across 8 surfaces. See `00-MASTER-PLAN.md` for the synthesis.

Complexity key: **S** < ~120 lines, **M** 120–500, **L** > 500 (page + primary workspace component). `→` = pure `redirect()` stub. `(w)` = thin wrapper whose weight lives in a `components/*` workspace.

## 1. COMPLETE PAGE INVENTORY

### 1.1 Public marketing site — `app/(public)` + `app/page.tsx` (20 pages)

| Route | Purpose | Size |
|---|---|---|
| `/` | Marketing homepage (hero, services, FAQ, reviews, availability widget); redirects logged-in users to their portal | M (w — `home-page.tsx`) |
| `/services` | Services index | S (w) |
| `/services/[slug]` | Service detail w/ luxury gradient hero | S (w) |
| `/quote` | Public 8-step quote wizard with live price estimate | L (w — `components/quote/request-quote-page.tsx`) |
| `/subscriptions` | Recurring-plan marketing page | S (w) |
| `/airbnb-hosting` | Airbnb turnover landing page | S (w) |
| `/cleaning/[suburb]` | Programmatic SEO suburb landing pages | S |
| `/compare` | Competitor/DIY comparison page | S (w) |
| `/why-us` | Trust/differentiators page | S (w) |
| `/careers` | Careers listing (feeds `/apply/[slug]`) | S (w) |
| `/blog`, `/blog/[slug]` | Blog index + article | S |
| `/faq` | FAQ page | S (w) |
| `/contact` | Contact page + form | S (w) |
| `/privacy`, `/terms` | Legal pages | S |

### 1.2 Auth — `app/(auth)` + standalone (7 pages)

| Route | Purpose | Size |
|---|---|---|
| `/login` | Credentials + 2FA step + remember-device | M (414) |
| `/register` | Client self-registration | M (355) |
| `/forgot-password`, `/reset-password` | Password recovery pair | S/S |
| `/recover-2fa` | 2FA recovery-code flow | S |
| `/force-password-reset` | Forced rotation gate | S |
| `/unauthorized` | Role-denied landing | S |

### 1.3 Admin portal — `app/admin` (93 routes, of which **19 are redirect stubs**)

**Overview / dashboards**

| Route | Purpose | Size |
|---|---|---|
| `/admin` | Ops dashboard: immediate-attention feed, KPI tiles, 7d feedback, revenue cards | L (1,141) |
| `/admin/ops` | "Today" dispatch view: route plan, attention list, continuation requests | M (455) |
| `/admin/ops/map` | Live cleaner/job map | M (300) |
| `/admin/ops/live-map` | → `/admin/ops/map` | stub |
| `/admin/calendar` | Full-calendar of all jobs | S (76, w — FullCalendar) |
| `/admin/activity` | Global audit/activity log | M (264) |

**Operations**

| Route | Purpose | Size |
|---|---|---|
| `/admin/jobs` | Jobs board (filters, statuses, bulk ops) | L (1,641) |
| `/admin/jobs/[id]` | Job detail: assignment, checklist, media, QA, billing, timeline | **XL (3,224)** |
| `/admin/jobs/new` | Create job | S (w — `new-job-form`) |
| `/admin/jobs/[id]/reclean-review` | Reclean dispute review | M (211) |
| `/admin/jobs/route-map` | Route optimization map | M (196) |
| `/admin/onboarding` (+ `/new`, `/[id]`) | Client onboarding pipeline + case detail | M/M/L (220/172/572) |
| `/admin/cases` | Issues/disputes workspace | M (w — `admin-cases-workspace`) |
| `/admin/issues` | → `/admin/cases` | stub |
| `/admin/laundry` | Laundry ops hub (runs, flags, live map, suppliers) | **XL (2,250)** |
| `/admin/laundry/stats` | Laundry analytics | M (269) |
| `/admin/laundry/suppliers` | Laundry supplier management | S (w) |
| `/admin/maintenance` (+ `/[id]`) | Maintenance visits list + detail | S (w) |
| `/admin/qa` | QA template administration | M (w) |
| `/admin/forms` | Form/checklist builder hub (builder, submissions, checklists tabs) | L (1,137) |
| `/admin/forms/new`, `/forms/[id]/edit`, `/forms/stats` | Form CRUD + analytics | M/S/M |
| `/admin/checklists` | → `/admin/forms?tab=checklists` | stub |
| `/admin/checklists/library`, `/checklists/coverage` | Checklist library + property-coverage generator | L (524) / M (253) |
| `/admin/templates` | → `/admin/forms` | stub |
| `/admin/templates/email` | → `/admin/notifications?tab=templates` | stub |

**Inventory hub**

| Route | Purpose | Size |
|---|---|---|
| `/admin/inventory` | Tabbed hub: Items / By Property / On-hand / Stock Counts / Shopping Runs / Suppliers / Delivery | M (315 + tab workspaces) |
| `/admin/inventory/properties` | Per-property inventory detail | S |
| `/admin/stock-runs`, `/shopping-runs`, `/suppliers`, `/delivery-profiles` | → inventory hub tabs (4 stubs) | stubs |

**People / accounts**

| Route | Purpose | Size |
|---|---|---|
| `/admin/accounts` | Tabbed hub: Staff / Clients | M (149 + workspaces) |
| `/admin/accounts/users/[id]` | Staff member profile (perf, docs, pay) | M (471) |
| `/admin/accounts/clients/[id]` | Client account detail | M (398) |
| `/admin/users` | → `/admin/accounts?tab=staff` | stub |
| `/admin/clients` | → `/admin/accounts?tab=clients` | stub |
| `/admin/clients/new`, `/clients/[id]`, `/clients/[id]/edit`, `/clients/[id]/hub` | Legacy client CRUD + client hub workspace | S/M/S/M |
| `/admin/cleaners` | Cleaner roster hub | S (w — `cleaners-hub`) |
| `/admin/workforce` | Workforce hub: Team/Performance + Updates/Chat/Groups/Documents/Learning/Recognition | S (w — big `admin-workforce-hub`) |
| `/admin/workforce/performance` (+ `/[userId]`) | → hub tab / individual scorecard | stub / M (493) |
| `/admin/hiring` (+ `/positions/[id]`, `/applications/[id]`) | Hiring pipeline: positions, applicants, quiz results | S (w) |
| `/admin/properties` (+ `/new`, `/[id]`) | Property register + property detail (rates, access, checklists, jobs, iCal) | M / S / **XL (1,721)** |
| `/admin/messages` (+ `/compose`) | Unified inbox workspace | S (w — `admin-messages-workspace`) |

**Commercial / finance**

| Route | Purpose | Size |
|---|---|---|
| `/admin/quotes` (+ `/new`, `/preview`, `/[id]/convert`) | Quote pipeline, builder, client-facing preview, convert-to-client | L (918) / S / S / S |
| `/admin/pricing` | Rate-card/pricebook editor | M (235) |
| `/admin/approvals` | Approval Center: pay, clock, timing, reclean etc., tabbed | L (958) |
| `/admin/pay-adjustments`, `/time-adjustments` | → approvals tabs | stubs |
| `/admin/finance` | Finance hub: Overview / Invoices / Payroll tabs | M (108 + `finance-dashboard-workspace`) |
| `/admin/finance/dashboard`, `/invoices`, `/payroll` | → finance tabs (3 stubs) | stubs |
| `/admin/finance/payroll` (+ `/admin/payroll/[id]`) | Payroll run list + run detail | M (186) / S (w) |
| `/admin/cleaner-invoices` | Cleaner-submitted invoice review | S (w) |
| `/admin/reports` (+ `/themes`, `/themes/[id]/edit`) | Client-facing report generator + PDF themes | M (366) / M / S |

**Growth / system**

| Route | Purpose | Size |
|---|---|---|
| `/admin/marketing` (+ `/assets`, `/campaigns`, `/campaigns/new`, `/social`, `/social/compose`) | Marketing hub: asset library, email campaigns, social composer | S–M (6 routes) |
| `/admin/website` (+ `/preview`, `/blog`) | Public-site CMS editor + live preview + blog manager | S (w — big `website-editor`) |
| `/admin/notifications` | Notification center: send/control/templates/log/audit/delivery tabs | L (664) |
| `/admin/settings` | **10-tab** settings workspace (core, integrations, iCal, gateways, Xero, finance notifications, notification tools, pricebook, audit) | L (w — `settings-workspace`) |
| `/admin/settings/display` | Density/theme prefs | S |
| `/admin/settings/payment-gateways`, `/admin/integrations`, `/admin/integrations/xero` | → settings tabs (3 stubs) | stubs |
| `/admin/system/diagnostics`, `/system/email`, `/system/uploads` | Health checks, SMTP test, upload storage | S/S/S |
| `/admin/profile` | Admin profile + activity | S |

### 1.4 Cleaner portal — `app/cleaner` (17 pages)

| Route | Purpose | Size |
|---|---|---|
| `/cleaner` | Day dashboard: today's jobs, earnings, alerts | L (752) |
| `/cleaner/jobs` | Assigned job list | M (364) |
| `/cleaner/jobs/[id]` | **The field job-execution form**: briefing → checklist → uploads → laundry → submit | **XXL (6,507)** |
| `/cleaner/route` | Day route view | M (136) |
| `/cleaner/calendar` | Personal calendar | S |
| `/cleaner/availability` | Weekly availability editor | S (w) |
| `/cleaner/hub` | Team hub (feed/chat/docs/learning/recognition) | S (w — `staff-workforce-hub`) |
| `/cleaner/shopping` (+ `/[id]`) | Shopping runs | S/S (w) |
| `/cleaner/stock-runs`, `/restock` | Stock counts + restock requests | S/S (w) |
| `/cleaner/invoices`, `/pay-requests` | Invoice submission, pay requests | S (w) / S |
| `/cleaner/lost-found` | Lost & found log | S (w) |
| `/cleaner/profile`, `/settings` | Profile + settings | M/S |

### 1.5 Client portal — `app/client` (23 pages)

| Route | Purpose | Size |
|---|---|---|
| `/client` | Dashboard: attention panel, KPIs, recent reports, finance snapshot | L (501) |
| `/client/jobs` (+ `/[id]`) | Service history + job detail (media, report, timeline) | S (w) / L (796) |
| `/client/booking` | Request a booking | S (w) |
| `/client/calendar` | Upcoming services calendar | S |
| `/client/properties` (+ `/[id]`) | Property list + detail | S / M (387) |
| `/client/reports` | Report archive w/ filters | M (221) |
| `/client/approvals` | Client-side approvals (quotes/charges) | S (w) |
| `/client/finance` | Rates, pending charges, invoices | M (198) |
| `/client/quotes` / `/client/quote` | My quotes / request a quote (two separate nav items) | S (w) / S (w) |
| `/client/messages` | Messaging with ops | S (w) |
| `/client/maintenance` | Maintenance requests | S |
| `/client/cases` | Disputes/cases | S (w) |
| `/client/disputes` | Legacy dispute page (5 lines — near-dead) | stub-ish |
| `/client/laundry` | Laundry status | S (w) |
| `/client/inventory`, `/shopping` (+ `/[id]`), `/stock-runs` | Inventory visibility trio | M/S/S |
| `/client/referrals` | Rewards/referrals | S (w) |
| `/client/profile`, `/settings` | Profile + settings | S/S |

### 1.6 Laundry portal — `app/laundry` (8 pages)

| Route | Purpose | Size |
|---|---|---|
| `/laundry` | Laundry partner dashboard (pickups, deliveries, bag scans) | **XL (2,484)** |
| `/laundry/today` | Today's run sheet | M (457) |
| `/laundry/hub` | Team hub | S (w) |
| `/laundry/calendar`, `/invoices`, `/profile`, `/settings` | Support pages | S each |

### 1.7 QA portal — `app/qa` (3 pages)

| Route | Purpose | Size |
|---|---|---|
| `/qa` | Inspection queue | S (w — `components/qa/*`) |
| `/qa/jobs/[id]` | Inspection scoring form | S (w) |
| `/qa/profile` | Profile | S |

### 1.8 Maintenance portal — `app/maintenance` (4 pages)

| Route | Purpose | Size |
|---|---|---|
| `/maintenance` | My visits | S (w — `components/maintenance/*`) |
| `/maintenance/visits/[id]` | Visit execution | S (w) |
| `/maintenance/history`, `/settings` | History + profile | S/S |

### 1.9 Token / standalone flows (8 pages)

| Route | Purpose | Size |
|---|---|---|
| `/accept-invite/[token]` | Staff/client invite acceptance | S (110) |
| `/apply/[slug]` | Job application form | S (w) |
| `/quiz/[token]` | Hiring quiz | M (120) |
| `/amenities/[token]` | Client amenities survey | M (178) |
| `/rate/[jobId]`, `/feedback/[token]` | Post-service rating / feedback surveys | S (w) |
| `/onboarding` | New-user guided tour | M (332) |
| `/dev/primitives` | Internal UI-kit gallery | M (331) |

**Totals: ~178 pages — 93 admin (19 redirects), 23 client, 17 cleaner, 20 public, 8 laundry, 7 auth, 4 maintenance, 3 QA, 8 standalone.**

## 2. INFORMATION ARCHITECTURE CRITIQUE + PROPOSED NEW IA

### 2.1 What exists today

Admin nav (`components/admin/sidebar.tsx`) = 7 groups / 26 items: Overview (Dashboard, Ops) · Operations (Jobs, Onboarding, Calendar, Cases, QA Reviews→`/qa`, Laundry, Inventory, Maintenance, Forms) · People (Cleaners, Workforce, Hiring, Accounts, Properties, Messages) · Commercial (Quotes, Pricing, Approvals, Finance, Cleaner Invoices, Reports) · Growth (Marketing, Website, Notifications) · Account (Settings, Profile) · System (Activity, Diagnostics). Badge counts on Approvals/Laundry/Jobs only. A Cmd-K palette + shortcut cheatsheet exist (admin only).

### 2.2 IA problems (specific)

1. **Half-migrated hub consolidation.** 19 redirect stubs prove a past consolidation into hubs (Accounts, Finance, Inventory, Approvals, Settings, Forms) — but the *sidebar still bypasses the hubs' logic*: "Cleaner Invoices" sits top-level in Commercial while payroll/invoices live inside Finance tabs; "Pricing" is top-level while a "Price book" tab also exists inside Settings (two rate-editing surfaces).
2. **Three overlapping client-detail surfaces:** `/admin/accounts/clients/[id]`, `/admin/clients/[id]`, and `/admin/clients/[id]/hub` all render client detail workspaces. A staff member cannot know which is canonical.
3. **People group is incoherent:** Cleaners, Workforce, Hiring, and Accounts(Staff) are four entries over one population. "Cleaners" (roster) vs "Workforce" (team/performance/social hub) vs Accounts→Staff (user records) forces admins to visit three pages to fully manage one person. Properties and Messages also live in "People" where they don't belong.
4. **Dashboard vs Ops overlap:** both `/admin` and `/admin/ops` render "immediate attention" + today lists (`lib/dashboard/immediate-attention` used by both). Two competing morning-start pages.
5. **QA lives outside admin** (`/qa` link in the admin sidebar jumps portals; QA templates are administered at `/admin/qa`, which is *not in the sidebar at all*). Buried features: `/admin/checklists/library`, `/checklists/coverage`, `/admin/forms/stats`, `/admin/reports/themes`, `/admin/system/email`, `/admin/system/uploads`, `/admin/jobs/route-map`, `/admin/settings/display` — none reachable from nav.
6. **Communication is fragmented:** Messages (inbox), Notifications (send/templates/log — 8+ tabs), Marketing→campaigns/social, Workforce→Updates/Chat. Four sends, four logs, no unified outbound story.
7. **Settings is a 10-tab junk drawer** mixing brand identity, integrations, payments, pricebook, notification tooling and audit logs.
8. **Client portal nav is a flat list of up to 17 items**, including near-duplicates: "My quotes" vs "Request a quote", "Inventory" vs "Shopping" vs "Stock Counts", plus a dead `/client/disputes` alongside Cases. Mobile bottom bar shows only the first 5 — ordering, not importance, decides mobile visibility.
9. **Cleaner nav (12 items)** buries the single thing cleaners do (today's job) beneath Team Hub/Route/Shopping/Stock/Restock/Lost&Found; "Stock Counts" + "Restock" + "Shopping" is a three-way split of one supply workflow.
10. **Inconsistent hub navigation patterns:** Accounts/Inventory/Finance use pill tab-navs; Workforce uses a top-nav + a mobile prev/next "Section" carousel (`hub-tab-nav.tsx`); Settings/Notifications/Forms use plain `Tabs`; Marketing uses landing-page cards. Five different "hub" idioms.

### 2.3 Proposed new IA

**ADMIN — 6 top-level areas, dashboard-first, every page reachable ≤2 clicks:**

```
/admin ................ Command dashboard (merge today's /admin + /admin/ops):
                        attention queue, today's dispatch+map, KPIs, approvals inline
├─ Operations
│  ├─ Jobs ............ board · calendar view · route map (views of ONE surface, not 3 pages)
│  │   └─ Job detail .. tabbed: Overview / Checklist / Media / QA / Billing / Timeline
│  ├─ Quality ......... QA queue + QA templates + reclean reviews (absorbs /qa admin views)
│  ├─ Laundry ......... runs · today · stats · suppliers (tabs)
│  ├─ Maintenance
│  └─ Cases ........... disputes + issues
├─ Clients
│  ├─ Client list ..... ONE canonical client 360° (merge accounts/clients/[id] + clients/[id]/hub)
│  ├─ Properties ...... detail keeps rates/access/checklists/jobs tabs
│  ├─ Onboarding pipeline
│  └─ Quotes .......... pipeline · builder · convert (absorb client-facing preview)
├─ Team
│  ├─ People .......... unified person record: profile+performance+documents+pay+availability
│  │                    (merges Cleaners + Workforce·Team/Performance + Accounts·Staff)
│  ├─ Hiring .......... positions · applications · quiz results
│  ├─ Hub ............. updates/chat/recognition/learning (social layer only)
│  └─ Approvals ....... pay · clock · timing · leave (badge stays)
├─ Finance
│  ├─ Overview · Invoices · Payroll · Cleaner invoices · Pricing (rate card — single editor)
│  └─ Reports & report themes
├─ Growth
│  ├─ Marketing ....... campaigns · social · assets
│  ├─ Website CMS ..... editor · blog · preview
│  └─ Comms ........... notification templates · send log · delivery (one outbound center)
└─ System (gear icon, not a nav group)
   ├─ Settings ........ regrouped: Brand & Company / Billing & Integrations / Ops defaults
   ├─ Forms & checklists (builder, library, coverage, stats)
   ├─ Users & roles
   └─ Activity · Diagnostics · Email/Uploads health
```
Kill all 19 redirect stubs after nav update; keep 301s at the routing layer only.

**CLIENT — 6 items max + contextual:**
```
Home (dashboard w/ next service, approvals, balance)
Services (jobs + calendar + booking + quotes — one lifecycle hub)
Properties (per-property: inventory, stock, shopping, laundry live INSIDE the property page)
Money (invoices, rates, pending charges, approvals)
Messages
More (reports archive, rewards, cases, profile, settings)
```
Rationale: inventory/shopping/stock/laundry are property-scoped facts, not top-level destinations.

**CLEANER — mobile-first, 5 bottom tabs:**
```
Today (route + jobs merged — the ONLY landing)
Jobs (list/calendar toggle)
Supplies (restock + stock counts + shopping unified)
Pay (invoices + pay requests + earnings)
More (hub, availability, lost&found, profile)
```

**LAUNDRY:** Today (default landing, not Dashboard) · Runs · Calendar · Invoices · Profile. The 2,484-line dashboard should be decomposed into Today + Runs.

**QA:** Queue · Completed · Profile (admin QA config moves fully into Admin→Operations→Quality).

**MAINTENANCE:** already minimal — keep My Jobs · History · Profile.

**PUBLIC:** unchanged structurally; elevate Quote wizard as the single conversion CTA from every page.

## 3. UI PATTERN AUDIT

### 3.1 Current design language

- **Stack:** Tailwind + hand-rolled shadcn-style kit (`components/ui/` — 32 primitives incl. `page-header`, `status-pill`, `empty-state`, `error-state`, `loading-state`, `brand-loader`, `fab`, `upload-dropzone`) + Sphere-UI-style chart kit (`components/charts/`: `KpiTile`, `Sparkline`, `AreaTrend`, `BarCompare`, `DonutStat`, `ChartCard` on Recharts 3).
- **Tokens (globals.css / tailwind.config.ts):** HSL variables — primary teal `188 78% 30%`, gold accent `35 95% 50%`, success/warning/info/destructive, `surface`/`surface-raised`, radius scale 8/10/14/20px, 3-tier elevation shadows, focus-ring + reduced-motion support. Apple-flavoured font stack, Inter for portal display type, **Georgia serif scoped to `.marketing-only`** for the luxury public voice.
- **Theme system:** `data-portal-theme` = `light` / `dark` / `public` (warm ivory `44 52% 97%` + teal ink). Public site gets its own gradient background, small-caps eyebrows, `.lux-rise`/`.scroll-reveal` animations.
- **Shells:** Admin = `AdminSidebar` (7 groups, live badges, collapse) + `AdminHeader` + capped `max-w-screen-2xl` column + CommandPalette/Shortcuts. All other portals = shared `PortalShell` (sidebar + mobile drawer + **mobile bottom tab bar of first 5 nav items**) — a genuinely good shared foundation.

### 3.2 Concrete UX debt list

**Structure / code-shape debt**
1. **Monolith pages:** `app/cleaner/jobs/[id]/page.tsx` is a single 6,507-line `"use client"` file with **91 `useState` hooks** driving a 5-step flow — unmaintainable and re-render-heavy on low-end field phones. Similarly `admin/jobs/[id]` (3,224), laundry portal (2,484) / admin laundry (2,250), jobs board (1,641), admin dashboard (1,141).
2. **Loading states only at portal roots:** exactly 6 `loading.tsx` files (one per portal root). Deep, heavy routes (jobs board, job detail, finance) have no route-level skeletons; perceived slowness on every nav within a portal.
3. **Empty vs loading ambiguity:** `empty-state.tsx` and `loading-state.tsx` both render skeleton-ish dashed cards; several pages use neither and hand-roll text.

**Consistency debt**
4. **Two page-header systems:** `AdminPageShell` (wraps `PageHeader`, has vestigial `eyebrow` prop that is *discarded*) coexists with pages composing `PageHeader` directly and pages with no header component at all.
5. **Five hub-tab idioms** (see §2.2 #10) — including the bespoke mobile prev/next "Section" carousel in `workforce/hub-tab-nav.tsx` that hides sibling tabs behind serial navigation.
6. **Radius drift on public site:** token scale is 8–20px, but marketing cards use `rounded-[2rem]`, `rounded-[1.8rem]`, `rounded-[1.35rem]` ad hoc.
7. **Hardcoded colors bypassing tokens:** announcement bar hexes (`#0c2c30`, `#1d3b1f`, `#0c2329`, `#3a1414` in `public-site-shell.tsx`); service-detail hero `from-[#0c2329] to-[#163b41]` + hardcoded rgba shadow; WhatsApp `bg-[#25D366]`; careers badges on raw Tailwind palette colors; `website-editor.tsx` preview gradients that **don't match the real announcement bar**; custom rgba card shadows that ignore `--shadow-color` and break in dark mode.
8. **Map popups are theme-blind:** Google Maps info windows in `laundry-live-map.tsx`, `ops-overview-map.tsx`, `properties-map.tsx` use inline styles — unreadable in dark mode.
9. **Status color plumbing:** `.status-*` classes in globals.css hardcode `!important` opacity tiers per status for FullCalendar — a parallel status system next to `status-pill.tsx`.

**Interaction / mobile debt**
10. **Dialog-first editing everywhere:** admin workspaces lean on stacked Dialogs where side-panels or inline editing would preserve context.
11. **KPI sparkline hidden on mobile** (`kpi-tile.tsx`: `hidden … sm:block`) with no mobile substitute.
12. **Dashboard KPI strip becomes horizontal scroll on mobile** — pattern used inconsistently elsewhere.
13. **Login page has zero responsive classes** (414 lines incl. 2FA/remember-device states).
14. **Client nav truncation:** mobile bottom bar = literally `navItems.slice(0, 5)`; Messages and Finance fall behind "More".
15. **Command palette + shortcuts are admin-only** — no search anywhere in client/cleaner/laundry portals despite long flat navs.
16. **Table patterns vary:** cards-grid, raw tables, and card-lists coexist; no shared DataTable with sort/saved-filter behavior.

**Strengths to preserve:** HSL token discipline in portals, 3-tier elevation, portal-theme scoping, `PortalShell` (drawer + bottom tabs), chart kit, brand-loader/empty/error primitives, reduced-motion support, the redirect-stub discipline showing IA migrations don't break URLs.

## 4. TOP UX IMPROVEMENTS PER PORTAL (redesign backlog)

### Admin (top 10)
1. **Merge `/admin` + `/admin/ops` into one command dashboard** — attention queue, today's route map, and inline approve/decline actions.
2. **Jobs board: single surface with view switcher** (board / calendar / route-map as views, not pages) + **saved filter views** + Cmd-K deep search of jobs/clients/properties.
3. **Job detail rebuild:** split the 3,224-line page into tabs (Overview / Checklist / Media / QA / Billing / Timeline) with per-tab lazy loading and a persistent right-rail summary.
4. **One canonical client 360°** — merge the three client detail routes into a tabbed record (Profile / Properties / Jobs / Money / Comms / Files); same unified "person record" for staff.
5. **Standardize the hub pattern:** one `HubTabs` component (URL-synced `?tab=`, count badges, mobile-scrollable) replacing the five current idioms.
6. **Shared DataTable primitive** (sticky header, sort, column density, bulk-select, empty/loading slots) across accounts, quotes, approvals, invoices, payroll.
7. **Route-level skeletons:** `loading.tsx` for jobs, job detail, finance, accounts, laundry — matched to the real layout.
8. **Approval Center everywhere:** one badge, one inbox, per-type tabs, keyboard j/k + approve/decline shortcuts.
9. **Replace dialog-stacking with side sheets** for record editing so table context stays visible.
10. **Settings regroup** into 3 pages (Brand & Company / Integrations & Billing / Ops defaults) with search; move pricebook to Finance; surface the orphaned pages as children of visible parents.

### Cleaner (top 8) — phones in the field
1. Decompose the 6,507-line job form into per-step route segments (`/briefing`, `/checklist`, `/uploads`…) with a persistent step-progress bar and per-step autosave — 91 useState hooks become a reducer/store with draft persistence (survive tab-kill/network loss on site).
2. "Today" as the only landing: next job card with one-tap Navigate / Arrive / Start; merge Route into it.
3. Sticky bottom action bar within the job form (primary action always thumb-reachable; 44px+ targets).
4. Offline-tolerant photo uploads: background queue with retry + visible per-photo status.
5. Unify Shopping / Stock Counts / Restock into one "Supplies" tab with a segmented control.
6. Earnings visibility on the dashboard: week-to-date pay, pending pay requests, invoice status in one card.
7. Replace list-item dialogs with full-screen sheets on mobile.
8. 5-tab bottom nav (Today/Jobs/Supplies/Pay/More) instead of the 12-item drawer list.

### Client (top 10)
1. Collapse nav to 6 items (§2.3); property-scope inventory/shopping/stock/laundry under each property page.
2. Dashboard "next service" hero card: date, cleaner, ETA, one-tap reschedule/message.
3. Merge "My quotes" + "Request a quote" into one Quotes page with a primary CTA.
4. Job detail: before/after media gallery with lightbox + report download as the visual centerpiece.
5. Approvals inline on dashboard with approve/decline without navigation.
6. Money page: single view of balance, upcoming charges, invoice history w/ PDF download and pay action.
7. Kill `/client/disputes` (5-line orphan) — Cases only.
8. Booking flow reuse: the public quote wizard's step pattern for in-portal bookings.
9. Mobile bottom tabs curated by importance (Home/Services/Money/Messages/More), not `slice(0,5)`.
10. Notifications/read-states for messages and reports (badge parity with admin sidebar counts).

### Laundry (top 6)
1. Land on "Today" run sheet, not the 2,484-line dashboard; decompose into Today + Runs + Stats.
2. Barcode/bag-scan-first workflow with large tap targets and a persistent scan FAB.
3. Per-run detail page (pickup → wash → delivery timeline) instead of one mega-page of sections.
4. Route-level loading skeletons + optimistic status updates for scan events.
5. Exceptions queue ("flagged" items currently badge into the *admin* sidebar) surfaced to the partner too.
6. Invoice summary card on Today (bags processed, period earnings).

### QA (top 5)
1. Queue with photo-dense cards (job, cleaner, due window) and swipe/keyboard triage.
2. Inspection form: side-by-side reference photo vs submitted photo comparison.
3. Score-with-evidence pattern: tap a checklist line → attach photo + note inline.
4. Pass/fail summary sheet with auto-drafted reclean request on fail.
5. Personal stats (inspections/day, average score) on the queue page.

### Maintenance (top 5)
1. Visit execution parity with the (rebuilt) cleaner job form pattern — same step components, different template.
2. Before/after photo pairing enforced per task.
3. Parts/materials capture with cost → feeds admin billing.
4. History filterable by property.
5. Bottom-tab shell (My Jobs / History / Profile) matching cleaner conventions.

### Public site (top 8)
1. Tokenize all hardcoded marketing colors (announcement bar, hero gradients, card shadows) so the luxury rebrand is a token swap, not a hunt.
2. Elevate the 8-step quote wizard: sticky live estimate, per-step deep links, mobile step indicator, abandon-recovery.
3. One typographic system: codify the serif/small-caps/eyebrow luxury voice as reusable classes with the radius scale extended to an official `2xl (32px)` token instead of arbitrary values.
4. Sync `website-editor.tsx` previews with real rendering (currently misleading gradients).
5. Suburb SEO pages (`/cleaning/[suburb]`) upgraded with real content blocks (reviews, availability) — currently 50-line shells.
6. Social-proof band (Google reviews, before/after gallery) standardized across service pages.
7. Replace WhatsApp green FAB with a token-compliant contact launcher (WhatsApp/call/quote) with managed z-index.
8. Performance pass on `.scroll-reveal`/fixed-attachment gradients for mobile (respecting the existing reduced-motion support).

---

**Key artifacts for the rebuild:** `components/admin/sidebar.tsx` (nav source of truth), `components/portal/portal-shell.tsx` (shared shell to evolve, not replace), `app/globals.css` + `tailwind.config.ts` (token base — extend, don't fork), `components/charts/` (keep), `app/cleaner/jobs/[id]/page.tsx` (highest-risk rewrite), the 19 redirect stubs (delete after IA cutover), and `app/dev/primitives` (extend into the redesign's living style guide).
