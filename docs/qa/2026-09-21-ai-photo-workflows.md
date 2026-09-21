# AI photo workflows and dedicated property recognition — 21 September 2026

## What is implemented

The system has three connected functions:

1. **Photo assignment:** cleaners bulk-upload photos, request analysis of all acknowledged unassigned images, review suggestions, then apply them. Requests run in bounded sequential batches. Manual assignments, field capacity and newer receipt versions take precedence over stale suggestions. Cancellation keeps completed proposals; retries do not automatically resend a request whose result is uncertain.
2. **Property recognition:** a dedicated Python service uses a fixed, locally provisioned OpenCLIP visual encoder and trains a separate section classifier for each property. This is actual fitting of property-specific classifier prototypes, not fine-tuning the foundation encoder. New submitted forms and admin exclusions invalidate the current app model receipt and queue an updated training run. Untrained, stale, uncertain or unavailable models fall back to vision-assisted suggestions when that provider is configured; otherwise photos remain available for manual assignment.
3. **Reference comparison:** a vision model compares submitted photos with uploaded form reference images, flags visible issues and proposes deductions. Prior submitted images are location examples, never an automatically accepted cleanliness standard. QA/admin approval is required before scores change.

For example, Property 12 → Bathroom → Shower accumulates labelled examples from distinct previous jobs. A new shower photo is compared with that property's learned section representations. Ambiguous shower/sink matches remain unassigned for review. A dirty historical shower can help identify the location but cannot establish that dirt is acceptable.

## Continuous learning and controls

Historical compatibility update: previous job report photos are read directly from `SubmissionMedia` and their linked `FormSubmission`, the same database records used to generate reports. A saved template snapshot takes precedence; older submissions fall back to their linked form template. Photos attached to checkbox/status rows are valid labelled evidence too. Verified legacy job-bound and submitter-bound upload paths are supported, with unrelated job/actor paths still rejected. The browser automatically scans past unsupported records and provides source-job links. No duplicate upload or extraction from rendered report PDFs is needed for these records. Archived report images without a remaining database media row and canonical field association are not guessed into training labels.

Compatibility-update verification: 113 tests passed across seven files, TypeScript validation passed, and three styled browser checks passed at 320/390/1440 pixels. Focused coverage across the five changed source files is 100% lines, 85.95% branches and 90% functions; the advisory 95% target is not met for every metric. Tests use synthetic records; no production photos were fetched or retrained in this update.

The canonical section labels come from server-written form snapshots, not arbitrary request labels. Recognition keeps properties separate. It rejects reused field IDs with different labels and ambiguous label aliases. Historical fallback samples up to two examples per field from the latest 100 eligible submissions, with one example per field per job. Training samples up to 20 distinct jobs per field, 200 images overall. Sampling is bounded rather than uploading the entire archive on every request.

Admin → AI configuration → Property photo memory displays historical labelled photos grouped by section. Only compatible, recent examples enter a training or matching sample. Exclude outdated, mislabelled or unhelpful photos with a recorded reason; Restore makes them eligible again. The original job evidence remains intact. Exclusion edits invalidate a ready classifier in the same transaction as the edit. An old in-flight training or prediction cannot silently reactivate it.

The service requires at least two sections and sufficient distinct jobs to reserve validation jobs while retaining two training jobs per section. It removes exact image duplicates before checking sample sufficiency and prevents previously trained bytes from masquerading as independent validation. Candidate promotion requires at least 80% accuracy and balanced accuracy on the held-out examples and no regression against the preceding compatible classifier on the same evaluation set. These small-sample checks are safeguards, not a guarantee of production accuracy. The confidence field is a similarity/margin score, not a calibrated probability.

Training versions and durable receipts are immutable. Retrying the same revision/data replays its result; a revision reused with different data is rejected. Predictions request the exact revision and the app checks its model version. Artifacts retain labels, prototypes and sample identifiers, not raw uploaded images. Historical artifacts require an operator retention policy; excluding an image does not erase old versions from service storage. See the service README for removal and storage controls.

## QA approval

Successful form submission queues reference comparison without waiting for image analysis. The `ai-photo-review` scheduler runs every five minutes in both supported scheduler hosts and processes leased batches. Missing uploaded references or inconclusive comparisons are shown as unassessed.

On the admin/QA job page, reviewers inspect submitted and reference photos side by side, select eligible findings, write a reason and approve or dismiss. Minor and major findings suggest 2 and 5 points; multiple views of the same field count only the largest deduction, subject to the configured cap. Existing scored QA issues for the same field or media block a duplicate deduction. The displayed authoritative score must still match when approval commits. Score, job outcome and audit decision are one transaction; repeat approvals cannot deduct twice. The QA inspector must own the relevant assignment and authoritative QA review. Admin/ops can approve; impersonation and invoiced jobs are blocked.

## Deployment

These features are off by default. They have not been trained or tested on production property photos in this implementation session.

1. Deploy the app and apply both new Prisma migrations through the normal migration process: `20260921120000_ai_photo_review` and `20260921130000_property_photo_model`. Generate the Prisma client for the deployed schema.
2. For comparison and vision fallback, set server-only `ANTHROPIC_API_KEY` and optionally `ANTHROPIC_MODEL`. The model is configurable; the default is `claude-sonnet-5`. Use the admin connection check to verify access. Credential presence alone is not a successful connection test.
3. Deploy `services/photo-recognition` with its persistent model volume and a compatible local OpenCLIP checkpoint. Supply a shared `MODEL_SERVICE_TOKEN` of at least 24 characters, then set the app's private `MODEL_SERVICE_URL` and matching token. The service README contains the HTTP contract, CPU/GPU requirements and storage rules. No checkpoint downloads occur during app requests. Provisioning weights and building the Docker image remain deployment steps.
4. Enable dedicated recognition and/or the vision features in AI configuration. Review the property's example library, then use **Train/update model** for its initial model. Future submissions and memory edits queue updates automatically. Both scheduler hosts include `ai-property-model-training`, which claims one property at a time every five minutes.
5. Inspect training status. `NEEDS_DATA` requires more independently labelled jobs; `REJECTED` means validation did not pass. `READY` means the model passed its configured sample validation, not that every new photo will be correct. Verify actual examples in a pilot before relying on acceptance rates.

Model-service authentication, reachability, checkpoint loading, actual inference accuracy and deployed scheduler operation are separate checks. The generic health endpoint proves authenticated reachability only. Provider credentials, production database access and real property images were not used in automated tests.

## Verification record

The focused integrated TypeScript run covers settings, provider schemas, photo loading, historical scoping, model client, leased queues, reviewer authorization, score changes, strict evidence moves, bulk batching, draft saves, admin memory and submission integration. Separate browser fixtures check the real React controls with synthetic responses at mobile and desktop widths. Python service tests use a deterministic fake encoder and exercise HTTP authentication, model isolation, immutable retries, validation separation and rejection behavior. They do not measure OpenCLIP accuracy.

Prisma schema generation and TypeScript validation passed. Real PostgreSQL migration/concurrency verification was attempted against the pre-existing disposable local test installation, but its runtime and catalog files are incomplete. Creating a fresh cluster, database and isolated schema was blocked by missing files. No new schema or fixtures were created, and the test server was stopped. This is an explicit verification gap, not a migration pass.

The final focused run passed **398 tests in 27 files**. The model service passed **18 Python tests**, and synthetic browser checks passed **12 cases** across settings/QA review, bulk assignment and property memory. The final production build passed compilation, type validation and generation of all **715 pages** in 548 seconds (exit 0), including the cross-submission deduction guard. The project has no required dev-kit coverage gate. Of 33 touched TypeScript source files, ten meet the default 95% line/branch/function target, 22 are below it in this focused run, and one is not measured. See `2026-09-21-ai-photo-coverage.md`; this is not a full-suite baseline or 95% certification.

## Useful next AI applications

- **Before leaving the property:** flag blurry photos, missing angles and likely wrong rooms while the cleaner can still correct them.
- **Daily operations brief:** summarize overdue work, missed laundry returns, access problems and unresolved exceptions with links to source records.
- **Voice-to-work-order:** turn cleaner voice notes into structured maintenance drafts and translate instructions for review.
- **Recurring property issues:** identify repeated shower, lock, linen and appliance problems across jobs; propose maintenance rather than repeatedly treating symptoms.
- **Client reply drafts:** assemble answers grounded in job status, photos and approved reports; staff review before sending.
- **Invoice exception explanations:** explain deterministic reconciliation results, such as started jobs omitted from a billing period, without making the language model the authority for arithmetic.

These are proposals; this delivery implements the photo workflows described above.
