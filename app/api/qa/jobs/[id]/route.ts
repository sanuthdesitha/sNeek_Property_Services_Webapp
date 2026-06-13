import { NextRequest, NextResponse } from "next/server";
import { JobStatus, QaAssignmentStatus, QaReworkSeverity, Role, StockRunStatus } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { buildDefaultQaTemplateSchema, scoreQaSubmission } from "@/lib/qa/templates";
import { generateJobReport } from "@/lib/reports/generator";
import { createCase } from "@/lib/cases/service";
import { createQaReworkTransfer } from "@/lib/qa/rework-transfers";
import { parseJobInternalNotes, serializeJobInternalNotes } from "@/lib/jobs/meta";
import { QA_TOOLS_DATA_KEY, minutesBetween } from "@/lib/qa/inspection-tools";
import { publicUrl, getPresignedDownloadUrl } from "@/lib/s3";

const QA_ROLES = [Role.QA_INSPECTOR, Role.OPS_MANAGER, Role.ADMIN] as const;

const damageEntrySchema = z.object({
  id: z.string().optional(),
  area: z.string().trim().max(160).default(""),
  description: z.string().trim().max(2000).default(""),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  photoKeys: z.array(z.string().trim().min(1)).default([]),
  estimatedCost: z.number().min(0).nullable().optional(),
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

const reworkSchema = z.object({
  enabled: z.boolean().default(false),
  cleanerUserId: z.string().min(1).nullable().optional(),
  severity: z.enum(["MINOR", "MODERATE", "MAJOR"]).default("MINOR"),
  reason: z.string().trim().max(4000).default(""),
  areas: z.array(z.string().trim().min(1)).default([]),
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
    onSite: z
      .object({
        startedAt: z.string().datetime().nullable().optional(),
        endedAt: z.string().datetime().nullable().optional(),
        minutes: z.number().min(0).nullable().optional(),
      })
      .default({}),
    rework: reworkSchema.nullable().optional(),
  })
  .optional();

const submitSchema = z.object({
  assignmentId: z.string().trim().min(1).nullable().optional(),
  templateId: z.string().trim().min(1),
  data: z.record(z.unknown()),
  media: z.any().optional(),
  notes: z.string().trim().max(6000).optional(),
  tools: toolsSchema,
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
  if (globalTemplate) return globalTemplate;
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
          property: { select: { id: true, name: true, address: true, suburb: true, accessInfo: true } },
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
      select: { id: true, propertyId: true, internalNotes: true, property: { select: { id: true, name: true, accessInfo: true } } },
    });
    if (!job) return NextResponse.json({ error: "QA job not found." }, { status: 404 });

    const result = scoreQaSubmission(template.schema as any, body.data);
    const tools = body.tools ?? null;

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
          score: result.score,
          passed: result.passed,
          notes: body.notes || null,
          flags: { categoryScores: result.categoryScores, data: dataWithTools } as any,
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
        await tx.qaAssignment.update({
          where: { id: body.assignmentId },
          data: {
            status: QaAssignmentStatus.COMPLETED,
            completedAt: new Date(),
            pickedUpById: session.user.id,
            onSiteStartedAt: tools?.onSite?.startedAt ? new Date(tools.onSite.startedAt) : undefined,
            onSiteEndedAt: tools?.onSite?.endedAt ? new Date(tools.onSite.endedAt) : undefined,
            onSiteMinutes: onSiteMinutes ?? undefined,
          },
        });
      }

      await tx.job.update({
        where: { id: params.id },
        data: {
          status: result.passed ? JobStatus.COMPLETED : JobStatus.QA_REVIEW,
          completedAt: result.passed ? new Date() : null,
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

    // REDO TRACKING + CLEANER↔QA TRANSFER → file a PENDING QaReworkTransfer.
    let reworkTransferId: string | null = null;
    if (tools?.rework?.enabled && tools.rework.cleanerUserId && tools.rework.reason.trim()) {
      try {
        const transfer = await createQaReworkTransfer({
          jobId: params.id,
          assignmentId: body.assignmentId ?? null,
          qaUserId: session.user.id,
          cleanerUserId: tools.rework.cleanerUserId,
          severity: tools.rework.severity as QaReworkSeverity,
          reason: tools.rework.reason,
          areas: tools.rework.areas,
          minutesFromCleaner: tools.rework.minutesFromCleaner,
          amountFromCleaner: tools.rework.amountFromCleaner,
          affectsCleanerStats: tools.rework.affectsCleanerStats,
        });
        reworkTransferId = transfer.id;
      } catch (err) {
        console.error("[qa-submit] rework transfer create failed", err);
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
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
