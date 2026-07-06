import { Role } from "@prisma/client";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { PayRequestsPanel } from "@/components/v2/cleaner/pay-requests-panel";

export const metadata = { title: "Pay requests · Estate cleaner" };
export const dynamic = "force-dynamic";

const TZ = "Australia/Sydney";

export default async function CleanerPayRequestsRoutePage() {
  const session = await requireRole([Role.CLEANER]);

  // Same data source + scoping as the live cleaner pay-requests route: the
  // cleaner's recent jobs + active properties feed the request form. The live
  // component owns its own create/withdraw flow against /api/cleaner/pay-adjustments.
  const [jobs, properties] = await Promise.all([
    db.job
      .findMany({
        where: {
          assignments: { some: { userId: session.user.id, removedAt: null } },
          status: { in: ["SUBMITTED", "QA_REVIEW", "COMPLETED", "INVOICED"] },
        },
        include: { property: { select: { name: true } } },
        orderBy: { scheduledDate: "desc" },
        take: 200,
      })
      .catch(() => [] as any[]),
    db.property
      .findMany({
        where: { isActive: true },
        select: { id: true, name: true, suburb: true },
        orderBy: [{ name: "asc" }],
      })
      .catch(() => [] as Array<{ id: string; name: string; suburb: string | null }>),
  ]);

  const jobOptions = jobs.map((job: any) => ({
    id: job.id,
    label: `${job.property.name} - ${format(toZonedTime(job.scheduledDate, TZ), "dd MMM yyyy")}`,
  }));

  const propertyOptions = properties.map((property) => ({
    id: property.id,
    label: property.suburb ? `${property.name} (${property.suburb})` : property.name,
  }));

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Earnings"
        title="Extra pay requests"
        description="Submit job-linked, property, or standalone extra payment requests with evidence."
      />
      <PayRequestsPanel jobs={jobOptions} properties={propertyOptions} />
    </div>
  );
}
