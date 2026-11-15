"use client";

/**
 * Client portal › Settings: "Photos of your property in our marketing"
 * (2026-11-17, board "Social connections"). The client gives or takes back
 * their own permission; the wording version is saved with each change.
 * Turning it off stops new posts at once and asks the office to remove
 * existing ones. A failed save keeps the choices on screen.
 */
import * as React from "react";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { CONSENT_PORTAL_WORDING } from "@/lib/marketing/social/consent-rules";

type ConsentState = {
  properties: Array<{ id: string; name: string; suburb: string }>;
  consent: { allowSuburb: boolean; allowBefore: boolean; givenAt: string; givenByName: string; method: string; propertyIds: string[] } | null;
};

export function MarketingConsentCard() {
  const [load, setLoad] = React.useState<{ state: "loading" } | { state: "failed"; message: string } | { state: "ready"; data: ConsentState }>({ state: "loading" });
  const [allow, setAllow] = React.useState(false);
  const [propertyIds, setPropertyIds] = React.useState<string[]>([]);
  const [allowSuburb, setAllowSuburb] = React.useState(false);
  const [allowBefore, setAllowBefore] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | null>(null);

  const apply = React.useCallback((data: ConsentState) => {
    setLoad({ state: "ready", data });
    setAllow(Boolean(data.consent));
    setPropertyIds(data.consent?.propertyIds ?? data.properties.map((property) => property.id));
    setAllowSuburb(data.consent?.allowSuburb ?? false);
    setAllowBefore(data.consent?.allowBefore ?? false);
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/client/marketing-consent", { signal: controller.signal, cache: "no-store" });
        const body = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!response.ok) setLoad({ state: "failed", message: body?.error ?? "Your choice could not be loaded." });
        else apply(body as ConsentState);
      } catch {
        if (!controller.signal.aborted) setLoad({ state: "failed", message: "Your choice could not be loaded." });
      }
    })();
    return () => controller.abort();
  }, [apply]);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/client/marketing-consent", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(allow ? { allow: true, propertyIds, allowSuburb, allowBefore } : { allow: false }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Your choice was not saved.");
      apply(body as ConsentState);
      setMessage({ ok: true, text: allow ? "Saved. Thank you." : "Saved. We will stop using photos of your properties and remove existing posts." });
    } catch (error) {
      setMessage({ ok: false, text: `${error instanceof Error ? error.message : "Your choice was not saved."} Your choices are kept; try again.` });
    } finally {
      setSaving(false);
    }
  }

  const data = load.state === "ready" ? load.data : null;
  const changed = data ? allow !== Boolean(data.consent) || (allow && (allowSuburb !== (data.consent?.allowSuburb ?? false) || allowBefore !== (data.consent?.allowBefore ?? false) || propertyIds.slice().sort().join() !== (data.consent?.propertyIds ?? data.properties.map((property) => property.id)).slice().sort().join())) : false;

  return (
    <ECard className="space-y-3 p-4">
      <h2 className="text-[0.9375rem] font-[600]">{CONSENT_PORTAL_WORDING.title}</h2>
      <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{CONSENT_PORTAL_WORDING.body}</p>
      {load.state === "loading" ? <p role="status" className="text-[0.8125rem]">Loading your choice…</p> : null}
      {load.state === "failed" ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{load.message}</p> : null}
      {data ? (
        <fieldset disabled={saving} className="space-y-2 text-[0.875rem]">
          <legend className="sr-only">Marketing photos</legend>
          <label className="flex min-h-11 items-start gap-2">
            <input type="checkbox" className="mt-1 h-4 w-4" checked={allow} onChange={(event) => setAllow(event.target.checked)} />
            <span>{CONSENT_PORTAL_WORDING.yes}{data.consent ? <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Given {new Date(data.consent.givenAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })} by {data.consent.method === "PORTAL" ? "you" : data.consent.givenByName}</span> : null}</span>
          </label>
          {allow ? (
            <div className="space-y-1 pl-6">
              {data.properties.length > 1 ? data.properties.map((property) => (
                <label key={property.id} className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={propertyIds.includes(property.id)} onChange={(event) => setPropertyIds((current) => (event.target.checked ? [...current, property.id] : current.filter((id) => id !== property.id)))} /> {property.name}</label>
              )) : null}
              <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={allowSuburb} onChange={(event) => setAllowSuburb(event.target.checked)} /> {CONSENT_PORTAL_WORDING.suburb}</label>
              <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={allowBefore} onChange={(event) => setAllowBefore(event.target.checked)} /> {CONSENT_PORTAL_WORDING.before}</label>
            </div>
          ) : null}
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{CONSENT_PORTAL_WORDING.revokeNote}</p>
          <EButton size="sm" onClick={() => void save()} disabled={!changed || saving || (allow && propertyIds.length === 0)}>{saving ? "Saving…" : "Save my choice"}</EButton>
          {message ? <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-[0.8125rem]" : "text-[0.8125rem] text-[hsl(var(--e-danger))]"}>{message.text}</p> : null}
        </fieldset>
      ) : null}
    </ECard>
  );
}
