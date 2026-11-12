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

> **Builder half built 2026-11-11, awaiting the final build and browser pass.** Delivered as drawn: header (name h1 + state pill, real usage, Undo/Redo, Versions, Test as cleaner, Publish vN), Outline (sortable sections, per-room / property-rule badges, every registered type, saved blocks), Questions (sortable rows, real badges, select all, bulk Move/Copy/Duplicate/Save as block/Delete), properties panel for one question or "Editing N questions together" with Mixed values, "Cleaner sees" in the real renderer. Drag and drop with keyboard sensors and row-menu alternatives; undo/redo; autosaved drafts with the 409 conflict choice; Versions drawer (view, diff against live, restore with replace confirmation); publish blocked by a check error in the single publish path; Test as cleaner (sandbox renderer + server check, writes nothing); copy to other forms (bulk `insert-questions`, drafts) and saved blocks (AppSetting `formBuilder.savedBlocks`); rotation, per-room repeat (section `repeatBy`, expanded at read time) and property rules editable here. Typed schema with strict save check and tolerant reader; submit route records extended validation warnings (`ENFORCE_EXTENDED_FORM_VALIDATION = false`); field type audit; barcode scanner; searchable dropdown; QA template revisions (audit log, version column untouched), overlap warning, duplicate, delete-or-deactivate, filters, preview; legacy PATCH routes content to the draft; classic builder deleted with redirects (the classic `/admin/forms` page stays for its Submissions and Checklists tabs). Not drawn: "Table", "Stock count" (not registered types), "Raises urgent stock" / "opens a damage report" badges (no schema drives them), "Monthly" cadence (no runtime support). Details: `docs/SYSTEM.md`, "Form builder: outline, questions, shared settings, versions and test as cleaner".

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

> **Update 2026-11-12 (Finance decisions).** Revenue is now invoiced line totals (ex GST, net of credit notes) for invoiced cleans plus the scheduled charge for cleans not yet invoiced, shown as a split; days to pay and the slow-payer finding use per-invoice payment terms; "Email monthly" is built (Settings → Notifications → Monthly Insights email; header shows its state). Details: `docs/SYSTEM.md`, "Finance decisions".

### 2. Jobs

- Split `jobs-workspace.tsx` (1,190 lines) into list, filters, bulk bar and peek panel.
- Saved views as tabs with counts; sort from column headers; status filter covers every status; export respects the selection.
- Peek panel (`?open=`) with summary, people, money and activity loaded on demand, and cleaner suggestions from availability and clashes.
- One row action plus menu ("Manage" and "Open" are the same destination today).
- Bulk reminders through one endpoint with per-row results. Board view lanes come from the server and support drag between statuses that the transition rules allow.
- Job detail: tabs load their own data instead of loading all eleven on every request; the duplicated Quality block is merged.

> **List built 2026-11-11, awaiting the final build and browser pass.** Delivered: header with the real match count, built-in view tabs with totals from one grouped query plus personal saved views, visible filter chips (Status over all eleven statuses), server-sorted table grouped by Sydney day with one row action and a menu, Guest in and Charge columns, the reusable `ESidePanel` peek (`?open=`) with Summary / People / Money / Activity on demand and ranked cleaner suggestions, bulk bar with `POST /api/admin/jobs/bulk-remind` (per-row outcomes) and selection export, server board lanes with drag through the reviewed status change; `jobs-workspace.tsx` split (largest file 260 lines); the job detail's duplicated Quality block merged. Deviations: no bulk Reschedule (no bulk-safe service); suggestions omit distance and QA score; Cleaner / Guest in / Charge not sortable; saved-view tabs carry no count; "Not invoiced" = Completed + the existing Invoice "no" rule. Not done in this step: lazy-loading the detail page's tabs. Details: `docs/SYSTEM.md`, "Jobs list: view tabs, visible filters, peek panel and server board".

> **Job full view built 2026-11-12 (uncommitted; build, full suite and browser pass pending).** Boards "Job full view" and "Job page in four states". No schema change, no new route or permission. Details: `docs/SYSTEM.md`, "Admin job page: "Job full view" redesign (2026-11-12)".
> - [x] Header with breadcrumb, h1 + badge, one status-driven primary (pure table, every status), secondary buttons, More menu (Job / Danger zone, disabled reasons, footnote); eight-step `EStageBar`; key facts; lead block per state; blockers linked into stages.
> - [x] Timeline of nine stages from the existing components; Form answers, Photos, Clock and GPS, Messages, History tabs; right rail (People, Property access, Money, Linked, Messages).
> - [x] Old `?tab=` and `#chat` links mapped; every old function kept (parity table in the step report and review record).
> - Differences from the boards: no lockbox code reveal on the job (codes are encrypted and kept on the property's access guide); clock-in location is the job's single GPS record, not one per cleaner; pay shows "Estimate" and never "Paid run …" (the payroll run is in the pay ledger, not read here); "Message team" opens the office compose workspace without preset recipients (the job chat is client↔office only); "Send back for rework" is the existing quick QA score review with a below-threshold score (no separate send-back route exists); no "E" keyboard shortcut; no "Hide removed references" toggle on the photo strip; no "Synced …" time on Booking (not stored per reservation); Open case and Log lost item open the existing dialogs without a preset job (those dialogs belong to other work streams); the AI suggestion is not counted in the blockers line (its read runs in the browser; it shows in the Submitted stage); finished jobs collapse done stages rather than reorder the timeline.
> - Waiting for the owner: should "Message team" get a job-scoped team message (a new transport decision)? Should the job page show the lockbox code with an audited reveal? Should "Send back for rework" become its own action without a score?

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

> **Built 2026-11-11, awaiting the final build and browser pass.** Delivered: four columns as drawn; queues with real counts (Needs my reply = open, owned by me, latest non-internal message from a CLIENT/VA account; Unowned; Waiting on client; SLA at risk; All open; Resolved; plus the old Awaiting me and All) and type counts; `GET /api/admin/cases?shape=summary` (summaries only, server paging, allow-listed sorts; old shape kept for other callers); conversation with Waiting on client / Resolve, every other action in the menu, internal notes labelled, composer with Reply to client | Internal note, Insert template (existing resolution templates), Attach; per-case unsent drafts in memory; details with every old field and "Linked, filled in automatically" from the job (`/api/admin/cases/[id]/linked`); `?open=`, `?jobId=`, `?reportId=`; New case with job/property/client links validated on the server; `POST /api/admin/cases/bulk` with per-row outcomes through the shared `applyCaseUpdate`; phone steps. Deviations: no "Raise QA issue for cleaner" (no admin create path; QA issues come only from a QA review); Create repair quote is a plain link (the quote builder takes no prefill); Add charge opens the client's draft invoices; the old Refresh button is replaced by focus/30 s refresh and Retry. Details: `docs/SYSTEM.md`, "Cases inbox and Laundry pipeline".

### 6. Laundry

- Tabs: Pipeline, By property, Drivers live, Costs and invoices, Suppliers, Statistics (the unlinked stats page moves in).
- Pipeline lanes by stage for a chosen day with exceptions first; a side panel carries edit, reschedule, evidence replacement and skip.
- Polling runs only on Pipeline and Drivers live. Stat captions state their real scope. Reschedule approvals link to Approvals.

> **Built 2026-11-11, awaiting the final build and browser pass.** Delivered: header with the day's real summary, Previous / Today / Next, Generate week, Add run (dialog over the existing `POST /api/admin/laundry`); three tiles with stated scope; six tabs with old `?tab=` ids mapped and `/v2/admin/laundry/stats` redirecting to Statistics; server-built lanes (`/api/admin/laundry/pipeline`) with exceptions, overdue carry-in, real counts, Driver (from the day's routes) and Supplier filters, Exceptions first; run side panel with every old card action; checked moves (`/api/admin/laundry/reschedule`, per-row outcomes, stale-write refusal); Completed history keeps the old date-range lists; polling only on Pipeline lanes and Drivers live; Approvals link with the FLAGGED count; one shared week feed for history and By property; By property restyled; `laundry-workspace.tsx` split (largest new file 300 lines). Deviations: no Ask cleaner / Chase supplier / Request photo buttons (no on-demand reminder path exists); tiles kept although the drawing has none (brief); card times show days, not clock times, except delivery time. Fixed: live stops used the server's midnight. Details: `docs/SYSTEM.md`, "Cases inbox and Laundry pipeline".

### 9. Lost and found

- Guest details prefilled from the linked job's reservation (the departing guest): name, phone, email, stay dates, booking code and source. Stored on the item with a `guestSource` of `BOOKING` or `MANUAL`, so an office edit is never overwritten by a later sync. "Pick another booking" lists the property's reservations around the found date. Migration adds `guestEmail`, `guestSource`, `reservationId`, `storageLocation`.
- Existing items are backfilled only where `guestName` and `guestContact` are both empty.
- Table with stage tabs, holding-period flag from a setting, bulk move/unclaimed/donate, office can log an item.
- "Message guest" drafts the message; sending goes through the notification pipeline with an explicit transport and moves the stage only when the send is accepted.
- The reporting cleaner still does not receive guest details.
- Status changes follow a transition table; reopening a closed item is an explicit action that records who and why.

Status (2026-11-11): built, browser pass pending. Migration `20261111200000_lost_found_guest_urgent_stock_tables` verified on fresh and existing databases. "Message guest" sends through the notification step's guest-message action (administrators; moves to Guest contacted only when the provider accepted); operations managers and "Tell client" copy the draft and record what they did (no pipeline recipient for a lost-and-found client). Waiting for the owner: should operations managers be able to send guest messages (the notification step allows administrators only)? **Answered 2026-11-12 (ninth set): yes, with the Lost & found pack at manage.**

### 10. Urgent stock

- First tab of Stock at `/v2/admin/inventory?tab=urgent-stock`, visible to roles that may act on it; `/urgent-stock` redirects into the Estate shell.
- Needs move from `AppSetting` JSON to `UrgentStockNeed` and `UrgentStockEvent` tables. The migration copies every existing need and event; the old rows are kept until the copy is verified, and reads fall back to them during that release.
- All-property table sorted by the next clean that needs the item, stage chips, side panel with stay preparation and history, bulk acknowledge and add to a shopping run. A stock request still does not place a purchase or prove delivery.
- Nav badge for needs awaiting acknowledgement.

Status (2026-11-11): built, browser pass pending. Needs and events copied to the tables by the same migration (unreadable JSON rows stay in AppSetting, counted by the query in SYSTEM.md); reads and writes now use the tables only (no read fallback to the old rows; this replaces "reads fall back" above). Not built: "Add to one shopping run" and the panel's "Ask cleaner to buy" — no existing service adds a line to a shopping run or asks a cleaner to buy. The reporter's job is not shown: a need never recorded the job. Waiting for the owner: the tab stays administrator-only (the urgent stock service refuses operations managers); widen it?

Update (Wave F, 2026-11-12): all three built ("Add to shopping run", "Ask cleaner to buy", the job on a need) and operations managers use the tab with their inventory pack (owner decisions five and seven). See Wave F below.

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
| Saving through the old form PATCH still writes the live form and records no version | Forms | Fixed 2026-11-11 (content saves the draft; metadata audited) |
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
| A line on a voided invoice still blocks deleting or resetting a job | Jobs | Should a voided invoice stop counting as a financial record for delete/reset? — **Resolved 2026-11-12 (Finance decisions)**: no longer blocks (fully credited still does) |
| A job with status INVOICED but no live invoice line is treated as invoiced by the Jobs filter, while the generator would still bill it | Jobs / invoices | Which is right? — **Resolved 2026-11-12 (Finance decisions)**: one rule, live invoice line only; legacy rows repaired by the migration |
| Finance overview counts cleaner cost at a default pay rate when none is set | Finance / Insights | Insights excludes those cleans; should the overview do the same? — **Resolved 2026-11-12 (Finance decisions)**: excluded, counted, flagged (pay itself unchanged) |
| Insights revenue uses today's rate card, so an old period's revenue moves when rates change | Insights | Switch to invoiced line totals as the fixed record? — **Resolved 2026-11-12 (Finance decisions)** |
| No per-client payment terms; the slow-payer finding uses the default for everyone | Insights | Add per-client terms? — **Resolved 2026-11-12 (Finance decisions)**: built, snapshotted on issued invoices |
| Monthly Insights email | Insights | Needs a schedule, a stored recipient and a settings entry; build it? — **Resolved 2026-11-12 (Finance decisions)**: built, off by default |
| Credit notes are not allocated to the original invoice in Xero | Invoices | Left as a manual step in Xero |

## Owner decisions on the waiting items (2026-11-11, second set)

1. **Reminders and notifications.** Move job reminders onto the notification pipeline, and make sure every notification that works today still goes out afterwards (switch the needed transports on as part of the move; nothing may silently stop). The owner wants all notifications controlled from ONE place: a single notifications area showing every notification type, who receives it, by which transport, whether it is on, and its delivery log.
2. **Voided invoices and delete/reset.** A line on a voided invoice must not block deleting or resetting a job.
3. **INVOICED with no live invoice line.** Fix the inconsistency: one rule everywhere. A job is invoiced only while it has a line on a non-void invoice; when an invoice is voided or a credit fully reverses it, its jobs stop counting as invoiced and are billable again.
4. **Default pay rate.** Do what is right: a clean whose cleaner has no pay rate set is not costed at a silent default in the Finance overview; it is left out, counted, and flagged so the rate can be set.
5. **Insights revenue.** Use invoiced line totals as the fixed record for past periods; scheduled charge only for work not yet invoiced, labelled as such.
6. **Build:** per-client payment terms (used for due dates, overdue and the slow-payer finding) and the monthly Insights email (schedule, stored recipients, a settings entry, sent through the notification pipeline).

Build order for these: a "Finance decisions" step (2 to 6, includes a migration for per-client terms and email settings) and a "Notifications in one place" step (1), each after the step currently holding the schema.

**Status, items 2–6 (Finance decisions, 2026-11-12, uncommitted step, migration `20261112090000_finance_decisions`).** Done: one invoiced rule in `lib/invoicing/invoiced-job-rule.ts` (live = INVOICE, not VOID, not fully credited) used by the generator, Ready to bill, Jobs filter/count and Money tab; void, draft delete and full credit return INVOICED jobs to billable in the same transaction (audited); legacy INVOICED-without-live-line jobs returned to COMPLETED by the migration (count query for production in the review record). Voided lines no longer block delete/reset. Finance summary leaves out, counts and flags cleans with no pay rate (the default rate still applies to actual pay: payroll, cleaner invoices, payouts). Insights revenue = invoiced (ex GST, net of credit notes) + not yet invoiced (scheduled charge, labelled). Per-client terms with a snapshot on issued invoices; one due-date rule everywhere. Monthly Insights email (off by default). Not done: the embedded web scheduler does not run the monthly email (a dedicated worker is needed); browser checks pending. Details: `docs/SYSTEM.md`, "Finance decisions".

**Status, item 1 (Notifications in one place, 2026-11-11, uncommitted step, no schema change).** Done: manual job reminders run on the notification pipeline (assigned-cleaner scope re-checked at dispatch; inbox intent explicitly declares the phone push; email and browser push fall back to the direct path while `SNEEK_NOTIFICATION_OUTBOX_TRANSPORTS` leaves them off, with a Health banner, so nothing stopped); a catalog of all 45 notification types with a completeness test; `/v2/admin/notifications` is the one area (Types, Delivery log, Health, Preferences) with a nav entry and a settings destination; server functions and routes for staff message, laundry cleaner nudge, client delay notice (ADMIN only) and guest message (ADMIN only) ready for buttons. The owner's "switch the needed transports on" was NOT done by code: switching the outbox transports on is a production env change (see SYSTEM.md, "Notifications in one place", operator note), and turning EMAIL on also releases any old queued low-stock email intents. Still waiting for the owner: whether operations managers may send the client delay notice and guest messages; whether manual reminders should respect personal preferences (switch exists, default off); whether to set `SNEEK_NOTIFICATION_OUTBOX_TRANSPORTS=EMAIL,WEB_PUSH`; "Chase supplier" has no recipient (suppliers have no account). Other producers stay direct (listed in the catalog); moving each needs a stable event receipt and, for non-office recipients, a scope.

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
| "Invoiced this month" is shown as "Paid this month" | Define "invoiced this month" (by invoice date, sent date, or approval date) — **Resolved 2026-11-12 (Finance decisions)**: first sent in the month less credit notes sent |
| Declining a continuation from the queue sends no note to the cleaner | Require a reason? |

### More items waiting for the owner (from the Xero and cleaner invoice step)

| Item | Question |
| --- | --- |
| A payment read from Xero does not email the client a receipt; a manual "Record payment" does | Send a receipt for Xero-read payments too? — **Resolved 2026-11-12 (Finance decisions)** |
| Any difference over half a cent between Xero's total and ours goes to "needs review" | Allow a small rounding tolerance? |
| Scheduled Xero checks are recorded under the earliest active administrator, labelled "Xero sync (scheduled)" | Acceptable, or create a dedicated system account? — **Resolved 2026-11-12 (Finance decisions)**: shown as "System: Xero sync (scheduled)" everywhere (marker on the row) |
| An operations manager can confirm a payee's payment claim made before the invoice was approved | Require approval before a claim can be confirmed? |
| Rejecting a claim on an approved invoice not in Xero sends it back to Submitted | Acceptable that it needs approving again? |

To do under the standing rule (not owner decisions): the Xero connection does not request `offline_access`, so its sign-in lapses after about 30 minutes and scheduled checks will mostly report "state unknown" until it is added and Xero is reconnected once; the classic `/admin/cleaner-invoices` screen has no Approve button and should redirect to the new tab. **Fixed 2026-11-12 (Finance decisions):** `offline_access` is requested (owner: reconnect Xero once after deploy; Settings, Health and the Finance badge say so until then); the classic cleaner-invoice screen and classic invoice management redirect to Invoices and pay.

### More items waiting for the owner (from the Cases and Laundry step)

| Item | Question |
| --- | --- |
| Laundry has no "Ask cleaner", "Chase supplier" or "Request photo" buttons | Build on-demand nudges? Each needs a notification path and recipient rules (fits "Notifications in one place") |
| No "Raise QA issue for cleaner" from a case | Allow the office to raise a QA issue by hand? It changes who can create QA issues |
| The "Resolved" queue also includes closed cases | Keep, or split? |

For the parity audit: the Cases "Refresh" button was replaced by automatic refresh; restore a manual Refresh.

## Owner decisions, third set (2026-11-11): Command, Live ops, Xero

1. Operations managers without finance or payroll access do not see money figures on Command. Confirmed; keep as built.
2. Add a one-click "notify client of delay" on a late job in Live ops (uses the client delay notice path from the notifications step; explicit confirm, truthful state).
3. Add an administrator clock pause in Live ops for a cleaner who is off site with the clock running (audited; pauses the open time log, never deletes or rewrites recorded time).
4. "Invoiced this month": the lead's definition. The total of invoices first sent to the client in the month (organisation timezone), less credit notes sent in the month, void invoices excluded. An approved invoice that has not been sent is not yet invoiced. Shown beside "Paid this month" and "Outstanding".
5. Declining a continuation request requires a reason, which the cleaner sees.
6. A payment read from Xero emails the client a receipt, the same as a manually recorded payment.
7. Xero totals must match exactly: no rounding tolerance. Any difference goes to "needs review" (as built).
8. Scheduled Xero checks are shown clearly as the system, not as a person: recorded and displayed as "System: Xero sync (scheduled)" wherever they appear.

Where these go: 2, 3 and 5 in a "Live ops follow-up" step after the notifications step; 4, 6 and 8 in the "Finance decisions" step. 1 and 7 need no change.

**Status, items 4, 6, 8 (Finance decisions, 2026-11-12).** 4: "Invoiced this month" built (first sent in the month, organisation timezone, less credit notes sent, void excluded) on Command beside Paid this month and Outstanding and in the Finance stats strip; `sentAt` now keeps the first send (re-sends recorded separately; past restamped rows cannot be repaired). 6: Xero-read payments send the manual path's receipt once per Xero payment id, never while the invoice needs review, failures recorded. 8: scheduled Xero rows carry a system marker and show as "System: Xero sync (scheduled)" in History, the Activity pages and the payment ledger; a person's activity list omits them. Mocked Xero only.

**Status, items 2, 3 and 5 (Live ops follow-up, 2026-11-11, uncommitted step, no schema change; build, full suite and browser pass pending).** 2: "Notify client" on a late exception for administrators (others keep the Messages link): confirm from a server preview (client logins, exact wording with the ETA in minutes, switched-off transports, the send's refusal such as "client switched notifications off"), explicit transports, truthful states, idempotent per job and day; a notice already requested today shows on the row and needs "Send another". 3: "Pause clock" (ADMIN only; operations managers refused) through `POST /api/admin/jobs/[id]/pause-clock`, which uses the cleaner's own `clockOutCleaner` (same lock, duration and IN_PROGRESS → PAUSED rule), marks the log "Paused by the office: <reason>", audits it and notifies the cleaner, who resumes with the existing Resume clock; "Review clock" kept. 5: decline needs a reason (server 400 without one; Live ops and Command share one dialog; both job pages require it); the cleaner sees it in the decline notification. Also in this step: Laundry "Ask cleaner" / "Request photo" (where the exception applies, 30-minute cool-down; "Chase supplier" still blocked), Accounts bulk "Message", Cases manual Refresh restored. Waiting for the owner: may operations managers pause a clock or send the delay notice; should "Request photo" for a missing drop-off photo reach the driver instead of the job's cleaners. Details: `docs/SYSTEM.md`, "Live ops follow-up".

## Owner decisions, fourth set (2026-11-11): Cases

1. The office can raise a QA issue against a cleaner by hand from a case ("Raise QA issue for cleaner" in the case's Next steps). It creates a normal QA issue linked to the case's job and cleaner, attributed to the person who raised it and marked as raised from a case; any deduction still goes through the existing proposal and approval. Built in the follow-up step with the Live ops additions.
2. The "Resolved" queue includes closed cases. As built; no change.

**Status, item 1 (2026-11-11, Live ops follow-up step, no schema change).** Built: "Raise QA issue for cleaner" in the case's Next steps when the linked job has an assigned cleaner; `POST /api/admin/quality/issues` (ADMIN, OPS_MANAGER with quality at manage; not QA inspectors) creates a normal QA issue for the job and cleaner, `raisedById` the actor, marked `case:<caseId>` in the existing `itemKey`, with an internal case note linking to it and an audit row; no deduction (propose deduction stays the existing approval path), no review or score change; the dialog says it counts in the cleaner's quality figures; idempotent (client key, plus same case/cleaner/category within 2 minutes under a lock). Quality shows "Raised from case" with a link back. Details: `docs/SYSTEM.md`, "Live ops follow-up".

### More items waiting for the owner (from the notifications step)

| Item | Question |
| --- | --- |
| Reminder email and browser push still use the direct path in production | Moving them fully onto the pipeline means setting `SNEEK_NOTIFICATION_OUTBOX_TRANSPORTS=EMAIL,WEB_PUSH` on the server. That would also send any old low-stock email intents already waiting in the queue. An environment decision for the owner |
| Client delay notice and guest messages are administrator only | Should operations managers send them too? (They can already message clients from Messages) — **Resolved 2026-11-12 (ninth set)**: yes, with the Jobs / Lost & found pack at manage |
| Manual reminders ignore the cleaner's personal notification preferences | A switch now exists in Notifications, default off |
| "Chase supplier" for laundry | Blocked: suppliers have no contact to send to. Add a contact email or phone to suppliers? |

### More items waiting for the owner (from the Lost and found and Urgent stock step)

| Item | Question |
| --- | --- |
| Urgent needs tab and badge are administrator only (the service refuses operations managers today) | Let operations managers see and act on urgent stock? |
| "Add to shopping run" and "Ask cleaner to buy" on an urgent need | Not built: no service adds a line to a shopping run or asks a cleaner to buy. Build them? |
| "Tell client" about a lost item is copy / email link, then recorded by hand | Give it a real send path? |
| Items still at "New" are not flagged by the 14-day holding period (only in storage or awaiting the guest) | Confirm, or flag New items too? |
| Administrators can send the guest message by email or SMS from the app; it moves the item to "Guest contacted" only when the provider accepts it | Confirm, or switch to copy-and-record only? — **Resolved 2026-11-12 (ninth set)**: send kept; operations managers with the Lost & found pack send too |

### More items waiting for the owner (from the template builder step)

| Item | Question |
| --- | --- |
| The new server checks on what cleaners submit (ranges, email, phone, dates, option membership, details-when-no, maximum files) are recorded as warnings and do not reject | When to switch enforcement on (`ENFORCE_EXTENDED_FORM_VALIDATION`) |
| Saving a QA template records a revision but does not raise its version number | Raising it would change which template wins when two overlap. Leave as is? |
| QA inspections do not keep a copy of the template they were filled in on, so editing a template changes how past inspections display | Snapshot the template on each inspection? Needs a database change |
| The classic `/admin/forms` page is kept for its Submissions tab (edit a submission, add or remove media) and Checklists tab | Port those two to the new Forms page so the classic page can be retired? |
| "Table" and "Stock count" question types, and "raises urgent stock" / "opens a damage report" effects on a question | Drawn on the canvas but do not exist. Build them? |

## Owner decision, fifth set (2026-11-11): make the Urgent stock design real

The owner wants the three places where Urgent stock differs from the rendered design built into the system:

1. **"Add to shopping run"** on an urgent need (row, bulk bar "Add to one shopping run", side panel): a real service that adds the needed item and quantity as a line on an existing open shopping run for that property, or starts a new run, and links the need to that run. The need moves to Ordered only when the office says it has been ordered; adding to a run does not place a purchase or prove delivery. When the run records the item as bought, the need shows it.
2. **"Ask cleaner to buy"**: asks the cleaner on the next clean at that property to buy the item, through the notification pipeline with an explicit transport, creating or adding to that cleaner's shopping run so the purchase follows the existing reimbursement approval. The need shows who was asked and when, truthfully ("asked", not "bought").
3. **"Reported by … during job J-1038"**: a need records the job it was reported from. New needs reported from a job store the job; existing needs are backfilled only where the job can be determined with certainty, otherwise left without one.
4. **Tab names as drawn**: Urgent needs, Levels by property, Shopping runs, Stock counts, Catalogue. Every existing tab keeps working under the nearest drawn name or stays as an extra tab, and every old `?tab=` link still opens the same content.

Needs a database change (job on a need; link from a need to a shopping run), so it starts when the Finance decisions step, which holds the database now, has finished.

## Owner decision, sixth set (2026-11-11): close every difference from the designs

The owner wants every place where a built page differs from its rendered design to be made real, building the missing feature from scratch where needed. This is the "design completion" backlog. Honesty rules still apply to how each is built: a number shown must be a real aggregate, a state shown must be a real state, and nothing is reported as done that was only requested.

Waves (one wave holds the database at a time):

### Wave A: Jobs and Calendar (no database change)
- Jobs: sortable Cleaner, Guest in and Charge columns (server-side, by a stored or computed sort key that is honest); live counts on the owner's saved-view tabs; suggested cleaners gain travel distance (from stored property and cleaner locations with an existing or new distance function, shown only when both locations are known) and recent QA score; bulk Reschedule with a server check per job; "Import or bulk create" as its own entry; day group rows as "Thursday 12 November"; Unassigned shown in the danger colour as drawn.
- Calendar: drag on touch devices (press-and-hold so scrolling still works); a drop in Day view can change the time as well as the cleaner; view and date survive a page refresh on the Calendar.

> **Wave A built 2026-11-11, awaiting the final build and browser pass.** Done:
> - [x] Cleaner, Guest in and Charge sort on the server over the whole filtered set (Cleaner in SQL, unassigned first; Guest in and Charge in one bounded pass, refused above 5,000 jobs with a "narrow the filters" message; nulls / no rate last).
> - [x] Live counts on saved-view tabs: one request, the list's own where-builder.
> - [x] Suggested cleaners: straight-line distance with its basis (previous job that day, else home; nothing without both coordinates; no drive time) and the Quality hub's 30-day QA score ("–" below 3 reviewed).
> - [x] Bulk Reschedule: preview through the Calendar move check, apply through the reschedule service, per-row results, unmoved jobs stay selected.
> - [x] "Import or bulk create" dialog: deep link to the existing bulk create and a CSV import (template, server validation preview, idempotent apply through the extracted job-create service, cleaner assigned through the assign route).
> - [x] Day rows "Thursday 12 November"; Unassigned in danger on Jobs only.
> - [x] Calendar touch drag (press-and-hold 450 ms), Day-view drops change the time (15-minute step, length kept), view and date survive a refresh (documented exception).
> Deviations: distance is straight-line, not a drive time (no ETA call per candidate); a time move of a job with a separate end time is refused (the reschedule service writes only start and due); Calendar "manage" is also required for bulk Reschedule. Details: `docs/SYSTEM.md`, "Jobs and Calendar: design completion, Wave A (2026-11)".

### Wave B: Forms library and builder (no database change)
- [x] Library: Compare view (two or more forms side by side, differences highlighted); Import (a form from an exported file, as a draft, validated) and Export; sortable Avg time and Completion (computed for the whole filtered set); the "never answered" warning inside Checks.
- [x] Builder: "Table" question type and "Stock count" question type, each end to end (builder, phone, server, tests); question effects "raises an urgent stock need below N" (Stock count) and "Yes opens a damage report" (Yes/No), running through the existing urgent stock and damage services when the form is submitted; a "Monthly" option under How often; rename the form inline in the header.
- [x] Owner addition: extended submit validation switchable in the app (default off, in-flight jobs protected, real warning counts).

> **Wave B built 2026-11-12, awaiting the final build and browser pass.** Details and limits: `docs/SYSTEM.md`, "Forms design completion … (Wave B, 2026-11-12)". A Stock count records the count on the submission; on-hand changes only through the urgent stock observation when a need is raised. Urgent needs do not yet store the job (Wave F column). The classic cleaner page does not render the two new types.

### Wave C: Quality and Insights (no database change)
- Quality: "Propose bonus" by hand from a cleaner's row (a pending bonus adjustment needing the existing approval), alongside the automatic nightly proposals; severity shown as Low / Medium / High; a row may show both the coaching and the bonus action.
  - [x] Propose bonus by hand (2026-11-11): `POST /api/admin/quality/bonus-proposals`, a PENDING pay adjustment written as the admin create route writes one ($5–$200, reason required, idempotent, warning and 409 when a bonus is already pending; ADMIN, or OPS_MANAGER with payroll and quality at manage). Lands in Approvals "Pay requests"; paid only after approval.
  - [x] Severity Low / Medium / High (2026-11-11): one mapping, `lib/quality/severity.ts`; stored, API and query values unchanged; CSV adds "Severity label".
  - [x] Both actions on a row (2026-11-11): one button (Start coaching, else Review bonus, else Propose bonus) and the rest in the row's "more" menu.
  - [x] Remaining design differences checked element by element; deliberate ones listed in `docs/SYSTEM.md`, "Quality design completion … (Wave C, 2026-11-11)". Awaiting the final build and browser pass.
- Insights: the overrun finding states the money effect per clean; sorting the five-row preview in place.
  - [x] Money per clean on the overrun finding (2026-11-12): "At the current rate this property makes $N per clean", (revenue − cleaner cost) ÷ cleans over the margin's basis, count in the basis line, not-enough-data rule, finance access only (omitted server-side).
  - [x] Preview sorted in place (2026-11-12): top five of the whole set for the chosen order from the server; "All N properties" keeps the order (new `ratio` order without finance).
  - [x] Client filter as the drawn chip (2026-11-12): shared `EFilterPopover`, searchable and keyboard-operable.
  - [x] Margin badge bands from named thresholds, number always shown (2026-11-12).
  - [x] Element-by-element pass (2026-11-12): header order and Email monthly state button, subtitle, findings row, cards, chart legend, actual-hours threshold; header controls kept hidden on the PDFs tab (they do not apply there). Deliberate differences listed in `docs/SYSTEM.md`, "Insights design completion … (Wave C, 2026-11-12)". Awaiting the final build and browser pass.

### Wave D: Money (holds the database)
- List: "Ready to bill" with a dollar total and "Create N drafts" for every client with unbilled work in one action; "N missing rates" on the Drafts card; Xero column distinguishes Synced, Push pending and Push failed (failure recorded when a push fails); "On send" in the Due column for unsent invoices; bulk "Download PDFs" (one archive); Owing sortable.
- Editor: editable Bill to, Period and Due on a draft; "Add finished jobs" to an existing draft; send options "Include payment link" and "Push to Xero when sent"; autosave with a stale-write guard and a "saved N seconds ago" indicator; the add-line box offers unbilled jobs and saved items; Xero card shows the account name; all four "Before you approve" checks enforced on the server (rates present, not on another invoice, totals match, started work reviewed), each shown as OK or blocking.

> **Wave D built 2026-11-12, awaiting the final build and browser pass. No schema change (the database is released for Wave E).** Done:
> - [x] Ready to bill in dollars (computeClientCharge per client, unrated jobs excluded and counted) and "Create N drafts" (existing generator per client, sequential, idempotent per request key, per-client outcomes; nothing approved or sent).
> - [x] "N missing rates" on Drafts: job lines whose job has no client rate now (the generator never creates one, so this is rates removed afterwards); approval refuses them; draft rows say "N jobs without a rate" / "Fix and review".
> - [x] Xero column: Synced / Push pending / Push failed / In Xero · not yet checked (failed push stored as FAILED with sanitised reason and time, reservation and idempotency key kept); same states in the filter, editor card and stage bar.
> - [x] "On send · N-day terms" in Due for unsent invoices; the admin PDF preview labels the due day provisional.
> - [x] Bulk "Download PDFs": one streamed ZIP (store-only writer, no new dependency), `_errors.txt` and response summary for rows that could not render; 50 invoices / 60 MB caps.
> - [x] Owing sortable over the whole filtered set: SQL expression mirroring `invoiceAmountOwing`, parity-tested on PostgreSQL (no stored column).
> - [x] Editor: Bill to / Period / Due editable on a draft (server rules), Add finished jobs (N not billed) with the generator's line builder, send options (payment link only when a gateway is configured; push to Xero after a successful send, failure never undoes the send), autosave with `expectedUpdatedAt` and a conflict banner, add-line box with unbilled jobs and saved invoice items (new small list in settings JSON under Billing schedule), Xero card account name from Xero (cached; needs `accounting.settings.read` and the existing reconnect), all four checks enforced on drafts.
> Rules added (for the final summary): approval, sending a draft and marking a draft paid are refused while a job has no rate, a job is on another live invoice or twice, totals do not match, or a check cannot be read; a draft's Bill to may change only when every job belongs to the new client; an invoice-specific payment-terms override on a draft is kept at first send; a requested payment link that cannot work refuses the send. Details: `docs/SYSTEM.md`, "Money design completion … (Wave D, 2026-11-12)".

### Wave E: People, cases, laundry, command (holds the database after Wave D)
- Accounts: pay rate with an "Applies from" date (effective-dated rates; amounts already paid never change); a required-documents list per role so Documents can honestly say "Complete"; "Last seen" recorded for every signed-in person, not only the field apps; one Pay editor.
- Jobs: a real "Cancel job" with a Cancelled status, its rules (who, when, what happens to the assignment, laundry run, invoice line and client notice) and history.
- Calendar: leave and days off as real records ("Day off", "Leave"), respected by suggestions and move checks.
- Cases: "Create repair quote" pre-filled from the case; "Add charge to invoice" creating a real pending client charge linked to the case, on the client's draft invoice after approval.
- Laundry: pickup and drop times recorded and shown on cards; "Chase supplier" using the supplier's stored contact.
- Command: inline "Send reminder" for an expiring document.
- Lost and found: Property column sortable; "Tell client" with a real send path.

> **Wave E, no-database part, built 2026-11-12 (uncommitted step; build, full suite and browser pass pending).** Details: `docs/SYSTEM.md`, "Wave E without a database change".
> - [x] Cases: "Create repair quote" pre-filled from the case (server-read `?fromCase=`, FROM_CASE quote event + internal case note, "Quote Q-… created" on the case, "From case …" on the quote; nothing sent).
> - [x] Laundry: "Chase supplier" to the supplier's stored email / SMS (ADMIN sends, everyone who can open the run copies; 30-minute cool-down; shared external-recipient path; catalog `laundry.supplier_chase`). Ninth set: operations managers with the Laundry pack send too.
> - [x] Command: inline "Send reminder" for an expiring document through REQUEST_DOCUMENT (confirm, explicit transports, one per document per day; REQUEST_DOCUMENT now records real states).
> - [x] Lost and found: Property column sortable (raw ordered ids merged with paging, PostgreSQL parity test); "Tell client" sent from the app (scope LOST_ITEM_PROPERTY_CLIENT, ADMIN; operations managers copy and record). Ninth set: operations managers with the Lost & found pack send too.
> - [x] Remaining visual differences on Cases, Laundry, Command, Live ops, Lost and found closed or listed (SYSTEM.md section).
> - [x] Schema step: Accounts (effective-dated pay rate, required documents, Last seen for everyone, one Pay editor), Cancel job, leave and days off, "Add charge to invoice" from a case, laundry pickup/drop clock times, QA inspection template snapshot. (Accounts, Cancel job, leave, QA copies in the Wave E database step; "Add charge to invoice" and laundry clock times in Wave F, 2026-11-12.)

> **Wave E, database part for People, Jobs, Calendar and Quality, built 2026-11-12 (uncommitted step; build, full suite and browser pass pending).** Migration `20261112120000_wave_e_people_jobs`. Details: `docs/SYSTEM.md`, "Wave E with the database"; verification and the job-status audit: review record.
> - [x] Accounts: pay rate with "Applies from" (`UserPayRate`, one resolver on the job's day for every pay path, never backdated, scheduled rate removable before it starts, snapshots and paid amounts untouched); rate history in the Pay tab.
> - [x] Accounts: one Pay editor (Profile section; the Pay tab shows history; classic page links to it; job-type rates linked to Settings → Rates).
> - [x] Accounts: required documents per role (Settings → Access → Required documents, empty by default; Documents states; "N missing" and "Complete" in the list).
> - [x] Accounts: "Last seen" for every signed-in person (live session guard, actual actor only, at most once per 5 minutes; "Never signed in" / "Not recorded yet").
> - [x] Calendar / Jobs: leave and days off (`StaffLeave`) managed in the person panel; calendar lane "Leave" / "Day off", suggestions, move checks, restore and assign routes treat it as unavailable with the reason; assigning anyway needs `confirmLeaveConflict`.
> - [x] Jobs: a real Cancel job (`CANCELLED`, reason, who/when, rules, refusals, released assignments, inbox notice, Restore, history) in the row menu, peek panel, bulk bar and job page; exclusions audited.
> - [x] Calendar: a day-view drop keeps the duration of a job with a separate end time (start, due and end move together through the move check and `applyReschedule`).
> - [x] Quality (eighth set, item 2): QA inspections keep a copy of their template (exact for new ones; backfilled ones marked "Template copy reconstructed").
> - [x] Remaining differences on People, Jobs, Calendar and Quality closed or listed (SYSTEM.md section; Calendar hint now names leave; peek "Cancel job" drawn as a danger outline).
>
> Waiting for the owner (from this step):
>
> | Item | Question |
> | --- | --- |
> | A rate cannot be backdated | Allow a backdated rate for unpaid jobs (e.g. a cleaner whose rate was never set)? Today it applies from today or later only. |
> | Cancelling a started job pays nothing for the time already worked | Pay part of a cancelled started job automatically, or keep it to a manual pay adjustment? |
> | No client notice on cancel | Send the client a cancellation notice (needs a client scope and wording)? |
> | Laundry task on a cancelled job is left as it is (reported) | Cancel the laundry run automatically? |
> | Operations managers can cancel unstarted jobs and restore with their Jobs pack | Keep, or ADMIN only? |
> | Workforce performance pages still print the stored rate | Switch them to the rate in force today too? |

### Wave F: Urgent stock (holds the database after Wave E)
- The fifth-set items: "Add to shopping run", "Ask cleaner to buy", the job on a need, and the drawn tab names.

> **Wave F built 2026-11-12 (uncommitted step; build, full suite and browser pass pending).** Migration `20261112180000_wave_f_stock_cases_laundry`. Details: `docs/SYSTEM.md`, "Wave F: urgent stock shopping runs and buy asks …"; verification: review record.
> - [x] Stock tabs as drawn (Urgent needs, Levels by property, Shopping runs, Stock counts, Catalogue; On-hand, Scan tasks, Suppliers after them); every old `?tab=` id kept, drawn names mapped.
> - [x] "Add to shopping run" (row, panel, bulk "Add to one shopping run") on the existing shopping-run tables; the need shows its run; stage unchanged; idempotent; closed runs refused with the reason.
> - [x] "Ask cleaner to buy": next clean's cleaner or a chosen one, pipeline type `urgent_stock.purchase_ask` (inbox by default, explicit transports), Asked / Accepted / Declined / Withdrawn, Bought only via the cleaner's shopping run and the office's reimbursement approval; cleaner answers on the v2 job screen and Supplies → Shopping.
> - [x] Job on a need: stored for job-screen and form reports; certain backfill only; "Reported by … during job …" with a link.
> - [x] Operations managers see and act on urgent stock with the inventory pack (read / manage), server-checked; ~~Resolve, bulk Close and reminder settings stay ADMIN-only~~ — changed by the owner's tenth set (2026-11-12): they need the pack at manage.
> - [x] Lost and found: items still New after 14 days flagged (named threshold; badge, chip with count, summary, panel note, Command row).
> - [x] Cases: "Add charge to invoice" onto a DRAFT of the case's client or a new draft, through the invoice PATCH; "Charge on INV-… (draft)" on the case, "From case …" on the line.
> - [x] Laundry: planned pickup / drop clock times (nullable, set in the run panel), shown on cards and the panel only when planned.
> - [x] Stock count answers set on-hand through count observations on approval (carried from Wave B).
> - [x] Urgent stock and Lost and found compared with the designs; remaining differences listed in the SYSTEM.md section and the review record.

Items in these waves that change a business rule, money, or who can do what are built because the owner asked for the design to be made real; each is listed in the final summary with exactly what rule was added.

## Owner decisions, seventh set (2026-11-11): Lost and found and Urgent stock

1. Operations managers can see and act on Urgent stock (tab, badge, and the service that refused them). Built in Wave F, gated by their inventory permission pack like the rest of Stock.
2. Build "Add to shopping run" and "Ask cleaner to buy" (already Wave F).
3. Holding period: the lead's choice. Items still at "New" are flagged after 14 days too, counted from the found date; an unprocessed item is the case most worth flagging.
4. Guest messages are sent from the app, and the drafted message always has a copy option beside Send, for every role that can open the item.

### More items waiting for the owner (from the follow-up actions step)

| Item | Question |
| --- | --- |
| Clock pause is administrator only | Let operations managers pause a clock too? — **Resolved 2026-11-12 (ninth set)**: yes, with the Jobs pack at manage |
| Client delay notice is administrator only | Let operations managers send it too? — **Resolved 2026-11-12 (ninth set)**: yes, with the Jobs pack at manage |
| "Request photo" for a missing drop-off photo goes to the job's cleaners | Should it go to the laundry driver instead? |
| The cleaner sees the reason for an office clock pause only in the notification, not on their job screen | Show it on the job screen too? |

## Owner decisions, eighth set (2026-11-11): forms and QA templates

1. When the new server checks on submissions start rejecting: the lead's choice. They stay warnings at launch. The switch becomes an administrator setting on the Forms page with counts of recent warnings beside it, so it can be turned on once the counts are low; a submission started before the switch is still accepted with warnings. (Added to Wave B.)
2. QA inspections keep a copy of the template they were filled in on, so editing a template never changes how a past inspection displays. Needs a database change: Wave E.
3. Port the classic Forms page's Submissions tab (edit a submission, add or remove media) and Checklists tab to the new Forms page, then redirect the classic page. Wave E.
   - [x] Built 2026-11-12: Results and stats → Submissions (every classic function; edits keep history, removed media kept and restorable); per-service checklists already covered the classic Checklists tab; `/admin/forms` redirects with tabs mapped.
4. Build the "Table" and "Stock count" question types and the stock and damage effects. Already in Wave B.

### Rule added in Wave C (Quality), for the final summary

A bonus proposed by hand is limited to $5 to $200 and needs a reason. It is a pending pay adjustment that is paid only after the existing approval. The owner can change the limits.

### Carried into Wave E from Wave B

- [x] The office's submission review shows a Table answer as plain text, one line per row; give it a real table. (2026-11-12: real table; Stock count as "item · counted N unit".)
- [x] A Stock count answer is recorded on the submission and raises an urgent need when below its limit, but does not set the property's on-hand figure, because no existing path turns a counted number into stock on hand. Build that path (a count observation that sets on-hand, audited, never double-counting the same item in one submission). (Not in the no-database step's list; with Wave F / the stock work.) (2026-11-12, Wave F: `StockCountObservation`, applied on approval only, never over a newer stock movement, unmatched items to review.)
- [x] The classic cleaner job page does not show Table or Stock count questions; only the current cleaner app does. Redirect the classic page or add them. (2026-11-12: added with the shared controls; not redirected, the classic look stays routable.)
- [x] Two cleans in the same month before the first is approved can both show a monthly question. (2026-11-12: a submitted-not-approved clean that showed it counts; due again after a reset or rejection.)

### More items waiting for the owner (from the Finance decisions step)

| Item | Question |
| --- | --- |
| A job can still be set to INVOICED by hand with no invoice line; under the one rule it simply is not invoiced | Refuse that manual status change? |
| The "No pay rate" filter in Accounts looks at the person's hourly rate only | Also treat a per-job-type rate as "has a rate"? |
| An invoice-level discount is not spread over that invoice's cleans in Insights revenue | Spread it? |
| Operations managers with reports access but no finance access can be chosen for the monthly Insights email (they get it without money figures) | Keep, or limit to those with finance access? |

Rule added in the Finance decisions step, for the final summary: voiding a credit note is refused when the work it credited has since been billed on another live invoice, because voiding it would bill that work twice.

## Owner decisions, ninth set (2026-11-12): office sends and document request transports

A. Operations managers can send the office messages that were administrator only ("Yes office should be able to"): Chase supplier, Tell client (lost item), guest messages, the client delay notice and the clock pause. Rule: an operations manager may send only while holding, at "Manage available actions", the ops pack of the page the action lives on (Laundry; Lost & found; Jobs & assignments), checked on the server on every send with the live session guards; never while impersonating; rate limits, cool-downs, idempotency and masked audit rows unchanged, the audit rows now also record the actor's role. Administrators unchanged. Copy stays for everyone.

B. "Request document" on Accounts asks which transport to use: Inbox, Email, SMS as explicit choices (several at once), each disabled with the reason; "Don't ask again" remembers the choice for that office user and is used next time with a visible "Sending by: … · Change" line; reset in Notifications → Preferences. The Command "Send reminder" uses the same choice and preference. A request that names no transports and has no saved choice goes to the inbox only.

**Status (2026-11-12, uncommitted step, no schema change; build, full suite and browser pass pending).**
- [x] A: one rule (`lib/notifications/office-send-rules.ts`) on every send route and preview; the three notifications-area send routes belong to the page's pack; Live ops, Laundry and Lost and found show Send by the same rule; `actorRole` on the audit rows.
- [x] B: shared choice component for Accounts "Request document" (Compliance board and a person's Documents section) and Command "Send reminder"; per-office-user preference in AppSetting `office_send_transports_v1:<userId>`; "Your sending choices" in Notifications → Preferences.
- Reported, not changed: the classic `/admin/workforce` request form names no transports, so it now sends by the inbox only (or the sender's saved choice); a plain document request has no idempotency key (a retry after "no answer" can create a second request); Live ops actions still also need the page not to be read-only for the viewer. Details: `docs/SYSTEM.md`, "Office sends for operations managers and the document request transport choice".

## Parity audit fixes (2026-11-12)

Owner rule: no function that existed before the redesign may be lost (baseline `1fb4077`). Restored in the new design's idiom, no schema change; details in `docs/SYSTEM.md`, "Parity audit fixes".
- [x] Finance: "Mark as sent (not emailed)" on draft and approved invoices (list row menu, editor menu, confirm dialog), through the existing PATCH and every status rule; audited "marked sent without email".
- [x] Finance: "Group by property" saves the grouped line order on an editable invoice (existing reorder save); read-only invoices only change the view.
- [x] Quality: rating mix per cleaner in the expanded row; "Mgmt review queue" stat card linked to the Approvals queue (`?queue=managementReviews`); Awaiting QA / In progress / Completed today on the Review queue (organisation timezone).
- [x] Laundry team metrics for an operations manager with the quality pack but not laundry: quality-pack read route and a lazy "Laundry team and suppliers" section on the Quality hub.
- [x] Accounts: Total staff, Active cleaners, Total clients strip (receivables stay removed by owner decision; an unreadable count shows "–").
- [x] `/urgent-stock` for an operations manager with the inventory pack: already done in Wave F (verified, no change).
- [x] Accountability notification links point at the Quality hub; `/admin/accountability` and `/admin/accountability/coaching/[id]` redirect there.
- Reported, not changed: the "Mgmt review queue" count is the period's flagged reviewed cleans (the hub's basis), while the Approvals queue it links to lists every flagged review not yet resolved, whatever its date; the laundry team section duplicates the rendering of the Laundry statistics panel because that file belongs to the laundry work stream (a follow-up can give `LaundryTeamMetricsPanel` an endpoint prop and reuse it).

## Owner decisions, tenth set (2026-11-12): urgent stock rights, need-opened notice, applied counts on reset, lost items

The three questions left open by Wave F, answered by the owner, plus one confirmation:

1. **Resolved.** May operations managers Resolve an urgent need, use bulk Close and change the reminder settings? — Yes, with the inventory pack at manage (server-checked; never beyond their own rights while impersonated; audit records actor and role). ADMIN unchanged.
2. **Resolved.** Should the "urgent need opened" inbox notice also reach operations managers? — Yes, those holding the inventory pack (at least read), through the notification pipeline (pack re-checked at queue and at dispatch, preferences respected, inbox only, one notice per person).
3. **Resolved.** When a job is reset after a stock count from it was applied to on-hand, what happens to the count? — The office is asked: "Reverse these counts" or "Keep them", no default, and the server refuses a reset without the choice. Reversal restores the replaced value only when no newer stock record exists for that item (else reported "not reversed — newer record"); nothing is deleted. Paths nobody decides keep the counts and record that.
4. Lost items still at New stay a separate count (the "New over 14 days" chip and summary). No code change.

**Status (2026-11-12, uncommitted step, no schema change; build, full suite and browser pass pending).**
- [x] 1: `actOnUrgentStock` (Resolve and bulk Close), `setUrgentStockSettings` and the settings read use the inventory pack at manage; Urgent needs shows Resolve, Close and Reminder settings by the same server rule.
- [x] 2: recipient scope `URGENT_STOCK_OFFICE`; catalog entry `stock.urgent_need` audience updated. Reminders for unresolved needs still go to administrators only (not part of the decision).
- [x] 3: `lib/inventory/stock-count-reset.ts`; Reset job dialog and QA reset dialog ask; Reset job, QA reset and the job status edit answer 409 without a choice; bulk status blocks those jobs; QA verdicts keep and record no choice.
- Reported, not changed: the job edit form has no choice control (its 409 names the counts and points to Reset job); with "Clear form data" the observation rows still go with the deleted submission (their final state is in the audit rows; the ledger rows are kept); a REVERSED count is not re-applied if the same submission is approved again. Details: `docs/SYSTEM.md`, "Owner decisions: urgent stock rights, need-opened notice, applied stock counts on reset".

## Properties list and property page (2026-11-12)

> **Status (2026-11-12, uncommitted step, no schema change; build, full suite and browser pass pending).** Built from the approved boards "Properties" and "Property full page".
> - [x] List: stat cards with real counts, server paging / sort / filters (`shape=list`, unknown sort or chip → 400), columns as drawn with honest unknowns, flags from existing data, chips incl. "Show one-off sites", List / Cards / Map, bulk Set laundry partner / Assign checklist / Sync calendars / Export through one endpoint with per-property outcomes, preview panel on `?open=` with Open property.
> - [x] Property page: header (New job here pre-fills the New job form; More: Copy, Edit form fields, Deactivate with PIN), key facts, seven tabs with old `?tab=` ids mapped, Coming up read model, Overview cards with their own Edit, rail (Client, Access, Calendar sync with Sync now / runs / Undo, Laundry, Stock, Billing rates), Documents and additional details when data exists.
> - Deviations: Map stays a count with the ops map link; Documents card hidden without captured files (so no first upload from it); Laundry card gains an Edit (partners and bag had no other home); Client card shows terms and owing only with finance access. Details: `docs/SYSTEM.md`, "Properties list and property page redesign (2026-11-12)".

## Cleaner portal redesign (2026-11-12)

Owner: "build all designs as drawn" for `CleanerPortal.dc.html` and `CleanerJobFlow.dc.html`. Presentation and composition only; no schema, no API change. Details: `docs/SYSTEM.md`, "Cleaner portal redesign: five tabs, Today, Supplies, Pay, More and the job screen (2026-11-12)".

**Status (uncommitted; TypeScript clean in these paths, focused and existing cleaner tests passing; build and browser pass pending).**
- [x] Five tabs and the role-filtered More menu; old URLs kept or redirected (`/more` is the menu again; `/invoices`, `/pay-requests` → Pay tabs; `/restock`, `/stock-runs`, `/shopping`, `?tab=quick-scan` → Supplies Counts).
- [x] Today, Supplies (To do, Shopping, Counts, Urgent, My stock), Pay (This period, Invoices, Requests), Jobs List / Month.
- [x] Job screen: header, five-stage rail, sticky bottom action, Before you submit jump links, after-submit summary, + sheet with urgent stock.
- Reported, not built (needs a new rule or data): QA correction unlocking one item as revision 2; submission receipt number and counts; rate snapshot breakdown on the job; sent/answer sync counts; invoice opening date; early-start block while guests are inside.

## Access and permissions redesign (2026-11-12)

> **Status (2026-11-12, uncommitted step, no schema change; build, full suite and browser pass pending).** Built from the approved board "Access and permissions" plus the owner's decisions of the same day (client assistants on this screen through the existing VA team routes; PIN still asked at Full; password/two-step reset, Test as and editing access grantable per person with server guardrails). Details in `docs/SYSTEM.md` A3b and the review record.

- [x] Screen at `/v2/admin/settings/access` (old Roles tab URL redirects); people groups, matrix over all 34 areas with Off folded per group, capabilities per area, Start from, custom presets, Copy access from, plain-language summary, sensitive marks, unsaved bar, PIN review, conflict view, history, Test as, By person / By area / Presets / Client assistants / History.
- [x] One capability catalog and one `can()` evaluator, enforced at the existing server points; parity test over every capability.
- [x] Administrator capabilities with guardrails (a) to (e); "Only administrators" box lists what remains.
- Waiting for the owner: see the review record ("Owner questions").

## People directory (boards People, Client, Cleaner, Client assistants, Account emails), 2026-11-12

Owner: "build all designs as drawn"; answers: nav label "People"; suppliers edited only in Inventory › Suppliers; client assistants keep their own People tab; "Paid this month" accepted; Copy invite link wherever a valid link exists. Status (uncommitted step, no schema change; build, full suite and browser pass pending). Details: `docs/SYSTEM.md`, "People: clients and cleaners in one directory".
- [x] People on `/v2/admin/accounts`: Clients, Cleaners, Office and other staff, Laundry partners and suppliers, Assistants, Invitations; Everyone / Needs attention chips; per-tab columns, figures, Columns, Export, bulk bars, side panels.
- [x] Client page and person page redrawn from existing components (status-dependent primary action, More, key facts, tabs, rail).
- [x] Client assistants grouped by team with the team panel; account emails list with recorded delivery, Resend and Copy link.
- [x] `/clients`, `/cleaners`, `/workforce`, `/users` redirect into People keeping query strings (viewers who may open People; others keep the old page).
- Lead to do: nav label "Accounts" → "People" in `app/v2/admin/layout.tsx` (People and quality group, href `/v2/admin/accounts`); remove the separate Clients / Cleaners / Workforce nav items if present (they redirect).
- Needs the Permissions engineer: admit `/v2/admin/accounts?tab=clients` for the clients pack and `?tab=cleaners` for the workforce pack in the middleware, so the old pages can redirect for everyone.
- Not built (needs a rule, data or path that does not exist): Revoke invitation, Send by SMS instead, stored copy of the sent email, Move assistant to another team, bulk Add payment, invitation Export, partner on-time pickups / properties served, device tracking.

## Status: Notifications types and wording (2026-11-12)

Built as drawn (`NotificationTemplates.dc.html`): "Types and wording" tab with the grouped list, details, wording editor per transport, versions, Regenerate (proposal only), preview and Send test to me; Delivery log, Health and Preferences kept (timezone and stale-read fixes). Wording layer with one render function; 14 of 55 types fully editable, 16 with editable parts (shared email templates), 6 written by the sender, 2 edited elsewhere, 17 in code with the reason shown. Access per the owner decision: ADMIN or operations manager with notifications at Manage, never while impersonating. Waiting: browser pass at 390/1280 light/dark; moving the remaining in-code types (listed in SYSTEM.md, "Notification types and wording").

## QA portal, maintenance portal, sign in and public pages (2026-11-12)

Owner: "build all designs as drawn" for `QaPortal.dc.html`, `MaintenancePortal.dc.html`, `PublicAndAuth.dc.html`. Presentation and composition only; no schema, no API, no authentication change. Details: `docs/SYSTEM.md`, "QA portal, maintenance portal, sign in and public pages redesign (2026-11-12)".

**Status (uncommitted; TypeScript clean in these paths, focused and existing area tests passing; build and browser pass pending).**
- [x] QA and maintenance five-tab bars with role-filtered More menus; `/v2/qa/more` and `/v2/maintenance/more` are menus again; every old destination keeps a home.
- [x] QA Today (figures, visit order, readiness, Monitor clean, Start anyway, Know before you go link, other dates), inspection stage labels and "deductions are proposals", Pay headline with "Office to fix", Reviews / Credits / Invoices, Rework counts and failure state, self-rework labels.
- [x] Maintenance Today (New for you, Due today, Replacements, Open next), visit stage strip, cost card, outcome choices, offline line, Tickets By day / By stage.
- [x] Sign in passkey first, two-step wording, invitation and its four problem states, password reset, onboarding steps with the passkey offer, grouped public menu.
- Reported, not built: maintenance invoices (proposed; no maintenance pay today); inspector reordering (permission decision); single "Fail" verdict; passkey on the invitation screen (no session there — offered in onboarding); onboarding "Do this later"; two-step method switch; quote wizard; suburb menu entry. Full list in SYSTEM.md.

## Client portal redesign (2026-11-12)

Owner: "build all designs as drawn" for `ClientPortal.dc.html` and `ClientPortalDesktop.dc.html`. Presentation and composition; no schema change. Details: `docs/SYSTEM.md`, "Client portal redesign (2026-11-12)".

**Status (uncommitted; TypeScript clean, focused and existing client tests passing; build and browser pass pending).**
- [x] Phone tabs Home, Cleans, Approvals, Money, More; Messages and Request sheet in the header; server-filtered More; desktop rail grouped as drawn; old URLs kept or redirected with query.
- [x] Home (phone) and desktop dashboard; property tabs; Approvals with quotes waiting; Money; one clean; Messages with saved/retry; Settings rows.
- Reported, not built (needs data or a rule that does not exist): report photo thumbnails and QA score on Home and the table; booking pre-selected for a property ("Book a clean here"); a quote reference number; "Usually replies within 1 hour"; "guest in" time on Happening now; calendar property filter chip and dashboard search box (the shell search stays); the board's "11 cleans, 2 add-ons" reads "11 cleans, 2 other items".
