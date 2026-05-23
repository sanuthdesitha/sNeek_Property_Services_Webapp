# Accessibility baseline — `/` (home)

Captured 2026-05-24 via `e2e/foundation/home-a11y.spec.ts` (axe-core 4.11, chromium-desktop, viewport 1440x900).

The test runs as a `expect.soft` baseline in Plan A. **Plan G owns driving these to zero** and flipping the assertion to a hard `expect`.

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
