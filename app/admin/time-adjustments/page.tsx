"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
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
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Clock Adjustments</h2>
          <p className="text-sm text-muted-foreground">
            Review cleaner requests to change the final clock time captured at submission.
          </p>
        </div>
        <Button variant="outline" onClick={load}>Refresh</Button>
      </div>

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
                  {list.map((row) => (
                    <div key={row.id} className="flex flex-wrap items-start justify-between gap-4 px-4 py-3">
                      <div className="space-y-1">
                        <p className="text-sm font-medium">
                          <Link href={`/admin/jobs/${row.job.id}`} className="hover:underline">
                            {row.job.property.name}
                          </Link>
                          <span className="ml-2 rounded bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                            {row.job.jobNumber}
                          </span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Cleaner: {row.cleaner.name ?? row.cleaner.email} ({row.cleaner.email})
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {row.job.property.suburb} · {row.job.jobType.replace(/_/g, " ")} · {format(new Date(row.job.scheduledDate), "dd MMM yyyy")}
                        </p>
                        <p className="text-xs">
                          Original final time: <strong>{formatMinutes(row.originalTotalDurationM)}</strong>
                          {" · "}
                          Requested final time: <strong>{formatMinutes(row.requestedTotalDurationM)}</strong>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Requested {format(new Date(row.createdAt), "dd MMM yyyy HH:mm")}
                        </p>
                        {row.reason ? <p className="text-xs">Reason: {row.reason}</p> : null}
                        {row.adminNote ? <p className="text-xs text-muted-foreground">Admin note: {row.adminNote}</p> : null}
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
                  ))}
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
