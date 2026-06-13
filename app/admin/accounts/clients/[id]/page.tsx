import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  Briefcase,
  Receipt,
  Star,
  Wallet,
  Mail,
  Phone,
  MapPin,
  MessageSquare,
  Settings2,
  RadioTower,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { ChartCard, KpiTile } from "@/components/charts";
import { ClientDetailWorkspace } from "@/components/admin/client-detail-workspace";
import { ProfileActivityLog } from "@/components/admin/profile-activity-log";
import { getClientStats, getClientExtras } from "@/lib/accounts/client-stats";
import { ClientTrendChart } from "@/components/accounts/client-trend-chart";

export const dynamic = "force-dynamic";

const fmtMoney = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 2,
});

function prettify(value?: string | null) {
  return String(value ?? "").replace(/_/g, " ").trim();
}

export default async function ClientSummaryPage({ params }: { params: { id: string } }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  const client = await db.client.findUnique({
    where: { id: params.id },
    include: {
      automationRules: {
        include: { template: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
      },
      leads: {
        select: {
          id: true,
          serviceType: true,
          estimateMin: true,
          estimateMax: true,
          status: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      },
      quotes: {
        select: { id: true, status: true, totalAmount: true, createdAt: true, validUntil: true },
        orderBy: { createdAt: "desc" },
      },
      cases: {
        select: { id: true, title: true, status: true, caseType: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      },
      properties: {
        where: { isActive: true },
        orderBy: { name: "asc" },
        include: {
          integration: { select: { isEnabled: true, icalUrl: true, syncStatus: true } },
          jobs: {
            select: {
              id: true,
              jobNumber: true,
              jobType: true,
              status: true,
              scheduledDate: true,
              property: { select: { id: true, name: true, suburb: true } },
            },
            orderBy: { scheduledDate: "desc" },
            take: 100,
          },
        },
      },
    },
  });

  if (!client) notFound();

  const jobs = client.properties.flatMap((p) => p.jobs);
  const [stats, extras] = await Promise.all([
    getClientStats(params.id),
    getClientExtras(params.id),
  ]);

  const enabledRules = client.automationRules.filter((r) => r.isEnabled);
  const hasTrend = extras.trend.some((p) => p.revenue > 0 || p.jobs > 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/admin/accounts?tab=clients" aria-label="Back to accounts">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <PageHeader
          className="flex-1"
          icon={<Building2 />}
          title={client.name}
          description="Client account summary — properties, jobs, invoices, satisfaction & more."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" asChild>
                <Link href={`/admin/clients/${client.id}/hub`}>
                  <RadioTower className="mr-2 h-4 w-4" />
                  Client hub
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href={`/admin/messages/compose?recipient=${client.id}`}>
                  <MessageSquare className="mr-2 h-4 w-4" />
                  Message
                </Link>
              </Button>
            </div>
          }
        />
      </div>

      {/* Contact line */}
      <Card className="rounded-2xl">
        <CardContent className="flex flex-wrap items-center gap-x-5 gap-y-2 p-4 text-sm text-muted-foreground">
          {client.email ? (
            <span className="inline-flex items-center gap-1">
              <Mail className="h-3.5 w-3.5" />
              {client.email}
            </span>
          ) : null}
          {client.phone ? (
            <span className="inline-flex items-center gap-1">
              <Phone className="h-3.5 w-3.5" />
              {client.phone}
            </span>
          ) : null}
          {(client.suburb || client.address) ? (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />
              {[client.suburb, client.state].filter(Boolean).join(", ") || client.address}
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1">
            Client since {new Date(client.createdAt).toLocaleDateString("en-AU")}
          </span>
        </CardContent>
      </Card>

      {/* KPI strip */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <KpiTile icon={<Building2 />} tone="info" label="Properties" value={stats.propertiesCount} />
        <KpiTile
          icon={<Briefcase />}
          tone="primary"
          label="Jobs (total)"
          value={stats.totalJobs}
        />
        <KpiTile icon={<Briefcase />} tone="accent" label="Jobs (30d)" value={stats.jobsLast30d} />
        <KpiTile
          icon={<Wallet />}
          tone="success"
          label="Lifetime value"
          value={fmtMoney.format(stats.totalSpend)}
        />
        <KpiTile
          icon={<Receipt />}
          tone="warning"
          label="Outstanding"
          value={fmtMoney.format(stats.outstandingAmount)}
        />
        <KpiTile
          icon={<Star />}
          tone="primary"
          label="Avg rating"
          value={stats.averageRating !== null ? `★ ${stats.averageRating.toFixed(1)}` : "—"}
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          {hasTrend ? (
            <ChartCard title="Revenue & jobs" subtitle="Paid invoices and completed jobs · last 6 months">
              <ClientTrendChart data={extras.trend} />
            </ChartCard>
          ) : null}

          {/* Special payments */}
          <Card className="rounded-2xl">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Wallet className="h-4 w-4 text-primary" />
                Special payments
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Cleaner pay adjustments tied to this client&apos;s jobs and properties.
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              {extras.specialPayments.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  No special payments recorded for this client.
                </div>
              ) : (
                extras.specialPayments.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{p.title || prettify(p.type)}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(p.requestedAt).toLocaleDateString("en-AU")}
                        {p.cleanerName ? ` · ${p.cleanerName}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-sm font-medium tabular-nums">{fmtMoney.format(p.amount)}</span>
                      <Badge
                        variant={
                          p.status === "APPROVED"
                            ? "success"
                            : p.status === "PENDING"
                              ? "warning"
                              : "secondary"
                        }
                      >
                        {prettify(p.status)}
                      </Badge>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* Full detail workspace (properties, jobs, leads, quotes, cases, notes) */}
          <ClientDetailWorkspace
            client={{
              id: client.id,
              name: client.name,
              email: client.email,
              phone: client.phone,
              address: client.address,
              notes: client.notes,
              createdAt: client.createdAt,
              leads: client.leads,
              quotes: client.quotes,
              cases: client.cases,
              properties: client.properties.map((property) => ({
                id: property.id,
                name: property.name,
                address: property.address,
                suburb: property.suburb,
                bedrooms: property.bedrooms,
                bathrooms: property.bathrooms,
                integration: property.integration,
              })),
              jobs,
            }}
          />
        </div>

        <div className="space-y-6">
          {/* Invoices summary */}
          <Card className="rounded-2xl">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Receipt className="h-4 w-4 text-primary" />
                Invoices
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row label="Lifetime value" value={fmtMoney.format(stats.totalSpend)} />
              <Row label="Invoices paid" value={stats.invoicesPaid} />
              <Row
                label="Outstanding"
                value={`${fmtMoney.format(stats.outstandingAmount)} (${stats.invoicesOutstanding})`}
                warn={stats.outstandingAmount > 0}
              />
              <Row
                label="Last invoice"
                value={stats.lastInvoiceAt ? new Date(stats.lastInvoiceAt).toLocaleDateString("en-AU") : "—"}
              />
            </CardContent>
          </Card>

          {/* Satisfaction / feedback */}
          <Card className="rounded-2xl">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Star className="h-4 w-4 text-primary" />
                Satisfaction
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Row
                label="Average rating"
                value={stats.averageRating !== null ? `★ ${stats.averageRating.toFixed(1)}` : "—"}
              />
              <Row label="Ratings on file" value={stats.ratingSampleSize} />
              {extras.recentFeedback.length > 0 ? (
                <div className="space-y-2 pt-1">
                  {extras.recentFeedback.map((f) => (
                    <div key={f.id} className="rounded-lg border border-border px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium">{f.propertyName ?? "Property"}</p>
                        <Badge variant="outline">{f.rating != null ? `${f.rating}/5` : "—"}</Badge>
                      </div>
                      {f.comment ? (
                        <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{f.comment}</p>
                      ) : null}
                      {f.submittedAt ? (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {new Date(f.submittedAt).toLocaleDateString("en-AU")}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* Automation rules */}
          <Card className="rounded-2xl">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Settings2 className="h-4 w-4 text-primary" />
                Automation ({enabledRules.length} on)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {client.automationRules.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  No automation rules configured.
                </div>
              ) : (
                client.automationRules.map((rule) => (
                  <div
                    key={rule.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{prettify(rule.triggerType)}</p>
                      <p className="text-xs text-muted-foreground">
                        {rule.template?.name ?? "No template"} · {rule.channel}
                      </p>
                    </div>
                    <Badge variant={rule.isEnabled ? "success" : "secondary"}>
                      {rule.isEnabled ? "On" : "Off"}
                    </Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <ProfileActivityLog endpoint={`/api/admin/clients/${client.id}/activity`} title="Client activity" />
    </div>
  );
}

function Row({
  label,
  value,
  warn,
}: {
  label: string;
  value: React.ReactNode;
  warn?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border pb-2 last:border-b-0 last:pb-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-semibold tabular-nums ${warn ? "text-warning" : ""}`}>{value}</span>
    </div>
  );
}
