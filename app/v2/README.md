# app/v2 — ESTATE rebrand (scope charter)

This is the isolated redesign tree. See `docs/rebrand/` for the full plan.

## Law (do not break)

1. **v2 is presentation only.** Pages here import the LIVE `lib/**`, `app/api/**`,
   `hooks/**`, Prisma client, and NextAuth config — never fork them.
2. **New files only.** Every v2 page is a new file mirroring the canonical path
   1:1 (`app/v2/admin/jobs/page.tsx` ↔ `app/admin/jobs/page.tsx`) so promotion is
   a mechanical `git mv`.
3. **Design system** lives in `app/v2/estate.css` (tokens scoped to
   `[data-skin="estate"]`) + `components/v2/**`. The live app's globals.css and
   `components/ui/**` are untouched.
4. **No schema migrations, no API changes, no platform upgrades** from the
   redesign branch. If v2 needs a data/API change, it lands on `main` first.
5. **Nothing is pushed** without explicit owner authorization.

## Preview (optional git worktree — "exact copy")

```
git worktree add "E:\sNeek Property Service\Website-redesign" redesign
cd "..\Website-redesign" && npm ci
# .env deltas: SNEEK_WEB_SCHEDULER_ENABLED=false,
#              SNEEK_DISABLE_WEB_SCHEDULED_FALLBACK=1,
#              NEXT_DIST_DIR=.next-redesign, APP_URL=http://localhost:3010/
npm run dev -- -p 3010
```
Live app stays on :3000; redesign preview on :3010; same DB, same login.

## Structure

- `estate.css` — the full Estate token sheet (light/Obsidian dark/public/per-portal accents)
- `layout.tsx` — mounts `[data-skin="estate"]`, imports estate.css
- `showcase/` — living style guide (the M1 review surface)
- `(public)/`, `client/`, `admin/`, `cleaner/`, `laundry/`, `qa/`, `maintenance/` — portal trees
