import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getClientPortalContext } from "@/lib/client/portal";
import { listClientReportsForUser } from "@/lib/client/portal-data";
import {
  ECard,
  ECardBody,
  EEmptyState,
  EPageHeader,
} from "@/components/v2/ui/primitives";
import { ClientReportDownloadButton } from "@/components/client/report-download-button";
import { FileText } from "lucide-react";

export const metadata = { title: "Reports · Estate client" };
export const dynamic = "force-dynamic";

const TZ = "Australia/Sydney";

function titleCase(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function ClientReportsPage() {
  const session = await requireRole([Role.CLIENT]);
  const portal = await getClientPortalContext(session.user.id).catch(() => null);

  if (!portal?.visibility.showReports) {
    return (
      <div className="space-y-6">
        <EPageHeader eyebrow="Service records" title="Reports" description="Completed-service reports for your properties." />
        <EEmptyState
          eyebrow="Not available"
          title="Reports are hidden"
          description="Your account manager has not enabled report visibility for this portal."
        />
      </div>
    );
  }

  const reports = await listClientReportsForUser(session.user.id).catch(() => []);
  const showDownloads = portal.visibility.showReportDownloads;
  const propertiesCovered = new Set(reports.map((r) => r.job.property.name)).size;

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Service records"
        title="Reports"
        description={
          reports.length > 0
            ? `${reports.length} report${reports.length === 1 ? "" : "s"} across ${propertiesCovered} propert${propertiesCovered === 1 ? "y" : "ies"}.`
            : "Completed-service reports for your properties."
        }
      />

      {reports.length === 0 ? (
        <EEmptyState
          eyebrow="Nothing yet"
          title="No reports available"
          description="Reports appear here once a service is completed for one of your properties."
        />
      ) : (
        <ECard>
          <ECardBody className="pt-6">
            <div className="divide-y divide-[hsl(var(--e-border))]">
              {reports.map((report) => (
                <div
                  key={report.id}
                  className="flex items-center justify-between gap-3 py-4 first:pt-0 last:pb-0"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <FileText className="h-5 w-5 shrink-0 text-[hsl(var(--e-text-faint))]" />
                    <div className="min-w-0">
                      <p className="truncate text-[0.875rem] font-medium">
                        {report.job.property.name}
                      </p>
                      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        {titleCase(report.job.jobType)} ·{" "}
                        {format(toZonedTime(report.job.scheduledDate, TZ), "d MMM yyyy")}
                      </p>
                    </div>
                  </div>
                  {showDownloads ? (
                    <ClientReportDownloadButton jobId={report.job.id} label="Download PDF" />
                  ) : (
                    <span className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                      PDF hidden
                    </span>
                  )}
                </div>
              ))}
            </div>
          </ECardBody>
        </ECard>
      )}
    </div>
  );
}
