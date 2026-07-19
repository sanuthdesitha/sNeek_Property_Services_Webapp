import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Role } from "@prisma/client";
import { getAppSettings } from "@/lib/settings";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { getJobTimingHighlights, parseJobInternalNotes } from "@/lib/jobs/meta";
import { computeJobPayForCleaner } from "@/lib/finance/job-pay-for-cleaner";
import { getApprovedContinuationProgressSnapshot } from "@/lib/jobs/continuation-requests";
import { getJobStartReminders } from "@/lib/accountability/patterns";
import { inferInventoryLocationFromCategory } from "@/lib/inventory/locations";
import { autoClockOutStaleTimeLogsForUser } from "@/lib/time/auto-clockout";
import { buildClockReview } from "@/lib/time/clock-rules";
import { sumRecordedTimeLogSeconds } from "@/lib/time/log-duration";
import { attachPendingCarryForwardTasksToJob, listCleanerJobTasks } from "@/lib/job-tasks/service";
import { resolveTemplateReferenceUrls } from "@/lib/forms/resolve-references";
import { normalizeFormSchema } from "@/lib/forms/normalize-schema";
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
    // Fetched before the job query so the client-contact relation can be
    // conditionally selected: cleaners only ever load the client's name/phone
    // when the "show client contact to cleaners" toggle is on. Email is never
    // selected, so it cannot leak.
    const settings = await getAppSettings();
    const includeClientContact = settings.cleanerClientContact !== false;
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
            ...(includeClientContact
              ? { client: { select: { name: true, phone: true } } }
              : {}),
            latitude: true,
            longitude: true,
            placeId: true,
            linenBufferSets: true,
            accessInfo: true,
            hasBalcony: true,
            bedrooms: true,
            bathrooms: true,
            inventoryEnabled: true,
            laundryEnabled: true,
            // Job-start gate context (accountability): expected duration, laundry
            // bag identity, sofa beds, and setup reference images. `name` (already
            // selected) carries the property short code (e.g. "J04").
            cleaningDurationMinutes: true,
            laundryBagLabel: true,
            laundryBagColor: true,
            sofaBedCount: true,
            setupGuide: true,
          },
        },
        assignments: {
          where: { removedAt: null },
          select: {
            id: true,
            userId: true,
            payRate: true,
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
    const jobMeta = parseJobInternalNotes(job.internalNotes);
    const jobTimingHighlights = getJobTimingHighlights(jobMeta);

    // Where the cleaner collects keys (from the quote's service context), surfaced
    // once so the Set-up + info drawer can show a distinct "Key pickup" row.
    const keyPickupLocation = jobMeta.serviceContext?.keyPickupLocation ?? null;

    // This session cleaner's pay for THIS job — computed with the SAME canonical
    // math (rework rule honored) as the briefing/payroll. Only for the cleaner
    // role; admins/ops get null.
    let payForJob: number | null = null;
    if (session.user.role === Role.CLEANER) {
      const cleanerUser = await db.user
        .findUnique({ where: { id: session.user.id }, select: { hourlyRate: true } })
        .catch(() => null);
      payForJob = computeJobPayForCleaner({
        cleanerId: session.user.id,
        job: {
          jobType: job.jobType,
          estimatedHours: job.estimatedHours,
          isRework: job.isRework,
          reworkPayAmount: job.reworkPayAmount,
        },
        assignments: job.assignments.map((a) => ({ userId: a.userId, payRate: a.payRate ?? null })),
        userHourlyRate: cleanerUser?.hourlyRate ?? null,
        cleanerJobHourlyRates: settings.cleanerJobHourlyRates,
        cleanerPayouts: jobMeta.cleanerPayouts,
        transportAllowances: jobMeta.transportAllowances,
      });
    }
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

    // Restock needs for the job-start gate: items at/under their reorder
    // threshold, with the quantity needed to reach par. Empty when inventory is
    // disabled for the property (inventoryStock stays []).
    const restockNeeds = inventoryStock
      .filter((row: any) => Number(row?.onHand ?? 0) <= Number(row?.reorderThreshold ?? 0))
      .map((row: any) => ({
        name: String(row?.item?.name ?? "Item"),
        needed: Math.max(0, Number(row?.parLevel ?? 0) - Number(row?.onHand ?? 0)),
        unit: row?.item?.unit ?? null,
      }))
      .filter((r: any) => r.needed > 0);

    // Job-start accountability gate flag (Phase 2b) — read defensively; defaults
    // ON unless explicitly disabled. Surfaced so the cleaner portals know whether
    // to enforce the confirmation gate (server-side remains authoritative).
    const requireJobStartConfirmation =
      (settings as unknown as {
        accountability?: { requireJobStartConfirmation?: boolean };
      }).accountability?.requireJobStartConfirmation !== false;

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

    // Recurring-issue watch-outs for the job-start card (Phase 7a). Never fails
    // the route — the helper degrades to [] internally.
    const recurringIssues = await getJobStartReminders(job.id).catch(() => [] as string[]);

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

    // Canonicalise + guarantee the standard sections via the SHARED normalizer,
    // which the submit route also applies — so the schema the cleaner fills and
    // validates against is byte-for-byte the required-set the server enforces.
    // (Read-time only; the stored template rows are never mutated. Legacy shapes
    // — label/equals/upload/textarea — are canonicalised here too.) Fall back to
    // the raw schema if normalization ever throws so the form still loads.
    if (templateWithExtras) {
      try {
        templateWithExtras = {
          ...templateWithExtras,
          schema: normalizeFormSchema(templateWithExtras.schema),
        };
      } catch {
        /* keep templateWithExtras.schema as-is */
      }
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

    // Client / office / guest contact numbers surfaced to the cleaner. The
    // client name+phone are only present when the toggle is on (the relation is
    // otherwise not even selected). The raw `property.client` relation is
    // stripped from the returned job so nothing beyond name+phone can leak, and
    // contact is returned as its own top-level key. Guest details come from the
    // reservation context; the office number from settings. Null only when there
    // is nothing at all to show.
    const rawPropertyClient = (job.property as any)?.client as
      | { name?: string | null; phone?: string | null }
      | null
      | undefined;
    if (job.property && "client" in (job.property as any)) {
      delete (job.property as any).client;
    }
    const clientName = includeClientContact ? rawPropertyClient?.name ?? null : null;
    const clientPhone = includeClientContact ? rawPropertyClient?.phone ?? null : null;
    const companyPhone = settings.companyPhone?.trim() ? settings.companyPhone.trim() : null;
    const guestName = jobMeta.reservationContext?.guestName ?? null;
    const guestPhone = jobMeta.reservationContext?.guestPhone ?? null;
    const contact =
      clientName || clientPhone || companyPhone || guestName || guestPhone
        ? { clientName, clientPhone, companyPhone, guestName, guestPhone }
        : null;

    return NextResponse.json({
      job,
      contact,
      jobMeta,
      jobTasks,
      jobTimingHighlights,
      keyPickupLocation,
      payForJob,
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
      restockNeeds,
      recurringIssues,
      requireJobStartConfirmation,
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
    const status =
      err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
