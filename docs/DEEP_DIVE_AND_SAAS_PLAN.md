# sNeek Property Service — Deep Dive, Bug Audit & SaaS Plan

_Prepared autonomously overnight. **Nothing has been pushed to git** — all code changes below are in your working tree, type-checked + production-built, awaiting your review. Run `git diff` to see them._

---

## 0. TL;DR

- I mapped the whole platform with four parallel review passes (security, correctness, SaaS architecture, UX/product).
- **The app is unusually well-built and disciplined for its size** (~108 Prisma models, ~388 API routes). No exploitable cross-record holes were found in the current single-business model.
- I **fixed 4 real bugs tonight** (type-checked + built, uncommitted) — including a **codebase-wide defect** that was blanking every form section header and every report section title.
- **The single biggest item — selling this as a public SaaS — is a large, deliberate retrofit, not an overnight job.** The danger is cross-tenant data leakage. I've produced a decision-ready plan (Part 6). It needs **one decision from you** before I execute (the tenancy approach). I did **not** blind-rewrite 388 routes while you slept, on purpose.

---

## 1. How the platform works (architecture)

- **Stack:** Next.js 14 App Router, TypeScript, Tailwind + shadcn/ui, Prisma + PostgreSQL, NextAuth v4 (JWT). Background workers + Docker compose. Resend (email), Twilio/Cellcast (SMS), Stripe/Square/PayPal (payments), Xero (accounting), Google Maps, web push (VAPID).
- **Roles:** `ADMIN, OPS_MANAGER, QA_INSPECTOR, CLEANER, CLIENT, LAUNDRY` (`prisma/schema.prisma` enum `Role`).
- **Auth:** NextAuth JWT (8h, 30m refresh). `middleware.ts` gates **page** routes by role prefix and runs a per-request `validate-session` check — but **skips `/api/*`**, so every API handler enforces its own auth via `requireRole()/requireSession()` (`lib/auth/session.ts`), which re-reads the user from the DB (so a disabled/role-changed user can't ride a stale token).
- **Ownership model (today):** purely role + relationship. A CLIENT sees rows where `property.clientId === their clientId`; a CLEANER sees rows linked via `JobAssignment`. There is **no tenant/organization boundary** above this.
- **Config:** one global `AppSetting` row keyed `"app"` (branding, pricing knobs, portal visibility, templates) + one `"integrationCredentials"` row (all third-party secrets). `lib/settings.ts` `getAppSettings()/saveAppSettings()`.
- **Domains:** jobs/dispatch, quotes→jobs, per-job-type pricing rate card + checklists (recently built), forms/QA/evidence, laundry, inventory/shopping, finance/payroll/invoicing, marketing, messaging, hiring, learning. Customer/cleaner/QA/laundry/client portals + a public marketing site.

---

## 2. Bugs FIXED tonight (in your working tree, uncommitted, tsc + build green)

1. **CRITICAL — Section headers were blank everywhere; report sections all read "Section".**
   The schema/form-builder store a section name as `section.title`, but the cleaner form (`app/cleaner/jobs/[id]/page.tsx:5135`) and the report generator (`lib/reports/generator.ts:409`) read `section.label`. Result: **every** form section card rendered with an empty header and **every** generated client/QA report showed generic "Section" headings. Pre-existing, affecting all templates (it's also why the new "Additionals" header looked blank).
   **Fix:** consumers now use `section.title ?? section.label`. Also fixed the `sectionLabel` fallbacks that drive "missing required field" toasts (showed the id slug instead of the name).

2. **HIGH — Quote totals were 100% client-trusted.** `POST /api/admin/quotes` wrote client-supplied `subtotal/gst/total` straight to the DB; a stale tab or tampered request could persist a quote whose total disagreed with its line items, then propagate into billing.
   **Fix:** the server now recomputes each line total (unit × qty), the subtotal, and GST (`calculateGstBreakdown` with the configured GST setting) and overrides the client values.

3. **HIGH — Quoted "Additionals" never appeared on the completed report.** The Additionals section was injected into the form **client-side only**; on submit the server snapshotted the *stored* template (no additionals), so the cleaner's ticks for the extras were saved but the report showed nothing — defeating the "proof the extras were done" goal.
   **Fix:** `app/api/cleaner/jobs/[id]/submit/route.ts` now snapshots the **effective** schema (template + the job's Additionals section) into `__templateSchema`, so the report renders the extras + answers.

4. **MEDIUM — Extra-id collisions could corrupt cleaner answers.** Injected extra fields used raw ids (`oven`, `interiorWindows`…) that could collide with real template field ids (a kitchen checklist may already have `oven`), making one tick toggle two fields.
   **Fix:** a shared `buildAdditionalsSection()` helper (`lib/jobs/meta.ts`) now namespaces fields as `additional__<id>` and the section as `__additionals`, used by **both** the live form and the submit snapshot so they always match.

> Net: the extras → job-form → report flow is now correct end-to-end, and the section-title bug (which hurt *all* forms and reports) is fixed.

---

## 3. Bugs found but NOT yet fixed (need your call / more care)

- **MEDIUM — Payroll shopping-reimbursement amount ignores its own filters** (`lib/finance/payroll.ts:106-116`). It sums the **whole run's** line cost and reads `settlements[0]` rather than the approved settlement, and doesn't appear to stamp `includedInPayrollRunId`, so a reimbursement can be over-counted or paid across multiple runs. Needs verification against the shopping-settlement model before I touch money logic — flagging for your confirmation.
- **LOW — Two pricing engines protect margin differently.** The public marketing calculator has the margin-floor guard; the admin per-type `priceService` (the new quote builder) relies only on `minCharge`. Decide whether the admin builder should also enforce the 40% floor.
- **LOW — `priceService` can emit a $0.00 line** when a per-unit rate is 0 but qty > 0 (cosmetic).
- **Reminder edge case:** the `force` next-date fallback in `lib/ops/reminders.ts` drops the `user.isActive` filter, so a forced reminder can still reach a disabled cleaner (contradicts the "exclude disabled users" fix). Per-recipient delivery state also isn't tracked (one bounce among two cleaners still marks the job "reminded").
- **Template-author URL safety:** `InstructionsReveal` builds a `<video src>`/`<a href>` from builder-entered reference URLs with no protocol allowlist. No risk from the extras flow (text is escaped, no iframe from user data), but if untrusted users ever edit templates, add an `https?:`-only allowlist.

---

## 4. Security findings (current single-tenant app)

**Good news:** webhooks verify HMAC signatures (`timingSafeEqual`); integration secrets are server-side, masked on read, never returned in clear, audit-logged; no secrets in `NEXT_PUBLIC_*`; admin self-demotion/self-delete blocked; destructive deletes gated behind `verifySensitiveAction`; client/cleaner routes consistently scope by ownership. No exploitable IDOR found in the sampled routes.

**Hardening to do (low/med, especially before public SaaS):**
- **Rate-limit gaps:** `/api/public/quote`, `/public/availability`, `/public/next-slot` have **no rate limit** (the quote one runs the pricing calculator → cheap DoS / price-scraping). Add limits.
- **In-memory rate limiter** (`lib/security/rate-limit.ts`) is per-process — ineffective across multiple replicas. Move to Redis/Upstash before scaling.
- **`/api/uploads/presign`** accepts arbitrary `folder`/`contentType`, unbounded, unrated → storage abuse. Add a MIME/folder allowlist + per-user rate limit. (Keys are namespaced per user, so no overwrite of others' files.)
- **`forms/templates/[serviceType]`** returns any active template to any authenticated user (harmless now; becomes a tenant-IP leak under multi-tenant).
- **Rating token** comparison is a plain `!==` (not constant-time) with a weak literal secret fallback — ensure `NEXTAUTH_SECRET`/`RATING_TOKEN_SECRET` is always set in prod.
- **Integration secrets are stored in plaintext JSON** in `AppSetting` (`lib/security/encryption.ts` exists but isn't applied). Acceptable single-tenant; **must be encrypted + per-tenant before SaaS.**

---

## 5. UX gaps, quick wins & feature ideas

### Quick wins (small, high-impact)
- **Dead notification bell** in `components/portal/portal-shell.tsx:312` (cleaner/client/laundry/QA) — renders but has no `onClick`/link. Wire to the notifications feed (the admin header already has a working one) or remove. _(I left this for you — it's a shared component across 4 portals.)_
- **Booking wizard shows no price** before "Confirm" (`components/client/booking-wizard.tsx`) despite a full calculator existing — add a live estimate at step 3.
- **Client nav has 18 items** with two adjacent quote links ("My quotes" + "Request a quote") — group into Service / Property / Billing / Support.
- Add per-section `loading.tsx` to data-heavy admin pages (only the portal root has one).
- Centralize the duplicated `JobStatus → color` maps (admin/cleaner differ for the same status).

### Highest-ROI new features (operational)
1. **Accept-quote → pick date → pay deposit, in one flow.** The pieces (quote accept, booking wizard, Stripe Checkout) all exist separately; stitching them turns quotes into paid bookings with no admin touch. **Biggest conversion win.**
2. **"Pay now" on every client invoice in-portal** (Stripe Checkout route already exists).
3. **Client-facing recurring schedule** (the `RecurringJobRule` engine exists; expose a "repeat weekly/fortnightly" toggle).
4. **True route optimization** (re-sequence a cleaner's day, not just show ETAs) — direct margin lever at $32/hr cost.
5. **Automated post-job review request → Google** (review pull-in already exists; close the loop on COMPLETED).
6. **Cleaner payslip view** (payroll engine already computes it; surface read-only).
7. **Low-stock → draft purchase order** for suppliers.
8. **Client self-reschedule within a window.**
9. **Margin/KPI dashboard** (revenue vs cleaner cost vs 40% floor — `job-money.ts` has the math).

---

## 6. Selling it as a SaaS — the plan (NEEDS YOUR DECISION)

### The reality
This is a **single-tenant** app: **0 of 108 models carry an `organizationId`**, and all config is one global `AppSetting`. (The existing `SubscriptionPlan` model is for *your clients'* cleaning subscriptions, **not** SaaS billing.) To sell to other cleaning businesses, every business needs an **isolated workspace**. That's a cross-cutting retrofit touching nearly every query. **The hard part isn't Stripe (a few days) — it's tenant isolation across 388 routes without leaking data.** Doing that wrong = one business sees another's clients/jobs/payroll. That's why I did **not** auto-build it overnight.

### Recommended approach (all four review passes agree)
**Single-DB, row-level isolation** (`organizationId` on every tenant-owned model), enforced by a **Prisma client extension + AsyncLocalStorage** (auto-injects `where: { organizationId }` and stamps it on create, so a forgotten filter **fails closed**), backstopped later by **Postgres Row-Level Security**. Rejected: schema-per-tenant and db-per-tenant (operationally heavy; Prisma has no first-class dynamic-schema support). Reserve db-per-tenant for a future "Enterprise" tier.

**Your existing business becomes Organization #1** (backfill `organizationId` on all current rows, then make it `NOT NULL`) — zero data loss, and you dogfood the multi-tenant path immediately.

### New models (additive)
- `Organization` (name, slug, `status: TRIALING|ACTIVE|PAST_DUE|LOCKED|CANCELED`, `stripeCustomerId`, `trialEndsAt`).
- `Plan` (platform pricing catalog: `key`, `stripePriceId`, `trialDays=30`, `featureFlags` JSON).
- `Subscription` (org ↔ plan, `stripeSubscriptionId`, `status`, `currentPeriodEnd`).

### Subscription + 30-day trial (Stripe Billing)
- Adopt the official `stripe` SDK (currently raw `fetch` — fine for one payment link, not for subscription lifecycle).
- **Card-not-required trial** for max conversion: signup creates `Organization{status:TRIALING, trialEndsAt:+30d}`, no Stripe customer yet; gate on `trialEndsAt`. At/just-before trial end, prompt for payment via Stripe **Checkout** (`mode:subscription`); use the **Customer Portal** for plan/card/cancel (no custom billing UI).
- **New billing webhook** (separate from the existing invoice webhook): handle `checkout.session.completed`, `customer.subscription.*`, `invoice.payment_failed/paid` → sync `Subscription`.
- **At trial-end/payment-failure:** set org `LOCKED` → a guard forces the workspace **read-only** (mutations return 402, GET + billing pages allowed) with an "add a payment method" banner. Hard-delete only after a long grace period.
- **Feature gating** by `Plan.featureFlags` — reuse the existing rich portal-visibility flags as plan entitlements (Starter hides Laundry/QA/Maintenance; Pro unlocks all). Most gating UI already exists.

### Public signup / onboarding
`Marketing → /pricing (SaaS tiers) → "Start free trial" → /signup → POST /api/saas/signup` which, in one transaction: creates the Organization + owner `ADMIN` + **seeds defaults for that org** (settings, rate card, checklists, form/QA/message/notification templates) → email-OTP verify → guided setup wizard (logo, service area, confirm rate card, invite team, optional Stripe/Xero) → land in their own `/admin`. Keep the existing `/register` for a tenant's own clients/cleaners but make it **invite/org-scoped** (today the public can self-select CLIENT/CLEANER into the global pool).

### Per-tenant singletons (must be scoped, not just rows)
`AppSetting` "app" row → composite key `(organizationId, key)`; pricing rate card (`PriceBook`), checklists, `FormTemplate`/`QaFormTemplate`, branding, scheduled-notification config, and **integration credentials** all become per-org (and secrets **encrypted at rest** via the unused `lib/security/encryption.ts`). Globally-unique constraints that will collide on the 2nd tenant must add org: `DiscountCampaign.code @unique`, `PriceBook @@unique([jobType,bedrooms,bathrooms])`, `jobNumber`/`invoiceNumber` sequences. Keep `User.email` globally unique (one human = one login) unless you want multi-org membership.

### The real work / risks
- **388 routes + raw SQL + background workers (cron, payroll, iCal sync) + webhooks** all need org scoping. Workers run **outside** a request (no session org) → must iterate orgs explicitly. The Prisma extension makes the request-path tractable; the **leak audit with a 2-org test matrix is the gating task**, not Stripe.
- **NextAuth `Account`/`Session` tables stay global** (don't over-scope).
- **`bootstrap admin` auto-creates an ADMIN on login** — must be pinned to the platform owner, never tenant orgs.

### Phased roadmap
- **Phase 1 (minimal sellable; high effort/risk):** org/plan/subscription models + `organizationId` everywhere + backfill; session carries org; Prisma auto-scoping extension; `/signup` provisioning; Stripe trial + Checkout + Portal + billing webhook; workspace-lock guard; **2-tenant leak audit**.
- **Phase 2 (hardening):** Postgres RLS backstop; encrypt + per-tenant secrets; plan-tier feature gating in UI + routes; subdomains/custom domains; dunning emails.
- **Phase 3 (growth):** self-serve upgrades, annual billing/coupons, multi-org membership, super-admin console, SSO for Enterprise, per-org data export/GDPR delete.

### ⚠️ The one decision I need from you
**Confirm the tenancy approach = single-DB row-level + Prisma auto-scoping extension + (later) Postgres RLS, with your business migrated in as Org #1.** Once you say go, I'll execute Phase 1 carefully with the leak-audit as the acceptance gate. (I recommend we also do it on a branch and against a clone of your DB backup first.)

---

## 7. What I changed tonight (review list)

Working-tree edits (uncommitted), all type-checked + production-built:
- `lib/reports/generator.ts` — section title fallback.
- `app/cleaner/jobs/[id]/page.tsx` — section title in header + sectionLabel fallbacks.
- `app/api/admin/quotes/route.ts` — server-side total/GST recompute.
- `lib/jobs/meta.ts` — `buildAdditionalsSection()` helper (namespaced ids).
- `app/api/jobs/[id]/form/route.ts` — use the shared helper for the live form.
- `app/api/cleaner/jobs/[id]/submit/route.ts` — snapshot the effective schema (incl. Additionals) so reports show extras.
- `docs/DEEP_DIVE_AND_SAAS_PLAN.md` — this document.

Nothing pushed. Tell me when you want it committed/pushed, and give me the go (and tenancy confirmation) on the SaaS Phase 1.

---

## 8. Progress log — SaaS Phase 1 (after you said "go")

All work is on a **local branch `saas-phase-1`**, committed but **NOT pushed**. Nothing touches your database.

### ✅ Phase 1a — additive data model (DONE, committed locally, tsc + build green)
- `prisma/schema.prisma`: new `Organization`, `Plan`, `Subscription` models + `OrgStatus` / `SubscriptionStatus` enums. **New tables only** — no existing table altered, no `organizationId` on existing models yet → safe to apply to the live single-tenant DB with zero data migration. (`User.ownedOrganizations` is a virtual relation field → no new column on `User`.)
- `lib/saas/plans.ts`: platform plan catalog — **Starter A$49 / Pro A$149 / Scale A$349** per month, all with a **30-day, card-not-required trial**, each with an entitlements map (module access + soft seat/property limits).
- `lib/saas/seed-plans.ts`: idempotent Plan-table sync.
- `prisma/migrations/20260617000000_saas_org_plan_subscription/migration.sql`: BOM-free, new-tables-only. **Apply with `prisma migrate deploy` after you review** — I did not run it against your DB.

### 🟡 Phase 1b — tenant-isolation ENGINE built (inert); column rollout + audit still gated
The **isolation engine is now built and committed** (all behind flags, INERT — not wired into `lib/db.ts`, so the app still runs exactly as single-tenant):
- `lib/saas/config.ts` — feature flags, all default OFF (`SNEEK_MULTITENANCY`, `SNEEK_SIGNUP`, `SNEEK_BILLING`).
- `lib/saas/tenant-context.ts` — `AsyncLocalStorage` org context: `runWithTenant()`, `runAsPlatformAdmin()` (bypass), `getCurrentOrganizationId()`.
- `lib/saas/tenant-models.ts` — **the registry**: all 108 models classified GLOBAL vs TENANT_OWNED. `tests/saas/tenant-models.test.ts` (passing) compares against Prisma's DMMF, so **adding a model without classifying it fails CI** — a forgotten model can't silently leak.
- `lib/saas/tenant-prisma.ts` — `registerTenantScoping()`: a Prisma `$use` middleware that forces `organizationId` on reads, stamps it on creates, and scopes update/delete/upsert. **Fail-closed** (`TENANT_STRICT`): a tenant-model query with no org context throws. Known gaps documented in-file (nested writes, raw SQL) — these are the leak-audit checklist.
- `lib/saas/workspace-guard.ts` — 402 workspace-lock guard + trial-expiry/`resolveEffectiveStatus`/`trialDaysRemaining`.
- `lib/saas/org.ts` — `provisionOrganization()` (creates org in 30-day trial + TRIALING subscription), slug generation.

**Still gated (needs you + a DB clone):** the `organizationId`-COLUMN rollout on all tenant models + backfilling your business as **Org #1**, wiring the middleware into `lib/db.ts` behind the flag, carrying org on the session, reworking workers/webhooks for explicit per-org iteration, then the **2-tenant leak audit** (the acceptance gate). Recommend doing it on this branch against a **clone of your DB backup**.

**Switch-on procedure (when we do 1b live together):**
1. Migration: add `organizationId` (nullable) to every model in `TENANT_OWNED_MODELS`; backfill all existing rows to Org #1; then set `NOT NULL` + FK + index.
2. Resolve org from session at the request edge → `runWithTenant(orgId, handler)`; workers wrap each org in `runWithTenant`; migrations/super-admin use `runAsPlatformAdmin`.
3. Call `registerTenantScoping(prisma)` in `lib/db.ts` and set `SNEEK_MULTITENANCY=1` in a **staging** env with 2 seeded orgs.
4. Run the leak audit (every list endpoint as tenant A must never return tenant B's rows; nested writes + raw SQL reviewed). Only then enable in prod + add the Postgres RLS backstop (Phase 2).

### ⏸ Phase 1c — Stripe Billing + public signup (depends on 1b)
Stripe SDK + Checkout (`mode: subscription`) + Customer Portal + a separate billing webhook; `trialEndsAt` logic; workspace-lock guard (402 on mutations when `LOCKED`); SaaS `/pricing` + `/signup` provisioning (org + owner ADMIN + seeded defaults). **Needs your Stripe keys/price IDs.**

### ⚠️ Open decision for 1c — the domain model
Your existing `app/(public)` site is the **tenant's own customer marketing site** (their service plans at `/subscriptions`). The SaaS "buy sNeek" landing is a *separate* surface. Decide:
- **Root domain** = SaaS marketing + `/signup` (e.g. `sneek.com`, `app.sneek.com`); **each tenant** gets their marketing site on a **subdomain** (`acme.sneek.com`) or custom domain.
This routing choice gates where `/pricing` and `/signup` live, so I held off building those pages to avoid entangling them with the tenant marketing site.
