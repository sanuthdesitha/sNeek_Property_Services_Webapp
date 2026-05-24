# Accessibility baseline — `/` (home)

> **See also: [`a11y-full-report.md`](./a11y-full-report.md)** — auto-generated
> by `e2e/audit/a11y-all-routes.spec.ts` across all 10 audit routes. The
> per-rule, per-route breakdown of every axe violation lives there.

## Update — 2026-05-24 (Plan G fix-loop)

- **Pinch-zoom enabled.** Removed `maximumScale: 1` from
  `app/layout.tsx` (`Viewport`) — this fixed 6 of the 7 moderate-impact
  `meta-viewport` findings (`/admin/jobs`, `/admin/calendar`,
  `/admin/quotes`, `/admin/settings`, `/admin/system/uploads`,
  `/admin/system/email`).
- **Email-system heading order fixed.** `app/admin/system/email/page.tsx`
  was rendering `<h1>` then `<CardTitle>` (default `<h3>`), skipping h2.
  Replaced two `CardTitle` calls with explicit `<h2>` to satisfy axe
  `heading-order`.

**Open backlog (Plan G follow-up, not single-line fixes):**

- `button-name` cluster on `/admin/settings` (103 nodes) and
  `/admin/jobs` (3 nodes) — likely icon-only buttons that need
  `aria-label`. Needs design + per-button review.
- `label` cluster on `/admin/settings` (37 nodes) — form controls
  without associated `<label>`. Needs the Settings form components
  audited individually.
- Global `button-name` finding (1 node) appearing on most admin routes —
  almost certainly the Radix Toast `Close` button at the document root.
  Patch `components/ui/toast.tsx` to add an `sr-only` "Close" label
  inside the Close button (mirrors Plan A baseline guidance).
- Global pattern: `CardTitle` defaults to `<h3>` in `components/ui/card.tsx`.
  Pages using `<h1>` then `CardTitle` skip `<h2>`. Either add an `as` prop
  to `CardTitle` or change the default to `<h2>`. Then audit
  pages that may now render multiple h2's.



Captured 2026-05-24 via `e2e/foundation/home-a11y.spec.ts` (axe-core 4.11, chromium-desktop, viewport 1440x900).

The test runs as a `expect.soft` baseline in Plan A. **Plan G owns driving these to zero** and flipping the assertion to a hard `expect`.

## Update — 2026-05-24 (Plan B)

The `aria-progressbar-name` (serious) violation has been resolved by Plan B Task 14 — `components/ui/progress.tsx` now requires either `label` or `aria-label` and explicitly sets `role="progressbar"` and `aria-label` on the Radix Root. Remaining violations from the original baseline (button-name, color-contrast on marketing surfaces) are still scoped to Plan G.

## Blocking violations on `/` (critical + serious)

| Rule | Impact | Nodes | Notes |
|---|---|---|---|
| `aria-progressbar-name` | serious | 1 | `<div role="progressbar">` inside an indeterminate `Progress` component (Radix) is missing an accessible name. Add `aria-label` or `aria-labelledby`. Target: `.bg-secondary` (Radix Progress root). |
| `button-name` | critical | 1 | Toast close button has no discernible text. `<button toast-close>` from `radix-toast` lacks `aria-label`. Target: `.right-2.top-…` inside the toast viewport. |
| `color-contrast` | serious | 9 | See breakdown below. |

### `color-contrast` breakdown (9 nodes)

1. **WhatsApp CTA** — white on `#25D366`, contrast 1.98 (need 4.5). Two instances (hero CTA and persistent floating button). Class: `bg-[#25D366]` with `text-white`.
2. **Footer label captions** — `text-white/40` (`#6D7B7F`) on dark footer bg `#0C2329`, contrast 3.71. Three instances: "Services", "Quick Links", "Get in Touch" section headers.
3. **Footer hours line** — `text-white/40` on `#0C2329`, contrast 3.71. "Mon-Sat: 7am - 6pm".
4. **Footer legal line** — `#617074` on `#0C2329`, contrast 3.16. Two spans: copyright and "Built in Parramatta, NSW".
5. **"Chat on WhatsApp" label** — white on `#25D366`, contrast 1.98 (subset of WhatsApp CTA).

## Suggested Plan G fixes

- Add `aria-label="Loading"` (or similar) to indeterminate `Progress` instances.
- Patch `components/ui/toast.tsx` (Radix Toast `Close`) to include a visually-hidden label, e.g. `<span className="sr-only">Close</span>`.
- WhatsApp brand green `#25D366` on white text fails AA. Options: darken to `#1FA855` (passes 4.5:1), use a darker outline variant, or use dark text on the green pill.
- Lift footer text opacity from `text-white/40` to at least `text-white/60` (passes 4.5:1 on `#0C2329`); same for the `#617074` legal text — bump to `~#8A989C`.

## Files implicated

- `components/ui/progress.tsx` (or wherever Radix `Progress` is wrapped)
- `components/ui/toast.tsx` (or `components/ui/toaster.tsx`)
- `components/marketing/footer*.tsx`
- Hero / WhatsApp CTA components on `app/page.tsx`
