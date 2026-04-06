# sNeek Platform — Complete Master Implementation Plan

## What Already Exists (Do Not Re-implement)
- Email: Resend + nodemailer fallback ✓
- SMS: Twilio + Cellcast ✓
- Push: Expo push via UserPushDevice ✓
- Stripe: REST API integration for quote payment links ✓
- FullCalendar in admin and client calendars ✓
- Xero: config exists, API not implemented
- GPS: not in Job model, only in Reservation
- Recurring jobs: settings exist, no data model
- Loyalty/Referral: not implemented
- Blog: not implemented
- Self-serve booking: not implemented (quote request only)
- Admin calendar: read-only (no drag-and-drop)
- Service worker: manifest.json only, no SW

---

## PHASE 1 — Critical Bug Fixes (Do First, Zero Risk)

### 1.1 Service detail page layout
**File:** `components/public/service-detail-page.tsx` line 1
Add `"use client";` as first line. Uses Radix Accordion which requires client state.

### 1.2 Scroll button / WhatsApp FAB overlap
**File:** `components/public/public-site-shell.tsx`
- WhatsApp FAB: `fixed bottom-6 right-5 z-50 sm:bottom-6 sm:right-6`
- Scroll-to-top: change to `fixed bottom-[4.5rem] right-5 z-50 sm:bottom-[4.5rem] sm:right-6`

### 1.3 Login page duplicate link
**File:** `app/(auth)/login/page.tsx` lines 118–120
Remove `<Link href="/register">Create account</Link>` from the top pill. Keep "Register here" at bottom.

### 1.4 Tomorrow job summary email shows 0 jobs
**File:** `lib/ops/tomorrow-prep.ts`
The UTC boundary calculation misses Sydney-timezone jobs in the early hours.
Replace the startUtc/endUtc calculation with `date-fns-tz` toZonedTime/fromZonedTime anchored to `Australia/Sydney`. Get "tomorrow" in Sydney local time, then convert start-of-day and end-of-day back to UTC for the DB query.

### 1.5 npm run start shows stale changes
Not a code bug. Document: `npm run build && npm run start` is required every time. `npm run dev` is for development.

---

## PHASE 2 — Public Website Enhancements

### 2.1 Services nav dropdown — all 15 services
**File:** `components/public/public-site-shell.tsx`
Add `expandedFamilies: Set<ServiceFamily>` state. Each family header in the dropdown is a toggle button that expands/collapses its service list. Default: all collapsed. Each service item links to `/services/{slug}`. Dropdown gets `max-h-[70vh] overflow-y-auto`. "View all services →" at bottom always visible.

### 2.2 Announcement/promo bar — CMS driven
**Files:** `lib/public-site/content.ts`, `components/public/public-site-shell.tsx`, `components/admin/website-editor.tsx`
Add `announcementBar: { enabled, promoMessage, promoLink, promoLinkLabel, bgStyle, showPhone, showLocation, showHours, showEmail }` to WebsiteContent. Shell renders a two-row bar: promo strip (if set) + contact info row. Admin Layout tab gets new SectionCard for all these fields. Sanitize in `sanitizeWebsiteContent`.
bgStyle options: subtle (default, bg-primary/6) | accent (amber) | dark (bg-[#0c2329]) | warning (red).

### 2.3 Instant price estimator widget on homepage
**File:** `components/public/home-page.tsx`
Add a new section between hero and services grid: a 3-field card (service type select, bedrooms select, bathrooms select) that calls `POST /api/public/quote` on change and shows a live "From $X" price range. No form submission, purely informational. Use debounce 300ms.

### 2.4 Before/after gallery
**Files:** `lib/public-site/content.ts` (gallery already exists), `components/public/home-page.tsx`
Enhance the existing gallery section to support `beforeImageUrl` + `afterImageUrl` per item. A hover or click toggles between before/after. Admin gallery tab in website editor gains before/after image fields.

### 2.5 Postcode/suburb availability checker
**File:** `components/public/home-page.tsx`
Below the hero CTA buttons: a single input "Enter your suburb" with a "Check availability" button. On submit: calls `GET /api/public/availability?suburb=X`. API checks if any active `Property` or `Job` has that suburb in the DB — returns `{ available: true, nextSlot: "Monday 9am" }` or `{ available: true, message: "We cover your area" }`. Always positive response (don't say "we don't cover this area" for business reasons).

### 2.6 Google Reviews display
**File:** `components/public/home-page.tsx` (replace/enhance testimonials section)
Fetch from Google Places API (`GET https://maps.googleapis.com/maps/api/place/details/json?place_id=...&fields=reviews,rating`). Cache result in AppSetting key `google_reviews_cache` with 24h TTL (worker refreshes it). Display: overall star rating badge + up to 6 review cards. Fallback: the current static testimonials if no API key configured.
New env var: `GOOGLE_PLACES_API_KEY`, new settings field: `integrations.googlePlaces.placeId`.

### 2.7 Blog / Tips section
**New files:** `app/(public)/blog/page.tsx`, `app/(public)/blog/[slug]/page.tsx`, `components/public/blog-page.tsx`
**New Prisma model:**
```prisma
model BlogPost {
  id          String   @id @default(cuid())
  slug        String   @unique
  title       String
  excerpt     String
  body        String   @db.Text  // markdown
  coverImageUrl String?
  tags        String[]
  isPublished Boolean  @default(false)
  publishedAt DateTime?
  authorName  String   @default("sNeek Team")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```
Admin page: `app/admin/website/blog/page.tsx` — list + create/edit/delete posts. Body is a markdown textarea with preview. Public page: renders markdown via `react-markdown`. Add `/blog` to public route whitelist in middleware. Footer Quick Links gets "Blog" link. Blog landing shows cards with cover image, excerpt, tags. Each post page is full-width article layout.

### 2.8 Suburb landing pages for SEO
**New files:** `app/(public)/cleaning/[suburb]/page.tsx`
Dynamic route that renders a localised landing page. Suburb data comes from a static list of 20 key Sydney suburbs hardcoded in `lib/public-site/suburbs.ts`. Each page shows: "Cleaning services in {Suburb}", service cards, trust strip, local stats ("X cleans completed in {Suburb}"), CTA. Add `/cleaning/` to middleware whitelist. These are purely static SEO pages with no DB query.

### 2.9 Service comparison page
**New files:** `app/(public)/compare/page.tsx`, `components/public/compare-page.tsx`
Side-by-side comparison table of General Clean vs Deep Clean vs End of Tenancy vs Airbnb Turnover. Rows: what's included, not included, price guide, typical duration, ideal for. Data comes from `servicePages` content. Link "Compare services →" from the services page.

### 2.10 Careers / Work With Us page (already planned)
**Files:** `app/(public)/careers/page.tsx`, `components/public/careers-page.tsx`
Server component fetches published `HiringPosition` records. Cards show title, department, location, employment type, description. "Apply →" links to existing `/apply/{slug}`. Add to middleware, footer.

### 2.11 Live availability slot in hero
**File:** `components/public/home-page.tsx`
Small pill below the CTA buttons: "Next available: {day} {time}" — driven by a new `GET /api/public/next-slot` endpoint that queries the admin calendar for the nearest unfilled slot window.

---

## PHASE 3 — Admin Portal Enhancements

### 3.1 Drag-and-drop scheduling in admin calendar
**File:** `app/admin/calendar/_calendar.tsx`
Enable FullCalendar's `editable={true}` and `droppable={true}`. On `eventDrop`: call `PATCH /api/admin/jobs/[id]` to update `scheduledDate` + `startTime`. On `eventReceive` (from external drop area): assign a job. Show confirmation toast. Undo button (local state rollback) appears for 5 seconds after a drop.

### 3.2 Route optimisation map for cleaners
**New file:** `app/admin/jobs/route-map/page.tsx`
Date picker at top. For each cleaner assigned that day, shows their jobs on a Google Maps embed ordered by time. Jobs are listed in a sidebar with estimated drive time between each (using Google Distance Matrix API — or just Google Maps URLs if API not set up). "Copy route" button generates a Google Maps multi-stop URL for the cleaner. New env var: `GOOGLE_MAPS_API_KEY`.

### 3.3 Enhanced admin jobs filters (already planned in previous plan)
**File:** `app/admin/jobs/page.tsx`
Filters: search (property/client/job number), cleaner name, job type, date range, invoice status. URL-persisted. Collapsible filter panel. Active filter count badge.

### 3.4 Admin jobs damage indicator
**File:** `app/admin/jobs/page.tsx`
If job has linked IssueTicket with caseType=DAMAGE and status!=RESOLVED, show red ⚠ badge on job row. Click → opens `/admin/cases?jobId={id}`.

### 3.5 Batch operations on jobs
**File:** `app/admin/jobs/page.tsx`
Checkbox per job row. "Select all" checkbox in header. When any selected: floating action bar appears at bottom with: "Bulk assign cleaner", "Bulk change status", "Bulk add note". Bulk assign: select cleaner from dropdown → POST to `/api/admin/jobs/bulk-assign`. Bulk status: select target status → POST to `/api/admin/jobs/bulk-status`.

### 3.6 Revenue dashboard / Business intelligence
**New file:** `app/admin/finance/dashboard/page.tsx` (or enhance existing finance page)
Charts using `recharts` (install as dependency):
- Revenue by month (bar chart) — sum of `ClientInvoice.totalAmount` where status=PAID grouped by month
- Revenue by service type (pie/donut) — from `Job.jobType` + invoice lines
- Revenue by cleaner (bar) — from `JobAssignment` + invoice totals
- Jobs completed per week (line chart)
- Average QA score trend (line chart)
- Lead conversion rate (leads → clients)
Key metric cards: MTD revenue, YTD revenue, avg job value, active clients, churn risk clients.

### 3.7 Cleaner pay calculator + payslip
**New file:** `app/admin/finance/payroll/page.tsx`
Date range selector. For each cleaner: list all jobs in range with hours logged + pay rate + adjustments. Auto-calculate gross pay. "Download payslip" → generates HTML payslip PDF via Playwright. Pay rate configured per-cleaner in their profile (new field: `User.hourlyRate Float?`).

### 3.8 Client lifetime value + churn risk
**File:** `app/admin/clients/page.tsx` (enhance existing)
New columns in client list: "Total spent" (sum of paid invoices), "Last booking" (most recent job date), "Booking frequency" (avg days between jobs). Churn risk badge: clients with no job in 60+ days AND previously had regular bookings. "Re-engage" button → sends a promo email (configurable template) via Resend.

### 3.9 Lead counter offer + client detail (already planned)
From previous plan — fully detailed there.

### 3.10 Form submission editing (already planned)
From previous plan — fully detailed there.

### 3.11 Laundry photo editing (already planned)
From previous plan — fully detailed there.

### 3.12 Admin jobs enhanced filters (already planned)
From previous plan — fully detailed there.

### 3.13 Email campaign builder
**New file:** `app/admin/marketing/campaigns/page.tsx` (marketing section already exists in nav)
Campaign model already exists in schema (`DiscountCampaign`). Extend with:
```prisma
// New model
model EmailCampaign {
  id           String   @id @default(cuid())
  name         String
  subject      String
  htmlBody     String   @db.Text
  audience     Json     // { type: "all_clients" | "segment", filters: {...} }
  status       String   @default("draft") // draft | scheduled | sent
  scheduledAt  DateTime?
  sentAt       DateTime?
  recipientCount Int?
  createdById  String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}
```
UI: WYSIWYG-lite email editor (textarea with basic markdown preview). Audience builder: all clients | clients with no booking in X days | clients by service type. Send now or schedule. Preview before send. Sends via existing Resend integration.

### 3.14 Automated follow-up sequences
**File:** `workers/boss.ts` + new `lib/ops/follow-up-sequences.ts`
On job status → COMPLETED: schedule 3 pg-boss delayed jobs:
- +1 day: "Thank you for your booking" email (configurable template in admin settings)
- +3 days: "How was your clean?" review request with star rating link → creates `ClientSatisfactionRating` record
- +14 days: "Ready for your next clean?" re-booking prompt with quote link

New model:
```prisma
model ClientSatisfactionRating {
  id        String   @id @default(cuid())
  jobId     String   @unique
  clientId  String
  score     Int      // 1-5
  comment   String?
  createdAt DateTime @default(now())
}
```
Public API: `POST /api/public/rating` accepts jobId + token (HMAC of jobId+clientId) + score + comment. Token prevents spoofing.

### 3.15 QA trend charts + compliance dashboard
**File:** `app/admin/workforce/page.tsx` (or new page `app/admin/reports/quality/page.tsx`)
Per-cleaner QA score chart (last 30 jobs). Trending down indicator. Overall team QA average. Compliance grid showing for each cleaner: police check expiry, insurance on file, mandatory training completed, document status — all from `StaffDocument` model.

### 3.16 Xero integration completion
**File:** `lib/phase3/integrations.ts` + new `lib/integrations/xero.ts`
Implement the Xero OAuth2 flow (already have tenant config). On invoice SENT: sync to Xero as an invoice. Use Xero API: `POST https://api.xero.com/api.xro/2.0/Invoices`. Map `ClientInvoice` fields to Xero format. Store `xeroInvoiceId` on the model (add field to schema). Admin settings → Integrations tab gets Xero connect/disconnect button.

### 3.17 Property access vault (secure storage)
**New fields on Property model:**
```prisma
// Add to Property model
accessCode     String?  @db.Text  // encrypted
alarmCode      String?  @db.Text  // encrypted
keyLocation    String?  @db.Text
accessNotes    String?  @db.Text
```
Encrypted at rest using AES-256 with `ENCRYPTION_KEY` env var. Only decrypted when shown to assigned cleaners in their job view. Admin can edit in property settings. Cleaner sees it in their job briefing as a one-time expandable card.

---

## PHASE 4 — Client Portal Enhancements

### 4.1 Self-serve booking (direct job creation)
**New file:** `app/client/booking/page.tsx`
Only shown if `clientPortalVisibility.showBooking: true` (new setting).
3-step form:
1. Select property (from their properties) + service type
2. Select date from a calendar showing available slots (fetches from `GET /api/client/available-slots?propertyId=X&serviceType=Y`)
3. Confirm details + special instructions

On submit: creates `QuoteLead` with status=CONVERTED + auto-generates a `Job` in UNASSIGNED status. Admin gets notification. Client sees confirmation.

Available slots API: returns dates in the next 30 days that don't have full capacity (admin can configure daily slot limit in settings).

### 4.2 Client jobs page — calendar, ordering, filters (already planned)
From previous plan — full detail there.

### 4.3 Reschedule + cancellation requests
**File:** `app/client/jobs/page.tsx`
"Change date" button on each upcoming job card → opens a date picker modal → creates a `JobTask` of type "RESCHEDULE_REQUEST" with new date in notes → admin sees it in their task queue.
"Cancel" button → opens reason selector → creates a `JobTask` of type "CANCEL_REQUEST" → admin reviews.

### 4.4 Client satisfaction ratings (star rating after job)
When a job moves to COMPLETED, the follow-up email (3.14) contains a link to `GET /client/rate/{jobId}?token=X`. This renders a simple 1-5 star page. On submit: POST to `/api/public/rating`. The rating shows on the job card in client portal ("You rated this 4★").

### 4.5 Client dashboard — preferred cleaner
**File:** `app/client/settings/page.tsx` or `app/client/properties/[id]/page.tsx`
New `Property.preferredCleanerUserId String?` field. Client can select from cleaners who have previously worked on that property. When admin creates a new job for that property, auto-assign the preferred cleaner if available.

### 4.6 Client dashboard — invoice payment via Stripe
**File:** `app/client/finance/page.tsx`
"Pay now" button on SENT/OVERDUE invoices → calls `POST /api/client/invoices/[id]/payment-link` → creates a Stripe checkout session → redirects to Stripe. On success, Stripe webhook (`POST /api/webhooks/stripe`) updates invoice status to PAID.
New webhook route: `app/api/webhooks/stripe/route.ts`. Verifies Stripe signature. Updates `ClientInvoice.status = PAID`, `paidAt = now()`. Add `paidAt DateTime?` to `ClientInvoice` model.

### 4.7 Loyalty points system
**New Prisma models:**
```prisma
model LoyaltyAccount {
  id        String   @id @default(cuid())
  clientId  String   @unique
  points    Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  client    Client   @relation(...)
  transactions LoyaltyTransaction[]
}

model LoyaltyTransaction {
  id          String   @id @default(cuid())
  accountId   String
  points      Int      // positive = earn, negative = redeem
  reason      String   // e.g. "Job completed", "Referral bonus", "Redemption"
  referenceId String?  // jobId or referralId
  createdAt   DateTime @default(now())
  account     LoyaltyAccount @relation(...)
}
```
Points earned: 10 points per $1 spent (configurable in settings). Redemption: 1000 points = $10 discount on next booking. Displayed in client dashboard as a points balance widget. Admin can manually adjust points in client detail page.

### 4.8 Referral program
**New Prisma model:**
```prisma
model Referral {
  id            String   @id @default(cuid())
  referrerId    String   // Client who referred
  refereeEmail  String
  refereeClientId String? // set when referee converts
  code          String   @unique // e.g. "JOHN-AB12"
  status        String   @default("pending") // pending | converted | expired
  referrerRewardPoints Int @default(0)
  refereeDiscountPercent Int @default(10)
  convertedAt   DateTime?
  expiresAt     DateTime?
  createdAt     DateTime @default(now())
  referrer      Client   @relation(...)
}
```
Client portal "Refer a friend" page: shows their unique referral code + share link. On a new client registering with a referral code: discount applied to first job, referrer gets loyalty points. Admin can see all referrals in client detail page.

### 4.9 Property condition timeline
**File:** `app/client/properties/[id]/page.tsx`
New "History" tab on property detail. Shows all `SubmissionMedia` records linked to jobs on this property, ordered by job date descending. Each entry: job date, service type, thumbnail grid. Clicking a thumbnail opens full-size. This gives the client visual proof of every clean.

### 4.10 Direct message to admin
**New files:** `app/client/messages/page.tsx`, `app/api/client/messages/route.ts`
Simple threaded messaging (not real-time, polling every 10s). Uses a new model:
```prisma
model ClientMessage {
  id         String   @id @default(cuid())
  clientId   String
  sentById   String
  body       String   @db.Text
  isFromAdmin Boolean @default(false)
  isRead     Boolean  @default(false)
  createdAt  DateTime @default(now())
  client     Client   @relation(...)
  sentBy     User     @relation(...)
}
```
Client sees their message thread. Admin sees all threads in `app/admin/messages/page.tsx` with unread count badges per client.

---

## PHASE 5 — Cleaner Portal Enhancements

### 5.1 GPS check-in / check-out
**New fields on Job model:**
```prisma
// Add to Job
gpsCheckInLat   Float?
gpsCheckInLng   Float?
gpsCheckInAt    DateTime?
gpsCheckOutLat  Float?
gpsCheckOutLng  Float?
gpsCheckOutAt   DateTime?
gpsDistanceMeters Int?  // distance from property at check-in
```
**File:** `app/cleaner/jobs/[id]/page.tsx`
When cleaner taps "Start job": browser calls `navigator.geolocation.getCurrentPosition()`. Sends lat/lng to `POST /api/cleaner/jobs/[id]/gps-checkin`. API checks distance from `Property.latitude/longitude` (add these to Property model). If > 500m: shows warning "You appear to be away from the property" but still allows check-in. Distance stored for admin review. Admin jobs page shows GPS check-in badge (green = within range, orange = outside range).

### 5.2 Offline PWA mode
**New files:** `public/sw.js`, update `next.config.mjs`
Install `@ducanh2912/next-pwa` or write a custom service worker.
Cache strategy:
- App shell (JS/CSS): cache-first
- API reads (jobs list, form templates): network-first with 1-hour cache fallback
- Form submissions: queue in IndexedDB when offline, sync when back online (Background Sync API)
- Photos: uploaded to IndexedDB first, then S3 presign when online
Manifest already exists — just needs proper icons (icon-192.png, icon-512.png in public/).
"Add to home screen" prompt: custom banner shown to cleaner and laundry users after 3 visits.

### 5.3 Job briefing view
**File:** `app/cleaner/jobs/[id]/page.tsx`
New "Briefing" tab shown BEFORE the cleaner starts the job. Shows:
- Property photos (from last 3 completed jobs' `SubmissionMedia`)
- Access instructions + access code (decrypted from Property.accessCode)
- Alarm code (decrypted from Property.alarmCode)
- Client preferences / special notes (from `Property.accessNotes` + job notes)
- Previous QA flags (from last job's `QAReview.flags` — shows which areas to pay attention to)
- Laundry instructions if applicable

### 5.4 Multi-stop day route view
**File:** `app/cleaner/jobs/page.tsx` (add "Today's route" section at top)
Shows today's jobs ordered by start time with:
- Job address as a numbered stop
- Estimated drive time between stops (Google Maps Directions API, or just a static Google Maps multi-stop URL)
- "Open in Maps" button generates a `https://www.google.com/maps/dir/` URL with all stops

### 5.5 Cleaner personal performance dashboard
**File:** `app/cleaner/page.tsx` (enhance existing dashboard)
New cards:
- This month's earnings (from completed jobs + pay adjustments)
- Jobs completed this month / this week
- Average QA score (last 10 jobs) with trend arrow
- Recognition badges earned (from `StaffRecognition`)
- Streak: consecutive days with at least one job completed
- "Your ranking this month" (anonymous position in team leaderboard)

### 5.6 Availability self-management
**File:** `app/cleaner/availability/page.tsx` (already exists)
Enhance: weekly recurring availability (Mon-Sun, time slots per day) + individual day-off requests. Admin sees this in the scheduling view and auto-assign respects it. Store in:
```prisma
model CleanerAvailability {
  id        String   @id @default(cuid())
  userId    String
  dayOfWeek Int?     // 0=Sun, 6=Sat, null=specific date
  date      DateTime? // for specific date overrides
  startTime String   // HH:mm
  endTime   String   // HH:mm
  isAvailable Boolean @default(true)
  note      String?
  createdAt DateTime @default(now())
  user      User     @relation(...)
}
```

### 5.7 Supply request from within job
**File:** `app/cleaner/jobs/[id]/page.tsx`
"Request supplies" button → opens a modal with inventory item picker → submits a `ShoppingRun` linked to the property + job. Admin gets notified. Cleaner sees "Supply request submitted" confirmation.

### 5.8 Safety check-in
**File:** `app/cleaner/jobs/[id]/page.tsx`
For jobs flagged as "solo property visit" (new `Job.requiresSafetyCheckin Boolean`): a "I'm safe" button appears after check-in. If not tapped within 90 minutes of job start, admin and ops manager get an automated alert notification. Cleaner can tap it at any time. Tapping records `Job.safetyCheckinAt DateTime?`.

### 5.9 Upsell prompt at job completion
**File:** `app/cleaner/jobs/[id]/page.tsx`
After submitting the form, before marking complete: shows a card "Would the client benefit from any add-ons?" with toggles for common add-ons (oven clean, fridge clean, balcony sweep, window clean). If any selected: creates a `JobTask` of type "UPSELL_SUGGESTION" with the items in notes. Admin/ops can follow up with the client.

### 5.10 Feedback to admin (private note)
**File:** `app/cleaner/jobs/[id]/page.tsx`
After form submission: optional "Private note to admin" textarea. Content stored in `Job.internalNotes` (already exists). Not visible to client. Shown to admin in job detail with a "Cleaner note" label.

---

## PHASE 6 — Ops Manager Portal

### 6.1 Ops inbox — unified priority feed
**New file:** `app/admin/ops/page.tsx` (or rename existing approvals page)
Single feed sorted by urgency combining:
1. Unassigned jobs (today and tomorrow) — critical
2. Jobs running late (past start time, still ASSIGNED) — urgent
3. Pending QA reviews — high
4. Continuation approval requests — high
5. New leads (in last 24h) — medium
6. Failed laundry pickups pending decision — medium
7. Cases unactioned > 48h — medium
8. Expiring cleaner documents (within 14 days) — low
Each item is actionable inline (assign, approve, flag). Badge count on nav item.

### 6.2 Live operations map
**New file:** `app/admin/ops/map/page.tsx`
Google Maps embed showing:
- Each job today as a pin, colour-coded by status
- Cleaner last GPS check-in location (from `Job.gpsCheckInLat/Lng`) as a pulsing dot
- Clicking a job pin shows: job number, property, cleaner, status, start time
- Clicking a cleaner dot shows: name, current job, next job
- Refresh every 60 seconds
Requires `NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY` env var.

### 6.3 SLA monitor
**File:** `app/admin/ops/page.tsx` or `app/admin/jobs/page.tsx`
Jobs that have passed their `dueTime` and are not yet SUBMITTED show a red "Overdue" badge. Jobs within 30 minutes of their `dueTime` show an amber "Due soon" badge. These appear at the top of the jobs list and in the ops inbox.

### 6.4 Auto-assign algorithm
**File:** `lib/jobs/auto-assign.ts` (enhance existing, `autoAssign` settings already exist)
Settings: `autoAssign.maxDailyJobs`, `autoAssign.suburbWeight`, `autoAssign.qaWeight`, `autoAssign.loadWeight`
When a new job is created: find available cleaners (via `CleanerAvailability`), rank by: same suburb (weight), QA score (weight), current day load (weight). Suggest top 3. Admin can auto-accept the suggestion or choose manually. "Auto-assign" button in job detail.

### 6.5 Daily briefing email to ops
**File:** `workers/boss.ts` + `lib/ops/daily-briefing.ts`
New pg-boss job: `daily-ops-briefing`, scheduled `0 7 * * *` (7am Sydney).
Email contains:
- Today's jobs: count by status
- Unassigned jobs (urgent)
- Laundry pickups today
- Outstanding cases (open > 48h)
- New leads in last 24h
- Expiring documents (14 days)
Sent to all users with role ADMIN or OPS_MANAGER.

---

## PHASE 7 — Laundry Portal Enhancements

### 7.1 Collapse old completed jobs (already planned)
### 7.2 Today-first ordering (already planned)
### 7.3 Save preferences to localStorage (already planned)
### 7.4 Compact/full toggle (already planned)

### 7.5 Bag scanning via QR code
**File:** `app/laundry/page.tsx`
Each `LaundryTask` gets a QR code (generated from its ID using `qrcode` npm package). Admin can print QR labels. Laundry portal: "Scan bag" button → opens camera (via browser `getUserMedia` or a `<input type="file" capture="environment">` fallback) → reads QR code using `jsQR` library → auto-identifies the task → one-tap confirm pickup/dropoff.

### 7.6 Weight + price logging at dropoff
**New fields on `LaundryTask`:**
```prisma
bagWeightKg    Float?
dropoffCostAud Float?
receiptImageUrl String?
```
When laundry worker marks DROPPED: new fields appear: bag weight (number input) + cost (number input) + receipt photo upload. Stored on task. Admin can see these in the laundry detail panel.

### 7.7 Dispute handling
**File:** `app/laundry/page.tsx`
"Flag mismatch" button: if expected bag count ≠ actual. Opens a form: expected count, actual count, photo of bags. Creates an `IssueTicket` with `caseType=OPS`, linked to the LaundryTask via `metadata: { laundryTaskId }`. Admin gets push notification.

### 7.8 Laundry supplier management
**New file:** `app/admin/laundry/suppliers/page.tsx`
**New model:**
```prisma
model LaundrySupplier {
  id            String   @id @default(cuid())
  name          String
  phone         String?
  email         String?
  address       String?
  pricePerKg    Float?
  avgTurnaround Int?     // hours
  reliabilityScore Float? // admin-set 1-5
  notes         String?
  isActive      Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```
Admin can link a `LaundryTask` to a supplier (`LaundryTask.supplierId String?`). Track which supplier handled each job.

---

## PHASE 8 — Workforce Hub Completion

### 8.1 Team Groups (already detailed in previous plan)
Smart rules engine: rule builder UI with field/operator/value. "Preview members" button. Group stats: member count, avg QA, active jobs. Bulk message.

### 8.2 Announcements + Read Receipts (already detailed)
New `WorkforcePostRead` model. Rich post creation. Schedule for later. Unread dot. "Seen by X of Y" for admin.

### 8.3 Chat — Polling Real-Time (already detailed)
3-second polling. Unread badges. Image attachments. @mention support. Admin can create/manage channels.

### 8.4 Learning Platform — Course Builder (already detailed)
Course schema in JSON. Drag-and-drop lesson builder. Video/text/quiz lesson types. Auto-grade quizzes. Progress tracking. Certificate generation. Auto-assign on hire.

### 8.5 Documents — Expiry Alerts + E-signature (already detailed)
Daily expiry check worker. Request document from staff. Signature checkbox flow.

### 8.6 Recognition — Leaderboard + Auto-Badges (already detailed)
7 badge categories. Weekly auto-recognition worker. Recognition wall. Leaderboard.

### 8.7 Hiring — Advanced Pipeline (already detailed)
Application statuses: NEW→SCREENING→INTERVIEW→OFFER→HIRED/REJECTED. Kanban view. Interview notes. Bulk emails. Hire → auto-creates user, assigns courses, requests documents.

---

## PHASE 9 — Case Handling Improvements (already planned)

### 9.1 Admin quick actions — inline status change, assign to self
### 9.2 Resolution templates per case type
### 9.3 Client simplified 3-step create form
### 9.4 Auto-case from QA score < 60%
### 9.5 Auto-follow-up on unactioned cases > 48h (new worker job)

---

## Prisma Schema Migrations Needed

### Migration 1: Core additions
```
- BlogPost model (new)
- ClientSatisfactionRating model (new)
- LoyaltyAccount model (new)
- LoyaltyTransaction model (new)
- Referral model (new)
- ClientMessage model (new)
- EmailCampaign model (new)
- LaundrySupplier model (new)
- CleanerAvailability model (new)
```

### Migration 2: Field additions
```
- Job: gpsCheckInLat, gpsCheckInLng, gpsCheckInAt, gpsCheckOutLat, gpsCheckOutLng, gpsCheckOutAt, gpsDistanceMeters, requiresSafetyCheckin, safetyCheckinAt
- Property: latitude, longitude, accessCode, alarmCode, keyLocation, accessNotes, preferredCleanerUserId
- ClientInvoice: paidAt, stripePaymentIntentId
- HiringApplication: interviewNotes, interviewDate, offerDetails, rejectionReason
- LaundryTask: bagWeightKg, dropoffCostAud, receiptImageUrl, supplierId
- User: hourlyRate
- WorkforcePost: publishAt
```

### Migration 3: Workforce enhancements
```
- WorkforcePostRead model (new)
```

Run migrations in order: `npx prisma migrate dev --name {name}`

---

## New npm Dependencies

```
recharts                  # Revenue/analytics charts (Phase 3.6)
react-markdown            # Blog post rendering (Phase 2.7)
qrcode                    # QR code generation for laundry bags (Phase 7.5)
jsQR                      # QR code scanning from camera (Phase 7.5)
@ducanh2912/next-pwa      # Service worker / offline mode (Phase 5.2)
@dnd-kit/core             # Drag-and-drop for learning course builder (Phase 8.4)
@dnd-kit/sortable         # Sortable lists for course builder (Phase 8.4)
```

---

## New Environment Variables

```
GOOGLE_PLACES_API_KEY       # For Google Reviews (Phase 2.6)
GOOGLE_MAPS_API_KEY         # For route optimisation, live map (Phase 3.2, 6.2)
NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY  # Public-facing map embed
ENCRYPTION_KEY              # AES-256 for access codes vault (Phase 3.17)
```

---

## Complete Execution Order (by priority and dependency)

| # | Phase | Feature | Dependencies |
|---|-------|---------|-------------|
| 1 | 1 | Bug fixes (A1–A4) | None |
| 2 | 2.1 | Nav dropdown all 15 | None |
| 3 | 2.2 | Announcement bar CMS | content.ts, shell, editor |
| 4 | DB | Migration 1+2 | None |
| 5 | 3.3 | Admin jobs enhanced filters | None |
| 6 | 3.5 | Admin batch operations | None |
| 7 | 4.1 | Client self-serve booking | DB migration done |
| 8 | 4.2 | Client jobs calendar/ordering | None |
| 9 | 4.3 | Reschedule/cancel requests | None |
| 10 | 5.1 | GPS check-in/out | DB migration done |
| 11 | 5.3 | Job briefing view | Property access vault |
| 12 | 3.17 | Property access vault (encryption) | ENCRYPTION_KEY |
| 13 | 5.4 | Multi-stop route view | None |
| 14 | 5.5 | Cleaner performance dashboard | None |
| 15 | 5.6 | Availability self-management | DB migration done |
| 16 | 7 | Laundry improvements | DB migration done |
| 17 | 3.1 | Drag-drop admin calendar | None |
| 18 | 3.4 | Damage indicator on jobs | None |
| 19 | 3.6 | Revenue dashboard | recharts installed |
| 20 | 3.7 | Pay calculator + payslip | Playwright already installed |
| 21 | 3.8 | Client LTV + churn risk | None |
| 22 | 3.14 | Automated follow-up sequences | ClientSatisfactionRating model |
| 23 | 4.4 | Post-job star rating | Follow-up sequences |
| 24 | 4.6 | Stripe invoice payment | Stripe webhook route |
| 25 | 4.7 | Loyalty points | DB migration done |
| 26 | 4.8 | Referral program | Loyalty system |
| 27 | 4.9 | Property condition timeline | None |
| 28 | 4.10 | Client ↔ admin messages | DB migration done |
| 29 | 6.1 | Ops unified inbox | None |
| 30 | 6.2 | Live operations map | GPS check-in done, GOOGLE_MAPS_API_KEY |
| 31 | 6.3 | SLA monitor | None |
| 32 | 6.4 | Auto-assign algorithm | CleanerAvailability model |
| 33 | 6.5 | Daily ops briefing email | Worker pattern established |
| 34 | 2.3 | Price estimator widget | None |
| 35 | 2.5 | Suburb availability checker | None |
| 36 | 2.6 | Google Reviews display | GOOGLE_PLACES_API_KEY |
| 37 | 2.7 | Blog engine | BlogPost model, react-markdown |
| 38 | 2.8 | Suburb SEO pages | Static, no DB |
| 39 | 2.9 | Service comparison page | None |
| 40 | 2.10 | Careers page | HiringPosition model exists |
| 41 | 3.2 | Route optimisation map | GOOGLE_MAPS_API_KEY |
| 42 | 3.13 | Email campaign builder | EmailCampaign model |
| 43 | 3.15 | QA trend + compliance dashboard | None |
| 44 | 3.16 | Xero integration | Xero API credentials |
| 45 | 5.2 | Offline PWA | @ducanh2912/next-pwa |
| 46 | 5.7 | Supply request from job | None |
| 47 | 5.8 | Safety check-in | DB migration done |
| 48 | 5.9 | Upsell prompt | None |
| 49 | 7.5 | Bag scanning QR | qrcode, jsQR |
| 50 | 7.6 | Weight + price logging | DB migration done |
| 51 | DB | Migration 3 (WorkforcePostRead) | None |
| 52 | 8.1 | Team groups smart rules | Migration 3 done |
| 53 | 8.2 | Posts + read receipts | Migration 3 done |
| 54 | 8.3 | Chat real-time polling | Migration 3 done |
| 55 | 8.4 | Learning platform builder | @dnd-kit installed |
| 56 | 8.5 | Documents + expiry alerts | None |
| 57 | 8.6 | Recognition + leaderboard | None |
| 58 | 8.7 | Hiring advanced pipeline | None |
| 59 | 9 | Case handling improvements | None |

---

## Verification Checklist

**After Phase 1:**
- [ ] `/services/general-clean` — layout centered, correct gutters
- [ ] Scroll + WhatsApp FABs — both visible, no overlap
- [ ] Login page — single "Back to home" at top, "Register here" at bottom
- [ ] Tomorrow email — correct job count in Sydney timezone

**After Phase 2:**
- [ ] Services nav — all 15 services accessible via dropdown collapse/expand
- [ ] Announcement bar — admin sets promo message, shows on public site
- [ ] Price estimator — live price updates on homepage as fields change

**After Phase 3-4:**
- [ ] Admin calendar — drag job to new date, scheduledDate updates in DB
- [ ] Revenue dashboard — correct totals match invoice records
- [ ] Client booking — client creates job, appears in admin as UNASSIGNED

**After Phase 5:**
- [ ] GPS check-in — distance recorded, warning shown if > 500m from property
- [ ] Job briefing — access code shows decrypted for assigned cleaner only
- [ ] PWA — app installable on mobile, form submits queue offline and sync on reconnect

**After Phase 8:**
- [ ] Learning — complete a quiz, score saved, certificate downloadable
- [ ] Chat — messages appear within 3 seconds on second browser tab
- [ ] Hiring — mark HIRED → user account created, courses auto-assigned

**All Phases:**
- [ ] `npx tsc --noEmit` — zero errors
- [ ] `npm run build` — successful

---

## DETAILED IMPLEMENTATION SPECS (Added after codebase exploration)

---

### PHASE 1 — Confirmed Status After Codebase Inspection

| Bug | Status | Notes |
|-----|--------|-------|
| 1.1 service-detail-page layout | ✅ ALREADY DONE | `"use client"` exists at line 1 |
| 1.2 Scroll / WhatsApp overlap | ✅ ALREADY DONE | Scroll at `bottom-[4.5rem]`, WhatsApp at `bottom-6` |
| 1.3 Login duplicate link | ⚠️ NEEDS VERIFY | Agent found "Back to home" but not "Create account" in lines 100–135 — check lines 135–170 |
| 1.4 Tomorrow email 0 jobs | ⚠️ NEEDS TEST | `buildUtcDayRange()` at line 101 already uses `date-fns-tz` correctly. Test by running email manually before marking done |
| 1.5 npm run start stale | ✅ DOC ONLY | No code change needed |

**1.3 Login fix — exact change:**
```
File: app/(auth)/login/page.tsx
Search for: <Link href="/register">Create account</Link>
Remove that entire Link element only. Keep the surrounding div if it has other content.
```

---

### PHASE 2 — Exact Component & API Specs

#### 2.3 Price Estimator Widget

**New section in `components/public/home-page.tsx`** — insert between hero trust pills and services grid (after line ~208):

```tsx
// State:
const [estimate, setEstimate] = useState<{ min: number; max: number } | null>(null);
const [estimateLoading, setEstimateLoading] = useState(false);
const [estJobType, setEstJobType] = useState("GENERAL_CLEAN");
const [estBedrooms, setEstBedrooms] = useState(2);
const [estBathrooms, setEstBathrooms] = useState(1);

// Debounced fetch (300ms):
useEffect(() => {
  const t = setTimeout(async () => {
    setEstimateLoading(true);
    const res = await fetch("/api/public/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobType: estJobType, bedrooms: estBedrooms, bathrooms: estBathrooms, isEstimateOnly: true }),
    });
    const data = await res.json();
    if (data.basePrice) setEstimate({ min: data.basePrice, max: data.basePrice * 1.15 });
    setEstimateLoading(false);
  }, 300);
  return () => clearTimeout(t);
}, [estJobType, estBedrooms, estBathrooms]);
```

**API:** Reuse existing `POST /api/public/quote` — add `isEstimateOnly: true` flag to skip lead creation, just return price calculation.
**File to modify:** `app/api/public/quote/route.ts` — detect `isEstimateOnly` flag and return early with `{ basePrice, breakdown }` without creating a QuoteLead.

**UI layout:** Card with 3 selects in a row (sm:flex-row), live price badge "From $X–$Y" updates in place.

---

#### 2.5 Suburb Availability Checker

**New API route:** `app/api/public/availability/route.ts`
```ts
// GET /api/public/availability?suburb=Bondi
// Logic: query Property where suburb ILIKE input, count active ones
// Always return positive response
export async function GET(req: Request) {
  const suburb = new URL(req.url).searchParams.get("suburb") ?? "";
  const count = await prisma.property.count({
    where: { suburb: { contains: suburb, mode: "insensitive" }, isActive: true }
  });
  const days = ["Monday","Tuesday","Wednesday","Thursday","Friday"];
  const next = days[new Date().getDay() % 5];
  return Response.json({
    available: true,
    message: count > 0 ? `We service ${suburb}` : `We're expanding to ${suburb} soon`,
    nextSlot: `${next} from 8am`
  });
}
```

**UI in `components/public/home-page.tsx`** — below CTA buttons in hero:
```tsx
// State: suburbInput, suburbResult, suburbLoading
// Input + "Check" button → calls API on submit (not on keypress)
// Shows green pill with result message
```

---

#### 2.4 Before/After Gallery — Schema Change

**Add to `WebsiteGalleryItem` in `lib/public-site/content.ts`:**
```ts
beforeImageUrl?: string;
afterImageUrl?: string;
```
**UI:** Each gallery card shows image with a toggle button `[Before] [After]` — state per card with `useState<Record<string, "before"|"after">>({})`.
**Admin website editor gallery tab:** Add two extra image URL fields per item.
**`sanitizeWebsiteContent`:** Add `beforeImageUrl: s(item.beforeImageUrl)`, `afterImageUrl: s(item.afterImageUrl)` to gallery item sanitization.

---

#### 2.7 Blog — File Tree

```
app/(public)/blog/page.tsx                    # server component, list published posts
app/(public)/blog/[slug]/page.tsx             # server component, single post
components/public/blog-list-page.tsx          # "use client"
components/public/blog-post-page.tsx          # "use client"
app/admin/website/blog/page.tsx               # admin list + CRUD
app/api/admin/blog/route.ts                   # GET (list), POST (create)
app/api/admin/blog/[id]/route.ts              # PATCH (update), DELETE
app/api/public/blog/route.ts                  # GET published posts
app/api/public/blog/[slug]/route.ts           # GET single post by slug
```

**`middleware.ts`** — add `/blog` to public whitelist array (same pattern as existing public routes).

**Markdown rendering:** `npm install react-markdown` then:
```tsx
import ReactMarkdown from "react-markdown";
<ReactMarkdown className="prose prose-slate max-w-none">{post.body}</ReactMarkdown>
```

---

#### 2.8 Suburb SEO Pages

**New file:** `lib/public-site/suburbs.ts`
```ts
export const SYDNEY_SUBURBS = [
  { slug: "bondi", name: "Bondi", region: "Eastern Suburbs" },
  { slug: "surry-hills", name: "Surry Hills", region: "Inner City" },
  { slug: "newtown", name: "Newtown", region: "Inner West" },
  { slug: "chatswood", name: "Chatswood", region: "North Shore" },
  { slug: "parramatta", name: "Parramatta", region: "Western Sydney" },
  { slug: "manly", name: "Manly", region: "Northern Beaches" },
  { slug: "cronulla", name: "Cronulla", region: "Sutherland Shire" },
  { slug: "strathfield", name: "Strathfield", region: "Inner West" },
  { slug: "hornsby", name: "Hornsby", region: "Upper North Shore" },
  { slug: "penrith", name: "Penrith", region: "Western Sydney" },
  { slug: "liverpool", name: "Liverpool", region: "South-West Sydney" },
  { slug: "hurstville", name: "Hurstville", region: "St George" },
  { slug: "dee-why", name: "Dee Why", region: "Northern Beaches" },
  { slug: "lane-cove", name: "Lane Cove", region: "North Shore" },
  { slug: "balmain", name: "Balmain", region: "Inner West" },
  { slug: "randwick", name: "Randwick", region: "Eastern Suburbs" },
  { slug: "castle-hill", name: "Castle Hill", region: "Hills District" },
  { slug: "kogarah", name: "Kogarah", region: "St George" },
  { slug: "neutral-bay", name: "Neutral Bay", region: "Lower North Shore" },
  { slug: "mosman", name: "Mosman", region: "Lower North Shore" },
];
```
**`generateStaticParams`** in `app/(public)/cleaning/[suburb]/page.tsx` — maps SYDNEY_SUBURBS to `{ suburb: s.slug }`.
No DB query needed — purely static content with localised text substitution.

---

### PHASE 3 — Exact Admin Implementation Specs

#### 3.1 Calendar Drag-and-Drop

**File:** `app/admin/calendar/_calendar.tsx`

Add to FullCalendar component props:
```tsx
editable={true}
droppable={true}
eventDrop={async (info) => {
  const jobId = info.event.id;
  const newDate = info.event.start;
  // Optimistic update already happened in UI
  // Call API to persist:
  const res = await fetch(`/api/admin/jobs/${jobId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scheduledDate: newDate.toISOString(),
      startTime: info.event.extendedProps.startTime ?? null,
    }),
  });
  if (!res.ok) {
    info.revert(); // roll back on failure
    toast({ title: "Failed to reschedule", variant: "destructive" });
  } else {
    // Show 5s undo toast
    setLastDrop({ jobId, prevDate: info.oldEvent.start!, prevStart: info.oldEvent.extendedProps.startTime });
    toast({ title: "Job rescheduled", action: <ToastAction onClick={handleUndo}>Undo</ToastAction> });
  }
}}
```
**State needed:** `lastDrop: { jobId, prevDate, prevStart } | null`
**Undo handler:** calls PATCH again with previous values, then clears `lastDrop`.
**Existing API:** `PATCH /api/admin/jobs/[id]` already exists — verify it accepts `scheduledDate` + `startTime`.

---

#### 3.3 Admin Jobs Enhanced Filters

**Confirmed:** `JOB_FILTER_DEFAULTS` already exists at line 54–60 with all 6 fields.
**What's missing:** The collapsible filter panel UI and URL persistence.

**Changes to `app/admin/jobs/page.tsx`:**
```tsx
// URL persistence — add to existing useEffect for URL sync:
const params = new URLSearchParams(searchParams.toString());
Object.entries(filters).forEach(([k, v]) => v ? params.set(k, v) : params.delete(k));
router.replace(`?${params.toString()}`, { scroll: false });

// Read from URL on mount:
const initialFilters = {
  status: searchParams.get("status") ?? "all",
  search: searchParams.get("search") ?? "",
  cleanerName: searchParams.get("cleanerName") ?? "",
  jobType: searchParams.get("jobType") ?? "all",
  dateFrom: searchParams.get("dateFrom") ?? "",
  dateTo: searchParams.get("dateTo") ?? "",
};

// Active filter count badge:
const activeCount = Object.values(filters).filter(v => v && v !== "all").length;

// Collapsible panel: <Collapsible open={filtersOpen}> wrapping all filter inputs
// "Filters" button shows <Badge>{activeCount}</Badge> when > 0
```

---

#### 3.5 Batch Operations on Jobs

**New state in `app/admin/jobs/page.tsx`:**
```tsx
const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
const [bulkStatusOpen, setBulkStatusOpen] = useState(false);

const toggleSelect = (id: string) =>
  setSelectedIds(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
const selectAll = () => setSelectedIds(new Set(jobs.map(j => j.id)));
const clearAll = () => setSelectedIds(new Set());
```

**Table header:** Add `<Checkbox checked={selectedIds.size === jobs.length} onCheckedChange={...} />` column.
**Each job row:** Add `<Checkbox checked={selectedIds.has(job.id)} onCheckedChange={() => toggleSelect(job.id)} />`.

**Floating action bar** (shown when `selectedIds.size > 0`):
```tsx
<div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex gap-2 rounded-xl border bg-background/95 px-4 py-3 shadow-xl backdrop-blur">
  <span className="text-sm font-medium">{selectedIds.size} selected</span>
  <Button size="sm" onClick={() => setBulkAssignOpen(true)}>Assign cleaner</Button>
  <Button size="sm" variant="outline" onClick={() => setBulkStatusOpen(true)}>Change status</Button>
  <Button size="sm" variant="ghost" onClick={clearAll}>Cancel</Button>
</div>
```

**New API routes:**
- `POST /api/admin/jobs/bulk-assign` — body: `{ jobIds: string[], cleanerUserId: string }` — creates JobAssignment for each
- `POST /api/admin/jobs/bulk-status` — body: `{ jobIds: string[], status: JobStatus }` — updates status for each

---

#### 3.6 Revenue Dashboard — Exact DB Queries

**File:** `app/admin/finance/dashboard/page.tsx` (new — admin/finance currently has only `page.tsx`)

**DB queries (server component or API route):**
```ts
// Monthly revenue (last 12 months)
const monthlyRevenue = await prisma.$queryRaw`
  SELECT DATE_TRUNC('month', "createdAt") as month, SUM("totalAmount") as revenue
  FROM "ClientInvoice"
  WHERE status = 'PAID' AND "createdAt" > NOW() - INTERVAL '12 months'
  GROUP BY 1 ORDER BY 1
`;

// Revenue by job type
const byJobType = await prisma.job.groupBy({
  by: ["jobType"],
  where: { status: "COMPLETED" },
  _count: { id: true },
});

// MTD revenue
const mtd = await prisma.clientInvoice.aggregate({
  where: {
    status: "PAID",
    createdAt: { gte: startOfMonth(new Date()) },
  },
  _sum: { totalAmount: true },
});

// YTD revenue
const ytd = await prisma.clientInvoice.aggregate({
  where: {
    status: "PAID",
    createdAt: { gte: startOfYear(new Date()) },
  },
  _sum: { totalAmount: true },
});
```

**Recharts components used:**
- `BarChart` + `Bar` + `XAxis` + `YAxis` + `Tooltip` — monthly revenue
- `PieChart` + `Pie` + `Cell` — job type breakdown
- `LineChart` + `Line` — QA trend + jobs per week
- All wrapped in `ResponsiveContainer width="100%" height={300}`

**Install:** `npm install recharts`

---

#### 3.7 Pay Calculator

**New field needed:** `User.hourlyRate Float?` (Migration 2)
**New file:** `app/admin/finance/payroll/page.tsx`

**Calculation per cleaner:**
```ts
// For each cleaner, get completed jobs in date range:
const jobs = await prisma.job.findMany({
  where: {
    assignments: { some: { userId: cleaner.id } },
    status: "COMPLETED",
    scheduledDate: { gte: startDate, lte: endDate },
  },
  select: { actualHours: true, jobType: true, scheduledDate: true, id: true },
});
const grossPay = jobs.reduce((sum, j) => sum + (j.actualHours ?? 0) * (cleaner.hourlyRate ?? 0), 0);
```

**PDF generation:** Reuse existing `lib/reports/generator.ts` pattern (Playwright already installed). Generate HTML payslip template → PDF. Add a `generatePayslipHtml(cleaner, jobs, dateRange, grossPay)` function.

---

#### 3.17 Property Access Vault — Encryption

**Encryption utility:** New file `lib/crypto/vault.ts`
```ts
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const KEY = Buffer.from(process.env.ENCRYPTION_KEY!, "hex"); // 32-byte hex

export function encrypt(text: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", KEY, iv);
  return iv.toString("hex") + ":" + cipher.update(text, "utf8", "hex") + cipher.final("hex");
}

export function decrypt(ciphertext: string): string {
  const [ivHex, enc] = ciphertext.split(":");
  const decipher = createDecipheriv("aes-256-cbc", KEY, Buffer.from(ivHex, "hex"));
  return decipher.update(enc, "hex", "utf8") + decipher.final("utf8");
}
```

**Property model additions (Migration 2):**
```prisma
accessCode    String?  @db.Text  // AES-256 encrypted
alarmCode     String?  @db.Text  // AES-256 encrypted
keyLocation   String?
accessNotes   String?  @db.Text
latitude      Float?
longitude     Float?
preferredCleanerUserId String?
```

**Admin property edit page:** Decrypt on load for editing, re-encrypt on save.
**Cleaner job briefing:** Decrypt only when job is assigned to that cleaner — checked in API handler before returning.

---

### PHASE 4 — Client Portal Exact Specs

#### 4.1 Self-Serve Booking — 3-Step Flow

**New files:**
- `app/client/booking/page.tsx` — server wrapper
- `components/client/booking-wizard.tsx` — "use client", manages step state

**Step state:** `type Step = 1 | 2 | 3`

**Step 1 — Property + Service:**
```tsx
// Fetch client's properties from existing API
// <Select> for property, <Select> for jobType
// JobType options: GENERAL_CLEAN, DEEP_CLEAN, END_OF_TENANCY, AIRBNB_TURNOVER, etc.
```

**Step 2 — Date Selection:**
```tsx
// Fetch available slots: GET /api/client/available-slots?propertyId=X&serviceType=Y
// API: returns next 30 days where daily job count < settings.maxDailyJobs
// Show calendar grid (date-fns, not FullCalendar) — green = available, grey = full
// Click a date to select it
```

**Step 3 — Confirm:**
```tsx
// Show summary: property, service, date, estimated price
// Notes textarea
// "Confirm Booking" button
```

**Submit API:** `POST /api/client/booking`
```ts
// Body: { propertyId, jobType, scheduledDate, notes }
// Creates: QuoteLead (status=CONVERTED) + Job (status=UNASSIGNED)
// Sends admin notification via existing push/email
// Returns: { jobId, jobNumber }
```

**Available slots API:** `GET /api/client/available-slots`
```ts
// Query: count jobs per date in next 30 days for this property
// Max jobs per day from: settings.clientPortal.maxBookingsPerDay (default: 8)
// Return: { available: string[] } — ISO date strings
```

**Middleware:** Add `/client/booking` — already in CLIENT role block.
**Settings:** Add `clientPortalVisibility.showBooking: boolean` (default `true`).

---

#### 4.3 Reschedule / Cancel Requests

**File:** `components/client/client-jobs-workspace.tsx` (where job cards are rendered)

**"Change date" button** — on upcoming jobs only (`scheduledDate > today`):
```tsx
// Opens a Dialog with a date input (type="date")
// On confirm: POST /api/client/jobs/[id]/reschedule-request
// Body: { requestedDate: string }
// Creates JobTask: { taskType: "RESCHEDULE_REQUEST", notes: `Client requested: ${date}`, jobId }
// Shows toast: "Request sent to admin"
```

**"Cancel" button:**
```tsx
// Opens Dialog with <Select> reason (slot change, no longer needed, found another cleaner, other)
// On confirm: POST /api/client/jobs/[id]/cancel-request
// Body: { reason: string }
// Creates JobTask: { taskType: "CANCEL_REQUEST", notes: reason, jobId }
```

**New API routes:**
- `POST /api/client/jobs/[id]/reschedule-request`
- `POST /api/client/jobs/[id]/cancel-request`
Both check: job belongs to authenticated client, status is not COMPLETED/INVOICED.

---

#### 4.6 Stripe Invoice Payment

**New field in ClientInvoice (Migration 2):**
```prisma
paidAt              DateTime?
stripePaymentIntentId String?
```

**Payment link API:** `POST /api/client/invoices/[id]/payment-link`
```ts
// Verify invoice belongs to client session
// Use existing Stripe REST pattern (no npm package)
// POST https://api.stripe.com/v1/checkout/sessions
// Body (form-encoded):
//   payment_method_types[]=card
//   mode=payment
//   line_items[0][price_data][currency]=aud
//   line_items[0][price_data][product_data][name]=Invoice ${invoice.invoiceNumber}
//   line_items[0][price_data][unit_amount]=${Math.round(invoice.totalAmount * 100)}
//   line_items[0][quantity]=1
//   success_url=${NEXTAUTH_URL}/client/finance?paid=1
//   cancel_url=${NEXTAUTH_URL}/client/finance
//   metadata[invoiceId]=${invoice.id}
// Return: { url: session.url }
```

**Webhook route:** `app/api/webhooks/stripe/route.ts`
```ts
// POST /api/webhooks/stripe
// 1. Read raw body as text
// 2. Verify: Stripe-Signature header + STRIPE_WEBHOOK_SECRET
//    const sig = req.headers.get("stripe-signature")!;
//    const body = await req.text();
//    // Manual HMAC verify (no SDK): compute expected sig, compare
// 3. Parse JSON event
// 4. If event.type === "checkout.session.completed":
//    const invoiceId = event.data.object.metadata.invoiceId;
//    await prisma.clientInvoice.update({
//      where: { id: invoiceId },
//      data: { status: "PAID", paidAt: new Date(), stripePaymentIntentId: event.data.object.payment_intent }
//    });
// New env var: STRIPE_WEBHOOK_SECRET
```

**UI in `app/client/finance/page.tsx`:** Add "Pay Now" button on invoices where `status === "SENT"`. On click: calls payment-link API, redirects to Stripe URL.

---

#### 4.7 Loyalty Points — Integration Points

**On job COMPLETED** (in worker or job status update API):
```ts
// In the job status update handler (when status changes to COMPLETED):
const invoice = await prisma.clientInvoice.findFirst({ where: { /* linked to job */ } });
if (invoice) {
  const points = Math.floor(invoice.totalAmount * 10); // 10 pts per $1
  await prisma.loyaltyAccount.upsert({
    where: { clientId: job.property.clientId },
    create: { clientId: job.property.clientId, points },
    update: { points: { increment: points } },
  });
  await prisma.loyaltyTransaction.create({
    data: { accountId: ..., points, reason: "Job completed", referenceId: job.id },
  });
}
```

**Client portal widget** — add to `app/client/page.tsx` dashboard:
```tsx
// Card: "🌟 Your Points: {account.points}"
// Sub: "= ${(account.points / 100).toFixed(2)} credit value"
// "Redeem" button (if points >= 1000) → creates discount note for admin
```

---

### PHASE 5 — Cleaner Portal Exact Specs

#### 5.1 GPS Check-in — Exact Code

**In `app/cleaner/jobs/[id]/page.tsx`** — modify `handleStart()` function:
```ts
async function handleStart() {
  // Existing start logic...
  // Add GPS capture:
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await fetch(`/api/cleaner/jobs/${jobId}/gps-checkin`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        });
      },
      () => { /* GPS denied — proceed without it */ },
      { timeout: 10000 }
    );
  }
  // Continue with existing start logic...
}
```

**New API route:** `app/api/cleaner/jobs/[id]/gps-checkin/route.ts`
```ts
// POST — body: { lat: number, lng: number }
// 1. Verify job assigned to session user
// 2. Get property lat/lng:
const prop = await prisma.property.findUnique({ where: { id: job.propertyId }, select: { latitude: true, longitude: true } });
// 3. Calculate Haversine distance (if property has lat/lng):
function haversineMeters(lat1, lng1, lat2, lng2): number {
  const R = 6371000;
  const φ1 = lat1 * Math.PI/180, φ2 = lat2 * Math.PI/180;
  const Δφ = (lat2-lat1) * Math.PI/180, Δλ = (lng2-lng1) * Math.PI/180;
  const a = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
const dist = prop?.latitude ? Math.round(haversineMeters(lat, lng, prop.latitude, prop.longitude)) : null;
// 4. Save to Job:
await prisma.job.update({ where: { id: jobId }, data: {
  gpsCheckInLat: lat, gpsCheckInLng: lng, gpsCheckInAt: new Date(), gpsDistanceMeters: dist
}});
// 5. Return: { distanceMeters: dist, withinRange: dist === null || dist < 500 }
```

**UI feedback in cleaner job page:** After GPS saved, if distance > 500m: show amber toast "You appear to be {Xm} from the property. Check-in recorded."

**Admin jobs page badge:** In job row, if `gpsDistanceMeters !== null`:
```tsx
<Badge variant={job.gpsDistanceMeters < 500 ? "success" : "warning"}>
  {job.gpsDistanceMeters < 500 ? "On-site" : `${job.gpsDistanceMeters}m away`}
</Badge>
```

---

#### 5.2 Offline PWA — Setup Steps

**Install:** `npm install @ducanh2912/next-pwa`

**`next.config.mjs` changes:**
```js
import withPWA from "@ducanh2912/next-pwa";
export default withPWA({
  dest: "public",
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  swcMinify: true,
  disable: process.env.NODE_ENV === "development",
  workboxOptions: {
    disableDevLogs: true,
    runtimeCaching: [
      { urlPattern: /^\/api\/cleaner\/jobs/, handler: "NetworkFirst",
        options: { cacheName: "cleaner-jobs-cache", expiration: { maxAgeSeconds: 3600 } } },
    ],
  },
})(nextConfig);
```

**Icons needed:** `public/icon-192.png` + `public/icon-512.png` (sNeek logo, square format).
**Manifest:** Already exists — verify it references the icon filenames.
**"Add to home screen" prompt:** Show after 3 visits using `localStorage` counter.

---

#### 5.3 Job Briefing Tab

**Current 5 steps:** `overview → checklist → uploads → laundry → submit`
**New step:** Add `"briefing"` BEFORE overview — only shown before job starts.

```ts
// New type:
type Step = "briefing" | "overview" | "checklist" | "uploads" | "laundry" | "submit";

// Briefing tab renders:
// 1. Last 3 job photos (SubmissionMedia from same property)
// 2. Access info card (decrypted accessCode, alarmCode, keyLocation from Property)
// 3. Client notes / special instructions from job.notes
// 4. Previous QA flags (QAReview.flags from last job on this property)
// 5. Laundry instructions if job has laundry
// 6. "Begin Job" button → moves to overview step + triggers handleStart()
```

**API for briefing data:** `GET /api/cleaner/jobs/[id]/briefing`
```ts
// Returns:
{
  lastPhotos: SubmissionMedia[],      // last 3 completed jobs on same property
  accessCode: string | null,          // decrypted, only if job assigned to this user
  alarmCode: string | null,
  keyLocation: string | null,
  accessNotes: string | null,
  previousFlags: string[],            // from QAReview.flags on last job
  jobNotes: string | null,
}
```

---

#### 5.5 Cleaner Performance Dashboard

**Enhance `app/cleaner/page.tsx`:**
```ts
// DB queries for dashboard:
const thisMonthJobs = await prisma.job.count({
  where: {
    assignments: { some: { userId: session.id } },
    status: "COMPLETED",
    scheduledDate: { gte: startOfMonth(new Date()) },
  },
});

const avgQA = await prisma.qAReview.aggregate({
  where: {
    job: { assignments: { some: { userId: session.id } } },
    job: { scheduledDate: { gte: subDays(new Date(), 90) } },
  },
  _avg: { totalScore: true },
  take: 10,  // last 10 jobs
});

const earnings = await prisma.job.findMany({
  where: { assignments: { some: { userId: session.id } }, status: "COMPLETED",
           scheduledDate: { gte: startOfMonth(new Date()) } },
  select: { actualHours: true },
});
const monthEarnings = earnings.reduce((s, j) => s + (j.actualHours ?? 0) * (session.user.hourlyRate ?? 0), 0);
```

**New dashboard cards:**
1. "This month" — `${thisMonthJobs} jobs completed`
2. "Earnings" — `$${monthEarnings.toFixed(2)} this month`
3. "QA Score" — `${avgQA._avg.totalScore?.toFixed(0) ?? "N/A"}% avg (last 10 jobs)` + up/down arrow trend
4. "Badges" — from existing `StaffRecognition` model

---

### PHASE 6 — Ops Manager Specs

#### 6.1 Ops Inbox — Feed Query

**New file:** `app/admin/ops/page.tsx`

**Feed aggregation (server component):**
```ts
const [unassigned, lateJobs, pendingQA, pendingContinuations, newLeads, openCases, expiringDocs] = await Promise.all([
  prisma.job.findMany({ where: { status: "UNASSIGNED", scheduledDate: { lte: addDays(new Date(), 1) } }, take: 20 }),
  prisma.job.findMany({ where: { status: "IN_PROGRESS", startTime: { /* past due */ } }, take: 20 }),
  prisma.job.findMany({ where: { status: "QA_REVIEW" }, take: 20 }),
  prisma.job.findMany({ where: { status: "WAITING_CONTINUATION_APPROVAL" }, take: 20 }),
  prisma.quoteLead.findMany({ where: { createdAt: { gte: subHours(new Date(), 24) } }, take: 10 }),
  prisma.issueTicket.findMany({ where: { status: { notIn: ["RESOLVED","CLOSED"] }, createdAt: { lte: subHours(new Date(), 48) } }, take: 20 }),
  prisma.staffDocument.findMany({ where: { expiresAt: { lte: addDays(new Date(), 14), gte: new Date() } }, take: 20 }),
]);
```

**Feed items sorted by urgency score** — Unassigned today = 10, Late = 9, QA pending = 7, New lead = 5, Cases > 48h = 5, Expiring docs = 2.

---

#### 6.3 SLA Monitor

**In `app/admin/jobs/page.tsx`** — add computed badge per job row:
```tsx
function getSLAStatus(job: JobRow): "overdue" | "due-soon" | null {
  if (!job.dueTime || job.status === "COMPLETED" || job.status === "SUBMITTED") return null;
  const [h, m] = job.dueTime.split(":").map(Number);
  const dueMs = new Date(job.scheduledDate).setHours(h, m, 0, 0);
  const now = Date.now();
  if (now > dueMs) return "overdue";
  if (dueMs - now < 30 * 60 * 1000) return "due-soon";
  return null;
}

// In row render:
const sla = getSLAStatus(job);
{sla === "overdue" && <Badge variant="destructive">Overdue</Badge>}
{sla === "due-soon" && <Badge variant="warning">Due soon</Badge>}
```

---

### PHASE 7 — Laundry Improvements Specs

#### 7.1 Collapse Old Completed Jobs

**File:** `app/laundry/page.tsx`
```tsx
const [showOld, setShowOld] = useState(false);
const today = startOfDay(new Date());
const activeJobs = jobs.filter(j => !j.isCompleted || isAfter(j.updatedAt, subDays(today, 1)));
const oldJobs = jobs.filter(j => j.isCompleted && !isAfter(j.updatedAt, subDays(today, 1)));

// Render:
{activeJobs.map(j => <LaundryCard key={j.id} job={j} />)}
{oldJobs.length > 0 && (
  <button onClick={() => setShowOld(p => !p)} className="text-sm text-muted-foreground">
    {showOld ? "Hide" : "Show"} {oldJobs.length} completed jobs
  </button>
)}
{showOld && oldJobs.map(j => <LaundryCard key={j.id} job={j} />)}
```

#### 7.2 Save Filters to localStorage

```tsx
const STORAGE_KEY = "laundry-filters-v1";
const [filters, setFilters] = useState(() => {
  if (typeof window === "undefined") return defaultFilters;
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") ?? defaultFilters; }
  catch { return defaultFilters; }
});
useEffect(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(filters)), [filters]);
```

#### 7.6 Weight + Price Logging

**Migration 2 field additions to `LaundryTask`:**
```prisma
bagWeightKg     Float?
dropoffCostAud  Float?
receiptImageUrl String?
supplierId      String?
supplier        LaundrySupplier? @relation(...)
```

**UI in `app/laundry/page.tsx`** — when marking DROPPED_OFF, show extra fields:
```tsx
{step === "dropoff" && (
  <>
    <Input type="number" placeholder="Weight (kg)" value={weight} onChange={...} />
    <Input type="number" placeholder="Cost ($)" value={cost} onChange={...} />
    <input type="file" accept="image/*" capture="environment" onChange={handleReceiptPhoto} />
  </>
)}
```

---

### COMPLETE PRISMA MIGRATION — Full Field List

#### Migration 1 — `npx prisma migrate dev --name add_core_models`
New models: `BlogPost`, `ClientSatisfactionRating`, `LoyaltyAccount`, `LoyaltyTransaction`, `Referral`, `ClientMessage`, `EmailCampaign`, `LaundrySupplier`, `CleanerAvailability`

#### Migration 2 — `npx prisma migrate dev --name add_field_extensions`
```
Job:            + gpsCheckInLat Float?, gpsCheckInLng Float?, gpsCheckInAt DateTime?,
                  gpsCheckOutLat Float?, gpsCheckOutLng Float?, gpsCheckOutAt DateTime?,
                  gpsDistanceMeters Int?, requiresSafetyCheckin Boolean @default(false),
                  safetyCheckinAt DateTime?

Property:       + latitude Float?, longitude Float?, accessCode String? @db.Text,
                  alarmCode String? @db.Text, keyLocation String?, accessNotes String? @db.Text,
                  preferredCleanerUserId String?

ClientInvoice:  + paidAt DateTime?, stripePaymentIntentId String?

HiringApplication: + interviewNotes String? @db.Text, interviewDate DateTime?,
                     offerDetails String? @db.Text, rejectionReason String?

LaundryTask:    + bagWeightKg Float?, dropoffCostAud Float?, receiptImageUrl String?,
                  supplierId String?

User:           + hourlyRate Float?

WorkforcePost:  + publishAt DateTime?
```

#### Migration 3 — `npx prisma migrate dev --name add_workforce_reads`
New model: `WorkforcePostRead`

---

### API ROUTES SUMMARY — All New Routes

| Method | Path | Phase | Purpose |
|--------|------|-------|---------|
| GET | `/api/public/availability` | 2.5 | Suburb checker |
| POST | `/api/public/rating` | 3.14/4.4 | Post-job satisfaction rating |
| GET | `/api/public/next-slot` | 2.11 | Next available slot for hero |
| GET | `/api/public/blog` | 2.7 | Public blog list |
| GET | `/api/public/blog/[slug]` | 2.7 | Single blog post |
| GET,POST | `/api/admin/blog` | 2.7 | Admin blog management |
| PATCH,DELETE | `/api/admin/blog/[id]` | 2.7 | Admin blog edit/delete |
| GET | `/api/client/available-slots` | 4.1 | Booking date picker |
| POST | `/api/client/booking` | 4.1 | Create self-serve booking |
| POST | `/api/client/jobs/[id]/reschedule-request` | 4.3 | Create reschedule JobTask |
| POST | `/api/client/jobs/[id]/cancel-request` | 4.3 | Create cancel JobTask |
| POST | `/api/client/invoices/[id]/payment-link` | 4.6 | Stripe checkout session |
| GET,POST | `/api/client/messages` | 4.10 | Client-admin messaging |
| POST | `/api/webhooks/stripe` | 4.6 | Stripe payment webhook |
| POST | `/api/cleaner/jobs/[id]/gps-checkin` | 5.1 | GPS check-in |
| POST | `/api/cleaner/jobs/[id]/gps-checkout` | 5.1 | GPS check-out |
| GET | `/api/cleaner/jobs/[id]/briefing` | 5.3 | Job briefing data |'|
| POST | `/api/admin/jobs/bulk-assign` | 3.5 | Batch assign cleaner |
| POST | `/api/admin/jobs/bulk-status` | 3.5 | Batch status change |
| GET,POST | `/api/admin/messages` | 4.10 | Admin side messaging |

---

### WORKER JOBS SUMMARY — All New pg-boss Jobs

| Job name | Schedule | Phase | Purpose |
|----------|----------|-------|---------|
| `daily-ops-briefing` | `0 7 * * *` Sydney | 6.5 | Morning ops email |
| `document-expiry-check` | `0 8 * * *` Sydney | 8.5 | Flag expiring docs |
| `recognition-check` | `0 9 * * 1` (Mondays) | 8.6 | Auto award badges |
| `follow-up-1d` | Delayed +1d on job complete | 3.14 | Thank you email |
| `follow-up-3d` | Delayed +3d on job complete | 3.14 | Review request |
| `follow-up-14d` | Delayed +14d on job complete | 3.14 | Re-booking prompt |
| `google-reviews-refresh` | `0 3 * * *` | 2.6 | Refresh Google reviews cache |
