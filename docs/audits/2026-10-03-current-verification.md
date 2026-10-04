# Current release update — 2026-10-04

The latest merged release includes prior remediation, owner-scheduled deep-clean proposals, started-work invoice drafts, cleaner preparation fallback, ADMIN-only existing residential address/suburb view, and the Estate laundry investigation tab. Remote main7d8b70af was fast-forwarded and its cleaner-upload preflight fix preserved. Build and TypeScript passed;417 touched-code/test files lint with0errors/23warnings;40 focused laundry/startup/preflight tests passed. Prior75 isolated PostgreSQL tests passed; the separate IndexedDB draft-store test remains unverified/skipped where IndexedDB is unavailable. Production source hashes match the successful staged build. No redundant full-suite rerun;6480/76/0 below is historical evidence for its frozen snapshot.

Coverage policy correction: project has no configured required coverage gate. Installed coverage-check skill says a hard gate applies only when gates.coverage is required. Historical171 existing-file deficits remain advisory; full-file95 is not claimed. Seven prior new-file deficits cleared, guest-summary100% allmetrics; new laundry investigation helper100% allmetrics, new UI100%lines/functions94.23%branches. No thresholds reduced.

Checked-in implicit build/start migration and admin-bootstrap hooks were removed; explicit maintenance commands remain. No Prisma schema/migration/dependency change. User explicitly authorized main push to trigger existing Hostinger auto-deploy; successful push and host completion must be reported separately. Live https://www.sneekholdings.com smoke probes are blocked by the cloud proxy CONNECT403, not evidence of a site outage. Prior main7d8b70afc2b33d568cce847d7213406a6408fce1 is the pre-release code rollback reference. No production backup/restore was performed; do not clear finance/notification receipts during rollback.

Queued product features and the newly clarified15:00Sydney operational-readiness rule are separate work, not silently included or claimed deployed here. Actual booking feeds remain unchanged.

---
## Historical frozen product-decisions verification

# Product decisions — integrated verification

Implemented the user's Oct3 deep-clean and invoice decisions in the existing remediation patch. Prior6382 and6210 checkpoints remain preserved. No live settings, database records, deployments or provider operations were changed.

## Deep-clean planning

Explicit office verification links submitted evidence and the authoritative QA state to a completed deep-clean job. Candidate evidence alone is not verification; unknown baselines stay unknown. Three Sydney calendar months after verified completion, with month-end clamping, the scheduler creates one undated planning draft per property/baseline. Repeated runs do not create duplicates. Corrections into the future defer the proposal. Owner review is visible in property planning and the deep-clean queue. The user explicitly chooses a real date to convert the proposal to an unassigned draft job; no automatic assignment, dispatch, client notice or charge.

Job.scheduledDate remains mandatory. The reversible implementation uses a separate office-only AppSetting planning record until explicit scheduling, avoiding fake dates and a schema migration. This is an undated draft proposal, not a row in the dated Job table.

## Closed-period invoice drafts

Selected clients prepare DRAFT invoices at08:00 Sydney on16th/1st for the preceding closed half-month, including the full final day. Timestamped valid clock-in or a legacy completed status with completion timestamp establishes eligibility before cutoff; offers and acceptance alone do not. Older uninvoiced work is separately identified as prior-period carryover. Non-void invoice claims prevent duplicate billing across periods.

Unfinished client work uses the agreed price as a clearly marked provisional estimate for office review. This reversible default was presented during implementation. Explicit draft refresh and office review handle completion, current rates and extras review; issued or approved financial records are not silently rewritten. Unfinished cleaner pay remains separate and unapproved through the existing payroll workflow. No automatic sending, payment or export was added. Existing client selections were not changed.

## Verification

| Check | Result |
|---|---|
| Isolated full suite | 6480passed, 76skipped, zero failed; 568passing files, 11skipped |
| TypeScript | Exit0 |
| Staged direct Next build | Exit0; production hashes match staged snapshot; no npm hooks, mocked fonts, outbound blocked |
| Touched-file lint | 1errors, 23warnings; 0new messages versus6382 |
| Patch | Whitespace check and apply-to-clean-baseline passed |

New interactive behavior is exercised in mocked component/API tests. Historical9/9 browser evidence remains in checkpoint6382 and is not presented as a rerun of these new flows. Build output is verification-only and not deployable.

## Remaining gates and limits

Full-file95% line/branch/function gate is NOT PASSED: 56measured touched files pass; 171existing files and 7new files fail. 1touched configuration file(s) are uninstrumented. Supplementary changed-line coverage 4176/4313 (96.82%); 137uncovered lines across30files. Exact paths, metrics and changed lines are included. 1files show numeric decreases versus6382; 16versus the original limited baseline, whose suite had one fixture failure. No no-regression gate is certified.

The existing lib/workforce/service.ts module-variable lint error remains. No thresholds, exclusions or lint suppressions were loosened. 76database tests remain skipped: disposable PostgreSQL installation approval is still pending. Mock transactions do not prove real locks, rollback, constraints or concurrency. Real providers/devices and deployment require approved staging; no installs, image pulls, real DB/provider calls, migrations, push or deployment occurred.

Current source hashes, source drift versus6382, full patch, raw coverage and logs are packaged. Library delivery is recorded in an external receipt after upload so upload bytes remain stable.
