"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock,
  DollarSign,
  RefreshCw,
  Shirt,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ── types ─────────────────────────────────────────────────────────────────────

type AllApprovals = {
  continuations: any[];
  timingRequests: any[];
  payAdjustments: any[];
  timeAdjustments: any[];
  clientApprovals: any[];
  flaggedLaundry: any[];
  rescheduleRequests: any[];
  counts: Record<string, number>;
};

const TABS = [
  { key: "continuations",      label: "Job Continuations",   icon: RefreshCw },
  { key: "timingRequests",     label: "Timing Requests",     icon: Clock },
  { key: "payAdjustments",     label: "Pay Requests",        icon: DollarSign },
  { key: "timeAdjustments",    label: "Clock Adjustments",   icon: Clock },
  { key: "clientApprovals",    label: "Client Approvals",    icon: CheckCircle2 },
  { key: "flaggedLaundry",     label: "Flagged Laundry",     icon: Shirt },
  { key: "rescheduleRequests", label: "Reschedule Requests", icon: CalendarClock },
] as const;

type TabKey = typeof TABS[number]["key"];

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt(dateStr: string | null | undefined) {
  if (!dateStr) return "—";
  try { return format(parseISO(dateStr), "dd MMM yyyy HH:mm"); } catch { return dateStr; }
}

function primaryPayAmount(row: any) {
  return Number(
    row.primaryDisplayAmount ??
      row.clientRequestedAmount ??
      row.cleanerRequestedAmount ??
      row.requestedAmount ??
      0
  );
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === "PENDING"   ? "bg-amber-100 text-amber-800 border-amber-200" :
    status === "APPROVED"  ? "bg-green-100 text-green-800 border-green-200" :
    status === "REJECTED" || status === "DECLINED" ? "bg-red-100 text-red-800 border-red-200" :
    "bg-muted text-muted-foreground border-border";
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold", color)}>
      {status}
    </span>
  );
}

// ── main component ────────────────────────────────────────────────────────────

export default function AdminApprovalsPage() {
  const [data, setData] = useState<AllApprovals | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>("continuations");
  const [acting, setActing] = useState<string | null>(null);
  const [payApproveAmounts, setPayApproveAmounts] = useState<Record<string, string>>({});
  const [sendingClientApproval, setSendingClientApproval] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/all-approvals");
    const body = await res.json().catch(() => null);
    setLoading(false);
    if (res.ok && body) setData(body);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Switch to first tab with items once loaded
  useEffect(() => {
    if (!data) return;
    const firstWithItems = TABS.find((t) => (data.counts[t.key] ?? 0) > 0);
    if (firstWithItems) setActiveTab(firstWithItems.key);
  }, [data]);

  async function act(url: string, method: string, body: object, successMsg: string) {
    setActing(url);
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    setActing(null);
    if (!res.ok) { toast({ title: "Failed", description: json.error ?? "Action failed", variant: "destructive" }); return; }
    toast({ title: successMsg });
    await load();
  }

  async function sendPayToClient(row: any) {
    setSendingClientApproval(row.id);
    const propertyName = row.job?.property?.name ?? row.property?.name ?? "Request";
    const res = await fetch(`/api/admin/pay-adjustments/${row.id}/send-to-client`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: Number(row.clientRequestedAmount ?? row.requestedAmount ?? 0),
        title: `Additional charge approval — ${propertyName}`,
        description: row.cleanerNote?.trim()
          ? `Cleaner requested additional payment. Note: ${row.cleanerNote}`
          : "Cleaner requested additional payment.",
        currency: "AUD",
      }),
    });
    const json = await res.json().catch(() => ({}));
    setSendingClientApproval(null);
    if (!res.ok) {
      toast({ title: "Failed to send to client", description: json.error ?? "Action failed", variant: "destructive" });
      return;
    }
    toast({ title: "Sent to client for approval" });
    await load();
  }

  const total = data?.counts.total ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Approvals Centre</h1>
          <p className="text-sm text-muted-foreground">
            All pending requests across jobs, pay, laundry, and client approvals in one place.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {total > 0 && (
            <span className="rounded-full bg-destructive px-3 py-1 text-sm font-bold text-white">
              {total} pending
            </span>
          )}
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn("mr-2 h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex flex-wrap gap-1.5 rounded-2xl border border-border/60 bg-muted/40 p-1.5">
        {TABS.map(({ key, label, icon: Icon }) => {
          const count = data?.counts[key] ?? 0;
          return (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={cn(
                "flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition-all duration-150",
                activeTab === key
                  ? "bg-white shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              {label}
              {count > 0 && (
                <span className="ml-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold text-white">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {loading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
      ) : !data ? (
        <div className="py-16 text-center text-sm text-destructive">Failed to load. <button onClick={load} className="underline">Retry</button></div>
      ) : (
        <div className="space-y-3">
          {/* ── Continuations ── */}
          {activeTab === "continuations" && (
            data.continuations.length === 0 ? <Empty /> : data.continuations.map((row) => (
              <Card key={row.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">
                        Job #{row.job?.jobNumber ?? row.jobId.slice(0, 8)}
                        {row.job?.property?.name ? ` — ${row.job.property.name}` : ""}
                      </p>
                      <StatusBadge status={row.status} />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {row.job?.property?.suburb} ·{" "}
                      Scheduled: {row.job?.scheduledDate ? format(new Date(row.job.scheduledDate), "dd MMM yyyy") : "—"}
                    </p>
                    <p className="text-sm">
                      <span className="font-medium">Reason:</span> {row.reason}
                    </p>
                    {row.preferredDate && (
                      <p className="text-xs text-muted-foreground">
                        Preferred continuation: {format(new Date(row.preferredDate), "dd MMM yyyy")}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">Requested: {fmt(row.requestedAt)}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/admin/jobs/${row.jobId}`}>
                        View job <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  </div>
                </div>
              </Card>
            ))
          )}

          {/* ── Timing Requests ── */}
          {activeTab === "timingRequests" && (
            data.timingRequests.length === 0 ? <Empty /> : data.timingRequests.map((row) => (
              <Card key={row.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">
                        {row.requestType === "EARLY_CHECKIN" ? "Early check-in" : "Late checkout"} —{" "}
                        {row.job?.property?.name ?? "Job " + (row.job?.jobNumber ?? row.jobId.slice(0, 8))}
                      </p>
                      <StatusBadge status={row.status} />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {row.job?.property?.suburb} ·{" "}
                      Job scheduled: {row.job?.scheduledDate ? format(new Date(row.job.scheduledDate), "dd MMM yyyy") : "—"}
                    </p>
                    {row.requestedTime && (
                      <p className="text-sm">
                        <span className="font-medium">Requested time:</span> {row.requestedTime}
                      </p>
                    )}
                    {row.note && <p className="text-sm text-muted-foreground">{row.note}</p>}
                    <p className="text-xs text-muted-foreground">Requested: {fmt(row.requestedAt)}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={!!acting}
                      onClick={() => act(`/api/admin/job-early-checkouts/${row.id}`, "PATCH", { status: "APPROVED" }, "Approved")}
                    >
                      <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!!acting}
                      onClick={() => act(`/api/admin/job-early-checkouts/${row.id}`, "PATCH", { status: "DECLINED" }, "Declined")}
                    >
                      <XCircle className="mr-1.5 h-3.5 w-3.5" />
                      Decline
                    </Button>
                    <Button asChild size="sm" variant="ghost">
                      <Link href={`/admin/jobs/${row.jobId}`}>View job</Link>
                    </Button>
                  </div>
                </div>
              </Card>
            ))
          )}

          {/* ── Pay Adjustments ── */}
          {activeTab === "payAdjustments" && (
            data.payAdjustments.length === 0 ? <Empty /> : data.payAdjustments.map((row) => {
              const propertyName = row.job?.property?.name ?? row.property?.name ?? null;
              const propertySuburb = row.job?.property?.suburb ?? row.property?.suburb ?? null;
              const defaultAmount = String(primaryPayAmount(row).toFixed(2));
              const approveAmount = payApproveAmounts[row.id] ?? defaultAmount;
              const clientApproval = row.clientApproval ?? null;
              const clientApprovalBlocking = clientApproval && clientApproval.status !== "APPROVED";
              const isSendingThis = sendingClientApproval === row.id;
              return (
                <Card key={row.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">
                          {row.title || "Pay request"} — {row.cleaner?.name ?? "Cleaner"}
                        </p>
                        <StatusBadge status={row.status} />
                        <span className="text-xs text-muted-foreground">{row.scope} / {row.type}</span>
                      </div>
                      {propertyName && (
                        <p className="text-sm text-muted-foreground">
                          {propertyName}{propertySuburb ? ` · ${propertySuburb}` : ""}
                          {row.job?.jobNumber ? ` · Job #${row.job.jobNumber}` : ""}
                        </p>
                      )}
                      {!propertyName && row.scope === "STANDALONE" && (
                        <p className="text-sm text-muted-foreground">Standalone — no property linked</p>
                      )}
                      <p className="text-sm">
                        <span className="font-medium">Requested:</span> ${primaryPayAmount(row).toFixed(2)}
                        {row.type === "HOURLY" && row.requestedHours ? ` (${row.requestedHours}h × $${Number(row.requestedRate ?? 0).toFixed(2)})` : ""}
                      </p>
                      {row.clientRequestedAmount != null ? (
                        <p className="text-xs text-muted-foreground">
                          Cleaner requested: ${Number(row.cleanerRequestedAmount ?? row.requestedAmount ?? 0).toFixed(2)} · Client amount: ${Number(row.clientRequestedAmount ?? 0).toFixed(2)}
                        </p>
                      ) : null}
                      {row.cleanerNote && <p className="text-sm text-muted-foreground">{row.cleanerNote}</p>}
                      {clientApproval ? (
                        <p className={cn("text-xs font-medium", clientApproval.status === "APPROVED" ? "text-green-700" : "text-amber-700")}>
                          Client approval: {clientApproval.status}
                          {clientApproval.amount != null ? ` · AUD ${Number(clientApproval.amount).toFixed(2)}` : ""}
                          {clientApproval.respondedAt ? ` · responded ${fmt(clientApproval.respondedAt)}` : ""}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">Client approval: not sent</p>
                      )}
                      <p className="text-xs text-muted-foreground">Requested: {fmt(row.requestedAt)}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        className="h-8 w-28 text-sm"
                        value={approveAmount}
                        onChange={(e) => setPayApproveAmounts((prev) => ({ ...prev, [row.id]: e.target.value }))}
                        placeholder="Approve $"
                        disabled={!!clientApprovalBlocking}
                      />
                      <Button
                        size="sm"
                        disabled={!!acting || !!clientApprovalBlocking}
                        title={clientApprovalBlocking ? `Client approval is ${clientApproval?.status} — approve client first` : undefined}
                        onClick={() => act(
                          `/api/admin/pay-adjustments/${row.id}`,
                          "PATCH",
                          { status: "APPROVED", approvedAmount: Number(approveAmount) },
                          "Approved"
                        )}
                      >
                        <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!!acting}
                        onClick={() => act(`/api/admin/pay-adjustments/${row.id}`, "PATCH", { status: "REJECTED" }, "Rejected")}
                      >
                        <XCircle className="mr-1.5 h-3.5 w-3.5" />
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isSendingThis || !!acting || clientApproval?.status === "PENDING"}
                        onClick={() => sendPayToClient(row)}
                      >
                        {isSendingThis ? "Sending…" : clientApproval?.status === "PENDING" ? "Client pending" : "Send to client"}
                      </Button>
                      {row.jobId && (
                        <Button asChild size="sm" variant="ghost">
                          <Link href={`/admin/jobs/${row.jobId}`}>View job</Link>
                        </Button>
                      )}
                      <Button asChild size="sm" variant="ghost">
                        <Link href="/admin/pay-adjustments">All requests</Link>
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })
          )}

          {/* ── Time Adjustments ── */}
          {activeTab === "timeAdjustments" && (
            data.timeAdjustments.length === 0 ? <Empty /> : data.timeAdjustments.map((row) => (
              <Card key={row.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">
                        Clock adjustment — {row.cleaner?.name ?? "Cleaner"}
                      </p>
                      <StatusBadge status={row.status} />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {row.job?.property?.name} · {row.job?.property?.suburb} ·{" "}
                      Job #{row.job?.jobNumber ?? "—"}
                    </p>
                    {(row.reason || row.cleanerNote) && <p className="text-sm text-muted-foreground">{row.reason || row.cleanerNote}</p>}
                    <p className="text-xs text-muted-foreground">Requested: {fmt(row.requestedAt ?? row.createdAt)}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={!!acting}
                      onClick={() => act(`/api/admin/time-adjustments/${row.id}`, "PATCH", { status: "APPROVED" }, "Approved")}
                    >
                      <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!!acting}
                      onClick={() => act(`/api/admin/time-adjustments/${row.id}`, "PATCH", { status: "REJECTED" }, "Rejected")}
                    >
                      <XCircle className="mr-1.5 h-3.5 w-3.5" />
                      Reject
                    </Button>
                    {row.jobId && (
                      <Button asChild size="sm" variant="ghost">
                        <Link href={`/admin/jobs/${row.jobId}`}>View job</Link>
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            ))
          )}

          {/* ── Client Approvals ── */}
          {activeTab === "clientApprovals" && (
            data.clientApprovals.length === 0 ? <Empty /> : data.clientApprovals.map((row) => (
              <Card key={row.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{row.title}</p>
                      <StatusBadge status={row.status} />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {row.client?.name ?? "Client"}
                      {row.property ? ` · ${row.property.name}` : ""}
                      {" · "}
                      {row.currency} {Number(row.amount ?? 0).toFixed(2)}
                    </p>
                    {row.description && <p className="text-sm">{row.description}</p>}
                    <p className="text-xs text-muted-foreground">
                      Requested: {fmt(row.requestedAt)}
                      {row.expiresAt ? ` · Expires: ${fmt(row.expiresAt)}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={!!acting}
                      onClick={() => act(`/api/admin/client-approvals/${row.id}`, "PATCH", { status: "APPROVED" }, "Approved")}
                    >
                      <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!!acting}
                      onClick={() => act(`/api/admin/client-approvals/${row.id}`, "PATCH", { status: "DECLINED" }, "Declined")}
                    >
                      <XCircle className="mr-1.5 h-3.5 w-3.5" />
                      Decline
                    </Button>
                  </div>
                </div>
              </Card>
            ))
          )}

          {/* ── Reschedule Requests ── */}
          {activeTab === "rescheduleRequests" && (
            (data.rescheduleRequests?.length ?? 0) === 0 ? <Empty /> : data.rescheduleRequests.map((row) => {
              const meta = row.metadata as { requestedDate?: string; requestedStartTime?: string | null } | null;
              return (
                <Card key={row.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <CalendarClock className="h-4 w-4 text-amber-500" />
                        <p className="font-semibold">
                          Reschedule — Job #{row.job?.jobNumber ?? row.jobId?.slice(0, 8)}
                          {row.job?.property?.name ? ` · ${row.job.property.name}` : ""}
                        </p>
                        <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold bg-amber-100 text-amber-800 border-amber-200">
                          PENDING
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {row.job?.property?.suburb} ·{" "}
                        Current date:{" "}
                        {row.job?.scheduledDate
                          ? format(new Date(row.job.scheduledDate), "dd MMM yyyy")
                          : "—"}
                        {row.job?.startTime ? ` ${row.job.startTime}` : ""}
                      </p>
                      {meta?.requestedDate && (
                        <p className="text-sm">
                          <span className="font-medium">Requested date:</span>{" "}
                          {format(new Date(meta.requestedDate), "dd MMM yyyy")}
                          {meta.requestedStartTime ? ` at ${meta.requestedStartTime}` : ""}
                        </p>
                      )}
                      <p className="text-sm text-muted-foreground">
                        Requested by: {row.requestedBy?.name ?? row.requestedBy?.email ?? "Client"}
                      </p>
                      <p className="text-xs text-muted-foreground">Submitted: {fmt(row.createdAt)}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={!!acting}
                        onClick={() =>
                          act(
                            `/api/admin/job-tasks/${row.id}`,
                            "PATCH",
                            { decision: "APPROVE" },
                            "Reschedule approved — job date updated"
                          )
                        }
                      >
                        <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!!acting}
                        onClick={() =>
                          act(
                            `/api/admin/job-tasks/${row.id}`,
                            "PATCH",
                            { decision: "REJECT" },
                            "Reschedule declined"
                          )
                        }
                      >
                        <XCircle className="mr-1.5 h-3.5 w-3.5" />
                        Decline
                      </Button>
                      {row.jobId && (
                        <Button asChild size="sm" variant="ghost">
                          <Link href={`/admin/jobs/${row.jobId}`}>View job</Link>
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })
          )}

          {/* ── Flagged Laundry ── */}
          {activeTab === "flaggedLaundry" && (
            data.flaggedLaundry.length === 0 ? <Empty /> : data.flaggedLaundry.map((row) => (
              <Card key={row.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      <p className="font-semibold">
                        Flagged laundry — {row.job?.property?.name ?? "Unknown property"}
                      </p>
                      <StatusBadge status={row.status} />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {row.job?.property?.suburb}
                      {row.job?.scheduledDate
                        ? ` · Job date: ${format(new Date(row.job.scheduledDate), "dd MMM yyyy")}`
                        : ""}
                      {row.job?.jobNumber ? ` · Job #${row.job.jobNumber}` : ""}
                    </p>
                    {row.bagLocation && (
                      <p className="text-sm">
                        <span className="font-medium">Bag location:</span> {row.bagLocation}
                      </p>
                    )}
                    {row.notes && <p className="text-sm text-muted-foreground">{row.notes}</p>}
                    <p className="text-xs text-muted-foreground">Updated: {fmt(row.updatedAt)}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild size="sm" variant="outline">
                      <Link href="/admin/laundry">
                        Open laundry <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                      </Link>
                    </Button>
                    {row.job?.id && (
                      <Button asChild size="sm" variant="ghost">
                        <Link href={`/admin/jobs/${row.job.id}`}>View job</Link>
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-white/80 p-4 shadow-sm sm:p-5">
      {children}
    </div>
  );
}

function Empty() {
  return (
    <div className="rounded-2xl border border-dashed border-border py-14 text-center text-sm text-muted-foreground">
      No pending items in this category.
    </div>
  );
}
