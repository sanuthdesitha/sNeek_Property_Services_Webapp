"use client";

import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";

type DeliveryRow = {
  client: { id: string; name: string; email: string | null };
  profile: {
    clientId: string;
    reportRecipients: string[];
    invoiceRecipients: string[];
    autoSendReports: boolean;
    autoSendInvoices: boolean;
    updatedAt: string | null;
  };
};

type DraftRow = {
  reportRecipients: string;
  invoiceRecipients: string;
  autoSendReports: boolean;
  autoSendInvoices: boolean;
};

function csvToEmails(value: string) {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

export default function DeliveryProfilesPage() {
  const [rows, setRows] = useState<DeliveryRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DraftRow>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  async function loadRows() {
    setLoading(true);
    const res = await fetch("/api/admin/client-delivery-profiles");
    const body = await res.json().catch(() => []);
    const records = Array.isArray(body) ? (body as DeliveryRow[]) : [];
    setRows(records);
    setDrafts(
      Object.fromEntries(
        records.map((row) => [
          row.client.id,
          {
            reportRecipients: row.profile.reportRecipients.join(", "),
            invoiceRecipients: row.profile.invoiceRecipients.join(", "),
            autoSendReports: row.profile.autoSendReports,
            autoSendInvoices: row.profile.autoSendInvoices,
          },
        ])
      )
    );
    setLoading(false);
  }

  useEffect(() => {
    loadRows();
  }, []);

  async function save(clientId: string) {
    const draft = drafts[clientId];
    if (!draft) return;
    setSavingId(clientId);
    const res = await fetch("/api/admin/client-delivery-profiles", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId,
        reportRecipients: csvToEmails(draft.reportRecipients),
        invoiceRecipients: csvToEmails(draft.invoiceRecipients),
        autoSendReports: draft.autoSendReports,
        autoSendInvoices: draft.autoSendInvoices,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setSavingId(null);
    if (!res.ok) {
      toast({
        title: "Save failed",
        description: body.error ?? "Could not save delivery profile.",
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Delivery profile updated" });
    await loadRows();
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Client Delivery Profiles</h2>
        <p className="text-sm text-muted-foreground">
          Configure default recipients and auto-send behavior for reports and invoices.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Per-client Delivery Preferences</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading profiles...</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No clients found.</p>
          ) : (
            rows.map((row) => {
              const draft = drafts[row.client.id];
              if (!draft) return null;
              return (
                <div key={row.client.id} className="rounded-lg border p-3">
                  <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{row.client.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Default email: {row.client.email || "None"}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => save(row.client.id)}
                      disabled={savingId === row.client.id}
                    >
                      <Save className="mr-2 h-4 w-4" />
                      {savingId === row.client.id ? "Saving..." : "Save"}
                    </Button>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <label className="text-xs text-muted-foreground">Report recipients</label>
                      <Input
                        value={draft.reportRecipients}
                        onChange={(event) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [row.client.id]: {
                              ...prev[row.client.id],
                              reportRecipients: event.target.value,
                            },
                          }))
                        }
                        placeholder="client@example.com, ops@example.com"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Invoice recipients</label>
                      <Input
                        value={draft.invoiceRecipients}
                        onChange={(event) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [row.client.id]: {
                              ...prev[row.client.id],
                              invoiceRecipients: event.target.value,
                            },
                          }))
                        }
                        placeholder="billing@example.com"
                      />
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-5 text-sm">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={draft.autoSendReports}
                        onChange={(event) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [row.client.id]: {
                              ...prev[row.client.id],
                              autoSendReports: event.target.checked,
                            },
                          }))
                        }
                      />
                      Auto-send reports
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={draft.autoSendInvoices}
                        onChange={(event) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [row.client.id]: {
                              ...prev[row.client.id],
                              autoSendInvoices: event.target.checked,
                            },
                          }))
                        }
                      />
                      Auto-send invoices
                    </label>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
