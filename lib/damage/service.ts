/**
 * Damage report persistence: draft autosave, and submit.
 *
 * Three decisions worth knowing before changing anything here.
 *
 * ONE CASE PER ITEM. Each DamageItem opens exactly one DAMAGE IssueTicket, and
 * createCase() raises the matching repair through CP-7
 * (lib/cases/service.ts -> autoCreateMaintenanceForDamageCase). Batching items
 * into a single case would make CP-7 raise one repair for several faults, and
 * DamageItem.caseId is UNIQUE so the database refuses that anyway.
 *
 * CASES ARE CREATED INVISIBLE. The old submit path opened damage cases with
 * clientVisible: true, so the client saw the damage the moment a cleaner hit
 * submit — through the cases workspace, regardless of any report-level gate.
 * The locked decision is that damage reaches the client only after admin
 * review, so both the report and its cases start hidden and D2's review raises
 * them together. A report-level flag alone would not have held.
 *
 * SUBMIT IS RESUMABLE, NOT ATOMIC. Cases are opened one at a time after the
 * rows are committed, each guarded, and the item records its caseId as soon as
 * it has one. If case 3 of 5 fails, the report is still submitted and the first
 * two keep their cases — re-running submit only fills the gaps, because an item
 * that already has a caseId is skipped. Wrapping five external-effect calls in
 * one transaction would instead roll back a report the cleaner has already been
 * told was sent.
 */

import { DamageReportStatus, type DamageSeverity } from "@prisma/client";
import { db } from "@/lib/db";
import { createCase } from "@/lib/cases/service";
import { caseSeverityForDamage } from "@/lib/damage/severity";
import { ensureFlattened } from "@/lib/qa/annotation-composite";
import { isEmptyDamageItem, type DamageItemDraftInput } from "@/lib/damage/validation";
import { logger } from "@/lib/logger";

/** Everything the cleaner form needs to rehydrate. */
const REPORT_INCLUDE = {
  items: {
    orderBy: { createdAt: "asc" },
    include: { photos: { orderBy: { createdAt: "asc" } } },
  },
} as const;

/**
 * The cleaner's open draft for this job, created on first use.
 *
 * Scoped to (job, cleaner, DRAFT): two cleaners on the same job each keep their
 * own report rather than overwriting one another's evidence.
 */
export async function getOrCreateDamageDraft(input: {
  jobId: string;
  propertyId: string;
  userId: string;
}) {
  const existing = await db.damageReport.findFirst({
    where: {
      jobId: input.jobId,
      reportedById: input.userId,
      status: DamageReportStatus.DRAFT,
    },
    include: REPORT_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  if (existing) return existing;

  return db.damageReport.create({
    data: {
      jobId: input.jobId,
      propertyId: input.propertyId,
      reportedById: input.userId,
      status: DamageReportStatus.DRAFT,
    },
    include: REPORT_INCLUDE,
  });
}

/**
 * Replace the draft's items with what the form currently holds.
 *
 * Replace rather than diff: the form owns the whole list, autosave fires on
 * every edit, and reconciling per-field would let a dropped request leave the
 * saved draft in a state the cleaner never saw. Photos are re-created with
 * their items — they carry no server-side state beyond their keys, and the
 * uploaded objects themselves are untouched by this.
 *
 * Refuses to touch anything already submitted: autosave from a stale tab must
 * not rewrite a report an admin is reviewing.
 */
export async function saveDamageDraft(input: {
  reportId: string;
  userId: string;
  items: DamageItemDraftInput[];
}) {
  const report = await db.damageReport.findUnique({
    where: { id: input.reportId },
    select: { id: true, reportedById: true, status: true },
  });
  if (!report) throw new Error("DAMAGE_REPORT_NOT_FOUND");
  if (report.reportedById !== input.userId) throw new Error("FORBIDDEN");
  if (report.status !== DamageReportStatus.DRAFT) throw new Error("DAMAGE_REPORT_NOT_EDITABLE");

  // Items are replaced wholesale, so any case already opened for an item has
  // to be carried across explicitly. Without this, editing a reopened report
  // (D4's KEEP_AND_REOPEN void) would drop every caseId, and resubmitting would
  // open a SECOND case per damage — CP-7 would then raise duplicate repairs for
  // one fault. The form echoes the server id back as `clientId`, which is what
  // makes the match possible.
  const existingCaseIds = new Map<string, string>();
  const existingItems = await db.damageItem.findMany({
    where: { reportId: input.reportId, caseId: { not: null } },
    select: { id: true, caseId: true },
  });
  for (const item of existingItems) {
    if (item.caseId) existingCaseIds.set(item.id, item.caseId);
  }

  return db.$transaction(async (tx) => {
    await tx.damageItem.deleteMany({ where: { reportId: input.reportId } });

    for (const item of input.items) {
      const carriedCaseId = item.clientId ? existingCaseIds.get(item.clientId) : undefined;
      await tx.damageItem.create({
        data: {
          reportId: input.reportId,
          caseId: carriedCaseId ?? null,
          area: item.area,
          category: item.category,
          severity: item.severity,
          description: item.description,
          suspectedCause: item.suspectedCause,
          // estimatedCost is intentionally never written here — admin-only.
          photos: {
            create: item.photos.map((photo) => ({
              s3Key: photo.s3Key,
              annotatedKey: photo.annotatedKey ?? null,
              flatKey: photo.flatKey ?? null,
              caption: photo.caption ?? null,
              section: photo.section,
            })),
          },
        },
      });
    }

    return tx.damageReport.findUnique({
      where: { id: input.reportId },
      include: REPORT_INCLUDE,
    });
  });
}

/**
 * Flatten every annotated photo in the report into a single opaque image.
 *
 * Annotations are stored as a transparent overlay beside the original, which
 * must never be shown on its own — on transparency it renders as a black tile
 * once any pipeline converts it to JPEG. Flattening produces the composite that
 * reports, cases and the investigation page actually display.
 *
 * Done at SUBMIT, not on autosave: compositing costs an image round-trip per
 * photo, and a cleaner still adjusting their marks would pay it on every
 * keystroke. ensureFlattened is idempotent and best-effort — a photo whose
 * composite fails keeps its original key and still displays.
 */
async function flattenReportPhotos(reportId: string, ownerId: string) {
  const photos = await db.damageItemPhoto.findMany({
    where: { item: { reportId }, annotatedKey: { not: null }, flatKey: null },
    select: { id: true, s3Key: true, annotatedKey: true, flatKey: true },
  });
  if (photos.length === 0) return;

  const flattened = await ensureFlattened(
    photos.map((photo) => ({
      key: photo.s3Key,
      annotatedKey: photo.annotatedKey,
      flatKey: photo.flatKey,
    })),
    ownerId
  );

  await Promise.all(
    flattened.map((ref, index) => {
      const photo = photos[index];
      if (!ref.flatKey || !photo) return null;
      return db.damageItemPhoto.update({
        where: { id: photo.id },
        data: { flatKey: ref.flatKey },
      });
    })
  );
}

/**
 * One DAMAGE case per item, each guarded so a single failure cannot strand the
 * rest or undo a report the cleaner has already been told was submitted.
 * Skips items that already hold a caseId, which makes a re-run fill only gaps.
 */
async function openCasesForReport(input: {
  report: {
    id: string;
    jobId: string;
    propertyId: string;
    items: Array<{
      id: string;
      caseId: string | null;
      area: string;
      category: string;
      description: string;
      severity: DamageSeverity;
      photos: Array<{ s3Key: string; flatKey: string | null }>;
    }>;
    job: { property: { clientId: string | null } | null } | null;
  };
  userId: string;
}) {
  for (const item of input.report.items) {
    if (item.caseId) continue;

    try {
      const title = `${item.category} — ${item.area}`.trim();
      const description = [`Area / room: ${item.area}`, item.description]
        .filter(Boolean)
        .join("\n\n");

      const created = await createCase({
        title: title || "Reported damage",
        description,
        // Cleaner grading translated into the ops scale CP-7 reads.
        severity: caseSeverityForDamage(item.severity),
        status: "OPEN",
        caseType: "DAMAGE",
        source: "DAMAGE_REPORT",
        jobId: input.report.jobId,
        clientId: input.report.job?.property?.clientId ?? null,
        propertyId: input.report.propertyId,
        // Hidden until admin review — see the module header.
        clientVisible: false,
        clientCanReply: false,
        metadata: {
          damageReportId: input.report.id,
          damageItemId: item.id,
          tags: ["damage", "damage-report"],
        },
        // Names the reporter explicitly. createCase derives CP-7's required
        // `reportedByUserId` from `comment.authorUserId ?? attachments[0]
        // .uploadedByUserId ?? ... ?? ""`, and an empty string violates a
        // NOT NULL foreign key — which CP-7 catches and only logs. Relying on
        // the attachment fallback meant a damage item with no photo produced
        // NO maintenance item at all, silently, and admin never saw the repair.
        comment: {
          authorUserId: input.userId,
          body: description || title || "Reported damage",
          isInternal: false,
        },
        attachments: item.photos.map((photo) => ({
          uploadedByUserId: input.userId,
          // Prefer the flattened composite so the case carries the annotations.
          s3Key: photo.flatKey || photo.s3Key,
        })),
      });

      if (created) {
        await db.damageItem.update({ where: { id: item.id }, data: { caseId: created.id } });
      }
    } catch (error) {
      logger.error(
        { err: error, damageItemId: item.id, damageReportId: input.report.id },
        "Damage case creation failed — the report itself is saved and re-running submit will retry this item"
      );
    }
  }
}

/**
 * Commit the draft: persist the final items, mark it SUBMITTED, then open one
 * DAMAGE case per item so CP-7 raises the repairs.
 *
 * Blank cards are dropped rather than rejected — an empty extra card is a
 * normal artefact of "add item", and failing the whole submission over one is
 * hostile to somebody standing in a property with a dying phone.
 */
export async function submitDamageReport(input: {
  reportId: string;
  userId: string;
  items: DamageItemDraftInput[];
}) {
  const populated = input.items.filter((item) => !isEmptyDamageItem(item));
  if (populated.length === 0) throw new Error("DAMAGE_REPORT_EMPTY");

  await saveDamageDraft({ reportId: input.reportId, userId: input.userId, items: populated });

  // Before the cases are opened, so each case attaches the flattened composite
  // rather than an un-marked original.
  await flattenReportPhotos(input.reportId, input.userId);

  const submitted = await db.damageReport.update({
    where: { id: input.reportId },
    data: {
      status: DamageReportStatus.SUBMITTED,
      submittedAt: new Date(),
      // clientVisible stays false — D2's admin review is what reveals it.
    },
    include: {
      ...REPORT_INCLUDE,
      job: { select: { property: { select: { clientId: true } } } },
    },
  });

  await openCasesForReport({ report: submitted, userId: input.userId });

  return db.damageReport.findUnique({
    where: { id: input.reportId },
    include: REPORT_INCLUDE,
  });
}
