import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Role } from "@prisma/client";
import { getAppSettings } from "@/lib/settings";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { getJobTimingHighlights, parseJobInternalNotes } from "@/lib/jobs/meta";
import { getApprovedContinuationProgressSnapshot } from "@/lib/jobs/continuation-requests";
import { inferInventoryLocationFromCategory } from "@/lib/inventory/locations";
import { autoClockOutStaleTimeLogsForUser } from "@/lib/time/auto-clockout";
import { buildClockReview } from "@/lib/time/clock-rules";
import { sumRecordedTimeLogSeconds } from "@/lib/time/log-duration";
import { attachPendingCarryForwardTasksToJob, listCleanerJobTasks } from "@/lib/job-tasks/service";
import { resolveTemplateReferenceUrls } from "@/lib/forms/resolve-references";
import { withStandardSections } from "@/lib/checklists/compose";
import { stripHtmlToText } from "@/lib/forms/sanitize";
import {
  buildReworkFormSchema,
  ensureReworkFormTemplate,
  normalizeReworkAreas,
} from "@/lib/qa/rework-jobs";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER, Role.CLEANER]);
    if (session.user.role === Role.CLEANER) {
      await autoClockOutStaleTimeLogsForUser(session.user.id);
    }
    const job = await db.job.findUnique({
      where: { id: params.id },
      include: {
        property: {
          select: {
            name: true,
            address: true,
            suburb: true,
            state: true,
            postcode: true,
            latitude: true,
            longitude: true,
            placeId: true,
            linenBufferSets: true,
            accessInfo: true,
            hasBalcony: true,
            bedrooms: true,
            bathrooms: true,
            inventoryEnabled: true,
          },
        },
        assignments: {
          where: { removedAt: null },
          select: {
            id: true,
            userId: true,
            isPrimary: true,
            responseStatus: true,
            respondedAt: true,
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
        laundryTask: {
          include: {
            confirmations: {
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        },
        cleanerLocationPings: {
          orderBy: { timestamp: "desc" },
          take: 1,
          select: {
            lat: true,
            lng: true,
            accuracy: true,
            heading: true,
            speed: true,
            timestamp: true,
          },
        },
      },
    });
    if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (
      session.user.role === Role.CLEANER &&
      !job.assignments.some((assignment) => assignment.userId === session.user.id)
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const settings = await getAppSettings();
    const jobMeta = parseJobInternalNotes(job.internalNotes);
    const jobTimingHighlights = getJobTimingHighlights(jobMeta);
    await attachPendingCarryForwardTasksToJob({
      jobId: job.id,
      propertyId: job.propertyId,
      scheduledDate: job.scheduledDate,
      startTime: job.startTime,
    });
    const jobTasks = await listCleanerJobTasks(job.id);

    // Laundry guidance: is fresh linen actually sitting at the property from the
    // last successful drop, or was it already used by a later clean (so the
    // cleaner must use the property's buffer sets)? Only meaningful for turnovers.
    let laundryGuidance:
      | { hasDrop: boolean; lastDropAt: string | null; linenSittingOutside: boolean; useBufferSets: boolean; bufferSets: number }
      | null = null;
    if (job.jobType === "AIRBNB_TURNOVER" && !job.isRework) {
      const lastDrop = await db.laundryTask.findFirst({
        where: {
          propertyId: job.propertyId,
          jobId: { not: job.id },
          OR: [{ droppedAt: { not: null } }, { status: "DROPPED" }],
        },
        orderBy: [{ droppedAt: "desc" }, { updatedAt: "desc" }],
        select: { droppedAt: true },
      });
      const dropAt = lastDrop?.droppedAt ?? null;
      let cleanAfterDrop = false;
      if (dropAt) {
        const cleansSince = await db.job.count({
          where: {
            propertyId: job.propertyId,
            jobType: "AIRBNB_TURNOVER",
            isRework: false,
            id: { not: job.id },
            status: { in: ["SUBMITTED", "QA_REVIEW", "COMPLETED", "INVOICED"] },
            OR: [{ completedAt: { gt: dropAt } }, { scheduledDate: { gt: dropAt } }],
          },
        });
        cleanAfterDrop = cleansSince > 0;
      }
      const linenSittingOutside = Boolean(dropAt) && !cleanAfterDrop;
      laundryGuidance = {
        hasDrop: Boolean(dropAt),
        lastDropAt: dropAt ? dropAt.toISOString() : null,
        linenSittingOutside,
        useBufferSets: !linenSittingOutside,
        bufferSets: Number(job.property?.linenBufferSets ?? 0),
      };
    }

    const configuredPropertyTemplateId =
      settings.propertyFormTemplateOverrides?.[job.propertyId]?.[job.jobType] ?? null;
    let templateSource: "property_override" | "global_latest" = "global_latest";

    // Every template that has been generated/registered as SOME property's
    // per-job-type override. These are property-specific (e.g. approving a
    // property's checklist profile mints a high-version active FormTemplate and
    // registers it here) and must NEVER be picked by the global fallback below —
    // otherwise one property's newly-generated form, being the newest active
    // template for its job type, would resolve as the default for every other
    // property that has no override of its own ("new form for one property
    // replaces it for all"). The global fallback only considers genuinely global
    // templates (seeded / builder-published), which are not in this set.
    const propertyScopedTemplateIds = new Set<string>();
    for (const perProperty of Object.values(settings.propertyFormTemplateOverrides ?? {})) {
      for (const templateId of Object.values(perProperty ?? {})) {
        if (typeof templateId === "string" && templateId) propertyScopedTemplateIds.add(templateId);
      }
    }

    let template = configuredPropertyTemplateId
      ? await db.formTemplate.findFirst({
          where: {
            id: configuredPropertyTemplateId,
            serviceType: job.jobType,
            isActive: true,
          },
        })
      : null;

    if (template) {
      templateSource = "property_override";
    } else {
      template = await db.formTemplate.findFirst({
        where: {
          serviceType: job.jobType,
          isActive: true,
          ...(propertyScopedTemplateIds.size > 0
            ? { id: { notIn: Array.from(propertyScopedTemplateIds) } }
            : {}),
        },
        orderBy: { version: "desc" },
      });
    }

    let inventoryStock: any[] = [];
    if (job.property.inventoryEnabled) {
      try {
        inventoryStock = await db.propertyStock.findMany({
          where: {
            propertyId: job.propertyId,
            item: { isActive: true },
          },
          include: {
            item: {
              select: {
                id: true,
                name: true,
                sku: true,
                category: true,
                location: true,
                unit: true,
              },
            },
          },
          orderBy: [{ item: { location: "asc" } }, { item: { category: "asc" } }, { item: { name: "asc" } }],
        });
      } catch (stockErr: any) {
        // Backward compatibility if DB migration for InventoryItem.location is not applied yet.
        if (stockErr?.code !== "P2022" && !String(stockErr?.message ?? "").includes("location")) {
          throw stockErr;
        }
        const fallback = await db.propertyStock.findMany({
          where: {
            propertyId: job.propertyId,
            item: { isActive: true },
          },
          include: {
            item: {
              select: {
                id: true,
                name: true,
                sku: true,
                category: true,
                unit: true,
              },
            },
          },
          orderBy: [{ item: { category: "asc" } }, { item: { name: "asc" } }],
        });
        inventoryStock = fallback.map((row) => ({
          ...row,
          item: {
            ...row.item,
            location: inferInventoryLocationFromCategory(row.item?.category),
          },
        }));
      }
    }

    const cleanerTimeLogs =
      session.user.role === Role.CLEANER
        ? await db.timeLog.findMany({
            where: { jobId: job.id, userId: session.user.id },
            select: { id: true, startedAt: true, stoppedAt: true, durationM: true },
            orderBy: { startedAt: "asc" },
          })
        : [];
    const activeTimeLog =
      cleanerTimeLogs.length > 0
        ? [...cleanerTimeLogs].reverse().find((log) => !log.stoppedAt) ?? null
        : null;
    const completedSeconds = sumRecordedTimeLogSeconds(
      cleanerTimeLogs.filter((log) => log.stoppedAt)
    );
    const clockReview =
      activeTimeLog
        ? buildClockReview({
            job: {
              scheduledDate: job.scheduledDate,
              dueTime: job.dueTime,
              endTime: job.endTime,
              estimatedHours: job.estimatedHours,
            },
            startedAt: activeTimeLog.startedAt,
            completedDurationMinutes: Math.round(completedSeconds / 60),
            settings,
          })
        : null;
    const unresolvedCarryForwardTasks = await db.issueTicket.findMany({
      where: {
        status: { not: "RESOLVED" },
        title: { startsWith: "Carry-forward task" },
        job: { propertyId: job.propertyId },
      },
      include: {
        job: {
          select: {
            id: true,
            scheduledDate: true,
          },
        },
      },
      orderBy: [{ createdAt: "asc" }],
    });
    let expectedStartDate: string;
    try {
      expectedStartDate = format(toZonedTime(job.scheduledDate, settings.timezone || "Australia/Sydney"), "yyyy-MM-dd");
    } catch {
      expectedStartDate = format(toZonedTime(job.scheduledDate, "Australia/Sydney"), "yyyy-MM-dd");
    }
    const continuationProgressSnapshot = await getApprovedContinuationProgressSnapshot(job.id);

    // Rework job → replace the normal checklist with a dynamic one built from the
    // QA-flagged areas: one section per area showing QA's photo + note and a
    // required "after" photo upload. Reuses a hidden per-job-type template row so
    // the resulting FormSubmission still satisfies its template FK.
    const reworkAreas = job.isRework ? normalizeReworkAreas(job.reworkAreas) : [];
    if (job.isRework && reworkAreas.length > 0) {
      const reworkTemplate = await ensureReworkFormTemplate(job.jobType);
      template = {
        ...reworkTemplate,
        schema: buildReworkFormSchema(reworkAreas, { categorized: jobMeta.reworkCategorized }) as any,
      } as typeof template;
    }

    const resolvedTemplate = await resolveTemplateReferenceUrls(template);

    // Inject quote extras as an "Additionals" section so the cleaner sees the
    // base checklist PLUS exactly the extras that were quoted, each with its
    // how-to. Appended to whatever template applies (or stands alone if none).
    let templateWithExtras: any = resolvedTemplate;
    if (jobMeta.additionals.length > 0) {
      const additionalsSection = {
        id: "additionals",
        title: "Additionals (client-requested)",
        description: "Extra work added on the quote for this job.",
        fields: jobMeta.additionals.map((extra) => ({
          id: extra.id,
          type: "checkbox",
          label: stripHtmlToText(extra.label),
          required: false,
          instructions: extra.instructions ? stripHtmlToText(extra.instructions) : undefined,
        })),
      };
      if (templateWithExtras) {
        const schema = (templateWithExtras.schema as any) ?? {};
        const sections = Array.isArray(schema.sections) ? schema.sections : [];
        templateWithExtras = {
          ...templateWithExtras,
          schema: { ...schema, sections: [...sections, additionalsSection] },
        };
      } else {
        templateWithExtras = {
          id: "additionals-only",
          name: "Job additionals",
          serviceType: job.jobType,
          schema: { sections: [additionalsSection] },
        };
      }
    }

    // Runtime injection for legacy templates: guarantee every job form carries
    // the standard "Arrival evidence" section (prepended) + sign-off (appended),
    // even for templates stored before these were standard. Read-time only — the
    // stored template rows are never mutated. withStandardSections' idempotence
    // guards mean forms that already include arrival media / a signature (freshly
    // generated templates, rework forms) are left unchanged. Field ids inside the
    // injected section are deterministic so cleaner drafts keyed by field id
    // survive reloads.
    if (templateWithExtras) {
      const schema = (templateWithExtras.schema as any) ?? {};
      const sections = Array.isArray(schema.sections) ? schema.sections : [];
      templateWithExtras = {
        ...templateWithExtras,
        schema: { ...schema, sections: withStandardSections(sections) },
      };
    }
    const currentAssignment =
      session.user.role === Role.CLEANER
        ? job.assignments.find((assignment) => assignment.userId === session.user.id) ?? null
        : null;
    const transferCandidates =
      session.user.role === Role.CLEANER
        ? await db.user.findMany({
            where: {
              role: Role.CLEANER,
              isActive: true,
              id: { not: session.user.id },
            },
            select: {
              id: true,
              name: true,
              email: true,
            },
            orderBy: [{ name: "asc" }, { email: "asc" }],
            take: 100,
          })
        : [];

    return NextResponse.json({
      job,
      jobMeta,
      jobTasks,
      jobTimingHighlights,
      continuationProgressSnapshot,
      viewerName: session.user.name ?? session.user.email ?? "Cleaner",
      branding: {
        companyName: settings.companyName,
        logoUrl: settings.logoUrl,
        evidenceStamp: settings.evidenceStamp,
      },
      template: templateWithExtras,
      templateSource,
      configuredPropertyTemplateId,
      inventoryStock,
      carryForwardTasks: unresolvedCarryForwardTasks.map((ticket) => ({
        id: ticket.id,
        description: ticket.description,
        sourceJobId: ticket.jobId,
        sourceScheduledDate: ticket.job?.scheduledDate,
      })),
      canUseSelectAll:
        session.user.role === Role.CLEANER &&
        settings.selectAllAllowedCleanerIds.includes(session.user.id),
      canClockOutWithoutForm:
        session.user.role === Role.CLEANER &&
        settings.clockOutWithoutFormAllowedCleanerIds.includes(session.user.id),
      startVerification: {
        timezone: settings.timezone,
        requireDateMatch: settings.cleanerStartRequireDateMatch,
        requireChecklistConfirm: settings.cleanerStartRequireChecklistConfirm,
        expectedDate: expectedStartDate,
      },
      assignmentState: currentAssignment
        ? {
            id: currentAssignment.id,
            responseStatus: currentAssignment.responseStatus,
            respondedAt: currentAssignment.respondedAt,
          }
        : null,
      transferCandidates,
      timeState: {
        completedSeconds,
        isRunning: Boolean(activeTimeLog),
        activeStartedAt: activeTimeLog?.startedAt ?? null,
        activeTimeLogId: activeTimeLog?.id ?? null,
        maxAllowedTotalSeconds:
          clockReview?.allowedDurationMinutes != null
            ? (Math.round(completedSeconds / 60) + clockReview.allowedDurationMinutes) * 60
            : null,
        maxAllowedActiveSeconds:
          clockReview?.allowedDurationMinutes != null
            ? clockReview.allowedDurationMinutes * 60
            : null,
        suggestedStoppedAt: clockReview?.suggestedStoppedAt?.toISOString() ?? null,
        limitSource: clockReview?.source ?? null,
        exceedsAllowedDuration: clockReview?.exceedsAllowedDuration ?? false,
      },
      laundryState: job.laundryTask
        ? {
            status: job.laundryTask.status,
            noPickupRequired: job.laundryTask.noPickupRequired,
            skipReasonCode: job.laundryTask.skipReasonCode,
            skipReasonNote: job.laundryTask.skipReasonNote,
            adminOverrideNote: job.laundryTask.adminOverrideNote,
            updatedAt: job.laundryTask.updatedAt,
            latestConfirmation: job.laundryTask.confirmations[0]
              ? {
                  laundryReady: job.laundryTask.confirmations[0].laundryReady,
                  bagLocation: job.laundryTask.confirmations[0].bagLocation,
                  photoUrl: job.laundryTask.confirmations[0].photoUrl,
                  notes: job.laundryTask.confirmations[0].notes,
                  createdAt: job.laundryTask.confirmations[0].createdAt,
                }
              : null,
          }
        : null,
      laundryBagLocationOptions: settings.laundryBagLocationOptions,
      laundryGuidance,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
