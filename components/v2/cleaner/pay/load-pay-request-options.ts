/**
 * Options for the extra pay request form: the cleaner's own finished jobs and
 * the active properties. Same reads and scoping as the former standalone
 * pay-requests page (assignment-scoped, removedAt null). Server only.
 */
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { db } from "@/lib/db";

const TZ = "Australia/Sydney";

export interface PayRequestOption {
  id: string;
  label: string;
}

export async function loadPayRequestOptions(userId: string): Promise<{ jobs: PayRequestOption[]; properties: PayRequestOption[] }> {
  const [jobs, properties] = await Promise.all([
    db.job
      .findMany({
        where: {
          assignments: { some: { userId, removedAt: null } },
          status: { in: ["SUBMITTED", "QA_REVIEW", "COMPLETED", "INVOICED"] },
        },
        select: { id: true, scheduledDate: true, property: { select: { name: true } } },
        orderBy: { scheduledDate: "desc" },
        take: 200,
      })
      .catch(() => []),
    db.property
      .findMany({ where: { isActive: true }, select: { id: true, name: true, suburb: true }, orderBy: [{ name: "asc" }] })
      .catch(() => [] as Array<{ id: string; name: string; suburb: string | null }>),
  ]);
  return {
    jobs: jobs.map((job) => ({ id: job.id, label: `${job.property.name} - ${format(toZonedTime(job.scheduledDate, TZ), "dd MMM yyyy")}` })),
    properties: properties.map((property) => ({
      id: property.id,
      label: property.suburb ? `${property.name} (${property.suburb})` : property.name,
    })),
  };
}
