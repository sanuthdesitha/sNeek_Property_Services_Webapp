import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { ensureClientModuleAccess } from "@/lib/portal-access";
import { db } from "@/lib/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getClientFinanceOverview } from "@/lib/billing/client-portal-finance";
import { PayNowButton } from "@/components/client/pay-now-button";

const TZ = "Australia/Sydney";

function money(value: number | null | undefined) {
  return `$${Number(value ?? 0).toFixed(2)}`;
}

export default async function ClientFinancePage() {
  await ensureClientModuleAccess("finance");
  const session = await requireRole([Role.CLIENT]);
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { clientId: true, client: { select: { name: true } } },
  });

  const finance = user?.clientId ? await getClientFinanceOverview(user.clientId) : null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Finance</h1>
        <p className="text-sm text-muted-foreground">
          Service pricing, recent billable work, and invoice history for {user?.client?.name ?? "your account"}.
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Active property rates</p>
            <p className="text-2xl font-semibold">{finance?.summary.activeRates ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Pending billable services</p>
            <p className="text-2xl font-semibold">{finance?.summary.pendingChargeCount ?? 0}</p>
            <p className="mt-1 text-xs text-muted-foreground">{money(finance?.summary.pendingChargeTotal)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Invoices issued</p>
            <p className="text-2xl font-semibold">{finance?.summary.invoiceCount ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total billed</p>
            <p className="text-2xl font-semibold">{money(finance?.summary.totalBilled)}</p>
          </CardContent>
        </Card>
      </section>

      <div className="grid gap-5 xl:grid-cols-[1fr_0.95fr]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Property Service Rates</CardTitle>
            <CardDescription>
              The current admin-approved charges used for invoicing completed work at each property.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {finance?.rates.length ? (
              finance.rates.map((rate) => (
                <div key={rate.id} className="rounded-2xl border border-border/70 bg-white/70 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">{rate.property.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {rate.property.suburb} | {String(rate.jobType).replace(/_/g, " ")}
                      </p>
                      {rate.defaultDescription ? (
                        <p className="mt-1 text-xs text-muted-foreground">{rate.defaultDescription}</p>
                      ) : null}
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">{money(rate.baseCharge)}</p>
                      <p className="text-xs text-muted-foreground">{rate.billingUnit.replace(/_/g, " ")}</p>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
                No property rates are available to show right now.
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Recent Billable Services</CardTitle>
              <CardDescription>
                Completed services and whether they have already been invoiced.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {finance?.recentCharges.length ? (
                finance.recentCharges.slice(0, 12).map((row) => (
                  <div key={row.jobId} className="rounded-2xl border border-border/70 bg-white/70 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">{row.propertyName}</p>
                        <p className="text-xs text-muted-foreground">
                          {row.suburb} | {String(row.jobType).replace(/_/g, " ")} |{" "}
                          {format(toZonedTime(row.scheduledDate, TZ), "dd MMM yyyy")}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Reference: {row.jobNumber || row.jobId}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold">{money(row.amount)}</p>
                        <Badge variant={row.invoiced ? "success" : "warning"}>
                          {row.invoiced ? "Invoiced" : "Pending invoice"}
                        </Badge>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
                  No billable service records available yet.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Invoice History</CardTitle>
              <CardDescription>Recent invoice batches issued for your account.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {finance?.invoices.length ? (
                finance.invoices.map((invoice) => (
                  <div key={invoice.id} className="rounded-2xl border border-border/70 bg-white/70 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">{invoice.invoiceNumber}</p>
                        <p className="text-xs text-muted-foreground">
                          Created {format(toZonedTime(invoice.createdAt, TZ), "dd MMM yyyy")}
                          {invoice.periodStart || invoice.periodEnd
                            ? ` | Period ${
                                invoice.periodStart ? format(toZonedTime(invoice.periodStart, TZ), "dd MMM") : "..."
                              } - ${
                                invoice.periodEnd ? format(toZonedTime(invoice.periodEnd, TZ), "dd MMM yyyy") : "..."
                              }`
                            : ""}
                        </p>
                        {invoice.sentAt ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Sent {format(toZonedTime(invoice.sentAt, TZ), "dd MMM yyyy")}
                          </p>
                        ) : null}
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold">{money(invoice.totalAmount)}</p>
                        <Badge variant={invoice.status === "PAID" ? "success" : invoice.status === "SENT" ? "default" : "secondary"}>
                          {invoice.status.replace(/_/g, " ")}
                        </Badge>
                        {invoice.status === "SENT" || invoice.status === "APPROVED" ? (
                          <div className="mt-2">
                            <PayNowButton invoiceId={invoice.id} />
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
                  No invoices have been issued yet.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
