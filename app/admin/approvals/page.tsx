"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { CheckCircle2, Plus, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";

type ClientRow = {
  id: string;
  name: string;
  email: string | null;
};

type PropertyRow = {
  id: string;
  clientId: string;
  name: string;
  suburb: string;
};

type ApprovalRow = {
  id: string;
  clientId: string;
  title: string;
  description: string;
  amount: number;
  currency: string;
  status: "PENDING" | "APPROVED" | "DECLINED" | "CANCELLED" | "EXPIRED";
  requestedAt: string;
  expiresAt: string | null;
  client: { id: string; name: string; email: string | null } | null;
  property: { id: string; name: string; suburb: string } | null;
  responseNote: string | null;
};

export default function AdminApprovalsPage() {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [rows, setRows] = useState<ApprovalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    clientId: "",
    propertyId: "",
    title: "",
    description: "",
    amount: "0",
    currency: "AUD",
    expiresAt: "",
  });

  const filteredProperties = useMemo(
    () => properties.filter((property) => property.clientId === form.clientId),
    [properties, form.clientId]
  );

  async function loadAll() {
    setLoading(true);
    const [clientsRes, propertiesRes, approvalsRes] = await Promise.all([
      fetch("/api/admin/clients"),
      fetch("/api/admin/properties"),
      fetch("/api/admin/client-approvals"),
    ]);
    const [clientsBody, propertiesBody, approvalsBody] = await Promise.all([
      clientsRes.json().catch(() => []),
      propertiesRes.json().catch(() => []),
      approvalsRes.json().catch(() => []),
    ]);
    setClients(Array.isArray(clientsBody) ? clientsBody : []);
    setProperties(Array.isArray(propertiesBody) ? propertiesBody : []);
    setRows(Array.isArray(approvalsBody) ? approvalsBody : []);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function createApproval() {
    if (!form.clientId || !form.title.trim()) {
      toast({
        title: "Missing fields",
        description: "Client and title are required.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    const payload = {
      clientId: form.clientId,
      propertyId: form.propertyId || null,
      title: form.title.trim(),
      description: form.description.trim(),
      amount: Number(form.amount || 0),
      currency: form.currency.trim() || "AUD",
      expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
    };
    const res = await fetch("/api/admin/client-approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      toast({
        title: "Create failed",
        description: body.error ?? "Could not create approval request.",
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Approval request created" });
    setForm((prev) => ({
      ...prev,
      propertyId: "",
      title: "",
      description: "",
      amount: "0",
      expiresAt: "",
    }));
    await loadAll();
  }

  async function updateStatus(id: string, status: ApprovalRow["status"]) {
    setUpdatingId(id);
    const res = await fetch(`/api/admin/client-approvals/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const body = await res.json().catch(() => ({}));
    setUpdatingId(null);
    if (!res.ok) {
      toast({
        title: "Update failed",
        description: body.error ?? "Could not update approval status.",
        variant: "destructive",
      });
      return;
    }
    await loadAll();
  }

  async function deleteApproval(id: string) {
    if (!window.confirm("Delete this approval request?")) return;
    setUpdatingId(id);
    const res = await fetch(`/api/admin/client-approvals/${id}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    setUpdatingId(null);
    if (!res.ok) {
      toast({
        title: "Delete failed",
        description: body.error ?? "Could not delete approval.",
        variant: "destructive",
      });
      return;
    }
    await loadAll();
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Client Approval Queue</h2>
        <p className="text-sm text-muted-foreground">
          Track extras and decisions before billing.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Create Approval Request</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="text-xs text-muted-foreground">Client</label>
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={form.clientId}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    clientId: event.target.value,
                    propertyId: "",
                  }))
                }
              >
                <option value="">Select client</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Property (optional)</label>
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={form.propertyId}
                onChange={(event) => setForm((prev) => ({ ...prev, propertyId: event.target.value }))}
                disabled={!form.clientId}
              >
                <option value="">None</option>
                {filteredProperties.map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.name} ({property.suburb})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-[1fr_140px_120px_180px]">
            <div>
              <label className="text-xs text-muted-foreground">Title</label>
              <Input
                value={form.title}
                onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                placeholder="Extra service approval"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Amount</label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={form.amount}
                onChange={(event) => setForm((prev) => ({ ...prev, amount: event.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Currency</label>
              <Input
                value={form.currency}
                onChange={(event) => setForm((prev) => ({ ...prev, currency: event.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Expires at (optional)</label>
              <Input
                type="datetime-local"
                value={form.expiresAt}
                onChange={(event) => setForm((prev) => ({ ...prev, expiresAt: event.target.value }))}
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground">Description</label>
            <Textarea
              rows={3}
              value={form.description}
              onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
              placeholder="Explain why approval is required..."
            />
          </div>

          <div className="flex justify-end">
            <Button onClick={createApproval} disabled={saving}>
              <Plus className="mr-2 h-4 w-4" />
              {saving ? "Creating..." : "Create request"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Approval Requests</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading approvals...</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No approval requests found.</p>
          ) : (
            <div className="space-y-3">
              {rows.map((row) => (
                <div key={row.id} className="rounded-lg border p-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{row.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.client?.name ?? "Unknown client"}
                        {row.property ? ` • ${row.property.name}` : ""}
                        {" • "}
                        {row.currency} {row.amount.toFixed(2)}
                      </p>
                    </div>
                    <Badge
                      variant={
                        row.status === "APPROVED"
                          ? "success"
                          : row.status === "DECLINED"
                            ? "destructive"
                            : row.status === "PENDING"
                              ? ("warning" as any)
                              : "secondary"
                      }
                    >
                      {row.status}
                    </Badge>
                  </div>

                  {row.description ? <p className="mt-2">{row.description}</p> : null}
                  <p className="mt-2 text-xs text-muted-foreground">
                    Requested: {format(new Date(row.requestedAt), "dd MMM yyyy HH:mm")}
                    {row.expiresAt
                      ? ` • Expires: ${format(new Date(row.expiresAt), "dd MMM yyyy HH:mm")}`
                      : ""}
                  </p>
                  {row.responseNote ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Response note: {row.responseNote}
                    </p>
                  ) : null}

                  <div className="mt-3 flex flex-wrap gap-2">
                    {row.status === "PENDING" ? (
                      <>
                        <Button
                          size="sm"
                          disabled={updatingId === row.id}
                          onClick={() => updateStatus(row.id, "APPROVED")}
                        >
                          <CheckCircle2 className="mr-2 h-4 w-4" />
                          Mark approved
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={updatingId === row.id}
                          onClick={() => updateStatus(row.id, "DECLINED")}
                        >
                          <XCircle className="mr-2 h-4 w-4" />
                          Mark declined
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={updatingId === row.id}
                          onClick={() => updateStatus(row.id, "CANCELLED")}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      disabled={updatingId === row.id}
                      onClick={() => deleteApproval(row.id)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
