import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { ensureCleanerModuleAccess } from "@/lib/portal-access";
import { Role } from "@prisma/client";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { CleanerLostFoundPage } from "@/components/cleaner/lost-found-page";

const TZ = "Australia/Sydney";

export default async function CleanerLostFoundRoutePage() {
  await ensureCleanerModuleAccess("lostFound");
  const session = await requireRole([Role.CLEANER]);
  const jobs = await db.job.findMany({
    where: {
      assignments: { some: { userId: session.user.id } },
    },
    include: { property: { select: { name: true } } },
    orderBy: { scheduledDate: "desc" },
    take: 200,
  });

  const jobOptions = jobs.map((job) => ({
    id: job.id,
    label: `${job.property.name} - ${format(toZonedTime(job.scheduledDate, TZ), "dd MMM yyyy")}`,
  }));

  return <CleanerLostFoundPage jobs={jobOptions} />;
}
