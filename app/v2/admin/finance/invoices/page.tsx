import Link from "next/link";
import { format } from "date-fns";
import { ClientInvoiceStatus, Role } from "@prisma/client";
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
  EEmptyState,
} from "@/components/v2/ui/primitives";
import { ArrowLeft } from "lucide-react";

export const metadata = { title: "Invoices · Estate admin" };
export const dynamic = "force-dynamic";

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

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

async function getInvoices() {
  return db.clientInvoice
    .findMany({
      orderBy: { createdAt: "desc" },
      take: 40,
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        totalAmount: true,
        createdAt: true,
        xeroExportedAt: true,
        client: { select: { id: true, name: true } },
      },
    })
    .catch(() => []);
}

export default async function AdminInvoicesPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const invoices = await getInvoices();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/v2/admin/finance" aria-label="Back to finance">
          <EButton variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></EButton>
        </Link>
        <span className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Finance</span>
      </div>

      <EPageHeader eyebrow="Commercial" title="Client invoices" description="Every client invoice, most recent first." />

      <ECard>
        <ECardHeader className="pb-2"><ECardTitle className="text-[0.95rem]">Recent invoices</ECardTitle></ECardHeader>
        <ECardBody className="pt-0">
          {invoices.length === 0 ? (
            <EEmptyState eyebrow="No invoices yet" title="Nothing to show" description="Generated invoices will appear here." />
          ) : (
            <div className="overflow-x-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
              <table className="w-full text-[0.8125rem]">
                <thead>
                  <tr className="bg-[hsl(var(--e-surface-raised))] text-left">
                    {["Invoice", "Client", "Raised", "Amount", "Status"].map((h) => (
                      <th key={h} className="px-3 py-2 text-[0.625rem] font-semibold uppercase tracking-[0.06em] text-[hsl(var(--e-muted-foreground))]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="border-t border-[hsl(var(--e-border)/0.7)] hover:bg-[hsl(var(--e-primary-soft)/0.4)]">
                      <td className="px-3 py-3 font-medium whitespace-nowrap">{inv.invoiceNumber}</td>
                      <td className="px-3 py-3 text-[hsl(var(--e-text-secondary))]">
                        {inv.client ? (
                          <Link href={`/v2/admin/clients/${inv.client.id}`} className="hover:text-[hsl(var(--e-accent-portal))] hover:underline">
                            {inv.client.name}
                          </Link>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-3 tabular-nums whitespace-nowrap text-[hsl(var(--e-text-secondary))]">{format(new Date(inv.createdAt), "d MMM yy")}</td>
                      <td className="px-3 py-3"><span className="e-numeral text-[0.9375rem]">{money(inv.totalAmount)}</span></td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1.5">
                          <EBadge tone={statusTone(inv.status)} soft>{titleCase(inv.status)}</EBadge>
                          {inv.xeroExportedAt ? <EBadge tone="gold" soft>Xero</EBadge> : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ECardBody>
      </ECard>

      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Estate preview · read-only · live data from your workspace.</p>
    </div>
  );
}
