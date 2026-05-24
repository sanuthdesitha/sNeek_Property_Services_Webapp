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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  const [reversingClientApproval, setReversingClientApproval] = useState<string | null>(null);
  const [sendToClientFor, setSendToClientFor] = useState<any | null>(null);
  const [sendClientAmount, setSendClientAmount] = useState("");
  const [sendClientTitle, setSendClientTitle] = useState("");
  const [sendClientDescription, setSendClientDescription] = useState("");

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

  function openSendPayToClient(row: any) {
    const propertyName = row.job?.property?.name ?? row.property?.name ?? "Request";
    setSendToClientFor(row);
    setSendClientAmount(String(Number(row.clientRequestedAmount ?? row.requestedAmount ?? 0).toFixed(2)));
    setSendClientTitle(`Additional charge approval - ${propertyName}`);
    setSendClientDescription(
      row.cleanerNote?.trim()
        ? `Cleaner requested additional payment. Note: ${row.cleanerNote}`
        : "Cleaner requested additional payment."
    );
  }

  async function sendPayToClientFromDialog() {
    if (!sendToClientFor) return;
    const row = sendToClientFor;
    const amount = Number(sendClientAmount || 0);
    if (!Number.isFinite(amount) || amount < 0) {
      toast({ title: "Valid client amount is required.", variant: "destructive" });
      return;
    }
    if (!sendClientTitle.trim()) {
      toast({ title: "Title is required.", variant: "destructive" });
      return;
    }
    const confirmed = window.confirm(
      `Send this pay request to the client for $${amount.toFixed(2)} approval?\n\nThis will appear in the client portal and notify the client.`
    );
    if (!confirmed) return;
    setSendingClientApproval(row.id);
    const res = await fetch(`/api/admin/pay-adjustments/${row.id}/send-to-client`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount,
        title: sendClientTitle.trim(),
        description: sendClientDescription.trim(),
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
    setSendToClientFor(null);
    await load();
  }

  async function reversePayClientApproval(row: any) {
    if (!row.clientApproval) return;
    const confirmed = window.confirm(
      "Reverse this client approval request?\n\nIt will be removed from the client portal. You can send it again later if needed."
    );
    if (!confirmed) return;
    setReversingClientApproval(row.id);
    const res = await fetch(`/api/admin/pay-adjustments/${row.id}/send-to-client`, {
      method: "DELETE",
    });
    const json = await res.json().catch(() => ({}));
    setReversingClientApproval(null);
    if (!res.ok) {
      toast({ title: "Failed to reverse", description: json.error ?? "Action failed", variant: "destructive" });
      return;
    }
    toast({ title: "Client approval reversed", description: "The request was removed from the client portal." });
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
                    <div className="flex items-start gap-3">
                      <Avatar name={row.cleaner?.name} image={row.cleaner?.image} size={40} />
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold">{row.cleaner?.name ?? "Cleaner"}</p>
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                            {row.cleaner?.role ?? "Cleaner"}
                          </span>
                          <StatusBadge status={row.status} />
                          <span className="text-xs text-muted-foreground">{row.scope} / {row.type}</span>
                        </div>
                        <p className="text-sm text-muted-foreground">{row.title || "Pay request"}</p>
                      {propertyName && (
                        <p className="text-sm text-muted-foreground">
                          {propertyName}{propertySuburb ? ` · ${propertySuburb}` : ""}
                          {row.job?.jobNumber ? ` · Job #${row.job.jobNumber}` : ""}
                          {row.job?.scheduledDate ? ` · ${format(new Date(row.job.scheduledDate), "dd MMM yyyy")}` : ""}
                          {row.job?.startTime ? ` ${row.job.startTime}` : ""}
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
                        onClick={() => openSendPayToClient(row)}
                      >
                        {isSendingThis ? "Sending…" : clientApproval?.status === "PENDING" ? "Client pending" : "Send to client"}
                      </Button>
                      {clientApproval ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={reversingClientApproval === row.id || !!acting}
                          onClick={() => reversePayClientApproval(row)}
                          className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
                        >
                          {reversingClientApproval === row.id ? "Reversing..." : "Reverse client send"}
                        </Button>
                      ) : null}
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
              <ClockAdjustmentCard
                key={row.id}
                row={row}
                acting={acting}
                onApprove={() => act(`/api/admin/time-adjustments/${row.id}`, "PATCH", { status: "APPROVED" }, "Approved")}
                onReject={() => act(`/api/admin/time-adjustments/${row.id}`, "PATCH", { status: "REJECTED" }, "Rejected")}
              />
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

      <Dialog
        open={Boolean(sendToClientFor)}
        onOpenChange={(open) => {
          if (!open) setSendToClientFor(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Send pay request to client</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="client-request-title">Client title</Label>
              <Input
                id="client-request-title"
                value={sendClientTitle}
                onChange={(event) => setSendClientTitle(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="client-request-amount">Client request amount</Label>
              <Input
                id="client-request-amount"
                type="number"
                min="0"
                step="0.01"
                value={sendClientAmount}
                onChange={(event) => setSendClientAmount(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="client-request-description">Client description</Label>
              <Textarea
                id="client-request-description"
                rows={4}
                value={sendClientDescription}
                onChange={(event) => setSendClientDescription(event.target.value)}
              />
            </div>
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setSendToClientFor(null)}
                disabled={Boolean(sendingClientApproval)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={sendPayToClientFromDialog}
                disabled={Boolean(sendingClientApproval)}
              >
                {sendingClientApproval ? "Sending..." : "Send to Client"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
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

// ── Avatar ────────────────────────────────────────────────────────────────────
function Avatar({
  name,
  image,
  size = 32,
}: {
  name?: string | null;
  image?: string | null;
  size?: number;
}) {
  const initials = (name ?? "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";
  if (image) {
    /* eslint-disable-next-line @next/next/no-img-element */
    return (
      <img
        src={image}
        alt={name ?? "user"}
        width={size}
        height={size}
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="flex items-center justify-center rounded-full bg-primary-soft text-primary text-xs font-semibold"
      style={{ width: size, height: size }}
      aria-label={name ?? "user"}
    >
      {initials}
    </div>
  );
}

// ── Clock adjustment card with before/after diff ─────────────────────────────
function formatMinutes(mins?: number | null) {
  if (mins == null || Number.isNaN(mins)) return "—";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function ClockAdjustmentCard({
  row,
  acting,
  onApprove,
  onReject,
}: {
  row: any;
  acting: string | null;
  onApprove: () => void;
  onReject: () => void;
}) {
  const cleanerName = row.cleaner?.name ?? row.cleaner?.email ?? "Cleaner";
  const propertyName = row.job?.property?.name ?? "—";
  const propertySuburb = row.job?.property?.suburb ?? null;
  const jobScheduled = row.job?.scheduledDate
    ? format(new Date(row.job.scheduledDate), "dd MMM yyyy")
    : null;
  const jobStart = row.job?.startTime ?? null;
  const originalStarted = row.timeLog?.startedAt ?? null;
  const originalStopped = row.originalStoppedAt ?? row.timeLog?.stoppedAt ?? null;
  const requestedStopped = row.requestedStoppedAt ?? null;
  const originalMins = row.originalDurationM ?? row.timeLog?.durationM ?? null;
  const requestedMins = row.requestedDurationM ?? null;
  const delta =
    typeof requestedMins === "number" && typeof originalMins === "number"
      ? requestedMins - originalMins
      : null;
  const deltaSign = delta != null && delta > 0 ? "+" : "";

  return (
    <div className="rounded-2xl border border-border/70 bg-white/80 p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* Requestor + context */}
        <div className="flex items-start gap-3">
          <Avatar name={cleanerName} image={row.cleaner?.image} size={40} />
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold">{cleanerName}</p>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {row.cleaner?.role ?? "Cleaner"}
              </span>
              <StatusBadge status={row.status} />
            </div>
            <p className="text-sm text-muted-foreground">
              Clock adjustment request
            </p>
            <p className="text-xs text-muted-foreground">
              {propertyName}
              {propertySuburb ? ` · ${propertySuburb}` : ""}
              {row.job?.jobNumber ? ` · Job #${row.job.jobNumber}` : ""}
              {jobScheduled ? ` · ${jobScheduled}` : ""}
              {jobStart ? ` ${jobStart}` : ""}
            </p>
          </div>
        </div>
        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={!!acting} onClick={onApprove}>
            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
            Approve
          </Button>
          <Button size="sm" variant="outline" disabled={!!acting} onClick={onReject}>
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

      {/* Before / after diff */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Original
          </p>
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Clock-in</dt>
              <dd className="font-medium">{fmt(originalStarted)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Clock-out</dt>
              <dd className="font-medium">{fmt(originalStopped)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Duration</dt>
              <dd className="font-medium">{formatMinutes(originalMins)}</dd>
            </div>
          </dl>
        </div>
        <div className="rounded-xl border border-primary/30 bg-primary-soft/40 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-primary">
            Requested
          </p>
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Clock-in</dt>
              <dd className="font-medium">{fmt(originalStarted)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Clock-out</dt>
              <dd className="font-medium">{fmt(requestedStopped)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Duration</dt>
              <dd className="font-medium">
                {formatMinutes(requestedMins)}
                {delta != null && delta !== 0 ? (
                  <span
                    className={cn(
                      "ml-2 text-xs font-semibold",
                      delta > 0 ? "text-success" : "text-destructive"
                    )}
                  >
                    {deltaSign}
                    {formatMinutes(Math.abs(delta))}
                  </span>
                ) : null}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {row.reason ? (
        <div className="mt-3 rounded-xl border border-border/60 bg-background p-3 text-sm">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Reason from cleaner
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm">{row.reason}</p>
        </div>
      ) : null}

      <p className="mt-3 text-xs text-muted-foreground">
        Requested {fmt(row.requestedAt ?? row.createdAt)}
      </p>
    </div>
  );
}
