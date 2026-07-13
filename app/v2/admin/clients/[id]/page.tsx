import Link from "next/link";
import { format } from "date-fns";
import { notFound } from "next/navigation";
import { ClientInvoiceStatus, JobStatus, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EPageHeader,
  EStatCard,
  EEmptyState,
} from "@/components/v2/ui/primitives";
import { ArrowLeft, Building2, FileText, Mail, Phone, TrendingUp, Wallet } from "lucide-react";
import { ClientAutomationRules } from "@/components/v2/admin/clients/client-automation-rules";
import { ClientActions } from "@/components/v2/admin/clients/client-actions";
import { ClientProfit } from "@/components/v2/admin/clients/client-profit";
import { ClientTimeline } from "@/components/v2/admin/clients/client-timeline";
import ClientCommunications from "@/components/v2/admin/clients/client-communications";
import { getFinanceSummary } from "@/lib/finance/summary";
import { sydneyTodayKey, addDaysToKey } from "@/lib/time/sydney-range";

export const metadata = { title: "Client · Estate admin" };
export const dynamic = "force-dynamic";

type Tone = "neutral" | "primary" | "gold" | "success" | "warning" | "danger" | "info" | "aubergine";

function jobStatusTone(status: JobStatus): Tone {
  switch (status) {
    case JobStatus.UNASSIGNED:
    case JobStatus.OFFERED:
      return "warning";
    case JobStatus.ASSIGNED:
    case JobStatus.EN_ROUTE:
      return "primary";
    case JobStatus.IN_PROGRESS:
    case JobStatus.PAUSED:
    case JobStatus.WAITING_CONTINUATION_APPROVAL:
      return "info";
    case JobStatus.QA_REVIEW:
      return "aubergine";
    case JobStatus.COMPLETED:
    case JobStatus.INVOICED:
      return "success";
    default:
      return "neutral";
  }
}

function invoiceStatusTone(status: ClientInvoiceStatus): Tone {
  switch (status) {
    case ClientInvoiceStatus.APPROVED:
      return "info";
    case ClientInvoiceStatus.SENT:
      return "warning";
    case ClientInvoiceStatus.PAID:
      return "success";
    default:
      return "neutral";
  }
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function money(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-AU");
}

function initials(name: string): string {
  return (
    name
      .replace(/[^A-Za-z ]/g, "")
      .split(" ")
      .filter(Boolean)
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

async function getClient(id: string) {
  const client = await db.client
    .findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        address: true,
        suburb: true,
        state: true,
        postcode: true,
        notes: true,
        isActive: true,
        createdAt: true,
        properties: {
          where: { isActive: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true, suburb: true, bedrooms: true, bathrooms: true },
        },
      },
    })
    .catch(() => null);
  if (!client) return null;

  const propertyIds = client.properties.map((p) => p.id);

  const [recentJobs, outstanding] = await Promise.all([
    propertyIds.length
      ? db.job
          .findMany({
            where: { propertyId: { in: propertyIds } },
            orderBy: { scheduledDate: "desc" },
            take: 8,
            select: {
              id: true,
              jobNumber: true,
              jobType: true,
              status: true,
              scheduledDate: true,
              property: { select: { name: true, suburb: true } },
            },
          })
          .catch(() => [])
      : Promise.resolve([]),
    db.clientInvoice
      .findMany({
        where: {
          clientId: id,
          status: { in: [ClientInvoiceStatus.APPROVED, ClientInvoiceStatus.SENT] },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          totalAmount: true,
          createdAt: true,
        },
      })
      .catch(() => []),
  ]);

  const outstandingAud = outstanding.reduce((sum, inv) => sum + (inv.totalAmount ?? 0), 0);

  // Per-client profit over a trailing 12-month window. We reuse the canonical
  // finance engine (getFinanceSummary) and filter its byClient rows to this
  // client — never duplicate the margin math here.
  const todayKey = sydneyTodayKey();
  const startKey = addDaysToKey(todayKey, -365);
  const [finance, rateRows] = await Promise.all([
    getFinanceSummary({ startDate: startKey, endDate: todayKey }).catch(() => null),
    propertyIds.length
      ? db.propertyClientRate
          .findMany({
            where: { propertyId: { in: propertyIds }, isActive: true },
            select: { propertyId: true },
          })
          .catch(() => [])
      : Promise.resolve([]),
  ]);

  const profitRow = finance?.byClient.find((row) => row.clientId === id) ?? null;
  const activeRateCount = rateRows.length;
  const ratedPropertyCount = new Set(rateRows.map((r) => r.propertyId)).size;

  return {
    client,
    recentJobs,
    outstanding,
    outstandingAud,
    profitRow,
    activeRateCount,
    ratedPropertyCount,
  };
}

export default async function AdminClientDetailPage({ params }: { params: { id: string } }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const data = await getClient(params.id);
  if (!data) notFound();

  const { client, recentJobs, outstanding, outstandingAud, profitRow, activeRateCount, ratedPropertyCount } = data;

  const marginPctLabel =
    profitRow && profitRow.marginPct !== null ? `${profitRow.marginPct.toFixed(0)}% margin` : "12-mo";
  const marginTone: "success" | "danger" | "neutral" = profitRow
    ? profitRow.grossMargin >= 0
      ? "success"
      : "danger"
    : "neutral";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <EButton asChild variant="ghost" size="icon"><Link href="/v2/admin/clients" aria-label="Back to client register"><ArrowLeft className="h-4 w-4" /></Link></EButton>
        <span className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Clients</span>
      </div>

      <EPageHeader
        eyebrow="Client 360"
        title={client.name}
        description={client.suburb ? `Based in ${client.suburb}` : "Client record"}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <EBadge tone={client.isActive ? "primary" : "neutral"} soft>{client.isActive ? "Active" : "Inactive"}</EBadge>
            <ClientActions
              client={{
                id: client.id,
                name: client.name,
                email: client.email,
                phone: client.phone,
                address: client.address,
                suburb: client.suburb,
                state: client.state,
                postcode: client.postcode,
                notes: client.notes,
                isActive: client.isActive,
              }}
            />
          </div>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <EStatCard label="Properties" value={String(client.properties.length)} delta="active" deltaTone="neutral" icon={<Building2 className="h-4 w-4" />} />
        <EStatCard label="Gross margin · 12mo" value={profitRow ? money(profitRow.grossMargin) : "—"} delta={marginPctLabel} deltaTone={marginTone} icon={<TrendingUp className="h-4 w-4" />} />
        <EStatCard label="Outstanding" value={money(outstandingAud)} delta={`${outstanding.length} invoice${outstanding.length === 1 ? "" : "s"}`} deltaTone="neutral" icon={<Wallet className="h-4 w-4" />} />
        <EStatCard label="Client since" value={format(new Date(client.createdAt), "MMM yyyy")} delta="onboarded" deltaTone="neutral" icon={<FileText className="h-4 w-4" />} />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Contact */}
        <ECard className="lg:col-span-1">
          <ECardHeader className="pb-2"><ECardTitle className="text-[0.95rem]">Contact</ECardTitle></ECardHeader>
          <ECardBody className="space-y-2.5 pt-0 text-[0.8125rem]">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-full text-[0.75rem] font-semibold text-[hsl(var(--e-accent-portal-foreground))]" style={{ backgroundColor: "hsl(var(--e-accent-portal))" }}>
                {initials(client.name)}
              </span>
              <span className="font-[550]">{client.name}</span>
            </div>
            {client.email ? (
              <p className="flex items-center gap-2 text-[hsl(var(--e-text-secondary))]"><Mail className="h-3.5 w-3.5 text-[hsl(var(--e-text-faint))]" /> {client.email}</p>
            ) : null}
            {client.phone ? (
              <p className="flex items-center gap-2 text-[hsl(var(--e-text-secondary))]"><Phone className="h-3.5 w-3.5 text-[hsl(var(--e-text-faint))]" /> {client.phone}</p>
            ) : null}
            {client.address ? (
              <p className="flex items-center gap-2 text-[hsl(var(--e-muted-foreground))]"><Building2 className="h-3.5 w-3.5 text-[hsl(var(--e-text-faint))]" /> {client.address}{client.suburb ? `, ${client.suburb}` : ""}</p>
            ) : null}
          </ECardBody>
        </ECard>

        {/* Properties */}
        <ECard className="lg:col-span-2">
          <ECardHeader className="pb-2"><ECardTitle className="text-[0.95rem]">Properties</ECardTitle></ECardHeader>
          <ECardBody className="pt-0">
            {client.properties.length === 0 ? (
              <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No active properties.</p>
            ) : (
              <ul className="divide-y divide-[hsl(var(--e-border)/0.7)]">
                {client.properties.map((p) => (
                  <li key={p.id} className="flex items-center justify-between py-2.5 text-[0.8125rem]">
                    <div className="min-w-0">
                      <p className="font-[550] truncate">{p.name}</p>
                      {p.suburb ? <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">{p.suburb}</p> : null}
                    </div>
                    <span className="text-[hsl(var(--e-muted-foreground))] tabular-nums whitespace-nowrap">{p.bedrooms} bd · {p.bathrooms} ba</span>
                  </li>
                ))}
              </ul>
            )}
          </ECardBody>
        </ECard>
      </div>

      {/* Profit & pricing */}
      <ClientProfit
        row={profitRow}
        rangeLabel="Trailing 12 months"
        activeRateCount={activeRateCount}
        ratedPropertyCount={ratedPropertyCount}
      />

      {/* Communications hub (component authored separately) */}
      <section>
        <ClientCommunications clientId={client.id} />
      </section>

      {/* Unified activity + cleaner-update timeline */}
      <ClientTimeline clientId={client.id} />

      {/* Recent jobs */}
      <ECard>
        <ECardHeader className="pb-2"><ECardTitle className="text-[0.95rem]">Recent jobs</ECardTitle></ECardHeader>
        <ECardBody className="pt-0">
          {recentJobs.length === 0 ? (
            <EEmptyState eyebrow="No jobs" title="Nothing scheduled yet" description="This client's jobs will appear here." />
          ) : (
            <div className="overflow-x-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
              <table className="w-full text-[0.8125rem]">
                <thead>
                  <tr className="bg-[hsl(var(--e-surface-raised))] text-left">
                    {["Date", "Property", "Service", "Status", ""].map((h) => (
                      <th key={h} className="px-3 py-2 text-[0.625rem] font-semibold uppercase tracking-[0.06em] text-[hsl(var(--e-muted-foreground))]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recentJobs.map((j) => (
                    <tr key={j.id} className="border-t border-[hsl(var(--e-border)/0.7)] hover:bg-[hsl(var(--e-primary-soft)/0.4)]">
                      <td className="px-3 py-2.5 tabular-nums whitespace-nowrap">{format(new Date(j.scheduledDate), "d MMM yy")}</td>
                      <td className="px-3 py-2.5">{[j.property?.name, j.property?.suburb].filter(Boolean).join(", ") || "Property"}</td>
                      <td className="px-3 py-2.5 text-[hsl(var(--e-text-secondary))]">{titleCase(j.jobType)}</td>
                      <td className="px-3 py-2.5"><EBadge tone={jobStatusTone(j.status)} soft>{titleCase(j.status)}</EBadge></td>
                      <td className="px-3 py-2.5 text-right"><EButton asChild variant="ghost" size="sm"><Link href={`/v2/admin/jobs/${j.id}`}>Open</Link></EButton></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ECardBody>
      </ECard>

      {/* Outstanding invoices */}
      <ECard>
        <ECardHeader className="flex-row items-center justify-between pb-2">
          <ECardTitle className="text-[0.95rem]">Outstanding invoices</ECardTitle>
          <EButton asChild variant="ghost" size="sm"><Link href="/v2/admin/finance/invoices">All invoices</Link></EButton>
        </ECardHeader>
        <ECardBody className="pt-0">
          {outstanding.length === 0 ? (
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No outstanding invoices.</p>
          ) : (
            <div className="overflow-x-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
              <table className="w-full text-[0.8125rem]">
                <thead>
                  <tr className="bg-[hsl(var(--e-surface-raised))] text-left">
                    {["Invoice", "Raised", "Amount", "Status"].map((h) => (
                      <th key={h} className="px-3 py-2 text-[0.625rem] font-semibold uppercase tracking-[0.06em] text-[hsl(var(--e-muted-foreground))]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {outstanding.map((inv) => (
                    <tr key={inv.id} className="border-t border-[hsl(var(--e-border)/0.7)] hover:bg-[hsl(var(--e-primary-soft)/0.4)]">
                      <td className="px-3 py-2.5 font-medium whitespace-nowrap">{inv.invoiceNumber}</td>
                      <td className="px-3 py-2.5 tabular-nums whitespace-nowrap text-[hsl(var(--e-text-secondary))]">{format(new Date(inv.createdAt), "d MMM yy")}</td>
                      <td className="px-3 py-2.5"><span className="e-numeral text-[0.9375rem]">{money(inv.totalAmount)}</span></td>
                      <td className="px-3 py-2.5"><EBadge tone={invoiceStatusTone(inv.status)} soft>{titleCase(inv.status)}</EBadge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ECardBody>
      </ECard>

      {/* Per-client message automation rules */}
      <ClientAutomationRules clientId={client.id} />

      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Estate preview · read-only · live data from your workspace.</p>
    </div>
  );
}
