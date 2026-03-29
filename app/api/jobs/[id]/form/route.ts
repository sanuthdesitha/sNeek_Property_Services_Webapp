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
            accessInfo: true,
            hasBalcony: true,
            bedrooms: true,
            bathrooms: true,
            inventoryEnabled: true,
          },
        },
        assignments: { select: { userId: true } },
        laundryTask: {
          include: {
            confirmations: {
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        },
      },
    });
    if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
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

    const configuredPropertyTemplateId =
      settings.propertyFormTemplateOverrides?.[job.propertyId]?.[job.jobType] ?? null;
    let templateSource: "property_override" | "global_latest" = "global_latest";

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
        where: { serviceType: job.jobType, isActive: true },
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
      },
      template,
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
      startVerification: {
        timezone: settings.timezone,
        requireDateMatch: settings.cleanerStartRequireDateMatch,
        requireChecklistConfirm: settings.cleanerStartRequireChecklistConfirm,
        expectedDate: expectedStartDate,
      },
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
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
