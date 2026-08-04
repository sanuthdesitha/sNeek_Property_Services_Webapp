# sNeek Platform — Commercialisation Plan

_Drafted 2026-08-04. Owner: Sanuth. Status: awaiting owner approval to begin Phase 0._

The goal: turn the platform sNeek runs its own cleaning operation on into a sellable
product, without breaking the operation that funds it. Six phases, each with a clear
exit condition, ordered so that revenue-critical work is never blocked behind
nice-to-haves. Phases 0–1 are prerequisites; everything after is sequenced by
revenue-per-effort.

**The one-sentence pitch this plan builds toward:** the only end-to-end operating
system for turnover cleaning companies — dispatch, GPS-verified time, checklist-driven
QA with a stamped photo evidence chain, laundry logistics, cleaner pay, client
invoicing and hiring — priced between Turno ($8/property, scheduling only) and
Breezeway ($20/unit, property-manager-side only), replacing four tools and a
spreadsheet.

---

## Codebase split (decided 2026-08-05)

Two working copies, both on v2/Estate, sharing full git history:

| | Business | Product |
|---|---|---|
| Path | `E:\sNeek Property Service\Website` (this tree) | `E:\sNeek Property Service\Platform` |
| Serves | sNeek's own cleaning operation, `www.sneekholdings.com` | the multi-tenant SaaS, separate brand + domain |
| Remote | GitHub `sNeek_Property_Services_Webapp` | its own repo (to be created) |

The product tree was created by `git clone` (not a file copy) so it carries full
history and **no `.env`** — the business's production secrets never entered it. Its
`origin` was removed and an `upstream` remote points here **fetch-only**, so product
code cannot be pushed into the business repo by accident.

Sync is deliberately one-way: bug fixes and shared-engine improvements (QA, forms,
uploads, finance) are cherry-picked business → product; business content (sNeek
marketing pages, rate card, branding) and product-only work (onboarding wizard,
tenant module flags, PMS adapters, billing UI) never cross. Drift is the cost of a
fork — cherry-pick upstream at least fortnightly, and fix shared bugs in the
business tree first so both benefit. Details in `Platform/PRODUCT.md`.

**Consequence for the phases below:** Phase 0.1 is done in both trees. Everything
from Phase 0.2 onward is product work and belongs in `Platform` — the business tree
only receives shared fixes and keeps running sNeek.

---

## Phase 0 — Foundation hardening (2–3 weeks)

Make the platform presentable and safe to put strangers on. No revenue yet; this is
the difference between a demo and a product.

### 0.1 v2 cutover (task #186, already pending)
- Make `/v2` the default per-role experience; v1 reachable only via `?look=v1`.
- Sweep for any flow that still bounces users into v1 (grep `href="/cleaner`,
  `/admin`, `/client` links in v2 components).
- Exit: no cleaner, client, laundry or QA user ever sees v1 without asking for it.

### 0.2 Self-serve onboarding
Today the app assumes sNeek's data exists. A new tenant sees empty screens.
- **First-run wizard** (new `app/v2/onboarding/`): company profile → branding upload
  (logo, colours feed the existing branding settings) → first property (reuse the
  onboarding wizard from task #172) → first cleaner invite → first job. Five steps,
  each skippable.
- **Seed content per tenant**: default checklist library (already built, task #168),
  default QA taxonomy (B5), default email/report templates, default rate card.
  One `lib/tenancy/seed-tenant.ts` function invoked at org creation.
- **Empty states**: every hub page gets a "what this is + first action" card when it
  has no data. Audit pass over the ~15 admin hubs.
- **Feature flags per tenant**: laundry, QA, hiring, marketing OFF by default —
  progressive disclosure. `Org.enabledModules Json` (additive migration) checked in
  the sidebar/nav builders. The platform's breadth is a liability on day one.
- Exit: a fresh account reaches "first job dispatched to a cleaner's phone" in under
  15 minutes with no human help.

### 0.3 Trust & polish debt
- Apex domain fix: `sneekholdings.com` → `www` redirect at the proxy (currently a
  dead 404 for every non-www visitor).
- Support surface: `/help` with 10 core how-to articles (write from the SYSTEM.md
  sections), an in-app "Contact support" that emails the super-admin inbox.
- Status/uptime page (static, honest).
- Legal: ToS + privacy policy pages (templates exist in the CMS).
- Exit: nothing embarrassing for a paying stranger.

---

## Phase 1 — Multi-tenant activation (2–4 weeks; tasks #96–97, mostly built)

The revenue gate. Everything is coded (org data model #93, org-scoping retrofit #94,
Stripe billing + trial + signup #95, super-admin console #98) but never switched on.

### 1.1 Staging rehearsal (SUPERVISED — needs owner)
- Clone production DB to a staging instance; run the org-backfill migration that
  assigns all existing rows to the sNeek org.
- Flag the tenancy scoping ON in staging; run the leak-audit checklist from #94
  again against two seeded orgs (every list endpoint, every report, every export —
  the audit matrix already exists).
- Exit: zero cross-org reads on staging with scoping enforced.

### 1.2 Stripe go-live (needs owner: live Stripe keys)
- Live products/prices created for the three tiers (see Phase 4 pricing).
- 30-day trial flow end-to-end: public signup → org created → seeded → trial banner
  → card capture → subscription. Webhooks (invoice.paid, subscription.deleted)
  verified against the built handlers.
- Dunning: failed-payment emails + grace period + read-only lock state.
- Exit: a test card signs up, trials, converts, cancels — all without touching the DB.

### 1.3 Production cutover
- Off-peak window: backfill migration on production, flag ON, sNeek becomes tenant #1.
- Super-admin console (#98) is the operating seat: tenant list, usage, impersonation
  (read-only mode already enforced in middleware), support notes.
- Rollback: the flag is designed to turn back off; rehearse that on staging too.
- Exit: sNeek operates normally as an org; a second real org can be created.

---

## Phase 2 — Pilot program (6–8 weeks, overlaps Phase 3)

Prove someone else's cleaning company can run on it. Feedback here is worth more
than any feature.

- **Recruit 3–5 pilot companies** (free for 3 months, then founder pricing for
  life). Sources: Sydney/Melbourne Airbnb host Facebook groups, cleaning-business
  subreddits/forums, direct outreach to turnover cleaning companies found via
  Airbnb listing cleaners. Ideal profile: 3–15 cleaners, 20–80 STR properties,
  currently on Turno + spreadsheets.
- **White-glove onboard the first two** (screen-share, import their properties via
  the bulk assistant #173) and watch where they stall — that is the Phase 0.2
  backlog, round two.
- **Weekly instrumentation review**: activation funnel (signup → first property →
  first job → first completed form → first invoice), weekly-active cleaners per
  tenant, QA adoption. Add a simple `lib/telemetry/product-events.ts` writing to a
  `ProductEvent` table surfaced in super-admin.
- **In-app feedback widget** for pilots (one text box, writes to super-admin).
- Exit: 2+ pilots run payroll-affecting operations (real jobs, real cleaner pay)
  for 4 consecutive weeks without founder intervention.

---

## Phase 3 — PMS integrations (4–6 weeks, parallel with Phase 2)

The #1 adoption blocker for STR customers and the #1 thing Turno/Breezeway sell on.
iCal sync already exists; named integrations are the credibility unlock.

- **Priority order:** Hostaway (largest AU footprint, good public API) → Guesty →
  Hospitable. One `lib/integrations/pms/` adapter interface: `listListings()`,
  `listReservations(since)`, webhook receiver for reservation created/changed/
  cancelled → the existing job-creation pipeline that iCal sync feeds today.
- Auto-create/cancel turnover jobs from reservation checkouts, honouring the
  per-property timing rules and once-off/duration data that already exist.
- Listing photos import → property reference images (feeds checklist reset-to-
  reference items).
- Apply to each PMS's marketplace/partner directory the day the adapter ships —
  their app stores are a free distribution channel.
- Exit: a pilot connects Hostaway and jobs appear/cancel themselves for a week
  with zero manual scheduling.

---

## Phase 4 — Paid launch (2–3 weeks after 2 pilots convert)

### 4.1 Pricing (v1 — revisit after 10 customers)
| Tier | Price (AUD/mo) | Included |
|---|---|---|
| Starter | $49 | 15 active properties, 5 staff, dispatch + forms + client reports |
| Pro | $149 | 60 properties, 15 staff, + QA engine, laundry, payroll, Xero, PMS sync |
| Scale | $299 | 150 properties, unlimited staff, + white-label client portal, API access, priority support |
| — | +$1.50/property | overage on any tier |

Rationale: Starter undercuts Jobber Core while being cleaning-specific; Pro is where
the QA + laundry moat lives and should be the default; Scale monetises the branding/
CMS/template machinery that already exists. Annual = 2 months free.

### 4.2 Launch mechanics
- Marketing site: **DECIDED (owner, 2026-08-05): the product is a separate brand
  on a separate domain.** sneekholdings.com and its CMS pages stay exclusively the
  sNeek cleaning business. The SaaS gets its own neutral name + domain with its own
  marketing site; the app itself can be served on the product domain while sNeek's
  operating tenant keeps its own entry point. Product-name shortlist is an open
  owner task.
- Comparison landing pages: "vs Turno", "vs Jobber", "vs spreadsheets" (SEO;
  competitors' names are the highest-intent queries in this market).
- Case study from the best pilot, with real numbers (hours saved, rework rate drop).
- Listings: Capterra/GetApp/G2 profiles (free), PMS marketplaces from Phase 3.
- Exit: first stranger pays without ever speaking to us.

---

## Phase 5 — Moat features (ongoing after launch, in this order)

### 5.1 AI QA pre-scoring (the headline differentiator; 3–4 weeks)
- Every submission already yields per-item photos tied to known checklist items —
  ideal vision-model input. Pipeline: on form submit, a worker sends each item's
  photos + item text to a vision model → per-item `aiVerdict` (looks-done /
  uncertain / likely-fail + one-line reason) stored alongside the submission.
- Surfaces: QA queue sorts by AI risk; inspector sees AI flags pre-filled (never
  auto-fail — human confirms); admin dashboard gets "AI-screened, no inspection
  needed" tier for low-risk properties.
- Sell as a Pro/Scale add-on (+$49/mo) — inference costs are covered and it is the
  feature no competitor ships.
- Exit metric: AI agreement with human inspector verdicts >80% on the sNeek org's
  historical data before enabling for tenants.

### 5.2 Payments margin (1–2 weeks)
- Stripe Connect on client invoices: card + AU direct debit (BECS). Platform fee
  0.8% on top of processing. Invoices already exist end-to-end; this is a "Pay now"
  button and a Connect onboarding flow for tenants.

### 5.3 Guest trust page (1 week)
- Public tokenised page per completed job: "Professionally cleaned [time], scored
  [score], [n] verification photos" (cleaner-safe subset only — reuse the
  cleanerSafe view-model discipline from B3). Hosts link it in listings/guest
  messages → free distribution with "Powered by" branding.

### 5.4 Native app wrappers (2 weeks)
- Capacitor shells around the existing PWA for App Store / Play Store presence.
  Push notifications already work (web push); wrap, don't rebuild.

---

## Phase 6 — Expansion bets (only after $10k+ MRR; pick by pull, not push)

- **White-label / franchise licensing** ($500–1,500/mo per brand): the Estate skin,
  CMS and template builder already support it; add per-org theming + custom domain.
- **Laundry logistics as a standalone vertical**: routes, sets, drivers, key-lost
  mode already built; commercial laundries serving STR markets run on paper. Spin
  as a second product with its own landing page before writing any new code.
- **QA-only product**: "proof-of-clean" inspections per-unit for property managers
  and franchises already on Jobber — a wedge, priced per inspection.
- **Cross-tenant marketplace** (Turno's model, but with quality scores they don't
  have): unassigned jobs flow to vetted cleaners across tenants, booking fee per
  job. Biggest prize, biggest lift — needs tenant density first.

---

## Risks & mitigations

1. **Operating company vs product conflict.** Selling to Sydney competitors under
   the sNeek name invites friction — decide the product-brand question in Phase 4
   at the latest.
2. **Tenancy leak = fatal.** One cross-org data leak ends the SaaS. The #94 audit
   matrix runs again at every phase boundary; add an automated cross-org smoke test
   to CI before Phase 1.3.
3. **Breadth overwhelms.** Mitigated by per-tenant module flags (0.2) — a new
   tenant sees a scheduling tool, discovers an operating system.
4. **Founder bandwidth.** Phases 2 and 3 overlap deliberately but nothing else
   does; each phase has a single exit condition so "done" is unambiguous.
5. **Support load.** Pilot cap at 5; no paid launch until two pilots run unassisted
   for a month.

## Success metrics per phase

| Phase | Exit metric |
|---|---|
| 0 | Fresh account → first dispatched job in <15 min, unassisted |
| 1 | Test card completes signup→trial→convert→cancel; zero cross-org reads |
| 2 | 2 pilots run real payroll 4 weeks unassisted |
| 3 | 1 pilot fully auto-scheduled from Hostaway for a week |
| 4 | First self-serve paying customer |
| 5 | AI agreement >80%; first payments-margin dollar |
| 6 | Chosen by customer pull, not roadmap |
