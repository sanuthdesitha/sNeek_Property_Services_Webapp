"use client";

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

type PayAdjustmentRow = {
  id: string;
  scope: "JOB" | "PROPERTY" | "STANDALONE";
  title: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  type: "HOURLY" | "FIXED";
  requestedHours: number | null;
  requestedRate: number | null;
  requestedAmount: number;
  approvedAmount: number | null;
  cleanerNote: string | null;
  adminNote: string | null;
  requestedAt: string;
  cleaner: { id: string; name: string | null; email: string };
  job: {
    id: string;
    jobType: string;
    scheduledDate: string;
    property: { id: string; name: string; suburb: string };
  } | null;
  property?: {
    id: string;
    name: string;
    suburb: string | null;
    clientId: string | null;
  } | null;
  attachmentUrls?: Array<{ key: string; url: string }>;
  clientApproval?: {
    id: string;
    status: "PENDING" | "APPROVED" | "DECLINED" | "CANCELLED" | "EXPIRED";
    amount: number;
    currency: string;
    title: string;
    requestedAt: string;
    respondedAt: string | null;
  } | null;
};

function formatMoney(value: number | null | undefined) {
  return `$${Number(value ?? 0).toFixed(2)}`;
}

export default function AdminPayAdjustmentsPage() {
  const [rows, setRows] = useState<PayAdjustmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("pending");
  const [editing, setEditing] = useState<PayAdjustmentRow | null>(null);
  const [actionType, setActionType] = useState<"APPROVED" | "REJECTED">("APPROVED");
  const [approvedAmount, setApprovedAmount] = useState("");
  const [adminNote, setAdminNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [sendToClientFor, setSendToClientFor] = useState<PayAdjustmentRow | null>(null);
  const [sendClientAmount, setSendClientAmount] = useState("");
  const [sendClientTitle, setSendClientTitle] = useState("");
  const [sendClientDescription, setSendClientDescription] = useState("");
  const [sendingClientApproval, setSendingClientApproval] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/admin/pay-adjustments");
    const body = await res.json().catch(() => []);
    setRows(Array.isArray(body) ? body : []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const pendingRows = useMemo(() => rows.filter((row) => row.status === "PENDING"), [rows]);
  const list = activeTab === "pending" ? pendingRows : rows;

  function openApprove(row: PayAdjustmentRow) {
    setEditing(row);
    setActionType("APPROVED");
    setApprovedAmount(String(Number(row.requestedAmount ?? 0).toFixed(2)));
    setAdminNote("");
  }

  function openReject(row: PayAdjustmentRow) {
    setEditing(row);
    setActionType("REJECTED");
    setApprovedAmount("");
    setAdminNote("");
  }

  function openSendToClient(row: PayAdjustmentRow) {
    setSendToClientFor(row);
    setSendClientAmount(String(Number(row.requestedAmount ?? 0).toFixed(2)));
    setSendClientTitle(`Additional charge approval - ${row.job?.property.name ?? row.property?.name ?? "Request"}`);
    setSendClientDescription(
      row.cleanerNote?.trim()
        ? `Cleaner requested additional payment. Note: ${row.cleanerNote}`
        : "Cleaner requested additional payment."
    );
  }

  async function sendToClient() {
    if (!sendToClientFor) return;
    const amount = Number(sendClientAmount || 0);
    if (!Number.isFinite(amount) || amount < 0) {
      toast({ title: "Valid client amount is required.", variant: "destructive" });
      return;
    }
    if (!sendClientTitle.trim()) {
      toast({ title: "Title is required.", variant: "destructive" });
      return;
    }
    setSendingClientApproval(true);
    const res = await fetch(`/api/admin/pay-adjustments/${sendToClientFor.id}/send-to-client`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount,
        title: sendClientTitle.trim(),
        description: sendClientDescription.trim(),
        currency: "AUD",
      }),
    });
    const body = await res.json().catch(() => ({}));
    setSendingClientApproval(false);
    if (!res.ok) {
      toast({
        title: "Could not send to client",
        description: body.error ?? "Request failed.",
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Sent to client for approval" });
    setSendToClientFor(null);
    await load();
  }

  async function submitReview() {
    if (!editing) return;
    if (actionType === "APPROVED") {
      const amount = Number(approvedAmount || 0);
      if (!Number.isFinite(amount) || amount <= 0) {
        toast({ title: "Approved amount is required.", variant: "destructive" });
        return;
      }
    }

    setSaving(true);
    const payload: Record<string, unknown> = {
      status: actionType,
      adminNote: adminNote.trim() || undefined,
    };
    if (actionType === "APPROVED") {
      payload.approvedAmount = Number(approvedAmount);
    }
    const res = await fetch(`/api/admin/pay-adjustments/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      toast({ title: "Update failed", description: body.error ?? "Could not review request.", variant: "destructive" });
      return;
    }
    toast({ title: actionType === "APPROVED" ? "Request approved" : "Request rejected" });
    setEditing(null);
    await load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Extra Payment Requests</h2>
          <p className="text-sm text-muted-foreground">Review cleaner hourly/fixed extra payment requests.</p>
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
                <p className="py-10 text-center text-sm text-muted-foreground">No requests found.</p>
              ) : (
                <div className="divide-y">
                  {list.map((row) => (
                    <div key={row.id} className="flex flex-wrap items-start justify-between gap-4 px-4 py-3">
                    <div className="space-y-1">
                        <p className="text-sm font-medium">
                          {row.title || row.job?.property.name || row.property?.name || "Pay request"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Cleaner: {row.cleaner.name ?? row.cleaner.email} ({row.cleaner.email})
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {row.scope === "JOB" && row.job
                            ? `Date: ${format(new Date(row.job.scheduledDate), "dd MMM yyyy")} | `
                            : ""}
                          {row.job?.property?.name || row.property?.name || "No property linked"} | Requested: {formatMoney(row.requestedAmount)}
                          {row.type === "HOURLY" ? ` (${row.requestedHours ?? 0}h x ${formatMoney(row.requestedRate)})` : ""} | {row.scope}
                        </p>
                        {row.cleanerNote ? <p className="text-xs">Cleaner note: {row.cleanerNote}</p> : null}
                        {row.adminNote ? <p className="text-xs text-muted-foreground">Admin note: {row.adminNote}</p> : null}
                        {row.clientApproval ? (
                          <p className="text-xs text-muted-foreground">
                            Client approval: {row.clientApproval.status} ({row.clientApproval.currency} {row.clientApproval.amount.toFixed(2)})
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground">Client approval: not sent</p>
                        )}
                        {row.status === "APPROVED" ? (
                          <p className="text-xs font-medium text-emerald-600">Approved: {formatMoney(row.approvedAmount)}</p>
                        ) : null}
                        {row.attachmentUrls?.length ? (
                          <p className="text-xs text-muted-foreground">Images attached: {row.attachmentUrls.length}</p>
                        ) : null}
                      </div>

                      <div className="flex items-center gap-2">
                        <Badge variant={row.status === "PENDING" ? ("warning" as any) : row.status === "APPROVED" ? "success" : "destructive"}>
                          {row.status}
                        </Badge>
                        {row.status === "PENDING" ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openSendToClient(row)}
                              disabled={row.clientApproval?.status === "PENDING" || !(row.job?.property?.id || row.property?.id)}
                            >
                              {row.clientApproval?.status === "PENDING" ? "Client Pending" : "Send to Client"}
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => openApprove(row)}
                              disabled={Boolean(row.clientApproval && row.clientApproval.status !== "APPROVED")}
                            >
                              Approve
                            </Button>
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
            <DialogTitle>{actionType === "APPROVED" ? "Approve request" : "Reject request"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {actionType === "APPROVED" &&
            editing?.clientApproval &&
            editing.clientApproval.status !== "APPROVED" ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                Client approval status is {editing.clientApproval.status}. You can approve cleaner payment only after client approval.
              </div>
            ) : null}
            {actionType === "APPROVED" ? (
              <div className="space-y-1.5">
                <Label>Approved amount</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={approvedAmount}
                  onChange={(e) => setApprovedAmount(e.target.value)}
                />
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label>Admin note (optional)</Label>
              <Textarea value={adminNote} onChange={(e) => setAdminNote(e.target.value)} />
            </div>
            <Button className="w-full" onClick={submitReview} disabled={saving}>
              {saving ? "Saving..." : actionType === "APPROVED" ? "Approve Request" : "Reject Request"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(sendToClientFor)} onOpenChange={(open) => !open && setSendToClientFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Request to Client</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input value={sendClientTitle} onChange={(e) => setSendClientTitle(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Client-facing amount</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={sendClientAmount}
                onChange={(e) => setSendClientAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea value={sendClientDescription} onChange={(e) => setSendClientDescription(e.target.value)} />
            </div>
            <Button className="w-full" onClick={sendToClient} disabled={sendingClientApproval}>
              {sendingClientApproval ? "Sending..." : "Send to Client"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
