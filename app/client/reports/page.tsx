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
import { PageHeader } from "@/components/ui/page-header";
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
  searchParams?: { range?: string; propertyId?: string; type?: string };
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

  // Fetch reports for the chosen range + property (without the type filter), so
  // the available job-type chips reflect what actually exists in this slice.
  const allReports = user?.clientId
    ? await db.report.findMany({
        where: {
          // Gate on clientVisible alone (a Report only exists once the cleaner
          // submits). The old job.status IN (COMPLETED, INVOICED) arm hid every
          // finished report still in SUBMITTED/QA_REVIEW. Window on the job's
          // scheduledDate (the displayed date), not the report's createdAt.
          clientVisible: true,
          job: {
            scheduledDate: { gte: fromDate },
            property: { clientId: user.clientId, ...(selectedPropertyId ? { id: selectedPropertyId } : {}) },
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
        orderBy: { job: { scheduledDate: "desc" } },
      })
    : [];

  const availableTypes = Array.from(new Set(allReports.map((r) => r.job.jobType))).sort();
  const selectedType =
    searchParams?.type && availableTypes.includes(searchParams.type as (typeof availableTypes)[number])
      ? searchParams.type
      : undefined;
  const reports = selectedType ? allReports.filter((r) => r.job.jobType === selectedType) : allReports;

  const totalJobs = reports.length;
  const properties = Array.from(new Set(reports.map((r) => r.job.property.name))).length;

  // Build hrefs that preserve the other active filters.
  const buildHref = (overrides: { range?: RangeType; propertyId?: string | null; type?: string | null }) => {
    const params = new URLSearchParams();
    params.set("range", overrides.range ?? rangeType);
    const p = overrides.propertyId === null ? undefined : overrides.propertyId ?? selectedPropertyId;
    if (p) params.set("propertyId", p);
    const t = overrides.type === null ? undefined : overrides.type ?? selectedType;
    if (t) params.set("type", t);
    return `/client/reports?${params.toString()}`;
  };

  const prettyType = (t: string) => t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<FileText />}
        title="Reports"
        description={`${rangeType[0].toUpperCase() + rangeType.slice(1)} view from ${format(fromDate, "dd MMM yyyy")}`}
        actions={
          <Button asChild variant="outline">
            <Link href="/client">Back</Link>
          </Button>
        }
      />

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-xs font-medium uppercase tracking-wide text-muted-foreground">Period</span>
          {(["weekly", "monthly", "annual"] as const).map((r) => (
            <Button key={r} asChild variant={rangeType === r ? "default" : "outline"} size="sm">
              <Link href={buildHref({ range: r })}>{r[0].toUpperCase() + r.slice(1)}</Link>
            </Button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-xs font-medium uppercase tracking-wide text-muted-foreground">Property</span>
          <Button asChild variant={!selectedPropertyId ? "default" : "outline"} size="sm">
            <Link href={buildHref({ propertyId: null })}>All</Link>
          </Button>
          {(user?.client?.properties ?? []).map((property) => (
            <Button
              key={property.id}
              asChild
              variant={selectedPropertyId === property.id ? "default" : "outline"}
              size="sm"
            >
              <Link href={buildHref({ propertyId: property.id })}>{property.name}</Link>
            </Button>
          ))}
        </div>

        {availableTypes.length > 1 || selectedType ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-16 text-xs font-medium uppercase tracking-wide text-muted-foreground">Type</span>
            <Button asChild variant={!selectedType ? "default" : "outline"} size="sm">
              <Link href={buildHref({ type: null })}>All</Link>
            </Button>
            {availableTypes.map((t) => (
              <Button key={t} asChild variant={selectedType === t ? "default" : "outline"} size="sm">
                <Link href={buildHref({ type: t })}>{prettyType(t)}</Link>
              </Button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Reports in range</p>
            <p className="text-2xl font-bold tracking-tight tabular-nums">{totalJobs}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Properties covered</p>
            <p className="text-2xl font-bold tracking-tight tabular-nums">{properties}</p>
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
