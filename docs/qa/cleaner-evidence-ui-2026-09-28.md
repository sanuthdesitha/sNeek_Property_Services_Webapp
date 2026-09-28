# Cleaner evidence, local vision and shopping UI verification

Date: 2026-09-28. Base: b3ab39e2.

## Delivered behaviour

- Removed the cleaning stage's oversized top progress and room-navigation panel. Per-room counts and required-field checks remain. Device recovery moved below the stage into a compact disclosure; retry, removal and original-file download remain available.
- Reconcile lost upload acknowledgements from the authorized server draft, matching capture identity, key, revision, destination and version under a capture lock. Project only verified records into the current form, preserving unrelated answers and stable photo order. A restored form asks the cleaner to review and retry before submission/analysis. Genuine pending uploads still block submission.
- Recognize allowed phone photos/videos with generic or absent MIME metadata using the existing extension allowlist. Explicit incompatible types remain rejected. Vision still checks actual decoded format and existing byte/pixel limits.
- Ollama photo assignment uses one submitted photo plus at most three optional reference/history attempts, a 180-second inference deadline and 240-second browser deadline. Missing optional examples no longer abort analysis. Submitted-photo failures still stop analysis. Provider failures give actionable guidance without exposing provider response bodies or losing photos.
- Refined existing cleaner stock/batch/purchase forms, admin stock/client charges/Xero settings and client purchase/PDF actions using Estate styling. Responsive controls, saved-versus-unsaved amounts, loading/error states and duplicate-click guards preserve existing accounting and inventory contracts.

## Automated verification

- 362 tests passed across 13 evidence, submission, workspace, bulk assignment, image validation and Ollama suites. Includes real workspace regressions for a lost callback, recovered required photo, restored bulk pool and genuinely pending evidence.
- Cleaner shopping/stock component suites: 15 passed.
- Admin/client shopping component suites: 15 passed.
- TypeScript `tsc --noEmit`: passed after source changes.
- Browser: cleaner job layout 3 (320/390/1440px); bulk auto-assign 4 including older photos; cleaner own-stock 7; actual shopping purchases 2; admin held-stock 2; admin charge review 3. Total: 21 passed. Fixtures exercise real components with mocked APIs, including mobile overflow checks. Screenshots were inspected with Estate scope and font variables.
- `git diff --check`: passed.

Focused coverage rerun: 138 tests passed. Advisory metrics, not a full touched-file coverage verdict:

| Source | Lines | Branches | Functions |
|---|---:|---:|---:|
| lib/cleaner/evidence-client.ts | 92.79% | 76.09% | 87.50% |
| lib/cleaner/photo-assignment.ts | 100% | 90% | 100% |
| lib/ai/ollama.ts | 100% | 93.45% | 100% |
| lib/ai/runtime-limits.ts | 100% | 100% | 100% |

Aggregate for these four files: 96.48% lines, 84.94% branches, 95.45% functions. Several metrics are below the skill's default 95% advisory bar; no required repository coverage gate is configured. Coverage was not measured for every styled surface, and no claim of 95% overall coverage is made.

## Deployment and limits

No new schema migration in this change. The previous shopping lifecycle migrations remain prerequisites if not already deployed; see `shopping-lifecycle-2026-09-22.md`.

No production database writes, real client emails, live uploads, or live Ollama inference were performed. A successful production inference is not established by mocked provider tests. After deployment, retry a saved job photo through Auto assign and review the proposed section. CPU memory/model availability or a shorter reverse-proxy timeout can still interrupt local inference. Existing OpenAI/Claude support and manual assignment remain available. No automatic QA deductions or production model training were run.
