# Legacy bulk-photo assignment verification - 2026-09-22

143 focused tests passed in five files. Four styled browser cases passed: legacy receipt adoption plus explicit assignment, and existing batching/review/move/undo at 320/390/1440px. Final TypeScript validation passed. No production photos, database, storage or Ollama inference were accessed. No schema migration or full production build was required/run for this compatibility fix.

The browser acknowledges supported old photos only after saving answers and reading the current draft. The server verifies ownership, actual image metadata and exclusive saved pool membership under its existing job/form/assignment locks. Existing receipts are never reset. Analysis accepts old paths only with the same strict receipt/scope/version checks; suggestions and moves retain explicit review. A lost acknowledgement can be recovered by re-reading the ledger without uploading bytes again.

Focused coverage across the five changed source files is 88.70% lines, 81.65% branches and 68.51% functions. This is not a 95% certification or a full-suite baseline; the project has no required coverage gate.

| File | Lines | Branches | Functions |
|---|---:|---:|---:|
| `app/api/cleaner/jobs/[id]/evidence/route.ts` | 100% | 82.18% | 100% |
| `components/v2/cleaner/bulk-photo-assign.tsx` | 83.02% | 78.05% | 51.51% |
| `lib/cleaner/evidence-client.ts` | 88.02% | 72.97% | 75% |
| `lib/cleaner/evidence-destination.ts` | 100% | 93.75% | 100% |
| `lib/cleaner/photo-assignment.ts` | 100% | 88.6% | 100% |
