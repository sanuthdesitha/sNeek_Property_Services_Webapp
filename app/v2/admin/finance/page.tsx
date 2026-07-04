import Link from "next/link";
import { toZonedTime } from "date-fns-tz";
import { ClientInvoiceStatus } from "@prisma/client";
import { db } from "@/lib/db";
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
import { Banknote, FileText, TrendingUp, Users } from "lucide-react";

export const metadata = { title: "Finance · Estate admin" };
export const dynamic = "force-dynamic";

const TZ = "Australia/Sydney";
const TABS = ["Overview", "Invoices", "Payroll", "Cleaner invoices", "Pricing"];

type Tone = "neutral" | "info" | "warning" | "success" | "gold";

function statusTone(status: ClientInvoiceStatus): Tone {
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

function money(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-AU");
}

async function getFinance() {
  const nowSyd = toZonedTime(new Date(), TZ);
  const monthStart = new Date(nowSyd.getFullYear(), nowSyd.getMonth(), 1);

  const [recent, outstanding, paidMtd] = await Promise.all([
    db.clientInvoice
      .findMany({
        orderBy: { createdAt: "desc" },
        take: 6,
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          totalAmount: true,
          xeroExportedAt: true,
          client: { select: { name: true } },
        },
      })
      .catch(() => []),
    db.clientInvoice
      .aggregate({
        where: { status: { in: [ClientInvoiceStatus.APPROVED, ClientInvoiceStatus.SENT] } },
        _sum: { totalAmount: true },
        _count: { _all: true },
      })
      .catch(() => null),
    db.clientInvoice
      .aggregate({
        where: { status: ClientInvoiceStatus.PAID, createdAt: { gte: monthStart } },
        _sum: { totalAmount: true },
      })
      .catch(() => null),
  ]);

  return {
    recent,
    outstandingCount: outstanding?._count?._all ?? 0,
    outstandingAud: outstanding?._sum?.totalAmount ?? 0,
    paidMtdAud: paidMtd?._sum?.totalAmount ?? 0,
  };
}

export default async function AdminFinancePage() {
  const fin = await getFinance();

  return (
    <div className="space-y-6">
      <EPageHeader eyebrow="Commercial" title="Finance" description="Revenue, invoices, payroll, and pricing — one hub." />

      {/* Tab bar (underline style) */}
      <div className="flex gap-6 border-b border-[hsl(var(--e-border))]">
        {TABS.map((t, i) => (
          <button
            key={t}
            className={
              i === 0
                ? "relative -mb-px pb-2.5 text-[0.875rem] font-semibold text-[hsl(var(--e-foreground))]"
                : "pb-2.5 text-[0.875rem] text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]"
            }
          >
            {t}
            {i === 0 ? <span className="absolute inset-x-0 bottom-0 h-0.5 rounded bg-[hsl(var(--e-accent-portal))]" /> : null}
          </button>
        ))}
      </div>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <EStatCard label="Paid · MTD" value={money(fin.paidMtdAud)} delta="this month" deltaTone="neutral" icon={<TrendingUp className="h-4 w-4" />} />
        <EStatCard
          label="Outstanding"
          value={money(fin.outstandingAud)}
          delta={`${fin.outstandingCount} invoice${fin.outstandingCount === 1 ? "" : "s"}`}
          deltaTone="neutral"
          icon={<FileText className="h-4 w-4" />}
        />
        <EStatCard label="Payroll" value="—" delta="see payroll tab" deltaTone="neutral" icon={<Banknote className="h-4 w-4" />} />
        <EStatCard label="Clients billed" value={String(new Set(fin.recent.map((r) => r.client?.name)).size)} delta="recent" deltaTone="neutral" icon={<Users className="h-4 w-4" />} />
      </section>

      <ECard>
        <ECardHeader className="flex-row items-center justify-between">
          <ECardTitle>Recent invoices</ECardTitle>
          <EButton variant="gold" size="sm">Generate invoices</EButton>
        </ECardHeader>
        <ECardBody className="pt-0">
          {fin.recent.length === 0 ? (
            <EEmptyState eyebrow="No invoices yet" title="Nothing to show" description="Generated invoices will appear here." />
          ) : (
            <div className="overflow-x-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
              <table className="w-full text-[0.8125rem]">
                <thead>
                  <tr className="bg-[hsl(var(--e-surface-raised))] text-left">
                    {["Invoice", "Client", "Amount", "Status", ""].map((h) => (
                      <th key={h} className="px-3 py-2 text-[0.625rem] font-semibold uppercase tracking-[0.06em] text-[hsl(var(--e-muted-foreground))]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fin.recent.map((inv) => (
                    <tr key={inv.id} className="border-t border-[hsl(var(--e-border)/0.7)] hover:bg-[hsl(var(--e-primary-soft)/0.4)]">
                      <td className="px-3 py-3 font-medium whitespace-nowrap">{inv.invoiceNumber}</td>
                      <td className="px-3 py-3 text-[hsl(var(--e-text-secondary))]">{inv.client?.name ?? "—"}</td>
                      <td className="px-3 py-3"><span className="e-numeral text-[0.9375rem]">{money(inv.totalAmount)}</span></td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1.5">
                          <EBadge tone={statusTone(inv.status)} soft>{inv.status.charAt(0) + inv.status.slice(1).toLowerCase()}</EBadge>
                          {inv.xeroExportedAt ? <EBadge tone="gold" soft>Xero</EBadge> : null}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right"><Link href="/v2/admin/finance"><EButton variant="ghost" size="sm">View</EButton></Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ECardBody>
      </ECard>

      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Estate preview · live data from your workspace.</p>
    </div>
  );
}
