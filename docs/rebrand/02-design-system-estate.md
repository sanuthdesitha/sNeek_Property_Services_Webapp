# Rebrand Doc 02 — "ESTATE" Design System Specification

> Planning report (Fable 5, 2026-07-04). Full luxury rebrand spec for Next.js 14 + Tailwind + shadcn/ui. See `00-MASTER-PLAN.md` for the synthesis.

## 0. Current-state audit (what we're replacing)

| Layer | Today | Verdict |
|---|---|---|
| Color | Teal primary `hsl(188 78% 30%)`, amber accent, Apple-neutral zinc greys, cool `240`-hue surfaces | Competent but generic SaaS; teal+amber reads "utility," not luxury |
| Type | Inter everywhere; Cormorant Garamond scoped to `.marketing-only h1/h2` only | Serif is quarantined to marketing; app has zero brand voice |
| Radii | 8/10/14/20px, `rounded-2xl` KPI tiles | Soft/bubbly — reads consumer app, not estate |
| Shadows | 3-step neutral elevation | Fine, but untinted and flat |
| Motion | Good bones (`lux-rise`, `cubic-bezier(0.16,1,0.3,1)`) but only on marketing | Extend system-wide, tokenize |
| Portals | `data-portal-theme="light|dark|public"` attribute overrides — solid architecture | **Keep this mechanism**, re-skin the values, add per-portal accent layer |
| Charts | `use-chart-colors.ts` reads live tokens; series palette includes hardcoded purple/pink | Keep the token-reading pattern; replace palette |

The `data-portal-theme` override architecture and the token-reading chart hook are the two things worth preserving unchanged. Everything visual gets new values.

## 1. BRAND DIRECTION

### Candidate A — **"Estate"** ✦ RECOMMENDED
**Deep estate green · champagne · ivory · serif-accented**

- **Palette**: Deep bottle-green ink (`#1E4A3B`), champagne gold (`#C0A265`), warm ivory (`#FAF7F0`), charcoal-green text (`#17251F`).
- **Rationale**: The visual language of premium *property* — Sotheby's Realty, Aesop retail, boutique hotel keycards. Green signals grounds, care, cleanliness-as-stewardship ("we keep your asset pristine"), mapping exactly to Airbnb/end-of-lease ops. Champagne gives the money/valuation register without full gold-leaf. Works **light-mode-first** — admins and cleaners use this 8h/day in daylight; an ivory-paper workspace with a deep-green rail is calm at density. Most *sellable* as white-label SaaS: green+gold is instantly "premium services vertical" and the accent layer swaps cleanly per tenant.
- **Risk**: green is used by landscaping/eco brands — mitigated by the champagne pairing and serif typography.

### Candidate B — "Obsidian"
Near-black `#0E1114`, warm gold `#D3B577`, porcelain `#F5F2EC`. Rolex-box, private-members-club energy. Spectacular for marketing/login; **fails as a daily ops workspace** (dark-first data tables at 9am, gold-on-dark contrast management on every semantic state, PDF/print inversion cost). Verdict: don't lead with it — **steal it** as Estate's dark mode and "ceremony" surfaces (login, PDF covers, boot screen).

### Candidate C — "Linen"
Warm neutrals `#F6F1E9`, charcoal `#26221C`, brass `#9A7B4F`, no chromatic brand hue. Kinfolk/The Row minimalism. Safest and most timeless, but with 6 portals + 12 job statuses + charts, a hueless brand leaves no room for the semantic system — statuses end up carrying all the color and the brand disappears. Verdict: beautiful but under-powered for an ops platform.

### → Recommendation: **Estate**, with Obsidian as its dark mode and ceremonial register, and Linen's warm-neutral discipline governing the grey scale (all neutrals warm-cast; the cool `240`-hue zinc greys fully retired).

### 1.1 Portal accent identities (all inside one mineral family)

Each portal keeps the identical Estate shell and gets **one accent token** driving: sidebar active state, focus ring, KPI icon tint, chart series[0], avatar ring, and the 2px "portal signature" hairline under the page header:

| Portal | Accent | Light value | Dark value | Logic |
|---|---|---|---|---|
| **Admin** | Estate Green | `#1E4A3B` · `158 42% 20%` | `#4E9C7E` · `158 34% 46%` | The brand itself |
| **Client** | Champagne | `#8A6B33` · `39 46% 37%` (ink) / `#C0A265` decor | `#CDB077` · `39 45% 64%` | Guest-facing, money-facing |
| **Cleaner** | Copper | `#9C5B33` · `23 51% 41%` | `#C98B62` · `23 48% 59%` | Warm, field-work, glanceable on mobile |
| **Laundry** | Delft | `#3E6B8C` · `205 39% 40%` | `#7BA6C4` · `205 39% 63%` | Water/porcelain blue |
| **QA** | Aubergine | `#5E4368` · `284 22% 34%` | `#A588B0` · `284 21% 61%` | Inspection, ink-stamp |
| **Maintenance** | Steel | `#4A5A66` · `206 16% 35%` | `#8FA3B0` · `206 17% 63%` | Tooling, metal |

Implementation: extend the attribute to `data-portal-theme="light" data-portal-accent="cleaner"`; the accent attribute overrides only `--accent-portal`, `--accent-portal-foreground`, `--accent-portal-soft`, `--ring`. **This is the SaaS story**: a tenant rebrand = swap 6 accent triplets + logo.

### 1.2 Public site vs app

| | Public marketing | Portals (app) |
|---|---|---|
| Ground | Ivory `#FAF7F0` with faint champagne wash | Paper `#F7F4EE` bg, warm-white cards |
| Serif usage | Headlines h1–h3, pull quotes, price numerals — full editorial voice | **Rationed**: page `<h1>`, stat numerals, empty-state titles, dialog ceremony titles only |
| Density | Airy — 96–128px sections, max 68ch prose | Working — 16/24px card padding, comfortable/compact modes |
| Motion | Slow editorial (700–1100ms reveals) | Quick and assured (120–320ms), motion only on state change |
| Accent | Champagne + estate green only | Portal accent active |
| Dark | Obsidian editorial | Obsidian workspace |

## 2. TOKENS — full CSS variable sheet

Format preserved from today: space-separated HSL triplets consumed as `hsl(var(--x))` — the entire Tailwind config keeps working.

### 2.1 Core neutrals & surfaces — LIGHT (Estate Paper)

```css
:root, [data-portal-theme="light"] {
  /* ── Ground & surfaces (warm hue 40–45, replacing cool 240) ── */
  --background:        40 30% 96%;   /* #F7F4EE  paper */
  --foreground:        160 18% 12%;  /* #19241F  green-black ink */
  --surface:           40 40% 99%;   /* #FEFDFA  warm white card */
  --surface-raised:    40 28% 94%;   /* #F2EEE6  inset wells, table headers */
  --surface-sunken:    40 24% 91%;   /* #ECE7DC  page-level wells */
  --card:              40 40% 99%;
  --card-foreground:   160 18% 12%;
  --popover:           40 40% 99%;
  --popover-foreground: 160 18% 12%;

  /* ── Text hierarchy ── */
  --text-primary:      160 18% 12%;  /* #19241F */
  --text-secondary:    160 8% 32%;   /* #4B5751 */
  --muted:             40 25% 93%;   /* #F0ECE3 */
  --muted-foreground:  160 6% 40%;   /* #606B66  ≥ 4.6:1 on paper */
  --text-faint:        160 5% 55%;   /* metadata, ≥3:1 — large/secondary only */

  /* ── Brand ── */
  --primary:           158 42% 20%;  /* #1E4A3B  estate green */
  --primary-foreground: 42 60% 96%;  /* #FAF4E7  champagne-white */
  --primary-soft:      158 30% 92%;  /* #E4EEE9  tint wells */
  --primary-hover:     158 42% 16%;  /* #17392E */

  /* Champagne — decorative gold vs readable gold-ink (CRITICAL split) */
  --gold:              41 42% 57%;   /* #C0A265  borders, icons, decor ≥3:1 */
  --gold-ink:          39 46% 33%;   /* #7B5F2E  gold TEXT on light, 4.9:1 */
  --gold-soft:         42 45% 92%;   /* #F3ECDC  champagne wash */
  --gold-foreground:   40 35% 14%;   /* on gold fills */

  --secondary:         40 25% 92%;   --secondary-foreground: 158 20% 18%;
  --accent:            42 45% 90%;   --accent-foreground: 39 46% 26%;

  /* ── Per-portal accent (overridden by data-portal-accent) ── */
  --accent-portal:            158 42% 20%;
  --accent-portal-foreground: 42 60% 96%;
  --accent-portal-soft:       158 30% 92%;

  /* ── Semantic states (warm-shifted, desaturated) ── */
  --success:           152 40% 30%;  /* #2E6B50 */ --success-foreground: 150 40% 96%;
  --success-soft:      152 32% 91%;
  --warning:           36 74% 38%;   /* #A96F19 amber-bronze */ --warning-foreground: 36 80% 96%;
  --warning-soft:      38 65% 91%;
  --danger:            5 58% 42%;    /* #A93A2D brick */
  --destructive:       5 58% 42%;    --destructive-foreground: 10 60% 97%;
  --danger-soft:       6 50% 93%;
  --info:              205 39% 38%;  /* #3B6787 */ --info-foreground: 205 50% 96%;
  --info-soft:         205 35% 92%;

  /* ── Hairlines ── */
  --border:            40 18% 86%;   /* #E2DCCF warm hairline */
  --border-strong:     40 14% 76%;   /* #C9C2B3 */
  --border-gold:       41 42% 57%;
  --input:             40 16% 82%;
  --ring:              158 42% 28%;  /* follows --accent-portal per portal */

  /* ── Sidebar (the green rail — every light portal) ── */
  --portal-sidebar-bg:        160 30% 11%;  /* #14241D near-black green */
  --portal-sidebar-fg:        42 25% 78%;   /* #D3CBB8 warm parchment */
  --portal-sidebar-active-bg: 42 45% 90%;   /* champagne plate */
  --portal-sidebar-active-fg: 158 42% 16%;
  --portal-sidebar-hairline:  158 15% 22%;

  /* ── Radii — squarer = more estate ── */
  --radius-xs: 4px;  --radius-sm: 6px;  --radius: 8px;
  --radius-lg: 12px; --radius-xl: 16px; --radius-pill: 9999px;

  /* ── Layered luxury shadows (green-tinted ambient + key) ── */
  --shadow-color: 158 30% 18%;
  --elevation-1: 0 1px 2px hsl(var(--shadow-color)/0.05),
                 0 0 0 1px hsl(var(--shadow-color)/0.03);
  --elevation-2: 0 1px 2px hsl(var(--shadow-color)/0.05),
                 0 4px 10px -2px hsl(var(--shadow-color)/0.07),
                 0 12px 24px -12px hsl(var(--shadow-color)/0.10);
  --elevation-3: 0 2px 4px hsl(var(--shadow-color)/0.06),
                 0 12px 28px -8px hsl(var(--shadow-color)/0.14),
                 0 32px 64px -24px hsl(var(--shadow-color)/0.20);
  --elevation-gold: 0 1px 0 hsl(var(--gold)/0.35) inset,
                    0 8px 24px -10px hsl(39 46% 33% / 0.25); /* ceremony surfaces */

  /* ── Motion ── */
  --dur-instant: 100ms; --dur-fast: 160ms; --dur-base: 240ms;
  --dur-slow: 400ms;    --dur-ceremony: 700ms; --dur-editorial: 1100ms;
  --ease-standard:  cubic-bezier(0.2, 0, 0, 1);       /* UI state changes */
  --ease-entrance:  cubic-bezier(0.16, 1, 0.3, 1);    /* things arriving (keep) */
  --ease-exit:      cubic-bezier(0.4, 0, 1, 1);       /* things leaving */
  --ease-spring:    cubic-bezier(0.34, 1.3, 0.64, 1); /* micro-confirmation only */

  /* ── Density (drives _density-shell.tsx) ── */
  --density-row-h: 48px; --density-cell-py: 12px; --density-card-p: 24px;
  --density-input-h: 40px; --density-gap: 16px;
}
[data-density="compact"] {
  --density-row-h: 36px; --density-cell-py: 6px; --density-card-p: 16px;
  --density-input-h: 34px; --density-gap: 10px;
}
```

### 2.2 DARK — "Obsidian" (portal dark + public dark)

```css
.dark, [data-portal-theme="dark"] {
  --background:        160 16% 6%;   /* #0D1210 obsidian-green black */
  --foreground:        42 28% 90%;   /* #EAE4D4 parchment */
  --surface:           158 13% 9%;   /* #141B18 */
  --surface-raised:    156 11% 13%;  /* #1E2622 */
  --surface-sunken:    160 16% 5%;
  --card: 158 13% 9%;  --card-foreground: 42 28% 90%;
  --popover: 156 12% 11%; --popover-foreground: 42 28% 90%;

  --muted: 156 10% 15%; --muted-foreground: 42 12% 64%;  /* #A9A392 ≥4.7:1 */
  --text-faint: 42 8% 52%;

  --primary:           158 32% 52%;  /* #59AE8C lifted green */
  --primary-foreground: 160 30% 8%;
  --primary-soft:      158 28% 16%;
  --gold:              41 46% 62%;   /* #CDB077 */
  --gold-ink:          41 52% 68%;   /* #D9BE85 — TEXT gold on dark, 8.1:1 */
  --gold-soft:         40 25% 15%;
  --secondary: 156 10% 17%; --secondary-foreground: 42 20% 86%;
  --accent: 40 25% 15%; --accent-foreground: 41 45% 72%;

  --success: 152 34% 52%; --success-soft: 152 28% 14%;
  --warning: 38 70% 58%;  --warning-soft: 38 40% 14%;
  --danger: 6 62% 60%; --destructive: 6 62% 60%; --danger-soft: 6 35% 14%;
  --info: 205 45% 60%; --info-soft: 205 30% 15%;

  --border: 156 10% 17%;      /* #262E2A */
  --border-strong: 154 9% 25%;
  --input: 156 10% 19%;
  --ring: 158 32% 56%;
  --shadow-color: 160 40% 2%;
  --elevation-gold: 0 1px 0 hsl(41 46% 62% / 0.25) inset,
                    0 12px 32px -12px hsl(0 0% 0% / 0.6);

  --portal-sidebar-bg: 160 18% 4%; --portal-sidebar-fg: 42 15% 62%;
  --portal-sidebar-active-bg: 41 46% 62%; --portal-sidebar-active-fg: 160 30% 8%;
}
```

### 2.3 Public marketing overrides

```css
[data-portal-theme="public"] {
  --background: 42 45% 97%;  /* #FBF8F1 ivory */
  --surface:    40 55% 99%;
  --border:     42 30% 87%;
  /* body wash: linear-gradient(180deg, hsl(42 50% 98%), hsl(40 36% 95%)) */
  /* hero deep panel: hsl(160 30% 10%) with --gold text */
}
```

### 2.4 Per-portal accent override blocks (example)

```css
[data-portal-accent="cleaner"] {
  --accent-portal: 23 51% 41%; --accent-portal-foreground: 24 60% 96%;
  --accent-portal-soft: 24 45% 92%; --ring: 23 51% 41%;
}
.dark [data-portal-accent="cleaner"] {
  --accent-portal: 23 48% 59%; --accent-portal-soft: 23 30% 15%; --ring: 23 48% 59%;
}
/* client: 39 46% 37% / dark 39 45% 64% · laundry: 205 39% 40% / 205 39% 63%
   qa: 284 22% 34% / 284 21% 61% · maintenance: 206 16% 35% / 206 17% 63%
   admin: inherits --primary */
```

### 2.5 Typography

| Role | Font | Why | Loading |
|---|---|---|---|
| **Display serif** | **Fraunces** (variable: `opsz 9–144`, `wght 300–700`) | Replaces Cormorant Garamond. Cormorant is gorgeous at 64px but anemic below 28px — Fraunces' optical-size axis stays luxurious at hero size *and* legible on a stat-card numeral at 22px. Self-hostable, one variable file. | `next/font/google` variable, `display: "swap"`, `variable: "--font-display-serif"` |
| **UI sans** | **Inter** (keep; enable `cv11`, `tnum` where numeric) | Best-in-class tabular numerals for ops tables | already wired |
| **Mono** | **JetBrains Mono** (keep) | invoice/job IDs, codes | already wired |
| Eyebrow/smallcaps | Inter 600, `letter-spacing: 0.28em`, uppercase, 11–12px | keep existing recipe, retint to `--gold-ink` | — |

**Numerals rule**: money and KPI values render in **Fraunces 500, `font-variant-numeric: lining-nums tabular-nums`** — this single move is 50% of the luxury read on dashboards. Table-body numbers stay Inter `tabular-nums`.

**Type scale**:

| Token | Size | LH | Face | Use |
|---|---|---|---|---|
| `display-2xl` | 4.5rem/72 | 1.02 | Fraunces 350, −0.5% | Public hero |
| `display-xl` | 3.5rem/56 | 1.06 | Fraunces 400 | Section heads |
| `display-lg` | 2.5rem/40 | 1.1 | Fraunces 450 | PDF covers, greeting |
| `display-md` | 2rem/32 | 1.15 | Fraunces 500 | Page `<h1>` in portals |
| `display-sm` | 1.5rem/24 | 1.2 | Fraunces 520 | Stat numerals, dialog ceremony |
| `title` | 1.125rem/18 | 1.35 | Inter 600, −1% | Card titles |
| `body` | 0.9375rem/15 | 1.55 | Inter 400 | default (up from 14 — luxury = legibility) |
| `body-sm` | 0.8125rem/13 | 1.5 | Inter 400 | table cells, meta |
| `label` | 0.75rem/12 | 1.35 | Inter 550, +2% | form labels, column heads |
| `eyebrow` | 0.6875rem/11 | 1.2 | Inter 600, +28%, caps | section markers |

**Spacing**: keep Tailwind's 4px grid; semantic tokens `--space-card: 24px`, `--space-section: 40px` (portal) / `clamp(64px, 9vw, 128px)` (public), `--space-page-x: 32px`, gutter `24px`. Rule: whitespace before decoration — when in doubt add 8px, not a border.

## 3. COMPONENT SYSTEM (~26 primitives)

Global principles: **hairline borders (1px `--border`) as the primary separator; shadows only for true elevation (popover/dialog/drag); radii down one notch from today; every interactive surface gets a `--dur-fast --ease-standard` transition; no pure grey — everything sits on the warm scale.**

1. **Button** — 8px radius. Default: `bg-primary` with `--elevation-1` + inner top-light; hover = `--primary-hover` (darken, not opacity). New **`variant="gold"`**: champagne fill, `--elevation-gold` — reserved for the single money action per screen (Send quote, Approve invoice). New **`variant="outline-gold"`** for secondary ceremony. Keep `active:scale-[0.98]`. Height from density token. Letter-spacing `+0.01em`, weight 550.
2. **Card** — 12px radius; `bg-surface`; hairline border; **kill hover shadows on static cards**. Add `<Card variant="ceremony">`: `--elevation-gold`, 1px `--border-gold/40` top hairline. Optional `eyebrow` prop above the title.
3. **StatCard / KpiTile** — flagship change: value in **Fraunces 500 at 28px, tabular**; label = eyebrow token; icon chip → 1px hairline ring circle with `--accent-portal` glyph; delta = plain text `+4.1%` with arrow, no pill; sparkline stroke = `--accent-portal`, 8% gradient fill.
4. **Table** — header `bg-surface-raised`, eyebrow-style column labels, **no vertical rules ever**; rows at density height, hairline separators, hover `bg-primary-soft/40`; numeric columns right-aligned `tabular-nums`; first-column entity names Inter 550. Selected row: 2px `--accent-portal` left rule + soft wash.
5. **Dialog** — overlay `hsl(160 30% 6% / 0.55)` + blur(6px); panel 16px radius, `--elevation-3`, and a **1px champagne top hairline** (gradient `transparent → gold/50 → transparent`) — the system's signature detail. Ceremony titles in Fraunces. Enter scale 0.97→1 fade.
6. **Drawer/Sheet** — full-height right panel, hairline left edge + `--elevation-3`; pinned header with eyebrow context ("JOB · #4821") above a Fraunces title; gold variant for the primary footer action.
7. **Tabs** — kill the filled-pill TabsList. Default: **underline tabs** — transparent list, bottom hairline; active = Inter 600 + 2px `--accent-portal` underline that **slides** between tabs. Keep `variant="enclosed"` for dense filters only.
8. **Badge / StatusPill** — unify: 1px hairline outline + 6px dot + text, pill radius, **no filled backgrounds** except `soft` variant. Status mapping: scheduled/assigned=primary, in-progress=info, QA=aubergine, done=success, blocked=danger, unassigned=warning, invoiced=gold-ink.
9. **Input / Textarea** — density height, hairline border, 6px radius; focus: border→`--ring` + `0 0 0 3px hsl(var(--ring)/0.15)` soft halo; placeholder `--text-faint`; error `--danger` border + halo.
10. **Select / Dropdown / Popover** — 12px panel radius, `--elevation-2`; item hover `--primary-soft/50`; checked item `--accent-portal` check; group labels = eyebrow.
11. **Toast** — bottom-right, obsidian panel in BOTH modes (the one always-dark element), parchment text, 3px semantic left rule; success gets the champagne top hairline; auto-dismiss = 1px gold line draining along the bottom.
12. **Skeleton** — warm shimmer: `--muted` → `--surface-raised` → gold-tinted highlight; match final layout including serif-height blocks.
13. **EmptyState** — hairline-ruled centered panel (no dashed borders): eyebrow, Fraunces title, one-line muted body, single action; thin-stroke line illustration in `--gold/60`.
14. **PageHeader** — drop the tinted icon chip. Anatomy: eyebrow context line → `<h1>` in Fraunces `display-md` → muted description → actions right. Below: full-width hairline whose **first 48px is 2px `--accent-portal`** — the "portal signature" rule.
15. **Sidebar/Nav rail** — deep-green `--portal-sidebar-bg` in light mode (dark rail + light canvas = the Estate silhouette); Fraunces wordmark; active = champagne plate with green ink + 2px gold left tick; user card at bottom with portal-accent avatar ring.
16. **Timeline / Activity feed** — 1px hairline spine, 8px hollow node circles (2px `--accent-portal` ring); milestone events = gold-filled node.
17. **KanbanCard** — 12px radius, hairline, `--elevation-1`; 3px status top rule; **while dragging**: `--elevation-3` + 1.5° tilt + gold hairline glow. Column headers = eyebrow + Fraunces count numeral.
18. **Checkbox / Switch / Radio** — checkbox 18px, 4px radius, checked `bg-primary` with 120ms stroke-drawn check; switch 36×20 with ivory thumb.
19. **Tooltip** — obsidian panel, parchment 12px text, no arrow, fade+2px instant in.
20. **Progress** — 3px track; fill gradient `--accent-portal → gold` for job-completion; indeterminate = gold sweep.
21. **Accordion** — hairline dividers only; `+`→`×` rotation on public FAQ, chevron in portals.
22. **Alert / Banner** — `--*-soft` bg, hairline border, ink-dark semantic text, 3px left rule; no filled saturated banners anywhere.
23. **Command palette** — obsidian glass (`hsl(160 30% 8% / 0.92)` + blur 16px), gold caret, portal-accent highlight bar.
24. **FAB** (cleaner mobile) — 56px, `bg-primary`, green-tinted shadow; press scale 0.94 spring.
25. **UploadDropzone** — the one permitted dashed border; drag-over: dashed→solid `--gold` + wash + 1.01 scale.
26. **Separator** — default hairline; `variant="ornament"`: champagne gradient rule for section breaks and PDF/email use.

### 3.1 Data-viz restyle (chart kit)

Keep the `use-chart-colors.ts` live-token pattern; change what it reads:
- **Series palette**: `series-1 = --accent-portal`, then champagne `#C0A265`, delft `#3E6B8C`, aubergine `#5E4368`, copper `#9C5B33`, steel `#4A5A66` — the portal accents ARE the chart palette. Expose as `--chart-1…6`.
- **Grid**: horizontal-only, 1px `--border/60`, no vertical gridlines; axis lines removed.
- **Area-trend**: 2px stroke, gradient fill capped at 10%; dot only on hover/last point.
- **Bar-compare**: 2px top radius only; hover = `--muted/50` band.
- **Donut-stat**: 8px ring; center value **Fraunces `display-sm` tabular**.
- **Chart-tooltip**: obsidian, parchment, gold hairline under label row, tabular values.
- Animation: single draw-in on mount, none on refresh; disabled under reduced motion.

## 4. SIGNATURE MOMENTS

1. **The Gilt Login** — full-bleed obsidian-green with a slow 40s champagne radial drift; centered ivory card (`--elevation-gold`), Fraunces wordmark, "Welcome back." in Fraunces italic. Same screen for all portals — accent appears only after auth. Highest-ROI screen for "sellable."
2. **Dashboard greeting header** — eyebrow date line ("THURSDAY · 4 JULY · SYDNEY 8°"), Fraunces `display-lg` "Good morning, Sanuth." with the day's headline stat woven in; portal-signature rule beneath; staggered rise on first load per session only.
3. **The Champagne Thread** — the 1px gold gradient hairline as system-wide signature: dialog tops, toast success edges, PDF headers, email dividers, section breaks. One repeated detail = brand memory.
4. **PDF/quote cover ceremony** — obsidian-green cover, gold rule, Fraunces client name at `display-xl`, eyebrow "PREPARED FOR"; inner pages ivory with green table headers and champagne totals; matching chrome for invoices, QA reports, end-of-lease certificates.
5. **Boot / brand loader** — keep the architecture; re-skin: ivory plate with gold hairline ring, champagne arc over green track; retire flip/orbit/ripple variants; Fraunces wordmark.
6. **Confirmation ceremonies** — money/irreversible confirms use the ceremony Dialog: Fraunces title, serif amount, gold primary button; on confirm a single champagne shimmer sweep (600ms) before the success toast.
7. **QA seal** — a passed inspection stamps a drawn-on circular gold seal (SVG stroke animation): "sNeek · QUALITY ASSURED · {date}" in smallcaps around a leaf mark; on the QA screen, client report, and PDF.
8. **Email chrome** — ivory body, green header band with Fraunces wordmark, champagne-thread dividers, gold CTA (inline CSS, Georgia fallback for Outlook), footer eyebrow.
9. **Empty states as gallery pieces** — bespoke thin-line gold illustrations per portal + Fraunces one-liners ("A quiet morning. Nothing awaiting inspection.").
10. **End-of-day close** — when the last job completes: gold hairline draw-across, Fraunces "That's the day. 14 of 14 complete.", tiny serif summary; once per day; skipped under reduced motion.

## 5. ACCESSIBILITY + PERFORMANCE GUARDRAILS

**Contrast (non-negotiable):**
- Decorative champagne `#C0A265` is **never body text on light**. Text-gold on light = `--gold-ink #7B5F2E` (4.9:1). On dark, text-gold = `#D9BE85` (≈8:1).
- `#C0A265` on obsidian ≈ 7.6:1 — free for text/icons on dark ceremony surfaces.
- Gold hairlines on light (≈2.6:1) are decoration only, never the sole boundary of an input.
- Green on paper = 9.8:1; parchment on green ≈ 9.4:1 — primary buttons AAA. Every `--*-soft` + ink pairing ≥4.5:1.
- Portal accents pre-darkened for 4.5:1 text on paper. Never encode status by hue alone — dot + label always.
- Focus ring ≥3:1 against control and page; on the obsidian sidebar the focus ring flips to `--gold`.

**Fonts:** all via `next/font` self-hosting. Fraunces = one variable file, latin subset, ~55–80KB woff2 (replaces Cormorant's 8 static files — net win). `adjustFontFallback` on. Skip the italic set unless the public site uses italics.

**Reduced motion:** every keyframe/transition collapses to opacity-only or none; marquee/drift/shimmer off entirely; honor in JS (check `matchMedia` before Recharts `isAnimationActive`).

**Performance:** animate `transform`/`opacity` only; backdrop-blur ≤3 concurrent surfaces; champagne gradients as CSS, never images; login drift = one pseudo-element at 40s; table row hover ≤100ms background-color; chart palette stays on mounted-token-read. Dark PDF covers: offer an "ink-saver" print variant (ivory cover + green text).

**Migration note:** because every value uses the existing `--token` names and HSL convention, phase 1 (retoken `globals.css` + tailwind fonts/radii/shadows + swap Cormorant→Fraunces) reskins ~80% of the app with zero component edits; phases 2–3 are component anatomy (§3) and signature moments (§4). Retire the legacy `brand.*` sky-blue scale and the `#0284c7` viewport themeColor (→ `#1E4A3B`).
