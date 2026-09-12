# sNeek v2: UI, UX, Reliability and Connected Operations Proposal

Date: 2026-09-09
Status: proposal only; no application changes made during this audit.

## Executive direction

Make sNeek an exception-led operations platform: each person knows what needs their attention, why, what they may do, and what happened after they acted. Improve the existing platform, not a parallel rebuild.

"500% more efficient" is an ambition, not an evidence-based forecast. Establish task baselines first. A defensible stretch goal is reducing selected repetitive workflows from five minutes to one minute, without raising errors or removing necessary approvals. That is an 80% time reduction for those workflows, not a promise about the entire business.

## Audit scope and confidence

- Inventoried 167 v2 page files: Admin 83, Client 29, Cleaner 23, QA 11, Laundry 14, Maintenance 7. These include detail pages and redirects, not 167 distinct features.
- VA is a seventh user experience inside the client route tree, with separate grants and property scope.
- Reviewed all six portal layouts, the shared shell, system documentation, selected home pages, notification delivery/feed/live UI, VA permission rules, upload draft storage, and the AI composer. Prior work in this conversation supplies partial cleaner/client/VA walkthrough evidence and the admin navigation snapshot.
- This is a source-informed product and technical audit, NOT a fresh manual walkthrough of every page, a penetration test, or a measured performance/accessibility certification.
- Confirmed findings below are identifiable source behaviors. Deployment impact, device behavior, and workflow frequency need targeted verification.
- Backlog entries are proposals. Some are extensions of existing systems; absence from the inspected surfaces does not prove absence from every route.

## Existing foundations to preserve

The app already has role checks, admin impersonation, VA property scopes, notification preferences and audience controls, email/SMS/web/mobile push infrastructure, SSE notifications, scheduling and reminders, GPS, laundry routes, maintenance assignments, QA/rework/pay, approval queues, invoices, inventory scanning, upload retries and IndexedDB drafts. These are valuable assets.

Use existing domain services, database ownership rules, approval gates and audit records. Do not recreate pricing, scheduling, notification arithmetic, or pay calculations in UI components or AI prompts. Keep v1 compatibility deliberate while making new destinations v2-aware.

## Evidence-led findings

| ID | Finding and evidence | Impact and recommended response |
| --- | --- | --- |
| F01 | `lib/notifications/engine.ts:139`: PUSH logs to the console and returns success. `delivery.ts` has a separate delivery implementation. | This engine path can report false success if used. Trace callers/settings tests and route it to the real transport or explicitly return unsupported. Do not describe all push as broken. |
| F02 | `lib/notifications/feed.ts:43-53`: cleaner links use v1; client/laundry job notifications go to portal roots; VA/QA/maintenance fall through to admin notifications. | Build typed, role-authorized entity destinations, honor portal version, and test fallback access. Notification clicks should open the relevant item, not require a second search. |
| F03 | `components/v2/portal/portal-shell.tsx:181`: desktop header has no search, breadcrumbs or persistent inbox control. | Reuse that space for scoped search, location/context, inbox and connection state. Avoid adding another dashboard band. |
| F04 | `portal-shell.tsx:194`: bottom tabs are `nav.slice(0, 5)`. Client navigation also changes after permission data loads. | Sidebar edits and grant changes can alter primary mobile destinations. Separate mobile navigation configuration from the full menu and resolve grants before rendering actionable navigation. |
| F05 | `portal-shell.tsx:167-176`: mobile drawer is hand-built; close button has no accessible name and no explicit focus trap, Escape handling or restoration is present. | Use the existing accessible dialog primitive if available; add focus management, background inertness, named close control and scroll containment. |
| F06 | `app/v2/maintenance/page.tsx:72,114`: query takes 20 rows; Open tickets displays `openItems.length`. | The total cannot exceed 20 even when more tickets exist. Fetch a separate scoped count and paginate the list. |
| F07 | QA and maintenance home queries catch failures and return zeros/empty arrays. | Database failures can look like an empty queue or "All clear". Represent unavailable/stale data separately, with retry and last successful refresh. |
| F08 | QA/maintenance/laundry home pages construct day boundaries using `toZonedTime`, server-local `new Date(...)`, and fixed 24-hour increments. | Runtime-timezone and daylight-saving boundary risk. Standardize Sydney calendar-day ranges expressed as UTC instants; test UTC-hosted and Sydney-hosted runtimes. This is not yet a reproduced production incident. |
| F09 | `components/shared/live-notifications.tsx:84` asks for browser notification permission during initialization. | Move permission request to an explicit user action after showing its purpose and current device status. |
| F10 | `live-notifications.tsx:104` disables SSE when `navigator.webdriver` is true. | Ordinary browser automation cannot prove real notification delivery. Add a dedicated stream test path instead of treating screenshot runs as notification coverage. |
| F11 | `components/command-palette/index.tsx` implements static route search; its mount was found in v1 admin, not v2. | Extend the existing command interface into scoped v2 search rather than build a second disconnected search. Its current placeholder promises entity search but rendering uses static routes. |
| F12 | `lib/marketing/ai-composer.ts` is the direct model integration found in the searched `lib`/API source: required provider key, hardcoded model, permissive JSON parsing. | Add configurable provider/model health checks and validated structured results. No operational AI control plane was established by this audit. Do not assume its model is available merely because it is configured. |
| F13 | Maintenance home queries are business-wide and do not receive the viewer, while QA has explicit personal ownership scoping. | Decide and document whether maintenance workers should see all work or assigned work. Verify detail/API scope parity with two worker accounts before calling this an authorization defect. |
| F14 | Admin now exposes 39 unique sidebar destinations. | Discoverability improved, but scanning remains expensive. Add searchable navigation, favorites and remembered group expansion while keeping every destination accessible. Do not reintroduce hidden duplicate directories. |

## Prioritization

P0: trust, authorization, misleading results and lost-work risks. P1: frequent daily task efficiency. P2: connected workflow improvements. P3: experimental intelligence.

Effort guidance: S = localized UI/service change; M = several surfaces and tests; L = cross-domain data/workflow change; XL = new infrastructure or integration. These are relative sizes, not delivery promises. Discovery can change the size.

## Detailed improvement backlog

### Shared navigation and workspace (01-10)

1. **P1 / M: Role-aware command search.** Search permitted jobs, properties, people and invoices with separate result groups. Return recent records and actions; never expose unauthorized results, totals or snippets.
2. **P1 / S: Independent mobile tabs.** Define stable daily destinations per role; keep overflow in the drawer. An admin menu reorder must not change cleaner navigation.
3. **P1 / M: Searchable grouped sidebar.** Add favorites and remembered expansion, automatically reveal the active group, and retain a clear all-destinations view. Avoid a 39-link scanning task on every visit.
4. **P1 / S: Useful header.** Add breadcrumbs, current property/client context, inbox, search and profile controls. Compact pages should not repeat oversized titles underneath.
5. **P1 / M: Shared entity context.** Job/property/person links open an inline preview with explicit full-page navigation. Preserve the source list's filters and scroll position.
6. **P1 / M: Saved views.** Persist filters, columns, sort and density for operational lists. Allow named team defaults with personal overrides.
7. **P1 / M: Predictable list-detail navigation.** Next/previous item respects the filtered queue, not database order. Browser Back restores the exact list state.
8. **P0 / M: Honest state vocabulary.** Distinguish loading, refreshing, stale, unavailable, empty, permission denied, and no search matches across all portals.
9. **P1 / M: Consistent action semantics.** Primary next action, secondary actions and destructive actions have stable placement and wording. Disabled actions identify the blocking condition.
10. **P1 / M: Accessible shared controls.** Repair the mobile drawer; standardize keyboard navigation, focus restoration, accessible names, status announcements and adequate touch targets.

### Admin and operations manager (11-22)

11. **P1 / L: Exception-led Command.** Sort work by required action, deadline, impact and owner; distinguish informational metrics from things the signed-in operator can resolve.
12. **P1 / L: Unified dispatch workspace.** Connect calendar, map, cleaner availability and job detail without four page changes. Offer keyboard/list alternatives to drag-and-drop.
13. **P1 / M: Assignment conflict preview.** Before assigning, show travel, overlapping jobs, credential restrictions, property familiarity and acceptance status. Explain which constraints block versus warn.
14. **P1 / M: Batch operations with preview.** Bulk assign, message-draft, reschedule and export only where valid. Show per-row changes, failures and retry status; never imply an entire batch succeeded when some rows failed.
15. **P1 / M: Approval workspace extension.** Bring evidence, request history, policy and financial consequences into the existing Approval Center. Require reasons where policy requires them.
16. **P1 / L: Capability matrix.** Split appropriate admin/ops powers by module, action and scope. Preview effective access; preserve nondelegable rules and server enforcement.
17. **P2 / M: Temporary controlled delegation.** Time-box substitute ops access, log its use and notify the owner on expiry or revocation. Avoid permanent role inflation.
18. **P1 / L: Automation control room.** Extend diagnostics with last run, next run, failures, retries, owner, dry-run preview and bounded pause/resume. Reuse the scheduler rather than invent another one.
19. **P1 / M: Entity audit history.** Filter by actor, property, job and action; show before/after values and distinguish admin impersonation, VA action, automation and direct user action.
20. **P2 / M: Operational health panel.** Surface failed uploads, disconnected feeds, undelivered critical notifications, stale GPS and unprocessed jobs with corrective actions.
21. **P2 / L: Capacity planning.** Compare demand against available staff hours, travel and service windows; show shortages before selling or confirming a slot.
22. **P2 / M: Financial explanation panels.** Show the source of quoted, approved, billable, invoiced and paid amounts. Link adjustments and reversals to their original records.

### Client portal (23-34)

23. **P1 / M: Property-first home.** Pin favorite properties; show next clean, readiness, pending decision and last result. Offer a compact portfolio view for multi-property clients.
24. **P1 / M: Approval inbox extension.** Show amount, reason, evidence, deadline and consequence before approval. Approval must use the latest server amount and version.
25. **P1 / M: Rebook from a prior clean.** Reuse property and service choices, but revalidate availability and price; do not silently copy obsolete access instructions or permissions.
26. **P1 / M: Clear booking review.** Summarize inclusions, timing constraints, access prerequisites, estimated price and any later approval conditions before confirmation.
27. **P1 / M: Explain schedule changes.** Show old/new times, who proposed the change, whether it is requested or confirmed, and impacts on guest readiness.
28. **P1 / L: Trustworthy progress.** Translate internal lifecycle states into client language and expose freshness. Respect the existing live-progress visibility setting and staff privacy.
29. **P1 / M: Report workspace extension.** Combine summary, before/after evidence, outstanding issues and an issue-specific follow-up action. Preserve report release controls.
30. **P1 / M: Property-linked conversations.** Start a message with job/property context already attached; visibly separate internal staff notes from client correspondence.
31. **P2 / M: Property change history.** Show access-guide and instruction changes, effective date and acknowledgement requirements. Do not overwrite the version used for a completed job.
32. **P1 / M: Clear billing buckets.** Separate unbilled work, issued invoices, overdue invoices, credits and receipts. Avoid labels that present forecasts as money currently owed.
33. **P2 / M: Portfolio statement and export.** Filter by property/date and reconcile each total to invoices or work. Preserve VA restrictions on mixed-property invoices.
34. **P1 / M: Service preferences with guardrails.** Let clients manage access windows, preferred cleaner and communications while clearly indicating requests that need operator acceptance.

### Cleaner portal (35-48)

35. **P1 / M: Single shift workspace.** Today's accepted jobs, offers, route and active job appear together; current work is always one tap away.
36. **P1 / M: Persistent active-job strip.** Display timer state, property, save/sync state and resume action on every relevant page. Never obscure form actions or mobile navigation.
37. **P1 / M: Pre-arrival brief.** Summarize only actionable changes since the last visit: access, hazards, timing and approved tasks. Reuse the existing briefing visibility rules.
38. **P1 / M: Timing hierarchy.** Show earliest access, planned start, latest finish and guest deadline as different concepts. Apply the same badges to list, calendar, route and job detail.
39. **P1 / L: Adaptive form navigation.** Expose required remaining items, jump to incomplete rooms and separate not-applicable from unanswered. Never let a UI shortcut bypass submission validation.
40. **P0 / L: Durable evidence queue.** Extend existing drafts with visible queued/compressing/uploading/verifying/attached states, explicit recovery and cross-navigation continuity.
41. **P1 / M: Device-aware capture.** Preview orientation, warn about unreadable/dark evidence, preserve audio when needed, and show low-storage/unsupported-codec fallbacks before work is lost.
42. **P0 / L: Offline contracts.** Specify exactly which actions may queue, which need connectivity and which cannot be assumed complete. Revalidate assignment and permissions when queued actions replay.
43. **P1 / M: Submission preflight.** Show missing evidence, unresolved mandatory checks and synchronization blockers in one panel; retain the form on rejection.
44. **P1 / M: Recoverable job transitions.** Treat duplicate start/pause/submit attempts idempotently and explain stale state from another device. Do not blindly apply optimistic clock changes.
45. **P1 / M: Structured issue escalation.** Capture severity, room, evidence and whether work can continue; route the case with context instead of asking the cleaner to repeat it in a message.
46. **P1 / M: Explainable pay timeline.** Distinguish estimated, submitted, approved, invoiced and paid amounts; link every adjustment to evidence and the dispute path.
47. **P2 / M: QA coaching loop.** Link feedback to the exact checklist item and evidence, allow acknowledgement/response, and show actionable improvement instead of only scores.
48. **P1 / M: GPS and safety clarity.** Show location permission/accuracy status and the recovery path when check-in fails. Keep location collection bounded to legitimate work windows.

### VA experience (49-58)

49. **P1 / M: Dedicated assistant home.** Show delegated tasks, due follow-ups, available actions and pending client decisions instead of a reduced generic client dashboard.
50. **P0 / M: Durable account context.** Make acting-for identity visible before every consequential mutation, not just in the sidebar. Bind drafts to that client and property scope.
51. **P1 / L: Capability projection.** Return authoritative allowed actions with resources; use the same policy service for API checks, navigation and buttons. UI hiding alone is never authorization.
52. **P1 / M: Permission templates.** Offer readable booking coordinator, property support and reporting templates as presets over existing grants, not new roles that bypass restrictions.
53. **P1 / M: Pending-client decision queue.** Let a VA prepare evidence and request client approval without approving money or paying invoices themselves.
54. **P1 / M: Invitation lifecycle.** Extend invitation management with explicit pending/expired/revoked/accepted states, safe resend, one-time acceptance and audit links.
55. **P1 / L: Safe scope changes.** Explain which open tasks become inaccessible; revoke immediately; invalidate caches, exports and any future live subscription scopes.
56. **P2 / M: Handover notes.** Assign an owner, due time and next step to a follow-up; make ownership transfers visible to the client and next assistant.
57. **P2 / M: Client-visible VA activity.** Summarize work performed with links to individual records. Avoid intrusive productivity tracking unrelated to service delivery.
58. **P2 / L: Multi-client switching, only after policy design.** If the data model permits it, add explicit account selection and isolated caches. Do not infer multi-client membership from the current banner.

### QA inspector (59-66)

59. **P1 / M: Readiness-based review queue.** Separate awaiting cleaner evidence, ready to inspect, visit planned, in inspection and blocked; explain why the next action is unavailable.
60. **P1 / M: Evidence comparison workspace.** Pair checklist answers, room media and reference standard. Keep original evidence accessible and identify which capture belongs to which visit.
61. **P1 / M: Fast scoring with completeness checks.** Keyboard and mobile controls update stable totals and require evidence/reason for policy-defined failures.
62. **P1 / M: Rework handoff extension.** Generate a precise room/item/evidence list with assignee, deadline and acknowledgement; track the second review against the original issue.
63. **P2 / M: Inspection visit planning.** Extend the existing day planner with readiness and travel-aware ordering and manual override reasons.
64. **P1 / M: Distinct personal/team metrics.** Label business-wide rework metrics explicitly and avoid mixing them with an inspector's personal queue totals.
65. **P2 / M: Calibration workflow.** Review disputed assessments against the standard with another authorized reviewer. Preserve original scores and adjudication history.
66. **P1 / M: Inspection pay reconciliation.** Link accepted inspection work to pay terms, approved adjustments, invoice eligibility and payment state.

### Laundry operations (67-74)

67. **P1 / M: Next-stop execution view.** Extend route/run tools with one dominant next action, access instructions, quantities and proof requirements.
68. **P1 / L: Bag/set traceability.** Reuse inventory scan conventions where applicable, but define laundry identity separately; record pickup, processing, allocation and return custody.
69. **P1 / M: Quantity discrepancy workflow.** Record expected versus actual with reason and photos; create a tracked exception rather than silently adjusting the plan.
70. **P2 / L: Readiness-linked ETA.** Combine route status, processing readiness and guest deadlines; show stale or uncertain estimates rather than artificial precision.
71. **P1 / M: Access-failure handling.** Offer bounded retry, contact/escalation and reschedule paths with evidence; preserve the existing key-lost and skipped-pickup rules.
72. **P1 / M: Cross-role handoff receipt.** Confirm cleaner-to-driver and driver-to-property handoffs with actor/time and discrepancy visibility.
73. **P2 / M: Capacity/load planner.** Flag vehicle or processing overload before dispatch and explain recommendations without silently rearranging accepted runs.
74. **P1 / M: Daily reconciliation.** Separate collected, processing, returned, exception and carried-forward sets, using actual events as well as scheduled dates.

### Maintenance (75-82)

75. **P0 / M: Accurate scoped totals.** Fix the 20-row count cap; establish assigned-worker versus business-wide views and test list/detail/API parity.
76. **P1 / M: Work-order lifecycle board.** Show acknowledgement, diagnosis, awaiting approval, parts ordered, visit planned, repair and verified closure as actionable states.
77. **P1 / L: Estimate-to-approval connection.** Link material/labor estimates to authorized client/admin decisions; show pending approval as a real blocker rather than generic inactivity.
78. **P1 / M: Parts and replacements connection.** Link stock availability, procurement and expected arrival to the visit, preserving inventory accountability.
79. **P1 / M: Visit workspace extension.** Add prerequisite checks, before/after evidence, completion notes and follow-up directly to the assigned visit.
80. **P2 / L: Asset history.** Track recurring failures by appliance/item and property; present repair/replace history, not an unverified automated replacement recommendation.
81. **P2 / M: Cleaning and guest-window coordination.** Flag maintenance conflicts against cleans and readiness deadlines before confirming the visit.
82. **P1 / M: Closure verification.** Distinguish worker-completed from accepted/verified closure where required; reopen against the same issue with a reason and audit event.

### Notifications and cross-system connections (83-94)

83. **P0 / L: Typed event-to-delivery contract.** Extend existing event definitions with entity, actor, recipient scope, severity and idempotency key. Reconcile existing engine and delivery paths rather than add a third.
84. **P1 / L: Persistent role-scoped inbox.** Add unread, needs-action, snoozed and resolved views. A transient toast must not be the only place important work is discoverable.
85. **P0 / M: Correct deep links.** Resolve the appropriate v2 entity/action destination and safely handle expired access, deleted records and old emailed URLs.
86. **P1 / M: Notification lifecycle.** Separate queued, provider accepted, failed, opened/read and acknowledged. Do not label provider acceptance as human receipt.
87. **P1 / L: Delivery retry and escalation.** Use durable jobs with bounded exponential retry, dedupe and a failed-delivery queue; escalate critical unacknowledged work through approved channels.
88. **P1 / M: Preference clarity.** Extend existing settings with purpose, channel availability, digest cadence and explicit critical-event policy; preserve lawful consent and opt-out handling.
89. **P1 / M: Device notification setup.** User-initiated permission request, test notification, subscription health, revoked-device cleanup and understandable troubleshooting.
90. **P1 / M: Noise control.** Group repeated updates about one issue, suppress superseded reminders, and resolve attention after the task is completed elsewhere.
91. **P1 / L: Connected record timeline.** Link job, QA, case, maintenance, laundry, stock and invoice events without flattening their privacy boundaries into a universally visible feed.
92. **P1 / L: Mutation-driven refresh.** Extend existing SSE/query invalidation so affected views and badges refresh together. Keep a polling fallback and a visible freshness marker.
93. **P2 / L: Integration health and replay.** Extend Xero, calendar/feed and messaging diagnostics with last successful sync, error category, reconciliation and safe replay of failed events.
94. **P2 / L: Scenario automation editor.** Extend current rules with trigger/conditions/approved actions, dry run, version history and audit. Do not allow arbitrary unreviewed scripts or unlimited message loops.

### AI connections and controls (95-106)

95. **P1 / M: AI settings and health.** Centralize provider/model configuration, key handling, feature access, budget limits, latency/error reporting and no-provider fallback. Do not promise subscription credentials work for hosted server APIs.
96. **P2 / L: Read-only operations assistant.** Answer scoped questions such as "Which jobs are at risk today?" with links to source records, freshness and explicit uncertainty.
97. **P2 / M: Job briefing assistant.** Summarize approved tasks, changed access and timing constraints; derive permission-filtered inputs before calling the model.
98. **P2 / M: Communication drafting.** Draft client/cleaner follow-ups from selected records. Preview recipients, content and attachments; require authorized send confirmation.
99. **P2 / L: Support triage assistance.** Suggest case category, urgency and possible duplicates; let a human confirm classification and disposition.
100. **P2 / L: Report drafting.** Summarize submitted evidence into a draft report linked to checklist items. Never invent completed work or release a report automatically.
101. **P3 / L: Evidence quality assistance.** Flag blur, darkness, duplicate images or missing required views for human review. No automatic blame, pay deduction or definitive cleanliness verdict.
102. **P3 / L: Scheduling suggestions.** Rank valid alternatives from the existing scheduling engine using deterministic constraints; explain tradeoffs. AI must not replace clash checking.
103. **P2 / L: Approved knowledge assistant.** Retrieve versioned property guides and procedures with citations. Treat uploaded documents and messages as untrusted content, not instructions to execute tools.
104. **P2 / M: Translation and note cleanup.** Preserve original notes alongside translated/structured drafts; flag uncertainty in access, chemical and safety instructions for human confirmation.
105. **P0 prerequisite / L: AI action gateway.** Use allowlisted domain commands, current RBAC/scope checks, dry-run diffs, confirmation, idempotency and audit. Reject stale approvals if facts changed.
106. **P0 prerequisite / M: AI evaluation and privacy.** Redact secrets/access codes unless strictly needed; define retention, scoped retrieval, prompt-injection tests, provider disclosure, cost limits and a kill switch per capability.

## Motion and visual design specification

The goal is fast comprehension and clear feedback, not making operational work wait for animation. Preserve recognizable branding but reduce oversized headings, repetitive stat cards and decorative loading treatments where they delay work.

| Interaction | Proposed behavior | Guardrail |
| --- | --- | --- |
| Buttons/toggles | 100-150 ms color/opacity feedback | Immediate input acceptance; no layout movement |
| Side panels/drawers | 160-220 ms transform/opacity | Proper focus management; reduced-motion alternative |
| Filtered lists | Brief fade for changed rows | Stable row height, selection and scroll; no full-list replay |
| Assignment changes | Brief affected-row highlight | Never rely on animation alone to communicate success |
| Status changes | Short icon/state transition with text | Only show authoritative completion after server acknowledgement |
| Uploads | Genuine compression/upload/verification progress | Separate unknown duration from measurable progress; no fabricated percent |
| Calendar moves | Animated placement after validated move | Roll back visibly on conflict; offer non-drag controls |
| Loading | Layout-matched skeleton for necessary waits | Keep usable cached content during refresh; avoid full-screen branded loader per action |
| Live map | Interpolate between real pings | Show timestamp/accuracy; never imply motion without fresh evidence |
| Reports/media | Smooth viewer opening, stable image geometry | Zoom, original capture and accessible controls; no cropped evidence |

Use existing CSS transitions first. Introduce an animation dependency only if shared layout or gesture work justifies it. Animate transform/opacity rather than expensive layout, and stop nonessential motion off-screen. No parallax, confetti, looping decorative motion or 3D dashboards in core work surfaces.

Accessibility target: WCAG 2.2 AA, with reduced-motion support as an additional product requirement. Use 44-48 CSS-pixel touch areas for primary mobile controls as our design target; WCAG 2.2 AA target-size minimum is 24 by 24 with defined exceptions, not universally 44. Status messages need assistive-technology exposure and errors must not rely on color alone. Source: https://www.w3.org/TR/WCAG22/

Responsiveness target: field INP at or below 200 ms at the 75th percentile, measured separately on mobile and desktop. This is a proposed target, not a measured property of this app. Source: https://web.dev/articles/optimize-inp

## Connected workflow examples

### Guest deadline changes

Client requests an earlier arrival -> existing timing service validates -> admin previews conflicts -> authorized approval commits the change -> cleaner and laundry see the same deadline/version -> acknowledgements are recorded -> unresolved risk enters the ops exception queue. A VA may prepare the request only within their grants. Do not send notifications before the change transaction commits.

### Cleaner finds damage

Cleaner captures evidence -> case is linked to the job/property -> admin triages and controls client visibility -> maintenance estimate is prepared -> client approves cost if required -> worker is assigned -> repair proof is submitted -> authorized closure updates the case and report. Reuse original evidence references instead of requiring three uploads.

### Clean fails QA

QA records an item-level issue -> authorized rework process assigns the corrective task -> cleaner acknowledges -> new evidence is tied to the same issue -> QA verifies -> pay effects follow existing approval rules. No AI or notification automation silently determines financial penalties.

### Laundry shortage threatens next clean

Driver records discrepancy -> property readiness is recalculated -> ops sees affected jobs and approved alternatives -> staff acknowledge the updated plan -> actual returned quantities reconcile the exception. Preserve the distinction between expected, scanned and verified quantities.

### VA requests an extra

Assistant drafts scoped task -> authorized reviewer validates -> any extra cost goes to the client -> approved task reaches the cleaner briefing -> completion evidence reaches the report/invoice. A grant allowing task creation never becomes permission to approve expenditure.

## Delivery plan

| Wave | Scope | Exit gate |
| --- | --- | --- |
| 0: Baseline and trust | Reproduce F01-F10; scope decisions; metrics and role fixtures | Known defects have tests; no misleading success or silent empty-state regressions |
| 1: Shared daily UX | Drawer accessibility, stable mobile tabs, search, header, consistent states, saved list context | Core navigation verified at mobile/desktop sizes for all seven experiences |
| 2: Cleaner and dispatch | Active shift, evidence recovery, form preflight, assignment previews | Start-to-submit and lost-connection recovery pass on actual supported phones |
| 3: Client and VA | Property home, approval context, scope-safe delegation, report/billing clarity | Cross-account and property-scope negative tests pass for UI, API, exports and live updates |
| 4: Connected operations | Persistent inbox, typed links/events, QA/laundry/maintenance handoffs | End-to-end scenarios produce one authorized change and the correct recipient notifications |
| 5: Controlled AI | Read-only answers, briefings, drafts, evaluations | Scoped source citations, injection tests, budget controls and graceful provider failure demonstrated |
| 6: Selective advanced automation | Scheduling proposals, evidence assistance, rule simulation | Measured benefit exceeds false-positive/support cost; human financial gates remain intact |

Ship small slices behind per-role feature flags. Prototype and test the shared header plus one cleaner job workflow before rolling visual conventions across 167 routes. Maintain the existing application and domain boundaries; this does not justify an automatic framework migration or microservice rewrite.

## Measurement and acceptance

Baseline at least these tasks before setting numeric improvement commitments: assign a suitable cleaner; locate the next action on an overdue job; submit a clean with evidence; approve an extra; find an invoice explanation; handle a VA booking request; close QA rework; reconcile a laundry stop; complete a maintenance visit.

Record median and p90 completion time, taps/page changes, retries, abandonment, support contact and error rate. Separate new users, repeat users, small portfolios and large portfolios. Faster is not better if scope errors or incorrect approvals rise.

Provisional targets to validate: 30-50% fewer navigation steps on frequent tasks; zero lost drafts in defined recovery tests; zero duplicate state transitions in retry tests; all tested actionable notifications land on the authorized record; zero monetary approval bypasses; no horizontal overflow at supported phone widths. These are release criteria/targets, not current measurements.

## Verification matrix

- Personas: Admin, Ops manager, Client single/multi-property, Cleaner, VA with full/restricted/expired grants, QA inspector, Laundry, Maintenance. Include inactive and recently revoked users.
- Visual/manual: desktop 1440x900 and 1920x1080; mobile 360x800 and 390x844; tablet; keyboard-only; 200% zoom; reduced motion; light/dark where supported.
- Real hardware: supported iOS Safari and Android Chrome for large videos, camera orientation/audio, storage pressure, notification setup, GPS denial and background/resume. Desktop automation alone is insufficient.
- Network: slow connection, drop during upload, reconnect after approval, session expiry, server failure, stale cached page and provider outage.
- Concurrency: two admins assign the same job; client changes an amount while approval is open; VA scope revoked during editing; two devices submit; retries replay after a timeout.
- Date handling: Sydney midnight, UTC server runtime, daylight-saving transitions, early access and late checkout spanning adjacent days.
- Notifications: actual event -> committed record -> durable delivery -> recipient -> authorized deep link -> acknowledgement. Cover the SSE path explicitly because ordinary webdriver currently skips it.
- Permissions: direct URLs and direct API calls, scoped search results, media downloads, exports, cached records, notification streams and AI retrieval. Test negative cases, not only visible buttons.
- Rollout: targeted unit/integration tests, key journey E2E tests, screenshot comparison, production-like build, small pilot, error/latency monitoring and tested rollback. Never publish a whole-app signoff from a few successful screenshots.

## Decisions to settle before implementation

1. Which three workflows consume the most daily staff time? Measure those first.
2. Are maintenance and laundry users allowed business-wide visibility, or assigned-only work?
3. Which booking changes need client/admin acceptance versus immediate confirmation?
4. What notification severities justify escalation, and who owns unanswered alerts?
5. Which phones/browsers and maximum practical video workloads must be supported?
6. Should assistants ever support multiple client accounts in one login? Current safety rules remain until explicitly redesigned.
7. Which AI provider, data handling policy and monthly budget are acceptable? No external AI transmission is authorized by this proposal.

## Recommended first implementation slice

Fix the capped Maintenance total and honest error states; repair notification destination resolution; prove actual push delivery for each used path; repair the shared mobile drawer; decouple bottom tabs; add scoped v2 navigation search. Then implement a cleaner active-job/evidence-recovery slice and a client approval slice. These address trust and repeated work before adding visible AI or extensive animation.

No code, database records, provider settings, notifications or external integrations were changed by this proposal. Implementation and GitHub publishing require a subsequent request.
