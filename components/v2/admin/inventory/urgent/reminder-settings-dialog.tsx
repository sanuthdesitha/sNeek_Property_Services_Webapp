"use client";

/**
 * "Reminder settings" — the existing administrator reminder settings for
 * unresolved needs (in-app reminders only; no email, SMS or purchase), in a
 * dialog. Saved through the same service action: administrators, and
 * operations managers with the inventory pack at manage.
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, EModal } from "@/components/v2/admin/estate-kit";
import { postUrgentStock } from "./urgent-api";

type Settings = { enabled: boolean; intervalHours: number; maxReminders: number; beforeNextCleanHours: number };
type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; value: Settings };

const FIELDS: Array<{ key: "intervalHours" | "maxReminders" | "beforeNextCleanHours"; label: string; min: number; max: number }> = [
  { key: "intervalHours", label: "Repeat every (hours)", min: 1, max: 168 },
  { key: "maxReminders", label: "Maximum reminders per need", min: 0, max: 20 },
  { key: "beforeNextCleanHours", label: "Advance a reminder within this many hours of the next clean", min: 1, max: 168 },
];

export function ReminderSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [load, setLoad] = React.useState<Load>({ status: "loading" });
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<{ tone: "ok" | "error"; text: string } | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoad({ status: "loading" });
    setMessage(null);
    fetch("/api/inventory/urgent-stock", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { settings?: Settings | null; error?: string } | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !body?.settings) throw new Error(body?.error ?? "Reminder settings are available to administrators and to operations managers who manage stock.");
        setLoad({ status: "ready", value: body.settings });
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setLoad({ status: "error", message: reason instanceof Error ? reason.message : "Could not load reminder settings." });
      });
    return () => controller.abort();
  }, [open]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (load.status !== "ready") return;
    setSaving(true);
    setMessage(null);
    try {
      const saved = await postUrgentStock<Settings>({ action: "settings", ...load.value });
      setLoad({ status: "ready", value: saved });
      setMessage({ tone: "ok", text: "Reminder settings saved." });
    } catch (reason) {
      setMessage({ tone: "error", text: reason instanceof Error ? reason.message : "Not saved." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <EModal open={open} onClose={() => (saving ? undefined : onClose())} eyebrow="Urgent needs" title="Reminder settings">
      {load.status === "loading" ? <p role="status" className="text-[0.875rem]">Loading…</p> : null}
      {load.status === "error" ? <p role="alert" className="text-[0.875rem] text-[hsl(var(--e-danger))]">{load.message}</p> : null}
      {load.status === "ready" ? (
        <form onSubmit={submit}>
          <fieldset disabled={saving} className="space-y-3">
            <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">In-app reminders to administrators for unresolved needs (operations managers receive the notice when a need is opened). A running background worker is required. No emails, texts or automatic purchases.</p>
            <label className="flex items-center gap-2 text-[0.875rem]">
              <input type="checkbox" checked={load.value.enabled} onChange={(event) => setLoad({ status: "ready", value: { ...load.value, enabled: event.target.checked } })} />
              Enable reminders
            </label>
            {FIELDS.map((field) => (
              <EField key={field.key} label={field.label}>
                <EInput required type="number" min={field.min} max={field.max} value={load.value[field.key]} onChange={(event) => setLoad({ status: "ready", value: { ...load.value, [field.key]: Number(event.target.value) } })} />
              </EField>
            ))}
            {message ? <p role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? "text-[0.8125rem] text-[hsl(var(--e-danger))]" : "text-[0.8125rem] text-[hsl(var(--e-success))]"}>{message.text}</p> : null}
            <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
              <EButton type="button" size="sm" variant="outline" onClick={onClose}>Close</EButton>
              <EButton type="submit" size="sm">{saving ? "Saving…" : "Save reminder settings"}</EButton>
            </div>
          </fieldset>
        </form>
      ) : null}
    </EModal>
  );
}
