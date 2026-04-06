import Link from "next/link";
import { addDays, format, startOfMonth } from "date-fns";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getPayrollSummary } from "@/lib/finance/payroll";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

function money(value: number) {
  return `$${Number(value ?? 0).toFixed(2)}`;
}

export default async function AdminPayrollPage({
  searchParams,
}: {
  searchParams: { startDate?: string; endDate?: string };
}) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const today = new Date();
  const startDate = typeof searchParams?.startDate === "string" && searchParams.startDate ? searchParams.startDate : format(startOfMonth(today), "yyyy-MM-dd");
  const endDate = typeof searchParams?.endDate === "string" && searchParams.endDate ? searchParams.endDate : format(today, "yyyy-MM-dd");
  const rows = await getPayrollSummary({ startDate, endDate });
  const totals = rows.reduce(
    (acc, row) => {
      acc.hours += row.totals.paidHours;
      acc.gross += row.totals.grossPay;
      return acc;
    },
    { hours: 0, gross: 0 }
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Payroll</h1>
          <p className="text-sm text-muted-foreground">
            Cleaner paid hours, approved adjustments, and payslip exports for a selected period.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link href="/admin/finance">Finance overview</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/admin/finance/dashboard">Analytics</Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-4">
          <form className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Start date</label>
              <Input type="date" name="startDate" defaultValue={startDate} />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">End date</label>
              <Input type="date" name="endDate" defaultValue={endDate} />
            </div>
            <Button type="submit">Apply</Button>
          </form>
        </CardContent>
      </Card>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Cleaners in range" value={String(rows.length)} />
        <MetricCard label="Paid hours" value={totals.hours.toFixed(2)} />
        <MetricCard label="Gross payroll" value={money(totals.gross)} />
        <MetricCard label="Period" value={`${startDate} - ${endDate}`} />
      </section>

      <div className="space-y-4">
        {rows.map((row) => {
          const cleanerName = row.cleaner.name?.trim() || row.cleaner.email;
          const payslipHref = `/api/admin/finance/payroll/payslip?cleanerId=${encodeURIComponent(row.cleaner.id)}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;
          return (
            <Card key={row.cleaner.id}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-lg">{cleanerName}</CardTitle>
                    <CardDescription>{row.cleaner.email}</CardDescription>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">Gross pay</p>
                    <p className="text-2xl font-semibold">{money(row.totals.grossPay)}</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border p-3">
                    <p className="text-xs text-muted-foreground">Paid hours</p>
                    <p className="text-lg font-semibold">{row.totals.paidHours.toFixed(2)}</p>
                  </div>
                  <div className="rounded-2xl border p-3">
                    <p className="text-xs text-muted-foreground">Job gross</p>
                    <p className="text-lg font-semibold">{money(row.totals.jobGross)}</p>
                  </div>
                  <div className="rounded-2xl border p-3">
                    <p className="text-xs text-muted-foreground">Adjustments</p>
                    <p className="text-lg font-semibold">{money(row.totals.adjustments)}</p>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-2xl border">
                  <table className="w-full min-w-[780px] text-sm">
                    <thead className="bg-muted/40 text-left">
                      <tr>
                        <th className="px-3 py-2">Job</th>
                        <th className="px-3 py-2">Property</th>
                        <th className="px-3 py-2">Type</th>
                        <th className="px-3 py-2">Date</th>
                        <th className="px-3 py-2 text-right">Hours</th>
                        <th className="px-3 py-2 text-right">Rate</th>
                        <th className="px-3 py-2 text-right">Gross</th>
                      </tr>
                    </thead>
                    <tbody>
                      {row.jobs.length === 0 ? (
                        <tr>
                          <td className="px-3 py-4 text-center text-muted-foreground" colSpan={7}>
                            No completed jobs in this range.
                          </td>
                        </tr>
                      ) : (
                        row.jobs.map((job) => (
                          <tr key={job.id} className="border-t">
                            <td className="px-3 py-2">{job.jobNumber || job.id.slice(-6)}</td>
                            <td className="px-3 py-2">{job.propertyName}</td>
                            <td className="px-3 py-2">{job.jobType.replace(/_/g, " ")}</td>
                            <td className="px-3 py-2">{format(new Date(job.scheduledDate), "dd MMM yyyy")}</td>
                            <td className="px-3 py-2 text-right">{job.hours.toFixed(2)}</td>
                            <td className="px-3 py-2 text-right">{money(job.rate)}</td>
                            <td className="px-3 py-2 text-right">{money(job.gross)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {row.adjustments.length > 0 ? (
                  <div className="space-y-2 rounded-2xl border p-3">
                    <p className="text-sm font-medium">Approved adjustments</p>
                    <div className="space-y-2 text-sm">
                      {row.adjustments.map((adjustment) => (
                        <div key={adjustment.id} className="flex items-center justify-between gap-3 rounded-xl bg-muted/30 px-3 py-2">
                          <div>
                            <p className="font-medium">{adjustment.label}</p>
                            <p className="text-xs text-muted-foreground">{format(new Date(adjustment.requestedAt), "dd MMM yyyy")}</p>
                          </div>
                          <p className="font-semibold">{money(adjustment.amount)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="flex justify-end">
                  <Button asChild>
                    <Link href={payslipHref} target="_blank">Download payslip PDF</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}
