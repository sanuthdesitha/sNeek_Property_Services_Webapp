# sNeek Ops — 6-Feature Implementation Plan

## Context

A batch of user-reported bugs and feature requests across the sNeek Property Service Website covering: broken client reschedule approvals, iCal sync overwriting manually-rescheduled jobs, missing admin reschedule UI, intrusive autocomplete on public pages, admin-added per-property checklist items, inaccurate location tracking, real-time admin map, cleaner contact visibility for clients, and a full "cleaner on the way" workflow with ETA and notifications.

---

## Scope Overview

| # | Feature | Complexity |
|---|---------|-----------|
| 1 | Fix client reschedule request flow | Medium |
| 2 | Manual reschedule protection + admin reschedule dialog | Medium |
| 3 | Remove recent suggestions from public pages | Trivial |
| 4 | Admin one-off checklist items for next property job | Low |
| 5 | Location tracking accuracy + admin real-time map + EN_ROUTE with ETA | High |
| 6 | Client notifications per-event + per-client settings + cleaner contact visibility | Medium |

---

## Phase 1 — Prisma Schema Changes (run first, all at once where possible)

### Migration A — `add_reschedule_fields`
Add to `model Job`:
```prisma
manuallyRescheduledAt  DateTime?
rescheduledBy          String?
```

Add to `model JobTask`:
```prisma
metadata   Json?
```

### Migration B — `add_en_route_and_location_pings`
Add to `JobStatus` enum: `EN_ROUTE` (between ASSIGNED and IN_PROGRESS)

Add to `model Job`:
```prisma
enRouteStartedAt  DateTime?
cleanerLocationPings CleanerLocationPing[]
```

New model:
```prisma
model CleanerLocationPing {
  id        String   @id @default(cuid())
  jobId     String
  userId    String
  lat       Float
  lng       Float
  accuracy  Float?
  heading   Float?
  speed     Float?
  timestamp DateTime @default(now())

  job  Job  @relation(fields: [jobId], references: [id], onDelete: Cascade)
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([jobId, timestamp])
  @@index([userId, timestamp])
}
```

Add `cleanerLocationPings CleanerLocationPing[]` to `model User`.

### Migration C — `add_client_notification_prefs`
Add to `model Property`:
```prisma
showCleanerContactToClient Boolean @default(false)
```

New model:
```prisma
model ClientNotificationPreference {
  clientId             String  @id
  notificationsEnabled Boolean @default(true)
  notifyOnEnRoute      Boolean @default(true)
  notifyOnJobStart     Boolean @default(true)
  notifyOnJobComplete  Boolean @default(true)
  preferredChannel     String  @default("EMAIL")  // "EMAIL" | "SMS" | "BOTH"
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  client Client @relation(fields: [clientId], references: [id], onDelete: Cascade)
}
```

Add `notificationPreference ClientNotificationPreference?` to `model Client`.

---

## Feature 1 — Fix Client Reschedule Request Flow

### Problem
- Client reschedule requests stored as `JobTask { source: CLIENT, approvalStatus: PENDING_APPROVAL }` but the `requestedDate` is only in the description string
- `app/api/admin/all-approvals/route.ts` does not query these JobTasks
- `reviewJobTaskRequest()` approves the task but never updates the job's `scheduledDate`

### Changes

**`lib/job-tasks/service.ts`** — `createClientJobTaskRequest()`:
- Add `metadata?: Record<string, unknown> | null` to input type
- Pass to `db.jobTask.create({ data: { ..., metadata } })`

**`app/api/client/jobs/[id]/reschedule-request/route.ts`**:
- Pass `metadata: { type: "RESCHEDULE_REQUEST", requestedDate: body.requestedDate, requestedStartTime: body.startTime ?? null }` when calling `createClientJobTaskRequest()`

**`lib/job-tasks/service.ts`** — `reviewJobTaskRequest()`:
- After setting `approvalStatus: APPROVED`, check `task.metadata?.type === "RESCHEDULE_REQUEST"` and `task.metadata?.requestedDate`
- If true, call `applyReschedule({ jobId: task.jobId, date: task.metadata.requestedDate, startTime: task.metadata.requestedStartTime, userId: actorId, reason: "Client reschedule request approved" })` from `lib/phase4/analytics.ts`

**`app/api/admin/all-approvals/route.ts`**:
- Add 7th parallel query: `db.jobTask.findMany({ where: { source: "CLIENT", approvalStatus: "PENDING_APPROVAL" }, include: { job: { ... }, requestedBy: { select: { id, name, email } } } })`
- Filter in JS by `task.metadata?.type === "RESCHEDULE_REQUEST"` (safer than JSON path query)
- Add `rescheduleRequests` to response and `counts`

**`app/admin/approvals/page.tsx`**:
- Add `rescheduleRequests` to `AllApprovals` type
- Add a new tab: "Reschedule Requests" (Calendar icon)
- Each row: job number, property, current date, requested date, client name, submitted time, Approve/Reject buttons
- Approve/Reject calls existing `PATCH /api/admin/job-tasks/[id]` with `{ decision: "APPROVE" | "REJECT" }`

**`app/api/admin/jobs/route.ts`** (jobs list):
- Add a subquery to count pending reschedule JobTasks per job → return as `_pendingRescheduleCount`

**`app/admin/jobs/page.tsx`**:
- Show a small amber badge next to job rows that have `_pendingRescheduleCount > 0`

---

## Feature 2 — Manual Reschedule Protection + Admin Reschedule Dialog

### Problem
- iCal sync overwrites job dates for any non-COMPLETED/INVOICED job
- No way to tell iCal sync a job was manually rescheduled
- Admin reschedule UI exists only as an AI-suggest flow (phase4); no simple date-picker dialog

### Changes

**`lib/phase4/analytics.ts`** — `applyReschedule()`:
- Add to `db.job.update` data: `manuallyRescheduledAt: new Date(), rescheduledBy: input.userId`

**`lib/ical/sync.ts`**:
- Add `manuallyRescheduledAt: true` to the existing job select
- In the block that updates job `scheduledDate`/`startTime`/`dueTime` (near line 731–751), wrap date-field assignments in a conditional: `if (!existingJob.manuallyRescheduledAt)` — skip overwriting these three fields if manually rescheduled. Allow all other field updates (estimatedHours, notes, etc.) to continue.

**`app/admin/jobs/[id]/page.tsx`**:
- Add "Reschedule" button in the job header actions area
- On click, open a `Dialog` with:
  - `<Input type="date">` for new date (prefilled with current scheduledDate)
  - `<Input type="time">` for start time (optional)
  - `<Input type="time">` for due time (optional)
  - Reason textarea
  - Submit calls `POST /api/admin/phase4/reschedule/[jobId]/apply` (existing route, no changes needed)
- Show a notice when `job.manuallyRescheduledAt` is set: "Manually rescheduled on [date] · iCal sync will not overwrite this date" with a "Reset to iCal" button that calls a new `DELETE /api/admin/jobs/[id]/manual-reschedule` route that clears `manuallyRescheduledAt`

**New**: `app/api/admin/jobs/[id]/manual-reschedule/route.ts` (DELETE only):
- Clears `manuallyRescheduledAt` and `rescheduledBy` on the job so iCal sync can resume normal behavior

---

## Feature 3 — Remove Recent Suggestions from Public Pages

### Problem
`TextHistorySuggestions` in `app/providers.tsx` renders on all pages including public-facing pages (`/quote`, `/contact`, `/blog`, etc.)

### Change — one file

**`components/shared/text-history-suggestions.tsx`**:
After the `const pathname = usePathname()` line, add:

```typescript
const PUBLIC_PATH_PREFIXES = [
  "/airbnb-hosting", "/blog", "/careers", "/cleaning",
  "/compare", "/contact", "/faq", "/privacy", "/quote",
  "/services", "/subscriptions", "/terms", "/why-us",
];
const isPublicPath = PUBLIC_PATH_PREFIXES.some(
  (p) => pathname === p || pathname.startsWith(p + "/")
);
if (isPublicPath) return null;
```

Place this before any `useEffect` hooks (return null after all hooks are called — no React rules violation since hooks are already declared above).

---

## Feature 4 — Admin One-Off Checklist Items for Next Property Job

### Problem
Carry-forward and admin JobTask infrastructure already exists, but there's no UI to add a task to "the next cleaning job for property X" without knowing the job ID.

### Changes

**`lib/job-tasks/service.ts`** — new export:
```typescript
export async function attachPendingAdminTasksToJob(input: {
  jobId: string;
  propertyId: string;
}): Promise<{ attached: number }>
```
Calls `db.jobTask.updateMany` where `propertyId=input.propertyId, source="ADMIN", jobId=null, approvalStatus="AUTO_APPROVED", executionStatus="OPEN"` → sets `jobId=input.jobId, visibleToCleaner=true`.

**`lib/ical/sync.ts`** — in the job creation block (same place `attachPendingCarryForwardTasksToJob` is called):
- Import and call `attachPendingAdminTasksToJob({ jobId: newJob.id, propertyId })` right after the existing carry-forward call

**`app/api/admin/jobs/[id]/assign/route.ts`** (or wherever ASSIGNED transition happens):
- Call `attachPendingAdminTasksToJob({ jobId, propertyId: job.propertyId })` after status update

**New**: `app/api/admin/properties/[id]/pending-tasks/route.ts`:
- `GET` — list `JobTask { source: ADMIN, jobId: null, propertyId: [id], executionStatus: OPEN }`
- `POST` — create JobTask with `source: "ADMIN", propertyId, jobId: null, approvalStatus: "AUTO_APPROVED", executionStatus: "OPEN", visibleToCleaner: false`; then call `attachPendingAdminTasksToJob` to immediately attach if a next job exists
- Body: `{ title, description?, requiresPhoto?, requiresNote? }`

**New**: `app/api/admin/properties/[id]/pending-tasks/[taskId]/route.ts` (DELETE):
- Sets `executionStatus: "CANCELLED"` for unattached tasks only

**`app/admin/properties/[id]/page.tsx`**:
- Add a "Next Job Checklist" section/tab
- Fetch and list pending admin tasks
- "Add Task for Next Clean" button → inline form with title, description, requiresPhoto/Note checkboxes
- Each existing task row shows title, requirements, and a Cancel button
- Note: once a task is attached to a job (has jobId), it moves out of this list naturally

---

## Feature 5 — Location Tracking + EN_ROUTE + Admin Real-Time Map

### 5A — Fix GPS Accuracy (quick win)

**`app/cleaner/jobs/[id]/page.tsx`**:
- Find all `navigator.geolocation.getCurrentPosition(` calls
- Add third argument: `{ enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }`

### 5B — New API Routes

**New**: `app/api/cleaner/jobs/[id]/start-driving/route.ts` (POST):
- Auth: `requireRole([Role.CLEANER])`
- Validates job is ASSIGNED and assigned to this cleaner
- Updates: `status: "EN_ROUTE"`, `enRouteStartedAt: new Date()`
- Calls `sendClientJobNotification({ jobId, type: "EN_ROUTE", etaMinutes })` (Feature 6)
- Returns updated job

**New**: `app/api/cleaner/jobs/[id]/location-ping/route.ts` (POST):
- Auth: `requireRole([Role.CLEANER])`
- Body: `{ lat, lng, accuracy?, heading?, speed? }`
- Rate-limit: skip if last ping for this job was < 10 seconds ago
- Creates `CleanerLocationPing` record
- Returns `{ ok: true }`

**New**: `app/api/admin/live-locations/route.ts` (GET):
- Auth: `requireRole([Role.ADMIN, Role.OPS_MANAGER])`
- Query: latest `CleanerLocationPing` per active job where timestamp > now() - 10min
- For each EN_ROUTE job, call `getEtaMinutes()` (cache 5 min)
- Returns: `[{ jobId, jobNumber, cleanerName, lat, lng, timestamp, propertyLat, propertyLng, etaMinutes }]`

### 5C — ETA Utility

**New**: `lib/jobs/eta.ts`:
```typescript
export async function getEtaMinutes(input: {
  fromLat: number; fromLng: number; toLat: number; toLng: number;
}): Promise<number | null>
```
- Calls Google Maps Distance Matrix API (server-side, uses `process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — already set in `.env`)
- Returns driving duration in minutes, or `null` on failure

### 5D — Cleaner Job Page: Start Driving + watchPosition

**`app/cleaner/jobs/[id]/page.tsx`**:
- Add `watchIdRef = useRef<number | null>(null)` 
- Add `useEffect` cleanup: `return () => { if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current) }`
- When job status is `ASSIGNED`: show "Start Driving" button
- On click: `POST .../start-driving` → on success, start `navigator.geolocation.watchPosition(pos => fetch(.../location-ping, {...}), err => ..., { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 })`; store watchId in ref
- Show an amber banner when EN_ROUTE: "Location tracking active — GPS is on"
- On GPS check-in (existing button): clear watchPosition first, then proceed with `getCurrentPosition`
- Add a "Stop Driving" button (for EN_ROUTE status) that calls a `POST .../stop-driving` route setting status back to ASSIGNED and clearing `enRouteStartedAt`

**New**: `app/api/cleaner/jobs/[id]/stop-driving/route.ts` (POST):
- Sets `status: "ASSIGNED"`, `enRouteStartedAt: null`

### 5E — Admin Real-Time Map Update

**`app/admin/ops/map/page.tsx`**:
- Add a new `<LiveCleanerLayer />` client component rendered within the page
- `LiveCleanerLayer` polls `GET /api/admin/live-locations` every 30s via `setInterval`
- Renders a floating card or overlay list of EN_ROUTE cleaners with: name, job number, ETA, last updated time
- Since the page currently renders Google Maps via iframe/embed, the live layer can be a card panel alongside the map rather than pins on the map (avoids needing Google Maps JS SDK integration)

### 5F — pg-boss ETA Update Job

**`workers/boss.ts`**:
- Add scheduled job `eta-update` running `*/5 * * * *`
- Finds all EN_ROUTE jobs with a ping in the last 5 minutes
- For each: calculates ETA via `getEtaMinutes()`, compares to last sent ETA (store in `job.internalNotes` as JSON or a simple in-memory map)
- If ETA changed by > 5 minutes: calls `sendClientJobNotification({ jobId, type: "EN_ROUTE_UPDATE", etaMinutes })` (new sub-type or update existing EN_ROUTE handler)

### 5G — Cleanup Job

**`workers/boss.ts`**:
- Add scheduled job `location-pings-cleanup` running `0 3 * * *`
- `DELETE FROM "CleanerLocationPing" WHERE timestamp < NOW() - INTERVAL '7 days'`

### 5H — JobStatus enum additions across codebase

After migration, search for `JobStatus` usage and update:
- `app/admin/ops/map/page.tsx` `ACTIVE_STATUSES` set → add `"EN_ROUTE"`
- Any exhaustive switch statements on JobStatus

---

## Feature 6 — Client Notifications + Per-Client Settings + Cleaner Contact

### 6A — Notification Helper

**New**: `lib/notifications/client-job-notifications.ts`:
```typescript
export async function sendClientJobNotification(input: {
  jobId: string;
  type: "EN_ROUTE" | "EN_ROUTE_UPDATE" | "JOB_STARTED" | "JOB_COMPLETE";
  etaMinutes?: number | null;
}): Promise<void>
```
Flow:
1. Fetch job + property + client
2. Fetch `ClientNotificationPreference` for `clientId` (upsert with defaults if missing)
3. Check `notificationsEnabled` and the relevant event toggle
4. Find `User` where `clientId = client.id` and `role = "CLIENT"`
5. Build message per type; for EN_ROUTE: include ETA string
6. Call `deliverNotificationToRecipients()` using `preferredChannel` to select channels

### 6B — Wire Notification Triggers

**`app/api/cleaner/jobs/[id]/start-driving/route.ts`** (Feature 5B):
- After status update, call `sendClientJobNotification({ jobId, type: "EN_ROUTE", etaMinutes })`
- Compute initial ETA from cleaner's current GPS position (passed in POST body alongside status change)

**`app/api/cleaner/jobs/[id]/start/route.ts`**:
- After `IN_PROGRESS` transition, add: `sendClientJobNotification({ jobId, type: "JOB_STARTED" })` (non-blocking, fire-and-forget)

**`app/api/cleaner/jobs/[id]/submit/route.ts`** (or wherever SUBMITTED transition happens):
- After status change, add: `sendClientJobNotification({ jobId, type: "JOB_COMPLETE" })` (fire-and-forget)

### 6C — Admin Per-Client Notification Settings UI

**New**: `app/api/admin/clients/[id]/notification-preferences/route.ts`:
- `GET` — upsert-read `ClientNotificationPreference` for client; return current values
- `PUT` — update `ClientNotificationPreference`

**`app/admin/clients/[id]/page.tsx`**:
- Add "Notifications" section with:
  - Master toggle: "Notifications enabled" (Switch)
  - Channel: Email / SMS / Both (RadioGroup or Select)
  - Event toggles: On the way / Cleaning started / Cleaning complete
- Loads from GET, saves via PUT

### 6D — Cleaner Contact Visibility

**`app/api/admin/properties/[id]/route.ts`** (PATCH handler):
- Accept `showCleanerContactToClient` in patch body and include in `db.property.update`

**`app/admin/properties/[id]/page.tsx`**:
- Add Switch "Show cleaner contact details to client" bound to `property.showCleanerContactToClient`

**`app/api/client/jobs/[id]/route.ts`**:
- Add `showCleanerContactToClient: true` to property select
- Add `phone: true` to cleaner user select
- In response, conditionally include cleaner phone: `...(job.property.showCleanerContactToClient ? { phone: a.user.phone } : {})`

**`app/client/jobs/[id]/page.tsx`**:
- When `assignment.user.phone` is present: render a contact card with name, avatar, and `<a href="tel:{phone}">` call button

---

## Feature 7 — Client Job Command Center (Communications Hub)

### Concept
A dedicated page `/admin/clients/[id]/hub` giving ops a single-screen view of all activity for one client: upcoming and past jobs, real-time cleaner status + location, all communications (email/SMS log), manual send actions, feedback collection, and post-job automation rules.

### Schema Changes (add to Migration C or new Migration D)

**Add to `model Client`:**
```prisma
lastReviewRequestSentAt DateTime?
```

**New model — message templates:**
```prisma
model MessageTemplate {
  id         String   @id @default(cuid())
  name       String
  triggerType String  // "POST_JOB" | "REVIEW_REQUEST" | "DISCOUNT" | "NEXT_CLEAN" | "MANUAL"
  jobType     String? // null = all job types; "AIRBNB_TURNOVER" etc for specific
  channel     String  // "EMAIL" | "SMS"
  subject     String? // email subject (supports {{variables}})
  body        String  @db.Text // template body with {{client_name}}, {{property_address}}, {{cleaner_name}}, {{next_clean_date}}, {{job_type}}, {{feedback_url}} etc.
  isActive    Boolean @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

**New model — post-job automation rules per client:**
```prisma
model ClientAutomationRule {
  id            String   @id @default(cuid())
  clientId      String
  triggerType   String   // "POST_JOB_REVIEW" | "POST_JOB_NEXT_CLEAN" | "POST_JOB_DISCOUNT" | "POST_JOB_CUSTOM"
  jobType       String?  // null = all job types
  templateId    String?  // MessageTemplate to use
  delayMinutes  Int      @default(120) // delay after job completion before sending
  isEnabled     Boolean  @default(false) // OFF by default — admin must enable per client
  channel       String   @default("EMAIL")
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  client   Client          @relation(fields: [clientId], references: [id], onDelete: Cascade)
  template MessageTemplate? @relation(fields: [templateId], references: [id])
}
```

**New model — client feedback:**
```prisma
model JobFeedback {
  id          String   @id @default(cuid())
  jobId       String   @unique
  clientId    String
  token       String   @unique @default(cuid()) // public-facing token for URL
  rating      Int?     // 1–5, null until submitted
  comment     String?  @db.Text
  submittedAt DateTime?
  tokenExpiresAt DateTime
  createdAt   DateTime @default(now())

  job    Job    @relation(fields: [jobId], references: [id], onDelete: Cascade)
  client Client @relation(fields: [clientId], references: [id])
}
```

Add relations to `Client`: `automationRules ClientAutomationRule[]`, `feedback JobFeedback[]`
Add relation to `Job`: `feedback JobFeedback?`

**Update `Notification` model** — add `deliveryStatus String? @default("PENDING")` to capture Resend webhook updates (DELIVERED | BOUNCED | OPENED).

### New Pages & Routes

**`app/admin/clients/[id]/hub/page.tsx`** (new page):
Layout:
- Header: client name, property count, master notification toggle (link to client profile for full settings)
- Filter: All Jobs / Active / Upcoming / Completed
- Job cards in reverse chronological order, each showing:
  - Job number, property name, date, type, status badge
  - Cleaner name + last known status (EN_ROUTE with ETA if active, or GPS check-in time)
  - Last 2 communications (email/SMS) with timestamp and delivery status icon
  - Quick actions: "Send Message", "View Feedback", "Add Task"
  - Deep-link buttons (1 click each): Full Job → Laundry Job (if any) → Form Submission → Time Log → Invoice
- For active EN_ROUTE jobs: embed a live ETA panel (polls `/api/admin/live-locations` filtered to this client's jobs)

**`app/(public)/feedback/[token]/page.tsx`** (new public page — no auth required):
- Simple form: 1–5 star rating + optional comment + submit
- Token validated server-side; if expired → show "This link has expired" message
- On submit: updates `JobFeedback.rating`, `JobFeedback.comment`, `JobFeedback.submittedAt`
- Returns thank-you page

**`app/api/admin/clients/[id]/hub/route.ts`** (GET):
- Returns all jobs for client with: status, cleaner assignments + last location ping, last 3 notifications per job, feedback status
- Used by the hub page

**`app/api/admin/clients/[id]/send-message/route.ts`** (POST):
- Body: `{ jobId?, cleanerId?, userId, channel, templateId?, subject?, body, variables: Record<string, string> }`
- Resolves template variables from job/client/property context
- Calls `deliverNotificationToRecipients()` directly
- Logs to `Notification` table

**`app/api/admin/message-templates/route.ts`** (GET/POST) + `app/api/admin/message-templates/[id]/route.ts` (GET/PATCH/DELETE):
- Full CRUD for `MessageTemplate`
- Admin manages templates at `/admin/settings/templates` (or a section of existing settings page)

**`app/api/admin/clients/[id]/automation-rules/route.ts`** (GET/POST/PUT):
- CRUD for `ClientAutomationRule` per client
- Used by client profile "Automation" section

**`app/api/public/feedback/[token]/route.ts`** (POST):
- No auth; validates token, checks expiry, upserts `JobFeedback`
- Returns `{ ok: true }`

**`app/api/webhooks/resend/route.ts`** (POST — new webhook endpoint):
- Receives Resend delivery events (delivered, bounced, opened)
- Matches by `Notification` record (store Resend message ID in a `Notification.externalId` field)
- Updates `Notification.deliveryStatus` and `Notification.status`

### Post-Job Automation via pg-boss

**`workers/boss.ts`** — new queue: `post-job-followup`:
- Triggered when job transitions to SUBMITTED/COMPLETED
- Enqueues with `startAfter: delayMinutes` based on matching `ClientAutomationRule`
- Handler:
  1. Finds enabled `ClientAutomationRule` for `clientId + jobType`
  2. For review requests: checks `lastReviewRequestSentAt` — skip if sent within 3 days
  3. Resolves template variables: `{{client_name}}`, `{{property_address}}`, `{{cleaner_name}}`, `{{next_clean_date}}` (next upcoming job at property), `{{feedback_url}}` (public feedback URL with token), `{{job_type}}`
  4. Creates/sends notification via `deliverNotificationToRecipients()`
  5. For review rule: updates `Client.lastReviewRequestSentAt`
  6. Also creates `JobFeedback` record with token when sending review request (so the link works)

**Trigger point**: In `app/api/cleaner/jobs/[id]/submit/route.ts`, after status change, enqueue `post-job-followup` job in pg-boss with `{ jobId, clientId }`.

### Client Profile: Automation Settings Section

**`app/admin/clients/[id]/page.tsx`** — add "Automation" tab/section:
- List of `ClientAutomationRule` for this client
- Per rule: trigger type label, job type filter, template name, delay, channel, enabled toggle
- "Add Rule" button → dialog to create new rule (select trigger type, job type, template, delay, channel)
- Link to template library for editing templates

### Communication Log in Hub

Each job card's communication panel:
- Fetches `Notification` records where `jobId = job.id` OR `userId IN [cleaner user IDs for this job]`
- Shows: recipient name, channel (email/SMS badge), subject/preview, timestamp, delivery status dot (green=delivered, yellow=pending, red=bounced, gray=opened)
- "View all" expands to full log for that job

### Admin Feedback View

- Feedback summary shown on the hub page per job: star rating badge + comment preview
- `app/admin/jobs/[id]/page.tsx` — add feedback panel showing rating, comment, submitted time

---

## Implementation Order

```
Migrations (A, B, C, D) → regenerate Prisma client
  ↓
Feature 3 (trivial, one file, zero risk — do first)
  ↓
Feature 1 (reschedule request flow fix)
  ↓
Feature 2 (manual reschedule protection + admin dialog)
  ↓
Feature 4 (property pending tasks)
  ↓
Feature 6 (notifications + cleaner contact — no dependency on Feature 5)
  ↓
Feature 7A (MessageTemplate CRUD + client automation rules + hub page skeleton)
  ↓
Feature 5 (EN_ROUTE + location pings + ETA + real-time map — most complex)
  ↓
Feature 7B (hub page live layer + feedback flow + post-job automation in pg-boss + Resend webhook)
```

---

## Critical Files to Modify

| File | Changes |
|------|---------|
| `prisma/schema.prisma` | 3 migrations: JobTask.metadata, Job reschedule fields, EN_ROUTE enum, CleanerLocationPing model, Property.showCleanerContactToClient, ClientNotificationPreference model |
| `lib/job-tasks/service.ts` | createClientJobTaskRequest metadata, reviewJobTaskRequest → applyReschedule on approval, new attachPendingAdminTasksToJob() |
| `lib/ical/sync.ts` | Skip date fields when manuallyRescheduledAt set; call attachPendingAdminTasksToJob on job creation |
| `lib/phase4/analytics.ts` | applyReschedule() sets manuallyRescheduledAt/rescheduledBy |
| `app/api/admin/all-approvals/route.ts` | Add 7th query for reschedule JobTasks |
| `app/admin/approvals/page.tsx` | New "Reschedule Requests" tab |
| `app/admin/jobs/[id]/page.tsx` | Reschedule dialog, manuallyRescheduled badge, reset button |
| `app/admin/jobs/page.tsx` | Pending reschedule badge per job row |
| `app/admin/properties/[id]/page.tsx` | "Next Job Checklist" section + showCleanerContactToClient toggle |
| `app/admin/clients/[id]/page.tsx` | Notifications section |
| `app/cleaner/jobs/[id]/page.tsx` | Start Driving button, watchPosition, Stop Driving, GPS accuracy fix |
| `app/client/jobs/[id]/page.tsx` | Cleaner contact card |
| `app/api/client/jobs/[id]/route.ts` | Conditional cleaner phone exposure |
| `app/api/cleaner/jobs/[id]/start/route.ts` | sendClientJobNotification JOB_STARTED |
| `app/api/cleaner/jobs/[id]/submit/route.ts` | sendClientJobNotification JOB_COMPLETE |
| `app/admin/ops/map/page.tsx` | LiveCleanerLayer component, EN_ROUTE in ACTIVE_STATUSES |
| `workers/boss.ts` | eta-update job, location-pings-cleanup job |
| `components/shared/text-history-suggestions.tsx` | Public path guard |

**New files to create:**
- `lib/jobs/eta.ts`
- `lib/notifications/client-job-notifications.ts`
- `app/api/cleaner/jobs/[id]/start-driving/route.ts`
- `app/api/cleaner/jobs/[id]/stop-driving/route.ts`
- `app/api/cleaner/jobs/[id]/location-ping/route.ts`
- `app/api/admin/live-locations/route.ts`
- `app/api/admin/jobs/[id]/manual-reschedule/route.ts` (DELETE)
- `app/api/admin/properties/[id]/pending-tasks/route.ts`
- `app/api/admin/properties/[id]/pending-tasks/[taskId]/route.ts`
- `app/api/admin/clients/[id]/notification-preferences/route.ts`
- `components/admin/live-cleaner-layer.tsx`

---

## Risks & Notes

- **iCal sync protection is permanent**: Once `manuallyRescheduledAt` is set, iCal sync never updates those dates again. The "Reset to iCal" button (Feature 2) is important so a property isn't permanently diverged.
- **EN_ROUTE enum migration**: Postgres `ALTER TYPE` migration is one-way. Ensure no exhaustive switch statements break — do a codebase-wide search after migration.
- **watchPosition battery drain**: Show a visible "GPS active" indicator to cleaners. Auto-stop after 90 minutes with no check-in as a safety fallback.
- **CleanerLocationPing growth**: Cleanup job (3am daily, keep 7 days) is mandatory before going live.
- **Google Maps ETA cost**: Already have `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`. At 5 active jobs × 5-min pg-boss intervals = ~288 requests/day. Well within free tier (40,000 elements/month). Cache per-job in memory to prevent redundant calls within the same pg-boss cycle.
- **SMS defaults to EMAIL**: `ClientNotificationPreference.preferredChannel` defaults to `"EMAIL"`. Admin must explicitly select SMS. This prevents unexpected Twilio charges.
- **metadata JSON filtering**: Filter reschedule JobTasks in JS (not Postgres JSON path) to avoid dialect issues with Prisma's Json field filtering.
- **Feature 7 — feedback URL security**: The `JobFeedback.token` is a CUID — unpredictable enough for this use case, but not a signed JWT. Set `tokenExpiresAt = completedAt + 7 days`. Check expiry server-side on every submission.
- **Post-job automation defaults to OFF**: Every `ClientAutomationRule.isEnabled` defaults to `false`. Admin must explicitly enable per client. Review the client profile UI to make this obvious.
- **Review request throttle**: Check `Client.lastReviewRequestSentAt` before enqueuing — skip if < 3 days ago. This prevents flooding repeat clients.
- **Resend webhook**: Register the webhook URL in the Resend dashboard for `email.delivered`, `email.bounced`, `email.opened` events. Store Resend's message ID in `Notification.externalId String?` (add to schema) to match webhook payloads back to notification records.
- **Template variables**: Use `{{double_braces}}` Handlebars-style. Resolve server-side before sending. Variables that can't be resolved (e.g., no next clean date scheduled) should gracefully fall back to empty string or a default phrase.

---

## Verification

1. **Feature 1**: Submit a reschedule request as client → check Approvals page → Reschedule Requests tab shows it → approve → verify job's scheduledDate updated
2. **Feature 2**: Manually reschedule a job via new dialog → run iCal sync → verify job date NOT overwritten → click "Reset to iCal" → run sync again → verify date reverts
3. **Feature 3**: Visit `/quote` and `/contact` as a logged-in user → no suggestion dropdown appears → visit `/admin/jobs` → suggestions still work
4. **Feature 4**: Add a pending task to a property → create or assign a job for that property → verify task appears in cleaner's job task list
5. **Feature 5**: Open cleaner job page → click Start Driving → check admin ops map → verify live pin appears with ETA → check-in → verify EN_ROUTE ends
6. **Feature 6**: Set client to EMAIL notifications → cleaner starts driving → verify email received; toggle off → no email sent; enable cleaner contact on property → verify client sees phone number on job detail
