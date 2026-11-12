"use client";

/**
 * Client team panel as drawn: team name and client, "Team active" switch,
 * tabs Access / Members / Invite / Activity. Access edits what the team may
 * do and its property scope through PATCH /api/admin/va-teams/[id] (the
 * same helper the client portal uses; audited); the "Never allowed" rules
 * cannot be switched on by any setting. Invite adds up to 20 people through
 * POST /api/admin/va-invites (existing team grants untouched; the client gets
 * one email). Editing is for administrators, as before; others read.
 * Fields freeze while saving; a failed save keeps the draft; a different team
 * starts a fresh draft.
 */
import { useEffect, useState } from "react";
import { ESidePanel } from "@/components/v2/ui/side-panel";
import { EAlert, EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { VA_PERMISSION_KEYS, VA_PERMISSION_LABELS, type VaPermissions } from "@/lib/va/permissions";
import type { AssistantTeam } from "@/lib/people/assistants";
import { formatInstant } from "../format";
import { MEMBER_STATUS_LABEL, MEMBER_STATUS_TONE } from "./member-status";

const PANEL_TABS = ["access", "members", "invite", "activity"] as const;
type PanelTab = (typeof PANEL_TABS)[number];
type InviteRow = { name: string; email: string };
type SaveState = { status: "idle" } | { status: "saving" } | { status: "failed"; message: string } | { status: "saved"; message: string };

async function patchTeam(teamId: string, body: Record<string, unknown>): Promise<string | null> {
  const res = await fetch(`/api/admin/va-teams/${encodeURIComponent(teamId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (res.ok) return null;
  const json = (await res.json().catch(() => null)) as { error?: string } | null;
  return json?.error ?? `Could not save the team (${res.status}).`;
}

export function TeamPanel({ team, canManage, onClose, onChanged }: { team: AssistantTeam; canManage: boolean; onClose: () => void; onChanged: () => void }) {
  const [tab, setTab] = useState<PanelTab>("access");
  const [permissions, setPermissions] = useState<VaPermissions>(team.permissions);
  const [scopeAll, setScopeAll] = useState(team.propertyIds === null);
  const [chosen, setChosen] = useState<Set<string>>(new Set(team.propertyIds ?? []));
  const [invites, setInvites] = useState<InviteRow[]>([{ name: "", email: "" }]);
  const [save, setSave] = useState<SaveState>({ status: "idle" });

  // A different team (or a reload with new stored values) starts from what is stored.
  useEffect(() => {
    setPermissions(team.permissions);
    setScopeAll(team.propertyIds === null);
    setChosen(new Set(team.propertyIds ?? []));
    setSave({ status: "idle" });
  }, [team.id, team.permissions, team.propertyIds]);
  useEffect(() => {
    setTab("access");
    setInvites([{ name: "", email: "" }]);
  }, [team.id]);

  const saving = save.status === "saving";
  const locked = !canManage || saving;

  async function run(body: Record<string, unknown>, done: string) {
    setSave({ status: "saving" });
    const error = await patchTeam(team.id, body);
    if (error) {
      setSave({ status: "failed", message: error });
      return;
    }
    setSave({ status: "saved", message: done });
    onChanged();
  }

  async function sendInvites() {
    const members = invites.map((row) => ({ name: row.name.trim() || undefined, email: row.email.trim() })).filter((row) => row.email);
    if (members.length === 0) return setSave({ status: "failed", message: "Add at least one email address." });
    setSave({ status: "saving" });
    const res = await fetch("/api/admin/va-invites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: team.client.id, teamId: team.id, members }) });
    const json = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) return setSave({ status: "failed", message: json?.error ?? `Could not send the invitations (${res.status}).` });
    setInvites([{ name: "", email: "" }]);
    setSave({ status: "saved", message: `Invited ${members.length} ${members.length === 1 ? "person" : "people"}. The client gets one email listing them.` });
    onChanged();
  }

  const scopeLabel = team.propertyIds === null ? `All ${team.client.propertyCount} properties` : `${team.propertyIds.length} of ${team.client.propertyCount} properties`;

  return (
    <ESidePanel open label="Client team" title={team.name} subtitle={`${team.client.name} · created ${formatInstant(team.createdAt)}${team.createdByName ? ` by ${team.createdByName}` : ""}`} onClose={onClose}>
      <div className="flex flex-col gap-3 text-[0.8125rem]">
        <label className="flex items-center gap-2">
          <input type="checkbox" role="switch" aria-checked={team.isActive} checked={team.isActive} disabled={locked} onChange={(event) => run({ isActive: event.target.checked }, event.target.checked ? "Team switched on." : "Team switched off.")} />
          <b>Team active</b>
          <span className="text-[hsl(var(--e-muted-foreground))]">Off suspends all {team.members.length} assistants</span>
        </label>
        <div role="tablist" aria-label="Team sections" className="flex gap-1 border-b border-[hsl(var(--e-border))]">
          {PANEL_TABS.map((key) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={`-mb-px min-h-9 border-b-2 px-2 ${tab === key ? "border-[hsl(var(--e-primary))] font-[600] text-[hsl(var(--e-primary))]" : "border-transparent text-[hsl(var(--e-muted-foreground))]"}`}>
              {key === "access" ? "Access" : key === "members" ? `Members ${team.members.length}` : key === "invite" ? "Invite" : "Activity"}
            </button>
          ))}
        </div>
        {save.status === "failed" ? <EAlert tone="danger">{save.message}</EAlert> : null}
        {save.status === "saved" ? <EAlert tone="success">{save.message}</EAlert> : null}
        {!canManage ? <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Only an administrator can change a team; the client can also change it in their portal.</p> : null}

        {tab === "access" ? (
          <>
            <fieldset className="flex flex-col gap-1.5 rounded-[10px] border border-[hsl(var(--e-border))] p-3">
              <legend className="e-eyebrow px-1">What this team may do</legend>
              <p className="text-[hsl(var(--e-muted-foreground))]">{VA_PERMISSION_KEYS.filter((key) => permissions[key]).length} of {VA_PERMISSION_KEYS.length} · also editable by the client</p>
              {VA_PERMISSION_KEYS.map((key) => (
                <label key={key} className="flex items-start gap-2">
                  <input type="checkbox" className="mt-0.5" checked={permissions[key]} disabled={locked} onChange={(event) => setPermissions((current) => ({ ...current, [key]: event.target.checked }))} />
                  <span>{VA_PERMISSION_LABELS[key].title}<span className="block text-[hsl(var(--e-muted-foreground))]">{VA_PERMISSION_LABELS[key].hint}</span></span>
                </label>
              ))}
            </fieldset>
            <section className="flex flex-col gap-1 rounded-[10px] border border-[hsl(var(--e-border))] p-3">
              <h3 className="e-eyebrow">Never allowed for an assistant</h3>
              <p>Approve quotes · approve extras · approve costs · pay invoices · change a request an admin already approved</p>
              <p className="text-[hsl(var(--e-muted-foreground))]">These stay with the client. No setting can switch them on.</p>
            </section>
            <fieldset className="flex flex-col gap-1.5 rounded-[10px] border border-[hsl(var(--e-border))] p-3">
              <legend className="e-eyebrow px-1">Properties</legend>
              <label className="flex items-center gap-2"><input type="radio" name={`scope-${team.id}`} checked={scopeAll} disabled={locked} onChange={() => setScopeAll(true)} /> All {team.client.propertyCount} properties</label>
              <label className="flex items-center gap-2"><input type="radio" name={`scope-${team.id}`} checked={!scopeAll} disabled={locked} onChange={() => setScopeAll(false)} /> Only chosen</label>
              {!scopeAll ? (
                <div className="ml-6 flex flex-col gap-1">
                  {team.properties.map((property) => (
                    <label key={property.id} className="flex items-center gap-2">
                      <input type="checkbox" checked={chosen.has(property.id)} disabled={locked} onChange={(event) => setChosen((current) => { const next = new Set(current); if (event.target.checked) next.add(property.id); else next.delete(property.id); return next; })} />
                      {property.name}
                    </label>
                  ))}
                </div>
              ) : <p className="text-[hsl(var(--e-muted-foreground))]">New properties for {team.client.name} are included automatically.</p>}
            </fieldset>
            {canManage ? (
              <div className="flex items-center justify-between gap-2">
                <EButton size="sm" variant="ghost" disabled={saving} onClick={() => { setPermissions(team.permissions); setScopeAll(team.propertyIds === null); setChosen(new Set(team.propertyIds ?? [])); setSave({ status: "idle" }); }}>Cancel</EButton>
                <EButton size="sm" variant="primary" disabled={saving || (!scopeAll && chosen.size === 0)} onClick={() => run({ permissions, propertyIds: scopeAll ? [] : Array.from(chosen) }, "Team saved.")}>{saving ? "Saving…" : "Save team"}</EButton>
              </div>
            ) : null}
          </>
        ) : null}

        {tab === "members" ? (
          <ul className="divide-y divide-[hsl(var(--e-border))]">
            {team.members.length === 0 ? <li className="py-2 text-[hsl(var(--e-muted-foreground))]">No assistants on this team yet.</li> : null}
            {team.members.map((member) => (
              <li key={member.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{member.name ?? member.email}<span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{member.email}</span></span>
                <EPill tone={MEMBER_STATUS_TONE[member.status]}>{MEMBER_STATUS_LABEL[member.status]}</EPill>
              </li>
            ))}
            <li className="pt-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Scope: {scopeLabel}</li>
          </ul>
        ) : null}

        {tab === "invite" ? (
          <section className="flex flex-col gap-2">
            <p className="text-[hsl(var(--e-muted-foreground))]">Up to 20 at once. New people get this team&apos;s access as it is. The client receives one email listing everyone added.</p>
            {invites.map((row, index) => (
              <div key={index} className="flex flex-wrap gap-2">
                <input aria-label={`Name ${index + 1}`} placeholder="Name" value={row.name} disabled={locked} onChange={(event) => setInvites((current) => current.map((item, i) => (i === index ? { ...item, name: event.target.value } : item)))} className="h-8 min-w-0 flex-1 rounded border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-2" />
                <input aria-label={`Email ${index + 1}`} type="email" placeholder="Email" value={row.email} disabled={locked} onChange={(event) => setInvites((current) => current.map((item, i) => (i === index ? { ...item, email: event.target.value } : item)))} className="h-8 min-w-0 flex-1 rounded border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-2" />
                <EButton size="sm" variant="ghost" aria-label={`Remove row ${index + 1}`} disabled={locked || invites.length === 1} onClick={() => setInvites((current) => current.filter((_, i) => i !== index))}>✕</EButton>
              </div>
            ))}
            <div className="flex items-center justify-between gap-2">
              <EButton size="sm" variant="ghost" disabled={locked || invites.length >= 20} onClick={() => setInvites((current) => [...current, { name: "", email: "" }])}>+ Add row</EButton>
              <EButton size="sm" variant="primary" disabled={locked} onClick={sendInvites}>{saving ? "Sending…" : "Invite to this team"}</EButton>
            </div>
          </section>
        ) : null}

        {tab === "activity" ? (
          <ul className="flex flex-col gap-1.5">
            {team.activity.length === 0 ? <li className="text-[hsl(var(--e-muted-foreground))]">No recorded activity yet.</li> : null}
            {team.activity.map((item) => (
              <li key={item.id}><b>{item.actorName}</b> {item.action.toLowerCase()} · <span className="text-[hsl(var(--e-muted-foreground))]">{formatInstant(item.at)}</span></li>
            ))}
          </ul>
        ) : null}
      </div>
    </ESidePanel>
  );
}
