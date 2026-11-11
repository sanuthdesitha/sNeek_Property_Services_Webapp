"use client";

/**
 * Settings → Operations → Lost and found: the holding period (default 14 days,
 * owner decision 2026-11-11). Items in storage or awaiting the guest for longer
 * are flagged on the Lost and found page and counted in its header. Flagging
 * only: nothing is donated, disposed or changed automatically.
 */
import * as React from "react";
import { ECard, ECardBody, ECardHeader, ECardTitle, EButton } from "@/components/v2/ui/primitives";
import { EField, EInput } from "@/components/v2/admin/estate-kit";
import { DEFAULT_HOLDING_DAYS, MAX_HOLDING_DAYS } from "@/lib/lost-found/holding";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; saved: number };

export function LostFoundSettingsSection() {
  const [load, setLoad] = React.useState<Load>({ status: "loading" });
  const [days, setDays] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<{ tone: "ok" | "error"; text: string } | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/lost-found/settings", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { holdingDays?: number; error?: string } | null;
        if (controller.signal.aborted) return;
        if (!response.ok || typeof body?.holdingDays !== "number") throw new Error(body?.error ?? "Could not load the setting.");
        setLoad({ status: "ready", saved: body.holdingDays });
        setDays(String(body.holdingDays));
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoad({ status: "error", message: error instanceof Error ? error.message : "Could not load the setting." });
      });
    return () => controller.abort();
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const holdingDays = Number(days);
    if (!Number.isInteger(holdingDays) || holdingDays < 1 || holdingDays > MAX_HOLDING_DAYS) {
      setMessage({ tone: "error", text: `Enter a whole number of days from 1 to ${MAX_HOLDING_DAYS}.` });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/lost-found/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ holdingDays }) });
      const body = (await response.json().catch(() => null)) as { holdingDays?: number; error?: string } | null;
      if (!response.ok || typeof body?.holdingDays !== "number") throw new Error(body?.error ?? "The setting was not saved.");
      setLoad({ status: "ready", saved: body.holdingDays });
      setMessage({ tone: "ok", text: "Holding period saved." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "The setting was not saved." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <ECard>
      <ECardHeader className="p-5 pb-0">
        <ECardTitle className="text-[1rem]">Lost and found</ECardTitle>
      </ECardHeader>
      <ECardBody className="space-y-3 p-5">
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          Items in storage or awaiting the guest for longer than this are flagged on the Lost and found page. Nothing is donated or disposed automatically. Default {DEFAULT_HOLDING_DAYS} days.
        </p>
        {load.status === "loading" ? <p role="status" className="text-[0.8125rem]">Loading…</p> : null}
        {load.status === "error" ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{load.message}</p> : null}
        {load.status === "ready" ? (
          <form onSubmit={submit}>
            <fieldset disabled={saving} className="flex flex-wrap items-end gap-2">
              <EField label="Holding period (days)" className="w-[12rem]">
                <EInput type="number" min={1} max={MAX_HOLDING_DAYS} step={1} value={days} onChange={(event) => setDays(event.target.value)} />
              </EField>
              <EButton type="submit" size="sm" disabled={days === String(load.saved)}>{saving ? "Saving…" : "Save"}</EButton>
            </fieldset>
          </form>
        ) : null}
        {message ? <p role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? "text-[0.8125rem] text-[hsl(var(--e-danger))]" : "text-[0.8125rem] text-[hsl(var(--e-success))]"}>{message.text}</p> : null}
      </ECardBody>
    </ECard>
  );
}
