# Foundation Phase — Design System v2 + Cross-Cutting Infra Fixes

**Date:** 2026-05-23
**Status:** Draft, awaiting user review
**Scope:** F1 (design system) + F2 (cross-cutting infrastructure fixes)
**Out of scope (later phases):** F3 multi-cleaning-type taxonomy and V1–V14 vertical redesigns

This is sub-project #1 of a ~17-phase rebuild. It establishes the visual language and shared infrastructure every later phase will inherit. Nothing in this phase ships a "redesigned Dashboard" or "new QA portal" — those land in V2/V4/etc., reskinning onto the system this spec defines.

---

## 1. Goals and non-goals

### Goals

1. Replace the current "warm cream + amber accent + decorative motion" aesthetic with a denser, more confident, industry-credible design language that holds up next to Jobber, ServiceTitan, Linear, and Stripe.
2. Define one canonical set of tokens (colors, typography, spacing, radii, shadows, motion) consumed by every portal (`admin`, `cleaner`, `client`, `laundry`, future `qa`) and the public marketing site.
3. Ship a primitive component library on top of shadcn/ui (already installed) with the new tokens applied — buttons, inputs, tables, cards, dialogs, status pills, empty/loading/error states, toasts, nav.
4. Fix the cross-cutting bugs you mentioned: Google Maps autocomplete missing, live cleaner GPS broken, photo uploads unreliable, emails not sending, floating buttons misaligned, dead links.
5. Set the rules so every future phase doesn't have to re-litigate FAB position, table density, or modal scroll behavior.

### Non-goals (deferred to later phases)

- Page-level redesigns (Dashboard, Jobs, Ops, Schedule, Calendar, Cases, Laundry, Inventory, Workforce, Accounts, Clients, Properties, Messages, Quotes, Invoices, Finance, Payroll, Reports, Marketing, Settings) — all live in V4–V14
- QA inspector role and workflow — V2
- Multi-cleaning-type taxonomy and per-type forms — F3 and V1
- Report template editor — V3
- Marketing engine — V13
- Cleaner performance page — V8

---

## 2. Design language

### 2.1 Brand personality

| Trait | What it means |
|---|---|
| **Trustworthy** | Clients pay $150–$800 per clean; cleaners rely on us for income. The interface must feel safe, accurate, current. |
| **Calm** | Ops people sit in this app 8 hours a day. No vibrating colors, no unnecessary motion. |
| **Industry-credible** | This is a serious business platform, not a consumer toy. Sober palette, dense data display, professional typography. |
| **Australia-flavored** | The brand is Australian. Subtle — not flags or stereotypes — but a slightly warmer, less corporate temperature than a generic SaaS. |
| **Cleaner-friendly on phones** | The cleaner portal is the most-used surface. It must feel fast, glanceable, gloved-thumb-safe (large tap targets), and readable in bright outdoor light. |

### 2.2 Reference benchmarks

- **Linear** — density and keyboard-first ops
- **Jobber** — field-services warmth and approachability
- **Stripe** — financial clarity and data treatment
- **ServiceTitan** — operations dashboard patterns
- **Apple Photos** — large-image treatment in reports

Not copying. Channeling.

---

## 3. Color system

### 3.1 Why we're changing the current palette

Current state: brand teal (#0E7C9A-ish, HSL 188 78% 30%), cream background (HSL 44 48% 97%), warm amber accent, decorative radial gradients on every page. The cream + gradient combo reads "wellness boutique" — fine for the public marketing site, weak for an ops dashboard. The teal is good and we keep it. The cream goes for portal surfaces; the gradients go everywhere except marketing.

### 3.2 New token system

All colors expressed as HSL CSS variables in `app/globals.css`, scoped per `[data-portal-theme]`. Tailwind already consumes these — no Tailwind config rewrite needed beyond brand scale.

**Light (default for admin, client, public marketing):**

| Token | HSL | Hex (approx) | Use |
|---|---|---|---|
| `--bg` | 210 20% 98% | #F7F9FB | Page background — cool near-white, replaces cream |
| `--surface` | 0 0% 100% | #FFFFFF | Cards, panels, table rows |
| `--surface-raised` | 210 20% 96% | #F0F4F7 | Sidebar, secondary surfaces |
| `--border` | 214 15% 88% | #DCE2E8 | Hairlines |
| `--border-strong` | 214 15% 78% | #B9C3CC | Inputs at rest |
| `--text` | 215 28% 14% | #1A2330 | Body text |
| `--text-muted` | 215 12% 45% | #67717E | Secondary text |
| `--text-subtle` | 215 10% 60% | #899099 | Tertiary, helper text |
| `--primary` | 188 78% 30% | #0E7C9A | **Kept from current** — brand teal |
| `--primary-hover` | 188 78% 25% | #0B677F | Hover state |
| `--primary-soft` | 188 60% 94% | #DDF1F6 | Tinted backgrounds for primary chips |
| `--accent` | 35 95% 50% | #F58A0C | Amber, used sparingly for CTAs and highlights |
| `--success` | 152 62% 38% | #25A871 | Green |
| `--warning` | 38 95% 50% | #F5A20C | Amber-yellow |
| `--danger` | 0 72% 52% | #E03131 | Red |
| `--info` | 212 80% 50% | #1A7AE0 | Blue |
| `--ring` | 188 78% 40% | #119DC4 | Focus ring (brighter than primary for visibility) |

**Dark (default for cleaner, laundry, QA portals; opt-in for admin):**

| Token | HSL | Hex | Use |
|---|---|---|---|
| `--bg` | 222 22% 9% | #0E121A | Page background |
| `--surface` | 222 18% 12% | #161B23 | Cards |
| `--surface-raised` | 222 16% 16% | #1F2530 | Sidebar |
| `--border` | 220 13% 22% | #313844 | Hairlines |
| `--text` | 210 22% 94% | #ECEFF3 | Body |
| `--text-muted` | 210 14% 65% | #969DA8 | Secondary |
| `--primary` | 185 68% 48% | #29B8CE | Brighter teal for AA contrast on dark |
| `--accent` | 38 95% 60% | #F8B541 | Amber, slightly lifted |
| `--success` | 152 55% 50% | #41C28E | |
| `--warning` | 38 95% 58% | #F7AE34 | |
| `--danger` | 0 70% 60% | #E55858 | |
| `--info` | 212 80% 60% | #4A9DEC | |

**Status color set** (used by pills, alerts, banners — semantic, never override per-page):

| Semantic | Light bg / fg | Dark bg / fg |
|---|---|---|
| Neutral | slate-100 / slate-700 | slate-800 / slate-200 |
| Info | blue-50 / blue-700 | blue-950 / blue-200 |
| Success | emerald-50 / emerald-700 | emerald-950 / emerald-200 |
| Warning | amber-50 / amber-800 | amber-950 / amber-200 |
| Danger | rose-50 / rose-700 | rose-950 / rose-200 |
| Primary | teal-50 / teal-800 | teal-950 / teal-200 |
| Accent | orange-50 / orange-800 | orange-950 / orange-200 |
| Purple (used for QA only) | violet-50 / violet-700 | violet-950 / violet-200 |

### 3.3 Removed

- Decorative radial gradients on `body` background (currently in `globals.css` lines 74–78) — **removed**. They fight data density.
- `glass-panel` frosted-glass component — **removed for portals**, **kept only for the public marketing hero**.
- Cream `44 48% 97%` body color — **removed**, replaced with cool near-white.

---

## 4. Typography

### 4.1 Fonts

| Role | Font | Source | Weights |
|---|---|---|---|
| UI / body | **Inter** (variable) | Already loaded as `--font-sans` via Next.js font system | 400, 500, 600, 700 |
| Display / page titles | **Inter Display** (variable) | Same Inter family, optical-sized display cut | 600, 700 |
| Numerals (finance, IDs) | **Inter** with `font-variant-numeric: tabular-nums` | — | — |
| Mono (IDs, timestamps, JSON) | **JetBrains Mono** | New, add via `next/font` | 400, 500 |

No new web fonts beyond JetBrains Mono. Inter is already in use.

### 4.2 Type scale (Major Third 1.25)

| Token | Size / line-height | Weight | Use |
|---|---|---|---|
| `text-2xs` | 11 / 14 | 500 | Pill/badge text, table micro labels |
| `text-xs` | 12 / 16 | 500 | Helper text, captions |
| `text-sm` | 13 / 18 | 400/500 | Dense tables, secondary UI |
| `text-base` | 14 / 20 | 400/500 | Default body, form inputs |
| `text-md` | 16 / 24 | 400/500 | Mobile body, comfortable reading |
| `text-lg` | 18 / 26 | 500 | Section headings, card titles |
| `text-xl` | 20 / 28 | 600 | Page subheadings |
| `text-2xl` | 24 / 30 | 600 | Page titles |
| `text-3xl` | 30 / 36 | 700 | Dashboard hero stats |
| `text-4xl` | 36 / 42 | 700 | Public site hero |
| `text-5xl` | 48 / 54 | 700 | Marketing display |

### 4.3 Rules

- Page titles are `text-2xl` not `text-3xl`. Density wins over drama.
- Numbers in finance tables, time logs, payroll: always `tabular-nums`.
- IDs (job number, invoice number, S3 keys): `font-mono text-xs`.
- No letter-spacing changes outside display headings.
- Truncate long names with `text-ellipsis`; full value in tooltip.
- **Remove generic copy you mentioned.** Editorial pass: every page title, empty state, and tooltip is reviewed in the V4 cluster against a copy guide we write in this phase (see §11).

---

## 5. Spacing, radii, shadows

### 5.1 Spacing

Tailwind's default 4px scale, used as-is. Layout rules:

- Page gutter: `px-6` desktop, `px-4` tablet, `px-4` mobile
- Stack rhythm: `gap-y-4` between sibling blocks, `gap-y-6` between sections
- Card padding: `p-4` mobile, `p-6` desktop
- Form row spacing: `space-y-4`
- Table row vertical padding: 8px (compact), 12px (default), 16px (comfortable) — see density modes §7

### 5.2 Radii

| Token | px | Use |
|---|---|---|
| `--radius-sm` | 4 | Pills, badges, inputs |
| `--radius` | 8 | Buttons, cards (default) |
| `--radius-lg` | 12 | Modals, large cards |
| `--radius-xl` | 16 | Hero cards, image frames |
| `--radius-full` | 9999 | Avatars, FABs |

**Change from current:** current `--radius: 0.9rem` (~14px) is unusually large — gives a "bubbly" feel. New default radius is 8px. Cards and modals go to 12px. Hero/marketing surfaces stay at 16px.

### 5.3 Shadows

Lifted from Tailwind defaults with one tweak:

| Token | Use |
|---|---|
| `shadow-xs` | Resting cards on `--bg` |
| `shadow-sm` | Buttons, hovered cards |
| `shadow-md` | Dropdowns, popovers |
| `shadow-lg` | Modals, drawers |
| `shadow-xl` | Toasts |
| `shadow-fab` | Custom: `0 8px 24px -8px hsl(var(--primary) / 0.35)` — for FABs |

---

## 6. Iconography and imagery

### 6.1 Icons

- **Library:** `lucide-react` (already installed, version 0.453). Single icon library, no mixing.
- **Sizes:** 14, 16, 20, 24 (px). 14 inside dense table rows, 16 default, 20 in nav, 24 in hero/empty states.
- **Stroke width:** 1.75 default (Lucide's default 2 is slightly thick at small sizes).
- **Color:** inherit `currentColor` from text.
- **Rule:** every action button has an icon + label (or icon + tooltip if compact). No icon-only buttons without `aria-label`.

### 6.2 Illustrations and empty states

- Build a small illustration set: 10–15 line-art SVGs (no clipart, no stock). Themes: empty inbox, no jobs, no properties, no QA reviews, payment paid, payment pending, GPS offline, upload failed, error fallback, success.
- Style: 2-color flat line art using `--text-muted` + `--primary`. ~120×120 px in cards, ~200×200 px on full-page empty states.
- Stored in `components/illustrations/`. Component per illustration so they're tree-shakeable.

### 6.3 Photography (public marketing only)

- Public site uses real photos of cleans + Australian properties (you provide). Min 2400px wide, JPG @ 80% quality, served via `next/image`.
- Portal areas use **no photographic imagery** except user-uploaded content (avatars, property hero, before/after).

---

## 7. Density modes

Three density modes selectable in user preferences. Stored on `User.uiDensity` (new enum field).

| Mode | Table row | Form input | Body font | Default for |
|---|---|---|---|---|
| **Compact** | 32 px | 32 px | 13 px | Admin, OPS_MANAGER |
| **Default** | 40 px | 40 px | 14 px | Client, QA |
| **Comfortable** | 48 px | 48 px | 16 px | Cleaner, Laundry (mobile portals) |

Implemented as a `data-density` attribute on the portal shell; CSS reads it. No per-component prop drilling.

---

## 8. Motion

### 8.1 Tokens

| Duration | Easing | Use |
|---|---|---|
| 120 ms | `ease-out` | Hover, focus, button state |
| 180 ms | `ease-out` | Tooltip, popover open |
| 240 ms | `cubic-bezier(0.2, 0.8, 0.2, 1)` | Modal, drawer open |
| 320 ms | same | Page transition, route fade |

### 8.2 Rules

- All animations respect `@media (prefers-reduced-motion: reduce)` — disabled.
- **Removed:** `animate-float-slow`, `animate-float-slower`, `animate-gentle-pulse`, `animate-marquee`, `scroll-reveal-*` decorative reveals. They live in marketing pages only and even there are halved in duration.
- Page route changes use a 240 ms fade-in on the main content area, no slide.
- Skeleton shimmer kept at 1.5 s — already good.

---

## 9. Component primitives

All built on shadcn/ui already in the project. We restyle, don't rebuild.

### 9.1 Buttons

Variants: `primary`, `secondary`, `ghost`, `outline`, `destructive`, `link`.
Sizes: `xs (24)`, `sm (32)`, `md (40)`, `lg (48)`, `icon` (square, matches height).

Rules:
- Loading state shows spinner left of label, disables click.
- Disabled state shows reduced opacity, no pointer events.
- Icon-only buttons MUST have `aria-label` and a tooltip.
- Default button in any form is `primary`. Cancel/dismiss is `ghost` or `outline`.

### 9.2 Inputs

- Text, number, email, password, search, tel — all the same height matching button size (default 40 px, compact 32 px).
- Leading/trailing icon slots.
- Inline error message below input, red border on `--danger`.
- Hint text below input, muted.
- One canonical `<FormField>` wrapper combining label + control + hint + error. Used everywhere.
- `<AddressAutocomplete>` (see §10.1) is a specialized input that uses the same wrapper.

### 9.3 Tables

- Built on `@tanstack/react-table` (already installed).
- Sticky header. Sticky first column on horizontal scroll.
- Sort, multi-column filter, column visibility toggle, column resize, row selection.
- Density driven by `data-density` attribute on the table root.
- Row hover lift: `bg-surface-raised`.
- Per-row actions: dropdown menu (kebab icon) on the right, never inline buttons (saves space, consistent UX).
- Empty state: full-row span with illustration + CTA.
- Pagination: cursor-style (Next/Prev + page size dropdown) for big tables; numeric paginator for small.
- Bulk actions: float a bar across the top when ≥1 row selected, with action buttons.

### 9.4 Status pills

```
<StatusPill variant="success">Completed</StatusPill>
```

Variants map to §3.2 status colors. Dot indicator on the left optional. Small (text-2xs) and default (text-xs) sizes.

### 9.5 Cards

Standard `<Card>` with optional `<CardHeader>`, `<CardTitle>`, `<CardDescription>`, `<CardContent>`, `<CardFooter>` — already in shadcn. Restyle:
- Background: `--surface`
- Border: 1px `--border` (not shadow-only — borders read crisper)
- Radius: 12 px
- Padding: 16 mobile, 24 desktop

### 9.6 Empty / loading / error states

Three canonical components:

- `<EmptyState illustration={...} title="..." body="..." action={<Button />} />`
- `<LoadingState />` — full-card or full-page skeleton, never a spinner alone
- `<ErrorState error={...} retry={...} />` — illustration + sanitized error + Retry + "Contact support" link

Every list and detail page MUST render one of these in the appropriate state. Audit catches missing ones.

### 9.7 Modals and drawers

- Modal: centered, `max-w-lg` default, `--radius-lg`, backdrop blur 4px + 50% dim, focus trapped, ESC closes, scroll locked.
- Drawer: right (admin) or bottom (mobile). `max-w-md` desktop. Same animation tokens.
- Nested modals forbidden. If two modals overlap on a flow, the design is wrong — redesign as wizard or in-place panel.

### 9.8 Toasts

- Position: bottom-right on desktop, top-center on mobile (won't fight bottom-nav or FAB).
- Auto-dismiss 5 s default, 0 (sticky) for errors.
- One queue, max 3 visible.

### 9.9 Floating action button (FAB)

Cross-cutting rule, fixes the misalignment you mentioned:

```
position: fixed
bottom: calc(env(safe-area-inset-bottom, 0) + 16px + bottom-nav-height)
right: calc(env(safe-area-inset-right, 0) + 16px)
size: 56px mobile, 48px desktop
shadow: shadow-fab
z-index: 40 (below modal 50, above bottom-nav 30)
```

Rules:
- **One FAB per screen maximum.**
- Hide when a soft keyboard is open (use `visualViewport` API).
- Hide when a modal is open.
- Tap target: minimum 48×48 even on desktop.
- Optional speed-dial expansion only if a screen genuinely has 2–4 primary actions; never on cleaner mobile (use bottom sheet picker instead).

### 9.10 Navigation

| Surface | Nav |
|---|---|
| Admin desktop | Left sidebar, collapsible to icon-only, with section groups. Top breadcrumb. Optional right rail for context (filters, history). |
| Cleaner mobile | Top bar (title + back) + 5-tab bottom nav (Jobs, Calendar, Hub, Profile, more). |
| Client mobile/web | Same shell as cleaner mobile on phone; sidebar on desktop. |
| Laundry mobile | Same as cleaner mobile. |
| QA portal (new in V2) | Same as cleaner mobile. Reuses shell, different routes. |
| Public marketing | Top bar nav, mobile hamburger. |

### 9.11 Command palette

New (admin + ops): `Cmd/Ctrl+K` opens command palette. Search across:
- All routes (e.g. "go to property X")
- All clients, properties, jobs by name/number
- Quick actions (e.g. "create job", "new quote")

Built on `cmdk` (small dep) + indexed via existing data. Lazy-loaded.

### 9.12 Keyboard shortcuts

| Key | Action | Where |
|---|---|---|
| `?` | Show shortcut sheet | Anywhere |
| `Cmd/Ctrl+K` | Command palette | Admin/Ops |
| `J` / `K` | Next / prev row in tables | Lists |
| `Enter` | Open selected row | Lists |
| `Esc` | Close modal / blur input | Anywhere |
| `G` then `D` | Go to Dashboard | Admin |
| `G` then `J` | Go to Jobs | Admin |
| `C` | Create (context-sensitive: new job on Jobs, new client on Clients) | Lists |

Shortcut handler is a single global hook; pages register their context.

---

## 10. Cross-cutting infrastructure fixes (F2)

### 10.1 Google Maps address autocomplete

**Problem:** addresses entered as free text across register, properties, quotes, jobs, profile — no validation, lots of typos, no geocoding.

**Solution:**

- New component `components/ui/address-autocomplete.tsx` using **Google Places Autocomplete (New)** via the JS SDK.
- API key: `GOOGLE_MAPS_API_KEY` (server-side) and `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` (HTTP-referrer-restricted to our domains).
- Returns a normalized `AddressResult`:
  ```ts
  {
    formattedAddress: string,
    streetNumber?: string, route?: string, unit?: string,
    suburb?: string, state?: string, postcode?: string, country: string,
    lat: number, lng: number,
    placeId: string
  }
  ```
- Used in: register, profile (User + Client), Property create/edit, Quote create, Job create, Lead form on public site.
- Stored on the existing `Property.address` (string) plus new columns `Property.latitude`, `Property.longitude`, `Property.placeId`, `Property.suburb`, `Property.state`, `Property.postcode`. Same set of new columns added to `User` (cleaner home address for routing/payroll) and `Client` (billing address). Backfill best-effort by re-geocoding existing addresses.
- Australian bias: `componentRestrictions: { country: 'au' }`.
- Fallback: if API rate-limited or offline, free-text input is preserved; lat/lng become null and a "verify address" task is enqueued.

### 10.2 Photo and video upload reliability

**Problem:** uploads "sometimes don't work."

**Audit first** (before fixing):
- Inspect existing `/api/uploads/presign` and the client-side uploader.
- Add structured logging to count: presign request, upload start, upload progress, upload complete, upload fail, retry.
- Surface failed uploads in a new admin page `/admin/system/uploads` (read-only, by date).

**Improvements:**
- **Client-side compression** before upload: `browser-image-compression` for images (max 2400px, 80% quality, target ≤800 KB); reuse existing FFmpeg pipeline server-side for video, but add a client-side `<video>` size check first and warn if >100 MB.
- **Resumable / chunked** upload for files > 10 MB using S3 multipart with presigned part URLs. New endpoint `POST /api/uploads/presign-multipart`.
- **Retry**: 3 attempts with exponential backoff on network failures (not on 4xx).
- **Progress UI**: real percent + bytes/sec + ETA. Falls back to indeterminate if `Content-Length` unknown.
- **Drafts pane**: if a user navigates away mid-upload, queue persists in IndexedDB and resumes on return. Visible in a "drafts" pill in the top bar.
- **Failure record**: new model `UploadFailure` (id, userId, jobId nullable, filename, size, mime, reason, stack, occurredAt, resolved). Surfaced to admin.

### 10.3 Email deliverability

**Audit first**:
- Verify DNS for the sending domain has SPF, DKIM, DMARC records aligned with Resend.
- Check `EMAIL_FROM` matches a Resend-verified sender.
- Pull Resend dashboard stats — bounce rate, complaint rate, delivery rate over last 30 days.

**Improvements:**
- Persist every send attempt to `NotificationLog` (already exists, audit fields).
- On bounce/complaint webhook from Resend, mark the recipient address `suppressed` (new field on `User.emailStatus` enum: `OK | SOFT_BOUNCE | HARD_BOUNCE | COMPLAINT | UNSUBSCRIBED`). Suppressed addresses skip non-transactional sends.
- Admin page `/admin/system/email` shows: 30-day funnel (sent / delivered / opened / bounced / complained), suppressed addresses, dead-letter queue for retried sends.
- Provider failover already exists for SMS (Twilio + Cellcast); we mirror it for email with a placeholder for a secondary provider (Postmark or SES), behind a flag, off by default.

### 10.4 Live cleaner GPS tracking

**Problem:** "live tracking is not working, I cannot see exact pinpoint of each cleaner when they started the job."

**Audit first:**
- Confirm `CleanerLocationPing` writes are happening. If yes, find out why `/admin/ops/map` isn't reading them.
- Likely causes (ordered by probability):
  1. Cleaner browser denied geolocation permission and we silently swallowed.
  2. We only ping while a job is "in progress"; status transitions are flaky.
  3. The map page renders once and never re-queries.
  4. The map query window is too short (only "last 5 min") so off-screen cleaners disappear.

**Solution:**

- **Cleaner portal**:
  - On job start, prompt for `geolocation` permission with clear copy. If denied, show a persistent banner "Live tracking off — your manager can't see your location." No silent fail.
  - Use `navigator.geolocation.watchPosition` with `enableHighAccuracy: true`, `maximumAge: 0`, `timeout: 15000`.
  - Batch pings: throw them in a queue, POST every 30 s. If offline, persist to IndexedDB and flush on reconnect.
  - PWA permission for background — flag as "best effort"; not all browsers support background geolocation reliably. Document limitations to the user.
- **Server**:
  - `POST /api/cleaner/location/ping` accepts an array of pings (batched). Validates each, writes to `CleanerLocationPing`. Already partly there; harden it.
  - `GET /api/admin/ops/live-locations` returns the latest ping per active cleaner in the last 15 min, with `lastSeenAt`, `accuracy`, `batteryLevel?`, `headingDeg?`, current job ID if any.
- **Admin map page** (`/admin/ops/map`):
  - Subscribe via Server-Sent Events (`GET /api/admin/ops/live-locations/stream`) — re-broadcasts new pings as they arrive.
  - Render cleaner markers with: avatar pin, accuracy circle, "last seen N min ago" if stale (>2 min show amber, >10 min show red).
  - Click a marker for: name, current job, ETA to job site (if not yet arrived), battery, signal age, time on site so far.
  - Toggle: show all cleaners, only on-job, only idle.
- **Geofencing** (small bonus, fits this phase): each `Property` has lat/lng (from §10.1). When a cleaner's ping lands within 75 m of a property tied to a current job, auto-log `arrivedAt` on `TimeLog`. Equivalent for `departedAt`. Settable threshold in admin settings.
- **Retention**: existing 7-day pruning kept. Adds `lastSeenAt` denormalized column on `User` for fast lookup so the map doesn't full-scan the ping table.

### 10.5 Broken-link sweep

- One-off script `scripts/audit/broken-links.ts` that:
  - Logs in as each role (using bootstrap accounts or seed data).
  - BFS-crawls every internal `Link` and `a[href^="/"]` to depth 5.
  - Records 404, 500, redirect-loop, "page renders but main content is null".
- Output: `docs/audits/broken-links-report.md` with line-and-file citations from React component tree.
- Each broken link gets a fix or removal; report is checked back in until empty.

### 10.6 Floating button + layout alignment audit

- Manual + scripted pass:
  - Screenshot every route in 3 viewports (390×844 mobile, 1024×768 tablet, 1440×900 desktop) using Playwright (already in deps).
  - Tag issues: misaligned FAB, content under FAB, modal scroll-lock conflict, sticky header overlap, table horizontal-overflow, button text overflow, focus ring clipped.
- Findings file: `docs/audits/layout-findings.md`.
- Each finding mapped to a fix that lands either in §9 primitives (if global) or queued for the relevant vertical phase (V4–V14).

---

## 11. Copy and editorial

You called out that screens have "unnecessary generic writings." This phase produces a **copy guide** that every later phase enforces:

- **Voice**: clear, concrete, kind. No marketing fluff inside the portals. (Marketing site copy lives separately and may be punchier.)
- **Banned phrases**: "Welcome to your dashboard", "Get started in seconds", "Powered by …", "Helpful tips", "Made with love." Replace with the actual capability the page provides.
- **Empty state copy** is one short sentence describing what would appear here, plus a CTA. Example: "No jobs scheduled this week. Create one or check tomorrow." not "Looks like you don't have any jobs yet — let's get you started!"
- **Buttons**: imperative verbs only. "Save changes", "Send quote", "Mark complete", "Cancel". Never "OK", "Submit", "Click here."
- **Errors**: tell the user what happened and what they can do. Bad: "An error occurred." Good: "Couldn't reach the server — check your connection and tap Retry."
- **Numerals**: use real numbers, not words. "3 jobs", not "three jobs."
- **Dates/times** in Sydney unless user is in a different timezone (rare); display as `Tue 24 Nov, 09:30`, never `2026-11-24T09:30:00+11:00`.
- **Money** as `$1,250.00 AUD` in finance contexts; `$1,250` in dashboards.

Lives at `docs/style/copy-guide.md`, committed in this phase.

---

## 12. File and directory plan

New / modified locations:

```
app/globals.css                       (rewritten — new tokens)
tailwind.config.ts                    (extended — new utilities)
components/
  ui/                                 (shadcn primitives, restyled)
  ui/address-autocomplete.tsx         (new)
  ui/empty-state.tsx                  (new)
  ui/error-state.tsx                  (new)
  ui/loading-state.tsx                (new)
  ui/status-pill.tsx                  (new)
  ui/form-field.tsx                   (new)
  illustrations/                      (new, 15 SVG components)
  shell/                              (portal shells, restyled)
  command-palette/                    (new, cmdk-based)
lib/
  google-maps/client.ts               (new, JS SDK wrapper)
  uploads/multipart-client.ts         (new, S3 multipart on browser)
  uploads/draft-store.ts              (new, IndexedDB)
  email/audit.ts                      (new)
  gps/                                (new, geofence + batching)
hooks/
  use-keyboard-shortcuts.ts           (new global)
  use-density.ts                      (new)
prisma/schema.prisma                  (new fields: lat/lng/placeId/suburb/state/postcode on
                                       Property, User, Client; User.uiDensity, User.emailStatus,
                                       User.lastSeenAt; new UploadFailure model)
prisma/migrations/2026_05_xx_…       (new migration)
scripts/audit/broken-links.ts         (new)
scripts/audit/screenshot-routes.ts    (new)
docs/audits/broken-links-report.md    (new, regenerated)
docs/audits/layout-findings.md        (new)
docs/style/copy-guide.md              (new)
docs/style/design-tokens.md           (new — single source of truth for tokens)
```

---

## 13. Migration strategy

This phase changes shared tokens that every page consumes. Two options:

### Option A (recommended): in-place token swap, big bang

Change CSS variables in `globals.css`. Every page using `bg-card`, `text-foreground`, etc. picks up the new look instantly. Replace primitives (`Button`, `Input`, `Card`) in `components/ui/*` — every consumer picks up the new style.

**Pros:** one PR, no flag spaghetti, no two-design-system maintenance window.
**Cons:** if anything is off, it's off everywhere until fixed. Need to do this in a dedicated branch with a thorough screenshot diff before merge.

### Option B: per-portal opt-in

New tokens behind a `[data-design-system="v2"]` flag, applied progressively per portal.

**Pros:** safer rollback.
**Cons:** doubles maintenance until done; design-system-version skew between portals confuses reviewers.

**Pick A.** A is what every mature SaaS does for a token swap when the component API doesn't change.

---

## 14. Testing and verification

- **Visual regression**: Playwright screenshot suite covering 30–40 representative routes × 3 viewports × light/dark. Baseline before change, diff after. Stored in `tests/visual/`.
- **Accessibility**: `@axe-core/playwright` run on each screenshot route, fail build on serious/critical violations.
- **Lighthouse**: every public marketing page + admin Dashboard + cleaner Jobs page must score ≥ 90 Performance, ≥ 95 Accessibility on mobile.
- **Manual QA** by you: a checklist of "every screen looks right in light and dark, on mobile and desktop, with no overflow."
- **Smoke tests** for F2 fixes:
  - Address autocomplete returns lat/lng on a known AU address.
  - Photo upload completes on a 25 MB file with simulated 3G + one disconnect mid-upload.
  - Email send is logged + suppression list rejects subsequent sends to a hard-bounced address.
  - GPS map shows the seeded test cleaner moving every 30 s.
  - Broken-link script reports zero broken links.

---

## 15. Risks and open questions

| # | Risk / question | Resolution |
|---|---|---|
| 1 | Token swap (big bang) lands ugly somewhere we didn't screenshot. | Screenshot suite + manual QA gates merge. |
| 2 | Google Maps API cost. | Restrict browser key to our domains, server-cache geocoding by `placeId`, set Google billing quota alarm. Budget assumption: < $20 AUD/mo at current volumes. |
| 3 | Cleaner browsers refuse geolocation on iOS Safari in PWA mode. | Documented limitation; fall back to manual "I've arrived" button on the job screen. |
| 4 | shadcn/ui future updates may overwrite our restyles. | Keep our overrides in `components/ui/*` files (already shadcn pattern — local copy, not a package); we own them. |
| 5 | Inter Display variable cut adds ~50 KB. | Self-host via `next/font` so it's only loaded once and subset to the characters we use. |
| 6 | Multipart upload introduces new failure modes. | Feature-flag it; default to single-PUT for files < 10 MB. |
| 7 | Decorative animations removed — public marketing site may lose "personality." | Marketing pages keep their motion (it's a sales surface). Portals lose it. |
| 8 | Density preference per user adds DB writes on settings change. | Trivial — single column on User. |
| 9 | Email failover provider not chosen (Postmark vs SES). | Out of scope this phase; flag is off. We pick in V12 when finance/notifications are touched. |
| 10 | We haven't agreed on a primary brand teal vs going darker / changing hue. | I'm keeping the current teal (HSL 188 78% 30%). It's already in your logo and PWA manifest. Changing it ripples to assets you've already printed/published. If you want a different hue, raise it on spec review. |

---

## 16. Acceptance criteria

This phase is done when:

1. New `globals.css` + Tailwind config land; every existing page renders without visual breakage worse than the screenshot baseline allows.
2. shadcn primitives in `components/ui/*` use new tokens; restyled with new radii, shadows, motion.
3. `<AddressAutocomplete>` exists and is wired into register, profile (User + Client), Property create/edit, Quote create, Job create, Lead form.
4. Photo upload: multipart + retry + IndexedDB drafts + progress UI shipped; `UploadFailure` model and admin page live.
5. Email: DNS verified, suppression list active, `/admin/system/email` page live.
6. GPS: cleaner batched pings + admin SSE map with live markers + geofence arrival/departure shipped.
7. Broken-links report = 0.
8. Layout findings file = 0 critical, < 5 nice-to-have.
9. Visual regression suite green; axe a11y suite green; Lighthouse thresholds met on the 3 reference pages.
10. Density preference + dark mode toggle in user settings, persistence to DB, live application.
11. Copy guide + design tokens doc committed.
12. Google Maps billing quota + alert configured in Google Cloud console; documented in repo `docs/ops/google-maps.md`.

Once all 12 acceptance points hit, the foundation is "done" and we open sub-project #2 (F3 multi-cleaning-type taxonomy).

---

## 17. What happens next

On your approval of this spec:

1. I invoke the writing-plans skill to break this into a per-PR implementation plan with ordering and dependencies.
2. We agree on whether to land this as one mega-PR (matches Option A above) or 5–6 sequential PRs (palette → primitives → infra fixes → audits → cleanup).
3. Implementation begins. Each PR has a screenshot diff and acceptance-criterion checklist.

If you want changes — any decision in this doc you'd flip — flag them now and I revise before we start.
