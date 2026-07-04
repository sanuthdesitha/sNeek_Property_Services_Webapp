import Link from "next/link";
import { format } from "date-fns";
import { QuoteStatus, LeadStatus, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { formatCurrency } from "@/lib/utils";
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
import { FileText, Inbox, Send, TrendingUp } from "lucide-react";

export const metadata = { title: "Quotes · Estate admin" };
export const dynamic = "force-dynamic";

type Tone = "neutral" | "info" | "warning" | "success" | "gold" | "danger";

function quoteTone(status: QuoteStatus): Tone {
  switch (status) {
    case QuoteStatus.ACCEPTED:
      return "success";
    case QuoteStatus.SENT:
      return "info";
    case QuoteStatus.CONVERTED:
      return "gold";
    case QuoteStatus.DECLINED:
      return "danger";
    default:
      return "neutral";
  }
}

function leadTone(status: LeadStatus): Tone {
  switch (status) {
    case LeadStatus.CONVERTED:
      return "success";
    case LeadStatus.QUOTED:
      return "info";
    case LeadStatus.CONTACTED:
      return "warning";
    case LeadStatus.LOST:
      return "danger";
    default:
      return "neutral";
  }
}

function titleCase(value: string): string {
  return value.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

async function getQuotesOverview() {
  const [recentQuotes, recentLeads, leadOpen, quoteOpen, acceptedAgg] = await Promise.all([
    db.quote
      .findMany({
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          id: true,
          serviceType: true,
          status: true,
          totalAmount: true,
          createdAt: true,
          client: { select: { id: true, name: true } },
          lead: { select: { name: true } },
        },
      })
      .catch(() => []),
    db.quoteLead
      .findMany({
        orderBy: { createdAt: "desc" },
        take: 6,
        select: {
          id: true,
          name: true,
          status: true,
          serviceType: true,
          suburb: true,
          createdAt: true,
        },
      })
      .catch(() => []),
    db.quoteLead
      .count({ where: { status: { in: [LeadStatus.NEW, LeadStatus.CONTACTED, LeadStatus.QUOTED] } } })
      .catch(() => 0),
    db.quote
      .count({ where: { status: { in: [QuoteStatus.DRAFT, QuoteStatus.SENT] } } })
      .catch(() => 0),
    db.quote
      .aggregate({ where: { status: QuoteStatus.ACCEPTED }, _sum: { totalAmount: true }, _count: { _all: true } })
      .catch(() => null),
  ]);

  return {
    recentQuotes,
    recentLeads,
    leadOpen,
    quoteOpen,
    acceptedCount: acceptedAgg?._count?._all ?? 0,
    acceptedAud: acceptedAgg?._sum?.totalAmount ?? 0,
  };
}

export default async function AdminQuotesPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const data = await getQuotesOverview();

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Commercial"
        title="Quotes & leads"
        description="Pipeline from inbound lead to accepted quote."
        actions={
          <Link href="/admin/quotes">
            <EButton variant="gold" size="sm">Open quote builder</EButton>
          </Link>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <EStatCard label="Open leads" value={String(data.leadOpen)} delta="new / contacted / quoted" deltaTone="neutral" icon={<Inbox className="h-4 w-4" />} />
        <EStatCard label="Open quotes" value={String(data.quoteOpen)} delta="draft / sent" deltaTone="neutral" icon={<Send className="h-4 w-4" />} />
        <EStatCard label="Accepted value" value={formatCurrency(data.acceptedAud)} delta={`${data.acceptedCount} quote${data.acceptedCount === 1 ? "" : "s"}`} deltaTone="neutral" icon={<TrendingUp className="h-4 w-4" />} />
        <EStatCard label="Recent quotes" value={String(data.recentQuotes.length)} delta="latest" deltaTone="neutral" icon={<FileText className="h-4 w-4" />} />
      </section>

      <ECard>
        <ECardHeader className="flex-row items-center justify-between">
          <ECardTitle>Recent quotes</ECardTitle>
          <Link href="/admin/quotes"><EButton variant="ghost" size="sm">Manage quotes</EButton></Link>
        </ECardHeader>
        <ECardBody className="pt-0">
          {data.recentQuotes.length === 0 ? (
            <EEmptyState eyebrow="No quotes yet" title="Nothing to show" description="Quotes created from leads or directly will appear here." />
          ) : (
            <div className="overflow-x-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
              <table className="w-full text-[0.8125rem]">
                <thead>
                  <tr className="bg-[hsl(var(--e-surface-raised))] text-left">
                    {["Client / lead", "Service", "Amount", "Status", "Created"].map((h) => (
                      <th key={h} className="px-3 py-2 text-[0.625rem] font-semibold uppercase tracking-[0.06em] text-[hsl(var(--e-muted-foreground))]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.recentQuotes.map((q) => (
                    <tr key={q.id} className="border-t border-[hsl(var(--e-border)/0.7)] hover:bg-[hsl(var(--e-primary-soft)/0.4)]">
                      <td className="px-3 py-3 font-medium">{q.client?.name ?? q.lead?.name ?? "Direct quote"}</td>
                      <td className="px-3 py-3 text-[hsl(var(--e-text-secondary))]">{titleCase(q.serviceType)}</td>
                      <td className="px-3 py-3"><span className="e-numeral text-[0.9375rem]">{formatCurrency(q.totalAmount)}</span></td>
                      <td className="px-3 py-3"><EBadge tone={quoteTone(q.status)} soft>{titleCase(q.status)}</EBadge></td>
                      <td className="px-3 py-3 tabular-nums whitespace-nowrap text-[hsl(var(--e-text-secondary))]">{format(new Date(q.createdAt), "d MMM yy")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ECardBody>
      </ECard>

      <ECard>
        <ECardHeader className="pb-2"><ECardTitle className="text-[0.95rem]">Recent leads</ECardTitle></ECardHeader>
        <ECardBody className="pt-0">
          {data.recentLeads.length === 0 ? (
            <EEmptyState eyebrow="No leads yet" title="Nothing to show" description="Inbound leads from the public quote page will appear here." />
          ) : (
            <div className="overflow-x-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
              <table className="w-full text-[0.8125rem]">
                <thead>
                  <tr className="bg-[hsl(var(--e-surface-raised))] text-left">
                    {["Lead", "Service", "Suburb", "Status", "Created"].map((h) => (
                      <th key={h} className="px-3 py-2 text-[0.625rem] font-semibold uppercase tracking-[0.06em] text-[hsl(var(--e-muted-foreground))]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.recentLeads.map((lead) => (
                    <tr key={lead.id} className="border-t border-[hsl(var(--e-border)/0.7)] hover:bg-[hsl(var(--e-primary-soft)/0.4)]">
                      <td className="px-3 py-3 font-medium">{lead.name}</td>
                      <td className="px-3 py-3 text-[hsl(var(--e-text-secondary))]">{titleCase(lead.serviceType)}</td>
                      <td className="px-3 py-3 text-[hsl(var(--e-text-secondary))]">{lead.suburb || "—"}</td>
                      <td className="px-3 py-3"><EBadge tone={leadTone(lead.status)} soft>{titleCase(lead.status)}</EBadge></td>
                      <td className="px-3 py-3 tabular-nums whitespace-nowrap text-[hsl(var(--e-text-secondary))]">{format(new Date(lead.createdAt), "d MMM yy")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ECardBody>
      </ECard>

      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Estate preview · live data · lead triage, counter-offers, and quote editing open in the live console.</p>
    </div>
  );
}
