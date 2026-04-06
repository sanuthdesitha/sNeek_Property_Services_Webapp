import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { ensureCleanerModuleAccess } from "@/lib/portal-access";
import { Role } from "@prisma/client";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { CleanerPayRequestsPage } from "@/components/cleaner/pay-requests-page";

const TZ = "Australia/Sydney";

export default async function CleanerPayRequestsRoutePage() {
  await ensureCleanerModuleAccess("payRequests");
  const session = await requireRole([Role.CLEANER]);
  const [jobs, properties] = await Promise.all([
    db.job.findMany({
      where: {
        assignments: { some: { userId: session.user.id, removedAt: null } },
        status: { in: ["SUBMITTED", "QA_REVIEW", "COMPLETED", "INVOICED"] },
      },
      include: { property: { select: { name: true } } },
      orderBy: { scheduledDate: "desc" },
      take: 200,
    }),
    db.property.findMany({
      where: { isActive: true },
      select: { id: true, name: true, suburb: true },
      orderBy: [{ name: "asc" }],
    }),
  ]);

  const jobOptions = jobs.map((job) => ({
    id: job.id,
    label: `${job.property.name} - ${format(toZonedTime(job.scheduledDate, TZ), "dd MMM yyyy")}`,
  }));

  const propertyOptions = properties.map((property) => ({
    id: property.id,
    label: property.suburb ? `${property.name} (${property.suburb})` : property.name,
  }));

  return <CleanerPayRequestsPage jobs={jobOptions} properties={propertyOptions} />;
}
