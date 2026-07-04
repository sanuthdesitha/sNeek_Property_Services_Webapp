import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getClientPortalContext } from "@/lib/client/portal";
import { getClientFinanceOverview } from "@/lib/billing/client-portal-finance";
import {
  EBadge,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEmptyState,
  EPageHeader,
  EStatCard,
} from "@/components/v2/ui/primitives";
import { Wallet } from "lucide-react";

export const metadata = { title: "Money · Estate client" };
export const dynamic = "force-dynamic";

const TZ = "Australia/Sydney";

type Tone = "neutral" | "primary" | "gold" | "success" | "warning" | "danger" | "info" | "aubergine";

function money(value: number | null | undefined) {
  return `$${Number(value ?? 0).toFixed(2)}`;
}

function invoiceTone(status: string): Tone {
  switch (status) {
    case "PAID":
      return "success";
    case "SENT":
    case "APPROVED":
      return "warning";
    case "VOID":
      return "danger";
    default:
      return "neutral";
  }
}

export default async function ClientMoneyPage() {
  const session = await requireRole([Role.CLIENT]);
  const portal = await getClientPortalContext(session.user.id).catch(() => null);

  if (!portal?.visibility.showFinanceDetails) {
    return (
      <div className="space-y-6">
        <EPageHeader eyebrow="Account" title="Money" description="Your balance, charges, and invoices — in one place." />
        <EEmptyState
          eyebrow="Not available"
          title="Financial details are hidden"
          description="Your account manager has not enabled finance visibility for this portal."
        />
      </div>
    );
  }

  const finance = portal.clientId
    ? await getClientFinanceOverview(portal.clientId).catch(() => null)
    : null;

  const summary = finance?.summary;
  const invoices = finance?.invoices ?? [];

  return (
    <div className="space-y-6">
      <EPageHeader eyebrow="Account" title="Money" description="Your balance, charges, and invoices — in one place." />

      <section className="grid gap-4 sm:grid-cols-3">
        <EStatCard
          label="Pending charges"
          value={money(summary?.pendingChargeTotal)}
          delta={`${summary?.pendingChargeCount ?? 0} awaiting invoice`}
          deltaTone="neutral"
          icon={<Wallet className="h-4 w-4" />}
        />
        <EStatCard
          label="Total billed"
          value={money(summary?.totalBilled)}
          delta={`${summary?.invoiceCount ?? 0} invoice${summary?.invoiceCount === 1 ? "" : "s"}`}
          deltaTone="neutral"
        />
        <EStatCard
          label="Active rates"
          value={String(summary?.activeRates ?? 0)}
          delta="across your homes"
          deltaTone="neutral"
        />
      </section>

      <ECard>
        <ECardHeader>
          <ECardTitle>Invoices</ECardTitle>
        </ECardHeader>
        <ECardBody className="pt-0">
          {invoices.length === 0 ? (
            <EEmptyState
              eyebrow="Nothing yet"
              title="No invoices issued"
              description="Invoices for completed work will appear here."
            />
          ) : (
            <div className="overflow-x-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
              <table className="w-full text-[0.8125rem]">
                <thead>
                  <tr className="bg-[hsl(var(--e-surface-raised))] text-left">
                    {["Invoice", "Period", "Amount", "Status"].map((h) => (
                      <th
                        key={h}
                        className="px-3 py-2 text-[0.625rem] font-semibold uppercase tracking-[0.06em] text-[hsl(var(--e-muted-foreground))]"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => {
                    const period =
                      inv.periodStart || inv.periodEnd
                        ? `${inv.periodStart ? format(toZonedTime(inv.periodStart, TZ), "d MMM") : "…"} – ${inv.periodEnd ? format(toZonedTime(inv.periodEnd, TZ), "d MMM yyyy") : "…"}`
                        : format(toZonedTime(inv.createdAt, TZ), "MMM yyyy");
                    return (
                      <tr
                        key={inv.id}
                        className="border-t border-[hsl(var(--e-border)/0.7)] hover:bg-[hsl(var(--e-primary-soft)/0.4)]"
                      >
                        <td className="px-3 py-3 font-medium">{inv.invoiceNumber}</td>
                        <td className="px-3 py-3 text-[hsl(var(--e-text-secondary))]">{period}</td>
                        <td className="px-3 py-3">
                          <span className="e-numeral text-[0.9375rem]">{money(inv.totalAmount)}</span>
                        </td>
                        <td className="px-3 py-3">
                          <EBadge tone={invoiceTone(inv.status)} soft>
                            {inv.status.replace(/_/g, " ")}
                          </EBadge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </ECardBody>
      </ECard>
    </div>
  );
}
