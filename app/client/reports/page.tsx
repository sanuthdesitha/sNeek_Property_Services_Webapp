import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { ensureClientModuleAccess } from "@/lib/portal-access";
import { Role } from "@prisma/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { FileText } from "lucide-react";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { ClientReportDownloadButton } from "@/components/client/report-download-button";
import { getClientPortalContext } from "@/lib/client/portal";

const TZ = "Australia/Sydney";

type RangeType = "weekly" | "monthly" | "annual";

function startDateForRange(range: RangeType) {
  const now = new Date();
  if (range === "weekly") {
    const day = now.getDay();
    const diff = day === 0 ? 6 : day - 1;
    const start = new Date(now);
    start.setDate(now.getDate() - diff);
    start.setHours(0, 0, 0, 0);
    return start;
  }
  if (range === "annual") {
    return new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
  }
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
}

export default async function ClientReportsPage({
  searchParams,
}: {
  searchParams?: { range?: string; propertyId?: string };
}) {
  await ensureClientModuleAccess("reports");
  const session = await requireRole([Role.CLIENT]);
  const appSettings = await getAppSettings();
  const portal = await getClientPortalContext(session.user.id, appSettings);
  const range = (searchParams?.range as RangeType) || "monthly";
  const rangeType: RangeType = ["weekly", "monthly", "annual"].includes(range) ? range : "monthly";
  const visibility = portal.visibility;

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      clientId: true,
      client: {
        select: {
          properties: {
            where: { isActive: true },
            select: { id: true, name: true },
            orderBy: { name: "asc" },
          },
        },
      },
    },
  });

  const fromDate = startDateForRange(rangeType);
  const allowedPropertyIds = new Set((user?.client?.properties ?? []).map((property) => property.id));
  const selectedPropertyId =
    searchParams?.propertyId && allowedPropertyIds.has(searchParams.propertyId)
      ? searchParams.propertyId
      : undefined;

  const reports = user?.clientId
    ? await db.report.findMany({
        where: {
          createdAt: { gte: fromDate },
          clientVisible: true,
          job: {
            property: { clientId: user.clientId, ...(selectedPropertyId ? { id: selectedPropertyId } : {}) },
            status: { in: ["COMPLETED", "INVOICED"] },
          },
        },
        include: {
          job: {
            select: {
              id: true,
              scheduledDate: true,
              jobType: true,
              property: { select: { name: true, suburb: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      })
    : [];

  const totalJobs = reports.length;
  const properties = Array.from(new Set(reports.map((r) => r.job.property.name))).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Reports</h1>
          <p className="text-sm text-muted-foreground">
            {rangeType[0].toUpperCase() + rangeType.slice(1)} view from {format(fromDate, "dd MMM yyyy")}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/client">Back</Link>
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button asChild variant={rangeType === "weekly" ? "default" : "outline"} size="sm">
          <Link href="/client/reports?range=weekly">Weekly</Link>
        </Button>
        <Button asChild variant={rangeType === "monthly" ? "default" : "outline"} size="sm">
          <Link href="/client/reports?range=monthly">Monthly</Link>
        </Button>
        <Button asChild variant={rangeType === "annual" ? "default" : "outline"} size="sm">
          <Link href="/client/reports?range=annual">Annual</Link>
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button asChild variant={!selectedPropertyId ? "default" : "outline"} size="sm">
          <Link href={`/client/reports?range=${rangeType}`}>All properties</Link>
        </Button>
        {(user?.client?.properties ?? []).map((property) => (
          <Button
            key={property.id}
            asChild
            variant={selectedPropertyId === property.id ? "default" : "outline"}
            size="sm"
          >
            <Link href={`/client/reports?range=${rangeType}&propertyId=${property.id}`}>{property.name}</Link>
          </Button>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Reports in range</p>
            <p className="text-2xl font-bold">{totalJobs}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Properties covered</p>
            <p className="text-2xl font-bold">{properties}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="divide-y">
            {reports.map((report) => (
              <div key={report.id} className="flex items-center justify-between gap-3 px-6 py-4">
                <div className="flex min-w-0 items-center gap-3">
                  <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-sm">{report.job.property.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {report.job.jobType.replace(/_/g, " ")} - {" "}
                      {format(toZonedTime(report.job.scheduledDate, TZ), "dd MMM yyyy")}
                    </p>
                  </div>
                </div>
                {visibility.showReportDownloads ? (
                  <ClientReportDownloadButton jobId={report.job.id} label="Download PDF" />
                ) : (
                  <span className="text-xs text-muted-foreground">PDF download hidden by admin</span>
                )}
              </div>
            ))}
            {reports.length === 0 && (
              <p className="py-10 text-center text-sm text-muted-foreground">No reports available for this period.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
