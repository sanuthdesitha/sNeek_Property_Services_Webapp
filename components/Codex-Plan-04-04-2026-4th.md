# sNeek Full-Platform Redesign & Feature Plan

## Context
The sNeek Property Service Website is a Next.js 14 / Prisma / NextAuth multi-portal app
(Admin, Client, Cleaner, Laundry, Public). The user wants:
1. Public site quick-fixes (announcement bar, stretched pages, quote full-screen)
2. Full portal redesigns for Client, Cleaner, Laundry — dark/pro theme + light option + theme switcher in settings
3. Laundry flicker fix (huge 25k-line page with too much DOM)
4. Professional email template redesign
5. 10–20 SEO-optimised blog posts (seeded into DB)
6. Google Maps address autocomplete everywhere
7. Public site animated redesign (phase last)

**Priority order**: Portals first → Email → Blog seed → Public site fixes → Public redesign

---

## Phase 1 — Quick Public Site Fixes (small, do alongside portals)

### 1.1 Announcement Bar Enable
- File: `lib/public-site/content.ts` → `DEFAULT_WEBSITE_CONTENT.announcementBar.enabled`
- Currently defaults to `false`. Change default to `true` with a sensible promo message.
- The rendering code in `components/public/public-site-shell.tsx:167` already works.
- Action: Edit `DEFAULT_WEBSITE_CONTENT` in `lib/public-site/content.ts`.

### 1.2 Why Us / Compare / Blog / FAQ — Layout Fix
- **Root cause**: These pages wrap content in bare `<div>` without `<main className="page-fade">`.
  Sections after the hero also lack `public-section-full` full-bleed backgrounds that the home page uses.
  The home page uses rich alternating full-bleed sections; these pages do not.
- **Fix**: 
  - Wrap each page's root in `<main className="page-fade">`.
  - Add proper `section-gap` to every section that's missing it.
  - Ensure no section-level element has `w-full` that fights with `public-page-container` CSS.
- Files: 
  - `components/public/why-us-page.tsx`
  - `components/public/compare-page.tsx`
  - `components/public/blog-page.tsx`
  - `components/public/faq-page.tsx`

### 1.3 Quote Page — Full Screen, Non-Stretched
- File: `components/quote/request-quote-page.tsx`
- Change outer wrapper to `min-h-screen` flex column layout.
- The wizard steps content stays inside a constrained `max-w-3xl mx-auto` card.
- Add a subtle full-bleed gradient background behind the wizard.
- Remove `PUBLIC_PAGE_CONTAINER` from the outer shell and apply it only to inner content.

---

## Phase 2 — Portal Redesign (Client, Cleaner, Laundry)

### 2.0 Theme System + Portal Shell Redesign

#### Schema Addition
- Add `portalTheme` field to `AppSettings` in `prisma/schema.prisma`:
  ```prisma
  portalTheme  String  @default("dark")  // "dark" | "light" | "public"
  ```
- Add to `AppSettings` interface in `lib/settings.ts`
- Add to `getAppSettings()` return value
- Create migration: `npm run db:migrate`

#### New Portal Shell (`components/portal/portal-shell.tsx`)
Complete rewrite. Current shell is a simple sticky top-nav header.
New shell: **full-height sidebar layout** (like Linear/Vercel):

```
┌──────────────────────────────────────────────────────┐
│ [Sidebar 240px]  │ [Main content area — flex-1]       │
│                  │                                    │
│  Logo + Name     │  <TopBar: breadcrumb + user>       │
│  ──────────────  │  ─────────────────────────────     │
│  Nav links       │  {children}                        │
│  (w/ icons)      │                                    │
│  ──────────────  │                                    │
│  User footer     │                                    │
│  Settings        │                                    │
│  Sign out        │                                    │
└──────────────────────────────────────────────────────┘
```

- Mobile: sidebar collapses to bottom tab bar (5 primary items) + hamburger sheet for rest.
- Theme variants applied via CSS data attribute `data-portal-theme="dark|light|public"` on root div.
  - `dark`: `--background: 222 47% 8%`, teal/amber accents, dark sidebars
  - `light`: current `bg-background` with white sidebar
  - `public`: inherits the global brand background from `globals.css`
- Sidebar width: 240px on desktop, collapsible to 64px icon-only mode.
- Icon per nav item (Lucide icons).
- Active state: pill indicator with teal accent.
- User avatar + name at bottom of sidebar.
- Portal label badge at top.

#### Portal Settings Page
- Each portal has a `/settings` page. Add a "Appearance" section to each:
  - Theme selector: Dark / Light / Match Public Site
  - Persisted in `localStorage` per-user (client-side preference) OR via user profile API.
- Reuse `components/profile/profile-settings.tsx` — add appearance tab.

---

### 2.1 Client Portal Redesign

#### Dashboard (`app/client/page.tsx` + `components/client/`)
New layout: **grid-based dashboard** with:
- **Hero row**: "Welcome back, {name}" + next service countdown card (prominent, full-width top)
- **Quick stats row** (4 cards): Properties | Jobs this month | Pending charges | Open cases
- **Split layout**:
  - Left 2/3: Upcoming jobs (rich cards with status timeline, cleaner name, address)
  - Right 1/3: Notifications + Laundry updates feed
- **Job Card redesign**: Shows job status as a mini-timeline (Scheduled → In Progress → Completed), cleaner photo, laundry status chip, report download button, any extra charges.
- **Laundry section**: Latest laundry items as horizontal scroll cards (status chips: Awaiting/Picked Up/Returned/Completed). Completed auto-collapsed into an accordion.
- **Finance snapshot**: Chart of charges over last 3 months (recharts bar chart).
- **Reports section**: Recent reports as a grid with thumbnail preview.

#### Job Detail View (`app/client/jobs/[id]/page.tsx` — create if missing)
Rich job detail page:
- Status timeline at top
- Job details: date/time, address, cleaner, service type
- Linked laundry cards (if any)
- Cost breakdown: base price + extras + adjustments
- Report section: embedded or download button
- Activity log / comments

#### Calendar (`app/client/calendar/page.tsx`)
- Full-screen FullCalendar with: Month / Week / Agenda views
- Default view selectable in settings
- Job events color-coded by status
- Click event → job detail drawer (no page navigation)
- iCal "Add to calendar" export button

#### Nav Items (Client)
Dashboard | Jobs | Calendar | Properties | Laundry | Reports | Finance | Messages | Settings

#### Settings (`app/client/settings/page.tsx`)
Tabs: Profile | Notifications | Appearance | Portal Preferences

---

### 2.2 Cleaner Portal Redesign

#### Dashboard (`app/cleaner/page.tsx`)
New layout:
- **Hero card**: "Good morning, {name}" + status: ON DUTY / OFF DUTY toggle
- **Today's row**: Next job card (large, prominent — address, time, map thumbnail, start button)
- **Incoming requests** (if any): Accept/Decline inline
- **Stats row**: This week hours | Jobs this month | Pending pay requests | Earned this month
- **Jobs awaiting confirmation**: Collapsible list
- **Upcoming week**: Timeline view (7-day horizontal scroll)
- **Workforce posts**: Compact news feed below the fold

#### Job View (`app/cleaner/jobs/[id]/page.tsx`)
- Large status timeline
- Start / Stop / Submit actions with confirmations
- Photo upload per room
- Laundry status toggle
- Early checkout request inline
- Damage report inline
- Reschedule request inline

#### Availability (`app/cleaner/availability/page.tsx`)
- Calendar-based availability picker (click days/time slots)
- Shows on admin ops page
- Save availability → visible to admin dispatch

#### Nav Items (Cleaner)
Dashboard | My Jobs | Calendar | Availability | Shopping | Invoices | Pay Requests | Hub | Settings

#### Settings
Tabs: Profile | Notifications | Availability | Appearance

---

### 2.3 Laundry Portal Redesign + Flicker Fix

#### Flicker Fix
- File: `app/laundry/page.tsx` (25,750 lines — massive single file)
- **Root cause**: Rendering all tasks at once causes huge DOM / rerender on scroll.
- **Fix**:
  1. Extract components into separate files under `components/laundry/`:
     - `laundry-task-card.tsx` — single task card (memo-ized with `React.memo`)
     - `laundry-task-list.tsx` — virtualized list using `@tanstack/react-virtual`
     - `laundry-photo-uploader.tsx` — photo upload UI
     - `laundry-qr-scanner.tsx` — QR code scanner
  2. Add `React.memo` to all heavy sub-components.
  3. Completed tasks auto-collapsed: default `collapsed = true` for tasks with `status === "COMPLETED"` or `status === "RETURNED"`. User can expand.
  4. Paginate the "completed" history tab (20 per page).
  5. Add `useDeferredValue` for the search/filter state.

#### New Laundry Dashboard Layout
- **Tabs redesign**: Pending | Picked Up | Dropped Off / Completed — three clear status tabs with count badges
- **Task cards**: Show: property name, job date, bag location, photos, cost — large clear cards
- Default sort: newest first
- **Completed jobs**: Auto-collapsed section per day, expand on click
- **Calendar view**: Month calendar showing laundry pickups/dropoffs
- **Stats bar** at top: Today's pickups | In progress | Completed this week | Revenue

#### Settings (Laundry)
- Default view: List / Calendar / Kanban
- Sort order: Newest / By property / By date
- Auto-collapse completed: On/Off
- Show cost tracking: On/Off

---

## Phase 3 — Email Template Redesign

### File: `lib/email-templates.ts` + `lib/notifications/email.ts`

**Current state**: HTML templates wrapped with basic company branding.

**New design** for ALL 30+ templates:
- Single consistent wrapper HTML/CSS:
  - White centered card (600px max), subtle teal header gradient
  - Company logo in header
  - Clean typography (system fonts)
  - Teal CTA button
  - Footer: company name, address, unsubscribe note
- Each template gets a clear subject line, greeting, body, CTA button, and footer note
- Professional copywriting for all key templates:
  - `jobAssigned` — includes job details, date, address, portal link
  - `jobReminder24h` — clear timing, access instructions reminder
  - `laundryReady` — photo preview embedded, pickup time
  - `cleaningReportShared` — report summary + download link
  - `clientInvoiceIssued` — invoice breakdown table
  - `welcomeAccount` — onboarding checklist + portal link
  - `caseCreated` / `caseUpdated` — case number, status, next steps

**iCal batch emails**:
- File: `workers/boss.ts` or wherever iCal sync triggers email
- Change: collect all updated properties in one sync pass → send ONE digest email listing all updated properties instead of one email per property
- New template: `icalSyncDigest` — lists N properties updated with reservation counts

---

## Phase 4 — SEO Blog Posts (Seed Script)

### Files
- `prisma/seed-blog.ts` (new file)
- Call from `prisma/seed.ts` OR run standalone: `npx ts-node prisma/seed-blog.ts`

### 15 Posts (targeting local SEO + service keywords)

| # | Slug | Title | Keywords |
|---|------|-------|---------|
| 1 | `how-to-prepare-your-home-for-an-end-of-lease-clean` | How to Prepare Your Home for an End-of-Lease Clean | end of lease cleaning Sydney |
| 2 | `airbnb-turnover-checklist-sydney` | The Complete Airbnb Turnover Checklist for Sydney Hosts | airbnb turnover cleaning |
| 3 | `deep-clean-vs-general-clean` | Deep Clean vs General Clean: Which Does Your Home Need? | deep cleaning service Parramatta |
| 4 | `how-often-should-you-professionally-clean-your-home` | How Often Should You Professionally Clean Your Home? | regular cleaning service Sydney |
| 5 | `carpet-steam-cleaning-guide-sydney` | Carpet Steam Cleaning: Everything Sydney Homeowners Need to Know | carpet cleaning Greater Sydney |
| 6 | `pressure-washing-driveway-sydney` | Why Pressure Washing Your Driveway Adds Curb Appeal | pressure washing Sydney |
| 7 | `end-of-lease-bond-back-tips` | 7 Tips to Get Your Full Bond Back After a Rental Clean | bond cleaning Sydney |
| 8 | `commercial-cleaning-office-sydney` | Keeping Your Sydney Office Spotless: Commercial Cleaning Guide | commercial cleaning Parramatta |
| 9 | `mold-prevention-sydney-homes` | Mould Prevention in Sydney Homes: What You Need to Know | mould treatment cleaning Sydney |
| 10 | `spring-cleaning-guide-sydney` | The Ultimate Spring Cleaning Guide for Sydney Homes | spring cleaning service Sydney |
| 11 | `what-to-expect-from-a-professional-clean` | What to Expect When You Book a Professional Clean | professional cleaning service Sydney |
| 12 | `airbnb-guest-ready-checklist` | How to Keep Your Airbnb Guest-Ready Without the Stress | short stay property management Sydney |
| 13 | `gutter-cleaning-when-and-why` | When and Why You Should Clean Your Gutters | gutter cleaning Greater Sydney |
| 14 | `linen-laundry-airbnb-management` | Linen and Laundry Management for Airbnb Hosts Made Easy | airbnb linen service Sydney |
| 15 | `property-management-cleaning-guide` | The Property Manager's Guide to Consistent Cleaning Standards | property management cleaning Sydney |

Each post: 600–900 words, H2 structure, meta description, featured image URL (Unsplash), published status, category tags.

---

## Phase 5 — Google Maps Address Autocomplete

### Existing component: `components/shared/google-address-input.tsx`
- Already exists. Verify it uses `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.
- Add Places Autocomplete if not already implemented.

### Apply to:
1. `components/quote/request-quote-page.tsx` — address field in property profile step
2. `app/(public)/quote/page.tsx` area (via quote component)
3. Home page availability checker (new section in `components/public/home-page.tsx`)
4. Admin new-property form: `components/admin/new-property-form.tsx`
5. Admin new-job form: `components/admin/new-job-form.tsx`

---

## Phase 6 — Public Site Redesign (Final Phase)

### 6.1 Home Page Availability Checker
- File: `components/public/home-page.tsx`
- Add a new "Check Availability" section below the hero.
- Uses `GoogleAddressInput` for address + a date picker.
- Calls `/api/availability/check` (new route) which checks:
  - Any existing bookings at that address on that date via Prisma
  - Returns: `available | busy | unknown`
- Shows result inline with a CTA to book.

### 6.2 Animated Public Site Redesign
- **Scroll animations**: Use `framer-motion` or CSS `@keyframes` with `IntersectionObserver` (no new deps if framer-motion not installed).
- **Page transition**: `page-fade` class already exists in `globals.css` — apply consistently.
- **Loading animation**: Add a branded spinner/skeleton that matches teal palette.
- **Sections**: Each home page section gets a scroll-triggered `fadeUp` animation.
- **Images**: Add real Unsplash images to all public pages (hero, service cards, testimonials).
- **Layout**: Replace boxy cards with overlapping layout, diagonal section dividers, large typography.

---

## Critical Files (full list)

### Portal Shell
- `components/portal/portal-shell.tsx` — complete rewrite

### Client Portal
- `app/client/layout.tsx`
- `app/client/page.tsx`
- `components/client/client-jobs-workspace.tsx`
- `components/client/client-laundry-workspace.tsx`
- `app/client/settings/page.tsx`
- `app/client/calendar/page.tsx`

### Cleaner Portal
- `app/cleaner/layout.tsx`
- `app/cleaner/page.tsx`
- `app/cleaner/settings/page.tsx`
- `app/cleaner/availability/page.tsx`

### Laundry Portal
- `app/laundry/page.tsx` — split into:
  - `components/laundry/laundry-task-card.tsx` (new)
  - `components/laundry/laundry-task-list.tsx` (new)
- `app/laundry/settings/page.tsx`

### Schema & Settings
- `prisma/schema.prisma` — add `portalTheme` to AppSettings
- `lib/settings.ts` — add to interface + defaults
- `prisma/migrations/` — new migration

### Email
- `lib/email-templates.ts` — redesign all HTML templates
- `lib/notifications/email.ts` — iCal batch email logic

### Public Site
- `lib/public-site/content.ts` — enable announcement bar in default
- `components/public/why-us-page.tsx`
- `components/public/compare-page.tsx`
- `components/public/blog-page.tsx`
- `components/public/faq-page.tsx`
- `components/quote/request-quote-page.tsx`
- `components/public/home-page.tsx`

### Blog
- `prisma/seed-blog.ts` (new)

---

## Verification Steps

1. **Portal themes**: Load `/client`, `/cleaner`, `/laundry` — each should default dark. Toggle theme in Settings → Appearance → verify instant switch.
2. **Laundry flicker**: Scroll the laundry page with 100+ tasks — no jank. Completed tasks collapsed by default.
3. **Announcement bar**: Load any public page → teal bar appears at top.
4. **Public pages**: Load `/why-us`, `/compare`, `/blog`, `/faq` — content centered like home, not stretched.
5. **Quote page**: `/quote` fills screen with constrained centered wizard.
6. **Email templates**: Trigger a job assignment from admin → check email HTML in Resend dashboard.
7. **Blog posts**: Load `/blog` → 15+ posts visible with images.
8. **Address autocomplete**: Start typing in quote address field → Google Places suggestions appear.
9. **Client job view**: Client portal → Jobs → click job → rich detail view with laundry + cost + report.

---

## Phase 7 — Admin Portal Enhancement

### 7.1 Admin Dashboard Improvements
- **Real-time job map** (`app/admin/ops/page.tsx`): Google Maps embed showing all active jobs as pins, cleaner locations (if GPS available), and property clusters. Color-coded by status.
- **Revenue forecasting**: Add a "Forecast" card to the finance dashboard with a 90-day projection chart based on recurring bookings and subscription rates. Use recharts.
- **Drag-and-drop scheduling calendar**: Upgrade `app/admin/calendar/_calendar.tsx` — allow dragging unassigned jobs onto cleaner slots, with auto-reassignment.
- **AI dispatch suggestions**: When creating a job, show ranked cleaners by: distance to property, past performance at that property, availability overlap. Use scoring algorithm in a new `lib/dispatch/scorer.ts`.
- **Smart alerts panel**: Pinned sidebar widget showing: jobs starting within 30 min with no cleaner checked in, laundry pickups overdue, low-stock properties, SLA warnings — all in one "urgent" feed.
- **Audit timeline**: Clickable timeline on every entity (Job, Property, Client) showing every status change with who + when.

### 7.2 Admin Job View Enhancements
- **Files to edit**: `app/admin/jobs/[id]/page.tsx`
- Tabs: Overview | Laundry | Costs | Reports | Timeline | Communications
- Laundry tab: linked laundry tasks with photo carousel
- Costs tab: base + extras + adjustments + GST breakdown with editable line items
- Reports tab: embedded HTML report preview + PDF download
- Timeline tab: full audit log of every action on the job
- Communications tab: all emails/SMS sent related to this job

### 7.3 Admin Client View
- **File**: `components/admin/client-detail-workspace.tsx`
- Add "Property Health" score per property (based on recent job QA scores)
- Add client lifetime value stat
- Add churn risk indicator (based on days since last job)

---

## Phase 8 — Advanced Client Portal Features

### 8.1 Live Job Tracking
- **New page**: `app/client/jobs/[id]/track/page.tsx`
- When a job is `IN_PROGRESS`, show a live status page:
  - Cleaner name + photo
  - Estimated completion time (start time + average job duration)
  - Real-time status updates via SSE (`/api/client/jobs/[id]/events`)
  - Map showing property location (static Google Maps embed)
- Push notification (PWA) when job starts + when report is ready

### 8.2 In-App Messaging
- **New section** in `app/client/messages/page.tsx` — currently exists but enhance:
  - Thread view per job (not per cleaner)
  - Message read receipts
  - File/photo attachments
  - Admin/ops team read receipts visible to client
  - "Mark resolved" button

### 8.3 Subscription Management
- **New page**: `app/client/subscription/page.tsx`
- Show current plan, next billing date, usage this month
- Pause plan (with reason) → creates admin approval task
- Upgrade/downgrade plan → triggers quote update flow
- Cancel plan → multi-step confirmation with retention offer

### 8.4 NPS / Review Flow
- After job report is shared, send `cleaningReportShared` email with NPS link
- New public page: `/rate/[token]` → star rating + comment → saves to `JobReview` model (new Prisma model)
- Admin sees reviews on job detail + client profile
- Top reviews surfaced as testimonials on public home page (admin-controllable)

### 8.5 Client Portal Calendar Upgrades
- **Multiple views**: Month / Week / 3-Day / Agenda — default selectable in settings
- **iCal sync**: Client can link their own Google Calendar / Apple Calendar via iCal export URL
- **Block dates**: Client can request "no-clean" blocks for specific dates
- **Rebooking**: Click a past job → "Rebook this" button pre-fills new booking wizard

---

## Phase 9 — Advanced Cleaner Portal Features

### 9.1 Cleaner Dashboard Upgrades
- **Earnings chart**: Weekly earnings bar chart for last 8 weeks (using pay request + invoice data)
- **Performance stats**: Average QA score, on-time rate, client satisfaction (from NPS)
- **Top properties badge**: "You've cleaned [Property] 10 times" recognition cards
- **Streak tracker**: "5 jobs this week — keep it up!" motivational widget

### 9.2 Navigation to Job
- On job card and job detail page: "Navigate" button opens Google Maps directions to property address via deep link: `https://www.google.com/maps/dir/?api=1&destination=ADDRESS`
- Also show Apple Maps link on iOS (user-agent detection)

### 9.3 Offline Mode (PWA)
- Add `next-pwa` or equivalent service worker configuration
- Cache: job list page, job detail pages for today's jobs, form templates
- Queue form submissions when offline → auto-sync when back online
- Show "Offline — changes will sync" banner

### 9.4 Cleaner Gamification
- **Monthly leaderboard** in Team Hub (`app/cleaner/hub/page.tsx`):
  - Top 3 cleaners by jobs completed, QA score, on-time rate
  - Opt-out toggle in cleaner settings
- **Milestone badges**: 10 jobs, 50 jobs, 100 jobs; First deep clean; Perfect QA month
- Badges visible on cleaner profile (admin + cleaner sees them)
- Badge model: `CleanerBadge` in Prisma (type, earnedAt, cleanerId)

### 9.5 Availability Upgrades
- **Recurring availability**: Set "Every Monday/Wednesday 8am-4pm" not just ad-hoc blocks
- **Blackout dates**: Mark holidays, unavailable weeks
- **Availability visible to admin**: Dispatch page shows cleaner availability overlay on calendar
- **Preferred areas**: Cleaner selects preferred suburbs → admin dispatch suggests cleaner for nearby jobs

---

## Phase 10 — Advanced Laundry Portal Features

### 10.1 Kanban View
- New view mode: Kanban board with columns: `Awaiting Pickup | Picked Up | At Laundry | Ready for Dropoff | Completed`
- Each card: property name, job date, bag count, photo thumbnail
- Drag card between columns to update status
- Persisted in `localStorage` as preferred view

### 10.2 Barcode / QR Label Printing
- New button on laundry task: "Print Label"
- Generates a PDF label (via browser print) with: QR code of task ID, property name, date, bag count
- Cleaner scans QR on pickup → auto-links to task

### 10.3 Route Optimisation (Multi-Pickup Days)
- When laundry worker has 3+ pickups in one day: "Optimise Route" button
- Calls Google Maps Directions API with waypoints (all pickup addresses) → returns optimal order
- Displays as step-by-step list with total drive time estimate

### 10.4 Supplier Invoice Reconciliation
- New sub-page: `app/laundry/invoices/reconcile/page.tsx`
- Upload supplier invoice (PDF) → parse total manually or via input
- Match against completed laundry tasks in the billing period
- Show variance: "You processed $X in tasks, supplier billed $Y — $Z difference"
- Flag discrepancies for admin review

### 10.5 Advanced Calendar (Laundry)
- Month calendar showing: pickup pins (blue), dropoff pins (green)
- Click day → see all tasks for that day in a side panel
- Filter by: property, status, supplier

---

## Phase 11 — Public Site Advanced Features

### 11.1 Live Chat
- Integrate **Crisp** (free tier) or **Tidio** chat widget
- New component: `components/public/live-chat.tsx` wrapping the chat script
- Injected in `public-site-shell.tsx` footer area
- Admin-controlled toggle in website settings

### 11.2 Before/After Photo Slider
- New component: `components/public/before-after-slider.tsx`
- CSS-only drag slider revealing before/after images
- Used on services pages and home page
- Admin can set before/after image URLs per service in website editor

### 11.3 Neighbourhood Pricing Map
- New page: `app/(public)/pricing-map/page.tsx`
- Google Maps embed with suburb polygons
- Color intensity = average pricing for that suburb
- Click suburb → see typical price range for general clean
- Data sourced from anonymised completed job pricing

### 11.4 Review Widgets
- Embed Google Business Reviews via Google Places API
- Or embed Trustpilot widget (script inject)
- New component: `components/public/review-carousel.tsx`
- Rotating carousel on home page testimonials section
- Admin can also manually curate reviews in website editor

### 11.5 Exit-Intent Popup
- New component: `components/public/exit-intent-popup.tsx`
- Triggers on mouse leaving viewport upward (desktop) or after 45s idle (mobile)
- Shows: "Before you go — get 10% off your first clean" + promo code + CTA
- Promo code pulled from active campaigns via `/api/public/active-campaign`
- Shown once per session (localStorage flag)

### 11.6 SEO Technical Improvements
- Add `sitemap.xml` generation: `app/sitemap.ts` listing all public pages + blog slugs
- Add `robots.txt`: `app/robots.ts`
- Add Open Graph images: `app/(public)/opengraph-image.tsx` per page
- Add structured data (JSON-LD) for LocalBusiness on home page
- Add FAQ structured data on FAQ page
- Add Article structured data on each blog post

### 11.7 Suburb Landing Pages (Already exists: `app/(public)/cleaning/[suburb]/page.tsx`)
- Expand to 30+ Sydney suburbs with unique content per page
- Each page: H1 with suburb name, local stats, testimonial, service list, CTA
- Auto-generated from a suburb config array → massive SEO surface area

---

## Phase 12 — Platform-Wide Infrastructure Improvements

### 12.1 PWA (Progressive Web App)
- Add `manifest.json` with sNeek branding (icon, colors, name)
- Service worker for offline caching of portal pages
- "Add to Home Screen" prompt for cleaners and laundry workers
- Push notification registration for all portals
- File: `public/manifest.json`, `app/sw.ts` (or use next-pwa)

### 12.2 Notification Centre (All Portals)
- New: bell icon in every portal sidebar → slide-out notification drawer
- Groups notifications by: Today / This week / Older
- Mark all read / mark individual read
- Deep-link from notification to relevant page (job, case, invoice, etc.)
- Unread count badge on sidebar bell

### 12.3 Global Search (Admin)
- New: ⌘K command palette in admin portal
- Searches: clients, properties, jobs, cleaners by name / address / job number
- Keyboard shortcut: `Cmd+K` / `Ctrl+K`
- Results show type badges (Job / Client / Property) with quick-action links
- File: `components/admin/command-palette.tsx`

### 12.4 Audit Log Improvements
- Every entity change (job status, invoice, settings) logs to a `AuditLog` Prisma model
- Viewable in admin settings (`components/admin/settings-audit-log.tsx` — already exists, enhance it)
- Filter by: user, entity type, date range, action type
- Export to CSV

### 12.5 Multi-Currency / Timezone Support
- Currently hardcoded to AUD and Australia/Sydney
- Add `currency` and `timezone` fields to AppSettings
- All price formatting goes through a `formatCurrency(amount, currency)` utility
- All date display goes through a `formatInTz(date, timezone)` utility
- Both already partially exist — centralise usage

### 12.6 API Rate Limiting & Security
- Add rate limiting to public-facing API routes (`/api/jobs/route`, `/api/laundry/*`)
- Use `@upstash/ratelimit` or in-memory LRU for dev
- CSRF protection audit on all mutation routes
- Add `Content-Security-Policy` headers in `next.config.js`

---

## Phase 13 — Full Admin Portal Redesign

### 13.1 Admin Shell & Navigation
Current admin uses `components/admin/sidebar.tsx` + `components/admin/header.tsx`.

**New sidebar design** (matching portal redesign style):
- Collapsible sidebar (240px ↔ 64px icon-only)
- Grouped nav sections with labels:
  - **Operations**: Dashboard, Jobs, Calendar, Dispatch/Ops Map
  - **People**: Clients, Cleaners, Properties, Users
  - **Finance**: Finance, Invoices, Pay Adjustments, Pricebook
  - **Services**: Quotes, Forms, Inventory, Shopping, Stock Runs
  - **Laundry**: Laundry Jobs, Suppliers, Delivery Profiles
  - **Comms**: Messages, Notifications, Marketing, Campaigns
  - **Platform**: Settings, Integrations, Audit Log, Intelligence
- Notification badge on nav items (e.g. "3 unassigned jobs", "2 pending approvals")
- User avatar + role badge at bottom
- Quick-action fab button: "+ New Job | + New Quote | + New Client"

**Files to edit**:
- `components/admin/sidebar.tsx` — complete rewrite
- `components/admin/header.tsx` — simplify to breadcrumb + search bar + notification bell
- `app/admin/layout.tsx` — update to use new sidebar

### 13.2 Admin Dashboard (`app/admin/page.tsx`)
New layout — **command centre design**:

```
┌─────────────────────────────────────────────────────────────┐
│  TODAY AT A GLANCE                                          │
│  [Jobs Today] [In Progress] [Unassigned] [SLA Warnings]    │
├──────────────────────────────┬──────────────────────────────┤
│  LIVE JOBS FEED (left)       │  UPCOMING (right)           │
│  Real-time list of           │  Next 48h job timeline      │
│  in-progress jobs            │  with cleaner assignments   │
│  - status updates            │                             │
│  - cleaner check-in time     │                             │
├──────────────────────────────┴──────────────────────────────┤
│  REVENUE THIS WEEK  │  QA SCORES  │  LAUNDRY STATUS        │
│  [sparkline chart]  │  [avg bar]  │  [pending/in-flight]   │
├─────────────────────────────────────────────────────────────┤
│  IMMEDIATE ATTENTION PANEL (collapsible)                    │
│  Approvals | Disputes | Low stock | SLA overdue            │
└─────────────────────────────────────────────────────────────┘
```

- Live feed uses SSE or SWR polling every 30s (not websocket — simpler)
- All stat cards are clickable → navigate to filtered list page
- "Quick create" buttons in attention panel

### 13.3 Admin Jobs Page (`app/admin/jobs/page.tsx`)
- **Kanban view** (new): columns = Unassigned | Assigned | In Progress | Completed | Disputed
  - Drag card between columns to update status
  - Filter by date range, cleaner, property, service type
- **Table view** (existing, enhanced): sortable columns, bulk actions (assign, export, archive)
- **Map view**: pins on Google Maps per job, click to see job card popup
- **Default view** selectable in admin settings
- Persistent filter state in URL params (so links are shareable)

### 13.4 Admin Job Detail (`app/admin/jobs/[id]/page.tsx`)
Redesign to tabbed layout:
- **Overview**: status timeline, job info, assigned cleaner, property details
- **Tasks/Checklist**: form responses with room-by-room breakdown + photos
- **Laundry**: linked laundry tasks, photos, pickup/dropoff times, cost
- **Costs**: all charges — base, extras, adjustments, GST, cleaner pay vs client invoice comparison
- **Reports**: embedded HTML report preview, PDF download, visibility toggle
- **Communications**: all emails/SMS sent for this job with timestamps
- **Timeline**: full audit log — every state change, who did it, when
- **Notes**: internal admin-only notes (not visible to client/cleaner)

### 13.5 Admin Client Detail
**File**: `components/admin/client-detail-workspace.tsx`
New tabs:
- **Overview**: contact details, portal access, lifetime value, churn risk score
- **Properties**: all properties with health score (avg QA last 90 days)
- **Jobs**: job history with filters + status chips
- **Finance**: invoices issued, payments received, outstanding balance
- **Laundry**: all laundry activity
- **Documents**: reports, quotes, invoices as downloadable PDFs
- **Reviews**: NPS scores and comments from this client
- **Notes**: internal CRM notes with timestamps

### 13.6 Admin Calendar (`app/admin/calendar/_calendar.tsx`)
Upgrade FullCalendar integration:
- **Views**: Month / Week / Day / Cleaner-grouped (timeline)
- **Cleaner timeline view**: rows = cleaners, columns = time slots — shows who has what job when
- **Drag-to-assign**: drag unassigned job from sidebar onto cleaner's time slot
- **iCal overlays**: show Hospitable reservations as translucent background events
- **Conflict detection**: highlight overlapping jobs on same cleaner in red
- **Filters**: by cleaner, property, job type, status
- **Default view** configurable in admin settings

### 13.7 Admin Operations / Dispatch Map
**File**: `app/admin/ops/page.tsx`
- Full Google Maps embed showing:
  - All today's jobs as pins (color by status: grey=unassigned, blue=assigned, green=in-progress, teal=done)
  - Cleaner last known locations (if GPS from mobile check-in)
  - Property clusters on zoom-out
- Right panel: "Unassigned jobs" list — click to assign to nearest available cleaner
- Auto-assign button: runs `lib/dispatch/scorer.ts` algorithm for all unassigned jobs at once
- Filter by suburb, job type, time range

### 13.8 Admin Finance Dashboard
**File**: `app/admin/finance/page.tsx`
New sections:
- **P&L Summary**: Revenue vs cleaner payroll vs expenses this month/quarter
- **Cash flow chart**: 12-month bar chart (invoiced vs received)
- **Cleaner payroll summary**: total owing to each cleaner this period, one-click pay all
- **Outstanding invoices**: client invoices unpaid > 7/14/30 days with send-reminder button
- **Job profitability**: per-job margin (client rate minus cleaner cost) — sortable table

### 13.9 Admin Intelligence / Analytics
**File**: `app/admin/intelligence/` (new or enhance existing)
- **Service mix**: pie chart — what % of jobs are each service type
- **Suburb heat map**: where are most jobs concentrated (Google Maps heatmap layer)
- **Cleaner performance matrix**: QA score vs on-time rate scatterplot
- **Client retention**: cohort analysis — what % of clients from each month still book
- **Seasonal trends**: jobs per week/month over last 2 years
- Export all reports to CSV

### 13.10 Admin Settings Enhancement
**File**: `components/admin/settings-editor.tsx`
Add new settings tabs:
- **Portal Themes**: Choose default theme (dark/light/public) for each portal
- **Announcement Bar**: Enable/disable, edit promo message, choose theme (already in website editor — move here too)
- **Feature Flags**: Toggle features per portal (already exists via visibility settings — improve UI)
- **Integrations**: iCal, Google Maps API key, Resend config, S3 config — all in one place
- **Automation**: Configure auto-assign rules, reminder timings, laundry planner thresholds

---

## Phase 14 — Customer Booking & Self-Service Improvements

### 14.1 Client Self-Service Booking
**Existing**: `app/client/booking/page.tsx` + `components/client/booking-wizard.tsx`
**Enhance**:
- Step 1: Select property (dropdown from existing properties) OR add new address (Google Maps autocomplete)
- Step 2: Select service type (visual cards with price range)
- Step 3: Pick date + time (calendar showing available slots based on cleaner availability)
- Step 4: Add special instructions, access notes, photos
- Step 5: Review + confirm → creates a Quote that admin converts to Job
- Show "estimated completion time" based on service type
- Allow booking recurring services (every 1/2/4 weeks)

### 14.2 Client Rescheduling
- On job detail: "Request reschedule" button (before job starts)
- Client picks new date from availability calendar
- Creates reschedule request → admin approves/rejects
- Client gets email on decision
- Full API: `POST /api/client/jobs/[id]/reschedule-request` (already exists in cleaner — port to client)

### 14.3 Referral Program
**File**: `app/client/referrals/page.tsx` (already exists — enhance)
- Unique referral link per client
- Show: referrals sent / referrals converted / credits earned
- Auto-apply credit on next invoice (new field: `referralCredit` on Invoice model)
- Share via: copy link, WhatsApp deep-link, email share
- Admin can configure referral credit amount in settings

### 14.4 Gift Cards / Vouchers
- New admin page: `app/admin/vouchers/page.tsx`
- Create voucher codes with: fixed $ value, % off, single-use vs multi-use, expiry
- Client enters code at booking (step 5 of wizard)
- Deducted from invoice total automatically
- Reuse existing campaign/discount code infrastructure in `lib/pricing/calculator.ts`

### 14.5 Subscription / Recurring Service Management
**New client page**: `app/client/subscription/page.tsx`
- Show active recurring schedule (weekly/fortnightly/monthly clean)
- Pause scheduling for date range (e.g., "I'll be away Jan 15–Jan 30")
- Change frequency
- Cancel with multi-step confirmation
- All changes create admin notification for approval
- Backed by a `RecurringSchedule` model (or use existing job recurrence fields)

---

## Phase 15 — Marketing & Growth Features

### 15.1 Marketing Automation (Email Sequences)
**File**: `lib/marketing/email-campaigns.ts` (already exists — extend)
New automated sequences:
- **Win-back**: Client with no booking in 60 days → send "We miss you" email with discount
- **Post-clean follow-up**: 24h after job completed → send NPS survey email
- **Onboarding sequence**: New client signs up → Day 1 welcome, Day 3 how-it-works, Day 7 first booking prompt
- **Seasonal campaigns**: Spring clean reminder (Sep), Christmas clean reminder (Nov)
- All triggered by pg-boss workers in `workers/boss.ts`

### 15.2 SMS Marketing (Opt-in)
- Client can opt in to SMS in notification preferences
- Short-code SMS for: job reminders (day before), payment receipts, NPS surveys
- Admin can send broadcast SMS to opted-in clients from Marketing console
- Uses existing `SmsProvider` infrastructure in `lib/settings.ts`

### 15.3 Admin Marketing Console Enhancement
**File**: `components/admin/marketing-console.tsx`
New features:
- **Audience segmentation**: filter clients by: suburb, service type, last booking date, spend
- **Campaign preview**: see email before sending, send test to self
- **Send history**: list of campaigns sent with open rates (if trackable via pixel)
- **Template library**: save and reuse email templates
- **Scheduled send**: set a future send time for campaigns

### 15.4 Google Business Profile Integration
- New admin section: link Google Business Profile
- Auto-request Google review after job completion (opt-in per client)
- Show Google rating on public site hero section
- Pull Google Q&A into public FAQ page (admin-curated selection)

---

## Phase 16 — Mobile / Field Experience

### 16.1 Cleaner Mobile Optimisation
The cleaner portal is primarily used on phones. Specific mobile improvements:
- **Bottom tab bar**: Dashboard | Jobs | Calendar | Hub — persistent on mobile
- **Swipe gestures**: swipe job card right = mark started, left = report issue
- **Large tap targets**: all action buttons min 48px height
- **Camera shortcuts**: long-press photo area → camera opens directly
- **Haptic feedback**: success/error vibrations on form submit (via `navigator.vibrate`)
- **Full-screen job card**: on mobile, job detail fills screen with floating action button

### 16.2 Laundry Mobile Optimisation
- QR scanner accessible immediately from bottom nav (camera icon)
- Task cards large enough to tap status chips without zooming
- Swipe-to-update status on task cards
- Photo capture using device camera with compression before upload

### 16.3 App-like Loading Experience
- Splash screen using `app/loading.tsx` with animated sNeek logo
- Per-page skeleton loaders matching actual page layout (not generic spinner)
- Optimistic updates on status changes (show result before API confirms)
- Toast notifications instead of page reloads for form submissions

---

## Phase 17 — Integrations

### 17.1 Accounting Integration (Xero / QuickBooks)
- New settings page: `app/admin/settings/integrations/accounting/page.tsx`
- OAuth flow to connect Xero account
- Auto-sync: create Xero invoice when client invoice is issued
- Auto-sync: create Xero expense when cleaner pay request is approved
- Reconciliation report: invoices in sNeek vs Xero — flag mismatches
- Files: `lib/integrations/xero.ts` (new)

### 17.2 Payment Processing (Stripe)
- New: client can pay invoice directly from client portal
- Stripe Checkout session created via `/api/client/invoices/[id]/pay`
- Webhook `/api/webhooks/stripe` marks invoice as paid + sends receipt email
- Admin can also send "Pay now" link via email
- Store `stripeCustomerId` on Client model
- File: `lib/payments/stripe.ts` (new)
- Already has `components/client/pay-now-button.tsx` — wire it up to Stripe

### 17.3 Background Check Integration
- New admin section on cleaner profile: "Background Check"
- Integrate with **Checked** (Australian background check provider) or equivalent
- Admin initiates check → email sent to cleaner → result returned via webhook
- Status badge on cleaner profile: Pending / Cleared / Issues
- Block job assignment if cleaner check not cleared (configurable toggle)

### 17.4 WhatsApp Business API
- Already has WhatsApp icon in public site footer
- Extend: send job confirmations and reminders via WhatsApp (opt-in)
- Client can reply to WhatsApp message → creates in-app message thread
- Use Meta Cloud API or 360dialog
- File: `lib/notifications/whatsapp.ts` (new)

### 17.5 Zapier / Make Webhook
- New: "Webhooks" section in admin integrations
- Admin can configure outgoing webhooks for events: job.created, job.completed, invoice.issued, etc.
- Each event fires a POST to configured URL with JSON payload
- Enables client to connect sNeek to any tool (Slack, Monday.com, Google Sheets, etc.)
- File: `lib/integrations/webhooks.ts` (new)

---

## Phase 18 — Performance, SEO & Quality

### 18.1 Image Optimization
- All public page images: use Next.js `<Image>` component (not bare `<img>`)
- Add `width`/`height` to prevent CLS (Cumulative Layout Shift)
- Lazy load images below the fold
- Add `placeholder="blur"` for key hero images
- WebP format via Next.js image optimization

### 18.2 Core Web Vitals
- Audit LCP (Largest Contentful Paint): ensure hero image loads < 2.5s
- Audit CLS: all images have explicit dimensions, no layout shift from dynamic content
- Audit FID/INP: debounce heavy form handlers, defer non-critical scripts
- Add `<link rel="preconnect">` for Google Fonts, Maps API, Resend in `app/layout.tsx`

### 18.3 Error Monitoring
- Integrate **Sentry** for error tracking
- File: `lib/monitoring/sentry.ts`
- Capture: unhandled API errors, client-side React errors, failed DB queries
- Alert admin via email on critical errors (using existing Resend setup)

### 18.4 Testing Strategy
- **Unit tests** (`__tests__/`): pricing calculator, laundry planner, scoring algorithm
- **API tests**: key API routes (jobs CRUD, laundry status transitions) using `@jest/globals`
- **E2E tests** (`playwright/`): 
  - Public: visit home → fill quote form → submit
  - Client: log in → view job → download report
  - Cleaner: log in → start job → submit form
- Run on GitHub Actions on every push to `main`

---

## Updated Verification Steps (All Phases)

1. **Portals dark theme**: Client/Cleaner/Laundry default to dark → toggle to light in Settings → Appearance → instant switch.
2. **Laundry flicker**: 100+ tasks → smooth scroll, completed auto-collapsed.
3. **Announcement bar**: Teal bar visible on all public pages.
4. **Public page layouts**: Why Us / Compare / Blog / FAQ — centered content, no stretch.
5. **Quote full-screen**: `/quote` fills viewport with constrained centered wizard.
6. **Client job detail**: Jobs → click → rich view with laundry/costs/report/timeline tabs.
7. **Cleaner dashboard**: Next job card prominent, navigation deep-link works.
8. **Admin dispatch AI**: Creating job → ranked cleaner suggestions shown.
9. **Email templates**: All 30+ templates render cleanly in Gmail/Outlook.
10. **iCal batch email**: Sync all properties → single digest email, not N emails.
11. **Blog posts**: `/blog` shows 15 SEO posts with images.
12. **Google Maps autocomplete**: Address fields across all portals show Places suggestions.
13. **NPS flow**: After job completion → email → rate page → star rating saved.
14. **PWA**: "Add to Home Screen" prompt on mobile for cleaner portal.
15. **Sitemap**: `GET /sitemap.xml` returns all public pages + blog slugs.

