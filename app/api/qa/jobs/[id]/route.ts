import { NextRequest, NextResponse } from "next/server";
import { JobStatus, QaAssignmentStatus, QaReworkSeverity, Role, StockRunStatus } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { buildDefaultQaTemplateSchema, scoreQaSubmission, QA_TEMPLATE_VERSION } from "@/lib/qa/templates";
import { generateJobReport } from "@/lib/reports/generator";
import { createCase } from "@/lib/cases/service";
import { createQaReworkTransfer } from "@/lib/qa/rework-transfers";
import { createReworkJobFromFailure } from "@/lib/qa/rework-jobs";
import { parseJobInternalNotes, serializeJobInternalNotes } from "@/lib/jobs/meta";
import { QA_TOOLS_DATA_KEY, minutesBetween } from "@/lib/qa/inspection-tools";
import { publicUrl, getPresignedDownloadUrl } from "@/lib/s3";
import { getAppSettings } from "@/lib/settings";
import {
  computeAccountabilityScore,
  sanitizeAccountabilityAssessment,
} from "@/lib/accountability/scoring";
import {
  getCleanerRecurringIssues,
  getPropertyRecurringIssues,
} from "@/lib/accountability/patterns";
import {
  notifyQaResultToCleaner,
  notifyManagementReviewFlagged,
  notifyFalseConfirmationSuspected,
  notifyReworkOfferToCleaner,
} from "@/lib/notifications/accountability";
import { QaIssueSeverity, FalseConfirmationStatus } from "@prisma/client";
import { buildQaBrief, type BriefItem, type QaBriefContext } from "@/lib/qa/brief-rules";
import { buildOfferWindow, effectiveOfferStatus } from "@/lib/qa/rework-offers";
import {
  assertReworkInvoiceablePayee,
  assertSelfReworkMinutes,
  guardInvariant,
} from "@/lib/qa/rework-invariants";
import { canReopenInspection, reopenMoneyWarnings } from "@/lib/qa/reopen";
import { normalizeFormSchema } from "@/lib/forms/normalize-schema";
import { collectReopenMoneyFacts } from "@/lib/qa/reopen-facts";

const QA_ROLES = [Role.QA_INSPECTOR, Role.OPS_MANAGER, Role.ADMIN] as const;

const damageEntrySchema = z.object({
  id: z.string().optional(),
  area: z.string().trim().max(160).default(""),
  description: z.string().trim().max(2000).default(""),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  photoKeys: z.array(z.string().trim().min(1)).default([]),
  estimatedCost: z.number().min(0).nullable().optional(),
  annotations: z
    .record(z.object({ overlayKey: z.string().trim().min(1).optional(), comment: z.string().trim().max(2000).optional() }))
    .optional(),
});

const nextCleanSchema = z.object({
  id: z.string().optional(),
  kind: z.enum(["DEEP_CLEAN_AREA", "SPECIAL_REQUEST"]).default("SPECIAL_REQUEST"),
  area: z.string().trim().max(160).nullable().optional(),
  note: z.string().trim().min(1).max(2000),
});

const restockLineSchema = z.object({
  propertyStockId: z.string().min(1),
  quantity: z.number().min(0).default(0),
  note: z.string().trim().max(500).nullable().optional(),
});

const inventoryCountLineSchema = z.object({
  propertyStockId: z.string().min(1),
  countedOnHand: z.number().min(0),
  note: z.string().trim().max(500).nullable().optional(),
});

const flaggedAreaSchema = z.object({
  id: z.string().trim().min(1).optional(),
  label: z.string().trim().min(1).max(160),
  note: z.string().trim().max(2000).optional(),
  photoKeys: z.array(z.string().trim().min(1)).max(24).default([]),
  annotations: z
    .record(z.object({ overlayKey: z.string().trim().min(1).optional(), comment: z.string().trim().max(2000).optional() }))
    .optional(),
});

const reworkSchema = z.object({
  enabled: z.boolean().default(false),
  cleanerUserId: z.string().min(1).nullable().optional(),
  severity: z.enum(["MINOR", "MODERATE", "MAJOR"]).default("MINOR"),
  reason: z.string().trim().max(4000).default(""),
  areas: z.array(z.string().trim().min(1)).default([]),
  // Structured flagged areas (each with QA photos) → the rework checklist.
  flaggedAreas: z.array(flaggedAreaSchema).max(40).default([]),
  // Allocated hours QA assigns to the rework (drives the rework job's estimated
  // hours / cleaner pay basis). Null → inherit the original job's hours.
  allocatedHours: z.number().min(0).max(100).nullable().optional(),
  // Group the cleaner's fix checklist into one section per flagged area (true) or
  // present a single flat list of items (false).
  categorized: z.boolean().default(true),
  // The explicit end-of-inspection rework decision (Phase 4 Stage 1):
  //   OFFER_ORIGINAL → offer the fix back to the original cleaner ($0, TTL)
  //   OTHER          → reassign to a different cleaner (paid + equal deduction)
  //   QA_SELF        → the inspector fixes it (QaReworkTransfer, time/pay claim)
  // `assignee` is kept as the legacy wire field and stays authoritative for the
  // pay path; `decision` selects the flow around it.
  decision: z.enum(["OFFER_ORIGINAL", "OTHER", "QA_SELF"]).nullable().optional(),
  // Who redoes it + the pay decision.
  assignee: z.enum(["SAME", "OTHER"]).default("SAME"),
  payeeCleanerId: z.string().min(1).nullable().optional(),
  payAmount: z.number().min(0).max(1000000).default(0),
  // Legacy cleaner→QA transfer (pay-to-QA) fields, still accepted.
  minutesFromCleaner: z.number().min(0).max(100000).default(0),
  amountFromCleaner: z.number().min(0).max(1000000).default(0),
  affectsCleanerStats: z.boolean().default(true),
});

const toolsSchema = z
  .object({
    damage: z.array(damageEntrySchema).default([]),
    nextClean: z.array(nextCleanSchema).default([]),
    restock: z.array(restockLineSchema).default([]),
    inventoryCount: z.array(inventoryCountLineSchema).default([]),
    // Per-section QA photos: sectionId → S3 keys.
    sectionPhotos: z.record(z.array(z.string().trim().min(1)).max(24)).default({}),
    // Per-photo markup keyed by original S3 key.
    mediaAnnotations: z
      .record(
        z.object({
          overlayKey: z.string().trim().min(1).optional(),
          comment: z.string().trim().max(2000).optional(),
        })
      )
      .default({}),
    onSite: z
      .object({
        startedAt: z.string().datetime().nullable().optional(),
        endedAt: z.string().datetime().nullable().optional(),
        minutes: z.number().min(0).nullable().optional(),
      })
      .default({}),
    rework: reworkSchema.nullable().optional(),
    signOff: z
      .object({
        signatureKey: z.string().trim().min(1).nullable().optional(),
        attested: z.boolean().optional(),
        signedByName: z.string().trim().max(200).nullable().optional(),
        signedAt: z.string().datetime().nullable().optional(),
      })
      .nullable()
      .optional(),
  })
  .optional();

const submitSchema = z.object({
  assignmentId: z.string().trim().min(1).nullable().optional(),
  templateId: z.string().trim().min(1),
  data: z.record(z.unknown()),
  media: z.any().optional(),
  notes: z.string().trim().max(6000).optional(),
  tools: toolsSchema,
  // Accountability assessment blob (AccountabilityAssessmentInput). Parsed
  // defensively via sanitizeAccountabilityAssessment — kept permissive here so a
  // malformed blob degrades to the legacy path rather than 400-ing the submit.
  accountability: z.any().optional(),
  // AMENDMENT (see lib/qa/reopen.ts). Set when this submit is the re-submission
  // of a REOPENED inspection: the named QAReview is UPDATED in place (keeping
  // the job's single authoritative score and recording who changed it via the
  // editedById/editedAt fields) instead of a second review being created.
  reopenedReviewId: z.string().trim().min(1).nullable().optional(),
});

async function resolveTemplate(jobId: string) {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: { jobType: true, propertyId: true },
  });
  if (!job) return null;
  const propertyTemplate = await db.qaFormTemplate.findFirst({
    where: { propertyId: job.propertyId, serviceType: job.jobType, isActive: true },
    orderBy: { version: "desc" },
  });
  if (propertyTemplate) return propertyTemplate;
  const globalTemplate = await db.qaFormTemplate.findFirst({
    where: { propertyId: null, serviceType: job.jobType, isActive: true },
    orderBy: { version: "desc" },
  });
  if (globalTemplate) {
    // Auto-upgrade an auto-created "Default QA" template to the latest area-based
    // schema when it's stale; never touch an admin-customised (renamed) template.
    const schema = globalTemplate.schema as { version?: number } | null;
    const isAutoDefault = globalTemplate.name?.startsWith("Default QA -");
    const stale = !schema || typeof schema !== "object" || Number(schema.version ?? 0) < QA_TEMPLATE_VERSION;
    if (isAutoDefault && stale) {
      return db.qaFormTemplate.update({
        where: { id: globalTemplate.id },
        data: { schema: buildDefaultQaTemplateSchema(job.jobType) as any },
      });
    }
    return globalTemplate;
  }
  return db.qaFormTemplate.create({
    data: {
      name: `Default QA - ${String(job.jobType).replace(/_/g, " ")}`,
      serviceType: job.jobType,
      schema: buildDefaultQaTemplateSchema(job.jobType) as any,
    },
  });
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([...QA_ROLES]);
    const [job, template, assignment, mediaOverrides] = await Promise.all([
      db.job.findUnique({
        where: { id: params.id },
        include: {
          property: {
            select: {
              id: true,
              name: true,
              address: true,
              suburb: true,
              state: true,
              postcode: true,
              accessInfo: true,
              // Pre-inspection brief inputs (sofa bed / balcony rules, expected
              // hours baseline) + the check-in distance calculation.
              sofaBedCount: true,
              hasBalcony: true,
              assignedCleaningHours: true,
              latitude: true,
              longitude: true,
            },
          },
          assignments: {
            where: { removedAt: null },
            select: { user: { select: { id: true, name: true, email: true, hourlyRate: true } } },
          },
          jobTasks: true,
          laundryTask: { include: { confirmations: { orderBy: { createdAt: "desc" }, take: 1 } } },
          issueTickets: { orderBy: { createdAt: "desc" }, take: 10 },
          formSubmissions: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: { media: true, submittedBy: { select: { name: true, email: true } } },
          },
          qaReviews: { orderBy: { createdAt: "desc" }, take: 5 },
          qaFormSubmissions: { orderBy: { createdAt: "desc" }, take: 5, include: { submittedBy: { select: { name: true, email: true } } } },
          qaReworkTransfers: {
            orderBy: { createdAt: "desc" },
            take: 10,
            include: {
              cleaner: { select: { id: true, name: true, email: true } },
              qaUser: { select: { id: true, name: true } },
            },
          },
        },
      }),
      resolveTemplate(params.id),
      db.qaAssignment.findFirst({
        where: {
          jobId: params.id,
          status: { in: [QaAssignmentStatus.OPEN, QaAssignmentStatus.ASSIGNED, QaAssignmentStatus.IN_PROGRESS] },
          OR: [{ assignedToId: null }, { assignedToId: session.user.id }, { pickedUpById: session.user.id }],
        },
      }),
      db.mediaOverrideRequest.findMany({
        where: { jobId: params.id },
        include: {
          requestedBy: { select: { name: true, email: true } },
          decidedBy: { select: { name: true, email: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    if (!job || !template) return NextResponse.json({ error: "QA job not found." }, { status: 404 });

    // ── VISIBILITY SCOPING — an inspector may not open a job whose ACTIVE
    //    assignment belongs to another inspector. Admin/ops are unaffected, as
    //    are unassigned (OPEN pool) assignments and jobs with no assignment.
    if (session.user.role === Role.QA_INSPECTOR) {
      const activeAssignments = await db.qaAssignment.findMany({
        where: {
          jobId: params.id,
          status: { notIn: [QaAssignmentStatus.CANCELLED, QaAssignmentStatus.COMPLETED] },
        },
        select: { assignedToId: true, pickedUpById: true },
      });
      const foreignAssignment = activeAssignments.some(
        (a) =>
          a.assignedToId != null &&
          a.assignedToId !== session.user.id &&
          a.pickedUpById !== session.user.id
      );
      if (foreignAssignment) {
        return NextResponse.json(
          { error: "This inspection is assigned to another inspector." },
          { status: 403 }
        );
      }
    }

    // Property stock for the restock + full inventory count tools.
    const propertyStock = await db.propertyStock.findMany({
      where: { propertyId: job.propertyId },
      include: { item: { select: { id: true, name: true, unit: true, category: true, location: true } } },
      orderBy: [{ item: { location: "asc" } }, { item: { name: "asc" } }],
    });

    // The cleaners on the job roster — candidates for the rework transfer.
    const cleanerCandidates = job.assignments
      .map((a) => a.user)
      .filter((u): u is { id: string; name: string | null; email: string; hourlyRate: number | null } => Boolean(u));

    // The whole active cleaner roster — payee candidates for "Assign a
    // different cleaner", which must not be limited to who was on the job.
    const reworkPayeeCandidates = await db.user.findMany({
      where: { role: Role.CLEANER, isActive: true },
      select: { id: true, name: true, email: true, hourlyRate: true },
      orderBy: { name: "asc" },
    });

    // Resolve previously-saved per-section QA photos (keys → presigned URLs) so
    // re-opening the QA job shows the existing thumbnails.
    const latestQaSubmission = job.qaFormSubmissions?.[0];
    const savedTools =
      latestQaSubmission?.data && typeof latestQaSubmission.data === "object"
        ? (latestQaSubmission.data as Record<string, unknown>)[QA_TOOLS_DATA_KEY]
        : null;
    const savedSectionPhotos =
      savedTools && typeof savedTools === "object" && (savedTools as any).sectionPhotos
        ? ((savedTools as any).sectionPhotos as Record<string, unknown>)
        : {};
    const sectionPhotos: Record<string, Array<{ key: string; url: string }>> = {};
    for (const [sectionId, value] of Object.entries(savedSectionPhotos)) {
      const keys = Array.isArray(value) ? value.filter((k): k is string => typeof k === "string" && k.trim().length > 0) : [];
      if (keys.length === 0) continue;
      sectionPhotos[sectionId] = await Promise.all(
        keys.map(async (key) => {
          try {
            return { key, url: await getPresignedDownloadUrl(key, 600) };
          } catch {
            return { key, url: publicUrl(key) };
          }
        })
      );
    }

    // Presign the cleaner's submitted photos/videos so they actually render in
    // the QA review (the stored `url` is a private S3 URL that 403s otherwise).
    const latestSubmission = job.formSubmissions?.[0];
    if (latestSubmission?.media?.length) {
      await Promise.all(
        latestSubmission.media.map(async (m: any) => {
          if (m.s3Key) {
            try {
              m.url = await getPresignedDownloadUrl(m.s3Key, 3600);
            } catch {
              m.url = publicUrl(m.s3Key);
            }
          }
          if (m.annotatedS3Key) {
            try {
              m.annotatedUrl = await getPresignedDownloadUrl(m.annotatedS3Key, 3600);
            } catch {
              m.annotatedUrl = publicUrl(m.annotatedS3Key);
            }
          }
        })
      );
    }

    // ── CLEANER PHOTOS GROUPED BY THEIR FORM SECTION ─────────────────────────
    //    Map each submitted media's fieldId to the section it belongs to in the
    //    CLEANER form template, so the QA workspaces can show the cleaner's
    //    photos at the top of the matching QA section. Media whose field can't
    //    be located land under "Other". Best-effort — a failure leaves the list
    //    empty and the flat evidence gallery still works.
    let cleanerSectionMedia: Array<{ sectionTitle: string; mediaIds: string[] }> = [];
    if (latestSubmission?.media?.length) {
      try {
        const cleanerTemplate = await db.formTemplate.findUnique({
          where: { id: latestSubmission.templateId },
          select: { schema: true },
        });
        const cleanerSchema = cleanerTemplate?.schema
          ? normalizeFormSchema(cleanerTemplate.schema)
          : null;
        const sectionByFieldId = new Map<string, string>();
        for (const section of cleanerSchema?.sections ?? []) {
          const title =
            (typeof section?.title === "string" && section.title.trim()) || "Other";
          for (const field of section?.fields ?? []) {
            if (field?.id) sectionByFieldId.set(String(field.id), title);
          }
        }
        const grouped = new Map<string, string[]>();
        for (const m of latestSubmission.media as Array<{ id: string; fieldId: string | null }>) {
          const title = (m.fieldId && sectionByFieldId.get(m.fieldId)) || "Other";
          const list = grouped.get(title) ?? [];
          list.push(m.id);
          grouped.set(title, list);
        }
        cleanerSectionMedia = Array.from(grouped, ([sectionTitle, mediaIds]) => ({
          sectionTitle,
          mediaIds,
        }));
      } catch (err) {
        console.error("[qa-get] cleaner section media build failed", err);
        cleanerSectionMedia = [];
      }
    }

    // Recurring-issue watch-outs (Phase 7a) — the property's and the primary
    // cleaner's repeating QA categories, so the inspector knows where to look.
    // Read-time; degrades to empty lists and never blocks the QA load.
    let watchOuts: {
      cleaner: Awaited<ReturnType<typeof getCleanerRecurringIssues>>;
      property: Awaited<ReturnType<typeof getPropertyRecurringIssues>>;
    } = { cleaner: [], property: [] };
    try {
      const primaryAssignment = await db.jobAssignment.findFirst({
        where: { jobId: job.id, removedAt: null },
        orderBy: [{ isPrimary: "desc" }, { assignedAt: "asc" }],
        select: { userId: true },
      });
      const primaryCleanerId = primaryAssignment?.userId ?? null;
      const [cleaner, property] = await Promise.all([
        primaryCleanerId ? getCleanerRecurringIssues(primaryCleanerId) : Promise.resolve([]),
        getPropertyRecurringIssues(job.propertyId),
      ]);
      watchOuts = { cleaner, property };
    } catch {
      watchOuts = { cleaner: [], property: [] };
    }

    // ── PRE-INSPECTION BRIEF (Phase 4 Stage 1). Everything the inspector should
    //    know before walking in, compiled by the ordered rule set in
    //    lib/qa/brief-rules.ts. Read-time and fully degradable: any failure here
    //    yields an empty brief rather than blocking the inspection load.
    let brief: BriefItem[] = [];
    let briefContext: QaBriefContext | null = null;
    try {
      const primaryCleanerId = cleanerCandidates[0]?.id ?? null;
      const windowDays = 30;
      const since = new Date(Date.now() - windowDays * 86_400_000);
      const [timeLogs, severeIssues, priorJobsAtProperty, propertyReworkCount] = await Promise.all([
        db.timeLog.findMany({ where: { jobId: job.id }, select: { durationM: true } }).catch(() => []),
        primaryCleanerId
          ? db.qaIssue
              .groupBy({
                by: ["severity"],
                where: {
                  cleanerId: primaryCleanerId,
                  severity: { in: [QaIssueSeverity.MAJOR, QaIssueSeverity.CRITICAL] },
                  createdAt: { gte: since },
                },
                _count: { _all: true },
              })
              .catch(() => [] as Array<{ severity: QaIssueSeverity; _count: { _all: number } }>)
          : Promise.resolve([] as Array<{ severity: QaIssueSeverity; _count: { _all: number } }>),
        primaryCleanerId
          ? db.job
              .count({
                where: {
                  propertyId: job.propertyId,
                  id: { not: job.id },
                  assignments: { some: { userId: primaryCleanerId, removedAt: null } },
                },
              })
              .catch(() => 0)
          : Promise.resolve(0),
        db.job
          .count({
            where: { propertyId: job.propertyId, isRework: true, createdAt: { gte: since } },
          })
          .catch(() => 0),
      ]);

      const actualMinutes = (timeLogs as Array<{ durationM: number | null }>).reduce(
        (sum, log) => sum + Math.max(0, Number(log.durationM ?? 0)),
        0
      );
      const severeCounts = (severeIssues as Array<{ severity: QaIssueSeverity; _count: { _all: number } }>).reduce(
        (acc, row) => {
          if (row.severity === QaIssueSeverity.CRITICAL) acc.critical += row._count._all;
          if (row.severity === QaIssueSeverity.MAJOR) acc.major += row._count._all;
          return acc;
        },
        { major: 0, critical: 0 }
      );
      const jobMeta = parseJobInternalNotes(job.internalNotes);
      const reservation = jobMeta.reservationContext ?? null;
      const guestCheckInAt =
        (reservation as any)?.checkInAt ??
        (reservation as any)?.guestCheckInAt ??
        (reservation as any)?.checkIn ??
        null;

      briefContext = {
        now: new Date(),
        job: {
          id: job.id,
          jobType: String(job.jobType),
          status: String(job.status),
          formPendingAfterClockOut: Boolean((job as any).formPendingAfterClockOut),
          expectedHours:
            Number(job.estimatedHours ?? 0) > 0
              ? Number(job.estimatedHours)
              : Number(job.property?.assignedCleaningHours ?? 0) > 0
                ? Number(job.property?.assignedCleaningHours)
                : null,
          actualHours: actualMinutes > 0 ? Math.round((actualMinutes / 60) * 100) / 100 : null,
          isRework: Boolean((job as any).isRework),
        },
        property: {
          id: job.property?.id ?? job.propertyId,
          name: job.property?.name ?? "Property",
          sofaBedCount: Number(job.property?.sofaBedCount ?? 0),
          hasBalcony: Boolean(job.property?.hasBalcony),
        },
        cleaners: cleanerCandidates.map((c) => ({ id: c.id, name: c.name || c.email })),
        submission: latestSubmission
          ? {
              submittedAt: latestSubmission.createdAt?.toISOString?.() ?? null,
              photoCount: latestSubmission.media?.length ?? 0,
            }
          : null,
        lowStock: propertyStock
          .filter((s) => Number(s.onHand) <= Number(s.reorderThreshold))
          .map((s) => ({
            name: s.item?.name ?? "Item",
            onHand: Number(s.onHand),
            threshold: Number(s.reorderThreshold),
          })),
        laundry: job.laundryTask
          ? {
              required: true,
              confirmed: (job.laundryTask.confirmations?.length ?? 0) > 0,
            }
          : null,
        reservation: guestCheckInAt
          ? {
              guestCheckInAt: typeof guestCheckInAt === "string" ? guestCheckInAt : null,
              guestName: (reservation as any)?.guestName ?? null,
            }
          : null,
        propertyWatchOuts: watchOuts.property.map((w: any) => ({
          label: String(w.label ?? ""),
          count: Number(w.count ?? 0),
          category: String(w.category ?? ""),
        })),
        cleanerWatchOuts: watchOuts.cleaner.map((w: any) => ({
          label: String(w.label ?? ""),
          count: Number(w.count ?? 0),
          category: String(w.category ?? ""),
        })),
        cleanerRecentSevereIssues: { ...severeCounts, windowDays },
        cleanerPriorJobsAtProperty: Number(priorJobsAtProperty ?? 0),
        propertyReworkCount: Number(propertyReworkCount ?? 0),
      };
      brief = buildQaBrief(briefContext);
    } catch (err) {
      console.error("[qa-get] brief build failed", err);
      brief = [];
      briefContext = null;
    }

    // ── REOPEN / AMEND STATE (see lib/qa/reopen.ts) ──────────────────────────
    //    A submitted inspection is not terminal: the inspector who did it (or an
    //    admin / ops manager) can reopen it to correct a verdict, add a missed
    //    photo or fix a wrong score. Two mutually exclusive shapes:
    //      reopen          → nothing is open; offer the "Reopen inspection" action
    //                        (with the money warnings it will NOT undo).
    //      amendingReviewId→ an inspection is open again AND a QA review already
    //                        exists, so submitting UPDATES that review in place
    //                        instead of stacking a second one on the job.
    //    Fully degradable: any failure leaves both null and the page works as
    //    before.
    let reopen: {
      assignmentId: string;
      reviewId: string | null;
      eligible: boolean;
      blockedReason: string | null;
      completedAt: string | null;
      warnings: string[];
    } | null = null;
    let amendingReviewId: string | null = null;
    try {
      const latestQaReview = await db.qAReview.findFirst({
        where: { jobId: params.id, kind: "QA" },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (assignment) {
        amendingReviewId = latestQaReview?.id ?? null;
      } else {
        const completedAssignment = await db.qaAssignment.findFirst({
          where: { jobId: params.id, status: QaAssignmentStatus.COMPLETED },
          orderBy: [{ completedAt: "desc" }, { updatedAt: "desc" }],
        });
        if (completedAssignment) {
          const eligibility = canReopenInspection({
            actorUserId: session.user.id,
            actorRole: String(session.user.role),
            assignment: {
              status: String(completedAssignment.status),
              assignedToId: completedAssignment.assignedToId,
              pickedUpById: completedAssignment.pickedUpById,
            },
            jobStatus: String(job.status),
          });
          const facts = await collectReopenMoneyFacts(params.id, latestQaReview?.id ?? null);
          reopen = {
            assignmentId: completedAssignment.id,
            reviewId: latestQaReview?.id ?? null,
            eligible: eligibility.ok,
            blockedReason: eligibility.ok ? null : eligibility.message ?? null,
            completedAt: completedAssignment.completedAt?.toISOString() ?? null,
            warnings: reopenMoneyWarnings(facts),
          };
        }
      }
    } catch (err) {
      console.error("[qa-get] reopen state failed", err);
      reopen = null;
      amendingReviewId = null;
    }

    return NextResponse.json({
      job,
      template,
      assignment: assignment
        ? { ...assignment, reworkOfferStatus: effectiveOfferStatus(assignment as any) }
        : assignment,
      reopen,
      amendingReviewId,
      mediaOverrides,
      propertyStock,
      cleanerCandidates,
      reworkPayeeCandidates,
      sectionPhotos,
      cleanerSectionMedia,
      viewerRole: session.user.role,
      watchOuts,
      brief,
      briefContext,
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([...QA_ROLES]);
    const body = submitSchema.parse(await req.json());
    const template = await db.qaFormTemplate.findUnique({ where: { id: body.templateId } });
    if (!template) return NextResponse.json({ error: "QA template not found." }, { status: 404 });

    const job = await db.job.findUnique({
      where: { id: params.id },
      select: { id: true, status: true, propertyId: true, internalNotes: true, property: { select: { id: true, name: true, accessInfo: true } } },
    });
    if (!job) return NextResponse.json({ error: "QA job not found." }, { status: 404 });

    // Only inspect a job that has actually been submitted (SUBMITTED / QA_REVIEW)
    // or is being re-inspected (COMPLETED). Otherwise a QA submit could flip an
    // un-started job straight to COMPLETED, or reopen a locked INVOICED job.
    const QA_INSPECTABLE: JobStatus[] = [
      JobStatus.SUBMITTED,
      JobStatus.QA_REVIEW,
      JobStatus.COMPLETED,
    ];
    if (!QA_INSPECTABLE.includes(job.status)) {
      return NextResponse.json(
        { error: `This job is ${job.status.replace(/_/g, " ").toLowerCase()} and isn't ready for QA inspection.` },
        { status: 409 }
      );
    }

    const result = scoreQaSubmission(template.schema as any, body.data);
    const tools = body.tools ?? null;

    // ACCOUNTABILITY ASSESSMENT (Phase 4a). When the QA submit carries a
    // non-empty `accountability` blob, the deduction-based accountability score
    // becomes authoritative for the review's pass/fail (feeding effectivePassed
    // below), and per-verdict QaIssue rows are created. When the blob is absent
    // or empty this is null and the legacy percent path is byte-for-byte unchanged.
    const settings = await getAppSettings();
    const validCategories = settings.accountability.issueCategories.map((c) => c.key);
    const accountabilityInput = sanitizeAccountabilityAssessment(body.accountability, validCategories);
    const accountabilityResult = accountabilityInput
      ? computeAccountabilityScore(accountabilityInput, settings.accountability.scoring)
      : null;
    // When accountability is present its `passed` is authoritative; otherwise the
    // legacy numeric pass/fail stands.
    const reviewPassed = accountabilityResult ? accountabilityResult.passed : result.passed;

    // If the inspector enabled rework AND flagged areas, a rework job will be
    // created below — so the ORIGINAL job must NOT be marked COMPLETED just
    // because the numeric score passed. Otherwise the job is closed (invoice/
    // loyalty eligible) while an orphaned rework is spawned.
    const rkPre = tools?.rework;
    const willCreateRework = Boolean(
      rkPre?.enabled &&
        (((rkPre.flaggedAreas ?? []).length > 0) || ((rkPre.areas ?? []).length > 0))
    );
    // effectivePassed keeps its exact meaning — a spawned rework holds the job in
    // QA_REVIEW — but is now fed the accountability `passed` when present.
    const effectivePassed = reviewPassed && !willCreateRework;

    // A reassigned ("OTHER" cleaner) rework must name the payee + a pay amount,
    // else createReworkJobFromFailure silently falls back to the ORIGINAL
    // cleaner at $0 — a paid reassignment becoming an unpaid one on the wrong
    // person. Guard server-side (the client validates, but this is a public API).
    if (willCreateRework && rkPre?.assignee === "OTHER") {
      if (!rkPre.payeeCleanerId || !(Number(rkPre.payAmount) > 0)) {
        return NextResponse.json(
          { error: "Select the cleaner and a pay amount for a reassigned rework." },
          { status: 400 }
        );
      }
    }

    // Every flagged area feeding a rework job must carry the inspector's photo —
    // it's the cleaner's only evidence of what to fix. (Legacy flat `areas` have
    // no photo field and are exempt.)
    if (willCreateRework) {
      const missingPhotoArea = (rkPre?.flaggedAreas ?? []).find((a) => (a.photoKeys ?? []).length === 0);
      if (missingPhotoArea) {
        return NextResponse.json(
          { error: `Add at least one photo for the flagged area "${missingPhotoArea.label}".` },
          { status: 400 }
        );
      }
    }

    // Derive on-site minutes from the captured window (fall back to provided minutes).
    const onSiteMinutes =
      tools?.onSite
        ? minutesBetween(tools.onSite.startedAt ?? null, tools.onSite.endedAt ?? null) ??
          (typeof tools.onSite.minutes === "number" ? Math.max(0, Math.round(tools.onSite.minutes)) : null)
        : null;

    // Fold the structured tools into the persisted submission data.
    const dataWithTools: Record<string, unknown> = {
      ...body.data,
      ...(tools ? { [QA_TOOLS_DATA_KEY]: { ...tools, onSite: { ...tools.onSite, minutes: onSiteMinutes } } } : {}),
    };

    // AMENDMENT TARGET. When this submit re-submits a reopened inspection, the
    // named review must belong to THIS job and be a real QA inspection review —
    // otherwise we refuse rather than silently stacking a duplicate review (the
    // exact bug amend-in-place exists to prevent).
    const amendReview = body.reopenedReviewId
      ? await db.qAReview.findFirst({
          where: { id: body.reopenedReviewId, jobId: params.id, kind: "QA" },
          select: { id: true },
        })
      : null;
    if (body.reopenedReviewId && !amendReview) {
      return NextResponse.json(
        { error: "The inspection you're amending no longer exists — reload the job and try again." },
        { status: 409 }
      );
    }

    const created = await db.$transaction(async (tx) => {
      const reviewFields = {
        // When an accountability assessment is present, the raw accountability
        // score is the review score at creation (final = raw; admin adjustments
        // land later via the adjust endpoint). Legacy percent is used otherwise.
        score: accountabilityResult ? accountabilityResult.rawScore : result.score,
        passed: reviewPassed,
        // A real on-site QA inspection — the authoritative score for the job
        // (overrides any earlier admin/auto quick score). See lib/qa/authority.
        kind: "QA",
        notes: body.notes || null,
        flags: { categoryScores: result.categoryScores, data: dataWithTools } as any,
        ...(accountabilityResult
          ? {
              rawScore: accountabilityResult.rawScore,
              rating: accountabilityResult.rating,
              managementReview: accountabilityResult.managementReview,
            }
          : { rawScore: null, rating: null, managementReview: false }),
      };
      // Amend in place (keeping the original reviewedBy as the author of record
      // and stamping who changed it) or create the first review for this job.
      const review = amendReview
        ? await tx.qAReview.update({
            where: { id: amendReview.id },
            data: { ...reviewFields, editedById: session.user.id, editedAt: new Date() },
          })
        : await tx.qAReview.create({
            data: { jobId: params.id, reviewedById: session.user.id, ...reviewFields },
          });

      // On an amendment the previous findings are REPLACED by the ones below —
      // but only the ones nothing has been done about yet. An issue that already
      // carries a proposed pay adjustment, or that has been rectified/reviewed,
      // is money already actioned and is left exactly where it is (reopening
      // never silently reverses money; see lib/qa/reopen.ts).
      let keptActionedIssues = 0;
      if (amendReview) {
        const priorIssues = await tx.qaIssue.findMany({
          where: { qaReviewId: review.id },
          select: {
            id: true,
            payAdjustmentId: true,
            rectificationStatus: true,
            falseConfReviewedAt: true,
          },
        });
        const replaceable = priorIssues.filter(
          (i) =>
            !i.payAdjustmentId &&
            String(i.rectificationStatus) === "PENDING" &&
            !i.falseConfReviewedAt
        );
        keptActionedIssues = priorIssues.length - replaceable.length;
        if (replaceable.length > 0) {
          await tx.qaIssue.deleteMany({ where: { id: { in: replaceable.map((i) => i.id) } } });
        }
        await tx.auditLog.create({
          data: {
            userId: session.user.id,
            jobId: params.id,
            action: "QA_REVIEW_AMENDED",
            entity: "QAReview",
            entityId: review.id,
            after: {
              score: reviewFields.score,
              passed: reviewFields.passed,
              replacedIssues: replaceable.length,
              keptActionedIssues,
            } as any,
          },
        });
      }
      const submission = await tx.qaFormSubmission.create({
        data: {
          jobId: params.id,
          templateId: template.id,
          assignmentId: body.assignmentId || undefined,
          qaReviewId: review.id,
          submittedById: session.user.id,
          data: dataWithTools as any,
          categoryScores: result.categoryScores as any,
          media: body.media as any,
          score: result.score,
          passed: result.passed,
          notes: body.notes || null,
        },
      });

      if (body.assignmentId) {
        // Scope the assignment write to THIS job and to an assignment this
        // inspector may act on (unassigned, assigned to them, or picked up by
        // them). Without this, any inspector could force-complete another
        // inspector's assignment on another job by passing its id (IDOR).
        const scoped = await tx.qaAssignment.updateMany({
          where: {
            id: body.assignmentId,
            jobId: params.id,
            OR: [
              { assignedToId: null },
              { assignedToId: session.user.id },
              { pickedUpById: session.user.id },
            ],
          },
          data: {
            status: QaAssignmentStatus.COMPLETED,
            completedAt: new Date(),
            pickedUpById: session.user.id,
            onSiteStartedAt: tools?.onSite?.startedAt ? new Date(tools.onSite.startedAt) : undefined,
            // Always stamp an end time on completion, even if the inspector never
            // hit "stop", so the on-site timer can't resume running on reopen.
            onSiteEndedAt: tools?.onSite?.endedAt ? new Date(tools.onSite.endedAt) : new Date(),
            onSiteMinutes: onSiteMinutes ?? undefined,
          },
        });
        if (scoped.count !== 1) {
          throw new Error("FORBIDDEN");
        }
      }

      await tx.job.update({
        where: { id: params.id },
        data: {
          // effectivePassed is false when a rework is being spawned, so the
          // original job stays in QA_REVIEW rather than closing as COMPLETED.
          status: effectivePassed ? JobStatus.COMPLETED : JobStatus.QA_REVIEW,
          completedAt: effectivePassed ? new Date() : null,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "QA_FORM_SUBMIT",
          entity: "QaFormSubmission",
          entityId: submission.id,
          after: { score: result.score, passed: result.passed, jobId: params.id } as any,
        },
      });

      // ── ACCOUNTABILITY: create one QaIssue per MINOR/MAJOR/CRITICAL verdict
      //    plus dedicated issues for unmatched suspected false confirmations, and
      //    audit the assessment. All inside the same transaction as the review.
      if (accountabilityInput && accountabilityResult) {
        // The job's primary assigned cleaner owns the flagged issues (matches
        // getOriginalPrimaryCleanerId: primary first, then earliest assigned).
        const primaryAssignment = await tx.jobAssignment.findFirst({
          where: { jobId: params.id, removedAt: null },
          orderBy: [{ isPrimary: "desc" }, { assignedAt: "asc" }],
          select: { userId: true },
        });
        const cleanerId = primaryAssignment?.userId ?? null;

        if (!cleanerId) {
          // No resolvable cleaner — skip issue creation gracefully (the review +
          // score are still recorded). Nothing to attribute the issues to.
          console.warn("[qa-submit] accountability issues skipped — no primary cleaner", params.id);
        } else {
          // fieldId → suspected-false-confirmation (extra description). A verdict
          // issue on a matching field is flagged SUSPECTED at creation; anything
          // left over becomes a dedicated MINOR issue below.
          const falseConfByField = new Map<string, string | null>();
          for (const fc of accountabilityInput.suspectedFalseConfirmations ?? []) {
            falseConfByField.set(fc.fieldId, fc.description ?? null);
          }
          const matchedFalseConf = new Set<string>();

          const severityMap: Record<"MINOR" | "MAJOR" | "CRITICAL", QaIssueSeverity> = {
            MINOR: QaIssueSeverity.MINOR,
            MAJOR: QaIssueSeverity.MAJOR,
            CRITICAL: QaIssueSeverity.CRITICAL,
          };

          for (const v of accountabilityInput.verdicts) {
            if (v.verdict !== "MINOR" && v.verdict !== "MAJOR" && v.verdict !== "CRITICAL") continue;
            const isFalseConf = falseConfByField.has(v.fieldId);
            if (isFalseConf) matchedFalseConf.add(v.fieldId);
            await tx.qaIssue.create({
              data: {
                jobId: params.id,
                propertyId: job.propertyId,
                cleanerId,
                qaReviewId: review.id,
                qaSubmissionId: submission.id,
                raisedById: session.user.id,
                category: v.category || "other",
                fieldId: v.fieldId,
                itemKey: v.itemKey ?? null,
                description: v.description || v.label || "QA issue",
                severity: severityMap[v.verdict],
                qaPhotoKeys: (v.qaPhotoKeys ?? undefined) as any,
                cleanerMediaIds: (v.cleanerMediaIds ?? undefined) as any,
                cleanerMarkedComplete: v.cleanerMarkedComplete ?? false,
                guestReadyImpact: v.guestReadyImpact ?? false,
                falseConfirmation: isFalseConf
                  ? FalseConfirmationStatus.SUSPECTED
                  : FalseConfirmationStatus.NONE,
              },
            });
          }

          // Dedicated issues for suspected false confirmations that didn't match a
          // flagged verdict (e.g. a PASS/NA item the cleaner falsely confirmed).
          for (const [fieldId, description] of Array.from(falseConfByField)) {
            if (matchedFalseConf.has(fieldId)) continue;
            await tx.qaIssue.create({
              data: {
                jobId: params.id,
                propertyId: job.propertyId,
                cleanerId,
                qaReviewId: review.id,
                qaSubmissionId: submission.id,
                raisedById: session.user.id,
                category: "other",
                fieldId,
                description: description || "Suspected false confirmation",
                severity: QaIssueSeverity.MINOR,
                falseConfirmation: FalseConfirmationStatus.SUSPECTED,
              },
            });
          }
        }

        await tx.auditLog.create({
          data: {
            userId: session.user.id,
            action: "QA_ACCOUNTABILITY_ASSESSMENT",
            entity: "QAReview",
            entityId: review.id,
            after: {
              rawScore: accountabilityResult.rawScore,
              rating: accountabilityResult.rating,
              counts: accountabilityResult.counts,
            } as any,
          },
        });
      }

      return { review, submission };
    });

    // ── Side effects (outside the QA transaction so a failure here never voids
    //    the submission itself; each is best-effort and individually audited).

    // DAMAGE REPORT → create a DAMAGE case per entry, linked to the job/property.
    const createdCaseIds: string[] = [];
    for (const entry of tools?.damage ?? []) {
      if (!entry.description.trim() && !entry.area.trim()) continue;
      try {
        const c = await createCase({
          title: `QA damage — ${entry.area || job.property?.name || "Property"}`.slice(0, 180),
          description: [entry.description, entry.estimatedCost ? `Estimated cost: $${entry.estimatedCost}` : ""]
            .filter(Boolean)
            .join("\n\n"),
          severity: entry.severity,
          caseType: "DAMAGE",
          source: "QA_INSPECTION",
          jobId: params.id,
          propertyId: job.propertyId,
          comment: { authorUserId: session.user.id, body: `Logged from QA inspection.`, isInternal: true },
          attachments: (entry.photoKeys ?? []).map((key) => ({
            uploadedByUserId: session.user.id,
            s3Key: key,
            url: publicUrl(key),
            label: "QA damage photo",
          })),
        });
        if (c?.id) createdCaseIds.push(c.id);
      } catch (err) {
        console.error("[qa-submit] damage case create failed", err);
      }
    }

    // NEXT-CLEAN ACTIONS → append to job internalNotes (preserving structured
    // meta) and store a structured flag on the property's accessInfo JSON.
    if ((tools?.nextClean ?? []).length > 0) {
      try {
        const meta = parseJobInternalNotes(job.internalNotes);
        const lines = (tools?.nextClean ?? []).map((r) =>
          r.kind === "DEEP_CLEAN_AREA"
            ? `Next clean — deep clean ${r.area || "area"}: ${r.note}`
            : `Next clean — special request: ${r.note}`
        );
        const appended = [meta.internalNoteText.trim(), ...lines].filter(Boolean).join("\n");
        const accessInfo =
          job.property?.accessInfo && typeof job.property.accessInfo === "object" && !Array.isArray(job.property.accessInfo)
            ? (job.property.accessInfo as Record<string, unknown>)
            : {};
        const existingFlags = Array.isArray((accessInfo as any).qaNextClean) ? (accessInfo as any).qaNextClean : [];
        await db.$transaction([
          db.job.update({
            where: { id: params.id },
            data: { internalNotes: serializeJobInternalNotes({ ...meta, internalNoteText: appended }) },
          }),
          db.property.update({
            where: { id: job.propertyId },
            data: {
              accessInfo: {
                ...accessInfo,
                qaNextClean: [
                  ...existingFlags,
                  ...(tools?.nextClean ?? []).map((r) => ({
                    kind: r.kind,
                    area: r.area ?? null,
                    note: r.note,
                    jobId: params.id,
                    at: new Date().toISOString(),
                  })),
                ].slice(-25),
              } as any,
            },
          }),
        ]);
      } catch (err) {
        console.error("[qa-submit] next-clean persist failed", err);
      }
    }

    // RESTOCK REQUEST → create a DRAFT StockRun pre-filled with the items.
    let restockRunId: string | null = null;
    const restockLines = (tools?.restock ?? []).filter((l) => l.quantity > 0);
    if (restockLines.length > 0) {
      try {
        const stocks = await db.propertyStock.findMany({
          where: { id: { in: restockLines.map((l) => l.propertyStockId) }, propertyId: job.propertyId },
        });
        const stockById = new Map(stocks.map((s) => [s.id, s]));
        const validLines = restockLines.filter((l) => stockById.has(l.propertyStockId));
        if (validLines.length > 0) {
          const run = await db.stockRun.create({
            data: {
              propertyId: job.propertyId,
              requestedByUserId: session.user.id,
              title: `QA restock — ${job.property?.name ?? "Property"}`.slice(0, 200),
              notes: `Flagged during QA inspection of job ${params.id}.`,
              status: StockRunStatus.DRAFT,
              requestedByAdmin: false,
              lines: {
                create: validLines.map((l) => {
                  const stock = stockById.get(l.propertyStockId)!;
                  return {
                    propertyStockId: l.propertyStockId,
                    expectedOnHand: stock.onHand,
                    parLevel: stock.parLevel,
                    reorderThreshold: stock.reorderThreshold,
                    note: [l.note, `Restock qty: ${l.quantity}`].filter(Boolean).join(" · "),
                  };
                }),
              },
            },
          });
          restockRunId = run.id;
        }
      } catch (err) {
        console.error("[qa-submit] restock run create failed", err);
      }
    }

    // FULL INVENTORY COUNT → create a DRAFT StockRun carrying the inspector's
    // counts (admin applies it from the inventory stock-count workflow).
    let countRunId: string | null = null;
    if ((tools?.inventoryCount ?? []).length > 0) {
      try {
        const ids = (tools?.inventoryCount ?? []).map((l) => l.propertyStockId);
        const stocks = await db.propertyStock.findMany({
          where: { id: { in: ids }, propertyId: job.propertyId },
        });
        const stockById = new Map(stocks.map((s) => [s.id, s]));
        const validLines = (tools?.inventoryCount ?? []).filter((l) => stockById.has(l.propertyStockId));
        if (validLines.length > 0) {
          const run = await db.stockRun.create({
            data: {
              propertyId: job.propertyId,
              requestedByUserId: session.user.id,
              title: `QA inventory count — ${job.property?.name ?? "Property"}`.slice(0, 200),
              notes: `Full count captured during QA inspection of job ${params.id}.`,
              status: StockRunStatus.DRAFT,
              requestedByAdmin: false,
              lines: {
                create: validLines.map((l) => {
                  const stock = stockById.get(l.propertyStockId)!;
                  return {
                    propertyStockId: l.propertyStockId,
                    expectedOnHand: stock.onHand,
                    countedOnHand: l.countedOnHand,
                    parLevel: stock.parLevel,
                    reorderThreshold: stock.reorderThreshold,
                    note: l.note || null,
                  };
                }),
              },
            },
          });
          countRunId = run.id;
        }
      } catch (err) {
        console.error("[qa-submit] inventory count run create failed", err);
      }
    }

    // REWORK → on a failed clean, spin up a distinct rework JOB carrying the
    // flagged areas + QA photos (the cleaner gets a dynamic fix-checklist), and
    // wire the pay decision (same cleaner = no pay; different cleaner = paid +
    // deducted from the original). A legacy cleaner→QA pay/time transfer is still
    // recorded when the inspector explicitly moved minutes/$ to themselves.
    let reworkTransferId: string | null = null;
    let reworkJobId: string | null = null;
    let reworkOffer: { assignmentId: string; status: string; expiresAt: string } | null = null;
    let reworkBlockedReason: string | null = null;
    const rk = tools?.rework;
    // Honour the inspector's explicit rework toggle regardless of the numeric
    // pass/fail — if they enabled rework and flagged areas, they are requesting a
    // rework job. (Previously this was gated on !result.passed, so a clean that
    // scored above the pass threshold silently created no rework job.)
    if (rk?.enabled) {
      const flagged =
        (rk.flaggedAreas ?? []).length > 0
          ? rk.flaggedAreas.map((a, i) => ({
              id: a.id || `area-${i + 1}`,
              label: a.label,
              note: a.note,
              photoKeys: a.photoKeys ?? [],
              annotations: a.annotations,
            }))
          : (rk.areas ?? []).map((label, i) => ({
              id: `area-${i + 1}`,
              label,
              note: undefined,
              photoKeys: [] as string[],
            }));
      // INVARIANT 1 — invoiceable ⇔ payee ≠ original cleaner. Checked before any
      // rework job/pay row is written (violations are audited + fatal).
      const originalPrimary = await db.jobAssignment
        .findFirst({
          where: { jobId: params.id, removedAt: null },
          orderBy: [{ isPrimary: "desc" }, { assignedAt: "asc" }],
          select: { userId: true },
        })
        .catch(() => null);
      await guardInvariant(
        () =>
          assertReworkInvoiceablePayee({
            originalCleanerId: originalPrimary?.userId ?? null,
            payeeCleanerId: rk.assignee === "OTHER" ? rk.payeeCleanerId ?? null : originalPrimary?.userId ?? null,
            payAmount: rk.assignee === "OTHER" ? Number(rk.payAmount ?? 0) : 0,
          }),
        { actorUserId: session.user.id, jobId: params.id, entity: "Job", entityId: params.id }
      );

      // AMENDMENT GUARD — a re-submitted (reopened) inspection must not spawn a
      // SECOND rework job for the same failure. The first one already exists and
      // may already be paid/started; duplicating it would double the money.
      const duplicateRework =
        amendReview &&
        (await db.job
          .count({ where: { reworkOfJobId: params.id, isRework: true } })
          .catch(() => 0)) > 0;
      if (duplicateRework) {
        reworkBlockedReason =
          "A rework job already exists for this inspection — the amendment did not create another. Manage the existing rework from the job list.";
      }

      if (flagged.length > 0 && !duplicateRework) {
        try {
          reworkJobId = await createReworkJobFromFailure({
            originalJobId: params.id,
            qaUserId: session.user.id,
            reason: rk.reason || "QA flagged rework.",
            areas: flagged,
            sourceReviewId: created.review.id,
            assignToCleanerId: rk.assignee === "OTHER" ? rk.payeeCleanerId ?? null : null,
            payAmount: rk.assignee === "OTHER" ? rk.payAmount : 0,
            allocatedHours: rk.allocatedHours ?? null,
            categorized: rk.categorized,
          });
        } catch (err) {
          console.error("[qa-submit] rework job create failed", err);
        }
      }

      // (a) OFFER THE ORIGINAL CLEANER — the rework job exists (same cleaner, $0)
      //     but is held as an OFFER with a TTL. The cleaner accepts (it becomes
      //     theirs) or declines (it returns to the QA decision).
      if (rk.decision === "OFFER_ORIGINAL" && reworkJobId && body.assignmentId) {
        try {
          const offerWindow = buildOfferWindow(
            new Date(),
            settings.accountability.rectification.reworkOfferTtlMinutes
          );
          await db.qaAssignment.updateMany({
            where: { id: body.assignmentId, jobId: params.id },
            data: offerWindow,
          });
          reworkOffer = {
            assignmentId: body.assignmentId,
            status: offerWindow.reworkOfferStatus,
            expiresAt: offerWindow.reworkOfferExpiresAt.toISOString(),
          };
          const offerCleanerId = originalPrimary?.userId ?? null;
          if (offerCleanerId) {
            void notifyReworkOfferToCleaner({
              jobId: reworkJobId,
              cleanerId: offerCleanerId,
              assignmentId: body.assignmentId,
              propertyName: job.property?.name ?? null,
              reason: rk.reason || "QA flagged rework.",
              expiresAt: offerWindow.reworkOfferExpiresAt,
            }).catch(console.error);
          }
        } catch (err) {
          console.error("[qa-submit] rework offer create failed", err);
        }
      }

      // (c) QA SELF-REWORK / legacy: the inspector redid the work themselves and
      //     moved minutes/$ from the cleaner. INVARIANT 6 bounds the claim by the
      //     measured on-site window.
      //     On an amendment the earlier transfer already moved that money, so a
      //     second claim for the same visit is refused (see duplicateRework).
      const duplicateTransfer =
        amendReview &&
        (await db.qaReworkTransfer.count({ where: { jobId: params.id } }).catch(() => 0)) > 0;
      if (duplicateTransfer) {
        reworkBlockedReason =
          reworkBlockedReason ??
          "A rework time/pay transfer already exists for this inspection — the amendment did not create another.";
      }
      if (!duplicateTransfer && rk.cleanerUserId && (rk.minutesFromCleaner > 0 || rk.amountFromCleaner > 0)) {
        await guardInvariant(
          () =>
            assertSelfReworkMinutes({
              minutes: Number(rk.minutesFromCleaner ?? 0),
              onSiteMinutes,
            }),
          { actorUserId: session.user.id, jobId: params.id, entity: "QaReworkTransfer", entityId: params.id }
        );
        try {
          const transfer = await createQaReworkTransfer({
            jobId: params.id,
            assignmentId: body.assignmentId ?? null,
            qaUserId: session.user.id,
            cleanerUserId: rk.cleanerUserId,
            severity: rk.severity as QaReworkSeverity,
            reason: rk.reason,
            areas: rk.areas,
            minutesFromCleaner: rk.minutesFromCleaner,
            amountFromCleaner: rk.amountFromCleaner,
            affectsCleanerStats: rk.affectsCleanerStats,
          });
          reworkTransferId = transfer.id;
        } catch (err) {
          console.error("[qa-submit] rework transfer create failed", err);
        }
      }
    }

    await generateJobReport(params.id).catch(() => null);

    // ── ACCOUNTABILITY NOTIFICATIONS (Phase 8b). Fire-and-forget, post-commit:
    //    only when an accountability assessment was actually processed. Each helper
    //    swallows its own errors; we additionally void+catch so nothing here can
    //    affect the response. Zero behaviour change to the submission itself.
    if (accountabilityInput && accountabilityResult) {
      const primaryAssignment = await db.jobAssignment
        .findFirst({
          where: { jobId: params.id, removedAt: null },
          orderBy: [{ isPrimary: "desc" }, { assignedAt: "asc" }],
          select: { userId: true },
        })
        .catch(() => null);
      const notifyCleanerId = primaryAssignment?.userId ?? null;
      const propertyName = job.property?.name ?? null;

      if (notifyCleanerId) {
        const counts = accountabilityResult.counts;
        const issueParts: string[] = [];
        if (counts.critical) issueParts.push(`${counts.critical} critical`);
        if (counts.major) issueParts.push(`${counts.major} major`);
        if (counts.minor) issueParts.push(`${counts.minor} minor`);
        void notifyQaResultToCleaner({
          jobId: params.id,
          cleanerId: notifyCleanerId,
          score: accountabilityResult.rawScore,
          rating: accountabilityResult.rating,
          passed: accountabilityResult.passed,
          propertyName,
          issueSummary: issueParts.length ? issueParts.join(", ") : null,
        }).catch(console.error);
      }

      if (accountabilityResult.managementReview) {
        void notifyManagementReviewFlagged({
          jobId: params.id,
          propertyName,
        }).catch(console.error);
      }

      const falseConfCount = accountabilityResult.counts.falseConfirmations;
      if (falseConfCount > 0) {
        void notifyFalseConfirmationSuspected({
          jobId: params.id,
          count: falseConfCount,
          propertyName,
        }).catch(console.error);
      }
    }

    return NextResponse.json({
      ...created,
      review: { ...created.review },
      createdCaseIds,
      restockRunId,
      countRunId,
      reworkTransferId,
      reworkJobId,
      reworkOffer,
      reworkBlockedReason,
      amended: Boolean(amendReview),
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
