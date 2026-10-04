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
