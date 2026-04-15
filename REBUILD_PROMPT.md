# sNeek Property Services — Complete Rebuild Prompt

## Context

This is a **live production cleaning company management web app** (sNeek Property Services) built with Next.js 14 App Router + TypeScript + PostgreSQL + Prisma + NextAuth v4 + Tailwind + shadcn/ui. It manages jobs, cleaners, clients, properties, laundry, inventory, finance, payroll, and more.

**CRITICAL: This app is LIVE and in active use. DO NOT break any existing data, database schema, or data types. All existing Prisma models, columns, and relationships must remain intact. No data loss is acceptable.**

---

## Phase 0: Backup First

Before making ANY changes:

1. Run `npx prisma db pull` to snapshot the current schema
2. Create a full database backup: `pg_dump SPS_Main > backup_$(date +%Y%m%d).sql`
3. Commit the current state to git with a tag: `git tag pre-rebuild-backup`
4. Verify the backup can be restored before proceeding

---

## Phase 1: Remove Unnecessary Features

Remove these features entirely — they add complexity without value:

- **SLA system** — Remove all SLA-related code, API routes, dashboard cards, settings, and database references
- **Phase 3/Phase 4 experimental features** — Remove all `app/api/admin/phase3/*` and `app/api/admin/phase4/*` routes that aren't actively used
- **Redundant pages** — Consolidate duplicate pages (see navigation restructure below)
- **Unused API routes** — Audit and remove any API route that has no corresponding UI or is superseded by newer routes
- **Debug/test endpoints** — Remove any test or debug-only endpoints

---

## Phase 2: Navigation & Page Restructure

### Current Problems
- Too many top-level sidebar items (30+ links across 6 groups)
- Duplicate/overlapping pages (e.g., Finance dashboard + Finance page + Payroll separate)
- Settings scattered across pages AND a central settings page
- No clear hierarchy — everything is flat

### New Navigation Structure (max 8 groups, max 6 items per group)

```
Overview
  ├── Dashboard          (main ops dashboard with real-time stats)
  └── Calendar           (unified calendar view for all jobs/laundry)

Operations
  ├── Jobs               (list, create, assign, track — with sub-tabs: Active, Scheduled, Completed)
  ├── Laundry            (laundry tasks, confirmations, supplier management)
  ├── Inventory          (items, stock levels, stock runs)
  ├── Shopping           (shopping runs, reimbursements)
  ├── Forms              (form templates, submissions)
  └── Suppliers          (all suppliers: inventory + laundry)

People
  ├── Cleaners           (list, availability, performance, pay rates)
  ├── Clients            (list, properties, invoices, communication)
  ├── Properties         (list, details, integrations, rates)
  ├── Messages           (internal messaging system)
  └── Workforce          (hiring, posts, learning, documents)

Commercial
  ├── Quotes             (create, send, convert to jobs)
  ├── Invoices           (generate, send, track payments)
  ├── Finance            (dashboard: revenue, margins, analytics)
  ├── Payroll            (runs, payouts, ABA files)
  ├── Approvals          (unified: pay requests, time adjustments, continuations, client approvals)
  └── Reports            (job reports, financial reports, exports)

Growth
  ├── Marketing          (campaigns, leads, referrals)
  ├── Website            (blog, pages, public content)
  └── Notifications      (templates, preferences, logs)

Settings
  ├── General            (company info, branding, timezone)
  ├── Integrations       (all API credentials: Resend, Twilio, S3, Stripe, Square, PayPal, Xero, Maps)
  ├── Payment Gateways   (gateway instances, priority, surcharge)
  ├── Xero               (OAuth2 connection, sync status)
  ├── Users & Roles      (user management, permissions)
  └── Audit Log          (system-wide audit trail)
```

### Page Consolidation Rules
- **One page per concept** — No separate pages for things that belong together
- Use **tabs within pages** instead of separate routes (e.g., Jobs page has tabs: Active | Scheduled | Completed | Route Map)
- Use **sub-navigation within pages** for related views (e.g., Client detail page has tabs: Overview | Properties | Invoices | Messages | Settings)
- **Settings belong on the page they affect** — Each page should have a "Settings" or "Configure" tab for page-specific settings, while global settings stay in the Settings section
- Remove standalone redirect pages — use direct navigation

### Specific Consolidations
- Merge `/admin/finance` and `/admin/finance/dashboard` → single `/admin/finance` with tabs
- Merge `/admin/laundry` and `/admin/laundry/suppliers` → single page with tabs
- Merge `/admin/inventory`, `/admin/stock-runs`, `/admin/shopping-runs` → under Inventory with tabs
- Merge `/admin/approvals`, `/admin/pay-adjustments`, `/admin/time-adjustments` → single `/admin/approvals` with tabs
- Merge `/admin/suppliers` (inventory) and `/admin/laundry/suppliers` → single `/admin/suppliers` with tabs
- Merge `/admin/issues` and `/admin/cases` → single `/admin/cases`
- Merge `/admin/ops` and `/admin/ops/map` → single page with tabs
- Merge `/admin/marketing` and `/admin/marketing/campaigns` → single page with tabs
- Merge `/admin/website` and `/admin/website/blog` → single page with tabs
- Merge `/admin/intelligence` and `/admin/scale` → consolidate into Dashboard or remove
- Merge `/admin/delivery-profiles` into Clients or Settings
- Remove `/admin/integrations` as standalone — move credentials to Settings > Integrations tab

---

## Phase 3: UI/UX Standards

### Design System
- **Consistent spacing** — Use a 4px/8px grid system throughout
- **Consistent typography** — Define and use a type scale (xs, sm, base, lg, xl, 2xl, 3xl)
- **Consistent colors** — Use semantic color tokens (success, warning, error, info) not arbitrary colors
- **Consistent border radius** — Standardize on sm (4px), md (8px), lg (12px), xl (16px)
- **Consistent shadows** — Define 3 shadow levels (sm, md, lg) and use consistently

### Component Standards
- Every page uses a consistent **PageShell** component with: title, description, breadcrumbs, actions
- Every list page uses a consistent **DataTable** component with: search, filters, sort, pagination, bulk actions
- Every detail page uses a consistent **DetailLayout** with: header, tabs, content area
- Every form uses consistent **FormLayout** with: validation, error states, loading states, success feedback
- Every modal/dialog uses consistent **Dialog** component with: title, description, actions, close button
- Every empty state shows a helpful illustration + description + CTA
- Every loading state shows a skeleton, not a spinner
- Every error state shows a helpful message + retry action

### Interaction Standards
- **Keyboard navigation** — All interactive elements must be keyboard accessible
- **Focus management** — Focus moves logically after actions (e.g., after deleting, focus moves to next item)
- **Optimistic updates** — UI updates immediately, reverts on error with notification
- **Confirmation dialogs** — Destructive actions require confirmation with clear consequences
- **Toast notifications** — All actions show success/error toasts (not alerts)
- **Loading states** — Buttons show loading state during async operations
- **Disabled states** — Buttons/inputs show disabled state with tooltip explaining why

### Dashboard Standards
- Show **actionable data** — Every metric should have a clear action associated
- **Real-time updates** — Use WebSocket/SSE for live data (job status changes, new approvals)
- **Prioritized information** — Most urgent items at top, less important below
- **Quick actions** — Common actions available directly from dashboard (create job, assign cleaner, etc.)
- **Trend indicators** — Show whether metrics are improving or declining
- **No vanity metrics** — Only show data that drives decisions

---

## Phase 4: Code Quality Rules

### Architecture Rules
1. **One responsibility per file** — Each file does one thing well
2. **No business logic in components** — All logic in lib/ or hooks/
3. **No API logic in pages** — All data fetching in lib/ or server actions
4. **Type everything** — No `any`, no `unknown` without narrowing, no implicit `any`
5. **No dead code** — Remove unused imports, variables, functions, components
6. **No console.log in production** — Use proper logging utility
7. **No magic numbers** — Use named constants
8. **No nested ternaries** — Use if/else or early returns
9. **Max 3 levels of nesting** — Refactor if deeper
1
10. **Max 300 lines per file** — Split if larger

### API Rules
1. **Consistent response format** — All APIs return `{ data?, error?, meta? }`
2. **Proper HTTP status codes** — 200, 201, 400, 401, 403, 404, 409, 500
3. **Input validation** — Validate all inputs with Zod schemas
4. **Error handling** — Every API route has try/catch with proper error responses
5. **Rate limiting** — All public APIs have rate limiting
6. **Audit logging** — All mutations are logged
7. **Idempotency** — POST operations that create resources are idempotent
8. **Pagination** — All list endpoints support pagination
9. **No N+1 queries** — Use Prisma include/select efficiently
10. **Transaction safety** — Multi-step operations use database transactions

### Database Rules
1. **Never drop columns** — Only add columns, never remove (use soft deletes)
2. **Always add indexes** — Foreign keys, frequently queried columns
3. **Use enums for fixed values** — Not strings
4. **Timestamps on everything** — createdAt, updatedAt on all models
5. **Soft deletes** — Use isActive or deletedAt, never hard delete
6. **Audit trail** — All changes logged in AuditLog
7. **Data integrity** — Use foreign keys, not just IDs
8. **Default values** — All nullable fields have sensible defaults

### Component Rules
1. **Server components by default** — Only use "use client" when necessary
2. **Props interface** — Every component has a typed props interface
3. **No inline styles** — Use Tailwind classes
4. **Accessible** — ARIA labels, roles, keyboard navigation
5. **Responsive** — Mobile-first, works on all screen sizes
6. **Loading states** — Every async component has loading state
7. **Error boundaries** — Wrap sections that can fail
8. **No prop drilling** — Use context or server components

### Testing Rules
1. **Critical paths tested** — Auth, payments, job creation, payroll
2. **API routes tested** — All endpoints have at least one test
3. **Edge cases covered** — Empty states, error states, boundary values
4. **Integration tests** — Test full user flows
5. **No flaky tests** — Tests must be deterministic

---

## Phase 5: Feature Completeness

### Universal Cleaning Service Support
Currently the app is optimized for Airbnb turnover cleaning. Expand to support ALL cleaning types:

1. **Job Types** — Ensure all 20+ job types have proper forms, pricing, and workflows:
   - Airbnb Turnover, Deep Clean, End of Lease, General Clean, Post Construction
   - Pressure Wash, Window Clean, Lawn Mowing, Special Clean, Commercial Recurring
   - Carpet Steam Clean, Mold Treatment, Upholstery Cleaning, Tile Grout Cleaning
   - Gutter Cleaning, Spring Cleaning

2. **Per-job-type configuration:**
   - Custom form templates per job type
   - Custom pricing models per job type
   - Custom checklists per job type
   - Custom time estimates per job
   - Custom equipment requirements per job type
   - Custom safety requirements per job type

3. **Commercial/Recurring Cleaning:**
   - Recurring job scheduling (daily, weekly, monthly)
   - Service level agreements per client
   - Multi-property contracts
   - Bulk invoicing for recurring clients
   - Performance tracking per contract

4. **Specialized Cleaning:**
   - Post-construction: debris removal, dust cleanup, final inspection
   - Mold treatment: safety equipment, containment, air quality testing
   - Carpet steam: equipment tracking, drying time, stain treatment
   - Pressure wash: surface types, pressure settings, chemical usage

### Partner Management (Laundry + Future Partners)
1. **Laundry Partners:**
   - Partner portal (separate login for laundry partners)
   - Job assignment to partners
   - Status tracking (received, processing, ready, delivered)
   - Invoicing and payment to partners
   - Performance metrics (turnaround time, quality, cost)
   - Capacity management (max items per day)

2. **Extensible Partner System:**
   - Generic partner model (not just laundry)
   - Partner types: Laundry, Supply, Maintenance, Specialty
   - Partner onboarding workflow
   - Partner performance dashboard
   - Partner communication system

### Client Experience
1. **Client Portal Improvements:**
   - Real-time job tracking (like delivery tracking)
   - Photo updates during job
   - Instant messaging with cleaner/admin
   - Invoice payment with multiple gateways
   - Service history and reports
   - Booking new jobs directly
   - Rating and feedback system
   - Referral program

2. **Client Communication:**
   - Automated job reminders
   - Job completion notifications
   - Invoice notifications
   - Report delivery
   - Feedback requests

### Admin Control & Configurability
1. **Feature Flags:**
   - Every major feature toggleable per tenant
   - Admin can enable/disable features without code changes
   - Feature flags stored in database

2. **Configurable Workflows:**
   - Job approval workflow configurable
   - Payment workflow configurable
   - Notification workflow configurable
   - Payroll workflow configurable

3. **Custom Fields:**
   - Admin can add custom fields to any entity
   - Custom fields stored as JSON
   - Custom fields appear in forms and views

### Multi-Tenant / SaaS Readiness
1. **Tenant Isolation:**
   - All queries scoped to tenant
   - Tenant ID on all models
   - Tenant-specific settings

2. **Subscription Management:**
   - Plan tiers (Free, Pro, Enterprise)
   - Feature limits per plan
   - Usage tracking
   - Billing integration

3. **White-labeling:**
   - Custom branding per tenant
   - Custom domain support
   - Custom email templates
   - Custom colors and logos

### Audit & Compliance
1. **Full Audit Trail:**
   - Every create/update/delete logged
   - Before/after values stored
   - User, timestamp, IP address
   - Searchable audit log
   - Exportable audit reports

2. **Data Export:**
   - Export any data as CSV/JSON
   - Scheduled exports
   - Data retention policies

3. **Access Control:**
   - Role-based access control
   - Permission-based access control
   - Audit of access attempts
   - Session management

### Missing Industry Features
Research competitors (Jobber, Housecall Pro, ServiceTitan, CleanGuru) and add:

1. **GPS Tracking** — Real-time cleaner location tracking (already partially implemented)
2. **Route Optimization** — Optimize cleaner routes for efficiency
3. **Time Tracking** — Accurate time tracking with GPS verification
4. **Estimate to Invoice** — Seamless quote → job → invoice flow
5. **Recurring Billing** — Automatic recurring invoicing
6. **Online Booking** — Client self-service booking
7. **Review Management** — Collect and display reviews
8. **Team Chat** — Internal team communication
9. **Document Management** — Store contracts, insurance, certificates
10. **Reporting & Analytics** — Business intelligence dashboard
11. **Mobile App** — Progressive Web App for cleaners
12. **Offline Mode** — Cleaners can work offline and sync later
13. **Photo Annotations** — Mark up photos with issues
14. **Checklist Templates** — Reusable checklists per job type
15. **Customer Portal** — Full self-service client experience

---

## Phase 6: Settings Consolidation

### Page-Level Settings
Each page should have its own settings accessible via a "Settings" tab or gear icon:
- **Jobs page settings:** Default job type, default duration, auto-assign rules
- **Clients page settings:** Default payment terms, communication preferences
- **Inventory page settings:** Par levels, reorder thresholds, default suppliers
- **Laundry page settings:** Default turnaround time, partner preferences
- **Finance page settings:** Tax rates, currency, invoice templates
- **Payroll page settings:** Pay periods, default rates, payout methods

### Global Settings (Settings page)
Only truly global settings remain:
- Company information
- Branding (logo, colors, name)
- Timezone and locale
- Email configuration
- SMS configuration
- Storage configuration
- Integration credentials
- Payment gateway configuration
- User and role management
- Audit log
- Feature flags

---

## Phase 7: Performance

1. **Database optimization:**
   - Add missing indexes
   - Optimize slow queries
   - Use database views for complex reports
   - Implement query caching

2. **Frontend optimization:**
   - Code splitting per route
   - Image optimization
   - Lazy loading for heavy components
   - Virtual scrolling for large lists
   - Debounced search inputs

3. **API optimization:**
   - Response caching
   - Request deduplication
   - Batch API calls
   - GraphQL for complex queries (optional)

4. **Real-time updates:**
   - WebSocket for live data
   - Server-Sent Events for notifications
   - Optimistic UI updates

---

## Phase 8: Vibe Coding Rules

These rules must be followed for ALL future development:

### Before Writing Code
1. **Understand the full context** — Read related files before making changes
2. **Check for existing patterns** — Follow existing conventions
3. **Plan the change** — Think through the full impact before coding
4. **Consider edge cases** — What if data is missing? What if user is offline?

### While Writing Code
1. **No AI comments** — No "This component handles...", no explanatory comments for obvious code
2. **No TODO comments** — Either implement it or don't mention it
3. **No placeholder code** — Every feature must be fully implemented
4. **No "for now" code** — Write production-ready code from the start
5. **No console.log** — Use proper logging
6. **No alert()** — Use toast notifications
7. **No window.confirm()** — Use proper confirmation dialogs
8. **No inline event handlers** — Use proper event handling
9. **No magic strings** — Use constants/enums
10. **No duplicated logic** — Extract shared logic

### After Writing Code
1. **TypeScript must pass** — `npx tsc --noEmit` must be zero errors
2. **No unused imports** — Remove them
3. **No dead code** — Remove unused functions, variables, components
4. **Consistent formatting** — Follow project's prettier/eslint config
5. **Test the change** — Verify it works in the browser
6. **Check related pages** — Ensure no regressions

### Database Changes
1. **Never break existing data** — Test migrations on a copy first
2. **Always have a rollback plan** — Know how to undo changes
3. **Test with real data** — Don't just test with seed data
4. **Check foreign keys** — Ensure relationships are maintained

### UI Changes
1. **Test on mobile** — Every page must work on mobile
2. **Test with real data** — Don't just test with empty states
3. **Check accessibility** — Keyboard navigation, screen readers
4. **Check performance** — No layout shifts, fast loading

---

## Phase 9: Implementation Order

1. **Backup** — Database backup, git tag
2. **Remove unnecessary features** — SLA, Phase 3/4, redundant pages
3. **Restructure navigation** — New sidebar, consolidated pages
4. **Consolidate settings** — Page-level + global settings
5. **Improve UI/UX** — Consistent design system, components
6. **Expand cleaning types** — Universal cleaning support
7. **Partner management** — Extensible partner system
8. **Client experience** — Portal improvements
9. **Admin control** — Feature flags, configurable workflows
10. **Multi-tenant** — SaaS readiness
11. **Audit & compliance** — Full audit trail
12. **Performance** — Database, frontend, API optimization
13. **Testing** — Critical path tests
14. **Documentation** — API docs, user guides

---

## Final Checklist

- [ ] Database backup created and verified
- [ ] No existing data lost or corrupted
- [ ] All existing features still work
- [ ] TypeScript compilation passes with zero errors
- [ ] No console errors in browser
- [ ] All pages work on mobile
- [ ] Navigation is clean and intuitive
- [ ] Settings are properly organized
- [ ] No redundant buttons or pages
- [ ] All API routes have proper error handling
- [ ] All forms have validation
- [ ] All lists have search/filter/pagination
- [ ] All destructive actions have confirmation
- [ ] All async operations have loading states
- [ ] All empty states are helpful
- [ ] Audit trail captures all mutations
- [ ] Feature flags work correctly
- [ ] Performance is acceptable (<3s page load)
- [ ] Accessibility basics covered (keyboard nav, ARIA)
- [ ] Code is clean (no dead code, no unused imports)
- [ ] Git history is clean (no WIP commits)
