import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getOpsAccess } from "@/lib/rbac/ops-access";
import { getAppSettings } from "@/lib/settings";
import { sydneyTodayKey } from "@/lib/time/sydney-range";
import { formatInTimeZone } from "date-fns-tz";
import { newJobRights } from "@/lib/jobs/new-job/rights";
import { NewJobPage } from "@/components/v2/admin/jobs/new-job/new-job-page";

export const metadata = { title: "New job · Estate admin" };
export const dynamic = "force-dynamic";

/**
 * New job (boards "New job" and "New job on a phone", 2026-11). Old links
 * keep working: `?propertyId=` preselects the property, `#bulk-create` opens
 * Several dates, `?duplicate=<jobId>` copies a job, `?mode=repeats` opens
 * Repeats. Rights come from the live session and the operations packs; the
 * routes re-check every write.
 */
export default async function V2AdminNewJobPage({
  searchParams,
}: {
  searchParams: { propertyId?: string; duplicate?: string; mode?: string };
}) {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const [levels, settings] = await Promise.all([getOpsAccess(session.user), getAppSettings()]);
  const rights = newJobRights(levels, session.impersonation?.mode === "READ_ONLY");
  const timezone = settings.timezone || "Australia/Sydney";
  const todayKey = timezone === "Australia/Sydney" ? sydneyTodayKey() : formatInTimeZone(new Date(), timezone, "yyyy-MM-dd");
  const actorId = session.impersonation?.actorId ?? session.user.id;
  const mode = searchParams.mode === "several" || searchParams.mode === "repeats" ? searchParams.mode : null;

  return (
    <NewJobPage
      storageScope={`${actorId}:${session.user.id}:${session.user.role}`}
      timezone={timezone}
      todayKey={todayKey}
      initialPropertyId={searchParams.propertyId?.trim() || null}
      initialDuplicateId={searchParams.duplicate?.trim() || null}
      initialMode={mode}
      rights={rights}
    />
  );
}
