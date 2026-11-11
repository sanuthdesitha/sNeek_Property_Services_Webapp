# Admin redesign plan (November 2026)

Owner request: redesign eighteen admin areas for reliability, clearer structure and fewer steps, keeping every function that exists today. The owner approved the design direction on 2026-11-11: list plus side panel, one primary action per row, merged Money page, merged Quality hub, a shorter sidebar, and the build order below. Concept screens: the "sNeek Admin Redesign" design canvas.

This document is the plan. It is updated as phases land. `docs/SYSTEM.md` remains the description of what the system does; each phase updates it in the same change.

## Ground rules for every phase

- AGENTS.md applies in full: reuse domain services, revalidate permissions on the server, ADMIN and OPS_MANAGER stay distinct, preserve issued and paid financial records, forward migrations only, Estate primitives, one h1 per page, old URLs keep working.
- No function is removed. Where two pages merge, the old route redirects to the new tab and deep links keep their meaning.
- Each phase ships with: unit tests for the new rules, route tests for authorisation and paging, TypeScript, the full Vitest suite, a production build, and Chromium checks at 390px and 1280px in light and dark.
- List endpoints move from "take N, filter in the browser" to server-side `page`, `pageSize`, `sort`, `dir` and filters, returning `{ rows, total }`. A count shown on screen is always a real total.
- Destructive or financial bulk actions run through one server endpoint that returns a per-row result (done, refused with reason). The screen never loops requests itself and never reports a refused row as done.

## Phase 0: shared building blocks

> **Status (2026-11-11): partly built.** Done: `EDataTable`, `EBulkBar`, `EFilterChips` (plus `EFilterPopover` and `EPill`), `ERowMenu`, `EPagination`, `lib/admin/list-query.ts`, and the merge of the three Money nav entries. `EStageBar` added with Money sub-phase (b). Not yet: `ESidePanel`, `EViewTabs`, sticky group rows in the table, and the wider sidebar regroup. Build and browser checks deferred to the end of the project.

New, in `components/v2/ui/`:

| Piece | Purpose | Notes |
| --- | --- | --- |
| `EDataTable` | Sortable headers, row selection, sticky group rows, empty/loading/error/stale states | Headers are real buttons with `aria-sort`; wide tables scroll inside their own box at 390px |
| `EBulkBar` | Appears when rows are selected; shows count and actions | Keeps selection across pages only within one filter set |
| `ESidePanel` | Right-hand detail panel at 1280px, full-height sheet at 390px | Selection lives in the URL (`?open=<id>`) so a record can be linked |
| `EViewTabs` | Saved views as tabs with counts | Counts come from one grouped query |
| `EFilterChips` | Visible filters with clear | State in the URL; survives refresh and back |
| `ERowMenu` | The "more" menu holding secondary and destructive actions | Destructive items keep their existing PIN and typed-confirmation rules |
| `EStageBar` | Read-only stage indicator | Used by invoices, lost and found, urgent stock |

New, in `lib/admin/list-query.ts`: `parseListQuery` (validates page, size, sort column against an allow-list, direction) and `listResponse`. Every redesigned list route uses it, so paging and sorting behave the same everywhere and an unknown sort column is refused rather than ignored.

Navigation (`app/v2/admin/layout.tsx`): regroup to Today, Operations, People and quality, Money, Setup. Merged entries become one entry; removed entries keep their routes as redirects. Role filtering (`adminOnly`, `canAccess`) is unchanged.

## Build order

1. Phase 0, then Money (items 7, 8, 15)
2. Forms (16, 17, 18)
3. Quality hub and Insights (12, 13, 14)
4. Jobs, Calendar, Command, Live ops (1 to 4)
5. Cases, Laundry, Lost and found, Urgent stock (5, 6, 9, 10)
6. Accounts (11)

## Page plans

### 7, 8, 15. Money: client invoices, cleaner invoices, payroll

Today: `estate-invoices.tsx` is one 1,698-line component with about forty state hooks and seven modals; the list returns the newest 100 only and filters in the browser; a row can show nine buttons; Void, Reverse and Reconcile look alike; "Force status" cannot override anything; Xero is push-only; cleaner invoices have no approve step and no admin PDF; Payroll is a redirect to a Finance tab; the Finance badge counts cleaner invoices.

Front end
- One route, `/v2/admin/finance`, titled "Invoices and pay", tabs: Client invoices, Cleaner invoices, Pay runs, Adjustments and time, Overview. `/v2/admin/payroll` and `/v2/admin/cleaner-invoices` redirect to their tabs. One sidebar entry with a badge that is the sum of drafts to review and cleaner invoices to review, each also shown on its tab.
- Client invoices: `EDataTable` with status chips, client/period/Xero filters, sort on every column, real paging, and one primary action per row chosen from status (Review, Send, Send reminder, Retry Xero). Everything else in `ERowMenu`.
- Invoice editor becomes a page, `/v2/admin/finance/invoices/[id]`, replacing the modal and the unused summary page: stage bar, inline line editing with autosave of drafts, a "Before you approve" checklist built from the checks the API already enforces, send options, Xero panel, history.
- "New invoice" menu: from finished jobs (existing generator), blank invoice, credit note.
- Split `estate-invoices.tsx` into list, row actions, editor sections and dialogs; each under about 300 lines.
- Cleaner invoices use the same table and a read-only version of the editor with Approve, Request changes, Push to Xero, Record payment and PDF.

Back end
- `GET /api/admin/invoices`: server paging, sort and filters through `list-query`; grouped status counts for the chips.
- `POST /api/admin/invoices/bulk`: approve, send, push to Xero, export. Calls the existing single-invoice services inside the same guards (started-work review, transition graph, Xero lock) and returns per-row outcomes.
- Blank invoice: `POST /api/admin/invoices` creating a DRAFT with manual lines only, using the existing numbering and money helpers.
- Credit note: a new invoice linked to the original (`creditsInvoiceId`), negative lines, its own number. This replaces "Reverse" for anything already sent. Requires a migration. Issued and paid invoices are never edited in place.
- Remove "Force status" from the screen. The transition graph stays the only rule.
- Xero: keep the idempotent push. Add a status pull (scheduled worker job plus a manual "Refresh from Xero") that reads the Xero invoice's status and payments and records them through the existing payment path. A payment is recorded only when Xero reports it; a failed or missing read leaves the invoice as it was and shows "Xero state unknown". Requires provider credentials to verify end to end.
- Cleaner invoices: add an APPROVED status between SUBMITTED and Xero/Paid (string status today; no enum migration needed, but existing rows are left as they are). Admin PDF reuses the cleaner download renderer behind an admin guard.
- Fix the nav badge so Finance counts client drafts and Cleaner invoices counts its own.

Risk: highest of all phases. Sub-phases: (a) list, paging, sort, bulk and merge of the three entries, with no change to invoice rules; (b) editor page; (c) blank invoice and credit note; (d) Xero pull; (e) cleaner invoice approve and PDF.

> **(a) built 2026-11-11, awaiting the final build and browser pass.** Delivered: merged page and tabs with redirects, server-paged client invoice list with chip counts and URL state, one action per row plus menu, bulk approve / approve and send / Xero push and CSV export through the shared single-invoice actions, nav badge fix, `estate-invoices.tsx` split. Deviations: Owing is not sortable (no column); "Ready to bill" is a job count with no dollar figure; "Paid this month" is recorded locally, not read from Xero; "Download PDFs" is not in the bulk bar; the nav badge counts client invoices to send (draft or approved), not drafts only. Cleaner invoices are embedded unchanged (the shared table comes with sub-phase (e)). Details: `docs/SYSTEM.md`, "Invoices and pay".

> **(b) built 2026-11-11, awaiting the final build and browser pass.** `/v2/admin/finance/invoices/[id]` is the editor page; the modal is deleted and the admin no longer uses the summary page (the client portal still does). Delivered: header with the list's primary action and a menu of every other action, `EStageBar` (In Xero done only with a Xero invoice id; pending shown as pending; Void as a terminal state), in-place line editing with drag and keyboard reorder, collapsible property sections using the PDF's grouping, inline add line, server-computed "Before you approve" (blocking: pending Xero reservation and started-work review, from the functions approval runs; advice: rates, other invoices, totals), Send / Xero / History cards, read-only presentation with the PATCH's own reason, back link that keeps the list's filters. Save model: explicit "Save draft", not autosave, because the PATCH has no last-write guard. Omitted because the data or API does not support them: editing Bill to / Period / Due, Client reference, Add finished jobs, Add discount, Add note to client, the payment-link and push-on-send options, automatic Xero payment read-back. "Saved N seconds ago" is shown as the last-changed time. Details: `docs/SYSTEM.md`, "Invoice editor page".

> **(c) built 2026-11-11, awaiting the final build and browser pass.** Delivered: blank invoice and credit note in "New invoice ▾", "Issue credit note" on sent invoices (Reverse kept only for approved ones), credit notes on their own `CN-` sequence with limit checks and owing reduced, Xero credit notes (`ACCRECCREDIT`, mocked only), discount lines, client reference / PO and note to client on the PDF, the server-side content lock and PIN checks, one due-date rule for list and PDF, client-facing email link; plus history rows for send, Xero push and bulk, and 401/403 on the invoice route. "Fully credited" is a display state, not a status. Migration `20261111180000_client_invoice_credit_notes`. Details: `docs/SYSTEM.md`, "Credit notes, blank invoices, discounts and server-side invoice locks".

> **(d) built 2026-11-11, mocked Xero only, awaiting the final build and browser pass.** Hourly `xero-invoice-sync` worker job and "Refresh from Xero" (editor, list header, bulk) read Xero invoices and credit notes; new Xero payments are recorded through the existing payment path (method XERO, Xero payment id recorded once, PAID by payments + credits); void/deleted in Xero, differing totals, over/prepayments, unknown credits, vanished payments, payments that would exceed the total and Xero-paid-but-not-settled are left as "Needs review: …"; failed reads are "Xero state unknown: …" and change nothing else. Real states on the list, filter, editor card, stage bar and header badge. Fixed with it: Stripe webhook records the amount charged and settles by payments + credits; the pay route records the amount charged. No payment receipt email is sent for Xero payments (owner to decide). Nothing was run against real Xero; first-run checks are in the review record. Details: `docs/SYSTEM.md`, "Xero status and payment pull; cleaner invoices on the shared design".

> **(e) built 2026-11-11, awaiting the final build and browser pass.** APPROVED step (ADMIN only), one transition table (`lib/cleaner/invoice-transitions.ts`) for routes, bulk and screen, an audit row per transition; push and payment need APPROVED. Cleaner invoices tab on `EDataTable` with chips and real counts, search, payee and period filters, server paging and sort, one action per row, bulk approve / push to Xero / CSV with per-row outcomes, real stat cards, Predicted view unchanged; review page `/v2/admin/finance/cleaner-invoices/[id]` and admin PDF (from the submission snapshot). Deviations: no bulk Record payment (no bulk-safe path); the payee name is not sortable (not a column); the admin PDF is an office copy built from the snapshot, not a re-run of the cleaner's live calculation (which would print a different document); a rejected claim returns an unpushed invoice to SUBMITTED, so it needs approving again. Details: same SYSTEM section.

### 16, 17, 18. Forms: QA templates, forms and stats, templates

Today: no bulk edit, groups, undo, drag, or version history; a save overwrites the published row; the server does not run the validation the phone runs (ranges, email format, details-when-no are client only); option membership is never checked; barcode is a text box; phone, date/time and barcode have no tests; rotation and property conditions cannot be edited in the builder; QA template edits do not bump the version and ops managers see buttons that return 403; a full duplicate of the builder still exists under `components/forms`.

Front end
- One library at `/v2/admin/forms` with tabs: Job forms, QA templates, Checklist blocks, Message templates, Results and stats. `/v2/admin/qa-templates` and `/v2/admin/templates` redirect to their tabs.
- Library: groups and tags, search across form names and question labels, a Checks column, multi-select with bulk actions: edit one question in all selected, add a section to all, find and replace wording, move to group, publish, duplicate, archive, export. Every bulk change shows a preview of each affected form before saving and saves as drafts.
- Builder: drag to reorder and move between sections, multi-select with a shared properties panel (mixed values shown as mixed), copy questions to other forms, saved blocks, undo and redo, version list with restore, "Test as cleaner" using the real renderer, publish blocked while a check fails. Rotation, per-room repeat and property conditions become editable here.
- QA templates use the same builder shell with their own field set.

Back end
- Versioning: a `FormTemplateVersion` table (template id, version, schema, author, note, created at). Saving a draft writes a draft row; publishing writes a version and updates the live schema. Existing templates get one version row copied from their current schema by the migration. Restore creates a new version; history is never rewritten. Submissions keep the revision they were filled against (already recorded).
- Groups and tags: `FormTemplate.groupId` plus a small `FormTemplateGroup` table; tags as a string array.
- One typed schema: extend `lib/forms/types.ts` to cover `frequency`, `rotationEveryNCleans` and `conditional.propertyField`, and tighten the Zod schema so unknown field types are refused on save. Existing stored schemas are read through a tolerant parser so nothing already published breaks.
- Server validation on submit: run `collectFormErrors` in the cleaner submit route so ranges, email format, option membership and details-when-no are enforced on the server. Introduced as warnings recorded on the submission for one release, then enforced, so an in-flight draft is never rejected by a rule it could not have known.
- Field type audit with a test per type covering builder definition, renderer and server validation. Barcode gets a real camera scanner with manual entry as the fallback, and says which was used.
- Bulk endpoint `POST /api/admin/form-templates/bulk` returning a preview (dry run) or applying as drafts.
- QA templates: every save bumps the version; a warning when two active templates share a job type and scope; delete and duplicate; buttons hidden from roles that cannot use them.
- Retire `components/forms/*` and `app/admin/forms/*` once nothing imports them; the classic routes redirect.

> **Library half built 2026-11-11, awaiting the final build and browser pass.** Delivered: one `/v2/admin/forms` page with the five tabs and redirects from `/v2/admin/qa-templates`, `/v2/admin/templates`, `/v2/admin/checklists` and `/v2/admin/forms/stats`; one "Forms" sidebar entry; Job forms list (groups, tags, search across question labels, Status / Used by / Has problems filters, server paging with real counts, Used by, Questions, Avg time, Completion, Checks); bulk edit-question, add-section, find-and-replace (drafts, after a preview), move to group, tags, publish, duplicate, archive with per-form outcomes; `FormTemplateVersion` drafts and published versions with restore (API) and the builder's save wired to the draft; groups API; operations managers no longer see QA-template write buttons. Migration `20261111150000_form_template_library`. Not yet (builder step and later): drag, multi-select inside one form, undo/redo, version list screen, test as cleaner, publish blocked while a check fails (enforced for bulk publish only), Compare view, Import, export bulk action, typed schema extension, server validation on submit, field type audit, barcode scanner, QA-template version bump and duplicate/delete, retiring `components/forms`. The legacy PATCH route still writes live. Details: `docs/SYSTEM.md`, "Forms library: one Forms page, draft versions and bulk edits".

### 12, 13. Quality hub (Quality, QA issues, Accountability, QA performance)

Today: three pages read `QaIssue` grouped three ways with near-identical API code; actions live in different places; the issues list shows 50 rows as if that were the total; the inspection queue is capped at 12; laundry metrics sit on the accountability page.

- One route `/v2/admin/quality`, tabs: Review queue, Issues, Cleaners, Inspectors, Categories, Coaching. One period control and one filter set shared by all tabs, kept in the URL. Old routes redirect to tabs.
- One service, `lib/quality/hub.ts`, with one period helper and three groupings over the same query, replacing the duplicated route code. Totals come from counts, not page length.
- Issues: server paging and sort, filter options from the database rather than from loaded rows, bulk mark-fixed and export. Row actions unchanged in rule: rectify, propose deduction (still a pending adjustment needing approval), escalate, false-confirmation decision.
- Cleaners: expandable row with that cleaner's open issues and the same actions, plus start coaching and propose bonus (both existing flows).
- Review queue: the quick-score list and the inspection queue without the 12 cap, with select all and sort.
- Laundry team metrics move to the Laundry page's Statistics tab.

> **Built 2026-11-11, awaiting the final build and browser pass.** Delivered: one hub at `/v2/admin/quality` with one Sydney-day period control (7 / 30 / 90 days / custom), Export, five stat cards with stated bases ("–" / "not enough data" without data; the score change only when the previous period has reviews), tabs Review queue, Issues, Cleaners, Inspectors, Categories, Coaching, and one shared filter row, all in the URL. Old routes redirect with their parameters (register `from`/`to` become a custom period); one sidebar entry badged with unclaimed inspections plus pending rectifications. One service, `lib/quality/*`: one period helper, one filtered issue query, the groupings by cleaner / inspector / category (tested to agree), streaks read with one query per cleaner. Issues: server paging and sort, options from the database, real total, the existing detail and actions, bulk "Mark fixed" through the single action's rectify transaction with per-row outcomes, CSV export. Cleaners: as drawn, expandable rows with the cleaner's open issues and actions, by-category breakdown, "Open all N in Issues"; row action "Start coaching" (existing pattern rule, existing coaching route) or "Review bonus" (the nightly job's pending proposal, approve / decline through the existing endpoint). Inspectors: QA performance as a sortable table with drill-down. Categories: replaces the matrix. Review queue: quick score with select all / clear / sort and the inspection queue paged without the 12 cap. Coaching: the existing workspace embedded as a panel. Laundry team metrics moved to `/v2/admin/laundry/stats`. Deviations: severity reads minor / major / critical; "Review bonus" instead of "Propose bonus" (bonuses are already proposed by the nightly job; no manual propose flow exists); period boundaries are Sydney calendar days and cleaner "Cleans" is the submitted-clean basis (both deliberate). No schema change. Details: `docs/SYSTEM.md`, "Quality hub".

### 14. Insights (was Reports)

Today the page only manages the per-job client PDF and shows no figures.

- `/v2/admin/reports` becomes "Insights" with tabs Business, Properties, Clients, Cleaners, Time and cost, Client report PDFs (the current manager, unchanged in function, plus the missing laundry visibility toggle and bulk visibility/regenerate).
- `lib/insights/*`: revenue, cleaner cost and margin by period, property and client; planned against actual hours; on-time rate; rework rate; issues by category and property; days to pay by client. Built from existing tables through existing money helpers.
- Every figure states its basis and refuses to show a number when the inputs are missing (no rate, no time log): it shows "not enough data" with the count of excluded jobs.
- "Worth knowing" lists the largest period-on-period changes above a threshold, each linking to the records behind it. It is rule-based, not generated text.
- CSV export per table; optional monthly email through the notification pipeline.

> **Built 2026-11-11, awaiting the final build and browser pass.** Delivered: Insights page and six tabs, `lib/insights/*` with one period helper on Quality's Sydney days, every figure as value + basis + excluded-with-reason (withheld below the minimum, no change without comparable data), four rule-based finding detectors with named thresholds and links, server-sorted/paged entity tables, Time and cost, CSV per tab, finance fields omitted server-side for operations managers without `finance`; PDFs tab with the laundry toggle, bulk visibility / regenerate / delete with per-row outcomes, shared delete confirmation, URL filters and legacy-link rule. Deviations: revenue is the scheduled charge (not invoiced money); "Email monthly" not built (no schedule or recipient store); without finance the property preview ranks by time over plan; the client filter is a select styled as the chip. Details: `docs/SYSTEM.md`, "Insights".

### 2. Jobs

- Split `jobs-workspace.tsx` (1,190 lines) into list, filters, bulk bar and peek panel.
- Saved views as tabs with counts; sort from column headers; status filter covers every status; export respects the selection.
- Peek panel (`?open=`) with summary, people, money and activity loaded on demand, and cleaner suggestions from availability and clashes.
- One row action plus menu ("Manage" and "Open" are the same destination today).
- Bulk reminders through one endpoint with per-row results. Board view lanes come from the server and support drag between statuses that the transition rules allow.
- Job detail: tabs load their own data instead of loading all eleven on every request; the duplicated Quality block is merged.

> **List built 2026-11-11, awaiting the final build and browser pass.** Delivered: header with the real match count, built-in view tabs with totals from one grouped query plus personal saved views, visible filter chips (Status over all eleven statuses), server-sorted table grouped by Sydney day with one row action and a menu, Guest in and Charge columns, the reusable `ESidePanel` peek (`?open=`) with Summary / People / Money / Activity on demand and ranked cleaner suggestions, bulk bar with `POST /api/admin/jobs/bulk-remind` (per-row outcomes) and selection export, server board lanes with drag through the reviewed status change; `jobs-workspace.tsx` split (largest file 260 lines); the job detail's duplicated Quality block merged. Deviations: no bulk Reschedule (no bulk-safe service); suggestions omit distance and QA score; Cleaner / Guest in / Charge not sortable; saved-view tabs carry no count; "Not invoiced" = Completed + the existing Invoice "no" rule. Not done in this step: lazy-loading the detail page's tabs. Details: `docs/SYSTEM.md`, "Jobs list: view tabs, visible filters, peek panel and server board".

### 3. Calendar

- Day, Week, Month and Agenda. Week is laid out by cleaner (or by property) with an Unassigned lane.
- `GET /api/admin/calendar?start&end` returns only the visible range with a slim shape. Today the page calls `/api/jobs` with no bounds.
- Drag to reschedule or reassign calls the existing schedule and assign services, with clash and leave checks before the drop is accepted; a refused drop returns to its place with the reason.
- Error and stale states; filters persisted; "+N more" opens that day.

> **Built 2026-11-11, awaiting the final build and browser pass.** Delivered: header with the real summary line, Day | Week | Month | Agenda, chip row as drawn, URL state with saved toggles; week resource grid by cleaner (Unassigned lane, hours on a stated basis, roster gaps, laundry-runs row linking to Laundry for that day) or by property; day view on an hour axis; month kept with "+N more" opening the day; agenda as a stated fortnight; phone lists; `GET /api/admin/calendar` (visible range only, ≤ 45 days, drafts excluded); drag and "Move or reassign…" through the read-only check-move, a confirmation and the existing reschedule / assign endpoints; error, loading, empty and stale states with a 60 s refresh that never redraws a chip mid-save; the shared job peek panel; `estate-schedule.tsx` split. Deviations: "Not rostered" instead of "Day off"/"Leave" (no leave data); a status key and Refresh button added (the old screen's legend role and manual reload); drag is mouse/pen only (touch uses the menu); on-the-way jobs are also not draggable; day-view drops change the cleaner, not the time. Details: `docs/SYSTEM.md`, "Calendar: resource week, visible range only, checked moves".

### 1. Command

> **Built 2026-11-11, awaiting the final build and browser pass.** Date heading with real summary, portal-search box, New job, four filtered counters, the work queue (`lib/dashboard/work-queue*.ts`, every old attention kind kept, inline continuation / reimbursement / assign decisions on existing endpoints, role and pack filtering server-side), Today by cleaner, Money this month (finance/payroll only), and the old page's status, on-shift, upcoming, feedback and laundry figures below the fold. Sections load and refresh independently (`GET /api/admin/command/[section]`). Deviations: "Invoiced" shown as "Paid this month"; expiry reminder is link-only; Approvals and Lost and found links are unfiltered until those pages gain selection parameters; case links use the Cases inbox's `?open=` / `?queue=` (Cases step, in progress). Details: `docs/SYSTEM.md`, "Command and Live ops".

- One work queue from `lib/dashboard/work-queue.ts`, merging the attention summary, Live ops' immediate-attention list and the approvals that can be decided inline. Each item has a type, urgency, link with filters applied, and at most one inline action that calls the existing approval or assignment service.
- KPI tiles link to pre-filtered pages. "Today by cleaner" strip. Each section loads independently, so one failed query shows one failed section.

### 4. Live ops

> **Built 2026-11-11, awaiting the final build and browser pass.** "Live ops" heading, real summary and stream indicator, layer chips, Plan routes; real-count chips; exceptions (late, off site with the clock running, continuation, not started) with their actions; on-site progress incl. laundry routes; map with the selected person's card; one shared feed; field status; "Also needs attention" to Command; `/ops/map` redirect; Sydney day. Deviations: "Pause clock" is "Review clock" (no admin pause endpoint); "Tell client" opens the job's Messages tab (no admin delay-notice endpoint). Details: `docs/SYSTEM.md`, "Command and Live ops".

- Map first with an exceptions list beside it: late, off site with the clock running, continuation requests, not started. Each has its actions.
- One live feed shared by the map and the list. Counters are real counts. Planning lists move to Command. `/ops/map` redirects here. Sydney day boundaries use the shared helper.

### 5. Cases

- Queues (needs my reply, unowned, waiting on client, SLA at risk, all open, resolved) as server filters with counts.
- List endpoint returns summaries only; the conversation loads when a case is opened. Selection in the URL; `?jobId=` is honoured.
- Conversation with reply or internal note, templates and attachments. Details panel with linked job, property, cleaner, departing guest, report and evidence filled from the job.
- "New case" can link a job, property or client. Bulk assign and close.

### 6. Laundry

- Tabs: Pipeline, By property, Drivers live, Costs and invoices, Suppliers, Statistics (the unlinked stats page moves in).
- Pipeline lanes by stage for a chosen day with exceptions first; a side panel carries edit, reschedule, evidence replacement and skip.
- Polling runs only on Pipeline and Drivers live. Stat captions state their real scope. Reschedule approvals link to Approvals.

### 9. Lost and found

- Guest details prefilled from the linked job's reservation (the departing guest): name, phone, email, stay dates, booking code and source. Stored on the item with a `guestSource` of `BOOKING` or `MANUAL`, so an office edit is never overwritten by a later sync. "Pick another booking" lists the property's reservations around the found date. Migration adds `guestEmail`, `guestSource`, `reservationId`, `storageLocation`.
- Existing items are backfilled only where `guestName` and `guestContact` are both empty.
- Table with stage tabs, holding-period flag from a setting, bulk move/unclaimed/donate, office can log an item.
- "Message guest" drafts the message; sending goes through the notification pipeline with an explicit transport and moves the stage only when the send is accepted.
- The reporting cleaner still does not receive guest details.
- Status changes follow a transition table; reopening a closed item is an explicit action that records who and why.

### 10. Urgent stock

- First tab of Stock at `/v2/admin/inventory?tab=urgent-stock`, visible to roles that may act on it; `/urgent-stock` redirects into the Estate shell.
- Needs move from `AppSetting` JSON to `UrgentStockNeed` and `UrgentStockEvent` tables. The migration copies every existing need and event; the old rows are kept until the copy is verified, and reads fall back to them during that release.
- All-property table sorted by the next clean that needs the item, stage chips, side panel with stay preparation and history, bulk acknowledge and add to a shopping run. A stock request still does not place a purchase or prove delivery.
- Nav badge for needs awaiting acknowledgement.

### 11. Accounts

- One table for everyone with role tabs, sort, paging, bulk resend invite, change rate, message, disable, and export.
- Person panel with sections edited in place: contact, access (role, extra roles, sign-in, status), pay, documents, office notes, activity. Reset password, reset 2FA and delete move to the menu with their existing PIN rules.
- Pay rate becomes editable: `PATCH /api/admin/users/[id]/pay` (ADMIN only) with an effective date, audited, never changing rate snapshots on paid or issued work.
- The receivables figure leaves this page. Client users get a profile link. Operations managers see only the controls they can use.

Status (2026-11-11): built, browser pass pending. Not built: the pay rate's effective date (needs an effective-dated rate table, i.e. a schema migration; today a new rate applies from saving) and bulk "Message" (no staff messaging path takes a list of accounts through the notification pipeline). Also fixed here: last-active-admin guard, the VA account menu's missing PIN, client-login profile.

## Owner decisions (2026-11-11)

1. Credit notes: approved as the way to correct a sent invoice, replacing "Reverse" for anything already sent.
2. Xero pull: a payment seen in Xero marks the invoice paid automatically. It is recorded through the existing payment path with Xero as the source, and only when Xero reports it; a failed or missing read changes nothing.
3. Lost and found holding period: 14 days before an unclaimed item is flagged.
4. Cleaner invoices: only administrators approve them. Operations managers can view where their permissions allow, but not approve.

## Additions approved by the owner for Money step (c) (2026-11-11)

To be built together with blank invoices and credit notes, after the Forms migration has landed (both change `schema.prisma`):

1. Server-side edit lock: `PATCH /api/admin/invoices/[id]` refuses content edits once an invoice is SENT (or later), matching what the screen already allows. Corrections after sending go through a credit note.
2. Server-side security check: removing a line and deleting an invoice verify the administrator PIN or password on the server, not only in the browser.
3. Discount line: a negative manual line with its own type, shown and totalled on the PDF, never allowed to take the invoice total below zero.
4. Client reference / PO number: a field on the invoice, editable while DRAFT or APPROVED, printed on the PDF and sent to Xero as the reference.
5. Note to client: stored on the invoice, editable while DRAFT or APPROVED, printed on the PDF.

Also in that step: the PDF and the list use the same organisation-timezone rule for the due date, and the emailed invoice link points to the current invoice page.

## Standing rule from the owner (2026-11-11): fix existing problems by default

When a step finds a problem that was already in the code, it is fixed in that step (or the next one touching that area) with a test, and reported as fixed. It is no longer listed as "noticed, not fixed". Exceptions that still need the owner: anything that changes a business rule, money, or who can see or do what.

Backlog found so far, to be cleared under this rule:

| Problem | Area | Status |
| --- | --- | --- |
| A job whose only invoice line is on a voided invoice counts as invoiced, so it never shows as unbilled | Jobs filter, ready-to-bill | Fixed 2026-11-11 (Jobs filter, view count, job detail note) |
| Single-job reminder records the push notice as sent before delivery and bypasses the notification pipeline | Jobs | Partly fixed 2026-11-11: real state recorded (queued / provider-accepted); move to the intent pipeline needs the owner (cleaner recipient scope) |
| `EField` labels are not tied to their inputs | Shared admin kit | Fixed 2026-11-11 (admin, settings and worker kits) |
| `GET /api/admin/qa/issues` end date uses server-local time, not Sydney | Quality | Fixed 2026-11-11 |
| Coaching tab fails quietly for an operations manager without the workforce pack | Quality | Fixed 2026-11-11 (tab hidden when its APIs would refuse; explicit states) |
| Old template-versions API switches which form jobs resolve to, with no screen | Forms | Fixed 2026-11-11 (writes answer 410; read kept) |
| Saving through the old form PATCH still writes the live form and records no version | Forms | With the builder step |
| GET/DELETE invoice routes answer 400 for unauthorised or forbidden | Invoices | With the invoice step |
| Invoice page errors on a malformed started-work snapshot instead of showing it read-only | Invoices | With the invoice step |
| Send and Xero push write no audit row; bulk audit rows do not appear in an invoice's history | Invoices | With the invoice step |
| Stripe webhook marked the invoice paid at its full total whatever was charged, ignored credits and never updated a PART_PAID invoice | Invoices | Fixed in Money (d) |
| Client pay route stored the invoice total, not the amount charged, on its payment attempt | Invoices | Fixed in Money (d) |
| Header "Xero connected · last sync" showed a token-refresh time | Invoices | Fixed in Money (d) |
| Rejecting a payee's payment claim on an invoice already in Xero was refused | Cleaner invoices | Fixed in Money (e) |
| The admin PATCH let a PAID_CLAIMED invoice be sent back or voided (releasing work the payee says was paid) | Cleaner invoices | Fixed in Money (e) |
| Cleaner portal showed a reversed invoice as "Submitted" | Cleaner invoices | Fixed in Money (e) |

## Owner requirements restated (2026-11-11)

- Every one of the fifteen screens on the design canvas is built as rendered: Command, Jobs, Calendar, Live ops, Cases, Laundry, Lost and found, Urgent stock, Invoices and pay, Invoice editor, Accounts, Quality hub, Insights, Forms library, Template builder.
- No existing function is lost. Each step ends with a parity table: every action, filter, link and view of the pre-redesign screen (read from `origin/main`) mapped to where it now lives. Before the final merge, one independent parity audit covers all eighteen original areas against `origin/main`, and anything missing is restored before merging.
- When everything is built and the full verification passes (type check, full test suite including database tests, production build, browser pass at 390px and 1280px in light and dark), the branch is merged to `main` by pull request.

## Items waiting for the owner (not changed; collected for the final summary)

Each of these would change a business rule, money, or who can see or do what, so it was left as it is.

| Item | Found in | Question |
| --- | --- | --- |
| Job reminders are not on the notification pipeline | Jobs | Moving them needs cleaners as pipeline recipients, a phone-app transport, and the external-transport setting switched on in production; otherwise email reminders would silently stop |
| Manual reminders ignore the recipient's notification preferences | Jobs | Should a manual reminder respect them? |
| A line on a voided invoice still blocks deleting or resetting a job | Jobs | Should a voided invoice stop counting as a financial record for delete/reset? |
| A job with status INVOICED but no live invoice line is treated as invoiced by the Jobs filter, while the generator would still bill it | Jobs / invoices | Which is right? |
| Finance overview counts cleaner cost at a default pay rate when none is set | Finance / Insights | Insights excludes those cleans; should the overview do the same? |
| Insights revenue uses today's rate card, so an old period's revenue moves when rates change | Insights | Switch to invoiced line totals as the fixed record? |
| No per-client payment terms; the slow-payer finding uses the default for everyone | Insights | Add per-client terms? |
| Monthly Insights email | Insights | Needs a schedule, a stored recipient and a settings entry; build it? |
| Credit notes are not allocated to the original invoice in Xero | Invoices | Left as a manual step in Xero |

## Owner decisions on the waiting items (2026-11-11, second set)

1. **Reminders and notifications.** Move job reminders onto the notification pipeline, and make sure every notification that works today still goes out afterwards (switch the needed transports on as part of the move; nothing may silently stop). The owner wants all notifications controlled from ONE place: a single notifications area showing every notification type, who receives it, by which transport, whether it is on, and its delivery log.
2. **Voided invoices and delete/reset.** A line on a voided invoice must not block deleting or resetting a job.
3. **INVOICED with no live invoice line.** Fix the inconsistency: one rule everywhere. A job is invoiced only while it has a line on a non-void invoice; when an invoice is voided or a credit fully reverses it, its jobs stop counting as invoiced and are billable again.
4. **Default pay rate.** Do what is right: a clean whose cleaner has no pay rate set is not costed at a silent default in the Finance overview; it is left out, counted, and flagged so the rate can be set.
5. **Insights revenue.** Use invoiced line totals as the fixed record for past periods; scheduled charge only for work not yet invoiced, labelled as such.
6. **Build:** per-client payment terms (used for due dates, overdue and the slow-payer finding) and the monthly Insights email (schedule, stored recipients, a settings entry, sent through the notification pipeline).

Build order for these: a "Finance decisions" step (2 to 6, includes a migration for per-client terms and email settings) and a "Notifications in one place" step (1), each after the step currently holding the schema.

### More items waiting for the owner (from the Accounts step)

| Item | Question |
| --- | --- |
| Pay rate has no "applies from" date | Build effective-dated pay rates? Needs a migration. Today a new rate applies from the moment it is saved; amounts already paid never change |
| "Resend invite" sends a sign-up code, not a fresh invitation link | Intended? |
| Operations managers see pay rate and bank details whatever their payroll permission | Keep, or restrict to those with payroll access? |
| No bulk "Message" to staff | Build once staff are recipients on the notification pipeline (part of "Notifications in one place") |

### More items waiting for the owner (from the Command and Live ops step)

| Item | Question |
| --- | --- |
| Money this month and revenue today are hidden from operations managers without finance or payroll access | Confirm this is wanted |
| "Tell client" about a late cleaner opens the job's Messages tab | Add a one-click "notify client of delay"? It changes who can message clients |
| "Pause clock" is "Review clock" (opens the job's time records) | Add an administrator clock pause? None exists today |
| Expiring-document reminder is a link to the account | May it send the existing document request inline? |
| "Invoiced this month" is shown as "Paid this month" | Define "invoiced this month" (by invoice date, sent date, or approval date) |
| Declining a continuation from the queue sends no note to the cleaner | Require a reason? |
