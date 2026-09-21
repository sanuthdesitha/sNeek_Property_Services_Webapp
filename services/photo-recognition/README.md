# Dedicated property photo recognition

This service trains a separate location classifier for each property on top of a fixed OpenCLIP visual encoder. It does not fine-tune Anthropic or retrain the CLIP backbone. It recognizes submitted-photo destinations; it does not score cleanliness, assess damage, or replace human review.

## Provisioning

Provision a compatible **local** OpenCLIP `ViT-B-32` checkpoint and mount it read-only. `OPENCLIP_CHECKPOINT` must name that local file. No checkpoint download occurs at startup or during a request. Follow the [OpenCLIP project](https://github.com/mlfoundations/open_clip) instructions to select and obtain weights and review their license before deployment. Set `OPENCLIP_MODEL` if using another compatible locally provisioned architecture. The checkpoint digest is bound to every trained version.

Build the Docker image in this directory. Mount a persistent volume at `/data/models`, the checkpoint at a read-only path, and supply `MODEL_SERVICE_TOKEN` (at least 24 characters). Set the application's server-only `MODEL_SERVICE_URL` and matching `MODEL_SERVICE_TOKEN`. Use a private network or TLS reverse proxy; never expose the token in browser code. Enable **dedicated property recognition** explicitly in AI configuration only after provisioning. The CPU image is the default. GPU deployment requires an appropriate CUDA PyTorch image/dependency installation and `MODEL_DEVICE=cuda`.

All endpoints require `Authorization: Bearer <token>`. `/health` verifies authenticated reachability but does not load weights or establish inference quality. Run one worker per storage volume; per-property filesystem locks serialize training across processes sharing that volume. Use a local persistent filesystem that supports atomic rename and advisory locking.

## API

- `POST /v1/properties/{propertyId}/train`: `{revision, labels:[{id,label,sectionLabel}], examples:[{id,sectionId,jobId,image:{mediaType,data}}]}`. At most 200 examples, 100 sections, 5 MiB decoded per image and 100 MiB total. The application supplies only eligible same-property, nonexcluded, submitted field assignments. Response is `promoted`, `rejected`, or `insufficient_data`, with metrics and a reason. A promoted result includes `modelVersion`.
- `POST /v1/properties/{propertyId}/predict`: `{libraryRevision, photos:[{id,mediaType,data}], fields:[{id,label,sectionLabel}]}`. At most eight photos and 20 MiB decoded total. Response includes `trained`, optional `modelVersion`, and exactly one assignment per photo. Null destinations require manual assignment. The application must compare returned model version with its current training receipt.

The same property/revision request replays its durable result without encoding images again. Reusing a revision with different data is a conflict. Versions are immutable and predictions load the exact requested revision, so a delayed older training request cannot replace a newer request's model. New submissions/exclusions must change the application's desired revision before another prediction; a model for an older library is never silently substituted.

## Validation and retention

At least two sections and three distinct jobs per section are required. Exact duplicate image bytes are deduplicated across jobs before splitting; conflicting labels for identical photos are rejected. This prevents exact reuploads from inflating validation, but is not a guarantee against visually similar photographs. Complete jobs are separated into training and validation sets; each section retains at least two training jobs. Validation jobs are never included in the promoted prototypes. Candidate promotion requires at least 80% accuracy and balanced accuracy, including ambiguity abstentions as failures. When a previous model exists, evaluation uses the same held-out jobs and rejects regressions. If changed exclusions leave no independent validation job, the service waits for more data. Changing the visual encoder requires an explicit migration and is not automatically promoted.

Nearest-centroid cosine comparison rejects weak or ambiguous matches. Its confidence is a conservative similarity/margin score, **not a calibrated probability**. Hidden/full destinations remain in competition so their photos cannot be forced into another room. Current labels and sections must match the model's normalized training labels.

Raw photos are decoded in memory and are not retained. Artifacts contain prototypes, labels, example/job identifiers, metrics, a request digest, and immutable receipts. Versions have no automatic expiry; operators must define their retention policy before production use. Removing the property's hashed directory removes all its artifacts; stop processing that property and coordinate the application's revision first. Excluded data is omitted from newly trained models, and the application must stop requesting older revisions. Historical versions remain retained until an operator deletes them.

## Tests and limits

Create a virtual environment, install `requirements-test.txt`, and run `python -m pytest tests`. Tests use a deterministic fake encoder; they do not download weights, send production photos, or prove recognition accuracy on real properties. A production deployment still needs provisioned weights and held-out property validation. The Docker image was not built as part of the mocked test run.
