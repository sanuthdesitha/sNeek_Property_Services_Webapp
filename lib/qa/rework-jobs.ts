/**
 * Rework / reclean jobs.
 *
 * When QA fails a clean it can spin off a dedicated **rework Job** (distinct from
 * a normal job — `Job.isRework = true`). The rework job carries the exact areas
 * QA flagged plus the photos QA captured, so the cleaner sees what to fix and
 * uploads an "after" photo per area. Rework jobs never create laundry pickups.
 *
 * Pay rule (owner spec):
 *   • SAME cleaner redoes it  → they are paid nothing for the rework job
 *     (custom payout 0). No deduction.
 *   • DIFFERENT cleaner redoes it → that cleaner is paid `reworkPayAmount`
 *     (a per-cleaner custom payout) and the SAME amount is deducted from the
 *     original cleaner (a negative, already-APPROVED CleanerPayAdjustment on the
 *     original job). Admin/QA decide the amount.
 *
 * The dynamic checklist is generated from `reworkAreas` (see
 * `buildReworkFormSchema`) and rendered by the existing cleaner form engine — one
 * section per flagged area with QA's photo shown as a reference and a required
 * "after" photo upload. No new cleaner UI is needed.
 */
import { randomUUID } from "crypto";
import sharp from "sharp";
import { JobStatus, JobAssignmentResponseStatus, JobType, PayAdjustmentScope, PayAdjustmentStatus, PayAdjustmentType } from "@prisma/client";
import { db } from "@/lib/db";
import type { FormSchema } from "@/lib/forms/types";
import { parseJobInternalNotes, serializeJobInternalNotes } from "@/lib/jobs/meta";
import { reserveJobNumber } from "@/lib/jobs/job-number";
import { roundCents } from "@/lib/finance/job-money";
import { s3 } from "@/lib/s3";

/** Cleaner "after" photo upload fields are keyed `rework_area_<areaId>`. */
export const REWORK_AREA_FIELD_PREFIX = "rework_area_";

export interface ReworkArea {
  id: string;
  label: string;
  note?: string;
  /** S3 keys of the photos QA captured for this flagged area. */
  photoKeys: string[];
  /** Optional per-photo markup (overlay PNG + comment) keyed by photo S3 key. */
  annotations?: Record<string, { overlayKey?: string; comment?: string }>;
}

async function getObjectBuffer(key: string): Promise<Buffer | null> {
  try {
    const res = await s3.getObject({ Bucket: process.env.S3_BUCKET_NAME!, Key: key }).promise();
    const body: any = res.Body;
    if (!body) return null;
    return Buffer.isBuffer(body) ? body : Buffer.from(body);
  } catch {
    return null;
  }
}

/**
 * Flatten a QA markup overlay onto its photo into a single annotated image the
 * cleaner sees as reclean guidance. Returns the new S3 key, or null on any
 * failure (caller falls back to the original photo).
 */
async function compositeAnnotated(originalKey: string, overlayKey: string, ownerId: string): Promise<string | null> {
  try {
    const [orig, overlay] = await Promise.all([getObjectBuffer(originalKey), getObjectBuffer(overlayKey)]);
    if (!orig || !overlay) return null;
    const meta = await sharp(orig).rotate().metadata();
    const w = meta.width;
    const h = meta.height;
    if (!w || !h) return null;
    const overlayResized = await sharp(overlay).resize(w, h, { fit: "fill" }).png().toBuffer();
    const out = await sharp(orig)
      .rotate()
      .composite([{ input: overlayResized }])
      .jpeg({ quality: 85 })
      .toBuffer();
    const key = `qa-reclean-guidance/${ownerId}/${randomUUID()}.jpg`;
    await s3
      .putObject({ Bucket: process.env.S3_BUCKET_NAME!, Key: key, Body: out, ContentType: "image/jpeg" })
      .promise();
    return key;
  } catch {
    return null;
  }
}

export function reworkTagFor(originalJobId: string) {
  return `rework-of:${originalJobId}`;
}

/** Coerce arbitrary JSON (Job.reworkAreas) into a clean ReworkArea[]. */
export function normalizeReworkAreas(input: unknown): ReworkArea[] {
  if (!Array.isArray(input)) return [];
  const out: ReworkArea[] = [];
  input.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") return;
    const item = raw as Record<string, unknown>;
    const label = typeof item.label === "string" ? item.label.trim() : "";
    if (!label) return;
    const id =
      typeof item.id === "string" && item.id.trim()
        ? item.id.trim()
        : `area-${index + 1}`;
    const note = typeof item.note === "string" ? item.note.trim() || undefined : undefined;
    const photoKeys = Array.isArray(item.photoKeys)
      ? item.photoKeys
          .filter((key): key is string => typeof key === "string" && key.trim().length > 0)
          .map((key) => key.trim())
      : [];
    out.push({ id, label, note, photoKeys });
  });
  return out;
}

/**
 * Build the dynamic cleaner checklist for a rework job: one section per flagged
 * area, each with a read-only "what QA flagged" block (note + QA photos as image
 * references) and a required "after" photo upload. References use `storageKey`
 * so the form API presigns them at render time.
 */
/** Access + safety checklist shown on EVERY rework visit, regardless of the
 *  flagged areas — lockbox/key evidence + a door/window safety check. */
function buildAccessSafetySection() {
  return {
    id: "rework_access_safety",
    title: "Access & safety (every visit)",
    description: "Confirm access and lock-up for this visit before you start the fixes.",
    fields: [
      {
        id: "rework_lockbox_key_photo",
        type: "photo" as const,
        mediaMode: "photo" as const,
        label: "Lockbox / key evidence",
        required: true,
        minPhotos: 1,
        stampTag: "before" as const,
        instructions: "Photo of the key back in the lockbox / returned, showing the code scrambled or key secured.",
      },
      {
        id: "rework_doors_windows_secure",
        type: "checkbox" as const,
        label: "All doors and windows locked / secured on leaving",
        required: true,
      },
      {
        id: "rework_safety_note",
        type: "textarea" as const,
        label: "Safety / access notes (optional)",
        required: false,
        placeholder: "Anything the office should know about access or safety on this visit.",
      },
    ],
  };
}

/** One fix item → a checkbox (fixed), a note area, and an after photo/video. */
function buildAreaFields(area: ReworkArea) {
  return [
    {
      id: `${area.id}__qa_flag`,
      type: "instruction" as const,
      label: "What QA flagged",
      instructions:
        area.note ||
        "QA marked this area as not meeting the standard. Compare against the photo, re-clean, and capture an after photo.",
      references: area.photoKeys.map((key) => ({
        kind: "image" as const,
        url: "",
        storageKey: key,
        caption: "QA photo",
      })),
      showExampleOnTick: true,
    },
    {
      id: `${area.id}__fixed`,
      type: "checkbox" as const,
      label: `Fixed / re-cleaned — ${area.label}`,
      required: true,
    },
    {
      id: `${area.id}__note`,
      type: "textarea" as const,
      label: "Notes (what you did / anything to flag)",
      required: false,
      placeholder: "Describe how you addressed it, or note anything the office should know.",
    },
    {
      id: `${REWORK_AREA_FIELD_PREFIX}${area.id}`,
      type: "photo" as const,
      // Allow the cleaner to attach an after PHOTO or VIDEO for this area.
      mediaMode: "both" as const,
      label: `After photo / video — ${area.label}`,
      required: true,
      minPhotos: 1,
      stampTag: "after" as const,
      instructions: "Upload a clear after photo (or short video) showing this area now meets the standard.",
    },
  ];
}

/**
 * Build the cleaner's rework fix checklist. Always starts with the Access &
 * safety section (lockbox/key + door lock-up), then the QA-flagged items. When
 * `categorized` (default) each flagged item is its own section; otherwise all
 * items live under a single "Fix the flagged items" section.
 */
export function buildReworkFormSchema(
  areas: ReworkArea[],
  opts?: { categorized?: boolean },
): FormSchema {
  const categorized = opts?.categorized !== false;
  const sections: FormSchema["sections"] = [buildAccessSafetySection() as any];

  if (categorized) {
    for (const area of areas) {
      sections.push({
        id: area.id,
        title: `Fix: ${area.label}`,
        description: area.note || "QA flagged this area — re-clean it and upload an after photo.",
        fields: buildAreaFields(area) as any,
      } as any);
    }
  } else {
    sections.push({
      id: "rework_items",
      title: "Fix the flagged items",
      description: "QA flagged these items — re-clean each and upload an after photo.",
      fields: areas.flatMap((area) => buildAreaFields(area)) as any,
    } as any);
  }

  return { sections };
}

/**
 * A reusable hidden FormTemplate per job type so a rework FormSubmission can
 * satisfy the required template FK. The real per-job schema lives on the
 * submission's `data.__templateSchema`; this row just anchors the relation and
 * never appears in the normal active-template lists (isActive = false).
 */
export async function ensureReworkFormTemplate(jobType: JobType) {
  const existing = await db.formTemplate.findFirst({
    where: { serviceType: jobType, isActive: false, name: "Rework checklist" },
  });
  if (existing) return existing;
  return db.formTemplate.create({
    data: {
      name: "Rework checklist",
      serviceType: jobType,
      kind: "CUSTOM",
      isActive: false,
      schema: { sections: [] } as any,
    },
  });
}

/** The original (pre-rework) primary cleaner for a job, if any. */
async function getOriginalPrimaryCleanerId(originalJobId: string): Promise<string | null> {
  const assignment = await db.jobAssignment.findFirst({
    where: { jobId: originalJobId, removedAt: null },
    orderBy: [{ isPrimary: "desc" }, { assignedAt: "asc" }],
    select: { userId: true },
  });
  return assignment?.userId ?? null;
}

export interface CreateReworkJobInput {
  originalJobId: string;
  qaUserId: string;
  reason: string;
  areas: ReworkArea[];
  sourceReviewId?: string | null;
  /** Cleaner to assign the rework to. Defaults to the original primary cleaner. */
  assignToCleanerId?: string | null;
  /** Amount to pay the rework cleaner (only when a DIFFERENT cleaner is assigned). */
  payAmount?: number | null;
  /** Optional scheduled date for the rework (defaults to +4h from now). */
  scheduledDate?: Date | null;
  /** Hours QA allocates to the rework — becomes the rework job's estimatedHours.
   *  Null/undefined → inherit the original job's estimate. */
  allocatedHours?: number | null;
  /** Group the cleaner checklist by area (default true) or a single flat list. */
  categorized?: boolean;
}

/**
 * Create (or return the existing open) rework job for a failed clean. Assigns the
 * cleaner, snapshots the flagged areas, and wires the pay decision via the
 * canonical custom-payout map. Returns the rework job id.
 */
export async function createReworkJobFromFailure(input: CreateReworkJobInput): Promise<string> {
  const original = await db.job.findUnique({
    where: { id: input.originalJobId },
    select: {
      id: true,
      propertyId: true,
      jobType: true,
      startTime: true,
      dueTime: true,
      estimatedHours: true,
      scheduledDate: true,
    },
  });
  if (!original) throw new Error("Original job not found for rework.");

  // Dedupe: never spin up a second open rework for the same source job.
  const existingRework = await db.job.findFirst({
    where: {
      isRework: true,
      reworkOfJobId: input.originalJobId,
      status: { notIn: [JobStatus.COMPLETED, JobStatus.INVOICED] },
    },
    select: { id: true },
  });
  if (existingRework) return existingRework.id;

  const originalCleanerId = await getOriginalPrimaryCleanerId(input.originalJobId);
  const assignCleanerId = input.assignToCleanerId ?? originalCleanerId;
  const isDifferentCleaner = Boolean(
    assignCleanerId && originalCleanerId && assignCleanerId !== originalCleanerId
  );
  const payAmount =
    isDifferentCleaner && input.payAmount != null && Number.isFinite(input.payAmount)
      ? roundCents(Math.max(0, Number(input.payAmount)))
      : 0;

  // Custom payout: same cleaner → 0 (no pay). Different cleaner → the agreed amount.
  const cleanerPayouts: Record<string, number> = {};
  if (assignCleanerId) cleanerPayouts[assignCleanerId] = payAmount;

  const scheduledDate =
    input.scheduledDate ?? new Date(Date.now() + 4 * 60 * 60 * 1000);

  const internalNotes = serializeJobInternalNotes({
    internalNoteText: `Rework of job ${input.originalJobId}. ${input.reason}`.trim().slice(0, 4000),
    tags: ["rework", reworkTagFor(input.originalJobId)],
    cleanerPayouts,
    // Persist the QA's layout choice so the cleaner's fix checklist honours it.
    reworkCategorized: input.categorized !== false,
  });

  // Flatten any QA markup onto its photo so the cleaner's reclean guidance shows
  // a single annotated image, and fold the markup comments into the area note.
  const areasForJob: ReworkArea[] = await Promise.all(
    input.areas.map(async (area) => {
      const ann = area.annotations ?? {};
      const noteParts = [area.note?.trim()].filter(Boolean) as string[];
      const photoKeys: string[] = [];
      for (const key of area.photoKeys) {
        const a = ann[key];
        if (a?.overlayKey) {
          const flat = await compositeAnnotated(key, a.overlayKey, input.qaUserId);
          photoKeys.push(flat || key);
        } else {
          photoKeys.push(key);
        }
        if (a?.comment) noteParts.push(`📌 ${a.comment}`);
      }
      return { id: area.id, label: area.label, note: noteParts.join(" — ") || undefined, photoKeys };
    })
  );

  const reworkJobId = await db.$transaction(async (tx) => {
    const jobNumber = await reserveJobNumber(tx);
    const job = await tx.job.create({
      data: {
        jobNumber,
        propertyId: original.propertyId,
        jobType: original.jobType,
        status: assignCleanerId ? JobStatus.ASSIGNED : JobStatus.UNASSIGNED,
        scheduledDate,
        startTime: original.startTime,
        dueTime: original.dueTime,
        // QA-allocated rework hours drive the cleaner pay basis; fall back to the
        // original job's estimate when QA didn't specify.
        estimatedHours:
          input.allocatedHours != null && Number.isFinite(input.allocatedHours) && input.allocatedHours > 0
            ? input.allocatedHours
            : original.estimatedHours,
        notes: "Rework — fix the QA-flagged areas and upload after photos.",
        internalNotes,
        isRework: true,
        reworkOfJobId: input.originalJobId,
        reworkReason: input.reason.trim().slice(0, 4000),
        reworkAreas: areasForJob as any,
        reworkPayAmount: payAmount > 0 ? payAmount : null,
        reworkPayeeCleanerId: isDifferentCleaner ? assignCleanerId : null,
        reworkDeductFromCleanerId: isDifferentCleaner ? originalCleanerId : null,
        reworkSourceReviewId: input.sourceReviewId ?? null,
      },
    });

    if (assignCleanerId) {
      await tx.jobAssignment.create({
        data: {
          jobId: job.id,
          userId: assignCleanerId,
          isPrimary: true,
          assignedById: input.qaUserId,
          responseStatus: JobAssignmentResponseStatus.ACCEPTED,
          respondedAt: new Date(),
        },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: input.qaUserId,
        jobId: input.originalJobId,
        action: "QA_REWORK_JOB_CREATE",
        entity: "Job",
        entityId: job.id,
        after: {
          reworkJobId: job.id,
          areas: input.areas.length,
          assignCleanerId,
          differentCleaner: isDifferentCleaner,
          payAmount,
        } as any,
      },
    });

    return job.id;
  });

  // Apply the cross-cleaner deduction once, at creation, when a different cleaner
  // is taking it on for pay.
  if (isDifferentCleaner && payAmount > 0) {
    await applyReworkDeduction({
      reworkJobId,
      reviewerUserId: input.qaUserId,
    });
  }

  return reworkJobId;
}

/**
 * Deduct the rework pay amount from the ORIGINAL cleaner (negative approved pay
 * adjustment on the original job). Idempotent via Job.reworkDeductionApplied.
 */
export async function applyReworkDeduction(params: {
  reworkJobId: string;
  reviewerUserId: string;
}): Promise<void> {
  const rework = await db.job.findUnique({
    where: { id: params.reworkJobId },
    select: {
      id: true,
      reworkOfJobId: true,
      reworkPayAmount: true,
      reworkDeductFromCleanerId: true,
      reworkDeductionApplied: true,
      propertyId: true,
      property: { select: { name: true } },
    },
  });
  if (!rework) return;
  if (rework.reworkDeductionApplied) return;
  const amount = roundCents(Math.max(0, Number(rework.reworkPayAmount ?? 0)));
  if (amount <= 0 || !rework.reworkDeductFromCleanerId || !rework.reworkOfJobId) return;

  await db.$transaction(async (tx) => {
    await tx.cleanerPayAdjustment.create({
      data: {
        jobId: rework.reworkOfJobId!,
        propertyId: rework.propertyId,
        cleanerId: rework.reworkDeductFromCleanerId!,
        scope: PayAdjustmentScope.JOB,
        title: `Rework reassigned — ${rework.property?.name ?? "property"}`,
        type: PayAdjustmentType.FIXED,
        requestedAmount: -amount,
        approvedAmount: -amount,
        status: PayAdjustmentStatus.APPROVED,
        cleanerNote: "Clean failed QA and was redone by another cleaner; the rework pay is deducted here.",
        reviewedById: params.reviewerUserId,
        reviewedAt: new Date(),
      },
    });
    await tx.job.update({
      where: { id: rework.id },
      data: { reworkDeductionApplied: true },
    });
  });
}

/**
 * Admin decision: (re)assign a rework job to a cleaner and set the pay. When the
 * payee differs from the original cleaner, applies the deduction; when it's the
 * same cleaner, the rework pays nothing. Reversible amounts are not supported —
 * once a deduction is applied it stays applied (a new decision adds another row).
 */
export async function setReworkPayDecision(params: {
  reworkJobId: string;
  reviewerUserId: string;
  payeeCleanerId: string;
  amount: number;
}): Promise<void> {
  const rework = await db.job.findUnique({
    where: { id: params.reworkJobId },
    select: {
      id: true,
      isRework: true,
      reworkOfJobId: true,
      internalNotes: true,
      reworkDeductionApplied: true,
      // Needed to reconcile a CHANGED deduction on a re-decide (below).
      reworkPayAmount: true,
      reworkDeductFromCleanerId: true,
      propertyId: true,
      property: { select: { name: true } },
    },
  });
  if (!rework || !rework.isRework) throw new Error("Not a rework job.");

  // Capture the previously-applied deduction BEFORE the update overwrites it, so
  // a re-decide can post a compensating adjustment for the delta (see below).
  const deductionWasApplied = rework.reworkDeductionApplied;
  const previousDeduction = deductionWasApplied
    ? roundCents(Math.max(0, Number(rework.reworkPayAmount ?? 0)))
    : 0;
  const previousDeductCleanerId = rework.reworkDeductFromCleanerId;

  const originalCleanerId = rework.reworkOfJobId
    ? await getOriginalPrimaryCleanerId(rework.reworkOfJobId)
    : null;
  const isDifferent = Boolean(originalCleanerId && params.payeeCleanerId !== originalCleanerId);
  const amount = isDifferent ? roundCents(Math.max(0, Number(params.amount) || 0)) : 0;

  const meta = parseJobInternalNotes(rework.internalNotes);
  const cleanerPayouts = { ...meta.cleanerPayouts };
  // The previous payee (if any) loses their custom payout; the new payee gets it.
  for (const key of Object.keys(cleanerPayouts)) delete cleanerPayouts[key];
  cleanerPayouts[params.payeeCleanerId] = amount;

  await db.$transaction(async (tx) => {
    // Move/refresh the primary assignment to the chosen payee.
    await tx.jobAssignment.updateMany({
      where: { jobId: rework.id, removedAt: null, userId: { not: params.payeeCleanerId } },
      data: { removedAt: new Date() },
    });
    await tx.jobAssignment.upsert({
      where: { jobId_userId: { jobId: rework.id, userId: params.payeeCleanerId } },
      update: { removedAt: null, isPrimary: true, responseStatus: JobAssignmentResponseStatus.ACCEPTED, respondedAt: new Date() },
      create: {
        jobId: rework.id,
        userId: params.payeeCleanerId,
        isPrimary: true,
        assignedById: params.reviewerUserId,
        responseStatus: JobAssignmentResponseStatus.ACCEPTED,
        respondedAt: new Date(),
      },
    });
    await tx.job.update({
      where: { id: rework.id },
      data: {
        status: JobStatus.ASSIGNED,
        internalNotes: serializeJobInternalNotes({ ...meta, cleanerPayouts }),
        reworkPayAmount: amount > 0 ? amount : null,
        reworkPayeeCleanerId: isDifferent ? params.payeeCleanerId : null,
        reworkDeductFromCleanerId: isDifferent ? originalCleanerId : null,
      },
    });
  });

  const newDeduction = isDifferent ? amount : 0;

  if (!deductionWasApplied) {
    // First decision — apply the deduction once (unchanged behaviour).
    if (newDeduction > 0) {
      await applyReworkDeduction({ reworkJobId: rework.id, reviewerUserId: params.reviewerUserId });
    }
  } else if (newDeduction !== previousDeduction && previousDeductCleanerId && rework.reworkOfJobId) {
    // RE-DECISION with a changed amount/payee: the original cleaner already has
    // a −previousDeduction adjustment. Post a compensating adjustment for the
    // delta so their net deduction becomes −newDeduction (previously this path
    // updated the payee's payout but never corrected the deduction, so lowering
    // the amount over-deducted and raising it left money unrecovered).
    const delta = roundCents(previousDeduction - newDeduction); // added to the original cleaner
    if (delta !== 0) {
      await db.cleanerPayAdjustment.create({
        data: {
          jobId: rework.reworkOfJobId,
          propertyId: rework.propertyId,
          cleanerId: previousDeductCleanerId,
          scope: PayAdjustmentScope.JOB,
          title: `Rework pay adjusted — ${rework.property?.name ?? "property"}`,
          type: PayAdjustmentType.FIXED,
          requestedAmount: delta,
          approvedAmount: delta,
          status: PayAdjustmentStatus.APPROVED,
          cleanerNote:
            "Rework pay decision changed; this corrects the earlier deduction to the new amount.",
          reviewedById: params.reviewerUserId,
          reviewedAt: new Date(),
        },
      });
    }
    // Keep the flag consistent: a net-zero deduction is no longer "applied".
    await db.job.update({
      where: { id: rework.id },
      data: { reworkDeductionApplied: newDeduction > 0 },
    });
  }
}
