# Cleaner upload reliability — 2026-10-28

## Scope and existing workflow

The reported symptom is repeated cleaner photo/video upload failures, without a screenshot or incident logs. This review uses the configured root Next.js operational app, not the separate mobile-app or sneek-nextgen projects. Starting checkout: `work`, `afba905f8f5d8bf7d9bf7ea144e419950920224f`, clean; origin matches `sanuthdesitha/sNeek_Property_Services_Webapp`. Root `AGENTS.md`, System reference, recent review record, operational UI rules and relevant upload/evidence sources were read before editing. `/workspace/.agents` is empty; no additional local skills apply.

Existing destinations remain form fields, bulk pool, JobTasks, laundry and carry-forward evidence. MediaCapture retains original and prepared bytes in scoped IndexedDB/session fallback. `processEvidence` owns the capture Web Lock and journal/receipt lifecycle. Multipart transfer uses settings-aware storage and three bounded part workers; cleaner batches retain their sequential capture processing. The evidence API verifies assignment, current form/revision, destination, media kind, owned key and storage HEAD, then records receipts under the shared job draft transaction. Submission and removal tombstones are unchanged.

## Verified failure mechanisms and fix

1. Only part-transfer fetches had deadlines. Allocation, resume, completion and evidence attachment could hold capture processing indefinitely on a dead mobile connection. The proxy transfer timer also ended when headers arrived, leaving its JSON receipt body unbounded. The shared request helper now retains a deadline through body consumption: 30 seconds for control/attachment requests; the existing 120 seconds for part transfers. Parent cancellation remains propagated and listeners/timers are cleaned up. Timeouts retain journals and return an explicit retryable error.
2. A resumed upload whose allocation callback failed could enter cleanup with `allocationRetained=false`, causing the client to abort its existing allocation and discard saved remote parts. Cleanup now aborts only new unretained allocations. Saved resumptions remain intact even if local metadata persistence fails.
3. HTTP 408 part responses previously stopped retries as permanent 4xx failures. They now use the existing three-attempt transient policy alongside 429/5xx, without creating another allocation.
4. Multipart completion previously returned unchecked JSON. It now requires the allocated key and a nonempty URL before reporting success; uncertain/invalid completion retains durable recovery.

The added tests reproduce the deadline and abort-on-retry failures against the old implementation. They do not establish which failure occurred on the reported devices. No production logs, configuration, host limits, bucket CORS or actual-device transfers were inspected. The historical submission error is not treated as a confirmed root cause.

## Verification

- Focused regression: **341 tests passed across 10 files** (multipart client, request deadlines, evidence client/reconciliation/store, pipeline, attachment/part/resume API authorization, and failed-capture UI).
- Chromium fixture: **11 tests passed**; eight new photo/video attachment-timeout cases at 390px/1280px in light/dark verify retained originals and existing attachments, keyboard Retry, no overflow, one allocation and one byte transfer despite two attachment attempts. Existing 320px/390px/1440px failure/reselection cases remain passing. Four timeout screenshots were visually inspected across both sizes/themes. The final fixture uses a generated valid PNG; unsupported video intentionally falls back to the original.
- `npx tsc --noEmit`: **passed**, exit 0.
- `npm run lint`: **passed**, exit 0, existing repository warnings.
- Final production rebuild after all source edits: **passed**, 735/735 pages, exit 0, 253 seconds (initial build also passed in 334 seconds). Build used a deliberately closed loopback PostgreSQL URL on port 55439 and disabled scheduler; expected unavailable-database warnings are not production failures. Generated service workers and temporary tsconfig edits were excluded from the deliverable.
- Coverage run: **238 tests passed**. All three changed source files have **100% line and function coverage**. Branch coverage is **99.73%** for `lib/cleaner/evidence-client.ts`, **98.13%** for `lib/uploads/multipart-client.ts`, and **100%** for `lib/uploads/request.ts`; each passes the unchanged 95% line/branch/function gate. Added cases exercise scope changes, missing/corrupt journals and receipts, safe URL validation, acknowledged removal/moves, partial batch results, exact-key recovery, progress accounting and cancellation. The request helper checks cancellation after cleanup so generic browser abort errors and readers that catch aborts still report the caller/deadline reason; ordinary network/parse errors propagate unchanged. No exclusions or coverage suppressions were introduced.
- A broader full-suite sweep was started, then intentionally stopped after it exposed four draft-lifecycle failures and the focused checks/build/browser tests were complete. It is **not a passing full-suite result**. An untouched archive of `afba905f` independently reproduced the same **4 failures / 48 passes** in `tests/components/job-workspace-draft-lifecycle.test.tsx`: identity restoration and three submission/GPS guard assertions. Those pre-existing tests were not changed.
- `git diff --check`: passed. No real-database integration tests were run; API tests mock persistence and providers.

Logs are under `/workspace/scratch/upload-reliability/`. Browser tests bundle the real capture component with synthetic API routes and browser IndexedDB; they do not access real jobs, a database or storage provider. Video fixture deliberately exercises unsupported-codec fallback to preserved original bytes. Existing multipart tests also cover large blobs, bounded concurrency, partial success, lost completion, exact-key resumption, CORS fallback, cancellation and authorization API boundaries.

No database schema change; no migration or data backfill. No live cleaner records, media objects, credentials, production forms or production configuration were mutated.

## Release requirements

Deploy a reviewed root webapp build and restart its application process through the existing authorized release process. Existing browser/PWA clients must receive the new bundle; refresh only when no upload is active, retaining recovery originals. No storage settings or migrations are required. Verify one photo, a multi-photo batch, a phone video and an interrupted Retry on a nonproduction assigned fixture using the actual supported mobile browsers and network, then monitor sanitized upload telemetry. Do not delete/reupload existing job evidence as a deployment step.

## Review and publication scope

Self-review found no unresolved blocking finding in the focused change. No route, server permission, receipt payload, storage configuration or database schema is broadened. Request deadlines retain original/prepared bytes, allocated keys and receipts; invalid or uncertain acknowledgements fail explicitly. Cleanup can no longer abort a pre-existing resumed allocation. Cancellation and read/parse failures are covered without weakening the coverage threshold. The four reproduced baseline draft-lifecycle failures remain outside this fix.

The fix is committed locally on `fix/cleaner-upload-reliability-20261028`. Draft PR publication is blocked: automatic approval review rejected the first connected GitHub `create_blob` upload (`lib/uploads/request.ts` to `sanuthdesitha/sNeek_Property_Services_Webapp`), saying the user had not explicitly authorized external publication of source code. The action was denied, not pending or uncertain; no blob upload, remote branch mutation or PR creation succeeded. No alternate route or retry was attempted. CLI authentication also reports an invalid token, while the connected app reports push/admin permission. Explicit user publication authorization is required before retrying. See the delivery response for the final local commit SHA and patch. No merge or deployment is authorized; deployment approval remains pending.

## 2026-11-17 follow-up: large videos fail on some phones only

Owner report: "Cleaner still having issues uploading large video files that keeps failing on their end but works for some cleaners. I've checked the same video." Same file, different outcome, so the failure depends on the device or network, not the file. No production logs, failure rows or affected device were available; **the cause below is inferred from the code and is not confirmed on the affected cleaner's phone.**

**Confirmed in code (before this change).**
1. `lib/uploads/multipart-client.ts` sent 5 MB parts three at a time, each through `uploadRequest(..., 120_000)` (a fixed total deadline in `lib/uploads/request.ts`). Each part needed about 42 KB/s; three sharing the uplink needed about 1 Mbps upload. Below that every part timed out however healthy the connection was. The same video on Wi-Fi or a faster phone succeeded.
2. Any thrown direct PUT (including that timeout) set `useProxy = true` for the rest of the upload, resending through `/api/uploads/part` (slower, again with 120 s).
3. Three attempts with 0.5 s and 1 s backoff.
4. fetch has no upload progress; progress moved only when a whole 5 MB part landed, so a slow link looked frozen for minutes.
5. Signed part URLs expire after 3600 s; the only recovery for a 403 was the proxy.

**Other device-dependent points found.**
- Compression (`lib/uploads/compress-video.ts`) depends on WebCodecs AVC encoding and OPFS `createWritable`. Where either is missing (notably some iPhone/Safari versions) and the clip is over 25 MB, or the codec is unsupported, the original is uploaded; it can be several times larger (4K HEVC), multiplying the time at risk. Now visible in the failure log as `encoding`.
- Storage closes a socket idle for about 20 s with HTTP 400 `RequestTimeout`; the client treated every 400 as permanent. Now retried.
- A hidden or locked phone can freeze the tab; the new stall timer re-arms while hidden (the ceiling still applies). Uploads still pause while the screen is locked; that cannot be fixed in a web page.
- When IndexedDB is unavailable the original is held only in memory ("Keep this page open"); closing or reloading the tab loses it. Unchanged.
- Server limit, not changed: Node's default `requestTimeout` of 300 s (Next does not override it; the app runs `next start` in a container) bounds one proxied 5 MB part, so the proxy needs about 17 KB/s. Any reverse proxy in front of the app may add its own body timeout; not inspected. The proxy is now used only for immediate refusals, missing ETags and unrefreshable 403s.
- The capture did not log failures at all (only the classic dropzone did), so there were no rows to look at.

**Changed.** `lib/uploads/part-transport.ts` (new): one part over XMLHttpRequest with upload progress; fails on 60 s without bytes moving (twice that waiting for the answer after the last byte), 15-minute ceiling per attempt; fetch fallback bounded by the ceiling. `multipart-client.ts`: first outstanding part alone, then 3 / 2 / 1 parts at ≥256 KB/s / ≥96 KB/s / slower, 1 after any stall; 5 attempts with 1/2/4/8 s backoff; offline waits up to 5 minutes for `online` without spending attempts; stall/timeout retried on the same route; proxy only for an immediate zero-byte network refusal while online, a missing ETag, or a 403 that cannot be fixed by refreshing URLs (refresh through `resume-multipart` after 5 minutes, only if it returns the same key and upload id); live byte progress, never backwards, failed attempts not double counted; connection advice and failure diagnostics callbacks. `media-capture.tsx`: "Your connection is slow. Keep this page open; the video is still uploading." (below 48 KB/s or after a stall) and an offline line in the existing capture advice; final video failures logged to the existing log-failure endpoint with scalar context. Both upload-failure lists show a summary line. No schema, route or permission change.

**What the office should look at after deploy** (Admin › System health › Uploads, or `/admin/system/uploads`), for the affected cleaner:
- `S3_TIMEOUT` with a low kbps (for example under 400) and several stalls: the phone's connection; ask the cleaner to upload on Wi-Fi or stay on the page; check `network` (2g/3g/4g).
- `NETWORK_ERROR` / offline: the phone lost its connection for more than 5 minutes.
- `PART_REJECTED` with HTTP 403 via app server: signed URLs or permissions; with 400/401 the session or storage refused.
- `PRESIGN_REJECTED`: allocation, completion or resume failed (session, folder, content type).
- `encoding: original unsupported` or `original not smaller`: that phone could not shrink the video; a shorter clip helps.
- Parts done close to total with a stall: retry from the saved upload resumes without resending parts.
- No row at all while the cleaner reports a failure: the bundle may not be updated on that phone (PWA cache), or the failure happened before the upload (device storage).

**Verification.** See the review record entry of the same date for test counts and what was inspected in the browser. Real storage transfers on an actual slow phone were not exercised.
