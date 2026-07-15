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
import { QaIssueSeverity, FalseConfirmationStatus } from "@prisma/client";

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
          property: { select: { id: true, name: true, address: true, suburb: true, state: true, postcode: true, accessInfo: true } },
          assignments: {
            where: { removedAt: null },
            select: { user: { select: { id: true, name: true, email: true } } },
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

    // Property stock for the restock + full inventory count tools.
    const propertyStock = await db.propertyStock.findMany({
      where: { propertyId: job.propertyId },
      include: { item: { select: { id: true, name: true, unit: true, category: true, location: true } } },
      orderBy: [{ item: { location: "asc" } }, { item: { name: "asc" } }],
    });

    // The cleaners on the job roster — candidates for the rework transfer.
    const cleanerCandidates = job.assignments
      .map((a) => a.user)
      .filter((u): u is { id: string; name: string | null; email: string } => Boolean(u));

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

    return NextResponse.json({
      job,
      template,
      assignment,
      mediaOverrides,
      propertyStock,
      cleanerCandidates,
      sectionPhotos,
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

    const created = await db.$transaction(async (tx) => {
      const review = await tx.qAReview.create({
        data: {
          jobId: params.id,
          reviewedById: session.user.id,
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
            : {}),
        },
      });
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
      if (flagged.length > 0) {
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

      // Legacy: the inspector redid the work themselves and moved minutes/$.
      if (rk.cleanerUserId && (rk.minutesFromCleaner > 0 || rk.amountFromCleaner > 0)) {
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
    return NextResponse.json({
      ...created,
      review: { ...created.review },
      createdCaseIds,
      restockRunId,
      countRunId,
      reworkTransferId,
      reworkJobId,
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
