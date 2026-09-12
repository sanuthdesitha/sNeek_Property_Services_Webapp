"use client";
import { useEffect, useRef, useState } from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { JobDialog } from "./job-dialog";
import { jobsTeamDefaultResponseSchema, type JobsTeamDefault } from "@/lib/jobs/team-default";
import type { JobsSnapshot } from "@/lib/jobs/workspace-state";

export function TeamDefaultControls({ context, snapshot, snapshotInvalid, personalLoaded, hasPersonalDefault, applyDefault }: {
  context: string; snapshot: JobsSnapshot; snapshotInvalid: boolean; personalLoaded: boolean; hasPersonalDefault: boolean;
  applyDefault: (snapshot: JobsSnapshot) => boolean;
}) {
  const [data, setData] = useState<JobsTeamDefault | null>(null);
  const [canPublish, setCanPublish] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reloadRequired, setReloadRequired] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirm, setConfirm] = useState<"publish" | "remove" | null>(null);
  const [draft, setDraft] = useState<JobsSnapshot | null>(null);
  const handled = useRef(false);
  const active = useRef(true);
  const pending = useRef(false);

  async function request(change?: JobsSnapshot | null) {
    const write = change !== undefined;
    let uncertain = write;
    if (pending.current || (write && (!data || !canPublish || reloadRequired))) return;
    pending.current = true; setBusy(true); setError(""); setSaved(false);
    try {
      const response = await fetch("/api/admin/jobs-team-default", { method: write ? "PATCH" : "GET", cache: "no-store",
        headers: { "Content-Type": "application/json", "x-jobs-view-context": context },
        ...(write ? { body: JSON.stringify({ revision: data!.revision, snapshot: change }) } : {}),
      });
      if (!active.current) return;
      if (response.status === 401 || response.status === 403) { uncertain = false; setCanPublish(false); setData(null); throw new Error("Team default access changed. Reload the page."); }
      const body: unknown = await response.json();
      if (!active.current) return;
      if (!response.ok) {
        uncertain = write && response.status >= 500;
        if ((body as { code?: string } | null)?.code === "CONTEXT_CHANGED") {
          setCanPublish(false); setData(null); throw new Error("Account context changed. Reload the page.");
        }
        throw new Error(response.status === 409 ? "Team default changed elsewhere. Reload before publishing." : "Team default unavailable. Reload and try again.");
      }
      const parsed = jobsTeamDefaultResponseSchema.parse(body);
      if (parsed.context !== context) { setCanPublish(false); setData(null); throw new Error("Account context changed. Reload the page."); }
      if (write && (parsed.data.revision !== data!.revision + 1 || JSON.stringify(parsed.data.snapshot) !== JSON.stringify(change))) throw new Error("Publication was not confirmed. Reload to check the team default.");
      setData(parsed.data); setCanPublish(parsed.canPublish); setReloadRequired(false); setSaved(write);
      if (write) setConfirm(null);
    } catch (failure) {
      if (active.current) {
        setReloadRequired(true);
        setError(uncertain ? "Publication outcome is unconfirmed. Reload the team default before trying again." : failure instanceof Error && !("issues" in failure) ? failure.message : "Team default response was invalid. Reload and try again.");
      }
    } finally { pending.current = false; if (active.current) setBusy(false); }
  }
  useEffect(() => { active.current = true; void request(); return () => { active.current = false; }; }, []);
  useEffect(() => {
    if (!data || !personalLoaded || handled.current || reloadRequired) return;
    handled.current = true;
    if (!hasPersonalDefault && data.snapshot) applyDefault(data.snapshot);
  }, [data, personalLoaded, hasPersonalDefault, applyDefault, reloadRequired]);

  return <div className="rounded border border-[hsl(var(--e-border))] p-3 text-sm">
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-medium">Team default</span>
      <span>{data?.snapshot ? "Available for admin and operations" : data ? "Not set" : "Loading..."}</span>
      <EButton size="sm" variant="outline" title="Administrators can publish outside impersonation" disabled={busy || !canPublish || !data || reloadRequired || snapshotInvalid} onClick={() => { setDraft(snapshot); setConfirm("publish"); }}>Publish current view</EButton>
      <EButton size="sm" variant="ghost" disabled={busy || !canPublish || !data?.snapshot || reloadRequired} onClick={() => setConfirm("remove")}>Remove team default</EButton>
      <EButton size="sm" variant="ghost" disabled={busy} onClick={() => { void request(); }}>Reload team default</EButton>
    </div>
    <p className="mt-2">Used only when you have no personal default. A linked view or changes you make take priority. Publishing does not change anyone's personal views.</p>
    <p role="status" className="min-h-6">{busy ? "Loading or saving team default..." : saved ? "Team default saved." : ""}</p>
    {error && !confirm ? <p role="alert">{error}</p> : null}
    <JobDialog open={confirm !== null} onClose={() => { if (!busy) setConfirm(null); }} title={confirm === "remove" ? "Remove team default" : "Publish team default"}>
      <p className="text-sm">{confirm === "remove" ? "Remove the shared fallback for administrators and operations managers? Personal defaults remain available." : "Use the current filters, sort order, list or board view, density and columns as the team's fallback when opening Jobs? It starts on page 1."}</p>
      {error ? <p role="alert" className="mt-3 text-sm">{error} Cancel this dialog to reload.</p> : null}
      <div className="mt-4 flex justify-end gap-2"><EButton variant="ghost" disabled={busy} onClick={() => setConfirm(null)}>Cancel</EButton>
        <EButton disabled={busy || reloadRequired || !canPublish || (confirm === "publish" && !draft)} onClick={() => { void request(confirm === "remove" ? null : draft!); }}>{confirm === "remove" ? "Confirm removal" : "Confirm publication"}</EButton></div>
    </JobDialog>
  </div>;
}
