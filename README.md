# sNeek Ops Dashboard

Property cleaning operations management platform for sNeek Property Services.

## Tech Stack

- **Framework**: Next.js 14+ (App Router) + TypeScript
- **Database**: PostgreSQL + Prisma ORM
- **Auth**: NextAuth v4 (credentials)
- **UI**: Tailwind CSS + shadcn/ui + TanStack Table
- **Calendar**: FullCalendar
- **File Storage**: S3-compatible (AWS S3 / Cloudflare R2)
- **Background Jobs**: pg-boss (Postgres-native job queue)
- **PDF**: Playwright (HTML → PDF)
- **Email**: Resend
- **SMS**: Twilio (optional)
- **Validation**: Zod
- **Logging**: Pino

## Portals

| Portal | URL | Roles |
|--------|-----|-------|
| Admin / Ops | `/admin` | `ADMIN`, `OPS_MANAGER` |
| Cleaner | `/cleaner` | `CLEANER` |
| Client | `/client` | `CLIENT` |
| Laundry | `/laundry` | `LAUNDRY` |

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your PostgreSQL, S3, Resend, etc. credentials
```

### 3. Set up the database

```bash
npm run db:migrate    # Run migrations
npm run db:seed       # Seed demo data
```

### 4. Run the app

```bash
npm run dev           # Next.js dev server (http://localhost:3000)
npm run workers:dev   # pg-boss background workers (separate terminal)
```

## Demo Credentials (after seed)

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@sneekops.com.au | admin123 |
| Ops Manager | ops@sneekops.com.au | ops123 |
| Cleaner | cleaner@sneekops.com.au | cleaner123 |
| Client | client@sneekops.com.au | client123 |
| Laundry | laundry@sneekops.com.au | laundry123 |

## Key Features

### Implemented (v1)

- ✅ RBAC with 5 roles (Admin, Ops Manager, Cleaner, Client, Laundry)
- ✅ Middleware route guards per portal
- ✅ Clients + Properties CRUD (incl. access info, linen buffer sets)
- ✅ iCal sync (Hospitable) — editable URL, enable/disable toggle, manual "sync now"
- ✅ Job lifecycle: UNASSIGNED → ASSIGNED → IN_PROGRESS → SUBMITTED → QA_REVIEW → COMPLETED → INVOICED
- ✅ Job assignment to cleaner(s) with audit log
- ✅ Kanban + Calendar (FullCalendar) views
- ✅ Dynamic Forms Engine (JSON template → mobile checklist)
- ✅ Seeded form templates: Airbnb Turnover v1, End of Lease, Deep Clean
- ✅ Required photo/video uploads with S3 presigned URLs (resumable)
- ✅ Inventory tracking per property (deduct on submission, shopping list)
- ✅ Laundry planner with pick-up/drop-off scheduling algorithm
- ✅ Conditional laundry notifications (only when cleaner confirms ready)
- ✅ PDF report generation (Playwright) + auto-store to S3
- ✅ Client portal: reports + property overview
- ✅ Laundry portal: weekly schedule + ready queue + status updates
- ✅ Cleaner portal: today's jobs, mobile-first checklist + upload flow
- ✅ Price Book + instant public quote page
- ✅ Lead capture → quote → convert to job
- ✅ pg-boss background workers (iCal sync, reminders, laundry plan, stock alerts)
- ✅ 24h email + 2h SMS reminders to cleaners
- ✅ Audit log for sensitive actions
- ✅ Pino structured logging

### Notes on iCal / Hospitable

- Hospitable property iCal feed is **read-only** (displayed in UI)
- Manual blocks created inside Hospitable **do NOT appear** in the property iCal feed
- Automatic refresh interval: 40 minutes (configurable in pg-boss schedule)
- Admin can trigger manual sync at any time
- iCal URL is optional — when empty, sync is skipped

## Database Schema

See `prisma/schema.prisma` for full model definitions.

## Background Workers

Managed by pg-boss. Start separately:

```bash
npm run workers:dev
```

| Worker | Schedule |
|--------|----------|
| `ical-sync` | Every 40 minutes |
| `reminder-dispatch` | Every 5 minutes |
| `weekly-laundry-plan` | Monday 9am AEDT |
| `stock-alerts` | Daily 7am AEDT |
| `report-generate` | On-demand (triggered on job submission) |
