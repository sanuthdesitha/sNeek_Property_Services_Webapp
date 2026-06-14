"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { HandCoins } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { MediaGallery } from "@/components/shared/media-gallery";

type PropertyOption = {
  id: string;
  name: string;
  suburb: string;
  client: { id: string; name: string | null } | null;
};

type PayAdjustmentRow = {
  id: string;
  scope: "JOB" | "PROPERTY" | "STANDALONE";
  title: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  type: "HOURLY" | "FIXED";
  requestedHours: number | null;
  requestedRate: number | null;
  requestedAmount: number;
  cleanerRequestedAmount?: number;
  clientRequestedAmount?: number | null;
  primaryDisplayAmount?: number;
  primaryDisplayAmountSource?: "CLEANER_REQUESTED" | "CLIENT_REQUESTED";
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

function getPrimaryAmount(row: PayAdjustmentRow) {
  return Number(
    row.primaryDisplayAmount ??
      row.clientRequestedAmount ??
      row.cleanerRequestedAmount ??
      row.requestedAmount ??
      0
  );
}

function formatDateSafe(value: string | null | undefined, fallback = "-") {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return format(parsed, "dd MMM yyyy");
}

function formatDateTimeSafe(value: string | null | undefined, fallback = "-") {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return format(parsed, "dd MMM yyyy HH:mm");
}

export default function AdminPayAdjustmentsPage() {
  const [rows, setRows] = useState<PayAdjustmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("pending");
  const [editing, setEditing] = useState<PayAdjustmentRow | null>(null);
  const [actionType, setActionType] = useState<"APPROVED" | "REJECTED" | "EDIT_AMOUNT">("APPROVED");
  const [approvedAmount, setApprovedAmount] = useState("");
  const [adminNote, setAdminNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [sendToClientFor, setSendToClientFor] = useState<PayAdjustmentRow | null>(null);
  const [sendClientAmount, setSendClientAmount] = useState("");
  const [sendClientTitle, setSendClientTitle] = useState("");
  const [sendClientDescription, setSendClientDescription] = useState("");
  const [sendingClientApproval, setSendingClientApproval] = useState(false);
  const [reversingClientApprovalId, setReversingClientApprovalId] = useState<string | null>(null);
  const [detailRow, setDetailRow] = useState<PayAdjustmentRow | null>(null);
  const [linkPropertyFor, setLinkPropertyFor] = useState<PayAdjustmentRow | null>(null);
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [linkPropertyId, setLinkPropertyId] = useState<string>("__none__");
  const [linkTitle, setLinkTitle] = useState("");
  const [savingLink, setSavingLink] = useState(false);
  // Full request edit (amount/type/reason) — works at any status.
  const [editRequestFor, setEditRequestFor] = useState<PayAdjustmentRow | null>(null);
  const [editType, setEditType] = useState<"HOURLY" | "FIXED">("FIXED");
  const [editTitle, setEditTitle] = useState("");
  const [editHours, setEditHours] = useState("");
  const [editRate, setEditRate] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editReason, setEditReason] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  // Reverse a previous decision back to pending (or flip approved<->rejected).
  const [reverseFor, setReverseFor] = useState<PayAdjustmentRow | null>(null);
  const [reverseTarget, setReverseTarget] = useState<"PENDING" | "APPROVED" | "REJECTED">("PENDING");
  const [reverseNote, setReverseNote] = useState("");
  const [reverseAmount, setReverseAmount] = useState("");
  const [savingReverse, setSavingReverse] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/admin/pay-adjustments", { cache: "no-store" });
    const body = await res.json().catch(() => []);
    setRows(Array.isArray(body) ? body : []);
    setLoading(false);
  }

  async function loadProperties() {
    if (properties.length > 0) return;
    const res = await fetch("/api/admin/properties");
    const body = await res.json().catch(() => []);
    setProperties(Array.isArray(body) ? body : []);
  }

  function openLinkProperty(row: PayAdjustmentRow) {
    setLinkPropertyFor(row);
    setLinkPropertyId(row.property?.id ?? "__none__");
    setLinkTitle(row.title ?? "");
    loadProperties();
  }

  async function saveLink() {
    if (!linkPropertyFor) return;
    setSavingLink(true);
    const payload: Record<string, unknown> = {
      title: linkTitle.trim() || undefined,
      propertyId: linkPropertyId === "__none__" ? null : linkPropertyId,
    };
    const res = await fetch(`/api/admin/pay-adjustments/${linkPropertyFor.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    setSavingLink(false);
    if (!res.ok) {
      toast({ title: "Update failed", description: body.error ?? "Could not update.", variant: "destructive" });
      return;
    }
    toast({ title: "Request updated" });
    setLinkPropertyFor(null);
    await load();
  }

  useEffect(() => {
    load();
  }, []);

  const pendingRows = useMemo(() => rows.filter((row) => row.status === "PENDING"), [rows]);
  const list = activeTab === "pending" ? pendingRows : rows;

  function openApprove(row: PayAdjustmentRow) {
    setEditing(row);
    setActionType("APPROVED");
    setApprovedAmount(String(Number(getPrimaryAmount(row)).toFixed(2)));
    setAdminNote("");
  }

  function openReject(row: PayAdjustmentRow) {
    setEditing(row);
    setActionType("REJECTED");
    setApprovedAmount("");
    setAdminNote("");
  }

  function openEditAmount(row: PayAdjustmentRow) {
    setEditing(row);
    setActionType("EDIT_AMOUNT");
    setApprovedAmount(String(Number(row.approvedAmount ?? getPrimaryAmount(row)).toFixed(2)));
    setAdminNote("");
  }

  function openSendToClient(row: PayAdjustmentRow) {
    setSendToClientFor(row);
    setSendClientAmount(String(Number(row.clientRequestedAmount ?? row.requestedAmount ?? 0).toFixed(2)));
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
    const confirmed = window.confirm(
      `Send this pay request to the client for ${formatMoney(amount)} approval?\n\nThis will appear in the client portal and notify the client.`
    );
    if (!confirmed) return;
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

  async function reverseClientApproval(row: PayAdjustmentRow) {
    if (!row.clientApproval) return;
    const confirmed = window.confirm(
      "Reverse this client approval request?\n\nIt will be removed from the client portal. You can send it again later if needed."
    );
    if (!confirmed) return;
    setReversingClientApprovalId(row.id);
    const res = await fetch(`/api/admin/pay-adjustments/${row.id}/send-to-client`, {
      method: "DELETE",
    });
    const body = await res.json().catch(() => ({}));
    setReversingClientApprovalId(null);
    if (!res.ok) {
      toast({
        title: "Could not reverse client approval",
        description: body.error ?? "Request failed.",
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Client approval reversed", description: "The request was removed from the client portal." });
    await load();
  }

  async function submitReview() {
    if (!editing) return;
    if (actionType === "APPROVED" || actionType === "EDIT_AMOUNT") {
      const amount = Number(approvedAmount || 0);
      if (!Number.isFinite(amount) || amount <= 0) {
        toast({ title: "A valid amount greater than zero is required.", variant: "destructive" });
        return;
      }
    }

    setSaving(true);
    const payload: Record<string, unknown> = {
      adminNote: adminNote.trim() || undefined,
    };
    if (actionType === "EDIT_AMOUNT") {
      // Amount-only edit on an already-approved request — no status change.
      payload.approvedAmount = Number(approvedAmount);
    } else {
      payload.status = actionType;
      if (actionType === "APPROVED") {
        payload.approvedAmount = Number(approvedAmount);
      }
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
    toast({
      title:
        actionType === "APPROVED"
          ? "Request approved"
          : actionType === "EDIT_AMOUNT"
          ? "Approved amount updated"
          : "Request rejected",
    });
    setEditing(null);
    await load();
  }

  function openEditRequest(row: PayAdjustmentRow) {
    setEditRequestFor(row);
    setEditType(row.type);
    setEditTitle(row.title ?? "");
    setEditHours(row.requestedHours != null ? String(row.requestedHours) : "");
    setEditRate(row.requestedRate != null ? String(row.requestedRate) : "");
    setEditAmount(String(Number(row.cleanerRequestedAmount ?? row.requestedAmount ?? 0).toFixed(2)));
    setEditReason("");
  }

  async function submitEditRequest() {
    if (!editRequestFor) return;
    const payload: Record<string, unknown> = { type: editType };
    if (editTitle.trim()) payload.title = editTitle.trim();
    if (editReason.trim()) payload.adminNote = editReason.trim();
    if (editType === "HOURLY") {
      const hours = Number(editHours || 0);
      const rate = Number(editRate || 0);
      if (!Number.isFinite(hours) || hours <= 0) {
        toast({ title: "Enter valid hours.", variant: "destructive" });
        return;
      }
      if (!Number.isFinite(rate) || rate <= 0) {
        toast({ title: "Enter a valid rate.", variant: "destructive" });
        return;
      }
      payload.requestedHours = hours;
      payload.requestedRate = rate;
    } else {
      const amount = Number(editAmount || 0);
      if (!Number.isFinite(amount) || amount <= 0) {
        toast({ title: "Enter a valid amount.", variant: "destructive" });
        return;
      }
      payload.requestedAmount = amount;
      payload.requestedHours = null;
      payload.requestedRate = null;
    }
    setSavingEdit(true);
    const res = await fetch(`/api/admin/pay-adjustments/${editRequestFor.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    setSavingEdit(false);
    if (!res.ok) {
      toast({ title: "Update failed", description: body.error ?? "Could not update request.", variant: "destructive" });
      return;
    }
    toast({ title: "Request updated", description: "The cleaner and client now see the new values." });
    setEditRequestFor(null);
    await load();
  }

  function openReverse(row: PayAdjustmentRow) {
    setReverseFor(row);
    // Default action: send an actioned request back to pending.
    setReverseTarget(row.status === "PENDING" ? "APPROVED" : "PENDING");
    setReverseNote("");
    setReverseAmount(String(Number(row.approvedAmount ?? getPrimaryAmount(row)).toFixed(2)));
  }

  async function submitReverse() {
    if (!reverseFor) return;
    if (reverseTarget === reverseFor.status) {
      toast({ title: "Pick a different status to change to.", variant: "destructive" });
      return;
    }
    const payload: Record<string, unknown> = { status: reverseTarget };
    if (reverseNote.trim()) payload.adminNote = reverseNote.trim();
    if (reverseTarget === "APPROVED") {
      const amount = Number(reverseAmount || 0);
      if (!Number.isFinite(amount) || amount <= 0) {
        toast({ title: "A valid approved amount is required.", variant: "destructive" });
        return;
      }
      payload.approvedAmount = amount;
    }
    const verb =
      reverseTarget === "PENDING"
        ? "set this request back to PENDING"
        : reverseTarget === "APPROVED"
        ? "change this request to APPROVED"
        : "change this request to REJECTED";
    if (
      !window.confirm(
        `This will ${verb}. The change updates immediately for the cleaner${
          reverseFor.status === "APPROVED" && reverseTarget !== "APPROVED" ? " and removes it from payroll" : ""
        }. Continue?`
      )
    ) {
      return;
    }
    setSavingReverse(true);
    const res = await fetch(`/api/admin/pay-adjustments/${reverseFor.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    setSavingReverse(false);
    if (!res.ok) {
      toast({ title: "Could not change status", description: body.error ?? "Request failed.", variant: "destructive" });
      return;
    }
    toast({ title: `Request changed to ${reverseTarget}` });
    setReverseFor(null);
    await load();
  }

  async function deleteRequest(row: PayAdjustmentRow) {
    if (row.status === "APPROVED") {
      toast({
        title: "Cannot delete an approved request",
        description: "Reverse it back to pending first, then delete.",
        variant: "destructive",
      });
      return;
    }
    if (
      !window.confirm(
        "Delete this pay request permanently? This removes it for the cleaner and the client. This cannot be undone."
      )
    ) {
      return;
    }
    setDeletingId(row.id);
    const res = await fetch(`/api/admin/pay-adjustments/${row.id}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    setDeletingId(null);
    if (!res.ok) {
      toast({ title: "Delete failed", description: body.error ?? "Could not delete request.", variant: "destructive" });
      return;
    }
    toast({ title: "Request deleted" });
    await load();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<HandCoins />}
        title="Extra Payment Requests"
        description="Review cleaner hourly/fixed extra payment requests."
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
                            ? `Date: ${formatDateSafe(row.job.scheduledDate)} | `
                            : ""}
                          {row.job?.property?.name || row.property?.name || "No property linked"} | Requested: {formatMoney(getPrimaryAmount(row))}
                          {row.type === "HOURLY" ? ` (${row.requestedHours ?? 0}h x ${formatMoney(row.requestedRate)})` : ""} | {row.scope}
                        </p>
                        {row.clientRequestedAmount != null ? (
                          <p className="text-xs text-muted-foreground">
                            Cleaner requested: {formatMoney(row.cleanerRequestedAmount ?? row.requestedAmount)} | Client amount: {formatMoney(row.clientRequestedAmount)}
                          </p>
                        ) : null}
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
                        <Button size="sm" variant="outline" onClick={() => setDetailRow(row)}>
                          View details
                        </Button>
                        {row.scope === "STANDALONE" ? (
                          <Button size="sm" variant="outline" onClick={() => openLinkProperty(row)}>
                            {row.property ? "Re-link" : "Link property"}
                          </Button>
                        ) : null}
                        <Button size="sm" variant="outline" onClick={() => openEditRequest(row)}>
                          Edit
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => openReverse(row)}>
                          {row.status === "PENDING" ? "Change status" : "Reverse"}
                        </Button>
                        {row.status !== "REJECTED" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openSendToClient(row)}
                            disabled={row.clientApproval?.status === "PENDING"}
                          >
                            {row.clientApproval?.status === "PENDING" ? "Client Pending" : "Send to Client"}
                          </Button>
                        ) : null}
                        {row.clientApproval ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => reverseClientApproval(row)}
                            disabled={reversingClientApprovalId === row.id}
                            className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
                          >
                            {reversingClientApprovalId === row.id ? "Reversing..." : "Reverse client send"}
                          </Button>
                        ) : null}
                        {row.status === "PENDING" ? (
                          <>
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
                        {row.status === "APPROVED" ? (
                          <Button size="sm" variant="outline" onClick={() => openEditAmount(row)}>
                            Edit amount
                          </Button>
                        ) : null}
                        {row.status !== "APPROVED" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => deleteRequest(row)}
                            disabled={deletingId === row.id}
                            className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
                          >
                            {deletingId === row.id ? "Deleting..." : "Delete"}
                          </Button>
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
            <DialogTitle>
              {actionType === "APPROVED"
                ? "Approve request"
                : actionType === "EDIT_AMOUNT"
                ? "Edit approved amount"
                : "Reject request"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {actionType === "APPROVED" &&
            editing?.clientApproval &&
            editing.clientApproval.status !== "APPROVED" ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                Client approval status is {editing.clientApproval.status}. You can approve cleaner payment only after client approval.
              </div>
            ) : null}
            {actionType === "EDIT_AMOUNT" && editing ? (
              <div className="rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground">
                Currently approved: {formatMoney(editing.approvedAmount)}. Updating this will re-notify the
                cleaner of the revised amount.
              </div>
            ) : null}
            {actionType === "APPROVED" || actionType === "EDIT_AMOUNT" ? (
              <div className="space-y-1.5">
                <Label>{actionType === "EDIT_AMOUNT" ? "New approved amount" : "Approved amount"}</Label>
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
              {saving
                ? "Saving..."
                : actionType === "APPROVED"
                ? "Approve Request"
                : actionType === "EDIT_AMOUNT"
                ? "Update Amount"
                : "Reject Request"}
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

      <Dialog open={Boolean(linkPropertyFor)} onOpenChange={(open) => !open && setLinkPropertyFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link property to request</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input
                value={linkTitle}
                onChange={(e) => setLinkTitle(e.target.value)}
                placeholder="e.g. Extra cleaning supplies"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Property</Label>
              <Select value={linkPropertyId} onValueChange={setLinkPropertyId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select property..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No property</SelectItem>
                  {properties.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} — {p.suburb}
                      {p.client?.name ? ` (${p.client.name})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {linkPropertyId !== "__none__" && properties.find((p) => p.id === linkPropertyId)?.client?.name ? (
                <p className="text-xs text-muted-foreground">
                  Client: {properties.find((p) => p.id === linkPropertyId)?.client?.name}
                </p>
              ) : null}
            </div>
            <Button className="w-full" onClick={saveLink} disabled={savingLink}>
              {savingLink ? "Saving..." : "Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editRequestFor)} onOpenChange={(open) => !open && setEditRequestFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit request</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Editing updates the single shared record. The cleaner and client (if sent) see the new values on
              their next load.
            </p>
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={editType} onValueChange={(value) => setEditType(value as "HOURLY" | "FIXED")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="HOURLY">Hourly</SelectItem>
                  <SelectItem value="FIXED">Fixed amount</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {editType === "HOURLY" ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label>Hours</Label>
                  <Input type="number" min={0} step="0.25" value={editHours} onChange={(e) => setEditHours(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Rate</Label>
                  <Input type="number" min={0} step="0.01" value={editRate} onChange={(e) => setEditRate(e.target.value)} />
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>Amount</Label>
                <Input type="number" min={0} step="0.01" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Reason / admin note (optional)</Label>
              <Textarea value={editReason} onChange={(e) => setEditReason(e.target.value)} />
            </div>
            {editRequestFor?.status === "APPROVED" ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                This request is approved. Editing the requested values here does not change the approved amount
                that feeds payroll — use "Edit amount" for that, or "Reverse" to send it back to pending.
              </div>
            ) : null}
            <Button className="w-full" onClick={submitEditRequest} disabled={savingEdit}>
              {savingEdit ? "Saving..." : "Save changes"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(reverseFor)} onOpenChange={(open) => !open && setReverseFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{reverseFor?.status === "PENDING" ? "Change status" : "Reverse decision"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Change this request's status at any time — even after it was sent. Reversing an approved request
              back to pending removes it from payroll automatically.
            </p>
            <div className="space-y-1.5">
              <Label>New status</Label>
              <Select value={reverseTarget} onValueChange={(value) => setReverseTarget(value as "PENDING" | "APPROVED" | "REJECTED")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="APPROVED">Approved</SelectItem>
                  <SelectItem value="REJECTED">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {reverseTarget === "APPROVED" ? (
              <div className="space-y-1.5">
                <Label>Approved amount</Label>
                <Input type="number" min={0} step="0.01" value={reverseAmount} onChange={(e) => setReverseAmount(e.target.value)} />
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label>Audit note (optional)</Label>
              <Textarea value={reverseNote} onChange={(e) => setReverseNote(e.target.value)} />
            </div>
            <Button className="w-full" onClick={submitReverse} disabled={savingReverse}>
              {savingReverse ? "Saving..." : "Apply status change"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(detailRow)} onOpenChange={(open) => !open && setDetailRow(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Extra Pay Request Details</DialogTitle>
          </DialogHeader>
          {detailRow ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Request title</p>
                  <p className="text-sm font-medium">{detailRow.title || "Pay request"}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Status</p>
                  <div className="mt-1">
                    <Badge variant={detailRow.status === "PENDING" ? ("warning" as any) : detailRow.status === "APPROVED" ? "success" : "destructive"}>
                      {detailRow.status}
                    </Badge>
                  </div>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Scope and type</p>
                  <p className="text-sm font-medium">{detailRow.scope} / {detailRow.type}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Primary displayed amount</p>
                  <p className="text-sm font-medium">{formatMoney(getPrimaryAmount(detailRow))}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {detailRow.primaryDisplayAmountSource === "CLIENT_REQUESTED" ? "Client-facing amount" : "Cleaner-requested amount"}
                  </p>
                  {detailRow.type === "HOURLY" ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {detailRow.requestedHours ?? 0}h x {formatMoney(detailRow.requestedRate)}
                    </p>
                  ) : null}
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Cleaner requested amount</p>
                  <p className="text-sm font-medium">{formatMoney(detailRow.cleanerRequestedAmount ?? detailRow.requestedAmount)}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Client requested amount</p>
                  <p className="text-sm font-medium">
                    {detailRow.clientRequestedAmount != null ? formatMoney(detailRow.clientRequestedAmount) : "-"}
                  </p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Requested on</p>
                  <p className="text-sm font-medium">{formatDateTimeSafe(detailRow.requestedAt)}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Approved amount</p>
                  <p className="text-sm font-medium">{formatMoney(detailRow.approvedAmount)}</p>
                </div>
              </div>

              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Cleaner</p>
                <p className="text-sm font-medium">{detailRow.cleaner.name ?? detailRow.cleaner.email}</p>
                <p className="text-xs text-muted-foreground">{detailRow.cleaner.email}</p>
              </div>

              {(detailRow.job || detailRow.property) ? (
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Linked property</p>
                  <p className="text-sm font-medium">
                    {detailRow.job?.property?.name ?? detailRow.property?.name ?? "No property linked"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {detailRow.job?.property?.suburb ?? detailRow.property?.suburb ?? ""}
                  </p>
                  {detailRow.job ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Job date: {formatDateSafe(detailRow.job.scheduledDate)} | {detailRow.job.jobType.replace(/_/g, " ")}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {detailRow.cleanerNote ? (
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Cleaner note</p>
                  <p className="text-sm whitespace-pre-wrap">{detailRow.cleanerNote}</p>
                </div>
              ) : null}

              {detailRow.adminNote ? (
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Admin note</p>
                  <p className="text-sm whitespace-pre-wrap">{detailRow.adminNote}</p>
                </div>
              ) : null}

              {detailRow.clientApproval ? (
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Client approval</p>
                  <p className="text-sm font-medium">
                    {detailRow.clientApproval.status} - {detailRow.clientApproval.currency} {detailRow.clientApproval.amount.toFixed(2)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Requested {formatDateTimeSafe(detailRow.clientApproval.requestedAt)}
                    {detailRow.clientApproval.respondedAt
                      ? ` | Responded ${formatDateTimeSafe(detailRow.clientApproval.respondedAt)}`
                      : ""}
                  </p>
                </div>
              ) : null}

              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Attachments</p>
                <MediaGallery
                  items={(detailRow.attachmentUrls ?? []).map((item) => ({
                    id: item.key,
                    url: item.url,
                    label: "Pay request evidence",
                    mediaType: "PHOTO",
                  }))}
                  emptyText="No images attached"
                  title="Pay request attachment"
                />
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
