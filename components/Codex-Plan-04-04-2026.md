# sNeek Platform — Comprehensive Feature & Fix Plan (Detailed)

## Context
Multiple issues and new features across all portals. The previous public-site redesign is complete. This plan covers all remaining work in full implementation detail.

---

## CRITICAL: npm run start shows stale code
`npm run start` serves the `.next/` build cache — NOT live source. Every code change is invisible until you rebuild.
**Required workflow:** `npm run build && npm run start`
This is not a bug — it is how Next.js production mode works. Development mode (`npm run dev`) does hot-reload.

---

## GROUP A — Quick Fixes

### A1. Service detail pages layout broken
**File:** `components/public/service-detail-page.tsx` line 1
**Fix:** Add `"use client";` as the very first line.
**Why:** The component uses Radix `<Accordion>` (requires client state). Without `"use client"`, Next.js treats it as a server component, Tailwind JIT classes from `PUBLIC_PAGE_CONTAINER` are not guaranteed to apply, and Accordion won't hydrate.
**One-line change — no other edits needed.**

---

### A2. Scroll-to-top button overlaps WhatsApp FAB
**File:** `components/public/public-site-shell.tsx`

**Current (broken):**
- WhatsApp FAB: `fixed bottom-20 right-5 z-50 sm:bottom-6 sm:right-6`
- Scroll-to-top: `fixed bottom-6 right-5 z-50 sm:bottom-6 sm:right-6` ← same desktop position

**Fix:**
- WhatsApp FAB: stays at `fixed bottom-6 right-5 z-50 sm:bottom-6 sm:right-6` (primary, lowest)
- Scroll-to-top: change to `fixed bottom-[4.5rem] right-5 z-50 sm:bottom-[4.5rem] sm:right-6` (sits 72px above WhatsApp)

Result: on mobile and desktop, scroll button is stacked directly above WhatsApp with a natural gap.

---

### A3. Login page — remove duplicate "Create account" button
**File:** `app/(auth)/login/page.tsx` lines 114–121

**Current:** A pill row at the top of the form contains both "Back to home" AND "Create account". The "Register here" link already exists at the bottom of the form — the button at the top is redundant and confusing.

**Fix:** Remove the `<Link href="/register">Create account</Link>` element from the top pill. The pill becomes just a "Back to home" button. The bottom "Register here" link stays untouched.

---

### A4. Cleaner tomorrow job summary email shows 0 jobs
**File:** `lib/ops/tomorrow-prep.ts`

**Root cause:** The function computes UTC start/end for "tomorrow" using `new Date()` directly, then adds 1 day. In Sydney (UTC+10 or UTC+11 DST), "tomorrow" in Sydney starts at `13:00 or 14:00 UTC today` and ends at `13:00 or 14:00 UTC tomorrow`. If the DB stores `scheduledDate` as a local date (not UTC), jobs in the first ~10 hours of Sydney tomorrow fall OUTSIDE the UTC query window and return 0.

**Fix in `dispatchTomorrowPrepSummaries`:**
```ts
import { toZonedTime, fromZonedTime } from "date-fns-tz";
const TZ = "Australia/Sydney";

// Get "tomorrow" in Sydney local time
const nowSydney = toZonedTime(now, TZ);
const tomorrowSydney = addDays(startOfDay(nowSydney), 1);
const tomorrowEndSydney = endOfDay(tomorrowSydney);

// Convert back to UTC for the DB query
const startUtc = fromZonedTime(tomorrowSydney, TZ);
const endUtc = fromZonedTime(tomorrowEndSydney, TZ);
```
Then use `startUtc`/`endUtc` in the `scheduledDate` filter.

---

## GROUP B — Services Nav Dropdown (All 15 Services)

**File:** `components/public/public-site-shell.tsx`

**Current:** 5 family headers, each linking to first service of that family. "View all 15 →" at bottom.

**New behaviour:**
- Each family section is **expandable** — shows family header + all services in that family as sub-items
- Default state: all families **collapsed** showing only the family name + service count badge
- Clicking a family header toggles its service list
- "View all services →" link at the bottom always visible

**State additions:**
```ts
const [expandedFamilies, setExpandedFamilies] = useState<Set<ServiceFamily>>(new Set());
function toggleFamily(f: ServiceFamily) {
  setExpandedFamilies(prev => {
    const next = new Set(prev);
    next.has(f) ? next.delete(f) : next.add(f);
    return next;
  });
}
```

**Dropdown structure per family:**
```
▸ Short Stay & Turnovers (4)          ← click to expand
  — Airbnb Turnover Cleaning   →
  — End of Tenancy Clean       →
  — ...
▸ Residential (3)
▸ Specialty (3)
▸ Exterior (3)
▸ Commercial (2)
──────────────────────────
View all 15 services →
```

**Overflow handling:** The dropdown gets `max-h-[70vh] overflow-y-auto` so it never goes off-screen.

**Each service sub-item:** `text-sm text-foreground/80 hover:text-primary py-1.5 pl-4 pr-3 flex items-center justify-between` with a `→` arrow on the right.

---

## GROUP C — Announcement / Promo Bar (CMS-Driven)

### C1. Content schema addition
**File:** `lib/public-site/content.ts`

Add to `WebsiteContent` interface:
```ts
announcementBar: {
  enabled: boolean;
  promoMessage: string;       // e.g. "🎉 10% off first clean — use WELCOME10"
  promoLink: string;          // href — empty string = no link
  promoLinkLabel: string;     // e.g. "Book now →"
  bgStyle: "subtle" | "accent" | "dark" | "warning";
  showPhone: boolean;
  showLocation: boolean;
  showHours: boolean;
  showEmail: boolean;
};
```

Default values:
```ts
announcementBar: {
  enabled: true,
  promoMessage: "",
  promoLink: "",
  promoLinkLabel: "Book now →",
  bgStyle: "subtle",
  showPhone: true,
  showLocation: true,
  showHours: true,
  showEmail: true,
}
```

Add `sanitizeAnnouncementBar()` helper used in `sanitizeWebsiteContent`.

**bgStyle maps to CSS:**
- `subtle` → `bg-primary/6 border-primary/10 text-foreground/70`
- `accent` → `bg-amber-50 border-amber-200 text-amber-900`
- `dark` → `bg-[#0c2329] text-white/80`
- `warning` → `bg-red-50 border-red-200 text-red-800`

### C2. Shell component update
**File:** `components/public/public-site-shell.tsx` lines 131–153

Replace hardcoded bar with:
- If `!content.announcementBar.enabled` → render nothing
- If `promoMessage` is non-empty: render a centered full-width promo strip ABOVE the contact info row. The promo text is optionally wrapped in `<a href={promoLink}>` if `promoLink` is set.
- Contact info row below promo (phone, location left; hours, email right) — each item conditionally rendered based on `showPhone`, `showLocation` etc.

Layout with promo:
```
[ 🎉 10% off first clean this month — use WELCOME10  Book now → ]
[ +61 451 217 210  |  Parramatta    Mon–Sat 7am–6pm  |  info@... ]
```

### C3. Admin editor
**File:** `components/admin/website-editor.tsx`

Inside the existing **Layout** tab (alongside containerWidth), add a new `SectionCard` titled "Announcement Bar":
- Toggle: Enable / disable bar
- Promo message (Input) — leave empty to hide promo strip
- Promo link (Input, URL) + Promo link label (Input)
- Background style (Select: Subtle | Accent (Amber) | Dark | Warning (Red))
- Checkboxes: Show phone, Show location, Show hours, Show email
- Live preview hint showing what the bar will look like

---

## GROUP D — Admin Quotes & Leads — Full Counter Offer + Client Detail

### D1. New API routes

**`PATCH /api/admin/leads/[id]/route.ts`** — update lead
```ts
// Body schema
{ status?: LeadStatus; notes?: string; clientId?: string }
// Returns updated QuoteLead
```

**`POST /api/admin/leads/[id]/counter-offer/route.ts`** — create counter offer quote
```ts
// Body schema
{
  lineItems: { label: string; unitPrice: number; qty: number; total: number }[];
  notes?: string;
  validUntil?: string; // ISO date
  sendEmail: boolean;
}
// Creates Quote record with leadId set, status=SENT if sendEmail=true else DRAFT
// If sendEmail=true: sends email to lead.email via Resend with quote PDF link
// Returns { quoteId }
```

**`POST /api/admin/leads/[id]/create-client/route.ts`** — convert lead to client account
```ts
// Creates User (role=CLIENT, temp password), Client, Property records from lead data
// Links QuoteLead.clientId → new Client.id
// Sends welcome email with login link
// Returns { clientId, userId }
```

### D2. Admin quotes page — leads tab overhaul
**File:** `app/admin/quotes/page.tsx`

**Leads tab changes:**
1. Clicking any lead row opens a **right-side drawer** (fixed panel, `w-[480px]`, slides in from right)
2. Drawer contents:
   - **Header:** Lead name + status badge + "×" close button
   - **Contact section:** Name, Email (click to copy), Phone (click to call/copy), Address, Suburb
   - **Property section:** Bedrooms, Bathrooms, Balcony, Service type badge
   - **Quote estimate:** "$min – $max" in large text, promo code if used
   - **Photo thumbnails:** If `structuredContext.photoUrls` exists, render `<img>` thumbnails in a 3-col grid
   - **Notes textarea:** Admin-only notes, auto-saves on blur via `PATCH /api/admin/leads/[id]`
   - **Status selector:** Dropdown (NEW/CONTACTED/QUOTED/CONVERTED/LOST) with colour-coded options, updates on change
   - **Timeline:** Ordered list of `updatedAt` snapshots (from lead + linked quotes) showing status history
   - **Actions bar (bottom of drawer):**
     - "Send counter offer" button (teal)
     - "Create client account" button (outline) — disabled if lead already has a `clientId`; replaced with "View client →" link if clientId is set

3. **Counter offer modal** (appears above drawer):
   - Title: "Counter offer for {lead.name}"
   - Service type shown as read-only badge
   - Line item table with columns: Description | Unit price | Qty | Total
   - Add/remove rows dynamically
   - Pre-populated with one row matching the lead's service type and estimate midpoint
   - Notes textarea
   - Valid until date picker (default: +7 days)
   - "Send email to client" toggle (default: ON)
   - "Send offer" button → calls `POST /api/admin/leads/[id]/counter-offer`
   - On success: toast "Counter offer sent", lead status auto-updates to QUOTED

### D3. Client detail page
**File:** `app/admin/clients/[id]/page.tsx` (create if not existing, enhance if existing)

Sections:
1. **Header card:** Name, email, phone, address — with edit-in-place
2. **Linked leads tab:** All `QuoteLead` records for this client — each row shows service type, estimate, status, date
3. **Quotes tab:** All `Quote` records — show total amount, status, PDF download button
4. **Jobs tab:** All jobs for this client's properties — link to job detail
5. **Cases tab:** All `IssueTicket` records for this client — link to case detail
6. **Properties tab:** Each property with address, suburb, bedrooms, bathrooms, iCal integration status

This page is accessible whether the client was converted from a lead or created manually.

---

## GROUP E — Admin Jobs Page — Enhanced Filters

**File:** `app/admin/jobs/page.tsx`

**New filter state (all URL-persisted via `useSearchParams`):**
```ts
const [filters, setFilters] = useState({
  status: "",          // existing
  search: "",          // NEW: searches property name, suburb, client name, job number
  cleanerName: "",     // NEW: text search against assignment.user.name
  jobType: "",         // NEW: JobType enum select
  dateFrom: "",        // NEW: ISO date string
  dateTo: "",          // NEW: ISO date string
  invoiced: "",        // NEW: "yes" | "no" | ""
});
```

**Filter panel UI:**
- "Filters" button in header toggles a collapsible filter bar below the header row
- Filter bar layout (2 rows, grid):
  - Row 1: Search (text), Job type (select), Status (select — existing)
  - Row 2: Cleaner (text), Date from (date), Date to (date), Invoice status (select)
- "Clear all" button resets all filters
- Active filter count badge on "Filters" button when any non-default filter is set

**Filter persistence:** On mount, read from URL params. On change, push to URL with `router.replace`. This means the URL is shareable and survives refresh.

**Filtering logic:**
- Applied client-side against already-fetched jobs list (no API change needed for basic filtering)
- If jobs list grows large (>500), move filters to API query params on `GET /api/admin/jobs`

---

## GROUP F — Client Jobs Page — Calendar + Ordering + Filters

**File:** `app/client/jobs/page.tsx`

**Convert to client component** and restructure:

### F1. Ordering fix
Upcoming jobs (scheduledDate >= today) sorted ascending (soonest first) at the TOP.
Past jobs sorted descending (most recent first) shown below a "Past jobs" divider.
This is a simple sort + split — no API change needed.

### F2. Filter bar
Pill-row beneath the page title:
```
[ All ]  [ Today ]  [ Tomorrow ]  [ This week ]  [ 📅 Pick date ]
```
- "All" = no filter, shows all jobs in correct order
- "Today" / "Tomorrow" = filter by scheduledDate
- "This week" = scheduledDate within next 7 days
- "Pick date" = opens a native `<input type="date">` in a small popover
- Selected filter pill is highlighted (bg-primary text-white)
- Persist selected filter to `localStorage` key `sneek_client_jobs_filter`
- On mount, read from localStorage and apply

### F3. Calendar view
Toggle button in page header: "List" | "Calendar" — default List.
Calendar panel (when active):
- Shows a compact monthly calendar (`react-day-picker` or custom built with `date-fns`)
- Days with jobs have a teal dot indicator
- Clicking a date selects it — jobs list below filters to show only that date's jobs
- "Today" button snaps calendar to current month
- Previous/next month navigation

### F4. Add task request from job card
Currently clients must scroll to a separate section to add task requests. Instead:
- Each job card has an inline "Add request" button at the bottom
- Clicking opens the existing `ClientTaskRequestDialog` component (already exists) pre-populated with `jobId`
- This removes the need to scroll — the action is contextual to the job

### F5. Upcoming jobs top
The card list renders upcoming (future) jobs first. A horizontal divider labelled "Past jobs" separates them from completed/past jobs. Past jobs are collapsed behind a "Show X past jobs" expand button by default.

---

## GROUP G — Laundry Portal Improvements

**File:** `app/laundry/page.tsx`

### G1. Auto-collapse old completed jobs
Jobs where `status === "DROPPED"` and `droppedAt` is more than 3 days ago are rendered as collapsed cards by default.
- Collapsed card: shows property name + drop-off date + "Completed" badge + chevron to expand
- Expanding shows full detail (existing card content)
- State: `const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())`

### G2. Today-first ordering
Default sort: jobs scheduled for today first → tomorrow → future dates ascending → completed jobs at bottom (already dropped, sorted by droppedAt desc).

### G3. Save preferences to localStorage
Key: `sneek_laundry_prefs`
Saved fields: `rangeMode`, `readyFilter`, `sortMode`, `viewMode` (compact/full)
On mount: read saved prefs and apply. On change: write to localStorage.

### G4. Compact / Full toggle
"Compact" view: each job is a single row — property name | pickup date | status badge | action button
"Full" view: existing detailed card layout
Toggle button in the page header.

---

## GROUP H — Admin Form Submission Editing

### H1. New API route
**`PATCH /api/admin/form-submissions/[id]/route.ts`**

Accepts:
```ts
{
  data?: Record<string, any>;      // updated checklist answers
  laundryReady?: boolean;
  laundryOutcome?: string;
  bagLocation?: string;
  addMediaUrls?: { url: string; s3Key: string; fieldId: string; mimeType: string; label?: string }[];
  deleteMediaIds?: string[];        // SubmissionMedia.id values to delete
}
```
- Updates `FormSubmission.data` (merge, not replace)
- Upserts new `SubmissionMedia` records for `addMediaUrls`
- Deletes `SubmissionMedia` records in `deleteMediaIds` (also calls S3 delete for their `s3Key`)
- After any change: triggers report re-generation via `generateJobReport(submission.jobId)` (non-blocking)
- Requires ADMIN or OPS_MANAGER role

### H2. Admin forms UI — submission detail editor
**File:** `app/admin/forms/page.tsx` (or a new `app/admin/forms/submissions/[id]/page.tsx`)

Inside the submission detail view, add an **Edit mode** toggle:
- "Edit" button in submission detail header
- When edit mode is active:
  - Each `data` field renders as an editable control (checkbox → toggle switch, text → input, number → number input)
  - Media gallery shows thumbnails with ✕ delete buttons per image
  - "Add photos" button → file picker (multiple, image/*) → presign upload → append to `addMediaUrls`
  - "Save changes" button → PATCH request → success toast → regenerates report
  - "Cancel" exits edit mode without saving

---

## GROUP I — Admin Laundry Confirmation Photo Editing

### I1. New API route
**`PATCH /api/admin/laundry/confirmations/[confirmationId]/route.ts`**
```ts
// Body
{ photoUrl: string; s3Key: string; }
// Updates LaundryConfirmation.photoUrl and s3Key
// Triggers report re-generation for the linked job
// Requires ADMIN or OPS_MANAGER
```

### I2. Admin laundry UI
**File:** `app/admin/laundry/page.tsx`

In the laundry task detail panel, for each `LaundryConfirmation` that has a `photoUrl`:
- Show the photo thumbnail
- "Replace photo" button → opens file picker → presign upload → PATCH confirmation → update thumbnail in UI
- Confirmation-level change: the new `photoUrl` propagates to the job report on next generation

---

## GROUP J — Public Careers / Work With Us Page

### J1. New files
**`app/(public)/careers/page.tsx`** — server component
```ts
// Fetches all published HiringPosition records
// Passes to <CareersPage positions={positions} />
```

**`components/public/careers-page.tsx`** — `"use client"` component
Layout:
```
CAREERS AT SNÉEK          ← eyebrow
Join our growing team.    ← h1
[intro text]

[  Position card 1  ] [  Position card 2  ] [  Position card 3  ]
   Cleaner               Team Lead              Operations

[  No positions — check back soon  ]   ← empty state

─────────────────────────────────────────────────────────
Don't see a role? Send us your details — we're always growing.
[ Contact us ]
```

Each position card:
- Department badge (coloured by department)
- Title (h2)
- Location + Employment type pills
- Short description (first 120 chars)
- "View & Apply →" button linking to `/apply/{slug}`

### J2. Middleware update
**File:** `middleware.ts`
Add `/careers` to the public route whitelist (same pattern as `/services`, `/faq`).

### J3. Footer link
**File:** `components/public/public-site-shell.tsx` footer Quick Links column
Add "Careers" link to `/careers` after "Contact".

---

## GROUP K — Workforce Hub — Complete Implementation

**Primary file:** `components/workforce/admin-workforce-hub.tsx`
**Supporting API routes:** Various under `app/api/admin/workforce/`
**All models already exist in Prisma:** TeamGroup, WorkforcePost, ChatChannel, ChatMessage, LearningPath, LearningAssignment, StaffDocument, StaffRecognition, HiringPosition, HiringApplication

### K1. Team Groups — Smart Groups + Stats

**UI tabs inside Groups section:** Members | Smart Rules | Stats

**Smart Rules engine:**
- Rules are stored as JSON in `TeamGroup.smartRules`
- Rule shape: `{ field: "suburb" | "jobType" | "qaScore" | "role", operator: "eq" | "gte" | "lte" | "contains", value: any }`
- Admin builds rules with a visual AND/OR rule builder (similar to filter panels)
- "Preview members" button runs the rule against the User table and shows matching users

**Stats card per group:**
- Member count
- Average QA score (last 30 days, from QAReview records)
- Active jobs count (jobs assigned to any member, status not COMPLETED)
- "Message this group" shortcut → creates/finds a WorkforcePost targeted to this group's audience

**Bulk actions on member list:**
- Select all → "Send announcement" / "Assign course" / "Message"

### K2. Announcements & Posts — Rich Content + Read Receipts

**New `WorkforcePostRead` model needed in Prisma:**
```prisma
model WorkforcePostRead {
  id        String   @id @default(cuid())
  postId    String
  userId    String
  readAt    DateTime @default(now())
  post      WorkforcePost @relation(fields: [postId], references: [id], onDelete: Cascade)
  user      User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([postId, userId])
}
```

**Post creation form:**
- Title (Input)
- Body (Textarea with basic markdown preview — bold, italic, bullet list)
- Attachment uploads (images/PDFs via S3 presign) — max 5 attachments
- Audience: All staff | Specific groups (multi-select) | Specific roles (multi-select)
- Pinned toggle
- Schedule for later (datetime picker) — `publishAt` field (add to model)

**Post feed (staff view on their portal home):**
- Pinned posts at top
- Unread posts have a blue dot indicator
- Mark as read when user opens/scrolls post
- Read count shown to admin: "Seen by 8 of 12 staff"

**API routes needed:**
- `GET /api/admin/workforce/posts` — list posts
- `POST /api/admin/workforce/posts` — create
- `PATCH /api/admin/workforce/posts/[id]` — update
- `DELETE /api/admin/workforce/posts/[id]` — delete
- `POST /api/admin/workforce/posts/[id]/read` — mark as read (staff calls this)

### K3. Chat — Polling-Based Real-Time

**How it works:** Every 3 seconds, active chat window polls `GET /api/chat/channels/[id]/messages?after={lastMessageId}`. Simple, reliable, no WebSocket infra needed.

**Channel list panel:**
- Shows all channels user is a member of
- Unread message count badge (messages after user's last read timestamp)
- "New channel" button (admin only)

**Message window:**
- Messages grouped by date (Today, Yesterday, date)
- Each message: avatar + name + time + body + attachments
- Image attachments render as thumbnails (click to expand)
- @mention: typing `@` shows a dropdown of channel members; inserts `@name` in message body
- Admin can pin messages (pinned shows at top of channel)
- Admin can delete any message; user can delete their own

**API routes needed:**
- `GET /api/chat/channels` — list channels for current user
- `GET /api/chat/channels/[id]/messages` — paginated messages + `?after=` for polling
- `POST /api/chat/channels/[id]/messages` — send message
- `PATCH /api/chat/channels/[id]/messages/[msgId]` — edit/delete message
- `POST /api/admin/chat/channels` — create channel (admin)
- `PATCH /api/admin/chat/channels/[id]` — update members/name

### K4. Learning Platform — Course Builder + Assignments

**Course schema (stored in `LearningPath.schema` JSON):**
```ts
{
  sections: {
    id: string;
    title: string;
    lessons: {
      id: string;
      title: string;
      type: "text" | "video" | "quiz";
      content: string;        // markdown for text, URL for video
      quiz?: {                // for type=quiz
        questions: {
          id: string;
          question: string;
          options: string[];
          correctIndex: number;
          explanation?: string;
        }[]
      }
    }[]
  }[]
}
```

**Course builder UI (admin):**
- Drag-and-drop sections and lessons (using `@dnd-kit/core`)
- Lesson editor opens in a right panel:
  - Text lesson: markdown editor with preview
  - Video lesson: YouTube/Vimeo URL input + preview
  - Quiz lesson: question builder (add/remove questions, add/remove options, mark correct answer)
- Publish toggle (only published courses are assigned to staff)

**Staff taking a course:**
- Progress bar showing `sectionsCompleted / totalSections`
- Each lesson has a "Mark complete" button
- Quiz auto-graded on submission — score shown immediately with explanations for wrong answers
- Overall pass threshold: 70% average across all quizzes
- On completion: `LearningAssignment.status` → COMPLETED, `completedAt` set, `score` saved

**Auto-assignment:** When a HiringApplication status changes to HIRED → auto-create `LearningAssignment` for all mandatory courses (LearningPath where `audience` includes the cleaner role)

**Certificate:** On completion, a simple HTML certificate is generated with the staff name, course title, completion date, and company logo. Downloadable as PDF via Playwright (already set up in the project).

### K5. Documents — Categories + Expiry Alerts

**Document categories:** Compliance, Contracts, Training, Company Policy, Personal, Other

**Expiry alerts:**
- New pg-boss worker job: `document-expiry-check` runs daily at 8am Sydney
- Checks `StaffDocument` where `expiresAt` is within 14 days and `status !== "EXPIRED"`
- Sends email to the document owner AND admin
- If `expiresAt` is past, updates `status` to `"EXPIRED"`

**Admin document view:**
- Filter by category, staff member, expiry status (Active | Expiring soon | Expired)
- Bulk upload: multiple files at once, shared category
- "Request document" button: admin sends a notification to a specific staff member asking them to upload a specific document type

**Staff document view (in their portal):**
- Shows only their own documents
- Upload new document button
- Expiring soon shown with amber warning banner

**E-signature placeholder:**
- On document card, "Requires signature" toggle (admin sets this)
- Staff sees "Sign" button → clicking opens a simple modal with document preview + checkbox "I confirm I have read and understood this document" + "Sign" button
- On sign: `StaffDocument.status` → "SIGNED", `verifiedAt` set to now, `verifiedById` set to signer's userId

### K6. Recognition — Leaderboard + Auto-Badges + Public Wall

**Badge categories and keys:**
- `quality_star` — Punctuality & Presence (awarded for 5+ on-time jobs in a row)
- `spotless` — Clean of the Month (highest QA score in a 30-day window)
- `reliable` — Reliability Champion (no missed or late jobs in 30 days)
- `client_fave` — Client Favourite (3+ positive case resolutions / no complaints in 30 days)
- `safety_first` — Safety First (manual award by admin)
- `initiative` — Above & Beyond (manual award by admin)
- `milestone_10` / `milestone_50` / `milestone_100` — 10/50/100 jobs completed

**Auto-recognition worker:** New pg-boss job `recognition-check` runs weekly (Sunday 9am Sydney):
- Checks milestone badges: count completed jobs per cleaner, award milestone badges at thresholds
- Checks quality_star: find cleaners with 5+ consecutive jobs with QA score ≥ 90%
- Checks spotless: find cleaner with highest average QA score in last 30 days
- Checks reliable: find cleaners with no UNASSIGNED status jobs that had their assignment removed
- Auto-creates `StaffRecognition` records with `sentById` = system admin user id, `isPublic = true`

**Recognition wall (visible in cleaner and admin portals):**
- Public recognitions shown as a card grid: avatar + badge icon + title + message + date
- Admin can add a "Spotlight" celebration (confetti effect + pinned to top of wall for 7 days)
- Cleaner can see their own recognition history in their profile

**Leaderboard section:**
- Top 5 cleaners by: QA score (30-day avg) | Jobs completed (month) | Recognitions received (all time)
- Updates on page load

### K7. Hiring — Advanced Pipeline + Onboarding Link

**Application statuses:** NEW → SCREENING → INTERVIEW → OFFER → HIRED | REJECTED | WITHDRAWN

**New fields on `HiringApplication` (migration needed):**
```prisma
interviewNotes  String?
interviewDate   DateTime?
offerDetails    Json?          // salary, start date, role
rejectionReason String?
```

**Admin hiring pipeline UI:**
- Kanban board view: columns for each status
- Application card: name, applied date, role, screening score
- Clicking opens full application detail:
  - Answers to application schema questions
  - Screening score (auto-calculated from `screeningSchema`)
  - Resume link (if uploaded)
  - Cover letter
  - Interview notes (editable rich textarea)
  - Interview date scheduler (date/time picker)
  - Status change buttons: "Move to interview", "Make offer", "Hire", "Reject"
  - Offer details form: start date, rate, role title

**Bulk email templates:**
- "Thank you for applying" — sent when status = SCREENING
- "Interview invitation" — sent when status = INTERVIEW (includes `interviewDate` if set)
- "Offer letter" — sent when status = OFFER
- "Welcome to the team" — sent when status = HIRED (includes login instructions)

**Hire flow → onboarding:**
When an application is marked HIRED:
1. Auto-creates `User` (role=CLEANER) + password reset token
2. Sends welcome email with "Set your password" link
3. Auto-assigns all mandatory `LearningPath` courses to the new user
4. Creates a document request notification for required compliance docs (e.g., police check)

**API routes needed:**
- `GET /api/admin/workforce/hiring/positions` — list positions
- `POST /api/admin/workforce/hiring/positions` — create position
- `PATCH /api/admin/workforce/hiring/positions/[id]` — update
- `GET /api/admin/workforce/hiring/applications` — list all applications (with filters)
- `PATCH /api/admin/workforce/hiring/applications/[id]` — update status, notes, offer
- `POST /api/admin/workforce/hiring/applications/[id]/email` — send template email

---

## GROUP L — Case Handling Improvements

**Files:** `components/cases/admin-cases-workspace.tsx`, `components/cases/client-cases-workspace.tsx`

### L1. Admin quick actions
- **Inline status change buttons on list rows:** "Start" (→ IN_PROGRESS), "Resolve" (→ RESOLVED) — no need to open detail
- **"Assign to me" button** next to each unassigned case in list
- **Filter persistence:** Save filter state (status, type, assignee) in URL params

### L2. Resolution templates
A "Use template" button in the resolution note field:
- Dropdown of pre-written templates per case type:
  - DAMAGE: "We have reviewed the reported damage. We will arrange a follow-up visit to assess and resolve."
  - CLIENT_DISPUTE: "We acknowledge your concern and are investigating. We'll be in touch within 24 hours."
  - LOST_FOUND: "We've followed up with the assigned cleaner. [Item status]. Please let us know if you need further assistance."
- Selecting a template pre-fills the resolution note; admin can edit before saving

### L3. Client simplified create form
**File:** `components/cases/client-cases-workspace.tsx`

Replace the current multi-field create form with a 3-step flow:
1. **What happened?** — 3 big buttons: "Something was damaged" | "I have a complaint" | "I found / lost something" | "Other issue"
2. **Tell us more** — single textarea "Describe what happened" + optional photo upload (max 3 photos)
3. **Which job?** — dropdown of their recent jobs (last 10) — optional, can skip

On submit: creates `IssueTicket` with mapped `caseType`, `description`, `attachments`, `jobId`.

### L4. Auto-case from QA fail
**File:** `app/api/admin/jobs/[id]/qa/route.ts` (or wherever QA is saved)
After saving a QA score below 60%:
- Check if an IssueTicket already exists for this job with `caseType = "OPS"`
- If not, auto-create one: title="QA Below Threshold – {job.jobNumber}", description="Auto-generated from QA score of {score}%", severity="HIGH", clientVisible=false
- Log this in the audit trail

### L5. Damage indicator on admin jobs list
**File:** `app/admin/jobs/page.tsx`
- If a job has any linked `IssueTicket` with `caseType = "DAMAGE"` and `status !== "RESOLVED"`, show a small red ⚠ badge on the job row
- Clicking the badge opens the case detail (links to `/admin/cases?jobId={id}`)

---

## Prisma migrations needed

Only one new model and one model extension:

1. **`WorkforcePostRead`** — new model (K2)
2. **`HiringApplication`** — add fields: `interviewNotes`, `interviewDate`, `offerDetails`, `rejectionReason` (K7)
3. **`WorkforcePost`** — add `publishAt DateTime?` field (K2)

Run: `npx prisma migrate dev --name add_workforce_enhancements`

---

## Execution Order

| # | Group | Key files | Notes |
|---|-------|-----------|-------|
| 1 | A1 — Service layout | `service-detail-page.tsx` | 1 line |
| 2 | A2 — Button position | `public-site-shell.tsx` | 2 lines |
| 3 | A3 — Login cleanup | `login/page.tsx` | 2 lines |
| 4 | A4 — Email TZ bug | `tomorrow-prep.ts` | ~10 lines |
| 5 | B1 — Nav dropdown | `public-site-shell.tsx` | ~80 lines |
| 6 | C — Announcement bar | `content.ts`, `shell`, `editor` | 3 files |
| 7 | D — Leads + counter offer | 4 files + new API routes | Medium |
| 8 | E — Admin jobs filters | `admin/jobs/page.tsx` | 1 file |
| 9 | F — Client jobs calendar | `client/jobs/page.tsx` | 1 file |
| 10 | G — Laundry improvements | `laundry/page.tsx` | 1 file |
| 11 | H — Form submission edit | 2 files | Medium |
| 12 | I — Laundry photo edit | 2 files | Small |
| 13 | J — Careers page | 3 files | Small |
| 14 | Prisma migration | `schema.prisma` | Run migration |
| 15 | K1-K3 — Groups/Posts/Chat | `admin-workforce-hub.tsx` + APIs | Large |
| 16 | K4-K5 — Learning/Docs | Same + new routes | Large |
| 17 | K6-K8 — Recognition/Hiring | Same + workers | Large |
| 18 | L — Case improvements | 2 case workspace files | Medium |

---

## Verification Checklist

- [ ] `npx tsc --noEmit` — zero errors
- [ ] `npm run build` — successful (required before `npm run start`)
- [ ] `/services/general-clean` — centered layout, correct gutters
- [ ] Services nav dropdown — clicking a family expands its services, all 15 visible
- [ ] Scroll-to-top and WhatsApp FAB — both visible simultaneously, no overlap
- [ ] Login — only "Back to home" in top pill
- [ ] Admin announcement bar — set a promo message in admin, verify it appears on public site
- [ ] Admin leads — click a lead, full drawer opens, counter offer creates a Quote record
- [ ] Tomorrow email — test by creating a Sydney-time-tomorrow job, run dispatch, verify correct count
- [ ] Client jobs — upcoming jobs at top, filters persist after refresh
- [ ] Laundry — old completed jobs collapsed, preferences saved after refresh
- [ ] Form submission editing — save changes, verify report regenerates
- [ ] Laundry photo replace — upload new photo, verify LaundryConfirmation.photoUrl updated
- [ ] /careers — lists published positions, links to /apply/[slug]
- [ ] Workforce hub — each tab loads without error, create/edit flows work end-to-end
- [ ] Case — client simplified form creates a ticket; QA score below 60% auto-creates ticket
