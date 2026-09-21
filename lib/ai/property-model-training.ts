import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getVisionSettings } from "./vision-settings";
import { readPropertyTrainingExamples } from "./historical-assignment-examples";
import { loadVisionImage } from "./images";
import { getRecognitionConfiguration, trainPropertyRecognition } from "./property-photo-model";

/** Invalidate a trained model in the same transaction as new labels/exclusions. */
export async function enqueuePropertyModelTraining(propertyId: string, tx: Prisma.TransactionClient = db, force = false) {
  const enabled = force || await getVisionSettings().then(settings => settings.dedicatedRecognitionEnabled).catch(() => false);
  if (!enabled) {
    // An existing model must become stale even while training is switched off.
    const existing = await tx.aiPropertyModelTraining.findUnique({ where: { propertyId }, select: { propertyId: true } });
    if (!existing) return false;
  }
  const desiredRevision = randomUUID();
  await tx.aiPropertyModelTraining.upsert({ where: { propertyId },
    create: { propertyId, desiredRevision },
    update: { desiredRevision, status: "PENDING", leaseToken: null, leaseUntil: null, attempts: 0, error: null },
  });
  return true;
}

export async function processPropertyModelTrainingQueue() {
  if (!(await getVisionSettings()).dedicatedRecognitionEnabled || !getRecognitionConfiguration().configured) return { processed: 0 };
  const now = new Date();
  await db.aiPropertyModelTraining.updateMany({ where: { status: "RUNNING", leaseUntil: { lt: now }, attempts: { gte: 3 } }, data: { status: "FAILED", leaseToken: null, leaseUntil: null, error: "Training was interrupted repeatedly. Request a new training run." } });
  const candidates = await db.aiPropertyModelTraining.findMany({ where: { attempts: { lt: 3 }, OR: [{ status: "PENDING" }, { status: "RUNNING", leaseUntil: { lt: now } }] }, orderBy: { updatedAt: "asc" }, take: 1 });
  let processed = 0;
  for (const candidate of candidates) {
    const token = randomUUID();
    const owned = { propertyId: candidate.propertyId, desiredRevision: candidate.desiredRevision, leaseToken: token, status: "RUNNING" };
    const claim = await db.aiPropertyModelTraining.updateMany({ where: { propertyId: candidate.propertyId, desiredRevision: candidate.desiredRevision, updatedAt: candidate.updatedAt, attempts: { lt: 3 }, OR: [{ status: "PENDING" }, { status: "RUNNING", leaseUntil: { lt: now } }] }, data: { status: "RUNNING", attempts: { increment: 1 }, leaseToken: token, leaseUntil: new Date(Date.now() + 30 * 60_000) } });
    if (!claim.count) continue;
    try {
      const library = await readPropertyTrainingExamples(candidate.propertyId);
      if (!library.examples.length) {
        const saved = await db.aiPropertyModelTraining.updateMany({ where: owned, data: { status: "NEEDS_DATA", error: "No eligible labelled submissions are available for this property.", leaseToken: null, leaseUntil: null } });
        if (saved.count) processed++;
        continue;
      }
      const examples = [];
      let bytes = 0;
      for (const sample of library.examples) {
        const image = await loadVisionImage(sample.storageKey, sample.mediaId);
        bytes += Buffer.byteLength(image.data, "base64");
        if (bytes > 100 * 1024 * 1024) throw new Error("Training image budget exceeded.");
        examples.push({ id: sample.mediaId, sectionId: sample.fieldId, fieldLabel: sample.fieldLabel, sectionLabel: sample.sectionLabel, jobId: sample.sourceJobId, image });
      }
      // Exclusions, replacement submissions and feature changes cancel stale work
      // before any image is disclosed, and again before promotion in the app.
      const fresh = await readPropertyTrainingExamples(candidate.propertyId);
      const state = await db.aiPropertyModelTraining.findUnique({ where: { propertyId: candidate.propertyId } });
      if (fresh.revision !== library.revision || state?.desiredRevision !== candidate.desiredRevision || state?.leaseToken !== token || state?.status !== "RUNNING" || !state.leaseUntil || state.leaseUntil <= new Date() || !(await getVisionSettings()).dedicatedRecognitionEnabled) throw new Error("Training scope changed.");
      const result = await trainPropertyRecognition({ propertyId: candidate.propertyId, revision: candidate.desiredRevision, examples });
      if ((await readPropertyTrainingExamples(candidate.propertyId)).revision !== library.revision || !(await getVisionSettings()).dedicatedRecognitionEnabled) throw new Error("Training examples changed.");
      const promoted = result.status === "promoted";
      if (promoted && (!result.modelVersion?.trim() || result.modelVersion.length > 200)) throw new Error("Missing trained model receipt.");
      const saved = await db.aiPropertyModelTraining.updateMany({ where: owned, data: {
        status: promoted ? "READY" : result.status === "insufficient_data" ? "NEEDS_DATA" : "REJECTED",
        ...(promoted ? { trainedRevision: candidate.desiredRevision, modelVersion: result.modelVersion, lastTrainedAt: new Date() } : {}),
        metricsJson: { ...(result.metrics ?? {}), libraryRevision: library.revision, exampleCount: examples.length } as Prisma.InputJsonObject,
        error: promoted ? null : result.status === "insufficient_data" ? "More labelled examples from separate jobs are needed before this model can be used." : "The candidate did not pass validation. Review the examples before training again.",
        leaseToken: null, leaseUntil: null,
      } });
      if (saved.count) processed++;
    } catch {
      await db.aiPropertyModelTraining.updateMany({ where: owned, data: { status: "FAILED", leaseToken: null, leaseUntil: null, error: "Training could not finish. Check the dedicated model service and examples, then request another run." } }).catch(() => undefined);
    }
  }
  return { processed };
}
