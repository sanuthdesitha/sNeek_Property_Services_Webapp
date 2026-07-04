import { Role } from "@prisma/client";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { ensureCleanerModuleAccess } from "@/lib/portal-access";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { CleanerLostFoundPage } from "@/components/cleaner/lost-found-page";

export const metadata = { title: "Lost & found · Estate cleaner" };
export const dynamic = "force-dynamic";

const TZ = "Australia/Sydney";

/**
 * Estate wrapper for lost & found. Same module gate + data source as the legacy
 * `app/cleaner/lost-found` route: the session cleaner's assigned jobs become the
 * dropdown of jobs a found item can be logged against. The mounted
 * `CleanerLostFoundPage` client component owns the log/list mutations.
 */
export default async function V2CleanerLostFoundPage() {
  await ensureCleanerModuleAccess("lostFound");
  const session = await requireRole([Role.CLEANER]);

  const jobs = await db.job
    .findMany({
      where: { assignments: { some: { userId: session.user.id, removedAt: null } } },
      include: { property: { select: { name: true } } },
      orderBy: { scheduledDate: "desc" },
      take: 200,
    })
    .catch(() => []);

  const jobOptions = jobs.map((job) => ({
    id: job.id,
    label: `${job.property.name} - ${format(toZonedTime(job.scheduledDate, TZ), "dd MMM yyyy")}`,
  }));

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Recovery"
        title="Lost & found"
        description="Log items found on a job so the office can reunite them with guests."
      />
      <CleanerLostFoundPage jobs={jobOptions} />
    </div>
  );
}
