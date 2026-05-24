# Dark Mode Followup — Plan G Pass

## Scope completed in this pass

Fixed dark-mode surfaces on the highest-visibility admin shell:

- `components/admin/header.tsx` — switched `bg-white/75`, `border-white/60`, `bg-white/70`, `bg-white/80`, `bg-white p-0.5` to `bg-background`, `bg-surface`, `border-border/70` plus `dark:` variants for amber attention-section.
- `components/admin/page-shell.tsx` — `border-white/70 bg-white/80` -> `border-border/70 bg-surface/80`, scoped shadow off in dark.
- `components/admin/admin-dashboard-graphs.tsx` — chart card surfaces and CartesianGrid strokes now read from tokens (`hsl(var(--border))`, `bg-surface`, `border-border`).
- `app/admin/page.tsx` (dashboard home) — hero gradient, stat cards, continuation approval cards, and approval banner all token-driven, with dark variants on amber surfaces and shadows scoped off.
- `components/admin/sidebar.tsx` — verified already fully token-driven (no changes needed).
- `components/portal/portal-shell.tsx` (cleaner/client/laundry shell) — verified already token-driven via `bg-background`, `bg-card`, `bg-[hsl(var(--portal-sidebar-bg))]`.

## Remaining for next dark-mode sweep

Targets still using hard-coded slate / white / gray classes that don't respond to `.dark`:

- `app/admin/jobs/page.tsx` and the kanban/calendar sub-tabs
- Various `components/admin/*` workspaces (client-detail-workspace, finance-dashboard-workspace, email-campaigns-workspace, marketing-console, blog-manager, etc.)
- Recharts color palettes in other dashboards — currently hard-coded hex values (`#1f7a8c`, `#f59e0b`, etc.). Consider migrating to a CSS-var-driven palette in a follow-up.
- Quote / invoice / report preview screens (rendered for PDF — may be intentional light-only).
- `/admin/calendar`, `/admin/properties`, `/admin/clients` list views.
- `/admin/messages` workspace surfaces.

## Approach for the next pass

1. Run audit grep: `bg-(white|gray-|slate-|neutral-)[0-9]|text-(gray|slate|neutral)-[0-9]|border-(gray|slate|neutral)-[0-9]` across `app/admin` and `components/admin`.
2. Triage into: (a) auto-replace with tokens, (b) add `dark:` variants, (c) leave (PDF/print surfaces).
3. Smoke test by toggling `document.documentElement.classList.add('dark')` and visually walking each page.
4. Update charts to read from CSS vars for stroke / grid / tooltip; pick a dark-aware palette.
