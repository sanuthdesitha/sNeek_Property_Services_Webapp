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
