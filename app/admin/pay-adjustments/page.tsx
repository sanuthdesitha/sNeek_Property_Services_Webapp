"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
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
  const [actionType, setActionType] = useState<"APPROVED" | "REJECTED">("APPROVED");
  const [approvedAmount, setApprovedAmount] = useState("");
  const [adminNote, setAdminNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [sendToClientFor, setSendToClientFor] = useState<PayAdjustmentRow | null>(null);
  const [sendClientAmount, setSendClientAmount] = useState("");
  const [sendClientTitle, setSendClientTitle] = useState("");
  const [sendClientDescription, setSendClientDescription] = useState("");
  const [sendingClientApproval, setSendingClientApproval] = useState(false);
  const [detailRow, setDetailRow] = useState<PayAdjustmentRow | null>(null);
  const [linkPropertyFor, setLinkPropertyFor] = useState<PayAdjustmentRow | null>(null);
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [linkPropertyId, setLinkPropertyId] = useState<string>("__none__");
  const [linkTitle, setLinkTitle] = useState("");
  const [savingLink, setSavingLink] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/admin/pay-adjustments");
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
                            ? `Date: ${formatDateSafe(row.job.scheduledDate)} | `
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
                        <Button size="sm" variant="outline" onClick={() => setDetailRow(row)}>
                          View details
                        </Button>
                        {row.scope === "STANDALONE" ? (
                          <Button size="sm" variant="outline" onClick={() => openLinkProperty(row)}>
                            {row.property ? "Re-link" : "Link property"}
                          </Button>
                        ) : null}
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
                  <p className="text-xs text-muted-foreground">Requested amount</p>
                  <p className="text-sm font-medium">{formatMoney(detailRow.requestedAmount)}</p>
                  {detailRow.type === "HOURLY" ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {detailRow.requestedHours ?? 0}h x {formatMoney(detailRow.requestedRate)}
                    </p>
                  ) : null}
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
