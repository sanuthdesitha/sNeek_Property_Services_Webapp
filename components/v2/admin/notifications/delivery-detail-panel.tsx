"use client";

import * as React from "react";
import { ESidePanel } from "@/components/v2/ui/side-panel";
import { EPill } from "@/components/v2/ui/pill";
import { EAlert, EButton } from "@/components/v2/ui/primitives";
import { TRANSPORT_LABEL } from "@/lib/notifications/catalog-types";
import type { DeliveryLogRow } from "@/lib/notifications/delivery-log-map";
import { sendJson, useNotificationRead } from "./use-notification-read";
import { formatDeliveryTime, stateTone } from "./delivery-format";

type Detail = Record<string, unknown>;

function parseDetail(body: unknown): Detail {
  const value = body as { detail?: Detail } | null;
  if (!value?.detail || typeof value.detail !== "object") throw new Error("bad detail");
  return value.detail;
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

const RETRY_LABEL = { RETRY_KNOWN_REJECTION: "Retry this delivery", RECONCILE_INBOX: "Reconcile inbox receipt" } as const;

/** Drill-in: safe metadata only (no bodies or secrets), plus the existing safe retry where it applies. */
export function DeliveryDetailPanel({ row, readOnly, onClose, onChanged }: { row: DeliveryLogRow; readOnly: boolean; onClose: () => void; onChanged: () => void }) {
  const read = useNotificationRead(`/api/admin/notifications/deliveries?detail=${encodeURIComponent(row.id)}`, parseDetail, "Could not load this delivery.");
  const [note, setNote] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<{ tone: "success" | "danger"; text: string } | null>(null);

  async function review() {
    if (!row.retry || saving || !note.trim()) return;
    setSaving(true);
    setMessage(null);
    const result = await sendJson("/api/admin/notifications/intents", "PATCH", { id: row.retry.intentId, updatedAt: row.retry.updatedAt, action: row.retry.action, note: note.trim() });
    setSaving(false);
    if (!result.ok) {
      setMessage({ tone: "danger", text: result.error });
      return;
    }
    setMessage({ tone: "success", text: row.retry.action === "RETRY_KNOWN_REJECTION" ? "Queued for another attempt. It is not delivered yet." : "Inbox receipt reconciled." });
    onChanged();
  }

  return (
    <ESidePanel open title={row.typeName} label="Delivery details" subtitle={`${TRANSPORT_LABEL[row.transport]} · ${formatDeliveryTime(row.time)}`} onClose={onClose}
      toolbar={<EPill tone={stateTone(row.state)}>{row.stateLabel}</EPill>}>
      <div className="space-y-4 text-sm">
        <p><span className="font-medium">Recipient: </span>{row.recipientLabel}</p>
        <p><span className="font-medium">Path: </span>{row.path === "pipeline" ? "Notification pipeline" : "Direct send"}</p>
        {row.related ? <a className="underline" href={row.related.href}>Open the related {row.related.label.toLowerCase()}</a> : null}
        {read.loading && !read.data ? <p role="status">Loading details…</p> : null}
        {read.error ? <p role="alert">{read.error} <button type="button" className="underline" onClick={read.reload}>Retry</button></p> : null}
        {read.data ? (
          <dl className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs [overflow-wrap:anywhere]">
            {Object.entries(read.data).filter(([key]) => key !== "attempts").map(([key, value]) => (
              <React.Fragment key={key}><dt className="font-medium">{key}</dt><dd>{renderValue(value)}</dd></React.Fragment>
            ))}
          </dl>
        ) : null}
        {Array.isArray(read.data?.attempts) ? (
          <section aria-label="Attempts" className="space-y-1">
            <h3 className="font-semibold">Attempts</h3>
            <ol className="space-y-1 text-xs">
              {(read.data!.attempts as Array<Record<string, unknown>>).map((attempt) => (
                <li key={String(attempt.number)}>#{renderValue(attempt.number)} {renderValue(attempt.status)} {attempt.errorCode ? `· ${renderValue(attempt.errorCode)}` : ""} {attempt.providerReference ? "· provider reference recorded" : ""}</li>
              ))}
            </ol>
          </section>
        ) : null}
        <p className="text-xs text-[hsl(var(--e-muted-foreground))]">Message bodies are never shown here; codes, PINs and link tokens in subjects are masked.</p>

        {row.retry ? (
          <section aria-labelledby="delivery-retry" className="space-y-2 rounded border border-[hsl(var(--e-border))] p-3">
            <h3 id="delivery-retry" className="font-semibold">{RETRY_LABEL[row.retry.action]}</h3>
            <p className="text-xs">Uses the existing review step: only a recorded rejection below the attempt limit can be retried, and the original idempotency key is kept.</p>
            <label className="block text-xs font-medium">Investigation note
              <textarea className="mt-1 block min-h-20 w-full rounded border border-[hsl(var(--e-border))] bg-transparent p-2 text-sm" maxLength={1000} value={note} disabled={saving || readOnly} onChange={(event) => setNote(event.target.value)} />
            </label>
            <EButton size="sm" variant="outline" onClick={() => void review()} disabled={saving || readOnly || !note.trim()}>{saving ? "Saving…" : RETRY_LABEL[row.retry.action]}</EButton>
            {readOnly ? <p className="text-xs">Review actions are disabled while impersonating.</p> : null}
          </section>
        ) : <p className="text-xs text-[hsl(var(--e-muted-foreground))]">{row.path === "direct" ? "Direct sends have no safe retry: resending could duplicate a message that was received." : "No retry applies to this state."}</p>}
        {message ? <EAlert tone={message.tone} title={message.text} /> : null}
        <EButton size="sm" variant="outline" onClick={onClose}>Close</EButton>
      </div>
    </ESidePanel>
  );
}
