"use client";

import * as React from "react";
import Link from "next/link";
import { FileText, Send, TrendingUp, AlertTriangle, ExternalLink, ChevronDown } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

type ExpectedRow = {
  jobId: string;
  date: string;
  jobName: string;
  property: string;
  jobType: string;
  hours: number;
  originalHours: number;
  isHoursOverridden: boolean;
  hoursChangeNote?: string;
  baseAmount: number;
  approvedExtraAmount: number;
  transportAllowance: number;
  amount: number;
  rateMissing: boolean;
  comment?: string;
};

type ExpectedCleaner = {
  cleanerId: string;
  cleanerName: string;
  cleanerEmail: string;
  employmentType: string | null;
  expectedTotal: number;
  expectedHours: number;
  jobCount: number;
  overriddenCount: number;
  approvedExtraTotal: number;
  pendingCount: number;
  pendingAmount: number;
  rateMissingCount: number;
  expenseTotal: number;
  shoppingTimeTotal: number;
  rows: ExpectedRow[];
  submission: {
    id: string;
    status: string;
    submittedTotal: number;
    submittedJobCount: number;
    submittedAt: string;
    variance: number;
    missingJobs: Array<{ jobId: string; jobName: string; date: string; amount: number }>;
  } | null;
};

type ExpectedResult = {
  start: string;
  end: string;
  grandExpectedTotal: number;
  grandPendingAmount: number;
  cleaners: ExpectedCleaner[];
};

const money = (n: number) => Number(n ?? 0).toLocaleString("en-AU", { style: "currency", currency: "AUD" });
const fmt = (s: string) => new Date(s).toLocaleDateString("en-AU");

function monthStart(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function CleanerInvoicesReview() {
  const [tab, setTab] = React.useState<"submitted" | "expected">("submitted");

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<FileText />}
        title="Cleaner invoices"
        description="Review submitted invoices and push to Xero as a draft bill (ACCPAY), or predict what cleaners will invoice for an upcoming pay period so you know the money to prepare."
      />
      <div className="flex gap-1 rounded-lg border bg-muted/30 p-1">
        <button
          onClick={() => setTab("submitted")}
          className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            tab === "submitted" ? "bg-surface shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <FileText className="mr-1 inline h-3.5 w-3.5" /> Submitted
        </button>
        <button
          onClick={() => setTab("expected")}
          className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            tab === "expected" ? "bg-surface shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <TrendingUp className="mr-1 inline h-3.5 w-3.5" /> Expected &amp; transparency
        </button>
      </div>
      {tab === "submitted" ? <SubmittedTab /> : <ExpectedTab />}
    </div>
  );
}

function SubmittedTab() {
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

  async function setStatus(id: string, status: string, label: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/cleaner-invoices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Update failed", description: b.error ?? "Please retry.", variant: "destructive" });
        return;
      }
      toast({ title: label });
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return <div className="rounded-xl border px-4 py-10 text-sm text-muted-foreground">Loading cleaner invoices…</div>;
  }

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          No cleaner invoices submitted yet. They appear here when a cleaner emails their invoice from their portal.
        </CardContent>
      </Card>
    );
  }

  return (
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
                  {r.status === "PAID" ? (
                    <Badge variant="success">Paid</Badge>
                  ) : r.status === "XERO_PUSHED" ? (
                    <Badge variant="secondary">In Xero</Badge>
                  ) : (
                    <Button size="sm" disabled={busy === r.id} onClick={() => pushToXero(r.id)}>
                      <Send className="mr-1 h-3.5 w-3.5" /> {busy === r.id ? "Pushing…" : "Push to Xero (bill)"}
                    </Button>
                  )}
                  {r.status !== "PAID" ? (
                    <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => setStatus(r.id, "PAID", "Marked as paid")}>
                      Mark paid
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" disabled={busy === r.id} onClick={() => setStatus(r.id, "SUBMITTED", "Marked unpaid")}>
                      Unmark paid
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
  );
}

function ExpectedTab() {
  const [start, setStart] = React.useState(monthStart());
  const [end, setEnd] = React.useState(today());
  const [data, setData] = React.useState<ExpectedResult | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [expanded, setExpanded] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ start, end });
      const res = await fetch(`/api/admin/cleaner-invoices/expected?${params.toString()}`, { cache: "no-store" });
      if (res.ok) setData(await res.json());
      else toast({ title: "Could not compute expected invoices", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [start, end]);
  React.useEffect(() => { void load(); }, []); // initial load

  return (
    <div className="space-y-4">
      {/* Period + money-to-prepare */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">From</Label>
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">To</Label>
            <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="h-9" />
          </div>
          <Button onClick={() => void load()} disabled={loading} className="h-9">
            {loading ? "Predicting…" : "Predict"}
          </Button>
          {data ? (
            <div className="ml-auto flex flex-wrap items-center gap-4">
              <div className="text-right">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Money to prepare</p>
                <p className="text-2xl font-bold tabular-nums text-primary">{money(data.grandExpectedTotal)}</p>
              </div>
              {data.grandPendingAmount > 0 ? (
                <div className="text-right">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Pending extra (unapproved)</p>
                  <p className="text-lg font-semibold tabular-nums text-warning">{money(data.grandPendingAmount)}</p>
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {loading && !data ? (
        <div className="rounded-xl border px-4 py-10 text-sm text-muted-foreground">Computing predictions…</div>
      ) : !data || data.cleaners.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No expected invoices for this period — no unpaid jobs or pending extras.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {data.cleaners.map((c) => {
            const open = expanded === c.cleanerId;
            const flags: string[] = [];
            if (c.overriddenCount > 0) flags.push(`${c.overriddenCount} hour override${c.overriddenCount === 1 ? "" : "s"}`);
            if (c.pendingCount > 0) flags.push(`${c.pendingCount} pending extra`);
            if (c.rateMissingCount > 0) flags.push(`${c.rateMissingCount} rate missing`);
            const varianceBad = c.submission && Math.abs(c.submission.variance) >= 0.01;
            const missing = c.submission?.missingJobs ?? [];
            return (
              <Card key={c.cleanerId}>
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 font-medium">
                        {c.cleanerName}
                        {c.employmentType === "CONTRACTOR" ? (
                          <Badge variant="outline" className="text-[10px]">Contractor · invoices</Badge>
                        ) : null}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {c.jobCount} job{c.jobCount === 1 ? "" : "s"} · {c.expectedHours.toFixed(1)}h
                        {c.approvedExtraTotal > 0 ? ` · +${money(c.approvedExtraTotal)} extra` : ""}
                        {c.expenseTotal > 0 ? ` · ${money(c.expenseTotal)} shopping` : ""}
                      </p>
                      {flags.length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {flags.map((f) => (
                            <Badge key={f} variant="warning" className="text-[10px]">{f}</Badge>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold tabular-nums">{money(c.expectedTotal + c.expenseTotal + c.shoppingTimeTotal)}</p>
                      <p className="text-[11px] text-muted-foreground">expected invoice</p>
                    </div>
                  </div>

                  {/* Submission comparison */}
                  {c.submission ? (
                    <div className={`mt-3 rounded-lg border p-3 text-xs ${varianceBad ? "border-warning/40 bg-warning/10" : "border-border bg-muted/30"}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>
                          Submitted <strong>{money(c.submission.submittedTotal)}</strong> ({c.submission.submittedJobCount} job{c.submission.submittedJobCount === 1 ? "" : "s"}) on {fmt(c.submission.submittedAt)}
                        </span>
                        <span className={varianceBad ? "font-semibold text-warning" : "text-muted-foreground"}>
                          {c.submission.variance === 0
                            ? "Matches expected ✓"
                            : `${c.submission.variance > 0 ? "+" : ""}${money(c.submission.variance)} vs expected`}
                        </span>
                      </div>
                      {missing.length > 0 ? (
                        <div className="mt-2 flex items-start gap-1.5 text-warning">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span>
                            {missing.length} expected job{missing.length === 1 ? "" : "s"} not on their invoice:{" "}
                            {missing.map((m, i) => (
                              <React.Fragment key={m.jobId}>
                                <Link href={`/admin/jobs/${m.jobId}`} className="underline hover:opacity-80">
                                  {m.jobName} ({m.date}, {money(m.amount)})
                                </Link>
                                {i < missing.length - 1 ? ", " : ""}
                              </React.Fragment>
                            ))}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <p className="mt-2 text-[11px] text-muted-foreground">Not yet submitted for this period.</p>
                  )}

                  <button
                    onClick={() => setExpanded(open ? null : c.cleanerId)}
                    className="mt-2 flex items-center gap-1 text-xs font-medium text-primary hover:opacity-80"
                  >
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
                    {open ? "Hide job breakdown" : "Show job breakdown & changes"}
                  </button>

                  {open ? (
                    <div className="mt-2 overflow-x-auto rounded-lg border">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/40 text-muted-foreground">
                          <tr>
                            <th className="px-2 py-1.5 text-left font-medium">Job</th>
                            <th className="px-2 py-1.5 text-left font-medium">Date</th>
                            <th className="px-2 py-1.5 text-right font-medium">Hours</th>
                            <th className="px-2 py-1.5 text-right font-medium">Base</th>
                            <th className="px-2 py-1.5 text-right font-medium">Extra</th>
                            <th className="px-2 py-1.5 text-right font-medium">Line</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {c.rows.map((r) => (
                            <tr key={r.jobId} className={r.rateMissing ? "bg-destructive/5" : undefined}>
                              <td className="px-2 py-1.5">
                                <Link href={`/admin/jobs/${r.jobId}`} className="inline-flex items-center gap-1 font-medium hover:underline">
                                  {r.jobName}
                                  <ExternalLink className="h-3 w-3 opacity-50" />
                                </Link>
                                <span className="block text-[10px] text-muted-foreground">{r.property} · {r.jobType}</span>
                                {r.comment ? <span className="block text-[10px] italic text-muted-foreground">“{r.comment}”</span> : null}
                              </td>
                              <td className="px-2 py-1.5">{r.date}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">
                                {r.isHoursOverridden ? (
                                  <span className="text-warning" title={r.hoursChangeNote}>
                                    {r.originalHours.toFixed(2)}→{r.hours.toFixed(2)}
                                  </span>
                                ) : (
                                  r.hours.toFixed(2)
                                )}
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums">
                                {r.rateMissing ? <span className="text-destructive">rate?</span> : money(r.baseAmount)}
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums">
                                {r.approvedExtraAmount > 0 ? money(r.approvedExtraAmount) : "—"}
                              </td>
                              <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{money(r.amount)}</td>
                            </tr>
                          ))}
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
