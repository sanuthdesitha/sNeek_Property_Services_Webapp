# Verticals Roadmap — V1 through V14

This document captures all 14 vertical sub-projects at working detail. Each one is a separate spec → plan → build cycle of its own. Order reflects dependencies.

For each vertical: scope, key decisions, schema additions, primary surfaces, acceptance criteria, estimated complexity. Detailed task-level plans are written when the vertical comes up for execution.

---

## V1 — Advanced Form Builder + Per-Job-Type Form Library

**Scope:** Replace the single Airbnb-turnover-centric form template with a true form builder (drag-drop sections, conditional logic, versioning, duplicate/copy, signature + photo + scoring fields) AND seed a complete library of forms for every cleaning service type the business offers.

**Job types to seed forms for** (10 baseline types based on industry research — Jobber, ServiceM8, Housecall Pro, Turno conventions):

1. **Airbnb turnover** — existing default; refactor under the new schema
2. **End-of-lease / bond clean** — exhaustive room-by-room checklist; 80+ items in NSW/VIC bond clean standard
3. **Deep clean** — interior + appliance deep
4. **Regular maintenance clean** — recurring weekly/fortnightly; lighter checklist
5. **Post-construction / builder's clean** — dust removal, paint splatter, debris, window cleaning
6. **Window / glass clean** — interior + exterior windows, tracks, sills
7. **Carpet / steam clean** — pre-vacuum, treatment, extraction
8. **Commercial / office clean** — different cadence + signoff
9. **Move-in clean** — empty-property prep; subset of end-of-lease
10. **Oven / single-appliance clean** — specialty add-on

Each form template includes industry-standard sections: pre-clean walkthrough, room-by-room tasks, after-clean photos, supplies used, time tracking, client signoff. Specific items per job type derived from RACV bond-clean checklist, ServiceM8 industry templates, and the existing Airbnb v1 template as reference.

**Schema additions:**
- `FormTemplate.kind` enum: AIRBNB_TURNOVER, END_OF_LEASE, DEEP_CLEAN, REGULAR_MAINTENANCE, POST_CONSTRUCTION, WINDOW, CARPET, COMMERCIAL, MOVE_IN, OVEN, CUSTOM
- `FormTemplate.parentTemplateId` (for duplicate/copy lineage)
- `FormTemplate.publishedAt`, `archivedAt` for version state
- Form schema JSON shape extended: each field has `id, type, label, required, options?, conditional?, scoring?, attachments?`
- New `FormFieldType` values: text, longtext, number, select, multiselect, checkbox, radio, photo, video, signature, rating, time, date

**Primary surfaces:**
- `/admin/forms` — list templates by kind
- `/admin/forms/[id]/edit` — drag-drop builder UI
- `/admin/forms/[id]/preview` — runtime preview
- `/admin/forms/[id]/versions` — version history with restore
- Cleaner-side form runtime (existing — uses new schema)

**Builder features** (research source: Tally.so, Typeform, Formspree, Jotform):
- Drag-drop reorder via `@dnd-kit/core` (already installed)
- Section grouping with collapsible
- Field dependencies / conditional show-hide (e.g. "If property has dishwasher, show kitchen-appliance section")
- Per-field validation rules
- Required vs optional
- Scoring fields contribute to overall QA score
- Photo fields configurable: min count, must-have categories (e.g. before/after each room)
- Version + duplicate as new template (`Duplicate` button preserves all fields, creates draft)
- Bulk import from JSON

**Acceptance criteria:**
- Builder lets admin create a form with 10+ field types
- Conditional logic works at runtime (cleaner sees/hides fields based on prior answers)
- All 10 seed templates ship as published versions
- Versioning preserves history
- Existing Airbnb turnover form continues to work (migrated to new schema)

**Estimated complexity:** 3 weeks. Largest sub-project after the foundation phase.

---

## V2 — QA System End-to-End

**Scope:** Net-new role + portal + per-job-type QA forms + scoring rubric + signature + feedback flow into cleaner performance. Assignable to QA_INSPECTOR (default), OPS_MANAGER, ADMIN, or specific CLIENTs.

**User already has WIP QA on `feat/qa-system-wip` branch** — V2 starts by reviewing and refining that work, not starting from scratch.

**Schema (mostly already on WIP branch, refine):**
- `QaAssignment` model (status: OPEN/ASSIGNED/IN_PROGRESS/COMPLETED/CANCELLED)
- `QaFormTemplate` per job type per property override
- `QaFormSubmission` with scores, signature
- `MediaOverrideRequest` for cleaner appeals
- `QA_INSPECTOR` role enum value (already added)

**QA scoring rubric:**
- Per section: 0-5 stars
- Overall: weighted average
- Threshold pass: 80% (per project memory)
- Negative feedback (<60%) auto-triggers warning notification on next job for that cleaner

**Primary surfaces:**
- `/qa` portal — mobile-first, claimable queue, calendar, profile
- `/admin/qa` — assignment + template management
- Cleaner sees QA feedback on their dashboard within 24h of inspection

**Acceptance criteria:**
- QA inspector can claim, complete, sign QA report
- Score feeds into cleaner performance dashboard (V8)
- Templates per job type (driven by V1 form builder)
- Clients optionally invited to self-QA via tokenized link

**Estimated complexity:** 2-3 weeks. Has WIP foundation.

---

## V3 — Reports Engine v2

**Scope:** Multiple report themes admin switches per export. In-app template editor (logo, title, sections, colors). Bigger photo treatment. Client-friendly layout.

**Schema additions:**
- `ReportTheme` model (id, name, layout JSON, isDefault)
- `Report.themeId` foreign key

**Themes to seed** (3 baseline + user can clone):
- **Compact** — single page; small photos; for property managers
- **Magazine** — large photos; spreads; for premium clients
- **Detailed** — full task list + supplies + time + photos; for property audits

**Editor features:**
- Live preview alongside form
- Drag sections (header, summary, before/after gallery, task checklist, supplies, signature)
- Color theme picker (primary, accent)
- Logo upload
- Per-section visibility toggle

**Acceptance criteria:**
- Admin can switch theme on export (dropdown on report-generate dialog)
- All 3 seed themes render against real job data
- Theme editor saves and recalls

**Estimated complexity:** 2 weeks.

---

## V4 — Operations Cluster (Dashboard + Jobs + Ops + Schedule + Calendar)

**Scope:** Five pages redesigned together because they share data shapes (jobs, assignments, time logs, geofences). Strip generic copy. Denser views. Industry-standard ops dashboard patterns (think ServiceTitan, Jobber).

**Dashboard:** day-of-jobs strip + financial KPIs + alerts + cleaner availability map.
**Jobs:** Saved filter views (Today, This Week, Unassigned, At Risk). Bulk reassign. Inline status changes.
**Ops:** Live cleaner map (Plan F GPS feed) + dispatch board.
**Schedule:** Resource view (cleaner × hour grid) for next 14 days. Drag-drop reschedule.
**Calendar:** FullCalendar (already in deps) styled to new tokens. Multi-resource view.

**Acceptance criteria:** Each page passes a manual usability walkthrough — primary task achievable in ≤3 clicks.

**Estimated complexity:** 2-3 weeks.

---

## V5 — Cases / Approvals / Clock Adjustments Redesign

**Scope:** Brand-new state machine for cases (`OPEN → TRIAGE → ASSIGNED → IN_PROGRESS → AWAITING_CLIENT → RESOLVED → CLOSED`). Approvals + clock-adjustments redesigned with full request context visible.

**Schema additions:**
- `Case.state` enum expanded to include explicit lifecycle states
- `CaseTransition` model (id, caseId, fromState, toState, actorId, reason, occurredAt)
- `Case.slaBreachAt` for escalation timing

**Acceptance criteria:** Every case shows its full state history, who acted, why. Approvals/adjustments show requestor + job + property + before/after diff in one view.

**Estimated complexity:** 1-2 weeks.

---

## V6 — Laundry Compact View

**Scope:** Laundry portal pages condensed. Single-view "today + tomorrow" pickup/dropoff board. Inline confirm/flag actions. Lighter than current sprawling tabs.

**Estimated complexity:** 1 week.

---

## V7 — Inventory + Stock + Shopping Runs (Unified)

**Scope:** Single coherent flow replacing three disjointed pages. One model: "Stock state per property" → low-stock alert → shopping run → restock. Visual flow on one page; details in side drawer.

**Acceptance criteria:** Admin can see current stock + pending shopping runs + recent restocks per property in one place.

**Estimated complexity:** 2 weeks.

---

## V8 — Workforce + Cleaner Performance Page (New)

**Scope:** New `/admin/workforce/performance` page per cleaner showing:

**Standard metrics** (research source: Field Service Management benchmarks — Jobber, Housecall Pro, ServiceM8):
- **Quality score** — average QA score (V2 feeds this)
- **Reliability** — on-time arrival % (via Plan F GPS geofence)
- **Punctuality** — clock-in vs scheduled time delta
- **Attendance** — completed vs assigned jobs
- **Documentation** — % of jobs with all required photos + form completed
- **Customer satisfaction** — average rating from `ClientSatisfactionRating`
- **Response rate** — % of assignment offers accepted within 1h
- **Dispute rate** — disputes / total jobs
- **No-show rate** — explicit no-shows / scheduled
- **Document compliance** — % of staff docs current (insurance, certifications)
- **Training completion** — % of learning paths completed
- **Recognition** — peer/admin recognition received

Each metric: 30-day, 90-day, 12-month windows. Charts via recharts (already installed). Overall percentile rank vs team.

**Standard fields** for cleaner profile (industry-standard onboarding):
- Personal: name, DOB, address (with V Plan D autocomplete), phone, email, emergency contact
- Identity: photo, ID number, visa status (AU), TFN
- Employment: ABN, bank account, start date, employment type
- Compliance: police check expiry, insurance certificate, working with children check, vehicle rego
- Skills: languages, allergies, vehicle availability, certifications, training completion
- Performance: live metrics from above

**Acceptance criteria:** Performance page renders accurate metrics against real job data. Stale metrics flagged.

**Estimated complexity:** 2-3 weeks (mostly data aggregation; UI is recharts cards).

---

## V9 — Accounts Cluster (Profile Redesigns for All Roles + Clients + Properties)

**Scope:** Profile pages for every role (ADMIN, OPS_MANAGER, QA_INSPECTOR, CLEANER, CLIENT, LAUNDRY) redesigned to industry-standard layout. Per-account dashboards with stats. Clients page with summary cards. Properties page with map view + filters.

**Per-account stats** (industry research — CRM patterns):
- **For Clients:** total spend, average job rating, properties count, active subscriptions, last invoice paid, NPS score, communication preferences, churn risk
- **For Cleaners:** see V8 metrics
- **For Properties:** total jobs, last clean date, recurring frequency, lifetime value, photos history, inventory state

**Estimated complexity:** 2-3 weeks.

---

## V10 — Messages Hub (SMS + Email + Templates)

**Scope:** Two-way SMS + email inbox/outbox in-app. Template library for every business scenario with one-tap variable fill from recipient profile/job/property data.

**Templates to seed** (industry research — service business comm patterns):
- **New client chasing:** intro, quote follow-up, "still interested?" sequence (1d, 3d, 14d)
- **Marketing:** seasonal promo, referral request, loyalty milestone
- **Operational:** booking confirmation, en-route notice, job complete, feedback request
- **Service recovery:** apology + makegood, complaint acknowledgment, resolution offer
- **Feedback:** post-job rating request, NPS survey, Google review prompt
- **Complaints:** intake, investigation update, resolution
- **Onboarding:** welcome, first-job prep, "how to book again"
- **Cleaner-facing:** shift offer, schedule change, payroll-ready, recognition
- **Laundry-facing:** pickup confirmation, capacity check
- **Internal:** ops handover, urgent alert

**Variable fill examples:** `{{client.firstName}}`, `{{job.scheduledFor | sydney short}}`, `{{property.suburb}}`, `{{quote.totalAmount | currency}}`.

**Surface:** `/admin/messages` — channel selector, template picker, recipient picker, preview, send. Replies thread back to admin view.

**Estimated complexity:** 2-3 weeks.

---

## V11 — Quotes Redesign

**Scope:** Quote workflow upgraded. Multi-property quotes. Subscription-aware. PDF preview live. E-signature on accept.

**Estimated complexity:** 1-2 weeks (shares form-builder infra from V1).

---

## V12 — Finance Cluster (Invoices Auto-Gen + Finance + Payroll)

**Scope:**
- **Invoices** auto-generated per cleaner/client/laundry on each user's preferred cadence (per-profile setting: weekly, fortnightly, monthly, on-completion).
- **Finance** dashboard with revenue, COGS, margin, AR aging.
- **Payroll** flow with batch approve, MYOB/Xero export.

**Schema additions:**
- `User.invoicingCadence` enum: WEEKLY, FORTNIGHTLY, MONTHLY, ON_COMPLETION, CUSTOM
- `User.invoiceDay` for which-day-of-week or which-date-of-month
- `User.preferredPayoutMethod` enum: BANK_TRANSFER, STRIPE_CONNECT, PAYPAL
- Background job: cron daily, generates invoices for all users whose cadence triggers today

**Acceptance criteria:** Invoice auto-generation runs daily, generates correct invoices, emails them via Plan F email infra. Late-payment reminders auto-fire.

**Estimated complexity:** 2-3 weeks.

---

## V13 — Marketing Engine

**Scope:** Email + SMS marketing campaigns (built on V10 infra). Social channel publishing (Facebook, Instagram, YouTube) via their Graph APIs. AI-generated post composer that pulls from an OBS-recorded asset library.

**Channel integrations:**
- **Facebook + Instagram:** Meta Graph API. Long-lived page token + Instagram business account.
- **YouTube:** Data API v3 for video metadata; Shorts via separate flow.
- **TikTok:** TikTok for Developers / Marketing API (optional)

**AI composer:**
- Pulls from `/marketing/assets` (uploaded OBS recordings + branded images)
- Uses Claude API (already if needed) to generate captions tailored to channel
- Suggests posting time based on audience timezone analytics
- Schedule via pg-boss

**Estimated complexity:** 3 weeks. Heaviest external-integration vertical.

---

## V14 — Settings Reorganization

**Scope:** Settings page reorganized with categorization + grouping. Search bar. Every variable surfaced.

**Categories:**
- **Branding** — logo, colors, public site copy
- **Operations** — geofence radius, SLA thresholds, recurring job rules
- **Communications** — email defaults, SMS sender, notification preferences
- **Finance** — tax rates, payment terms, late fee policy, payroll defaults
- **Integrations** — Stripe, Xero, Resend, Google Maps, Hospitable
- **Roles & Permissions** — fine-grained RBAC overrides
- **Display** — themes, density (already shipped Plan C)
- **System** — feature flags, debug mode, data retention

**Acceptance criteria:** Every previously-hidden config knob is exposed in a categorized panel. Search jumps to the right group.

**Estimated complexity:** 1-2 weeks.

---

## Execution order

Strict dependency order:
1. **V1** — unblocks V2, V3
2. **V2** — needs V1's form builder
3. **V3** — needs V1's form data shapes
4. **V4** — depends only on foundation; parallel-safe
5. **V5** — depends only on foundation
6. **V6** — depends only on foundation
7. **V7** — depends only on foundation
8. **V8** — needs V2's QA data
9. **V9** — needs V8 metrics
10. **V10** — depends on Plan F email infra (shipped)
11. **V11** — needs V1's form builder
12. **V12** — depends on V8 (cleaner profile invoicing cadence)
13. **V13** — depends on V10
14. **V14** — does last (exposes every prior phase's knobs)

In a single-engineer flow: V1 → V2 → V3 → V4 → V5 → V6 → V7 → V8 → V9 → V10 → V11 → V12 → V13 → V14. ~32-40 weeks linear; faster with parallel work after foundation.
