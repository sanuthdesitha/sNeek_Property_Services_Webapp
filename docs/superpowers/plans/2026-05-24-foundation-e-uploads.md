# Plan E — Upload Pipeline Reliability

**Goal:** Replace ad-hoc file inputs with `<UploadDropzone>` that handles compression, multipart upload for >10MB files, retry with exponential backoff, IndexedDB drafts queue, and admin-visible failure log.

**Architecture:** Browser-side compression + multipart-aware uploader. Server presigned URLs (existing endpoint extended). Failures persist to `UploadFailure` model (added Plan A). Admin failures page at `/admin/system/uploads`.

**Tech Stack:** `browser-image-compression` (installed Plan A), AWS S3 multipart via presigned part URLs, IndexedDB for draft queue.

---

## Prerequisites

1. Plan A merged (UploadFailure model exists).
2. S3 credentials configured in env.

---

## Task 1: Upload audit + telemetry baseline

**Files:** add structured logging to existing `/api/uploads/presign` and any existing client-side uploaders. Capture: presign-request, upload-start, upload-progress, upload-complete, upload-fail counts.

## Task 2: Client-side image compression

**Files:** `lib/uploads/compress.ts`, `tests/lib/compress.test.ts`

- [ ] Wrapper around `browser-image-compression`. Target ≤800 KB, max dimension 2400px, 80% quality. Returns `Blob`.
- [ ] Video: server-side FFmpeg already exists; client-side just checks size and warns if >100 MB.

## Task 3: Multipart upload client

**Files:** `lib/uploads/multipart-client.ts`, `app/api/uploads/presign-multipart/route.ts`, `app/api/uploads/presign-multipart-part/route.ts`, `app/api/uploads/complete-multipart/route.ts`

- [ ] Initiate multipart, upload parts in parallel (3 concurrent), complete. Each part presigned server-side.
- [ ] Use for files > 10 MB only.

## Task 4: IndexedDB draft queue

**Files:** `lib/uploads/draft-store.ts`

- [ ] Persist upload state on navigation/disconnect. Resume on return. Surface count in top-bar pill.

## Task 5: `<UploadDropzone>` primitive

**Files:** `components/ui/upload-dropzone.tsx`, `tests/components/upload-dropzone.test.tsx`

- [ ] Drag-drop + file picker. Compresses, decides single-PUT vs multipart, shows progress bar with bytes/sec + ETA, retry with exponential backoff (3 attempts).
- [ ] On final failure, records to `UploadFailure` via API call.

## Task 6: Replace ad-hoc uploaders across app

**Files:** all surfaces currently using a file `<input>` for media — cleaner job submission, QA media, property photos, etc. Audit + replace.

## Task 7: Admin failures dashboard

**Files:** `app/admin/system/uploads/page.tsx`, `app/api/admin/system/uploads/route.ts`

- [ ] List recent `UploadFailure` rows. Filters by user, job, reason. Mark as resolved action.

## Task 8: Full verification + push + PR
