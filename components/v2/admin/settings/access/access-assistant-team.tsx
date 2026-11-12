"use client";

import { useEffect, useState } from "react";
import { ESwitch } from "@/components/v2/admin/estate-kit";
import { EAlert, EButton } from "@/components/v2/ui/primitives";
import { VA_PERMISSION_KEYS, VA_PERMISSION_LABELS, type VaPermissionKey } from "@/lib/va/permissions";
import type { AssistantTeam } from "@/lib/rbac/access-screen-types";

type TeamDetail = {
  id: string;
  name: string;
  isActive: boolean;
  permissions: Record<VaPermissionKey, boolean>;
  propertyIds: string[] | null;
  members: Array<{ id: string; name: string | null; email: string; isActive: boolean }>;
};
type PropertyOption = { id: string; name: string };
type TeamDraft = { permissions: Record<VaPermissionKey, boolean>; propertyIds: string[]; isActive: boolean };
type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; team: TeamDetail; properties: PropertyOption[] };

function draftOf(team: TeamDetail): TeamDraft {
  return { permissions: { ...team.permissions }, propertyIds: team.propertyIds ?? [], isActive: team.isActive };
}

/**
 * A client assistant team's access, read and saved through the EXISTING
 * routes and services the Accounts > Assistants tab uses
 * (GET /api/admin/va-invites, PATCH /api/admin/va-teams/[id] ->
 * lib/va/teams.ts). Paying invoices and approving quotes, extras or costs are
 * never delegable, whatever is switched on (lib/va/permissions.ts).
 */
export function AccessAssistantTeam({ team, canManage, onSaved }: { team: AssistantTeam; canManage: boolean; onSaved: () => void }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [draft, setDraft] = useState<TeamDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    setDraft(null);
    setError("");
    setNotice("");
    fetch(`/api/admin/va-invites?clientId=${encodeURIComponent(team.clientId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(body.error || "Could not load this team.");
        const found = (body.teams as TeamDetail[] | undefined)?.find((item) => item.id === team.id);
        if (!found) throw new Error("That assistant team no longer exists.");
        setState({ status: "ready", team: found, properties: body.properties ?? [] });
        setDraft(draftOf(found));
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", message: cause instanceof Error ? cause.message : "Could not load this team." });
      });
    return () => controller.abort();
  }, [team.id, team.clientId]);

  if (state.status === "loading") return <p role="status" className="p-4">Loading the team…</p>;
  if (state.status === "error") return <EAlert tone="danger" title="Could not load this team">{state.message}</EAlert>;
  if (!draft) return null;
  const savedDraft = draftOf(state.team);
  const dirty = JSON.stringify(draft) !== JSON.stringify(savedDraft);
  const editable = canManage && !saving;

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/admin/va-teams/${encodeURIComponent(team.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissions: draft.permissions, propertyIds: draft.propertyIds, isActive: draft.isActive }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not save this team.");
      if (state.status === "ready") {
        const next: TeamDetail = { ...state.team, isActive: draft.isActive, permissions: draft.permissions, propertyIds: draft.propertyIds.length ? draft.propertyIds : null };
        setState({ ...state, team: next });
      }
      setNotice("Saved. The team's next request uses the new access.");
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this team.");
    } finally {
      setSaving(false);
    }
  }

  const toggleProperty = (id: string, on: boolean) =>
    setDraft({ ...draft, propertyIds: on ? [...draft.propertyIds, id] : draft.propertyIds.filter((value) => value !== id) });

  return (
    <section aria-labelledby="assistant-team-title" className="flex flex-col gap-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="assistant-team-title" className="e-display-sm text-[1.25rem]">{state.team.name}</h2>
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Client assistants for {team.clientName} · {state.team.members.length} {state.team.members.length === 1 ? "person" : "people"}</p>
        </div>
        <ESwitch checked={draft.isActive} disabled={!editable} onCheckedChange={(isActive) => setDraft({ ...draft, isActive })} label="Team active" />
      </div>
      <p className="text-[0.8125rem]">The client sets these from their own portal too; changes here are recorded against you and the client can see them.</p>
      <fieldset disabled={!editable} className="grid gap-x-5 gap-y-2 sm:grid-cols-2">
        <legend className="mb-1 text-[0.8125rem] font-[600]">What this team can do for the client</legend>
        {VA_PERMISSION_KEYS.map((key) => (
          <label key={key} className="flex items-start gap-2 text-[0.8125rem]">
            <input type="checkbox" className="mt-0.5 h-4 w-4" checked={draft.permissions[key]} onChange={(event) => setDraft({ ...draft, permissions: { ...draft.permissions, [key]: event.target.checked } })} />
            <span>{VA_PERMISSION_LABELS[key].title}<span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{VA_PERMISSION_LABELS[key].hint}</span></span>
          </label>
        ))}
      </fieldset>
      <EAlert tone="info" title="Never allowed for assistants">Paying invoices and approving quotes, extras or costs stay with the client, whatever is switched on.</EAlert>
      <fieldset disabled={!editable} className="space-y-1.5">
        <legend className="mb-1 text-[0.8125rem] font-[600]">Properties</legend>
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{draft.propertyIds.length ? `${draft.propertyIds.length} selected` : "None selected: every property this client owns."}</p>
        <div className="grid gap-1 sm:grid-cols-2">
          {state.properties.map((property) => (
            <label key={property.id} className="flex items-center gap-2 text-[0.8125rem]">
              <input type="checkbox" checked={draft.propertyIds.includes(property.id)} onChange={(event) => toggleProperty(property.id, event.target.checked)} />
              {property.name}
            </label>
          ))}
        </div>
      </fieldset>
      {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
      {notice ? <p role="status" className="text-[0.8125rem]">{notice}</p> : null}
      {canManage ? (
        <div className="flex flex-wrap gap-2">
          <EButton disabled={!dirty || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save team access"}</EButton>
          <EButton variant="outline" disabled={!dirty || saving} onClick={() => setDraft(savedDraft)}>Discard</EButton>
        </div>
      ) : null}
      <a className="text-[0.8125rem] underline" href="/v2/admin/accounts?tab=assistants">Members and invitations are in Accounts › Assistants</a>
    </section>
  );
}
