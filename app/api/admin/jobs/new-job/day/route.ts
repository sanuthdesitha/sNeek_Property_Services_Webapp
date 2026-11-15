import { NextRequest } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { loadNewJobDayCheck } from "@/lib/jobs/new-job/day-check";
import { dayQuerySchema, readQuery } from "@/lib/jobs/new-job/query";
import { previewError, previewJson } from "@/lib/jobs/new-job/http";

/**
 * GET /api/admin/jobs/new-job/day?propertyId&jobType&dates=…&startTime&dueTime
 * &endTime&estimatedHours&suggest=1 — for an unsaved job: the booking calendar,
 * jobs already there that day, the laundry planner's preview, ranked cleaners
 * (first date, when asked) and the booking email with its gates. Read only:
 * nothing is created, offered, planned or sent.
 */
const KEYS = ["propertyId", "jobType", "dates", "startTime", "dueTime", "endTime", "estimatedHours", "suggest"] as const;

export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const query = dayQuerySchema.parse(readQuery(req.nextUrl.searchParams, KEYS));
    const settings = await getAppSettings();
    const result = await loadNewJobDayCheck({
      propertyId: query.propertyId,
      jobType: query.jobType,
      dayKeys: query.dates,
      startTime: query.startTime ?? null,
      dueTime: query.dueTime ?? null,
      endTime: query.endTime ?? null,
      estimatedHours: query.estimatedHours ?? null,
      suggest: query.suggest === "1",
      timezone: settings.timezone || "Australia/Sydney",
    });
    if (!result) return previewJson({ error: "That property was not found." }, 404);
    return previewJson(result);
  } catch (err) {
    return previewError(err, "Could not check that day.");
  }
}
