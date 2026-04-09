# Phase 1: Critical Performance Improvements - Implementation Plan

## Overview
This phase focuses on optimizing page load times by implementing pagination, filtering, and lazy loading across the most data-heavy pages.

## Features to Implement

### 1. Jobs Page - Completed Jobs Tab System
**Current Issue:** All jobs loaded at once causing slow page loads
**Files to Modify:**
- `app/admin/jobs/page.tsx` - Add tabs for Active/Completed
- `app/api/jobs/route.ts` - Add status filtering and pagination

**Implementation:**
- Add Tabs component with "Active Jobs" (default) and "Completed Jobs"
- Active jobs: UNASSIGNED, OFFERED, ASSIGNED, EN_ROUTE, IN_PROGRESS, PAUSED, WAITING_CONTINUATION_APPROVAL, SUBMITTED, QA_REVIEW
- Completed jobs: COMPLETED, INVOICED
- Add pagination (50 jobs per page)
- Store active tab in URL params
- Add database indexes on `status` and `scheduledDate`

### 2. Reports Page - Pagination & Filters
**Current Issue:** Loading all reports at once
**Files to Modify:**
- `app/admin/reports/page.tsx` - Add pagination UI and filters
- `app/api/admin/reports/route.ts` - Add pagination logic

**Implementation:**
- Limit to 30 reports per page
- Add filters: property, client, date range, job type
- Add sorting: date (desc/asc), property name
- Use cursor-based pagination for performance
- Add search by property name or client name

### 3. Notifications Page - Pagination & Filters
**Current Issue:** All notifications loaded at once
**Files to Modify:**
- `app/admin/notifications/page.tsx` - Add pagination and filters
- `app/api/admin/notifications/log/route.ts` - Add pagination logic

**Implementation:**
- Limit to 50 notifications per page
- Add filters: channel (EMAIL/SMS), status (SENT/FAILED), date range
- Add search by recipient email or subject
- Implement "Load More" button or pagination controls
- Add date range picker

### 4. Settings Page - Accordion Redesign
**Current Issue:** All settings loaded and visible, causing slow render
**Files to Modify:**
- `app/admin/settings/page.tsx` - Restructure with accordions
- `components/admin/settings-editor.tsx` - Break into smaller components

**Implementation:**
- Group settings into collapsible sections:
  - General Settings (company, timezone, logo)
  - Notification Preferences (link to new page)
  - Job Defaults (timing, SLA, auto-assign)
  - Laundry Operations (pickup times, cutoffs)
  - Portal Visibility (client, cleaner, laundry)
  - Integrations & Sync
  - Security & Access
- All sections collapsed by default
- Add search/filter for settings
- Lazy load heavy components (PricebookEditor, etc.)
- Use Accordion component from shadcn/ui

### 5. Integrations Page - Sync History Limit
**Current Issue:** Loading too many sync records (200+)
**Files to Modify:**
- `app/admin/integrations/page.tsx` - Update to show limited records
- `app/api/admin/integrations/ical-sync-runs/route.ts` - Add limit param

**Implementation:**
- Default to last 20-30 sync runs
- Add "Load More" button to fetch next batch
- Add date range filter
- Keep existing filters (property, status, mode)
- Cache recent syncs in component state

## Database Optimizations

### Indexes to Add
```sql
-- Jobs table
CREATE INDEX IF NOT EXISTS idx_jobs_status_scheduled ON "Job"(status, "scheduledDate" DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_completed ON "Job"(status) WHERE status IN ('COMPLETED', 'INVOICED');

-- Reports table
CREATE INDEX IF NOT EXISTS idx_reports_created ON "JobReport"("createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_reports_job_property ON "JobReport"("jobId", "createdAt" DESC);

-- Notifications table
CREATE INDEX IF NOT EXISTS idx_notifications_created ON "NotificationLog"("createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_channel_status ON "NotificationLog"(channel, status, "createdAt" DESC);

-- Sync runs table
CREATE INDEX IF NOT EXISTS idx_sync_runs_created ON "IcalSyncRun"("createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_sync_runs_property ON "IcalSyncRun"("propertyId", "createdAt" DESC);
```

## API Changes

### Jobs API
- Add `?status=active|completed` query param
- Add `?page=1&limit=50` pagination params
- Return total count for pagination UI

### Reports API
- Add `?page=1&limit=30` pagination
- Add `?propertyId=xxx&clientId=xxx` filters
- Add `?dateFrom=2024-01-01&dateTo=2024-12-31` date range
- Add `?sortBy=date&sortOrder=desc` sorting

### Notifications API
- Add `?page=1&limit=50` pagination
- Add `?channel=EMAIL|SMS&status=SENT|FAILED` filters
- Add `?search=query` for recipient/subject search
- Add `?dateFrom=xxx&dateTo=xxx` date range

### Integrations API
- Add `?limit=30` to sync runs endpoint
- Add `?cursor=xxx` for cursor-based pagination
- Keep existing filters

## Performance Targets

- Jobs page: Load time < 2s (currently 5-10s)
- Reports page: Load time < 1.5s (currently 3-5s)
- Notifications page: Load time < 1.5s (currently 3-5s)
- Settings page: Initial render < 1s (currently 2-4s)
- Integrations page: Load time < 2s (currently 4-6s)

## Testing Checklist

- [ ] Jobs page loads quickly with active jobs by default
- [ ] Completed jobs tab loads separately and shows only completed
- [ ] Reports pagination works correctly
- [ ] Reports filters apply correctly
- [ ] Notifications pagination works
- [ ] Notifications filters work
- [ ] Settings accordions collapse/expand smoothly
- [ ] Settings search finds relevant settings
- [ ] Integrations sync history limited to 30 records
- [ ] All database indexes created successfully
- [ ] No regression in existing functionality

## Rollout Plan

1. Create database migration for indexes
2. Update API endpoints with pagination
3. Update UI components with new features
4. Test thoroughly in development
5. Deploy to staging for QA
6. Monitor performance metrics
7. Deploy to production
8. Monitor error logs and performance

## Next Steps After Phase 1

Once Phase 1 is complete and stable, proceed to:
- Phase 2: Laundry Improvements
- Phase 3: Notification System
- Phase 4: UX Polish
