# Plan C — Layout Shells + Navigation + Command Palette + Density UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Rebuild the portal shells (admin sidebar, mobile bottom-tab, public top-nav) with new tokens, ship a `cmdk` command palette + keyboard shortcuts + cheatsheet, add user settings for theme + density.

**Architecture:** Each shell is a layout file under `app/<portal>/`. Command palette is a global client component mounted at the portal root. Keyboard shortcuts are a single global hook + per-page registration. Theme preference adds a new enum field to User.

**Tech Stack:** Next.js 14 App Router, Radix UI, shadcn/ui primitives from Plan B, `cmdk` (installed in Plan A), `lucide-react`.

---

## Prerequisites

1. Plan B merged (or branched on `feat/foundation-b-primitives`).
2. `npm test` green from Plan B (37 tests).

---

## Task 1: User.themePreference enum + migration

**Files:** `prisma/schema.prisma`, `prisma/migrations/<ts>_user_theme_preference/migration.sql`

- [ ] Add to `prisma/schema.prisma`:

```prisma
enum ThemePreference {
  LIGHT
  DARK
  SYSTEM
}
```

In `model User { … }`:

```prisma
  themePreference ThemePreference @default(SYSTEM)
```

- [ ] Hand-write migration SQL (since `prisma migrate dev` is broken — see Plan A retro):

```sql
CREATE TYPE "ThemePreference" AS ENUM ('LIGHT', 'DARK', 'SYSTEM');
ALTER TABLE "User" ADD COLUMN "themePreference" "ThemePreference" NOT NULL DEFAULT 'SYSTEM';
```

- [ ] Apply via `npx prisma db execute --file <path>` + `npx prisma migrate resolve --applied <name>` + `npx prisma generate`. Same pattern as Plan A Task 5.
- [ ] Commit.

## Task 2: Theme provider + system theme detection

**Files:** `lib/theme/context.tsx`, `lib/theme/server.ts`, `tests/components/theme.test.tsx`

- [ ] `lib/theme/context.tsx` — `ThemeProvider` reads preference, applies `class="dark"` on `<html>` when active (matches Tailwind dark mode). System mode uses `matchMedia('(prefers-color-scheme: dark)')`.
- [ ] `lib/theme/server.ts` — `getThemeForUser(userId)` returns the persisted theme preference.
- [ ] Test: provider sets correct class on document.documentElement, switches on preference change.
- [ ] Commit.

## Task 3: Admin sidebar shell rebuild

**Files:** `components/shell/admin-sidebar.tsx`, `components/shell/admin-shell.tsx`, modify `app/admin/layout.tsx`

- [ ] Identify existing admin layout (`components/admin/sidebar.tsx` — already in working tree from user WIP, careful to coordinate).
- [ ] New `admin-sidebar.tsx`:
  - Section groups: Operations (Dashboard, Jobs, Schedule, Calendar, Ops Map), People (Clients, Properties, Workforce), Work (QA, Cases, Approvals, Time Adjustments), Money (Quotes, Invoices, Finance, Payroll), Marketing (Website, Campaigns), Inventory (Stock, Shopping Runs, Suppliers, Laundry), System (Integrations, Users, Settings, System Health)
  - Collapsible to icon-only via state + `data-collapsed`
  - Active route highlighting via `usePathname()`
  - Uses tokens: `bg-portal-sidebar-bg`, `text-portal-sidebar-fg`, active item `bg-portal-sidebar-active-bg`
- [ ] New `admin-shell.tsx`: sidebar + content area + top breadcrumb + optional right rail slot. Wraps in `DensityShell` (Plan B) and `ThemeProvider` (Task 2).
- [ ] Update `app/admin/layout.tsx` to use new shell.
- [ ] Test: shell renders without crash; sidebar collapse persists to localStorage.
- [ ] Commit.

## Task 4: Mobile shell (cleaner, client, laundry, QA)

**Files:** `components/shell/mobile-shell.tsx`, `components/shell/bottom-nav.tsx`, modify `app/cleaner/layout.tsx`, `app/client/layout.tsx`, `app/laundry/layout.tsx`, `app/qa/layout.tsx`

- [ ] `mobile-shell.tsx`: top bar (title + back), content area with safe-area-inset padding, bottom-nav slot, FAB slot. Sets `--bottom-nav-height` CSS var so FAB positioning (from Plan B FAB) works.
- [ ] `bottom-nav.tsx`: 5-tab nav, configurable per portal. Highlights active route. Uses `data-density` for touch target sizing.
- [ ] Each portal layout passes its own nav config:
  - Cleaner: Jobs, Calendar, Hub, Profile, More
  - Client: Properties, Jobs, Quotes, Messages, Profile
  - Laundry: Calendar, Hub, Profile, More
  - QA: Queue, Calendar, Hub, Profile
- [ ] Update layouts to use mobile shell.
- [ ] Test: shell renders, bottom-nav highlights correct active item.
- [ ] Commit.

## Task 5: Public top-nav rebuild

**Files:** `components/shell/public-nav.tsx`, modify `components/public/PublicSiteShell` (or equivalent existing component)

- [ ] New top-nav with logo, primary links (Services, Pricing, Blog, Contact), CTA button (Get Quote), mobile hamburger menu.
- [ ] Apply `body.marketing` class so decorative animations from Plan A globals.css activate on marketing pages.
- [ ] Test: nav renders, mobile menu toggles.
- [ ] Commit.

## Task 6: Command palette (Cmd/Ctrl+K)

**Files:** `components/command-palette/index.tsx`, `components/command-palette/sources.ts`, `lib/cmdk/registry.ts`, `tests/components/command-palette.test.tsx`

- [ ] Built on `cmdk` (already installed). Global mount in admin shell.
- [ ] Sources:
  - Routes index (static list of all admin/ops routes)
  - Search clients (debounced API call to `/api/admin/clients?q=…`)
  - Search properties (debounced)
  - Search jobs by number (debounced)
  - Quick actions: "Create job", "Create quote", "New client", "New property"
- [ ] Keyboard shortcut: `Cmd/Ctrl+K` opens, `Esc` closes, arrows navigate, `Enter` selects.
- [ ] Test: opens on shortcut, filters as user types, selects item triggers navigation.
- [ ] Commit.

## Task 7: Global keyboard shortcuts + cheatsheet

**Files:** `hooks/use-keyboard-shortcuts.ts`, `components/shortcuts/cheatsheet.tsx`, modify admin shell

- [ ] Global hook registers shortcuts. Pages call `useShortcut('c', () => router.push('/admin/jobs/new'))`. Returns `unregister` cleanup.
- [ ] Cheatsheet modal opens on `?` (when no input focused). Lists all currently-registered shortcuts grouped by category.
- [ ] Built-in shortcuts: `Cmd+K` (palette), `?` (cheatsheet), `Esc` (close), `g d` / `g j` / `g c` / `g i` (go to dashboard/jobs/clients/invoices), `c` (create — context-sensitive).
- [ ] Test: shortcut fires on key press; doesn't fire when typing in input.
- [ ] Commit.

## Task 8: User settings — density + theme UI

**Files:** modify `app/admin/settings/page.tsx` (or existing settings page), `app/api/me/preferences/route.ts`

- [ ] Settings page section "Display": density radio (Compact/Default/Comfortable), theme radio (Light/Dark/System).
- [ ] New API route `POST /api/me/preferences` updates `User.uiDensity` and `User.themePreference`. Returns updated user.
- [ ] Reload page or use SWR mutation to apply change live (no full reload required since DensityProvider and ThemeProvider are client-side and re-read from new session).
- [ ] Test: API saves preference, settings UI submits.
- [ ] Commit.

## Task 9: Full verification + push + PR

- [ ] Lint (skipped — pre-existing).
- [ ] `npm test` — all green.
- [ ] `npm run test:e2e` — smoke + a11y baseline + visual + new command-palette test.
- [ ] `npm run build`.
- [ ] Push `feat/foundation-c-shells`.
- [ ] PR via GitHub URL.
