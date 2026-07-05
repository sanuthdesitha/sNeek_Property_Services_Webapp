"use client";

/**
 * Estate-native client delivery profiles editor. Same endpoint + payload the v1
 * DeliveryProfilesWorkspace uses:
 *   GET   /api/admin/client-delivery-profiles  → [{ client, profile }]
 *   PATCH /api/admin/client-delivery-profiles  { clientId, reportRecipients[],
 *              invoiceRecipients[], autoSendReports, autoSendInvoices }
 * Per-client upsert of report/invoice recipients + auto-send behaviour.
 */
import * as React from "react";
import { Loader2, Save, Search, Mail, FileText, Send } from "lucide-react";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEmptyState,
} from "@/components/v2/ui/primitives";
import { EField, EInput, ESwitch } from "@/components/v2/admin/estate-kit";
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

function csvToEmails(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

export function EstateDeliveryProfiles() {
  const [rows, setRows] = React.useState<DeliveryRow[]>([]);
  const [drafts, setDrafts] = React.useState<Record<string, DraftRow>>({});
  const [loading, setLoading] = React.useState(true);
  const [savingId, setSavingId] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/client-delivery-profiles", { cache: "no-store" });
      const body = await res.json().catch(() => []);
      if (!res.ok) {
        toast({
          title: "Could not load delivery profiles",
          description: (body as any)?.error ?? "Retry.",
          variant: "destructive",
        });
        return;
      }
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
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  function patchDraft(clientId: string, patch: Partial<DraftRow>) {
    setDrafts((prev) => ({ ...prev, [clientId]: { ...prev[clientId], ...patch } }));
  }

  async function save(clientId: string) {
    const draft = drafts[clientId];
    if (!draft) return;
    setSavingId(clientId);
    try {
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
      if (!res.ok) {
        toast({
          title: "Save failed",
          description: body.error ?? "Could not save delivery profile.",
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Delivery profile updated" });
      await load();
    } finally {
      setSavingId(null);
    }
  }

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (row) =>
        row.client.name.toLowerCase().includes(q) ||
        (row.client.email ?? "").toLowerCase().includes(q)
    );
  }, [rows, query]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-8 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading delivery profiles…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EEmptyState
        eyebrow="Delivery"
        title="No active clients"
        description="Delivery profiles appear here once you have active clients to configure."
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--e-text-faint))]" />
        <EInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search clients…"
          className="pl-9"
        />
      </div>

      {filtered.length === 0 ? (
        <EEmptyState eyebrow="Delivery" title="No matches" description="No clients match that search." />
      ) : (
        <div className="space-y-4">
          {filtered.map((row) => {
            const draft = drafts[row.client.id];
            if (!draft) return null;
            const busy = savingId === row.client.id;
            return (
              <ECard key={row.client.id}>
                <ECardHeader className="flex-row items-start justify-between gap-3">
                  <div className="min-w-0">
                    <ECardTitle>{row.client.name}</ECardTitle>
                    <p className="mt-0.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                      Default email: {row.client.email || "None"}
                    </p>
                  </div>
                  <EButton size="sm" onClick={() => void save(row.client.id)} disabled={busy}>
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    {busy ? "Saving…" : "Save"}
                  </EButton>
                </ECardHeader>
                <ECardBody className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <EField
                      label={
                        <span className="inline-flex items-center gap-1.5">
                          <FileText className="h-3.5 w-3.5" /> Report recipients
                        </span>
                      }
                      hint="Comma-separated email addresses."
                    >
                      <EInput
                        value={draft.reportRecipients}
                        onChange={(e) => patchDraft(row.client.id, { reportRecipients: e.target.value })}
                        placeholder="client@example.com, ops@example.com"
                      />
                    </EField>
                    <EField
                      label={
                        <span className="inline-flex items-center gap-1.5">
                          <Mail className="h-3.5 w-3.5" /> Invoice recipients
                        </span>
                      }
                      hint="Comma-separated email addresses."
                    >
                      <EInput
                        value={draft.invoiceRecipients}
                        onChange={(e) => patchDraft(row.client.id, { invoiceRecipients: e.target.value })}
                        placeholder="billing@example.com"
                      />
                    </EField>
                  </div>

                  <div className="flex flex-wrap items-center gap-6 border-t border-[hsl(var(--e-border))] pt-4">
                    <ESwitch
                      checked={draft.autoSendReports}
                      onCheckedChange={(v) => patchDraft(row.client.id, { autoSendReports: v })}
                      label={
                        <span className="inline-flex items-center gap-1.5">
                          <Send className="h-3.5 w-3.5" /> Auto-send reports
                        </span>
                      }
                    />
                    <ESwitch
                      checked={draft.autoSendInvoices}
                      onCheckedChange={(v) => patchDraft(row.client.id, { autoSendInvoices: v })}
                      label={
                        <span className="inline-flex items-center gap-1.5">
                          <Send className="h-3.5 w-3.5" /> Auto-send invoices
                        </span>
                      }
                    />
                    {row.profile.updatedAt ? (
                      <EBadge tone="neutral" soft className="ml-auto">
                        Updated {new Date(row.profile.updatedAt).toLocaleDateString()}
                      </EBadge>
                    ) : null}
                  </div>
                </ECardBody>
              </ECard>
            );
          })}
        </div>
      )}
    </div>
  );
}
