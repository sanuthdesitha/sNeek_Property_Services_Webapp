"use client";

import * as React from "react";
import { FileText, Send } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";

type Submission = {
  id: string;
  cleanerName: string;
  periodStart: string;
  periodEnd: string;
  hours: number;
  totalAmount: number;
  jobCount: number;
  status: string;
  xeroBillId: string | null;
  createdAt: string;
  lineData: any;
};

const money = (n: number) => Number(n ?? 0).toLocaleString("en-AU", { style: "currency", currency: "AUD" });
const fmt = (s: string) => new Date(s).toLocaleDateString("en-AU");

export function CleanerInvoicesReview() {
  const [rows, setRows] = React.useState<Submission[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/admin/cleaner-invoices", { cache: "no-store" });
      if (res.ok) setRows(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  async function pushToXero(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/cleaner-invoices/${id}/xero-push`, { method: "POST" });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Xero push failed", description: b.error ?? "Please retry.", variant: "destructive" });
        return;
      }
      toast({ title: "Pushed to Xero as a draft bill" });
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return <div className="rounded-xl border px-4 py-10 text-sm text-muted-foreground">Loading cleaner invoices…</div>;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<FileText />}
        title="Cleaner invoices"
        description="Invoices cleaners have submitted — review the detail and push to Xero as a draft bill (ACCPAY). Xero contacts are matched by name, or created with the cleaner's details."
      />
      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No cleaner invoices submitted yet. They appear here when a cleaner emails their invoice from their portal.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const lines = Array.isArray(r.lineData?.lines) ? r.lineData.lines : [];
            const open = expanded === r.id;
            return (
              <Card key={r.id}>
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{r.cleanerName}</p>
                      <p className="text-xs text-muted-foreground">
                        {fmt(r.periodStart)} – {fmt(r.periodEnd)} · {r.jobCount} job{r.jobCount === 1 ? "" : "s"} · {r.hours.toFixed(1)}h · submitted {fmt(r.createdAt)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-lg font-bold tabular-nums">{money(r.totalAmount)}</span>
                      {r.status === "XERO_PUSHED" ? (
                        <Badge variant="success">In Xero</Badge>
                      ) : (
                        <Button size="sm" disabled={busy === r.id} onClick={() => pushToXero(r.id)}>
                          <Send className="mr-1 h-3.5 w-3.5" /> {busy === r.id ? "Pushing…" : "Push to Xero (bill)"}
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => setExpanded(open ? null : r.id)}>
                        {open ? "Hide" : "View"}
                      </Button>
                    </div>
                  </div>
                  {open ? (
                    <div className="mt-3 overflow-hidden rounded-lg border">
                      <table className="w-full text-sm">
                        <tbody className="divide-y">
                          {lines.length === 0 ? (
                            <tr><td className="px-3 py-2 text-muted-foreground">No line detail captured.</td></tr>
                          ) : (
                            lines.map((l: any, i: number) => (
                              <tr key={i}>
                                <td className="px-3 py-1.5">{l.description}</td>
                                <td className="px-3 py-1.5 text-right tabular-nums">
                                  {money(Number(l.unitAmount ?? 0) * Number(l.quantity ?? 1))}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
