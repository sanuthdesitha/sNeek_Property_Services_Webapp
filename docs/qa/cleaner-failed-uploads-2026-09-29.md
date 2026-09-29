# Failed cleaner uploads and phone storage

Base: d3aafe80. Date: 2026-09-29.

## Changed behaviour

- Removed the entire bottom Saved file copies / Device evidence recovery section from the job workspace.
- Failed/abandoned attempt records no longer globally block submission or require explicit cleanup. The field keeps a concise error and optional original download; failed attempt chips and manual remove/retry-old-batch controls are gone. Selecting a file again is explicit, not an automatic resend of an uncertain upload.
- Successful attachments are preserved. Verified server acknowledgements are still restored before validation. Missing required photos/videos remain missing; an unsuccessful attempt never counts as evidence.
- Submission holds an exclusive scoped browser lock through POST; uploads hold its shared counterpart. Active uploads remain tracked even after their field unmounts. Scope-local active work blocks submission, while old captured/uploading/error statuses do not imply ongoing work. Auto-assign draft preparation uses the same coordination.
- Reconciliation uses one lazy authorized server-draft GET per nonblocking check, including a forty-photo regression. Compatibility recovery that waits on individual locks still reads after acquiring them. An unavailable local cache does not independently block submission, but server authorization/ledger and form validation still apply.
- IndexedDB write failures retain the full original/prepared/allocation/receipt record in session memory. Later reads use the latest memory value rather than stale disk data, and successful later writes return to durable storage. The field advises keeping the page open. No fallback promises survival after page closure.
- With no private video workspace, videos above 25 MB avoid memory-buffer encoding; the existing original-file upload fallback supports up to 150 MB. Larger clips need working workspace or shorter recordings. Compression/audio-preservation checks remain.

No remote evidence objects were deleted. No blind byte retransmission or automatic missing-ledger attachment mutation was added. The local store retains failed originals; it is no longer a manual form-completion checklist.

## Verification

Initial integrated run: 284 tests passed across 13 suites, including real workspace submission/restoration, server required-evidence checks, receipt reconciliation, storage-failure injection, video tracks, upload pipeline, media UI and bulk auto-assignment. Later pipeline, batching and failure-reason regressions bring the distinct checked total to 288. Three responsive browser checks passed at 320/390/1440 pixels; screenshots inspected. These browser cases use mocked transport and the actual media component.

Final TypeScript `tsc --noEmit` passed. The final affected seven-suite coverage run passed 151 tests; the additional failure-reason component test then passed with its six-test suite. `git diff --check` passed after whitespace cleanup.

Focused advisory coverage (four selected modules, not a full touched-file verdict):

| File | Lines | Branches | Functions |
|---|---:|---:|---:|
| evidence-client.ts | 93.97% | 81.25% | 93.33% |
| evidence-store.ts | 99.20% | 89.06% | 72.72% |
| evidence-volatile.ts | 85.71% | 91.66% | 60% |
| compress-video.ts | 93.42% | 37.50% | 40% |

Aggregate 94.48% lines, 80.05% branches, 73.07% functions. Some metrics fall below the default advisory 95% bar; no required coverage gate is configured. These are focused mocked-path metrics, not evidence of browser codec/device coverage.

No production uploads, database mutations or real low-storage phone tests were performed. Browser storage quota and video-workspace failures are simulated. Physical phone storage can still prevent the camera from recording before the application receives a file. Memory-only evidence is lost on page closure unless already acknowledged by the server; keep the job open until uploading finishes.
