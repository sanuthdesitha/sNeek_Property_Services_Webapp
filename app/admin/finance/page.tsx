"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import Link from "next/link";

type Summary = {
  start: string;
  end: string;
  totals: {
    revenue: number;
    cleanerCost: number;
    laundryCost: number;
    suppliesCost: number;
    totalCost: number;
    grossMargin: number;
    marginPct: number | null;
  };
  byClient: Array<{
    clientId: string;
    clientName: string;
    revenue: number;
    cleanerCost: number;
    laundryCost: number;
    suppliesCost: number;
    totalCost: number;
    grossMargin: number;
    marginPct: number | null;
  }>;
  counts: {
    quotesCount: number;
    jobsCount: number;
    laundryJobsCount: number;
    stockTransactionsCount: number;
  };
};

function money(value: number) {
  return `$${value.toFixed(2)}`;
}

export default function FinancePage() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [startDate, setStartDate] = useState(
    new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)
  );
  const [endDate, setEndDate] = useState(today);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<Summary | null>(null);

  async function load() {
    setLoading(true);
    const query = new URLSearchParams({
      startDate,
      endDate,
    });
    const res = await fetch(`/api/admin/finance/summary?${query.toString()}`);
    const body = await res.json().catch(() => null);
    setSummary(res.ok ? (body as Summary) : null);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Cost and Margin Dashboard</h2>
        <p className="text-sm text-muted-foreground">
          Revenue, operational costs, and gross margin by client.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Link href="/admin/finance/dashboard" className="block">
          <Card className="h-full cursor-pointer hover:border-primary/50 hover:shadow-sm transition-all">
            <CardContent className="p-4">
              <p className="text-sm font-medium">Finance Analytics</p>
              <p className="text-xs text-muted-foreground">Revenue, costs &amp; margin by client</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin/payroll" className="block">
          <Card className="h-full cursor-pointer hover:border-primary/50 hover:shadow-sm transition-all">
            <CardContent className="p-4">
              <p className="text-sm font-medium">Payroll</p>
              <p className="text-xs text-muted-foreground">Run payroll &amp; process payouts</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin/settings?tab=payment-gateways" className="block">
          <Card className="h-full cursor-pointer hover:border-primary/50 hover:shadow-sm transition-all">
            <CardContent className="p-4">
              <p className="text-sm font-medium">Payment Gateways</p>
              <p className="text-xs text-muted-foreground">Stripe, Square, PayPal config</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin/settings?tab=xero" className="block">
          <Card className="h-full cursor-pointer hover:border-primary/50 hover:shadow-sm transition-all">
            <CardContent className="p-4">
              <p className="text-sm font-medium">Xero Integration</p>
              <p className="text-xs text-muted-foreground">Connect &amp; push invoices to Xero</p>
            </CardContent>
          </Card>
        </Link>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div>
            <label className="text-xs text-muted-foreground">Start date</label>
            <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">End date</label>
            <Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </div>
          <Button onClick={load} disabled={loading}>
            {loading ? "Loading..." : "Apply"}
          </Button>
        </CardContent>
      </Card>

      {!summary ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            {loading ? "Loading finance summary..." : "No data available for this period."}
          </CardContent>
        </Card>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Revenue</p>
                <p className="text-2xl font-semibold">{money(summary.totals.revenue)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Cleaner Cost</p>
                <p className="text-2xl font-semibold">{money(summary.totals.cleanerCost)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Laundry Cost</p>
                <p className="text-2xl font-semibold">{money(summary.totals.laundryCost)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Supplies Cost</p>
                <p className="text-2xl font-semibold">{money(summary.totals.suppliesCost)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Gross Margin</p>
                <p className="text-2xl font-semibold">{money(summary.totals.grossMargin)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Margin %</p>
                <p className="text-2xl font-semibold">
                  {summary.totals.marginPct == null ? "-" : `${summary.totals.marginPct.toFixed(1)}%`}
                </p>
              </CardContent>
            </Card>
          </section>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                By Client ({format(new Date(summary.start), "dd MMM yyyy")} to{" "}
                {format(new Date(summary.end), "dd MMM yyyy")})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/30">
                    <tr>
                      <th className="px-3 py-2 text-left">Client</th>
                      <th className="px-3 py-2 text-right">Revenue</th>
                      <th className="px-3 py-2 text-right">Cleaner</th>
                      <th className="px-3 py-2 text-right">Laundry</th>
                      <th className="px-3 py-2 text-right">Supplies</th>
                      <th className="px-3 py-2 text-right">Total Cost</th>
                      <th className="px-3 py-2 text-right">Margin</th>
                      <th className="px-3 py-2 text-right">Margin %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.byClient.map((row) => (
                      <tr key={row.clientId} className="border-b last:border-0">
                        <td className="px-3 py-2">{row.clientName}</td>
                        <td className="px-3 py-2 text-right">{money(row.revenue)}</td>
                        <td className="px-3 py-2 text-right">{money(row.cleanerCost)}</td>
                        <td className="px-3 py-2 text-right">{money(row.laundryCost)}</td>
                        <td className="px-3 py-2 text-right">{money(row.suppliesCost)}</td>
                        <td className="px-3 py-2 text-right">{money(row.totalCost)}</td>
                        <td className="px-3 py-2 text-right">{money(row.grossMargin)}</td>
                        <td className="px-3 py-2 text-right">
                          {row.marginPct == null ? "-" : `${row.marginPct.toFixed(1)}%`}
                        </td>
                      </tr>
                    ))}
                    {summary.byClient.length === 0 ? (
                      <tr>
                        <td className="px-3 py-4 text-center text-muted-foreground" colSpan={8}>
                          No client-level finance data in this range.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
