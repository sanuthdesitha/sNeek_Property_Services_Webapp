# sNeek Property Services — UI Audit & Redesign Brief

> **Purpose:** Complete inventory of every page in the deployed Next.js app, structured to feed a UI redesign workflow. Each entry describes role access, purpose, primary data, layout, interactions, forms, empty states, modals, and connected APIs.
>
> **Scope:** 125 pages across 5 surfaces — Admin (56), Client (22), Cleaner (16), Laundry (6), Public marketing (17), Auth & onboarding (8).
>
> **Source of truth:** Generated from `app/<route>/page.tsx` files in this repo. If a page changes, regenerate.

---

## Global Context

### Roles
- **ADMIN** — Full system access. Owner / co-founder.
- **OPS_MANAGER** — Day-to-day operations. Same access as ADMIN for most pages; some sensitive admin-only screens excluded (user creation, payment gateways).
- **CLEANER** — Mobile-first field staff. Sees only their own jobs, pay, schedule.
- **CLIENT** — Property owner. Sees only their own properties, jobs, reports, finance.
- **LAUNDRY** — Third-party laundry team. Sees only laundry tasks and invoices.

### Shared design primitives
- **Tech stack:** Next.js 14 App Router, TypeScript, Tailwind, shadcn/ui, Radix primitives, FullCalendar, Recharts, lucide-react icons, react-hook-form + zod
- **Authentication:** NextAuth (JWT credentials provider). All authenticated pages are gated by middleware role checks.
- **Layouts:** Each portal has its own layout with a sidebar/topbar. Cleaner portal is mobile-first; admin portal is desktop-first.
- **Empty states:** Most lists show plain-text empty messages with optional "Create first…" CTAs.
- **Confirmations:** Destructive actions use a two-step confirm dialog (often requiring an admin PIN or password).
- **Toasts:** Save/error feedback via radix toast.
- **Timezone:** All dates rendered in `Australia/Sydney`.
- **Currency:** AUD throughout.

### Cross-cutting features
- **Visibility flags per client** — Admin can hide entire sections of the client portal (Reports, Inventory, Laundry, Finance Details, etc.). Many client pages render conditionally.
- **iCal sync** — Property pages and admin integrations show sync status from Hospitable / Airbnb iCal feeds.
- **S3-backed media** — Photos, videos, signatures, PDFs all live in S3 (presigned uploads).
- **pg-boss workers** — Background jobs handle iCal sync, reminders, laundry planning, stock alerts, report generation.

---

## Table of Contents

- [Admin Portal](#admin-portal)
  - [Operations](#admin--operations) — dashboard, approvals, calendar, cases, jobs, ops, route map, reports, notifications, messages
  - [Entities](#admin--entities) — clients, properties, users, suppliers, delivery profiles, profile
  - [Finance & Commerce](#admin--finance--commerce) — quotes, invoices, finance, payroll, adjustments, intelligence, scale
  - [Systems & Operations](#admin--systems--inventory--marketing--onboarding) — settings, integrations, forms, inventory, shopping, laundry, marketing, website, workforce, onboarding
- [Cleaner Portal](#cleaner-portal)
- [Client Portal](#client-portal)
- [Laundry Portal](#laundry-portal)
- [Public Marketing Site](#public-marketing-site)
- [Auth & Onboarding](#auth--onboarding)

---

# Admin Portal

## Admin — Operations

### `/admin` — Operations Dashboard

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Central command center showing daily dispatch summary, KPIs, immediate alerts, and shortcuts to critical operational areas. Displays today's jobs, unassigned work, flagged items, and pending approvals at a glance.

**Primary data displayed:**
- Live stat cards: today's jobs, unassigned, laundry flags, low stock, SLA due soon/overdue
- Approvals banner with counts by type (continuations, timing, pay, clients, laundry)
- Immediate Attention panel for critical blockers
- Dashboard graphs: job status breakdown, 7-day workload forecast, job type distribution
- Pause/Continuation approvals list (up to 5)
- Recent jobs list (today, upcoming, and past)

**Page sections / layout (top to bottom):**
1. Header with timestamp and description
2. Pending approvals notification banner (if count > 0)
3. 6-column stat card grid (alerts highlight on threshold)
4. Immediate Attention panel with critical items
5. 3-chart widget section (job status, weekly load, job type breakdown)
6. Pause/Continuation approvals card (if items pending)
7. Recent jobs list

**Key interactions:**
- Click "Review all" banner to go to `/admin/approvals`
- Click stat cards to filter `/admin/jobs` by status
- Continuation request rows link to job detail page
- Click recent job rows to open job detail

**Connected APIs:** `GET /api/admin/dashboard-stats`, `GET /api/admin/immediate-attention`, `GET /api/jobs/continuation-requests`, `GET /api/jobs/early-checkout-requests`, `GET /api/admin/client-approvals`

---

### `/admin/approvals` — Approvals Centre

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Single inbox for all pending approvals across jobs, pay, laundry, timing, and client sign-offs. Approve, decline, or forward requests with minimal friction.

**Primary data displayed:**
- Tabbed interface: continuations, timing requests, pay adjustments, time adjustments, client approvals, flagged laundry, reschedule requests
- Each tab shows count of pending items
- Per-row details: job/cleaner name, property, dates, reason, status badge
- Pay adjustments include requested/approved amounts and client approval status
- Laundry flags show bag location and notes

**Page sections / layout (top to bottom):**
1. Header with total pending count and Refresh button
2. Tab bar with counts per category
3. Content area with cards for each approval item
4. Empty state per tab when no items

**Key interactions:**
- Tab switching filters view
- Approve/Decline/Reject buttons on each card
- For pay adjustments: editable dollar amount field before approve
- "Send to client" button for pay requests (triggers client approval request)
- View job link on most cards

**Forms / inputs:**
- Pay adjustment approval amount (number input, defaults to primary display amount)
- Clock adjustment: none (approve/reject only)

**Empty / loading / error states:** Empty state per tab with "No pending items in this category" message, loading spinner on first load

**Connected APIs:** `GET /api/admin/all-approvals`, `PATCH /api/admin/job-early-checkouts/{id}`, `PATCH /api/admin/pay-adjustments/{id}`, `POST /api/admin/pay-adjustments/{id}/send-to-client`, `PATCH /api/admin/time-adjustments/{id}`, `PATCH /api/admin/client-approvals/{id}`, `PATCH /api/admin/job-tasks/{id}`

---

### `/admin/calendar` — Dispatch Calendar

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Multi-view calendar (month, week, day) for visualizing job schedules and laundry pickups. Detects workload clashes and allows quick job navigation.

**Primary data displayed:**
- FullCalendar-powered job event grid
- Laundry pickup/dropoff schedule (separate tab)
- Color-coded by job type or status
- Event cards show property name, cleaner assigned

**Page sections / layout (top to bottom):**
1. Info card with calendar purpose and view options
2. Tab bar: Jobs Calendar | Laundry Schedule
3. Calendar component (month/week/day toggles in FullCalendar)

**Key interactions:**
- Click job event to drill into `/admin/jobs/{id}`
- Calendar view switcher (month/week/day)
- Settings button opens dialog to set default open view (jobs or laundry)
- Settings persisted to localStorage

**Empty / loading / error states:** "Loading calendar…" while FullCalendar renders (client-side dynamic import)

---

### `/admin/cases` — Cases Workspace

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Issue ticket management for customer disputes, damage claims, and operational issues. Triage, assign, and track resolution.

**Primary data displayed:** Delegated to `<AdminCasesWorkspace />` component (case list with filters, statuses, attachments, replies, assignment).

**Connected APIs:** Issue ticket CRUD and filtering endpoints under `/api/admin/issues`.

---

### `/admin/issues` — Issues (Alias)

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Alias to `/admin/cases` page — appears to be the same workspace.

---

### `/admin/jobs` — Jobs List and Board

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Universal job management hub with list and Kanban views. Filter, search, assign, perform QA reviews, and bulk actions on jobs across all statuses.

**Primary data displayed:**
- Paginated job list (50 per page) or Kanban board (columns by job status)
- Columns: job number, property, suburb, client, job type, status, cleaner, scheduled date
- Kanban: status columns with job cards (preview first 12)
- QA queue indicator, continuation pending badges, reschedule request badges
- Bulk selection checkboxes

**Page sections / layout (top to bottom):**
1. Header with quick-filter buttons (Active/Completed tabs)
2. Toolbar: View toggle (List/Kanban), Filter button (shows active filter count), Create Job button
3. Filter panel (collapsible): status, search, cleaner, job type, client, property, date range, invoiced
4. List or Kanban view with pagination
5. Bulk action bar (if items selected): bulk assign, bulk status change
6. QA review section (if QA_REVIEW jobs visible): batch score input, select multiple, submit

**Key interactions:**
- Tab switchers: Active (UNASSIGNED, OFFERED, ASSIGNED, EN_ROUTE, IN_PROGRESS, PAUSED, WAITING_CONTINUATION_APPROVAL, SUBMITTED, QA_REVIEW) vs Completed (COMPLETED, INVOICED)
- Filter button expands/collapses filters panel
- Status filter quick-links from header
- View toggle: List ↔ Kanban (persisted to localStorage)
- Click job row to open `/admin/jobs/{id}`
- Quick assign dialog (click UserPlus icon) to assign multiple cleaners
- QA Review tab: select jobs, input score (0–100) and notes, submit batch or individual
- Delete job (two-step confirm)
- Bulk assign multiple jobs to one cleaner
- Bulk status change

**Forms / inputs:**
- Search box (property/client/job number)
- Cleaner name filter, Job type, Client, Property dropdowns
- Date range (from/to), Invoiced filter (all/yes/no)
- QA score input (0–100, default 90), QA notes textarea
- Quick assign cleaner selector, Bulk cleaner selector, Bulk status selector

**Empty / loading / error states:** "Loading…" while fetching, "No jobs found" when filter yields zero results

**Connected APIs:** `GET /api/jobs` (with statusGroup, pagination, filters), `POST /api/admin/jobs` (create), `DELETE /api/admin/jobs/{id}`, `POST /api/admin/jobs/{id}/qa`, `POST /api/admin/jobs/{id}/assign`, `GET /api/admin/job-continuations?status=PENDING`

---

### `/admin/jobs/new` — Create Job

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Form-driven job creation with optional property pre-selection via query param.

**Primary data displayed:** Delegated to `<NewJobForm />` component.

**Forms / inputs:** Job type, property selector, scheduled date, start/due times, cleaner assignment, special requests, internal notes, attachments.

**Connected APIs:** `POST /api/admin/jobs`

---

### `/admin/jobs/[id]` — Job Detail and Edit

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Comprehensive single-job view with multi-tab interface for editing details, reviewing submissions, managing approvals, and viewing history.

**Primary data displayed:**
- Job header with status badge, property, client, job type, scheduled date
- Assignment section with cleaner(s), contact, and reassignment capability
- Tabs for different job aspects (Overview, Submission, Approval, History, Media)
- Job metadata: start/due times, special requests, rules summary, attachments
- Cleaner submission form (if status = SUBMITTED)
- QA review controls
- Media gallery for job evidence

**Page sections / layout (top to bottom):**
1. Back button, Job header with status and key details
2. Action buttons: Assign, Notes, Send message, Edit, Delete
3. Tab navigation
4. Tab content (varies by tab)

**Key interactions:**
- Reassign cleaner via dialog (UserPlus button)
- Edit job details (inline or modal)
- Submit QA review from tab
- View/download submission files
- Message cleaner or client
- Request continuation/timing adjustments
- Delete job (two-step confirm)
- View job history/timeline
- Media gallery expand/collapse

**Forms / inputs:** Job type, property, dates, times, special requests, internal notes, media uploads, cleaner messaging

**Connected APIs:** `GET /api/admin/jobs/{id}`, `PATCH /api/admin/jobs/{id}`, `DELETE /api/admin/jobs/{id}`, `POST /api/admin/jobs/{id}/assign`, `POST /api/admin/jobs/{id}/qa`, `POST /api/admin/jobs/{id}/message`

---

### `/admin/jobs/route-map` — Cleaner Route Map

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Daily route planner showing cleaner stop order, travel estimates, and one-click Google Maps links for optimized dispatch coordination.

**Primary data displayed:**
- Route cards per cleaner: name, email, stop count, total estimated drive time
- Per-stop details: property name, address, suburb, job type, start/due times, travel estimate from previous stop
- Stop sequence numbers, job status badges per stop
- Google Maps links (multi-stop route and individual property)

**Page sections / layout (top to bottom):**
1. Header with date picker, Today/Tomorrow buttons, route board/live map switcher
2. Summary stats: selected date, number of cleaner routes, total assigned stops
3. Route cards grid (2-column on XL screens)
4. Per route: stops list with property details and map buttons

**Key interactions:**
- Date picker loads routes for selected date; Today/Tomorrow shortcuts
- Open Route button launches Google Maps with multi-stop route
- Copy Route URL button
- Open Job button per stop links to `/admin/jobs/{id}`
- Maps button per stop opens single property in Google Maps
- Link to `/admin/ops/map` for live field status

**Empty state:** "No assigned cleaner routes for this date" card

**Connected APIs:** `GET /api/ops/dispatch-plan/{date}`

---

### `/admin/ops` — Operations Hub

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Daily operations oversight combining dispatch blockers, QA backlog, leads pipeline, laundry exceptions, and compliance alerts in one dashboard. Quick-reference for morning dispatch and ongoing triage.

**Primary data displayed:**
- 4 summary stat cards: dispatch routes today, unassigned by tomorrow, laundry exceptions, expiring docs
- Dispatch blockers list: unassigned jobs + continuation approvals pending
- QA and cases list: jobs in QA_REVIEW + stale open/in-progress cases (48+ hrs old)
- New leads list (last 24h): quote requests
- Laundry exceptions: flagged/skipped pickups in next 48h
- Expiring documents: staff compliance docs expiring within 14 days
- Maps/routing quick links
- Immediate Attention panel

**Page sections / layout (top to bottom):**
1. Header with Open Route Map, Open Live Map, and Open Jobs buttons
2. 4-column stat card grid with drill-down buttons
3. Two-column grid: Dispatch Blockers | QA and Cases
4. Three-column grid: New Leads | Laundry Exceptions | Expiring Documents
5. LiveCleanerLayer component (real-time cleaner positions map)
6. Maps and Routing card with route map and live map links
7. Immediate Attention panel

**Key interactions:**
- Stat card buttons drill into specific views (job lists, laundry, workforce)
- Job/case rows link to `/admin/jobs/{id}` or `/admin/cases?jobId={id}`
- Lead rows link to `/admin/quotes`
- Laundry rows link to `/admin/laundry`
- Expiring doc rows link to `/admin/workforce`
- Open buttons navigate to route map or live map with date param

**Empty states:** "No dispatch blockers right now", "No QA or case backlog", "No new leads in the last 24 hours", etc.

**Connected APIs:** `GET /api/admin/immediate-attention`, `GET /api/ops/dispatch-plan/{date}`, `GET /api/jobs?status=UNASSIGNED&date=...`, `GET /api/jobs?status=QA_REVIEW`, `GET /api/quotes?limit=8`, `GET /api/admin/issues`, `GET /api/laundry/tasks`, `GET /api/admin/staff-documents`

---

### `/admin/ops/map` — Live Operations Map

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Real-time field view of active jobs with GPS proximity status, safety check-in tracking, and cleaner route links. Used during day-of operations for field hazard mitigation.

**Primary data displayed:**
- Date picker and Today/Tomorrow/Route Board toggles
- 3 summary cards: active jobs count, GPS near property count, pending safety check-ins count
- Cleaner route links section: multi-stop Google Maps URLs per route
- Safety and field status section: per-job GPS distance, safety check-in status, cleaner assignment
- Priority checks quick links (unassigned, continuations, cases)
- LiveCleanerLayer component

**Page sections / layout (top to bottom):**
1. Header with date picker, date picker buttons, route board switcher
2. 3-column stat card grid
3. Two-column grid: Cleaner Route Links | Safety and Field Status
4. Priority Checks quick-link card
5. LiveCleanerLayer component

**Key interactions:**
- Date picker loads jobs for selected date; Today/Tomorrow shortcuts
- Open Route button per route launches Google Maps; Copy URL button
- Open Job button per route/job links to `/admin/jobs/{id}`
- Maps button per job opens single property in Google Maps
- Safety and field status rows show GPS distance (badge color: secondary if <500m, warning if >500m)
- Safety pending badge (destructive) if safety check-in not completed but required
- Priority checks buttons filter jobs or open cases

**Empty states:** "No assigned routes for this date", "No active jobs for this date"

**Connected APIs:** `GET /api/ops/dispatch-plan/{date}`, `GET /api/jobs?scheduledDate={date}&status=...`

---

### `/admin/reports` — Reports Library

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Manage generated job completion reports (PDFs sent to clients). Control visibility, regenerate, delete, and download report files.

**Primary data displayed:**
- Paginated report list (25 per page): property name, client name, job type, scheduled date
- Badges: "Sent to client" (if sent), "Visible to client" (toggle state), "Cleaner visible/hidden" (toggle state)
- Per-report action buttons: Edit (link to submission tab), Download PDF, Regenerate, Delete

**Page sections / layout (top to bottom):**
1. Header with total count and Refresh button
2. Filter card: Search (property/client/job), Property dropdown, Client Visibility dropdown (all/visible/hidden), Sort dropdown (newest/service-date/oldest), Clear button
3. Report list with pagination controls (Previous/Next buttons and page indicator)

**Key interactions:**
- Search filters on property name, client, or job number (debounced 220ms)
- Property filter dropdown
- Visibility toggle switches client/cleaner report visibility
- Edit button links to `/admin/jobs/{jobId}?tab=submission`
- Download button fetches PDF via `/api/reports/{jobId}/download`
- Regenerate button regenerates PDF from submission (POST)
- Delete button opens two-step confirm
- Pagination Previous/Next navigation

**Forms / inputs:** Search text, property selector dropdown, visibility dropdown, sort dropdown

**Empty state:** "No reports yet. Reports are generated after cleaner submissions."

**Connected APIs:** `GET /api/admin/reports`, `POST /api/admin/reports/{jobId}/generate`, `PATCH /api/admin/reports/{jobId}/visibility`, `DELETE /api/admin/reports/{jobId}`, `GET /api/reports/{jobId}/download`

---

### `/admin/notifications` — Notifications Control Centre

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Configure global notification defaults, staff overrides, client preferences, and review notification delivery history.

**Primary data displayed:**
- Control center tab: global toggles (24h reminders, 2h reminders, tomorrow prep, stock alerts, admin summary, laundry auto-approve), time inputs, laundry horizon days, default delivery channels per category (web/email/sms matrix)
- Profile overrides tab: staff list (admin/ops, cleaners, laundry) with per-user notification preferences, client list with job update preferences
- Delivery log tab: notification history with status (Sent/Pending/Failed), channel, subject, timestamp, recipient email

**Page sections / layout (top to bottom):**
1. Header with Refresh and Clear Logs buttons
2. Tab bar: Control Center | Delivery Log
3. Control center content: Global toggles grid, time input grid, notification category matrix (9 categories × 3 channels)
4. Profile overrides: staff tabs (Admin/Ops, Cleaners, Laundry, Clients) with user/client lists and Edit buttons
5. Delivery log content: search, source/channel/status filters, notification rows, pagination

**Key interactions:**
- Control center toggles and time inputs save globally
- Edit button per staff user opens dialog for per-user notification preference overrides (9 categories × 3 channels)
- Edit button per client opens dialog for job update preferences (en route, job start, job complete toggles, preferred channel)
- Delivery log search, channel, and status filters
- Clear Logs button opens two-step confirm to delete all notification logs

**Forms / inputs:** Global toggles, time inputs (HH:MM), horizon days (1–120), 9×3 channel matrix, per-user/client preference matrices

**Empty / loading / error states:** "Loading notification control center…", "No admin or ops users found", "No notifications found" in delivery log

**Connected APIs:** `GET /api/admin/settings`, `GET /api/admin/users`, `GET /api/admin/clients`, `PATCH /api/admin/settings`, `GET/PUT /api/admin/users/{id}/notification-preferences`, `GET/PUT /api/admin/clients/{id}/notification-preferences`, `GET /api/admin/notifications/log`, `DELETE /api/admin/notifications/log`

---

### `/admin/messages` — Admin Messages Workspace

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Internal and external messaging interface (with cleaners, clients, staff). Conversation list + thread + compose.

**Primary data displayed:** Delegated to `<AdminMessagesWorkspace />` component.

**Connected APIs:** Message CRUD endpoints under `/api/admin/messages`.

---

## Admin — Entities

### `/admin/clients` — Clients List

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Display all active clients in a card grid. Quick-glance contact info, property count, and navigation to detail.

**Primary data displayed:**
- Client name with property count badge
- Email and phone (if available)
- Card-based grid layout (responsive: 2–3 columns)
- Total active client count in header

**Page sections / layout (top to bottom):**
1. Header with title, count, and "Add Client" button
2. Responsive grid of client cards (clickable, with hover effect)
3. Empty state with link to create first client

**Key interactions:**
- Click card to open client detail
- "Add Client" button → `/admin/clients/new`

**Connected APIs:** `GET /api/admin/clients`

---

### `/admin/clients/new` — Add Client

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Form for creating a new client account. Includes optional portal invite with customizable welcome message.

**Page sections / layout (top to bottom):**
1. Header with title, description, and back button
2. Card: Client Details form (name, email, phone, address, notes)
3. Optional: Checkbox to send portal invite with welcome note field
4. Submit button

**Forms / inputs:**
- Name (required, text)
- Email (optional, required if invite selected)
- Phone (optional, tel)
- Address (Google autocomplete)
- Notes (optional, textarea)
- Send Portal Invite (checkbox) — shows welcome note textarea when enabled
- Welcome Note (optional, conditional)

**Empty / loading / error states:** Validation: name required, email required if invite selected; toast notifications for success/error.

**Connected APIs:** `POST /api/admin/clients`

---

### `/admin/clients/[id]` — Client Detail

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Comprehensive single-client view showing contact info, related records (leads, quotes, cases, properties, jobs), and activity log.

**Primary data displayed:**
- Client name, email, phone, address, notes
- Property count and list with integration status badges
- Leads list (service type, estimate, status, date)
- Quotes list (status, total, validity)
- Cases list (title, type, status)
- Jobs (flattened from properties)
- Activity log (recent actions)

**Page sections / layout (top to bottom):**
1. Header with back button, title, description, "Open client hub" button
2. ClientDetailWorkspace component (leads, quotes, cases, properties, jobs)
3. ProfileActivityLog (recent activity feed)

**Key interactions:**
- "Open client hub" → `/admin/clients/[id]/hub`
- Property/job/case links navigate to detail pages

**Connected APIs:** `GET /api/admin/clients/[id]/activity`

---

### `/admin/clients/[id]/edit` — Edit Client

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Form to update client contact details and configure 21 portal-visibility feature flags.

**Page sections / layout (top to bottom):**
1. Header with title and back button
2. Card: Client Details form
3. Card: Portal Visibility Overrides (21-toggle grid)
4. Buttons: Save, Deactivate, Resend Invite

**Forms / inputs:**
- Name, email, phone, address, notes
- 21 visibility toggles: showProperties, showJobs, showCalendar, showReports, showReportDownloads, showChecklistPreview, showInventory, showShopping, showStockRuns, showFinanceDetails, showOngoingJobs, showLaundryUpdates, showLaundryImages, showLaundryCosts, showClientTaskRequests, showCases, showExtraPayRequests, showQuoteRequests, showApprovals, showCleanerNames, allowInventoryThresholdEdits, allowStockRuns, allowCaseReplies

**Modals or drawers:** Two-step confirm dialogs for deactivate and resend invite (require PIN or password).

**Connected APIs:** `PATCH /api/admin/clients/[id]`, `DELETE /api/admin/clients/[id]`, `POST /api/admin/clients/[id]/invite`

---

### `/admin/clients/[id]/hub` — Client Hub

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Operations-focused dashboard for a single client showing job stream, notifications, automation rules, and feedback queue.

**Primary data displayed:**
- Stat cards: recent jobs, notifications, enabled automation rules, feedback received
- Job command stream (up to 12 recent jobs with status, cleaner, date)
- Notification log (30 most recent)
- Automation summary (preference, enabled rules with templates and delays)
- Feedback queue (up to 8 recent with rating, comment, time)

**Page sections / layout (top to bottom):**
1. Header with back button, title, description
2. Stat cards (4 columns)
3. Two-column grid: Job stream + Notification log | Automation summary + Feedback queue

**Key interactions:**
- Click "Open job" buttons to navigate to job detail
- Notification "Job" links navigate to associated job
- View automation rules with trigger, template, channel, delay, enabled status

**Empty states:** "No jobs found", "No job-related notifications recorded yet", "No automation rules configured yet", "No feedback records yet"

**Connected APIs:** Server-rendered from `db.client.findUnique` with includes; `GET /api/admin/clients/[id]/activity`

---

### `/admin/properties` — Properties List

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Display all active properties organized by client. Shows sync status, laundry status, and job count per property.

**Primary data displayed:**
- Property name, address, suburb, client name
- Bedroom/bathroom count (hidden on small screens)
- Job count
- Laundry enabled badge (if disabled)
- iCal sync status badge (if integration enabled)

**Page sections / layout (top to bottom):**
1. Header with title, count, "Add Property" button
2. Card with single-column list of property rows
3. Empty state

**Key interactions:**
- Click property row to open detail
- "Add Property" → `/admin/properties/new`

**Connected APIs:** `GET /api/admin/properties`

---

### `/admin/properties/new` — Add Property

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Create a new property. Supports `initialClientId` and `copyFromPropertyId` query params.

**Forms / inputs:** Delegated to `<NewPropertyForm />` — typically: name, address (Google autocomplete), suburb/state/postcode, bedrooms, bathrooms, check-in/out times, switches for inventory, laundry, balcony.

**Connected APIs:** `POST /api/admin/properties`

---

### `/admin/properties/[id]` — Property Detail

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Comprehensive property management hub with multi-tab interface for overview, editing, form templates, iCal config, inventory, and next-job checklists.

**Primary data displayed:**
- Property name, address, client name
- Overview stats: suburb, bedrooms, bathrooms, balcony, linen buffer, clean duration, guest count, check-in/out times, notes
- Access instructions (lockbox, codes, parking, step-by-step entry)
- Attachment files (images and documents)
- iCal integration status with last run
- Inventory/stock rows by location (on-hand, par, threshold)
- Next-job checklist with photo/note requirements

**Page sections / layout (top to bottom):**
1. Header with back button, name/address, Maps button, Copy Property button, Delete button
2. Tabbed interface:
   - **Overview:** stats grid, notes, access instructions with attachment gallery
   - **Edit:** full property form
   - **Forms:** job-type form template overrides
   - **iCal Integration:** URL input, enable toggle, sync status, sync option checkboxes, undo sync button
   - **Inventory:** preset/custom item add, stock table
   - **Next Job Checklist:** pending tasks with status, add task form

**Forms / inputs:**
- Name, address (Google autocomplete), suburb, state, postcode, notes
- Bedrooms, bathrooms (numeric)
- Linen buffer sets, default clean duration, max guest count
- Default check-in/out times
- Switches: inventoryEnabled, laundryEnabled, hasBalcony, showCleanerContactToClient
- iCal URL, enabled toggle, sync option checkboxes
- Stock rows: on-hand, parLevel, reorderThreshold (numeric)
- Task form: title, description, requiresPhoto, requiresNote
- Rate override (PropertyClientRateEditor)

**Key interactions:**
- Tab switching, Save, Delete (two-step confirm), Sync now (toggles syncing state), Add inventory, Add pending task

**Empty / loading / error states:** iCal ERROR badge with icon if failed, pending task count badge, "Loading…" during async ops

**Connected APIs:** `GET/PATCH/DELETE /api/admin/properties/[id]`, `POST /api/admin/properties/[id]/sync`, `POST /api/admin/properties/[id]/undo-sync`, `POST/PATCH/DELETE /api/admin/properties/[id]/pending-tasks/...`, `GET /api/admin/properties/[id]/inventory-items`, `POST /api/admin/properties/[id]/stock`

---

### `/admin/users` — Users Manager

**Role:** ADMIN (manage), ADMIN | OPS_MANAGER (view)

**Purpose:** Centralized user account management. Create, edit, deactivate users; manage roles, permissions, bank details, and profile-edit overrides.

**Primary data displayed:**
- User table: name, email, role, phone, active status, email verified
- Role filter (all, ADMIN, OPS_MANAGER, CLEANER, CLIENT, LAUNDRY)
- Tabs by role
- Per-user actions: edit, send password reset, deactivate, profile-edit override

**Page sections / layout (top to bottom):**
1. Header: role filter + create form (admin only)
2. Tabs by role
3. User list with per-row actions
4. Edit modal: extended profile fields (business name, ABN, address, job title, department, base location, bank details)

**Forms / inputs:**
- Create: name, email, password, role, phone, client (dropdown), extended profile (businessName, abn, address, contactNumber, jobTitle, department, baseLocation, bankDetails: accountName, bankName, bsb, accountNumber)
- Edit: same as create
- Profile edit override: canEditName, canEditPhone, canEditEmail toggles

**Key interactions:**
- Role filter tabs, Create account form (ADMIN only), Edit user, Send password reset, Deactivate (two-step), Set profile edit override (two-step)

**Empty / loading / error states:** "Loading…" during fetch, empty role tab message

**Connected APIs:** `GET/POST/PATCH/DELETE /api/admin/users[/{id}]`, `POST /api/admin/users/{id}/reset-password`, `PATCH /api/admin/users/{id}/profile-edit-override`, `GET /api/admin/clients`, `GET /api/admin/settings`

---

### `/admin/suppliers` — Supplier Catalog

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Manage vendor contact details and purchasing defaults. Inline-editable table.

**Primary data displayed:**
- Supplier name, email, phone, website, default lead days, categories (tags), notes, active checkbox

**Page sections / layout (top to bottom):**
1. Header: title and description
2. Card: "Add Supplier" form
3. Card: "Supplier List" (editable rows)

**Forms / inputs:**
- Add: name (required), email, phone, website, defaultLeadDays (0–60), categories (comma-separated), notes (textarea)
- Edit: same fields, inline per row

**Key interactions:** Add new, edit inline, save per row, delete (two-step), active toggle

**Empty / loading / error states:** "Loading suppliers…", "No suppliers configured."

**Connected APIs:** `GET/POST/PATCH/DELETE /api/admin/inventory/suppliers[/{id}]`

---

### `/admin/delivery-profiles` — Client Delivery Profiles

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Configure per-client report and invoice delivery preferences (recipient emails and auto-send toggles).

**Primary data displayed:**
- Per-client rows: name, default email, report recipients, invoice recipients, auto-send report toggle, auto-send invoice toggle

**Forms / inputs:**
- Report recipients (comma-separated emails), Invoice recipients (comma-separated)
- Auto-send reports / invoices (checkboxes)
- Save button per client

**Key interactions:** Edit emails and toggles, save per client (deduplicated, lowercased)

**Empty / loading / error states:** "Loading profiles…", "No clients found.", success/error toasts

**Connected APIs:** `GET/PATCH /api/admin/client-delivery-profiles`

---

### `/admin/laundry/suppliers` — Laundry Suppliers

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Manage third-party laundry service suppliers and cost data, used for laundry drop-off updates to show supplier-specific costs.

**Primary data displayed:** Delegated to `<LaundrySuppliersWorkspace />`.

**Page sections / layout:**
1. Header with title, description, back button to `/admin/laundry`
2. LaundrySuppliersWorkspace component

**Connected APIs:** `GET /api/admin/laundry/suppliers` plus component-internal CRUD.

---

### `/admin/profile` — Admin Profile Settings

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Personal profile and account settings: avatar, password, phone, email, notification preferences, and admin PIN for sensitive operations.

**Primary data displayed:**
- User name, email, phone, role, avatar
- Notification preferences (web/email/sms toggles per type)
- Admin PIN state (set/last updated)
- Portal theme selector

**Page sections / layout (top to bottom):**
1. Tabs (delegated to `<ProfileSettings />`): Profile, Password, Notifications, Theme, Security

**Forms / inputs:**
- Profile: name, email, phone, image upload (subject to edit policy)
- Password: current, new (min 8), confirm
- Notifications: per-channel × per-type toggles
- Security: current password + PIN form (admin/ops only)
- Theme: light/dark/public radio

**Key interactions:** Save profile, change password, update notifications, set/clear admin PIN (with password confirmation), persist theme to localStorage

**Empty / loading / error states:** "Loading profile…", toasts for save success/error, PIN loading state separate

**Connected APIs:** `GET/PATCH /api/me/profile`, `POST /api/me/password`, `PATCH /api/me/notifications`, `GET/POST/DELETE /api/me/admin-pin`

---

## Admin — Finance & Commerce

### `/admin/quotes` — Quotes and Leads Management

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Dual-tab interface to manage incoming leads and their associated quotes, enabling quote generation, editing, and conversion into invoices or client accounts.

**Primary data displayed:**
- Leads tab: count, each showing name, status badge, contact method, estimated price range, quote count, creation date
- Quotes tab: list with client/lead name, service type, total, status badge

**Page sections / layout (top to bottom):**
1. Header with "New Quote" button
2. Tabbed interface: Leads | Quotes
3. Leads tab: scrollable list with sidebar
4. Quotes tab: scrollable list with bulk action buttons
5. Right-side panel (when lead selected): full lead details with timeline and action buttons

**Key interactions:**
- Click lead to open right panel
- Status dropdown (NEW, CONTACTED, QUOTED, CONVERTED, LOST)
- Send counter offer modal with line item editor
- Edit quote dialog (status, valid-until, notes)
- PDF download, email send, clone, delete
- Create client account from lead

**Forms / inputs:**
- Lead status select, admin notes (auto-saves on blur)
- Counter offer modal: line item table (label, unit price, qty, total), valid-until date, send email checkbox, notes
- Quote edit: status, valid-until, notes

**Empty / loading / error states:** "No leads yet…", "No quotes yet."

**Modals or drawers:** Right sidebar (lead details), counter offer dialog, quote edit dialog, delete confirmation

**Connected APIs:** `GET /api/admin/leads`, `GET /api/admin/quotes`, `PATCH /api/admin/leads/{id}`, `POST /api/admin/leads/{id}/counter-offer`, `POST /api/admin/leads/{id}/create-client`, `PATCH /api/admin/quotes/{id}`, `POST /api/admin/quotes/{id}/send`, `DELETE /api/admin/quotes/{id}`, `POST /api/admin/quotes`, `GET /api/admin/quotes/{id}/pdf`

---

### `/admin/quotes/new` — New Quote Form

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Create a new quote from scratch or from a lead, with property-based pricing calculator and line item builder.

**Primary data displayed:**
- Service type selector (16+ types)
- Property metrics inputs
- Condition score (1–5)
- Add-on calculator (steam carpet, window cleaning, pressure wash)
- Real-time total with GST breakdown

**Page sections / layout (top to bottom):**
1. Lead/client selector
2. Service type dropdown
3. Property size and condition inputs
4. Optional add-on fields
5. Manual adjustment field
6. Line items preview (auto-calculated)
7. Quote summary (subtotal, GST, total)
8. Notes textarea
9. Valid-until date picker
10. Action buttons: Preview, Save draft

**Key interactions:** Lead selector populates service type/estimate; real-time recalculation; manual line item add/remove

**Forms / inputs:** Service type, bedrooms, bathrooms, floors, sqm, condition (1–5), steam carpet rooms, window sqm, pressure wash sqm, manual adjustment, notes, valid-until

**Empty / loading / error states:** Lead defaults to "None"; defaults provided (2 beds, 1 bath, 1 floor, 80 sqm, condition 3)

**Connected APIs:** `GET /api/admin/leads`, `GET /api/admin/quotes`

---

### `/admin/quotes/[id]/convert` — Convert Quote to Invoice

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Convert an approved quote into a billable invoice tied to a property and job.

**Primary data displayed:** Quote summary (ID, service type, status), property selector, line items review

**Page sections / layout (top to bottom):**
1. Header with quote ID and service type
2. Property selector
3. Invoice line items (read-only preview)
4. Convert / Cancel buttons

**Forms / inputs:** Property dropdown (active properties)

**Connected APIs:** `GET /api/admin/properties`

---

### `/admin/quotes/preview` — Quote Preview and Save

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Review a quote draft (held in session storage) before final save, with PDF preview option.

**Primary data displayed:**
- Summary card: subtotal, GST, total, valid-until
- Service parameters (if meta present)
- Line items table
- Notes section (if present)

**Page sections / layout (top to bottom):**
1. Header with Back to edit, Download preview, Save quote buttons
2. Summary card (4 metrics grid)
3. Service parameters card (if applicable)
4. Line items table
5. Notes section (if populated)

**Key interactions:** Back to edit, Download preview (PDF), Save quote (creates and redirects)

**Empty / loading / error states:** "No quote draft found" if session storage empty; "Loading quote preview…"

**Connected APIs:** `POST /api/admin/quotes/preview-pdf`, `POST /api/admin/quotes`

---

### `/admin/invoices` — Client Invoices Management

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Create, manage, send, and track client invoices with line items tied to jobs and properties.

**Primary data displayed:**
- Invoice list: number, client, status badge (Draft/Approved/Sent/Paid/Void), amount, dates
- Status workflow indicators
- Line item breakdown: description, qty, unit price, job ref, category
- Client contact info, approval workflow tracking

**Page sections / layout (top to bottom):**
1. Header with "New Invoice" button
2. Filter/sort controls
3. Invoice list (cards or expandable table)
4. Selected invoice detail panel
5. Modals for create/edit, approve, send, mark paid, void

**Key interactions:** Click to open, edit, approve (Draft→Approved), send via email, mark paid, void, download PDF, auto-calculate totals, filter by client/status/date

**Forms / inputs:**
- Client dropdown, period start/end, line item builder (description, qty, unit price, category, job link), GST toggle, invoice notes

**Empty / loading / error states:** "No invoices found", loading spinner

**Modals or drawers:** New/edit form, approve confirmation, send dialog (recipient field), delete/void confirmation, line item edit modal

**Connected APIs:** `GET /api/admin/invoices`, `GET /api/admin/clients`, `GET /api/admin/properties`, `GET /api/admin/billing-rates`, `POST/PATCH /api/admin/invoices[/{id}]`, `POST /api/admin/invoices/{id}/approve`, `POST /api/admin/invoices/{id}/send`, `POST /api/admin/invoices/{id}/mark-paid`, `GET /api/admin/invoices/{id}/pdf`

---

### `/admin/finance` — Finance Overview

**Role:** ADMIN | OPS_MANAGER

**Purpose:** High-level financial dashboard showing revenue, operational costs, and gross margin across clients for a selected period.

**Primary data displayed:**
- 4 quick-access cards: Finance Analytics, Payroll, Payment Gateways, Xero Integration
- Summary metrics: Revenue, Cleaner Cost, Laundry Cost, Supplies Cost, Gross Margin, Margin %
- By-client breakdown table
- Date range controls

**Page sections / layout (top to bottom):**
1. Header
2. Quick-access cards (4 columns)
3. Date range filter card (start, end, Apply)
4. Summary metrics (6 columns)
5. By-client table (8 columns: client, revenue, cleaner, laundry, supplies, total cost, margin, margin %)

**Forms / inputs:** Start date, end date

**Empty / loading / error states:** "Loading finance summary…", "No data available for this period."

**Connected APIs:** `GET /api/admin/finance/summary?startDate=&endDate=`

---

### `/admin/finance/dashboard` — Finance Analytics Dashboard

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Detailed analytics view showing revenue trends, conversion rates, QA metrics, and cleaner contribution margins over time.

**Primary data displayed:** Time-series charts: revenue by period, conversion rate, QA trend, cleaner contribution; client-level contribution; KPIs

**Page sections / layout (top to bottom):**
1. Header with title, navigation buttons (Finance overview, Payroll)
2. Main workspace component with interactive charts

**Connected APIs:** Server-side `getFinanceDashboardData()` aggregating multiple endpoints.

---

### `/admin/finance/payroll` — Payroll Summary View

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Summarized payroll view showing paid hours, gross pay, and adjustments for all cleaners in a selected date range, with payslip export.

**Primary data displayed:**
- Metric cards: cleaners, paid hours, gross payroll, period
- Per-cleaner card: name/email, gross pay, paid hours, job gross, adjustments
- Jobs table per cleaner: job ID, property, type, date, hours, rate, gross
- Approved adjustments list per cleaner
- Download payslip PDF button per cleaner

**Page sections / layout (top to bottom):**
1. Header with navigation buttons
2. Date range filter form
3. Summary metrics (4 cards)
4. Per-cleaner cards

**Forms / inputs:** Start date, end date

**Empty / loading / error states:** "No completed jobs in this range." per cleaner

**Connected APIs:** `GET /api/admin/finance/payroll/payslip?cleanerId=&startDate=&endDate=`, server-side `getPayrollSummary()`

---

### `/admin/payroll` — Payroll Runs Management

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Create and manage payroll runs, define pay periods, and initiate cleaner payouts via bank transfer or Stripe.

**Primary data displayed:**
- Create Payroll Run form
- Payroll runs list: period dates, status badge (Draft/Confirmed/Processing/Paid/Failed), grand total, cleaner count, created date

**Page sections / layout (top to bottom):**
1. Header
2. Create Payroll Run card
3. Payroll runs list

**Forms / inputs:** Period start, period end

**Empty / loading / error states:** "Loading payroll runs…", empty list state

**Connected APIs:** `GET/POST /api/admin/payroll/runs`

---

### `/admin/payroll/[id]` — Payroll Run Detail and Processing

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Review a payroll run in detail, confirm amounts, process payouts, and generate ABA files for bank transfers.

**Primary data displayed:**
- Run summary: period, status, total payable, breakdown (shopping reimbursements, transport allowances, adjustments), grand total, cleaner count
- Per-cleaner payout card: name, payout method, bank details, amount breakdown, status, failure reason

**Page sections / layout (top to bottom):**
1. Header
2. Run summary card
3. Per-cleaner payout cards
4. Action buttons (status-dependent)

**Key interactions:** Confirm run (Draft→Confirmed), Process payouts, Download ABA file, View failure reasons

**Connected APIs:** `GET /api/admin/payroll/runs/{runId}`, `POST /api/admin/payroll/runs/{runId}/confirm`, `POST /api/admin/payroll/runs/{runId}/process`, `GET /api/admin/payroll/runs/{runId}/aba`, `POST /api/admin/payroll/runs/{runId}/retry-failed`

---

### `/admin/pay-adjustments` — Extra Payment Requests Review

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Review and approve/reject cleaner requests for additional hourly or fixed payments, with optional client approval workflow.

**Primary data displayed:**
- Tabs: Pending (count), All (count)
- Per-request: title/property, cleaner, scope (JOB/PROPERTY/STANDALONE), date, requested amount + hourly rate, cleaner note, admin note, client approval status, approved amount, status badge

**Page sections / layout (top to bottom):**
1. Header with Refresh button
2. Tabs
3. Request list with collapsible cards

**Key interactions:** Filter by tab, view full details modal, Approve (with override amount), Reject (with admin note), Send to client (modal), Link property to standalone (modal)

**Forms / inputs:**
- Approve/reject: approved amount + admin note
- Send to client: title, client-facing amount, description
- Link property: title, property dropdown

**Empty / loading / error states:** "Loading…", "No requests found."

**Modals or drawers:** Approve/reject dialog, Send to client dialog, Link property dialog, Full details modal

**Connected APIs:** `GET /api/admin/pay-adjustments`, `PATCH /api/admin/pay-adjustments/{id}`, `POST /api/admin/pay-adjustments/{id}/send-to-client`, `GET /api/admin/properties`

---

### `/admin/time-adjustments` — Clock Adjustments Review

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Review and approve/reject cleaner requests to change the final clock time recorded for a job submission.

**Primary data displayed:**
- Tabs: Pending (count), All (count)
- Per-request: job property + number, cleaner, job date/type/location, original vs requested final time, reason, admin note, status badge, requested timestamp

**Page sections / layout (top to bottom):**
1. Header with Refresh button
2. Tabs
3. Request list with inline action buttons

**Key interactions:** Filter by tab, click property link to job detail, Approve (confirm minutes), Reject (with admin note)

**Forms / inputs:** Approved total minutes (with min/max validation), admin note

**Empty / loading / error states:** "Loading…", "No clock adjustment requests found."

**Modals or drawers:** Approve/reject dialog

**Connected APIs:** `GET /api/admin/time-adjustments`, `PATCH /api/admin/time-adjustments/{id}`

---

### `/admin/settings/payment-gateways` — Payment Gateways Configuration

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Server-side redirect to `/admin/settings?tab=payment-gateways` so the gateway tab loads pre-selected.

---

### `/admin/intelligence` — Intelligence Hub (Deprecated)

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Navigation placeholder indicating the old intelligence workspace was retired; directs users to where those features now live.

**Primary data displayed:** 4 info cards linking to Cases, Forms, Reports, Shopping/invoices

**Page sections / layout:**
1. Header with deprecation notice
2. 2-column card grid

---

### `/admin/scale` — Scale Features Hub (Deprecated)

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Navigation placeholder indicating Phase 3 scale features have been integrated into main operational pages.

**Primary data displayed:** 4 info cards linking to Client invoices, Shopping runs, Stock counts, Reports/finance

**Page sections / layout:**
1. Header with notice
2. 2-column card grid

---

## Admin — Systems, Inventory, Marketing, Onboarding

### `/admin/settings` — Settings & Configuration

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Central hub for operational settings, SMS/email provider configuration, integrations, and user role permissions.

**Primary data displayed:**
- App settings (SMS provider, email config status)
- iCal integration status per property
- RBAC permission matrix
- Cleaner roster (active users)

**Page sections / layout:**
1. Header
2. SettingsWorkspace (tabs: General, Integrations, Email, SMS, Permissions)

**Forms / inputs:** Email config, SMS provider selection, app URL, permissions

**Connected APIs:** App settings fetch, active cleaners list, env-var checks for provider configuration

---

### `/admin/integrations` — iCal Sync Operations

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Monitor iCal sync runs across properties, troubleshoot failures, trigger bulk re-syncs, and review history.

**Primary data displayed:**
- 4 summary stat cards: Runs, Properties, Syncable, Errors
- Global sync run history with property, status, mode, timestamps, txn summary
- Property-level sync status and last sync time
- Bulk re-sync results

**Page sections / layout (top to bottom):**
1. Header with refresh
2. 4 stat cards
3. Filter card (property, status, mode, search)
4. Two-column: property selection (checkboxes, filterable) | global sync history timeline

**Key interactions:** Filters (status/mode/text), Bulk re-sync (select properties, run batch), Load more pagination

**Empty / loading / error states:** "Loading sync runs…", "No sync runs match the current filters", "No sync-enabled properties match"

**Connected APIs:** `GET /api/admin/integrations/ical-sync-runs`, `POST /api/admin/integrations/ical-sync-runs`

---

### `/admin/integrations/xero` — Xero Redirect

**Role:** ADMIN | OPS_MANAGER

**Purpose:** OAuth callback redirect; forwards auth params back to settings page (`/admin/settings?tab=xero` with `connected`, `tenant`, `error` query params).

---

### `/admin/forms` — Form Builder & Submission Review

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Build custom job forms with drag-and-drop sections/fields, manage templates, review and edit form submissions.

**Primary data displayed:**
- Form template library (by service type, versioned)
- Form schema (sections with conditional fields)
- Submission list (with job/property, template, date, media count)
- Submission detail: answers, media, laundry readiness, report preview

**Page sections / layout (top to bottom):**
1. Header with "New Template" button
2. Tabbed: Builder | Submissions
3. **Builder tab:** templates sidebar, visual builder (template name, service type, sections/fields), field configuration (label, type, page slot, required, conditional logic), Save/Copy/Delete
4. **Submissions tab:** list with View/PDF/Download per submission, detail dialog

**Key interactions:** Drag-and-drop sections/fields, field type selection (checkbox/text/textarea/number/upload/inventory/signature), conditional visibility (field-based or property-based), Add/remove sections, Toggle edit mode for submission, Download report PDF, Upload additional media

**Forms / inputs:**
- Template: name, service type
- Field: label, type, page slot, required
- Conditional: none / field-based / property-based
- Submission edit: type-appropriate field controls

**Modals or drawers:** Submission detail modal (max 5xl width), delete template two-step confirm

**Connected APIs:** `GET/POST/PATCH/DELETE /api/admin/form-templates[/{id}]`, `GET/PATCH /api/admin/form-submissions[/{id}]`, `POST /api/uploads/direct`, `GET/POST /api/reports/{jobId}/download`

---

### `/admin/inventory` — Inventory Management

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Manage inventory items, stock levels by property, shopping lists for low-stock items, stock count runs, bulk import/export.

**Primary data displayed:**
- Property summary (tracked items, low stock count)
- Shopping list grouped by category/supplier
- Property stock levels (item, location, on-hand, par, threshold)
- Stock count runs (expected vs counted, variance)
- Items master list

**Page sections / layout (top to bottom):**
1. Header with property selector
2. Tabs: Properties | Shopping List | Property Stock | Stock Count | Items Master

**Key interactions:** Property selector, Download/email shopping PDF, Edit stock levels inline + Save all, Start new count, Apply submitted run, Import CSV with error reporting, Add item from preset or custom, Edit master items

**Forms / inputs:**
- CSV import (name required, sku, category, location, unit, supplier, isActive, on-hand, par, threshold)
- New item: name, SKU, category, location, unit, supplier, unit cost
- Stock level numbers
- Stock count: item, expected, counted, variance

**Empty / loading / error states:** "Loading property summaries…", "No properties found", "All stock levels are healthy", "No stock counts yet", "No tracked items"

**Modals or drawers:** Email shopping list dialog (user or custom email)

**Connected APIs:** `GET /api/admin/properties`, `GET /api/admin/inventory/items`, `GET /api/admin/inventory/property/{propertyId}`, `GET /api/admin/inventory/shopping-list?scope=`, `GET/POST/PATCH /api/admin/inventory/stock-counts`, `POST /api/admin/inventory/property/{id}/set-levels`, `GET/POST /api/admin/inventory/items/export|import`, `GET/POST /api/admin/inventory/shopping-list/pdf|email`

---

### `/admin/shopping-runs` — Shopping Run Management

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Manage cleaner and client shopping runs — track who paid, receipts, client charges, cleaner reimbursement, shopping time approval.

**Primary data displayed:**
- Run selection (name, status, owner scope)
- Owner, paid-by, estimated/actual cost, receipt count
- Status badges (client charge, cleaner reimbursement, shopping time)
- Sections: PO actions, reimbursement actions, shopping time approval, client allocations, receipts

**Page sections / layout (top to bottom):**
1. Header
2. Run selection card
3. 5 summary cards
4. PO actions card
5. Reimbursement actions card
6. Shopping time approval card (if cleaner-owned)
7. Client allocations card
8. Receipts card

**Key interactions:** Run selector + supplier/client filters, Download/email PO PDF, Download/email reimbursement pack, Mark client charge paid, Mark cleaner reimbursed, Approve shopping time, Reset/mark shopping time paid

**Forms / inputs:** PO recipient email, Reimbursement recipient email, Approved minutes + hourly rate

**Connected APIs:** `GET/PATCH /api/admin/inventory/shopping-runs[/{runId}]`, `GET/POST /api/admin/inventory/shopping-runs/{runId}/po`, `POST /api/admin/inventory/shopping-runs/{runId}/po/email`, `GET/POST /api/admin/inventory/shopping-runs/{runId}/reimbursement`, `POST /api/admin/inventory/shopping-runs/{runId}/reimbursement/email`

---

### `/admin/stock-runs` — Stock Count Operations

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Run full inventory counts at the system level, review counted stock, and apply adjustments back to property inventory. Delegated to `<StockRunWorkspace />`.

**Connected APIs:** `/api/admin/stock-runs`

---

### `/admin/laundry` — Laundry Scheduling & Operations

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Plan weekly laundry pickup/dropoff, manage task status, handle failed pickups, generate laundry reports, track timeline of events.

**Primary data displayed:**
- Weekly task schedule (filterable by status/property/client/search)
- Task detail: property, job, status, flags, timeline
- Failed pickup requests with approval status
- Laundry reports (weekly/daily/monthly/annual aggregates or per-task)

**Page sections / layout (top to bottom):**
1. Header with week navigation
2. Alerts section (flags, failures)
3. Tabs: Schedule (active/completed subtabs) | Planning | Reports

**Key interactions:** Week navigation, filters, Create task, Edit task, Confirm/handle failed pickups, Generate/download laundry reports, Email reports, Replace photos, View timeline, Start/approve plan generation

**Forms / inputs:**
- Task creation: property, job, pickup date, dropoff date, flag notes
- Task edit: dates, status, flags, skip reason, admin notes
- Failed pickup: reschedule date or skip approval
- Report: period (daily/weekly/monthly/annual/custom), date range, recipient email, subject

**Modals or drawers:** Create task dialog, Task detail/edit modal, Failed pickup approval, Report preview, Delete confirmation

**Connected APIs:** `GET /api/laundry/week?start=`, `GET /api/admin/laundry/alerts`, `GET /api/admin/clients`, `GET /api/admin/properties`, `GET /api/jobs?propertyId=`, `POST/PATCH /api/admin/laundry`, `POST /api/admin/laundry/reports/email`, `GET /api/laundry/invoice/preview|download`, `GET /api/admin/laundry/reports/history`

---

### `/admin/marketing` — Marketing Console & Settings

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Configure marketing campaigns, email templates, subscription plans, and track campaign metrics.

**Primary data displayed:** Campaign list, subscription plans, campaign metrics

**Page sections / layout:**
1. Link to "Open email campaigns"
2. MarketingConsole component

**Connected APIs:** Server-side `getMarketingCampaigns()`, `getMarketingSubscriptionPlans()`

---

### `/admin/marketing/campaigns` — Email Campaigns

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Create, edit, send broadcast email campaigns to clients; schedule campaigns for later dispatch.

**Primary data displayed:** Campaign list (name, status, recipients, sent date, metrics), campaign detail (template, recipient segments, scheduling, send history)

**Page sections / layout:**
1. Header with back to marketing hub
2. EmailCampaignsWorkspace component

**Key interactions:** Create new, edit template/recipients/schedule, send broadcast, view history

**Connected APIs:** Server-side `listEmailCampaigns()`; `POST/PATCH/DELETE /api/admin/marketing/campaigns/{id}`

---

### `/admin/website` — Website Editor

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Edit public-facing website content (homepage, copy, media). Delegated to `<WebsiteEditor />` (rich text/WYSIWYG).

**Connected APIs:** `getAppSettings()` server-side fetch.

---

### `/admin/website/blog` — Blog Manager

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Create, edit, publish blog posts for public site.

**Primary data displayed:** Blog post list, post detail (content, media, meta, scheduling)

**Page sections / layout:** BlogManager component (list and editor)

**Key interactions:** Create/edit post, publish/unpublish, schedule publish date, upload featured image

**Connected APIs:** Server-side `listAllBlogPosts()`

---

### `/admin/workforce` — Workforce Management Hub

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Manage cleaner profiles, shift scheduling, performance tracking, availability, and certifications. Delegated to `<AdminWorkforceHub />`.

**Primary data displayed:** Cleaner roster with status, availability, certifications

---

### `/admin/onboarding` — Property Onboarding Surveys

**Role:** ADMIN | OPS_MANAGER

**Purpose:** List and manage property onboarding surveys; review pending surveys before approving to create property/client records.

**Primary data displayed:**
- Survey list: status, property name/suburb, bedroom/bathroom count, appliance count, "created property" badge, creation date

**Page sections / layout (top to bottom):**
1. Header with "New Survey" button
2. Search bar (property name, suburb)
3. Status filter dropdown
4. Search button
5. Survey list as cards with action buttons

**Key interactions:** Search, filter by status, Create new, View detail, Edit draft, Delete draft/rejected

**Empty / loading / error states:** "Loading…", "No surveys yet. Create your first survey"

**Connected APIs:** `GET /api/admin/onboarding/surveys?status=&search=`, `DELETE /api/admin/onboarding/surveys/{id}`

---

### `/admin/onboarding/new` — Survey Creation Wizard

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Multi-step wizard to create or edit property onboarding surveys; collect client info, property details, appliances, special requests, laundry, access, staffing, iCal, and job type answers.

**Primary data displayed:** Wizard progress, form data per step

**Page sections / layout:**
1. WizardLayout with step navigation
2. 11 steps:
   - Client Info (new/existing client, name, email, phone)
   - Property Basics (name, address, suburb, bedrooms, bathrooms, type, size, balcony, floors)
   - Appliances (list with condition notes)
   - Special Requests (area, priority, description)
   - Laundry (enabled, supplier, washer/dryer type, location, notes)
   - Access (access methods)
   - Notes (general)
   - Staffing (requested cleaners, estimated hours/cleaners/price)
   - iCal (sync URL, provider)
   - Job Type Answers
   - Review (summary, submit/approve)

**Key interactions:** Step navigation, Save step data, Submit for review

**Forms / inputs:** Contextual per step — text, number, select, date, checkbox, file upload

**Connected APIs:** `POST /api/admin/onboarding/surveys`, `GET /api/admin/onboarding/surveys/{editId}`, `PATCH /api/admin/onboarding/surveys/{surveyId}`

---

### `/admin/onboarding/[id]` — Survey Detail & Approval

**Role:** ADMIN | OPS_MANAGER

**Purpose:** Review completed survey, approve to create client/property/jobs, reject with reason, or delete draft.

**Primary data displayed:** Survey metadata, property details, nested sections (client, appliances, requests, laundry, access, staffing, iCal, job type answers), admin review actions, created entities summary

**Page sections / layout (top to bottom):**
1. Back button, edit button (if draft), delete button (if draft/rejected), status badge
2. Survey number and property info
3. 2-column grid of detail cards
4. Admin review card (if pending): notes textarea, Approve/Reject buttons
5. Approval summary card (if approved): approved by/date, created entity badges (client, property, integration, jobs)

**Key interactions:** Back to list, Edit (redirect to wizard), Delete, Approve (creates client/property/jobs), Reject (requires reason), Add admin notes

**Modals or drawers:** Delete confirmation

**Connected APIs:** `GET /api/admin/onboarding/surveys/{id}`, `POST /api/admin/onboarding/surveys/{id}/approve`, `POST /api/admin/onboarding/surveys/{id}/reject`, `DELETE /api/admin/onboarding/surveys/{id}`

---

# Cleaner Portal

> Mobile-first design. Touch-friendly targets (44px+), camera/GPS integration, swipe gestures on job detail steps, client-side image compression.

### `/cleaner` — Dashboard

**Role:** CLEANER

**Purpose:** Main entry point for cleaners showing today's jobs, upcoming schedule, and key metrics. Active jobs, performance summaries, and quick access to pay, invoices, and other modules.

**Primary data displayed:**
- Today's job count and upcoming week summary
- Current ongoing job (if any) with status and location
- Hours logged this month
- Pending pay requests and approved extras
- Next scheduled job with timing highlights
- Recent completed jobs (last 10)
- Jobs awaiting confirmation
- Team workforce posts

**Page sections / layout (top to bottom):**
1. Hero card with personalized greeting, date, job summary, quick action buttons
2. Next job preview (right side on desktop)
3. Stats row (5 cards: today, hours, pending pay requests, approved extras, awaiting confirmation)
4. Ongoing job banner (if active)
5. Immediate attention panel
6. Jobs awaiting confirmation
7. 7-day timeline strip (horizontally scrollable)
8. Main grid: today's schedule + quick tools sidebar
9. Recent completions sidebar
10. Workforce dashboard posts
11. Upcoming jobs (beyond today)
12. Footer with completed jobs summary

**Key interactions:** Navigation buttons, Accept/decline job offer, Click job card → detail, Google Maps for next job, Filter by status

**Empty / loading / error states:** Ongoing job hidden if none, empty message if no jobs today, "All modules hidden by admin" if visibility disabled

**Mobile considerations:** Full-width cards on mobile, grid on desktop; touch-friendly sizing; compact job card layout on mobile

**Connected APIs:** Jobs, time logs, pay adjustments, completed reports; workforce dashboard posts; immediate attention alerts

---

### `/cleaner/availability` — Availability

**Role:** CLEANER

**Purpose:** Cleaner sets weekly availability windows and date-specific overrides, supporting both fixed recurring schedules and flexible ad-hoc availability.

**Primary data displayed:** Current mode (FIXED/FLEXIBLE), weekly time slots per day, date-specific overrides, notes

**Forms / inputs:**
- Mode toggle: FIXED vs FLEXIBLE
- 7-day weekly schedule with start/end times per day
- Add/remove date overrides
- Time slot editor
- Notes textarea

**Key interactions:** Toggle mode, add/remove weekly days, edit slots inline, add date overrides, save

**Connected APIs:** `GET /api/cleaner/availability`, `PUT/POST` to save

---

### `/cleaner/calendar` — Calendar

**Role:** CLEANER

**Purpose:** Month/week/day calendar view of all assigned jobs with visual status indicators and color-coded job states.

**Primary data displayed:** 400 most recent assigned jobs; job status, property name/suburb, start/due times, job type

**Page sections / layout:**
1. Calendar component (FullCalendar)
2. Legend with status colors

**Key interactions:** Switch view (month/week/day), Click event for preview, Persist view in localStorage

**Mobile considerations:** Responsive calendar with touch-friendly tapping, preview modal on mobile

---

### `/cleaner/hub` — Team Hub

**Role:** CLEANER (also ADMIN/OPS_MANAGER for shared access)

**Purpose:** Shared team communication and announcements workspace. Branded workspace with `<StaffWorkforceHub />`.

---

### `/cleaner/invoices` — Invoices

**Role:** CLEANER

**Purpose:** Preview, download, and email invoice PDFs showing hours worked, rates, and pay across a date range.

**Primary data displayed:**
- Job-by-job breakdown with hours, rates, amounts
- Transport allowance and approved extras
- Shopping time and expense totals
- Pending pay adjustments
- Estimated total pay

**Forms / inputs:**
- Date range (start/end)
- Toggle "show spent hours" vs original estimated
- Per-job comments textarea
- Per-job hour overrides with notes
- Email destination

**Key interactions:** Generate preview, Preview PDF inline, Download, Email to self/admin, Override hours with notes

**Connected APIs:** `GET /api/cleaner/invoices/preview`, `POST /api/cleaner/invoices/send-email`, `GET /api/reports/{jobId}/download`

---

### `/cleaner/jobs` — Jobs List

**Role:** CLEANER

**Purpose:** Filterable list of all assigned jobs with comprehensive search and sorting.

**Primary data displayed:** Property name, suburb, address, job type, status, scheduled date, start/due times, timing highlights, tags, job number

**Page sections / layout (top to bottom):**
1. Header with back-to-dashboard button
2. Filters card (status, scope, date range, property search)
3. Summary stats (total, completed, active counts)
4. Job list (divided rows)

**Forms / inputs:** Scope (all/upcoming/completed), Status, Date range (from/to), Property/suburb search

**Key interactions:** Apply/reset filters, Accept/decline pending offers, Open detail, Google Maps, Download report PDF

**Mobile considerations:** Full-width cards, stacked button layout

---

### `/cleaner/jobs/[id]` — Job Detail

**Role:** CLEANER

**Purpose:** Full job workspace for completing field work — checklists, photo uploads, laundry outcomes, special requests, and job submission.

**Primary data displayed:**
- Job briefing (property, address, client notes, access instructions)
- Dynamic checklist with conditional visibility rules
- Photo upload sections with progress
- Laundry status (ready/not ready/no pickup required)
- Special requests with proof photos and notes
- Damage reports with photo evidence
- Pay request uploads
- Signature capture
- Job status and timeline

**Page sections / layout (top to bottom):**
1. Briefing step (job details, property info, client notes, access, media gallery)
2. Checklist step (dynamic form fields with visibility logic)
3. Uploads step (media gallery with upload queue)
4. Laundry step (outcome selection, bag location, skip reasons)
5. Submit step (signature pad, final review)
6. Step navigation with swipe support on mobile

**Forms / inputs:**
- Dynamic template-based fields (text, checkbox, select, upload)
- Laundry outcome dropdown with conditional skip reason
- Damage report photo uploads
- Pay request photo uploads
- Admin-requested task checklist with proof
- Job task decisions with notes and proof
- Carry-forward items with photos
- Signature capture (touch-enabled)

**Key interactions:** Start/pause/resume work, Clock in/out, Step navigation, Accept/decline offers, Submit, Continue paused jobs, Upload media (client compressed), Manage laundry pickup state

**Mobile considerations:** Touch-optimized step nav, Swipe gestures, Camera integration, Full-screen upload with client compression (target 1.5MB, max 1600px), GPS context from briefing

**Connected APIs:** `GET /api/cleaner/jobs/{id}`, `POST /api/cleaner/jobs/{id}/clock-in|out`, `POST /api/uploads/direct`, `POST /api/cleaner/jobs/{id}/submit`

---

### `/cleaner/lost-found` — Lost & Found

**Role:** CLEANER

**Purpose:** Quick form to report items found during cleaning jobs, triggering admin case and client notification.

**Forms / inputs:**
- Job selector (last 200 assigned)
- Item name (text)
- Where found (text)
- Notes (textarea)

**Key interactions:** Select job, Submit, Toast confirmation with notification status

**Connected APIs:** `POST /api/cleaner/lost-found`

---

### `/cleaner/pay-requests` — Pay Requests

**Role:** CLEANER

**Purpose:** Submit hourly or fixed extra pay requests with optional photo attachments and notes for admin review.

**Primary data displayed:** Pending requests (status, amount, date), approved requests (amount, approval date), creation form

**Forms / inputs:**
- Scope: job-linked / property-linked / standalone
- Job dropdown (if JOB), Property dropdown (if PROPERTY or standalone)
- Title
- Pay type: hourly vs fixed
- Hours (if hourly), Rate (if hourly), Amount (if fixed)
- Notes (textarea)
- Photo attachments
- Extra payment checkbox

**Key interactions:** Create new, Upload photos, View approval history, Delete pending

**Connected APIs:** `GET/POST /api/cleaner/pay-adjustments`, `POST /api/uploads/direct`

---

### `/cleaner/profile` — Profile Redirect

**Role:** CLEANER

**Purpose:** Redirect to `/cleaner/settings`.

---

### `/cleaner/route` — Route Navigation

**Role:** CLEANER

**Purpose:** Client-rendered map and navigation for today's/tomorrow's job route with GPS tracking, ETA calculation, and Google Maps integration.

**Primary data displayed:**
- Ordered list of stops with address, suburb, state, postcode
- Job times, status, type
- ETA countdown when en-route
- Sequential numbering
- Live trip map with cleaner and property locations

**Page sections / layout (top to bottom):**
1. Header with mode selector (today/tomorrow/specific date)
2. Route controls (date picker, refresh, copy link, open-in-maps)
3. Status line (stop count, GPS status)
4. Stop cards: number badge, property/status, address with map icon, time/job type, ETA if en-route, action buttons, embedded live trip map (toggle)

**Forms / inputs:** Date input (specific-date mode), Mode toggle buttons

**Key interactions:** Switch mode, Refresh, Copy route link, Open full route in Google Maps, Navigate per stop, Show/hide live trip map per stop, Open job from route

**Mobile considerations:** GPS active indicator, full-width cards, large touch targets, embedded maps with native open-in-app, live tracking via `navigator.geolocation.watchPosition`

**Connected APIs:** `GET /api/cleaner/today-route?relative=tomorrow` or `?date=`, browser geolocation API

---

### `/cleaner/settings` — Profile Settings

**Role:** CLEANER

**Purpose:** Update cleaner profile (name, email, profile image, contact details, password).

**Forms / inputs:** Profile image upload, name, email, phone, address, password change

**Connected APIs:** Profile update endpoint

---

### `/cleaner/shopping` — Shopping Runs

**Role:** CLEANER (also ADMIN/OPS_MANAGER for shared access)

**Purpose:** Start and manage shopping runs, plan what to buy, track receipts, and log shopping time.

**Primary data displayed:** Active runs list, shopping plan (items needed per property), run details

**Page sections / layout:**
1. Back to dashboard button
2. Shopping run launcher (cleaner mode): mode selector, plan preview, run creation form, active runs list

**Forms / inputs:** Property selector, item selection from plan, quantity, payment method, receipt upload, shopping time log

**Key interactions:** Create new, Add items, Upload receipts, Log time, Complete run

**Connected APIs:** `GET /api/cleaner/inventory/shopping-plan`, `POST/PUT /api/cleaner/inventory/shopping-runs`

---

### `/cleaner/shopping/[id]` — Shopping Run Workspace

**Role:** CLEANER (also ADMIN/OPS_MANAGER for shared access)

**Purpose:** Active workspace for managing a single shopping run.

**Primary data displayed:** Run details, items checklist, receipts/expenses, time logged

**Page sections / layout:** Run header with back button, item checklist, receipt and expense tracking, shopping time summary

**Forms / inputs:** Item selection/quantity, receipt photo upload, expense notes

**Key interactions:** Check off purchased items, Upload receipts, Add expense notes, Submit for completion

**Connected APIs:** `GET/PUT /api/cleaner/inventory/shopping-runs/{id}`

---

### `/cleaner/stock-runs` — Stock Counts

**Role:** CLEANER (also ADMIN/OPS_MANAGER for shared access)

**Purpose:** Count actual stock levels on site and submit runs for admin review.

**Primary data displayed:** Stock count form, current vs expected counts, location-based sections

**Forms / inputs:** Quantity per item, location selector, notes

**Connected APIs:** `GET/PUT /api/cleaner/stock-runs`

---

# Client Portal

### `/client` — Client Dashboard

**Role:** CLIENT

**Purpose:** Central hub for property owners showing summary of active jobs, next scheduled service, immediate attention items, recent reports, finance overview, and property inventory status.

**Primary data displayed:**
- Properties count with status
- Active jobs count and next service details
- Recent reports from completed jobs
- Pending finance charges and invoice totals
- Low stock inventory by property
- Laundry service updates with dates and costs
- Property quick links with bed/bath counts

**Page sections / layout (top to bottom):**
1. Welcome hero with property name and action buttons (Quote, Book, All Jobs)
2. Next service card
3. Immediate attention panel (approvals, disputes, updates)
4. Stat cards (properties, active jobs, reports, pending charges/tracked items)
5. Main grid split into left (jobs, properties, inventory) and right (laundry, reports, finance)
6. Jobs preview (top 6 upcoming/active with status badges)
7. Properties grid (2–3 columns)
8. Inventory snapshot by property with low stock indicators
9. Laundry updates (pickup/return dates, price)
10. Recent reports with download links
11. Finance widget (rates, pending, invoices, total billed)

**Key interactions:** Click property cards to detail, View all buttons, Action buttons (Quote/Book/Jobs) shown per visibility settings

**Empty / loading / error states:** "No active jobs right now", "No properties found for this account", "No inventory tracked yet", "No laundry updates", "No reports yet"

**Connected APIs:** Finance overview, client portal context (visibility settings), job/report/laundry/stock data

---

### `/client/approvals` — Approvals

**Role:** CLIENT

**Purpose:** Track and manage approvals required from client (continuation requests, special approvals).

**Page sections / layout:** Client approvals workspace component (`<ClientApprovalsClient />`)

---

### `/client/booking` — Booking

**Role:** CLIENT

**Purpose:** Request and schedule new cleaning services at client properties.

**Primary data displayed:** Client properties list, booking wizard

**Page sections / layout:**
1. Booking wizard with property selection and date/time picker
2. Service type selection
3. Special instructions field
4. Confirmation summary

**Key interactions:** Select property, choose date/time/service, Submit booking request

**Connected APIs:** Properties list, booking creation

---

### `/client/calendar` — Calendar

**Role:** CLIENT

**Purpose:** Visual calendar view of all scheduled and completed jobs across properties by status.

**Primary data displayed:** Jobs mapped to dates, color-coded by status (unassigned, offered, assigned, in progress, submitted, QA review, completed, invoiced); job title (property), subtitle (job type), metadata (location, time, report status); status legend

**Page sections / layout:**
1. Calendar header
2. Full calendar grid with color-coded entries
3. Status legend
4. Job detail popup on tap/click

**Empty state:** "No jobs available for your properties right now"

**Connected APIs:** Jobs filtered by client and status

---

### `/client/cases` — Cases (Disputes Workspace)

**Role:** CLIENT

**Purpose:** Track and manage disputes, issues, or cases related to services. Delegated to `<ClientCasesWorkspace />`.

---

### `/client/disputes` — Disputes

**Role:** CLIENT

**Purpose:** Redirects to `/client/cases`.

---

### `/client/finance` — Finance

**Role:** CLIENT

**Purpose:** Overview of billing, service rates, billable charges, and invoice history with payment options.

**Primary data displayed:**
- Active property rates count
- Pending billable services count and total
- Invoices issued count
- Total billed
- Service rates by property and job type
- Recent billable services with invoice status
- Invoice history with payment status and links

**Page sections / layout (top to bottom):**
1. Page header with account name
2. Summary stat cards (4-col): rates, pending services, invoices, total billed
3. Two-column: rates | charges + invoices
4. Property rates card
5. Recent billable services (12 items max): property, type, date, amount, invoice status
6. Invoice history: number, dates, period, amount, status badge, pay button

**Key interactions:** Pay now on sent/approved invoices, Rates sorted by property and job type

**Empty / loading / error states:** "No property rates are available…", "No billable service records available yet", "No invoices have been issued yet"

**Connected APIs:** Client finance overview (rates, charges, invoices)

---

### `/client/inventory` — Inventory

**Role:** CLIENT

**Purpose:** View stock levels for all properties with filtering by property, search, and low stock alerts; link to shopping.

**Primary data displayed:** Properties count, total items shown, low stock count; per-property table (item, category, location, supplier, on-hand, par, threshold, status badge)

**Page sections / layout (top to bottom):**
1. Header with Back/Start Shopping buttons
2. Summary cards (3-col)
3. Filter card (property dropdown, search, low stock checkbox, apply/reset)
4. Inventory tables per property
5. Empty state or property sections

**Forms / inputs:** Property selector, search, low stock checkbox, submit/reset

**Empty state:** "No inventory items found for the selected filters"

**Connected APIs:** Property stock filtered by client, property, search, low status

---

### `/client/jobs` — Jobs Workspace

**Role:** CLIENT

**Purpose:** Comprehensive view of all jobs assigned to client properties with filtering, status tracking, and detail navigation. Delegated to `<ClientJobsWorkspace />`.

**Primary data displayed:** Visibility settings for cleaner names, task requests, laundry updates control feature visibility

**Connected APIs:** Client jobs list, portal visibility settings

---

### `/client/jobs/[id]` — Job Detail

**Role:** CLIENT

**Purpose:** Deep-dive view of a single job with live tracking (if en route), cost breakdown, laundry details, report download, and activity timeline.

**Primary data displayed:**
- Job status with timeline progress indicator
- Property address, suburb, state, postcode
- Scheduled date, start/due times, estimated vs actual hours
- Assigned cleaner name and photo with call button
- Live trip map and ETA (if en route)
- Laundry task status, dates, photos, bag location
- Invoice line items with unit price and totals
- Cleaning report with PDF download
- Satisfaction rating (1–5 stars)
- Activity timeline with audit logs

**Page sections / layout (top to bottom):**
1. Header with back, property name, status badge, job type, date, job number
2. Status timeline with workflow indicators
3. Tabs: Overview | Laundry | Costs | Report | Timeline
4. **Overview:** En-route card (if EN_ROUTE) with live map + ETA; Property card with address + Google Maps link; Schedule card; Cleaner card with image, name, call button; Service card; Satisfaction rating
5. **Laundry:** Pickup/return dates, status, update timeline with images
6. **Costs:** Line items with quantities and total
7. **Report:** Metadata and PDF download
8. **Timeline:** Audit log entries

**Key interactions:** Tabs, Call button (cleaner phone), Google Maps link, PDF download, Live ETA polling every 15s when EN_ROUTE

**Empty / loading / error states:** Loading spinner, "Job not found" with back button, "No activity recorded yet", "No laundry pickup required"

**Connected APIs:** `GET /api/client/jobs/{id}` (job, property, assignments, laundry, invoices, report, rating, audit logs)

---

### `/client/laundry` — Laundry Workspace

**Role:** CLIENT

**Purpose:** Track laundry service pickups, returns, and status updates with optional image galleries. Delegated to `<ClientLaundryWorkspace />`.

**Primary data displayed:** Visibility settings for laundry images control display

---

### `/client/messages` — Messages

**Role:** CLIENT

**Purpose:** Communication thread with support/admin team regarding properties and services. Delegated to `<ClientMessagesThread />`.

---

### `/client/profile` — Profile

**Role:** CLIENT

**Purpose:** Redirects to `/client/settings`.

---

### `/client/properties` — Properties

**Role:** CLIENT

**Purpose:** Grid view of all client properties with summary stats (jobs, inventory, unit count) and navigation to detail pages.

**Primary data displayed:** Property cards (2–3 columns): name, address, suburb, jobs count, inventory status, bed/bath count

**Page sections / layout:**
1. Header with title, description, Back button
2. Property cards grid

**Key interactions:** Click property card → `/client/properties/[id]`

---

### `/client/properties/[id]` — Property Detail

**Role:** CLIENT

**Purpose:** Complete property profile with job history, inventory, laundry schedule, checklist templates, activity feed, and condition media timeline.

**Primary data displayed:**
- Property name, address, suburb, state, postcode, bed/bath count
- Active job count, low stock items count, laundry updates count
- Checklist template preview by job type
- Inventory summary with low stock preview
- Laundry schedule with dates and update images
- Upcoming job updates with status and assignments
- Recent reports with download links
- Property activity feed (combined job, report, laundry, task events)
- Preferred cleaner selector
- Condition timeline with before/after media from completed jobs

**Page sections / layout (top to bottom):**
1. Back button + property header
2. Summary cards (4-col)
3. Two-column (left wide, right narrow):
   - **Left:** Checklist templates, inventory, laundry schedule
   - **Right:** Upcoming job updates, recent reports, activity feed, preferred cleaner card, condition timeline

**Key interactions:** Click jobs/reports for details, Download PDFs, Select preferred cleaner, View media gallery from laundry/condition

**Empty / loading / error states:** 404 if not found; "No active checklist templates found", "No inventory tracked", "No laundry updates", "No active jobs scheduled right now", "No reports available yet", "No recent activity", "No media history available yet"

**Connected APIs:** Property detail with jobs, laundry, inventory, reports, checklists, activity, media

---

### `/client/quote` — Quote Request

**Role:** CLIENT

**Purpose:** Submit a request for a quote on new or additional cleaning services. Renders `<RequestQuotePage />` in client mode.

**Connected APIs:** Quote submission endpoint

---

### `/client/referrals` — Referrals & Rewards

**Role:** CLIENT

**Purpose:** View referral program, track rewards, and manage referral links. Delegated to `<RewardsPage />`.

---

### `/client/reports` — Reports

**Role:** CLIENT

**Purpose:** Filterable list of completed job reports organized by date range and property with download capability.

**Primary data displayed:** Reports in selected time range, properties covered, list with property name, job type, date, download button; range buttons (weekly/monthly/annual); property filter buttons

**Page sections / layout (top to bottom):**
1. Header with range description and Back button
2. Range toggle buttons (3)
3. Property filter buttons (all + per-property)
4. Summary cards (2-col): reports in range, properties covered
5. Report list (icon, property, job type, date, download)

**Key interactions:** Toggle range (default monthly), Filter by property, Download PDF (hidden if disabled by admin)

**Empty state:** "No reports available for this period"

---

### `/client/settings` — Settings

**Role:** CLIENT

**Purpose:** Manage profile, account settings, and preferences. Delegated to `<ProfileSettings />`.

---

### `/client/shopping` — Shopping

**Role:** CLIENT

**Purpose:** Initiate inventory shopping run for selected property with cost tracking and receipt management.

**Primary data displayed:** Shopping run launcher, optional property pre-selection from query params

**Page sections / layout:**
1. Back to inventory button
2. Shopping run launcher with property selection

**Key interactions:** Select property, Launch run, Track items/costs in workspace

**Connected APIs:** `/api/client/inventory/shopping-plan`, `/api/client/inventory/shopping-runs`

---

### `/client/shopping/[id]` — Shopping Run

**Role:** CLIENT

**Purpose:** Active workspace for an ongoing shopping run with item selection, quantity tracking, receipt upload, and cost management. Delegated to `<ShoppingRunWorkspace />`.

**Connected APIs:** `/api/client/inventory/shopping-runs`

---

### `/client/stock-runs` — Stock Runs

**Role:** CLIENT

**Purpose:** Execute full property stock counts and submit for inventory reconciliation and audit. Delegated to `<StockRunWorkspace />`.

**Page sections / layout:** Stock run workspace with title "Stock Counts" and description "Run a full stock count for your property inventory and submit it for reconciliation"

**Connected APIs:** `/api/client/stock-runs`

---

# Laundry Portal

### `/laundry` — Laundry Dashboard

**Role:** LAUNDRY

**Purpose:** Real-time laundry task management interface for coordinating pickups, dropoffs, and completion tracking. Central hub for laundry workflow with visual status management and photo capture.

**Primary data displayed:**
- Active tasks with status (PENDING, CONFIRMED, PICKED_UP, DROPPED, FLAGGED)
- Task timeline (creation through completion)
- Property details, pickup/dropoff dates, bag counts
- Team posts from staff hub
- History of completed tasks

**Page sections / layout (top to bottom):**
1. Header with time range selector (day/week/month/all)
2. Tabs: Active | History
3. Filter controls: ready status (today/tomorrow/all), sort mode (pickup date, updated, property)
4. View toggle (compact/full)
5. Task cards with action buttons
6. Completed tasks section (collapsible)
7. Action dialogs for state transitions

**Key interactions:** Filter/sort, Mark PICKED_UP (optional bag count + photo), Mark RETURNED (dropoff location, weight, cost), Edit completion details, Revert completed tasks, Handle failed pickups (reschedule/skip/delete), QR scan for lookup, Generate QR codes, Camera upload for pickup/dropoff/receipt

**Forms / inputs:**
- Bag count (default 1), Pickup photo (optional/required per config)
- Dropoff location selector (with custom option), Dropoff photo (conditional)
- Receipt photo, Supplier dropdown
- Total cost, weight
- Early dropoff reason (required if applicable)
- Notes textarea
- Failed pickup: mode (reschedule/skip/delete), new date, reason

**Empty / loading / error states:** Empty message when no tasks; toasts for validation/submission errors; History tab for completed tasks

**Modals or drawers:** Action dialogs for PICKED_UP, RETURNED, EDIT_COMPLETED, REVERT; QR generator modal; Confirmation dialogs

**Connected APIs:** `/api/laundry/week`, `/api/laundry/history`, `/api/laundry/options`, `/api/me/workforce`

---

### `/laundry/calendar` — Laundry Calendar View

**Role:** LAUNDRY

**Purpose:** Calendar visualization of all laundry task pickup and dropoff events across properties, enabling scheduling and resource planning.

**Primary data displayed:**
- Pickup events (color-coded by status: PENDING, CONFIRMED, PICKED_UP, DROPPED, FLAGGED)
- Dropoff return events (light blue)
- Property names, suburbs, job types
- Event legend

**Page sections / layout:**
1. Page title and description
2. Calendar grid with events
3. Color legend

**Key interactions:** Click/tap events to preview booking details (mobile); pickup events show job type and location; dropoff events styled separately

**Empty state:** "No laundry tasks scheduled right now."

**Connected APIs:** `db.laundryTask.findMany()` server-side (up to 500 tasks)

---

### `/laundry/hub` — Laundry Team Hub

**Role:** LAUNDRY

**Purpose:** Staff workforce collaboration hub for team communication and announcements. Branded workspace for the laundry team.

**Primary data displayed:** Team posts and announcements (component-driven via `<StaffWorkforceHub />`)

---

### `/laundry/invoices` — Laundry Invoices & Billing

**Role:** LAUNDRY (also ADMIN/OPS_MANAGER for shared access)

**Purpose:** Generate and track laundry service invoices by time period and property, with cost reconciliation and PDF export.

**Primary data displayed:**
- Invoice items: task ID, property, dates, bag count, dropoff location, cost, status
- Period summary (daily/weekly/monthly/custom)
- Property breakdown: count of jobs and amounts
- Total invoice amount
- Invoice template (company name, title, footer)

**Page sections / layout (top to bottom):**
1. Period selector (daily/weekly/monthly/custom)
2. Anchor date picker
3. Property filter (all or single)
4. Toggle for full view vs summary
5. Live preview
6. Template editor
7. Download PDF button

**Key interactions:** Switch periods, Filter by property, Edit template, Preview, Download as PDF

**Forms / inputs:** Period mode, anchor date, custom start/end (custom range), property dropdown, template fields (company name, invoice title, footer note)

**Empty / loading / error states:** Loading state while fetching preview; toast errors

**Connected APIs:** `/api/laundry/invoice/preview`, `/api/laundry/invoice/template` (PATCH), `/api/laundry/invoice/download` (POST)

---

### `/laundry/profile` — Laundry Profile (Redirect)

**Role:** LAUNDRY

**Purpose:** Redirects to settings page; profile is managed via unified settings interface.

---

### `/laundry/settings` — Laundry Settings

**Role:** LAUNDRY

**Purpose:** Manage personal profile information, contact details, and account preferences for laundry team member. Delegated to `<ProfileSettings />`.

---

# Public Marketing Site

### `/` — Home / Landing Page

**Role:** Public

**Purpose:** Marketing homepage showcasing sNeek Property Services with trust signals, service overview, featured services, quote estimator, and customer testimonials. Redirects authenticated users to their role-specific dashboard.

**Primary data displayed:**
- Hero with value proposition
- Trust pills: insurance, guarantee, credentials, eco-friendly
- Featured services (6 of 9 marketed)
- Live quote estimator with real-time pricing
- Google reviews and ratings
- Blog posts (latest 3, if enabled)
- CTAs for booking and inquiry

**Page sections / layout (top to bottom):**
1. Hero section with WhatsApp CTA
2. Trust pills carousel
3. Featured services grid
4. Quote estimator (interactive calculator)
5. Why choose us section with icons
6. Google reviews carousel
7. Blog preview section
8. Final CTA section

**Key interactions:** Quote estimator (select service, input bedrooms/bathrooms, see live price), Service cards link to detail pages, Review carousel, Blog links, WhatsApp button

**SEO/marketing notes:**
- Meta: "Professional cleaning, Airbnb turnovers, property reports, laundry coordination, and practical property support across Greater Sydney"
- Schema.org LocalBusiness JSON-LD with hours, location, service area
- Open Graph for social sharing
- Maintenance mode support

---

### `/(public)/airbnb-hosting` — Airbnb Hosting Services

**Role:** Public

**Purpose:** Dedicated landing page for Airbnb property owners highlighting turnover cleaning, turnaround speed, and property readiness services.

**Primary data displayed:** Content configured in settings (Airbnb page content)

**Page sections / layout:**
1. Hero specific to Airbnb hosts
2. Service highlights
3. Availability and booking info

**Key interactions:** Link to quote/booking flow

**SEO/marketing notes:** Page gated behind website visibility toggle

---

### `/(public)/blog` — Blog Index

**Role:** Public

**Purpose:** Listing of published blog posts. Searchable, filterable archive of company knowledge content.

**Primary data displayed:** Published posts (dynamic list); metadata: title, excerpt, author, publish date, cover image

**Page sections / layout:**
1. Page title
2. Blog post grid/list
3. Post cards with preview

**Key interactions:** Click post for full article

**Connected APIs:** `listPublishedBlogPosts()`

**SEO/marketing notes:** Page gated behind blog visibility toggle

---

### `/(public)/blog/[slug]` — Blog Post Detail

**Role:** Public

**Purpose:** Display individual published blog article with full content, metadata, and related navigation.

**Primary data displayed:** Title, content, cover image, author name, publication date, excerpt for meta

**Page sections / layout:**
1. Hero with cover image
2. Post metadata (date, author)
3. Article body (rich text)
4. Related posts/navigation

**Empty / loading / error states:** 404 if slug not found

**Connected APIs:** `getPublishedBlogPostBySlug(slug)`

**SEO/marketing notes:** Dynamic metadata (title, description, canonical URL); Open Graph article type with image, dates, author; Schema.org Article JSON-LD

---

### `/(public)/careers` — Careers / Job Listings

**Role:** Public

**Purpose:** Job board showing published hiring positions with ability to apply directly.

**Primary data displayed:** Hiring positions: title, department, location, employment type, description

**Page sections / layout:**
1. Page title "Careers"
2. Position listings (grid or list)
3. Position cards with brief info and apply CTA

**Key interactions:** Click position to view details and apply

**Connected APIs:** `db.hiringPosition.findMany({ isPublished: true })`

**SEO/marketing notes:** Page gated behind careers visibility toggle

---

### `/(public)/cleaning/[suburb]` — Suburb-Specific Service Landing

**Role:** Public

**Purpose:** Location-specific landing pages for each Sydney suburb, highlighting local service availability and generating area-specific search traffic.

**Primary data displayed:** Suburb name, intro copy, service stats ("200+ homes served"), feature badges (photo reporting, Airbnb turnovers), service grid (first 9 marketed)

**Page sections / layout:**
1. Hero with suburb name
2. Intro copy and stat badges
3. Available services grid

**Key interactions:** Click service card for detail page

**Empty / loading / error states:** 404 if suburb not found

**Connected APIs:** Static routes from SYDNEY_SUBURBS list at build time

**SEO/marketing notes:** Suburb pages for organic geo search; generated for all serviced suburbs; location-specific intro

---

### `/(public)/compare` — Service Comparison

**Role:** Public

**Purpose:** Compare service offerings side-by-side to help prospects choose the right service tier or package.

**Primary data displayed:** Configured comparison from `settings.websiteContent.servicePages`

**Page sections / layout:**
1. Comparison table/matrix
2. Feature rows showing what's included per service

**SEO/marketing notes:** Page gated behind compareServices visibility toggle

---

### `/(public)/contact` — Contact Form & Information

**Role:** Public

**Purpose:** Centralized contact page with form for inquiries, support tickets, and general communication.

**Primary data displayed:** Contact form fields, business contact info from settings

**Page sections / layout:**
1. Header with company info
2. Contact form
3. Optional map or office details

**Forms / inputs:** Name, email, phone, message (component-managed)

**SEO/marketing notes:** Page gated behind contact visibility toggle

---

### `/(public)/faq` — Frequently Asked Questions

**Role:** Public

**Purpose:** Self-service FAQ section addressing common questions about booking, pricing, trust, and service delivery.

**Primary data displayed:** FAQ items (Q/A pairs); configurable from settings

**Page sections / layout:**
1. Page intro
2. Accordion list of Q&A pairs

**Key interactions:** Expand/collapse accordion items

**SEO/marketing notes:**
- Meta: "Frequently asked questions about booking, pricing, services, and trust — everything you need to know before your first clean"
- Schema.org FAQPage JSON-LD with Question/Answer entities

---

### `/(public)/privacy` — Privacy Policy

**Role:** Public

**Purpose:** Legal privacy policy documenting data collection, usage, and user rights. Required for compliance.

**Primary data displayed:** Title, intro, sections with subsections; data practices, rights, security

**Page sections / layout:**
1. Page header with title and intro
2. Card-based sections with body text and bullets

**SEO/marketing notes:** Page gated behind privacy visibility toggle

---

### `/(public)/quote` — Quote Request / Price Estimator

**Role:** Public

**Purpose:** Interactive quote form enabling prospects to request a service quote or estimate pricing based on property details.

**Primary data displayed:** Quote form and estimator (`<RequestQuotePage />` in public mode)

**Page sections / layout:**
1. Page header
2. Quote request form

**Key interactions:** Select service type, Input property details, Submit for quote

**SEO/marketing notes:** Page gated behind quote visibility toggle. Primary CTA for lead generation.

---

### `/(public)/services` — Services Overview

**Role:** Public

**Purpose:** Master listing of all available services with brief summaries and links to detailed service pages.

**Primary data displayed:** Service catalog: names, descriptions, taglines; cards with imagery

**Page sections / layout:**
1. Page title "Our Services"
2. Service grid/cards (name, description, link)

**Connected APIs:** `MARKETED_SERVICES` catalog from `lib/marketing/catalog`

**SEO/marketing notes:** Page gated behind services visibility toggle

---

### `/(public)/services/[slug]` — Service Detail Page

**Role:** Public

**Purpose:** In-depth landing page for individual service showcasing features, pricing guide, ideal use cases, and FAQs.

**Primary data displayed:** Service name, summary, hero image, what's included (bullets), what's not included, ideal for, price guide, FAQs; configurable per service

**Page sections / layout:**
1. Hero with service image
2. Service title and intro
3. What's included
4. What's not included
5. Ideal for
6. Price guide
7. FAQ accordion

**Key interactions:** Expand FAQ items, navigate to quote/booking

**SEO/marketing notes:** Dynamic metadata (title with service name, description from summary); generated static params for all marketed services; service-specific content from admin CMS

---

### `/(public)/subscriptions` — Subscription Plans

**Role:** Public

**Purpose:** Display available recurring subscription plans with pricing, features, and signup flow for repeat customers.

**Primary data displayed:** Published plans with name, pricing, features, billing frequency; CTA per plan

**Page sections / layout:**
1. Header "Subscription Plans"
2. Plan comparison cards
3. Feature lists per plan
4. Signup CTAs

**Key interactions:** Select/subscribe to plan

**Connected APIs:** `getPublishedSubscriptionPlans()`

**SEO/marketing notes:** Page gated behind subscriptions visibility toggle

---

### `/(public)/terms` — Terms & Conditions

**Role:** Public

**Purpose:** Legal terms of service and conditions for using the platform and booking services.

**Primary data displayed:** Title, intro, sections with body and bullets; public liability disclaimer (highlighted)

**Page sections / layout:**
1. Page header with title and intro
2. Public liability info box (highlighted)
3. Card-based sections with terms content

**SEO/marketing notes:** Page gated behind terms visibility toggle

---

### `/(public)/why-us` — Why Choose Us / About

**Role:** Public

**Purpose:** Differentiation and value proposition page highlighting company strengths, values, and competitive advantages.

**Primary data displayed:** Value props, mission/values, trust signals and credentials

**Page sections / layout:**
1. Page hero with headline
2. Value proposition sections
3. Trust/credibility section
4. Call-to-action

**SEO/marketing notes:** Page gated behind whyUs visibility toggle

---

# Auth & Onboarding

### `/(auth)/login` — User Login

**Role:** Public (auth)

**Purpose:** Credential-based authentication gateway for existing users to access their role-specific portal.

**Primary data displayed:** Login form (email/password); branding (company name, logo); maintenance mode messaging (if enabled); admin recovery login indicator

**Page sections / layout:**
1. Card with company branding
2. Email input
3. Password input
4. Submit button
5. Optional error alert
6. Register link (if not in maintenance)

**Forms / inputs:** Email (required), Password (required)

**Empty / loading / error states:** Loading during submission; error alert for invalid credentials; maintenance mode alert (blocks login unless admin recovery via `?admin=1`)

**Connected APIs:** `/api/auth/csrf`, `/api/auth/callback/credentials`, `/api/public/branding`, `/api/public/site-status`

---

### `/(auth)/register` — User Registration

**Role:** Public (auth)

**Purpose:** Onboarding new users (Cleaner or Client) with email verification and basic profile setup.

**Primary data displayed:** Registration form, branding, role-specific fields

**Page sections / layout:**
1. Registration form (step 1: account details)
2. Verification form (step 2: OTP code)
3. Company branding

**Key interactions:** Select role (CLEANER/CLIENT), Enter name/email/password/phone, If CLIENT: business name + address, Submit and receive OTP, Enter OTP to verify, Resend OTP if needed

**Forms / inputs (Step 1):** Name (required), Email (required), Password (min 8 chars), Confirm password, Role radio (CLEANER | CLIENT), Phone (optional), If CLIENT: business name + address

**Forms / inputs (Step 2):** OTP code (6 digits)

**Empty / loading / error states:** Loading during submission; verifying state during OTP check; error alerts for validation failures, duplicate email, invalid OTP

**Connected APIs:** `/api/public/branding`, `/api/public/site-status`, `/api/auth/register`

---

### `/apply/[slug]` — Job Application

**Role:** Public (auth)

**Purpose:** Dedicated application page for prospective employees to apply for published job positions.

**Primary data displayed:** Position details (title, description, department, location, employment type); application form

**Page sections / layout:**
1. Position header and details
2. Position description
3. Application form

**Empty / loading / error states:** 404 if position not published or slug not found

**Connected APIs:** `getPublicHiringPosition(slug)`

---

### `/feedback/[token]` — Job Feedback / Review

**Role:** Public (token-protected)

**Purpose:** Time-limited feedback collection page allowing clients to rate and comment on completed service jobs via secure token.

**Primary data displayed:** Property name, service type, scheduled date; feedback form (rating + comment); token validity status

**Page sections / layout:**
1. Page header with job info
2. Feedback form (rating scale, comment textarea)
3. Submit button

**Forms / inputs:** Rating (star or 1–5), Comment (textarea, optional)

**Empty / loading / error states:** 404 if token not found or expired; validity check before rendering form

**Connected APIs:** `db.jobFeedback.findUnique({ where: { token }})` with job details; token expiration validation

---

### `/force-password-reset` — Forced Password Reset

**Role:** Authenticated (redirected on login)

**Purpose:** Temporary password reset flow when user has been assigned a temporary/reset password by admin and must set a new one before accessing the portal.

**Primary data displayed:** Password reset form

**Page sections / layout:**
1. Card with title and description
2. Current password
3. New password (min 8)
4. Confirm password
5. Submit button
6. Error alert if validation fails

**Forms / inputs:** Current temporary password (required), New password (min 8), Confirm new password

**Empty / loading / error states:** Validation: password length, confirmation match; error alert for failed updates; redirect to dashboard on success

**Connected APIs:** `POST /api/me/password`

---

### `/onboarding` — User Onboarding Flow

**Role:** Authenticated (new users)

**Purpose:** Guided onboarding for new users to complete profile setup, provide banking/business details, and complete orientation tour before portal access.

**Primary data displayed:** Step-based tour (4 steps), profile form (role-specific), tutorial walkthrough

**Page sections / layout:**
1. Tour step (if not seen before)
2. Profile form (role-specific)
3. Submit button

**Forms / inputs:**
- Name (required), Phone (optional), Address (Google Places autocomplete)
- If CLIENT or LAUNDRY: Business name, ABN (optional)
- If CLEANER or LAUNDRY: Bank details (account name, bank name, BSB, account number)

**Empty / loading / error states:** Loading during initial fetch; validation errors on submit; missing required fields shown

**Connected APIs:** `GET /api/me/onboarding`, `POST /api/me/onboarding`

---

### `/rate/[jobId]` — Job Rating / Satisfaction Survey

**Role:** Public (token-protected)

**Purpose:** Client satisfaction survey for rating completed jobs. Similar to feedback but potentially used for internal metrics.

**Primary data displayed:** Property name, service type, scheduled date; rating form

**Page sections / layout:**
1. Page header with job context
2. Rating input (star scale)
3. Comment textarea
4. Submit button

**Forms / inputs:** Score (1–5 star, optional), Comment (textarea, optional)

**Empty / loading / error states:** 404 if not found or token invalid; validity check before form display

**Connected APIs:** `db.job.findUnique({ jobId })` with rating + property; token validation via `buildRatingToken(jobId, clientId)`

---

### `/unauthorized` — Access Denied

**Role:** Any (error page)

**Purpose:** User-friendly error page shown when authenticated user attempts to access a resource they lack permission for (403 Forbidden).

**Primary data displayed:** 403 error code, permission denied message, home navigation link

**Page sections / layout:**
1. Error code heading
2. Error message
3. Home button

---

# Appendix: Notes for the Redesign AI

### Recurring patterns that should standardize across the app
- **Header pattern:** title + description + primary action button on the right. Used on every list page.
- **Filter card pattern:** collapsible/inline filter row with search, dropdowns, date range, apply/reset. Used on jobs, reports, inventory, integrations, approvals.
- **Stat cards row:** 3–6 small metric cards with icon, label, number, optional drill-down link. Used on dashboards.
- **Two-column hub:** left wide content + right narrow sidebar. Used on client property detail, client dashboard, admin client hub.
- **Tabs across the top:** within a workspace (Builder/Submissions, Active/Completed, Pending/All). Heavy use.
- **Empty state pattern:** plain-text message in a card. Some have CTAs, most don't.
- **Two-step destructive confirm:** dialog requires PIN or password. Consistent across user delete, job delete, integration disable, log clear.
- **Toast feedback:** save success/error via radix toast.

### Mobile vs desktop
- **Cleaner portal** is the only truly mobile-first portal. Touch targets, swipe gestures, camera/GPS integration baked into job detail flow.
- **Client portal** is responsive but designed primarily for desktop/tablet.
- **Admin portal** is desktop-first with dense data tables, kanban boards, multi-column layouts.
- **Laundry portal** mixes both — task cards work on mobile but the dashboard density assumes tablet+.

### Visibility flags (client portal redesign consideration)
The 21 per-client visibility toggles on `/admin/clients/[id]/edit` mean **every client page must gracefully handle being hidden**. The redesign must accommodate:
- Section-level hiding (Reports, Inventory, Laundry, Finance Details, etc.)
- Action-level hiding (cleaner names, task requests, laundry images)
- Empty-state behavior when modules are entirely disabled

### Areas overdue for redesign attention
- **`/admin/jobs`** — heaviest page in the app; filter UI, kanban view, bulk actions, and QA review all share screen real estate. Currently information-dense to the point of overwhelming.
- **`/cleaner/jobs/[id]`** — multi-step workspace with conditional fields, photo uploads, signature capture, and laundry outcomes. UX should feel like a guided wizard, not a long form.
- **`/admin/onboarding/new`** — 11-step wizard. Step navigation and progress visibility need rework.
- **`/client`** — many sections compete for attention; needs information hierarchy.
- **Approvals UX** — pay-adjustments, time-adjustments, continuations, and `/admin/approvals` all overlap. Could be unified.
- **Forms builder (`/admin/forms`)** — drag-and-drop with conditional logic is inherently complex; current implementation may benefit from a left-rail/preview/right-config split.
