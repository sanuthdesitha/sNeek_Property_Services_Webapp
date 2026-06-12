"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Clock3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";

type TimeAdjustmentRow = {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  requestedDurationM: number;
  requestedStoppedAt: string | null;
  originalDurationM: number;
  originalStoppedAt: string | null;
  reason: string | null;
  adminNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  minimumApprovableDurationM: number;
  originalTotalDurationM: number;
  requestedTotalDurationM: number;
  cleaner: { id: string; name: string | null; email: string };
  reviewedBy: { id: string; name: string | null; email: string } | null;
  job: {
    id: string;
    jobNumber: string;
    jobType: string;
    scheduledDate: string;
    property: { id: string; name: string; suburb: string };
  };
  timeLog: {
    id: string;
    startedAt: string;
    stoppedAt: string | null;
    durationM: number | null;
  };
};

function formatMinutes(minutes: number | null | undefined) {
  const safeMinutes = Math.max(0, Number(minutes ?? 0));
  const hours = Math.floor(safeMinutes / 60);
  const mins = safeMinutes % 60;
  if (hours <= 0) return `${mins} min`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

export default function AdminTimeAdjustmentsPage() {
  const [rows, setRows] = useState<TimeAdjustmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("pending");
  const [editing, setEditing] = useState<TimeAdjustmentRow | null>(null);
  const [actionType, setActionType] = useState<"APPROVED" | "REJECTED">("APPROVED");
  const [approvedDurationM, setApprovedDurationM] = useState("");
  const [adminNote, setAdminNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/admin/time-adjustments");
    const body = await res.json().catch(() => []);
    setRows(Array.isArray(body) ? body : []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const pendingRows = useMemo(() => rows.filter((row) => row.status === "PENDING"), [rows]);
  const list = activeTab === "pending" ? pendingRows : rows;

  function openApprove(row: TimeAdjustmentRow) {
    setEditing(row);
    setActionType("APPROVED");
    setApprovedDurationM(String(row.requestedTotalDurationM));
    setAdminNote("");
  }

  function openReject(row: TimeAdjustmentRow) {
    setEditing(row);
    setActionType("REJECTED");
    setApprovedDurationM(String(row.requestedTotalDurationM));
    setAdminNote("");
  }

  async function submitReview() {
    if (!editing) return;
    const payload: Record<string, unknown> = {
      status: actionType,
      adminNote: adminNote.trim() || undefined,
    };
    if (actionType === "APPROVED") {
      const approved = Number(approvedDurationM || 0);
      if (!Number.isFinite(approved) || approved < editing.minimumApprovableDurationM) {
        toast({
          title: "Approved time is too low",
          description: `Minimum allowed is ${editing.minimumApprovableDurationM} minutes.`,
          variant: "destructive",
        });
        return;
      }
      payload.approvedDurationM = approved;
    }

    setSaving(true);
    const res = await fetch(`/api/admin/time-adjustments/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      toast({
        title: "Review failed",
        description: body.error ?? "Could not review the clock adjustment request.",
        variant: "destructive",
      });
      return;
    }

    toast({
      title: actionType === "APPROVED" ? "Clock adjustment approved" : "Clock adjustment rejected",
    });
    setEditing(null);
    await load();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Clock3 />}
        title="Clock Adjustments"
        description="Review cleaner requests to change the final clock time captured at submission."
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="pending">Pending ({pendingRows.length})</TabsTrigger>
          <TabsTrigger value="all">All ({rows.length})</TabsTrigger>
        </TabsList>
        <TabsContent value={activeTab}>
          <Card>
            <CardContent className="p-0">
              {loading ? (
                <p className="py-10 text-center text-sm text-muted-foreground">Loading...</p>
              ) : list.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">No clock adjustment requests found.</p>
              ) : (
                <div className="divide-y">
                  {list.map((row) => {
                    const delta = row.requestedTotalDurationM - row.originalTotalDurationM;
                    const deltaSign = delta > 0 ? "+" : delta < 0 ? "-" : "";
                    const fmtAt = (v: string | null) =>
                      v ? format(new Date(v), "dd MMM yyyy HH:mm") : "—";
                    return (
                      <div key={row.id} className="space-y-3 px-4 py-4">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div className="space-y-1">
                            <p className="text-sm font-semibold">
                              <Link href={`/admin/jobs/${row.job.id}`} className="hover:underline">
                                {row.job.property.name}
                              </Link>
                              <span className="ml-2 rounded bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                                {row.job.jobNumber}
                              </span>
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Cleaner: {row.cleaner.name ?? row.cleaner.email}
                              {row.cleaner.name ? ` (${row.cleaner.email})` : ""}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {row.job.property.suburb} · {row.job.jobType.replace(/_/g, " ")} ·{" "}
                              {format(new Date(row.job.scheduledDate), "dd MMM yyyy")}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Requested {format(new Date(row.createdAt), "dd MMM yyyy HH:mm")}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge
                              variant={
                                row.status === "PENDING"
                                  ? ("warning" as any)
                                  : row.status === "APPROVED"
                                    ? "success"
                                    : "destructive"
                              }
                            >
                              {row.status}
                            </Badge>
                            {row.status === "PENDING" ? (
                              <>
                                <Button size="sm" onClick={() => openApprove(row)}>Approve</Button>
                                <Button size="sm" variant="outline" onClick={() => openReject(row)}>Reject</Button>
                              </>
                            ) : null}
                          </div>
                        </div>

                        {/* Side-by-side before/after */}
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Original
                            </p>
                            <dl className="mt-2 space-y-1 text-sm">
                              <div className="flex justify-between gap-3">
                                <dt className="text-muted-foreground">Clock-in</dt>
                                <dd className="font-medium">{fmtAt(row.timeLog.startedAt)}</dd>
                              </div>
                              <div className="flex justify-between gap-3">
                                <dt className="text-muted-foreground">Clock-out</dt>
                                <dd className="font-medium">{fmtAt(row.originalStoppedAt)}</dd>
                              </div>
                              <div className="flex justify-between gap-3">
                                <dt className="text-muted-foreground">Total time</dt>
                                <dd className="font-medium">{formatMinutes(row.originalTotalDurationM)}</dd>
                              </div>
                            </dl>
                          </div>
                          <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-primary">
                              Requested
                            </p>
                            <dl className="mt-2 space-y-1 text-sm">
                              <div className="flex justify-between gap-3">
                                <dt className="text-muted-foreground">Clock-in</dt>
                                <dd className="font-medium">{fmtAt(row.timeLog.startedAt)}</dd>
                              </div>
                              <div className="flex justify-between gap-3">
                                <dt className="text-muted-foreground">Clock-out</dt>
                                <dd className="font-medium">{fmtAt(row.requestedStoppedAt)}</dd>
                              </div>
                              <div className="flex justify-between gap-3">
                                <dt className="text-muted-foreground">Total time</dt>
                                <dd className="font-medium">
                                  {formatMinutes(row.requestedTotalDurationM)}
                                  {delta !== 0 ? (
                                    <span
                                      className={`ml-2 text-xs font-semibold ${
                                        delta > 0 ? "text-green-700" : "text-red-700"
                                      }`}
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
                          <div className="rounded-xl border border-border/60 bg-background p-3">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Reason from cleaner
                            </p>
                            <p className="mt-1 text-sm">{row.reason}</p>
                          </div>
                        ) : null}
                        {row.adminNote ? (
                          <p className="text-xs text-muted-foreground">Admin note: {row.adminNote}</p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{actionType === "APPROVED" ? "Approve clock adjustment" : "Reject clock adjustment"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {editing ? (
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <p><strong>{editing.job.property.name}</strong> · {editing.job.jobNumber}</p>
                <p className="text-xs text-muted-foreground">
                  Original {formatMinutes(editing.originalTotalDurationM)} · Requested {formatMinutes(editing.requestedTotalDurationM)}
                </p>
              </div>
            ) : null}
            {actionType === "APPROVED" ? (
              <div className="space-y-1.5">
                <Label>Approved total minutes</Label>
                <Input
                  type="number"
                  min={editing?.minimumApprovableDurationM ?? 1}
                  max={24 * 60}
                  value={approvedDurationM}
                  onChange={(e) => setApprovedDurationM(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Minimum allowed: {editing?.minimumApprovableDurationM ?? 1} minutes
                </p>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label>Admin note</Label>
              <Textarea
                rows={3}
                value={adminNote}
                onChange={(e) => setAdminNote(e.target.value)}
                placeholder="Optional note for the cleaner"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={submitReview} disabled={saving}>
                {saving ? "Saving..." : actionType === "APPROVED" ? "Approve" : "Reject"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
