# Plan G — Audits + Copy Guide + Illustrations + Final Acceptance

**Goal:** Drive broken-links to 0, drive critical/serious a11y violations to 0, lock visual regression baseline across 30+ routes, write the copy guide, build 15 SVG empty-state illustrations, mark marketing pages with `.marketing-only`, run all 12 foundation acceptance criteria.

**Architecture:** Each audit is a Playwright/Node script + a fix loop. Copy guide + illustrations are pure docs/assets. Final gate is a checklist document.

---

## Prerequisites

Plans A, B, C, D, E, F all merged.

---

## Task 1: Broken-links sweep

**Files:** `scripts/audit/broken-links.ts`, `docs/audits/broken-links-report.md`

- [ ] Playwright crawler logs in as each role (admin, ops, cleaner, client, laundry, qa from seed). BFS depth 5 over internal `<Link>` and `<a href="/...">`. Records 404, 500, redirect-loop, empty-main-content.
- [ ] Output report file. Each finding gets a fix commit until report is empty.

## Task 2: Visual regression baseline expansion

**Files:** `scripts/audit/screenshot-routes.ts`, `e2e/visual/all-routes.spec.ts`

- [ ] Screenshot 30-40 representative routes × 3 viewports (1440×900, 1024×768, 390×844) × light/dark. Lock baselines.
- [ ] Subsequent runs diff and report.

## Task 3: A11y full sweep

**Files:** extend visual spec with axe analysis per route + viewport. Drive serious/critical to 0.

- [ ] Capture remaining issues from Plan A/B baselines + new ones discovered.
- [ ] Fix iteratively. Common fixes: missing `aria-label` on icon-only buttons (Plan B FAB pattern showed how), color contrast on links/text (audit specific text + bg combinations), keyboard focus traps in modals (Plan B Dialog already correct).

## Task 4: Apply `.marketing-only` class

**Files:** `app/(public)/layout.tsx` or `components/public/PublicSiteShell.tsx`

- [ ] Add `marketing-only` class to public marketing layout root. Restores decorative animations (float, marquee, scroll-reveal) on `/`, `/services/*`, etc.

## Task 5: Copy guide

**Files:** `docs/style/copy-guide.md`

- [ ] Write voice, banned phrases, button copy rules, empty-state copy pattern, error copy pattern, date/time format, money format. Reference spec §11.

## Task 6: Illustration set

**Files:** `components/illustrations/*.tsx` (15 components)

- [ ] Build 15 SVG line-art illustrations: empty-inbox, no-jobs, no-properties, no-qa-reviews, payment-paid, payment-pending, gps-offline, upload-failed, error-fallback, success, no-clients, no-cleaners, no-quotes, no-invoices, no-shifts.
- [ ] 2-color flat using `--text-muted` + `--primary`. Tree-shakeable per component.
- [ ] Wire into existing EmptyState usages.

## Task 7: Lighthouse smoke

- [ ] Run Lighthouse against `/`, `/admin`, `/cleaner/jobs` mobile. Record scores in `docs/audits/lighthouse.md`. Must hit ≥90 perf, ≥95 a11y.

## Task 8: Foundation acceptance gate

**Files:** `docs/audits/foundation-acceptance.md`

- [ ] Tick every one of the 12 spec acceptance criteria with evidence (commit SHA, test name, screenshot path).
- [ ] When all 12 ✅, foundation phase is DONE. Open the V1 sub-project (multi-cleaning-type taxonomy + advanced form builder).
