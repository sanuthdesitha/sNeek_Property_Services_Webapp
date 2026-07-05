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
  EThread,
} from "@/components/v2/ui/primitives";
import { PayInvoiceButton } from "@/components/v2/client/pay-invoice-button";
import { CreditCard, Receipt, Wallet, FileText } from "lucide-react";

export const metadata = { title: "Finance · Estate client" };
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

function chargeTone(row: { rateMissing: boolean; invoiced: boolean }): Tone {
  if (row.rateMissing) return "neutral";
  return row.invoiced ? "success" : "warning";
}

export default async function V2ClientFinancePage() {
  const session = await requireRole([Role.CLIENT]);
  const portal = await getClientPortalContext(session.user.id).catch(() => null);

  if (!portal?.visibility.showFinanceDetails) {
    return (
      <div className="space-y-6">
        <EPageHeader
          eyebrow="Account"
          title="Finance"
          description="Service pricing, recent billable work, and invoice history."
        />
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
  const rates = finance?.rates ?? [];
  const recentCharges = finance?.recentCharges ?? [];
  const invoices = finance?.invoices ?? [];

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Account"
        title="Finance"
        description={`Service pricing, recent billable work, and invoice history for ${portal.client?.name ?? "your account"}.`}
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <EStatCard
          label="Active property rates"
          value={String(summary?.activeRates ?? 0)}
          delta="across your homes"
          deltaTone="neutral"
          icon={<Receipt className="h-4 w-4" />}
        />
        <EStatCard
          label="Pending billable services"
          value={String(summary?.pendingChargeCount ?? 0)}
          delta={money(summary?.pendingChargeTotal)}
          deltaTone="neutral"
          icon={<Wallet className="h-4 w-4" />}
        />
        <EStatCard
          label="Invoices issued"
          value={String(summary?.invoiceCount ?? 0)}
          delta="on record"
          deltaTone="neutral"
          icon={<FileText className="h-4 w-4" />}
        />
        <EStatCard
          label="Total billed"
          value={money(summary?.totalBilled)}
          delta="all time"
          deltaTone="neutral"
          icon={<CreditCard className="h-4 w-4" />}
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-[1fr_0.95fr]">
        {/* Property Service Rates */}
        <ECard>
          <ECardHeader>
            <ECardTitle>Property service rates</ECardTitle>
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              The current admin-approved charges used to invoice completed work at each property.
            </p>
          </ECardHeader>
          <ECardBody className="space-y-3 pt-0">
            {rates.length === 0 ? (
              <EEmptyState
                eyebrow="Nothing yet"
                title="No property rates"
                description="Rates for your properties will appear here once set by your account manager."
              />
            ) : (
              rates.map((rate) => (
                <div
                  key={rate.id}
                  className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[0.875rem] font-semibold">{rate.property.name}</p>
                      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        {rate.property.suburb} · {String(rate.jobType).replace(/_/g, " ")}
                      </p>
                      {rate.defaultDescription ? (
                        <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
                          {rate.defaultDescription}
                        </p>
                      ) : null}
                    </div>
                    <div className="text-right">
                      <p className="e-numeral text-[0.9375rem]">{money(rate.baseCharge)}</p>
                      <p className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
                        {rate.billingUnit.replace(/_/g, " ")}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </ECardBody>
        </ECard>

        <div className="space-y-6">
          {/* Recent Billable Services */}
          <ECard>
            <ECardHeader>
              <ECardTitle>Recent billable services</ECardTitle>
              <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                Completed services and whether they have already been invoiced.
              </p>
            </ECardHeader>
            <ECardBody className="space-y-3 pt-0">
              {recentCharges.length === 0 ? (
                <EEmptyState
                  eyebrow="Nothing yet"
                  title="No billable services"
                  description="Completed work will appear here as it is recorded."
                />
              ) : (
                recentCharges.slice(0, 12).map((row) => (
                  <div
                    key={row.jobId}
                    className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[0.875rem] font-semibold">{row.propertyName}</p>
                        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                          {row.suburb} · {String(row.jobType).replace(/_/g, " ")} ·{" "}
                          {format(toZonedTime(row.scheduledDate, TZ), "d MMM yyyy")}
                        </p>
                        <p className="mt-1 text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                          Reference: {row.jobNumber || row.jobId}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1.5 text-right">
                        <p className="e-numeral text-[0.9375rem]">
                          {row.rateMissing ? "Rate not set" : money(row.amount)}
                        </p>
                        <EBadge tone={chargeTone(row)} soft>
                          {row.rateMissing ? "No rate" : row.invoiced ? "Invoiced" : "Pending invoice"}
                        </EBadge>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </ECardBody>
          </ECard>

          {/* Invoice History */}
          <ECard>
            <ECardHeader>
              <ECardTitle>Invoice history</ECardTitle>
              <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                Recent invoice batches issued for your account.
              </p>
            </ECardHeader>
            <ECardBody className="space-y-1 pt-0">
              {invoices.length === 0 ? (
                <EEmptyState
                  eyebrow="Nothing yet"
                  title="No invoices issued"
                  description="Invoices for completed work will appear here."
                />
              ) : (
                invoices.map((invoice, i) => {
                  const payable = invoice.status === "SENT" || invoice.status === "APPROVED";
                  return (
                    <div key={invoice.id}>
                      {i > 0 ? <EThread className="my-1" /> : null}
                      <div className="flex flex-wrap items-start justify-between gap-3 py-2">
                        <div className="min-w-0">
                          <p className="text-[0.875rem] font-semibold">{invoice.invoiceNumber}</p>
                          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                            Created {format(toZonedTime(invoice.createdAt, TZ), "d MMM yyyy")}
                            {invoice.periodStart || invoice.periodEnd
                              ? ` · Period ${
                                  invoice.periodStart
                                    ? format(toZonedTime(invoice.periodStart, TZ), "d MMM")
                                    : "…"
                                } – ${
                                  invoice.periodEnd
                                    ? format(toZonedTime(invoice.periodEnd, TZ), "d MMM yyyy")
                                    : "…"
                                }`
                              : ""}
                          </p>
                          {invoice.sentAt ? (
                            <p className="mt-1 text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                              Sent {format(toZonedTime(invoice.sentAt, TZ), "d MMM yyyy")}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex flex-col items-end gap-1.5 text-right">
                          <p className="e-numeral text-[0.9375rem]">{money(invoice.totalAmount)}</p>
                          <EBadge tone={invoiceTone(invoice.status)} soft>
                            {invoice.status.replace(/_/g, " ")}
                          </EBadge>
                          {payable ? <PayInvoiceButton invoiceId={invoice.id} /> : null}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </ECardBody>
          </ECard>
        </div>
      </div>
    </div>
  );
}
