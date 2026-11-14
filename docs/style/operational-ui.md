# Operational UI: Estate integration rules

Use these rules when adding or changing operational screens, including accounts,
stock, holiday rates, care, stay preparation, linen custody and profit review.

## Use the existing system

- Estate tokens live in `app/v2/estate.css`, scoped by `data-skin="estate"`.
  Reuse `components/v2/ui/primitives.tsx`; do not copy colours or invent a theme.
  `docs/style/design-tokens.md` describes the older global theme, not v2 tokens.
- Standalone operational pages use `OperationsPage` from `components/operations/ui.tsx`.
  Set the current role accent and a real return destination. Within a portal shell,
  set `embedded` to avoid duplicate main landmarks and page gutters. New admin
  entry links should stay in `/v2/admin`; preserve older routes for compatibility. Embedded panels use
  `OperationsPanel`, an h2, and no additional main landmark or page h1.
- Keep styling scoped. `operations.css` styles native controls only within
  `.ops-content`; never change all portal inputs, buttons or links globally.
- Reuse `OperationsButton` / `EButton`. Use primary for the main action,
  outline for secondary actions and print/export, ghost for navigation, danger
  only for destructive actions. Use `asChild` for links; never nest button and link.

## Integrating extensions into an existing feature

- Default to an existing tab or section, rather than another top-level entry link.
  Property care belongs in Jobs & history; stock needs in supplies; bag observations
  in laundry; individual turnover cost review in Finance overview.
- A tool with its own list and form (urgent stock) is a tab of the workspace it
  belongs to. Never place a panel between a tab bar and the active tab's content.
  A disclosure goes after the content it supplements, or first inside the tab
  that owns it.
- Give every `OperationsDisclosure` a one-line `description` saying what the tool
  does and what it does not change, and an icon passed as an element.
- Use `OperationsDisclosure` to defer requests until opened and retain draft state
  when collapsed. Its title supplies the section h2. Pass `panel` to operational
  workspaces inside it so they inherit the portal and omit standalone back/title UI.
- Pass `pending` to `OperationsPage` during writes. Its disabled fieldset locks both
  the submitted fields and entity selector; buttons alone do not protect a newer draft.
- Cancel scoped reads and check the signal after JSON parsing. Key editors by their
  entity when externally supplied context changes. A loading/error state must not
  display a definitive empty-state claim.
- Match entry-point visibility to existing backend authority. In particular,
  turnover financial review and urgent-stock administration require ADMIN;
  laundry bag observations are ADMIN/CLEANER/LAUNDRY, not OPS_MANAGER.

## Settings navigation and action placement

- Settings has one canonical category directory at `/v2/admin/settings`. Register
  destinations in `components/v2/admin/settings/settings-catalog.ts`, with a clear
  description, an existing category and the same role boundary as the server.
  Keep navigation metadata separate from actual settings and credentials.
- Use the horizontal category row and current-category section links on desktop;
  use the labelled grouped selector on phones. Search covers all accessible
  categories and must not replace or remount the active form as someone types.
  Preserve existing `?tab=` links and redirect older standalone editor URLs.
- Money owns bank/payment details, cleaner rates, public holiday rates, pricing
  variables, payment gateways and Xero. Operations owns laundry locations, the
  property form, iCal and operational connections. Extend these groups before
  adding another top-level destination.
- Never put a feature button above the page heading. Page-wide actions belong in
  the header action slot; section actions belong beside or below that section's
  heading/content. Save stays with its form, destructive actions stay separate,
  and navigation uses links styled with the portal's existing button primitive.
- Offer a job-specific holiday review only inside Job → Money, carrying the job ID
  into Settings → Money → Public holiday rates. Return links must restore job
  context. Hide admin-only actions from operations managers; keep server guards.
- Individual bag tracking is an optional observation log for physically labelled
  bags. Its global entry belongs in Laundry → Tracking, with scoped entries in a
  cleaner's job and the admin investigation. Do not repeat it in Queue and Runs
  or move operational recording into Settings. Explain that it neither advances
  the run nor proves recipient acceptance. Laundry settings configure locations
  and operating defaults only.
- Use 44px navigation targets, visible input labels and focus indicators, 16px
  mobile navigation input text, explicit active state, and Estate theme tokens.

## Layout and language

- One page h1 with the Estate signature rule; short introduction; related work
  grouped in surface cards. Use 16px mobile / 24px desktop gutters and card padding.
- Stack forms on narrow screens. Pair related fields only where labels remain
  readable. Set `min-width: 0` on flex/grid children; wrap identifiers and long names.
- Keep one clear primary action per section. Hide advanced configuration in
  labelled disclosures. Tables scroll inside a labelled region, not the whole page.
- Format history instants with the organisation timezone supplied by the server page,
  using the existing date-fns-tz formatter. Keep service/due calendar dates as days,
  without viewer-timezone shifts. Friendly labels must not change stored enum values.
- Put cleaner stay preparation inside the guest-count card as a collapsed disclosure.
  Keep guest count visible, expose aria-expanded/aria-controls, retain mounted content
  when toggled, and expand on loading errors. Avoid a duplicate standalone card.
- Prefer human-readable headings and dates. Keep provenance and unknown states
  visible. Do not present recorded, estimated, delivered, approved or paid as synonyms.
- Preserve business semantics: a UI restyle must not change auth, request bodies,
  evidence receipts, required reasons, draft state, confirmation consent or defaults.

## Accessibility and feedback

- Every input needs a persistent visible label; placeholders are examples only.
  Associate help/errors with `aria-describedby`; keep native select/checkbox semantics.
- Native controls must inherit the active colour scheme so date-picker icons and
  dropdown menus remain visible in Estate Obsidian. Embedded content inherits its
  surrounding card surface rather than creating another themed page background.
- Controls have at least 44px touch height and visible keyboard focus. Use 16px
  mobile input text. Do not rely on colour alone for status.
- Use `OperationsLoading` during the initial read, not an empty-state message.
  Distinguish loading, no records, authorization failure and request failure.
- Announce errors with role=alert and successful saves with a polite status.
  Keep entered values after failures. Disable repeat submissions while pending;
  preserve existing idempotency and explicit confirmation behavior.
- Do not show success before the write succeeds. A saved record does not claim
  delivery, payment, physical completion or external service success.
- Print controls are secondary and hidden in print. Printed records must retain
  context, unknown values and draft/submitted/estimate labels; hide editable forms.

## Review before delivery

- Inspect 390px mobile and 1280px desktop renders in light and Estate Obsidian dark mode. Check overflow, long labels,
  empty/loading/error/success states, keyboard focus and labelled controls.
- Exercise affected workflows using isolated fixtures. Re-run relevant behavior
  and role-isolation tests plus lint, TypeScript and a production build.
- State which screenshots and flows were actually inspected. If a supplied image
  cannot be read, record that limit; do not claim a visual match to unseen pixels.
- Keep the change reviewable and local until deployment is authorized.

## Returning to a workspace

- Use the shared view-memory provider and `useRestorableState` for transient tabs,
  filters, view modes and navigation steps. Persist at the interaction, before
  navigation can unmount the component. Shared classic Tabs remember their choice;
  use a distinct `memoryKey` if a page contains identical tab sets.
- A bare return link restores the last view before personal/team defaults. An
  explicit destination query wins. Full browser refresh clears only transient
  view memory and resets view query parameters; saved defaults and form/evidence
  drafts are separate and must survive. Preserve unrelated URL parameters and
  Next's history state. Never store credentials or server records as view memory.
- Keep memory scoped to the effective identity, active role, retained account,
  impersonation and pathname (including the record ID). Use client router links
  for ordinary navigation. Retained-account transport remains authoritative.
- A workflow step can be restored only alongside its underlying draft. New
  onboarding surveys move to their saved record URL. Booking and evidence
  recovery retain their existing draft protocols; never resume an empty form at
  a remembered completion step. Validate stored enum values when displaying them.
- Documented exception (2026-11, Calendar only): the Calendar restores its view and
  date after a full refresh. The view is saved per view scope in local storage and
  restored always; the date is saved in session storage with the Sydney day it was
  saved on and restored only in the same browser session on that day, so a refresh
  keeps the week being planned while a new visit (or the next day) opens on today.
  Restored values are written back to the URL; an explicit URL wins; "Today" clears
  the saved date. Keys live outside the view-memory prefix. Do not copy this to
  other workspaces without the same owner decision.

## Operations-manager permissions

- Register route ownership in `lib/rbac/ops-catalog.ts` for new features and API
  aliases. Admin routes without a mapping fail closed for operations managers.
  Route-coverage tests are mandatory when adding a new admin destination.
- Permissions supplement existing role, record, financial and service guards.
  Manage never grants an admin-only action. Off blocks reads and writes; View
  only permits GET/HEAD/OPTIONS. Mutation routes must use unsafe HTTP methods.
  Do not move mutations into GET to evade read-only restrictions.
- Keep real/effective actors distinct. Accounts holding ADMIN remain administrators;
  impersonating a manager uses the target's policy. Having another non-admin role
  does not bypass restrictions on shared operational routes. Worker-specific
  routes retain their own ownership checks.
- Read policy on the server for every request; never authorize from client state,
  navigation visibility or a cached JWT. Middleware overwrites request path/method
  metadata, including retained-account routes. Missing or corrupt policy data
  must not silently grant access (an absent initial record is the documented
  compatibility default).
- Permission packs and overrides belong in Settings → Access → Roles. Save the
  complete validated policy with revision checks, a transaction lock and audit
  history. Freeze selectors while saving; keep failed drafts; require explicit
  reload after a conflict. A preset change intentionally replaces that manager's
  overrides; editing a shared pack preserves individual overrides.
- Reuse `useOpsAccess` when offering feature navigation. Hide blocked destinations,
  show view-only status, and keep an accessible route into allowed settings even
  when the general overview is off. Search must omit blocked record categories.
- Permissions are workspace-level, not field redaction: Jobs includes its job
  billing view, Properties includes its rate cards, and Dashboard/Reports include
  their existing cross-feature summaries. Shared files/media have a separate gate, with additional job/property preview
  checks. Maps and self-service account controls keep their existing authorization. Changes to
  those boundaries need explicit service-level design and tests.

### Status, sensitive actions and live readings (2026-10-09)

- Use `lib/jobs/status-presentation.ts` for whole-block job/laundry status tint. Keep a written status badge; colour alone is insufficient. Unknown statuses remain neutral. Paused and continuation approval are interruptions within Cleaning, not extra completed progress milestones. Workflow progress is not checklist completion percentage.
- Laundry cards must expose scheduled and actual timestamps, handoff notes/actors, linked clean, buffer/key-lost context and evidence. Keep task reports in the existing Reports workspace with an explicit task scope; offer a clear return to all reports. Preserve previous evidence object references in an atomic audit when replacing a photo.
- Calculate Sydney totals using Sydney date keys, not a wall-clock `Date` compared to UTC instants. Label date-limited totals and active lists accurately. Request errors must not render as successful zero totals or an empty operation.
- Sensitive actions require explicit grants in Settings → Access → Roles in addition to workspace Manage access. New grants default off, including for the compatibility pack. Custom packs may carry grants; per-manager false overrides a pack grant. Managers use their own Profile security PIN/password. A credential check is not a permission grant. Never convert the manager's whole role to ADMIN.
- Xero reconciliation is a separate protected action: reason, external correction reference and explicit acknowledgement, with server verification and invoice row locking. It records a local void after manual external reconciliation, preserves document/Xero history and atomically releases unbilled work. Payment evidence and pending exports remain protected. Never silently erase an issued invoice or imply that Xero was contacted.
- GPS timestamps describe the device measurement, not the time a cached position was resent. Heartbeats request a new fix; no fix means stale/unknown. Serialize reads, discard older stream positions and refresh visible operational totals. Label tracked people separately from fresh GPS locations.
- Progress notifications remain open while work runs. HTTP error responses are failures even if `fetch` resolved. Allow at least five seconds to read completion and ten seconds for errors. Request completion does not prove email delivery.

### Job vectors and consolidated filters

- Use `JobStatusIcon` and `JobStatusProgress` for workflow vectors. Written status remains visible; icons are decorative. Pauses and approval holds stay at Cleaning. Unknown states never imply completion.
- Motion marks the current server-reported status, not measured work or GPS activity. Use brief, finite stage-specific animation on mount/status change; honour reduced motion. Completed milestones do not loop. Seven steps form a horizontal rail on larger screens and a readable vertical rail on phones.
- Keep Jobs search, date scope/range, status and entity/invoice filters in one keyboard-accessible disclosure. Clear filters clears all filtering but preserves display preferences. Choosing a date shortcut replaces a custom range; a custom range suppresses shortcut selection. Sorting, density, columns and list/board controls remain display tools.
- Refresh visible Jobs lists every 15 seconds and on focus; never blank successful rows during background refresh. Retain the last snapshot with an explicit stale message on failure, reject obsolete responses and do not overlap background reads.

### Jobs view options

Keep persistent view administration behind the page-heading three-dot menu → View options. Group layout/sort/density/columns, personal saved views and shared defaults there; use labelled actions instead of unexplained icon rows. Keep operational filters and export available in the workspace. A compact summary shows the active layout while options are closed. Reset appearance restores layout/sort/columns/density without clearing filters; Reset Jobs view explicitly resets the whole view. Closing options must not unmount default-loading logic or discard saved-view drafts. Shared publication retains its existing server permissions, revision checks and confirmation.


### Cleaner evidence and embedded job tools

- A gallery thumbnail selects the item; an explicitly labelled Preview action opens a modal. Preserve selection after closing preview. Do not use navigation or a new tab as the default photo interaction.
- Synchronize server-confirmed evidence through scoped receipts and versions. Never replace local form answers during background media refresh, restore a tombstoned photo, or silently reinterpret an unrelated account/job capture. Preserve the original capture context when an explicit, audited current-form rebind is allowed.
- Batch assignment should reuse one receipt snapshot and bound concurrency; acknowledge each result before changing its visible destination. Keep partial successes and expose retryable failures.
- Reuse the existing stock request and route workflows inside job context. Lock embedded stock requests to the job property, preserve drafts on collapse, and let the route workflow own GPS consent and driving mutations.
- Show one authoritative laundry update. Put property access only in Setup and property setup references in Travel and Setup. Keep the cleaner dashboard route compact; the route page owns the full itinerary.
- Charging checks require proof for a positive outcome and an explanation for an exception. Resolve current applicability before validation; never infer completed work from missing evidence.
- Use shared SVG status icons with finite motion and reduced-motion support. Dates use the organization timezone. Restored stages must still respect current workflow gates.

Browser/install icons use the existing Company & brand light-background logo. Keep the manifest identity stable; version image URLs when saved branding changes. Generate actual square PNGs with an opaque background, preserve artwork proportions and reserve Android maskable safe space. Do not offer duplicate favicon/mobile-logo settings for the same brand identity. Existing installed shortcuts may retain an old icon until the user re-adds them.

Mobile grid panels must use an explicit shrinkable base track (`grid-cols-1`) and `min-w-0` on spanning children. Wrap card-header actions. Keep wide tables scrollable inside their panel; verify actual panel bounds at phone widths, since page-level overflow clipping can hide broken layouts.

### Progress and refused access (2026-11)

- Do not add a spinner list, per-file progress bar or progress toast for an upload, export or generated document. The single activity bar reports them. A component that knows bytes sent or a compression phase calls `publishActivityBatch` while it runs and `endActivityBatch` with its done/failed counts when it stops. Keep cancel, retry and failure messages beside the control that owns them.
- Never show an invented percentage. Show finished units out of started units, a measured byte fraction, or an indeterminate track.
- A destination whose server guard is ADMIN-only sets `adminOnly` on its navigation entry. Do not rely on the guard alone: a menu must not offer a page that will refuse the person.
- Every maintenance-portal read of `PropertyMaintenanceItem` spreads `maintenanceItemScope(session.user)` into its `where`.

### Withheld details and approvals (2026-11)

- When the server withholds something for a stated reason (access details outside the acceptance window), show the server's sentence where the content would be. Do not leave an unexplained gap and do not invent a reason in the component.
- Say on the action that unlocks it what it unlocks: the job offer card states that access codes appear on acceptance.
- An approval the office must give sits beside the status it changes, with one sentence on what is held until then (shopping run: "Approve reimbursement" under the reimbursement status).
- Group one audience's access into a single labelled panel: guide entries first, flat lockbox/codes/parking after, photos as buttons. Do not repeat the same instruction in two panels.
- A refused attachment explains what to do next ("Remove it and attach the file again"), not which check failed.


### Lists, bulk actions and row menus (2026-11)

These match the approved concept (`table.t`, `.chip`, `.bulk`, `.b`) using Estate tokens. Reuse them for every redesigned list.

- Use `EDataTable` from `components/v2/ui/data-table.tsx`. Sorting is server-side: a sortable header is a real button and its `<th>` carries `aria-sort`; the table never re-sorts a page itself. Money columns open largest first (`firstDir: "desc"`). The table scrolls inside its own labelled region; give it a `minWidth` and put it in an `ECard` with `overflow-hidden`.
- Keep loading, error, empty and stale apart: no rows + loading is a status, no rows + error is an alert with retry, rows + error is a stale banner over the last good rows. Never show rows from a different filter as if they answered the current one.
- List routes read `page`, `pageSize`, `sort`, `dir` through `parseListQuery`, refuse unknown sort columns with 400, and return `listResponse` plus real grouped counts. Chips show a count only when the server sent one.
- Filters: `EFilterChips` for the single-choice status row; `EFilterPopover` for client, period and similar filters, so an active filter stays visible on its chip. Keep filter, sort and page in the URL beside `tab`, and reset selection when the filter set changes.
- One primary action per row, chosen from the record's state; every other existing action goes in `ERowMenu`. Corrections and destructive actions sit after a separator and open their own confirmation tier (see "Confirmations" below). The menu is keyboard operable (arrows, Home/End, Escape returns focus) and renders in `EstatePortal` so a scrolling table cannot clip it.
- `EBulkBar` (dark, `--e-sidebar-*` tokens) appears only with a selection, says how many and of what, and offers `EBulkButton` actions. A bulk action is one request to a server endpoint that answers per row (done / refused with reason / no change); show those results and keep refused rows selected. Never loop single requests from the browser.
- `EPill` is the status badge: written text always, tone from status, unknown states neutral.
- A disabled menu item that is planned says so (`hint: "Coming in a later step"`) rather than disappearing silently.
- `EStageBar` (`components/v2/ui/stage-bar.tsx`) is a read-only stage strip. Map stages from stored state only: "done" needs a recorded fact (e.g. a Xero invoice id), an unconfirmed step is "pending", an optional step that left no record is "passed", and a terminal state (void) replaces the strip. Every stage carries its state in words.
- A record editor page (first: `/v2/admin/finance/invoices/[id]`) keeps the list's URL state in `?back=` for its back link, offers the list's own primary action plus a "more" menu, and saves explicitly unless the write is last-write guarded. Show the server's lock reason when the record is read-only.

### Peek panels and view tabs (2026-11, first used on Jobs)

- `ESidePanel` (`components/v2/ui/side-panel.tsx`) previews one record beside a list: a column from `lg`, a full-height modal sheet below it. Keep the record id in the URL (`?open=<id>`), key the panel by that id, and load secondary tabs only when chosen; abort a tab's read when the record changes and check the response still belongs to the open record. Focus goes to the panel title on open and back to the opener on Escape or close.
- Clicking a row may open the panel, but the row must also have a real control (the record name as a button) for keyboards; nested checkboxes, buttons and menus never open it.
- View tabs are filter presets defined once on the server side of the list (`lib/jobs/view-presets.ts`); a tab applies exactly its filters, is current only while the filters match, and shows a count only when one grouped server query produced it.

## Builder conventions (form builder, 2026-11)

- Three panes (outline · items · settings/preview) side by side from `lg`; below it they are steps in a labelled pane nav with 44px targets, never a page-level horizontal scroll.
- Every drag has a keyboard path: dnd-kit's keyboard sensor on the handle, plus row-menu items (Move up, Move down, Move to…). The handle is a real button with an instruction in its accessible name.
- Edits go through one document with undo/redo; shortcuts are handled on the builder root, never a global listener, and skipped inside text inputs.
- Autosave only with the stale-write token, serialised; a 409 stops autosave and offers explicit choices. Show saving / saved / failed / conflict truthfully in the header line.
- Previews of cleaner forms use the real renderer (`FormRenderer mode="preview" | "sandbox"`), never a look-alike, and never upload or submit.
- Badges on a row state behaviour the stored data really drives; a usage warning comes only from a real usage check.

## Flagged cards, rows and notices: the tone band (2026-11, owner decision)

No coloured line down the left edge of a card, row or notice, anywhere in v2. The owner chose design B, the tinted title band, in colour set 1 "Honey and wine". Use `components/v2/ui/tone-band.tsx` (a plain module, safe from server pages) and the `--e-band-<tone>-{bg,line,fg,muted,pill}` tokens in `app/v2/estate.css` (light and Obsidian dark); never hand-pick colours.

- Tones: `attention` (honey) for something waiting on someone or about to go wrong (was warning/amber: late, needs acknowledgement, approval waiting, offer open); `problem` (wine) for something failed, blocked or refused (was danger/red: failed pickup, could not load, required items missing); `good` (sage) for a confirmed positive outcome (was success/green: delivered, valid, saved); `info` (sky) for neutral context worth noticing (was info/blue or primary used as information: guest in at 15:00, linen drop location). `toneFromLegacy` maps the old names.
- Card: when flagged, the title row becomes the band (`EToneCard`, or `EToneBand` / `toneBandClass` first inside an `overflow-hidden` card): tint, hairline under it, rounded top following the card. The body stays on the plain surface. A card with nothing to flag keeps a plain top, so a band always means something.
- Table or list row: tint behind the leading cell (`EToneRowCell` / `toneRowCellClass`), no left line. A selected or active `EDataTable` row is a soft primary tint, also without an inset line.
- Notice / callout (`EAlert`, `EToneNotice`, `toneNoticeClass`): the whole box takes the tint with a hairline border.
- The written reason stays: the pill or badge in the band sits on the surface colour (`tonePillClass`, or `E_BAND_BADGE_CLASS` on an existing `EBadge`/`EPill`). Colour is never the only signal. Secondary text in a band uses `toneMutedClass`.
- Not status accents, and left alone: column dividers (`border-l` between panels), drawer edges, segmented-control separators, timeline connectors, nested-question guides, quote styling, focus rings and chart marks. `tests/lib/no-left-accent-lines.test.ts` fails if a left accent comes back outside its allowlist.

## Phone layout (board "Admin phone", 2026-11-13)

Phone means below 640px: Tailwind `max-sm:` for phone-only styles, `sm:` for everything else. From 640px up a page must look and behave exactly as before, so phone changes are `max-sm:` classes, phone-only components, or markup swapped only after `useIsPhone()` (from `components/v2/ui/use-phone.ts`; it starts false, so also hide the desktop variant with `max-sm:hidden`). Constants live in the plain module `components/v2/ui/phone.ts` (safe for server pages). Layout and composition only: never change requests, permissions, defaults or wording to fit a phone. Every desktop function stays reachable; it may move into a sheet, a "More", a tab or the header.

**Shell.** Admin phones have five tabs: Command, Jobs, Calendar, Approvals, More (`lib/navigation/mobile-tabs.ts`, `PHONE_SHEET_PATHS`). More is a bottom sheet (`components/v2/portal/phone-more-sheet.tsx`) listing every other rail entry under the rail's groups, from the rail's own filtered list (role, permission packs, `adminOnly`), with the rail's badges and "Find a page". It replaces the drawer's menu button below 640px only; from 640px to the desktop rail the drawer and the five-tab bar (with Properties) are unchanged. The More tab shows a dot, never a sum. The Approvals badge is the existing `approvals` count, the sum of all fifteen queues. Other portals keep their own bars. A new admin destination only needs its rail entry; it appears in More automatically.

**What every shared primitive already does on a phone (no page change needed).**
- `EButton` (sm, md, icon), `ERowMenu` triggers, filter chips and bulk buttons are 44px tall.
- `EActionDialog` (so `EConfirmDialog` and `EConfirmModal` too), `EModal` and the Jobs `JobDialog` are bottom sheets with the same labelled, focus-trapped semantics, a grab handle and a sticky footer; a confirmation stacks Cancel above a full-width confirm button.
- `ESidePanel` is a full-screen sheet: back arrow on the left (same accessible name as the close button), its own scroll, the page behind locked, and focus and scroll position restored on close. `?open=` is unchanged.
- `EBulkBar` docks above the tab bar with the count, the first two actions (`phoneActions` to change), "More" for the rest and Clear. Put the most used actions first. Every action stays mounted, so an action that owns a dialog keeps working.
- `EDataTable` stacked cards hide row checkboxes until "Select" (beside "Sort by"); "Cancel" hides them and clears the selection. Select-all and selection semantics are unchanged. Mark the column that names the record `phoneTitle: true` when it is not the first column.
- `EPagination` is one compact row. `CollapsibleFigures` folds figure tiles behind "N figures · Show".

**What a page opts into.**
- Filters: wrap the existing controls in `EFilterBar` (`components/v2/ui/filter-bar.tsx`). From 640px up the children render inline as before; on a phone they sit behind one "Filter" button with the active count, in a bottom sheet holding the very same controls, and active filters render as removable chips. Pass `active` (one entry per filter that differs from its default, each with `onRemove`), `onClear`, `resultLabel` ("Show 128 jobs") and `tools` for display switches that are not filters (layout, columns). `EFilterPopover` turns into an open labelled section inside the sheet and `EFilterChips` wraps; wrap a page's own "Clear filters" in `EFilterBarInlineOnly` because the sheet has one beside its title.
  ```tsx
  <EFilterBar label="Filter jobs" active={active} onClear={clear} resultLabel={`Show ${total} jobs`} tools={<LayoutSwitch />}>
    <SearchInput /><EFilterPopover label="Client" value={clientName}>…</EFilterPopover>
    <EFilterBarInlineOnly><EButton variant="ghost" size="sm" onClick={clear}>Clear filters</EButton></EFilterBarInlineOnly>
  </EFilterBar>
  ```
- A queue or stage switch above a list: `EFilterChips phoneLayout="carousel"` keeps the chips on one swipeable row.
- The page's ONE primary action: keep the header button with `max-sm:hidden` and add `<EPhoneActionBar label="Jobs actions" primary={…} secondary={…} hidden={selection.size > 0} />` (`components/v2/ui/phone-bars.tsx`). It renders only on a phone, so the action is never in the document twice. Hide it while a bulk bar owns the bottom.
- Long full pages: `<ESectionSwitcher label="Invoice sections" sections={[{ id, label }]} />` gives sticky section chips (phones only unless `everywhere`); each target is a `<section id>`.
- A phone-only chooser: `EBottomSheet` (`components/v2/ui/bottom-sheet.tsx`).
- A list row that becomes a card with a band on a phone only: `tonePhoneBandClass(tone)` from `tone-band.tsx` (never a left line).
- A small `ETableShell` table whose cells read on their own (status pill, date, actions): pass `phoneStack` to stack rows below 640px instead of scrolling sideways. Larger tables get a phone list (`sm:hidden`) beside the table (`max-sm:hidden`).
- Status-tinted cards in v2 use `statusTintStyle` (tint only); `statusBlockStyle` adds the classic coloured inline-start edge and is for the classic pages only.

**Rules.** Nothing scrolls sideways except deliberate carousels (tab rows, chip rows, the section switcher). Inputs in sheets use 16px text. Keep one page h1; sheets use their own h2 title. Check 390px and 1280px in light and dark before delivery, including the docked bars over the last list item.

## Confirmations: three tiers, no typed words (2026-11-14, board "Confirmations and deletes")

Every confirm or delete prompt is one of three tiers, from the shared `EConfirmDialog` (`components/v2/ui/confirm-dialog.tsx`; `EConfirmModal` renders it). Do not build another confirm dialog, and never ask anyone to type a word (DELETE, VOID, REMOVE, DISCARD): `confirmPhrase` is ignored.

- **A, ordinary** (`tier="ordinary"`): one sentence and a confirm button that names the action. Focus starts on it; Enter confirms, Escape cancels. For reversible steps (reverse to draft, mark as sent, recall, reopen, key lost mode, withdraw a request).
- **B, removes something** (`tier="destructive"`): one line saying exactly what is removed and one red button. Focus starts on Cancel. Offer Undo with `undoToast` (10 seconds) only where nothing has left the screen yet or the removal can be put back exactly (a draft's questions, entries, a plain draft invoice line); otherwise the line ends "This cannot be undone".
- **C, sensitive** (`tier="sensitive"`): one or two plain lines and ONE credential field: the signed-in person's own PIN, or their account password while they have no PIN (with "Set a PIN"). Its states are has PIN, wrong PIN with tries left, locked until a time in the organisation timezone, no PIN yet, and not available while testing as someone else. The route verifies `security` with `verifySensitiveAction` (or `routeSecurityRefusal`) in the same request; a browser-only check against the verify endpoint is not a confirmation. Which actions are tier C is decided by `SENSITIVE_ACTIONS` and the board, not by the component. Clients, cleaners, laundry and QA portals use A and B only.
- **Reasons** only where the record keeps a history someone else reads later (voids, credit-note voids, the reconciled Xero void, laundry void and undo void, a decided pay amount, deleting an approval record, a damage void): `reason={{ choices: REASON_CHOICES.x }}` from `lib/confirmations/reasons.ts` (plain module, fixed in the product). Quick picks plus "Other…" with any non-empty text; never a minimum length. The server requires the same reason.
- **Extra optional fields** go under `details` ("Add details: …"), collapsed and kept mounted. A field the server requires stays visible (the Xero correction reference).
- **Failures** keep the dialog open with the reason, details and any form, clear the credential and say "It was not recorded" (or the action's equivalent) with the server's reason in words, never a raw code. Fields, reason and credential freeze while saving.
- Phone: a bottom sheet, Cancel as a text button above the full-width confirm, 44px targets, 16px inputs, the credential field kept above the keyboard.

## Tutorials and page tours (2026-11-16, boards "Tutorials", "Phone tours", "Admin tours", "Tutorials settings")

- A page with a tour keeps its tour current. Any visible change to it (a control added, moved, renamed or removed) updates the tour in the same change: new `version`, `since` on the changed steps, a release-note line, refreshed fingerprint. See AGENTS.md › Tutorials. The build test names the tour and says how to fix it.
- Mark a control as a tour target with `{...tourTarget("<id>")}` from `lib/tutorials/targets.ts` (plain module, safe in server pages). It adds only `data-tour`; never change a control's behaviour, label or accessible name to suit a tour. A control shown in a desktop and a phone variant may carry the same id on both.
- Steps: a 2 to 4 word title, at most 25 words, second person, one idea, the rule the system already enforces. The tip is a non-modal dialog ("Tour step 2 of 5"), Back / Next / Done, Skip tour, Don't show again; on phones a bottom card (a top card when the control is low). Reduced motion: nothing slides.
- Urgent work defers tours: mark it with `data-tour-busy="<reason>"` (the cleaner job sets `clock` while the clock runs) or an unsaved editor with `data-unsaved="true"`. Open dialogs and sheets pause a running tour automatically.
- Practice walkthroughs render the real components inside `PracticeBoundary` with sample records whose ids start `practice-` and whose names say "Practice". The guard stops every write in the browser (only the person's own tour progress passes). Never build a look-alike screen for practice.

