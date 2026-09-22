# Cleaner uploads and personal stock — 2026-09-22

## Delivered behavior

- Browser compression failures fall back to the original video up to 150 MiB. Larger originals remain recoverable, and cancellation never starts fallback transfer. Blank/generic video MIME values are inferred from recognized extensions for multipart attachment verification.
- Failed captures can be removed from the field and device recovery panel. A server acknowledgement records a detached capture before local recovery stops blocking submission. Late attachment requests cannot resurrect the capture. Original device blobs and remote objects are retained; required form evidence still needs replacement.
- Cleaner Supplies → My stock supports recording new holdings and correcting remaining quantities (including zero with a reason). Ownership comes from the session, changes are audited, and repeated requests cannot duplicate a holding or overwrite a later delivery. Stale corrections are rejected under a row lock. Zero holdings remain available to correct. Property stock changes only through delivery.

## Verification

- 151 focused Vitest tests passed across upload pipeline, evidence client/API, recovery/removal components, and personal stock helper/API/form. The combined coverage run passed 140 tests; 11 additional PATCH authorization/validation cases were then added and the expanded 17-test API suite passed.
- TypeScript `tsc --noEmit` passed after integration.
- Three styled Chromium component scenarios passed at 320, 390 and 1440 pixels: add stock, correct to zero, simulate a lost PATCH acknowledgement, reload and retry the identical request. No horizontal overflow; 320px screenshot inspected. These use mocked HTTP responses, not production database mutations.
- `git diff --check` passed.
- Advisory focused unit coverage: 66.23% lines, 75.29% branches, 63.15% functions. This is not a 95% coverage certification; the server page and on-hand container are not exercised by these unit tests (the container has browser fixture coverage), and the small shared `includeEmpty` helper change was outside the coverage include list. No required coverage gate is configured.

## Live verification remaining

After deploying the commit, use a cleaner account to upload a phone video, remove a deliberately failed capture, and record/correct personal stock. Actual iOS/Android codec, device storage, mobile-network and S3 behavior was not tested against the live service here. No production stock or evidence data was changed during automated checks.
