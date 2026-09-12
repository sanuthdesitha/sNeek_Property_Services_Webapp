"use client";
import * as React from "react";
import Link from "next/link";
import { z } from "zod";
import { Pin, PinOff } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { propertyFavoritesSchema, type PropertyFavorites } from "@/lib/client/property-favorites";
import type { PropertyHomeRow } from "@/lib/client/property-home";

const envelope = z.object({ state: propertyFavoritesSchema, context: z.string().regex(/^[a-f0-9]{64}$/), readOnly: z.boolean() });
function day(value: string) { return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-AU", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" }); }
export function PropertyPortfolio(props: { rows: PropertyHomeRow[]; scope: string; expectedContext: string | null }) { return <Portfolio key={`${props.scope}:${props.expectedContext}`} {...props} />; }
function Portfolio({ rows, expectedContext }: { rows: PropertyHomeRow[]; scope: string; expectedContext: string | null }) {
  const [preferences, setPreferences] = React.useState<z.infer<typeof envelope> | null>(null);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [contextChanged, setContextChanged] = React.useState(!expectedContext);
  const [uncertain, setUncertain] = React.useState(false);
  const alive = React.useRef(true); const generation = React.useRef(0); const locked = React.useRef(false);
  async function reload() {
    if (locked.current || !expectedContext || contextChanged) return;
    const current = ++generation.current;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/client/property-favorites", { cache: "no-store" });
      if (!response.ok) throw new Error("Saved property preferences are unavailable.");
      const data = envelope.parse(await response.json());
      if (data.context !== expectedContext) { if (alive.current && current === generation.current) { setPreferences(null); setContextChanged(true); } return; }
      if (alive.current && current === generation.current) { setPreferences(data); setUncertain(false); }
    } catch (failure) { if (alive.current && current === generation.current) { setPreferences(null); setError(failure instanceof Error ? failure.message : "Preferences are unavailable."); } }
    finally { if (alive.current && current === generation.current) setBusy(false); }
  }
  React.useEffect(() => { alive.current = true; void reload(); return () => { alive.current = false; ++generation.current; }; }, []);
  async function change(action: "pin" | "unpin" | "clear" | "view", value?: string) {
    if (locked.current || !preferences || preferences.readOnly || uncertain || busy || contextChanged) return;
    locked.current = true; ++generation.current; setBusy(true); setError("");
    try {
      const response = await fetch("/api/client/property-favorites", { method: "PATCH", headers: { "Content-Type": "application/json", "X-Property-Preferences-Context": preferences.context },
        body: JSON.stringify({ action, revision: preferences.state.revision, ...(action === "view" ? { view: value } : action === "clear" ? {} : { propertyId: value }) }) });
      const body = await response.json().catch(() => null);
      if (!alive.current) return;
      if (!response.ok && [400, 401, 403, 404, 409].includes(response.status)) { setPreferences(null); setError(body?.error ?? "Preferences changed. Reload before retrying."); return; }
      if (!response.ok) throw new Error();
      const data = envelope.parse(body);
      if (data.context !== expectedContext || data.state.revision !== preferences.state.revision + 1) throw new Error();
      setPreferences(data);
    } catch { if (alive.current) { setUncertain(true); setError("The save could not be confirmed. Reload preferences before making another change."); } }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  const state: PropertyFavorites | null = preferences?.state ?? null;
  const pinned = new Set(state?.ids ?? []);
  const ordered = [...rows].sort((a, b) => Number(pinned.has(b.id)) - Number(pinned.has(a.id)) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const disabled = busy || !preferences || preferences.readOnly || uncertain || contextChanged;
  return <section aria-label="Property portfolio" className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm">Pin properties for this login. Service summaries are current as of this page load.</p>
      <div className="flex gap-2">
        <EButton size="sm" variant="outline" disabled={disabled} aria-pressed={state?.view === "cards"} onClick={() => void change("view", "cards")}>Cards</EButton>
        <EButton size="sm" variant="outline" disabled={disabled} aria-pressed={state?.view === "compact"} onClick={() => void change("view", "compact")}>Compact</EButton>
      </div>
    </div>
    {contextChanged ? <p role="alert" className="text-sm">Account context could not be confirmed. <a className="underline" href="/v2/client">Reload this page</a> before changing property preferences.</p> : null}
    {error && !contextChanged ? <div role="alert" className="text-sm"><p>{error}</p><EButton size="sm" variant="outline" disabled={busy} onClick={() => void reload()}>Reload preferences</EButton></div> : null}
    {busy ? <p role="status" className="text-sm">Updating property preferences…</p> : null}
    {preferences?.readOnly ? <p className="text-sm">Property preferences are read-only while impersonating.</p> : null}
    {state ? <EButton variant="ghost" size="sm" disabled={disabled} onClick={() => { if (window.confirm("Clear all favorites for this login and client, including properties no longer visible?")) void change("clear"); }}>Clear favorites</EButton> : null}
    <div className={state?.view === "compact" ? "grid gap-2" : "grid gap-3 sm:grid-cols-2 lg:grid-cols-3"}>
      {ordered.map(property => <article key={property.id} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-4">
        <div className="flex items-start justify-between gap-2">
          <div><h3 className="font-semibold"><Link href={`/v2/client/properties/${property.id}`} className="hover:underline">{property.name}</Link></h3><p className="text-xs text-[hsl(var(--e-muted-foreground))]">{property.suburb} · {property.bedrooms}bd · {property.bathrooms}ba{property.hasBalcony ? " · Balcony" : ""}</p></div>
          <button type="button" className="flex min-h-11 min-w-11 items-center justify-center rounded border disabled:opacity-50" disabled={disabled} aria-label={`${pinned.has(property.id) ? "Unpin" : "Pin"} ${property.name}`} aria-pressed={pinned.has(property.id)} onClick={() => void change(pinned.has(property.id) ? "unpin" : "pin", property.id)}>{pinned.has(property.id) ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}</button>
        </div>
        <dl className={state?.view === "compact" ? "mt-3 grid gap-3 text-sm md:grid-cols-3" : "mt-3 space-y-3 text-sm"}>
          <div><dt className="font-medium">Next clean</dt><dd>{property.next === "hidden" ? "Service details are not shared for this account." : property.next ? <><Link className="underline" href={`/v2/client/jobs/${property.next.id}`}>{day(property.next.day)}{property.next.startTime ? ` · planned ${property.next.startTime}` : ""}</Link><p>{property.next.phase ?? "Live service status is not shared for this account."}</p>{property.next.phase ? <p className="text-xs text-[hsl(var(--e-muted-foreground))]">Updated {new Date(property.next.updatedAt).toLocaleString("en-AU", { timeZone: "Australia/Sydney" })} Sydney</p> : null}</> : "No upcoming clean scheduled"}</dd></div>
          <div><dt className="font-medium">Last completed service</dt><dd>{property.last === "hidden" ? "Service history is not shared for this account." : property.last === "unavailable" ? "History unavailable" : property.last ? <><Link className="underline" href={`/v2/client/jobs/${property.last.id}`}>{day(property.last.day)}</Link>{property.last.reportId ? <p><Link className="underline" href={`/v2/client/reports?propertyId=${property.id}`}>View shared reports</Link></p> : null}</> : "No completed service recorded"}</dd></div>
          {property.approvals !== "hidden" ? <div><dt className="font-medium">Approval inbox</dt><dd>{property.approvals === "unavailable" ? "Approval requests unavailable" : property.approvals > 0 ? <Link className="underline" href="/v2/client/approvals">{property.approvals} pending {property.approvals === 1 ? "request" : "requests"}</Link> : "No pending property requests"}</dd></div> : null}
        </dl>
      </article>)}
    </div>
  </section>;
}
