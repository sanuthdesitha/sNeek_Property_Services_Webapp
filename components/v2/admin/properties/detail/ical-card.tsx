"use client";

/**
 * Rail card "Calendar sync (iCal)": enable switch, iCal URL, the sync state,
 * Save and Sync now, and the recent runs with Undo. Same endpoints as before
 * (PATCH / POST /integration, POST /integration/undo). The URL draft survives
 * a failed save; the controls are frozen while a request runs.
 */
import { useEffect, useRef, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { EInput, ESwitch } from "@/components/v2/admin/estate-kit";
import { historyStamp } from "@/lib/properties/portfolio-format";
import { CardHead, Muted } from "./section-card";
import type { PropertyRecord, SyncRunRecord } from "./property-record";

const STATUS_PILL: Record<string, { text: string; tone: "ok" | "bad" | "info" | "neutral" }> = {
  SUCCESS: { text: "Synced", tone: "ok" },
  ERROR: { text: "Failed", tone: "bad" },
  SYNCING: { text: "Syncing", tone: "info" },
  IDLE: { text: "Not synced yet", tone: "neutral" },
};

function runSummary(run: SyncRunRecord): string {
  const summary = run.summary;
  if (!summary) return "";
  const changed = (summary.reservationsCreated ?? 0) + (summary.reservationsUpdated ?? 0);
  return ` · ${changed} ${changed === 1 ? "booking" : "bookings"} changed`;
}

export function IcalCard({
  property,
  timeZone,
  syncing,
  onSync,
  onChanged,
}: {
  property: PropertyRecord;
  timeZone: string;
  syncing: boolean;
  onSync: () => void;
  onChanged: () => void;
}) {
  const integration = property.integration;
  const [url, setUrl] = useState(integration?.icalUrl ?? "");
  const [enabled, setEnabled] = useState(integration?.isEnabled ?? false);
  const [saving, setSaving] = useState(false);
  const [undoingId, setUndoingId] = useState<string | null>(null);
  const runs = Array.isArray(integration?.syncRuns) ? integration.syncRuns : [];
  const status = integration?.syncStatus ? STATUS_PILL[integration.syncStatus] ?? STATUS_PILL.IDLE : null;
  const latest = runs[0] ?? null;

  // A newer property record (after a save or sync) replaces the draft only when nothing is being edited.
  const saved = useRef({ url: integration?.icalUrl ?? "", enabled: integration?.isEnabled ?? false });
  useEffect(() => {
    const next = { url: integration?.icalUrl ?? "", enabled: integration?.isEnabled ?? false };
    setUrl((draft) => (draft === saved.current.url ? next.url : draft));
    setEnabled((draft) => (draft === saved.current.enabled ? next.enabled : draft));
    saved.current = next;
  }, [integration?.icalUrl, integration?.isEnabled]);

  async function save() {
    setSaving(true);
    try {
      const response = await fetch(`/api/admin/properties/${property.id}/integration`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ icalUrl: url || null, isEnabled: enabled }),
      });
      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as { error?: string };
        toast({ title: "Save failed", description: error.error ?? "Could not save integration.", variant: "destructive" });
        return;
      }
      toast({ title: "Integration saved" });
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  async function undo(runId: string) {
    setUndoingId(runId);
    try {
      const response = await fetch(`/api/admin/properties/${property.id}/integration/undo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        toast({ title: "Undo failed", description: body.error ?? "Could not undo sync run.", variant: "destructive" });
        return;
      }
      toast({ title: "Sync reverted" });
      onChanged();
    } finally {
      setUndoingId(null);
    }
  }

  const busy = saving || syncing || undoingId !== null;
  return (
    <ECard id="calendar-sync" className="flex scroll-mt-4 flex-col gap-2 p-4">
      <CardHead title="Calendar sync (iCal)" action={<ESwitch checked={enabled} disabled={busy} onCheckedChange={setEnabled} label={<span className="sr-only">Calendar sync enabled</span>} />} />
      <EInput aria-label="iCal URL" placeholder="https://…" value={url} disabled={busy} onChange={(event) => setUrl(event.target.value)} />
      <div className="flex flex-wrap items-center gap-2 text-[0.75rem]">
        {status ? <EPill tone={status.tone}>{status.text}</EPill> : <Muted>Not linked</Muted>}
        {latest ? <Muted>{historyStamp(latest.createdAt, timeZone)}{runSummary(latest)}</Muted> : null}
      </div>
      {integration?.syncStatus === "ERROR" && integration.syncError ? <p role="alert" className="text-[0.75rem] text-[hsl(var(--e-danger))]">{integration.syncError}</p> : null}
      <div className="flex flex-wrap gap-2">
        <EButton size="sm" variant="outline" onClick={save} disabled={busy}>{saving ? "Saving…" : "Save"}</EButton>
        <EButton size="sm" onClick={onSync} disabled={busy || !integration?.isEnabled || !integration.icalUrl}>{syncing ? "Syncing…" : "Sync now"}</EButton>
      </div>
      {runs.length > 0 ? (
        <ul aria-label="Recent runs" className="flex flex-col gap-1">
          {runs.map((run) => (
            <li key={run.id} className="flex items-center justify-between gap-2 text-[0.75rem]">
              <Muted>
                {historyStamp(run.createdAt, timeZone)} · {run.status.toLowerCase()}{run.revertedAt ? " · reverted" : ""}
              </Muted>
              {!run.revertedAt ? (
                <EButton size="sm" variant="ghost" disabled={busy} onClick={() => undo(run.id)}>{undoingId === run.id ? "Undoing…" : "Undo"}</EButton>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </ECard>
  );
}
