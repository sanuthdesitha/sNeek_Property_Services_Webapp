# Design tokens — source of truth

Tokens are CSS custom properties declared in `app/globals.css`. This document is the human-readable mirror. If they disagree, fix the document — the CSS is law.

## Surface and text (light)

| Token | HSL | Approx hex | Use |
|---|---|---|---|
| --background | 210 20% 98% | #F7F9FB | Page background |
| --surface | 0 0% 100% | #FFFFFF | Cards, panels |
| --surface-raised | 210 20% 96% | #F0F4F7 | Sidebar |
| --foreground | 215 28% 14% | #1A2330 | Body text |
| --muted-foreground | 215 12% 45% | #67717E | Secondary text |
| --border | 214 15% 88% | #DCE2E8 | Hairlines |
| --border-strong | 214 15% 78% | #B9C3CC | Inputs at rest |

## Surface and text (dark)

| Token | HSL | Approx hex |
|---|---|---|
| --background | 222 22% 9% | #0E121A |
| --surface | 222 18% 12% | #161B23 |
| --surface-raised | 222 16% 16% | #1F2530 |
| --foreground | 210 22% 94% | #ECEFF3 |
| --muted-foreground | 210 14% 65% | #969DA8 |
| --border | 220 13% 22% | #313844 |

## Brand and status (light)

| Token | HSL | Hex | Use |
|---|---|---|---|
| --primary | 188 78% 30% | #0E7C9A | Brand teal |
| --accent | 35 95% 50% | #F58A0C | CTA highlights |
| --success | 152 62% 38% | #25A871 | |
| --warning | 38 95% 50% | #F5A20C | |
| --danger | 0 72% 52% | #E03131 | |
| --info | 212 80% 50% | #1A7AE0 | |
| --ring | 188 78% 40% | #119DC4 | Focus ring |

## Radii

| Token | px | Use |
|---|---|---|
| --radius-sm | 4 | Pills, badges, inputs |
| --radius | 8 | Buttons, cards (default) |
| --radius-lg | 12 | Modals, large cards |
| --radius-xl | 16 | Hero, image frames |

## Shadows

| Token | Use |
|---|---|
| shadow-xs | Resting cards on background |
| shadow-sm | Buttons, hovered cards |
| shadow-md | Dropdowns, popovers |
| shadow-lg | Modals, drawers |
| shadow-xl | Toasts |
| shadow-fab | FAB only |

## Typography

| Var | Family | Use |
|---|---|---|
| --font-sans | Inter | All UI text |
| --font-display | Inter Display | Page titles, hero |
| --font-mono | JetBrains Mono | IDs, timestamps, code |

## Type scale

12 (text-xs), 13 (text-sm), 14 (text-base), 16 (text-md), 18 (text-lg), 20 (text-xl), 24 (text-2xl), 30 (text-3xl), 36 (text-4xl), 48 (text-5xl). Line heights follow Tailwind defaults except `text-sm` uses `leading-snug` (18 px).

## Motion

| Duration | Easing | Use |
|---|---|---|
| 120ms | ease-out | Hover, focus |
| 180ms | ease-out | Tooltip, popover |
| 240ms | cubic-bezier(0.2, 0.8, 0.2, 1) | Modal, drawer |
| 320ms | same | Page transition |

Decorative animations (`.animate-float-slow`, `.animate-marquee`, scroll reveals) are scoped to `.marketing-only` parents — never use inside portals.

## Density

Set `data-density="compact" | "default" | "comfortable"` on the portal shell. Reads from `User.uiDensity`. Defaults: admin → compact, client/QA → default, cleaner/laundry → comfortable.

## Spacing

Tailwind's default 4 px scale. Page gutter `px-6` desktop, `px-4` mobile. Card padding `p-4` mobile, `p-6` desktop. Form rows `space-y-4`.
