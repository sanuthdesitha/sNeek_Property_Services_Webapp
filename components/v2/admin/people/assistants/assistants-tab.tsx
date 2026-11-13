"use client";

/**
 * People › Assistants (client assistants) as drawn: search, status chips, a
 * client filter and "Group by team"; one table grouped by client team (team
 * row: client · team, on/off, assistants, permissions, scope); one button per
 * row (Open, Resend, New invite, Reactivate) and the row menus; a bulk bar
 * (Resend invite, Suspend); the team panel on `?team=`.
 *
 * Sends and changes use existing routes only: resend and copy link through
 * the account email routes (fresh link, audited, cool-down, same permission
 * rules); suspend / reactivate through the user routes (ADMIN, as before);
 * remove from team through DELETE /api/admin/va-teams/[id]/members/[userId].
 * Owner decisions 2026-11-13: "Revoke invite" withdraws a pending invitation
 * (same rules as Resend, confirmed); "Move to team…" moves an assistant to
 * another team of the SAME client (administrators, as the other team
 * changes; PATCH /api/admin/va-teams/[id]/members/[userId]). Re-inviting an
 * assistant of another team is still refused by design.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { EAlert, EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { ERowMenu } from "@/components/v2/ui/row-menu";
import { E_CHIP_CLASS, E_CHIP_ON_CLASS } from "@/components/v2/ui/filter-chips";
import { EFilterBar, type EActiveFilter } from "@/components/v2/ui/filter-bar";

/* Phones (board M-People2): the assistants table becomes stacked cards below 640px; unchanged from 640px up. */
const PHONE_TABLE = "max-sm:block max-sm:min-w-0";
const PHONE_ROW = "max-sm:flex max-sm:flex-wrap max-sm:items-center max-sm:gap-x-3 max-sm:gap-y-1.5 max-sm:px-3 max-sm:py-3";
const PHONE_PAIR =
  "max-sm:basis-[calc(50%-0.375rem)] max-sm:p-0 max-sm:before:block max-sm:before:text-[0.6875rem] max-sm:before:font-semibold max-sm:before:text-[hsl(var(--e-muted-foreground))] max-sm:before:content-[attr(data-label)]";
import { AccountActionsMenu } from "@/components/v2/admin/accounts/account-actions-menu";
import { EstateVaManager, type EstateVaClientOption } from "@/components/v2/admin/accounts/va-manager";
import { Avatar, formatLastSeen } from "@/components/v2/admin/accounts/hub/account-display";
import type { AssistantMember, AssistantTeam } from "@/lib/people/assistants";
import { VA_PERMISSION_KEYS } from "@/lib/va/permissions";
import { copyInvitationLink } from "../copy-invite-link";
import { useRead } from "../use-read";
import { AssistantsBulk } from "./assistants-bulk";
import { MEMBER_STATUS_LABEL, MEMBER_STATUS_TONE, invitationPending, mayAct } from "./member-status";
import { TeamPanel } from "./team-panel";
import { MoveTeamDialog } from "./move-team-dialog";
import { RevokeInvitationDialog, type RevokeTarget } from "../revoke-invitation-dialog";

type StatusChip = "all" | "active" | "invited" | "suspended";
type Notice = { ok: boolean; message: string } | null;

function isTeams(body: unknown): body is { teams: AssistantTeam[] } {
  return Boolean(body && typeof body === "object" && Array.isArray((body as { teams?: unknown }).teams));
}

function chipMatches(member: AssistantMember, chip: StatusChip): boolean {
  if (chip === "all") return true;
  if (chip === "active") return member.status === "ACTIVE";
  if (chip === "invited") return invitationPending(member.status) || member.status === "INVITE_REVOKED";
  return member.status === "SUSPENDED";
}

function scopeText(team: AssistantTeam): string {
  return team.propertyIds === null ? `All ${team.client.propertyCount}` : `${team.propertyIds.length} of ${team.client.propertyCount}`;
}

function readParam(search: string, key: string): string {
  return new URLSearchParams(search).get(key) ?? "";
}

async function postJson(url: string, body?: unknown, method = "POST"): Promise<string | null> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.ok) return null;
  const json = (await res.json().catch(() => null)) as { error?: string } | null;
  return json?.error ?? `The request failed (${res.status}).`;
}

export function AssistantsTab({ canManage, canResend, clients, initialSearch }: { canManage: boolean; canResend: boolean; clients: EstateVaClientOption[]; initialSearch: string }) {
  const read = useRead<{ teams: AssistantTeam[] }>("/api/admin/va-teams", isTeams, { failure: "Could not load assistant teams." });
  const [q, setQ] = useState("");
  const [chip, setChip] = useState<StatusChip>("all");
  const [clientId, setClientId] = useState("");
  const [grouped, setGrouped] = useState(true);
  const [openTeam, setOpenTeam] = useState(() => readParam(initialSearch, "team"));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [revoking, setRevoking] = useState<RevokeTarget | null>(null);
  const [moving, setMoving] = useState<{ member: AssistantMember; team: AssistantTeam } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ tab: "assistants" });
    if (openTeam) params.set("team", openTeam);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params.toString()}`);
  }, [openTeam]);

  const teams = read.data?.teams ?? [];
  const needle = q.trim().toLowerCase();
  const visibleTeams = useMemo(
    () =>
      teams
        .filter((team) => !clientId || team.client.id === clientId)
        .map((team) => ({
          team,
          members: team.members.filter((member) => chipMatches(member, chip) && (!needle || [member.name, member.email, team.name, team.client.name].some((value) => (value ?? "").toLowerCase().includes(needle)))),
        }))
        .filter((entry) => entry.members.length > 0 || (!needle && chip === "all")),
    [teams, clientId, chip, needle],
  );
  const allMembers = teams.flatMap((team) => team.members);
  const counts = { all: allMembers.length, active: allMembers.filter((m) => chipMatches(m, "active")).length, invited: allMembers.filter((m) => chipMatches(m, "invited")).length, suspended: allMembers.filter((m) => chipMatches(m, "suspended")).length };
  const team = teams.find((item) => item.id === openTeam) ?? null;
  const memberById = new Map(teams.flatMap((item) => item.members.map((member) => [member.id, { member, team: item }] as const)));

  const act = useCallback(async (work: () => Promise<string | null>, done: string) => {
    setBusy(true);
    const error = await work();
    setNotice(error ? { ok: false, message: error } : { ok: true, message: done });
    setBusy(false);
    if (!error) read.reload();
  }, [read]);

  function primaryButton(member: AssistantMember, owner: AssistantTeam) {
    if (invitationPending(member.status) || member.status === "INVITE_REVOKED") {
      return (
        <EButton size="sm" variant="primary" disabled={!canResend || busy} onClick={() => act(() => postJson(`/api/admin/users/${member.id}/account-emails`, { type: "INVITATION" }), `A fresh invitation was sent to ${member.email}. The previous link stops working.`)}>
          {member.status === "INVITED" ? "Resend" : "New invite"}
        </EButton>
      );
    }
    if (member.status === "SUSPENDED") {
      return canManage ? (
        <EButton size="sm" variant="outline" disabled={busy} onClick={() => act(() => postJson(`/api/admin/users/${member.id}`, { isActive: true }, "PATCH"), `${member.name ?? member.email} can sign in again.`)}>Reactivate</EButton>
      ) : null;
    }
    return <EButton size="sm" variant="outline" onClick={() => setOpenTeam(owner.id)}>Open</EButton>;
  }

  function rowMenu(member: AssistantMember, owner: AssistantTeam) {
    const pending = member.status === "INVITED";
    return (
      <ERowMenu
        label={`More actions for ${member.name ?? member.email}`}
        items={[
          { key: "profile", label: "Open full profile and activity", href: `/v2/admin/accounts/users/${member.id}` },
          { key: "team", label: "Open team", onSelect: () => setOpenTeam(owner.id) },
          { key: "resend", label: "Resend invite", disabled: !canResend || busy || !(invitationPending(member.status) || member.status === "INVITE_REVOKED"), hint: "Only for an invitation not yet accepted.", onSelect: () => act(() => postJson(`/api/admin/users/${member.id}/account-emails`, { type: "INVITATION" }), `A fresh invitation was sent to ${member.email}.`) },
          { key: "copy", label: "Copy invite link", disabled: !canResend || busy || !pending, hint: "Only while a valid invitation link exists.", onSelect: async () => { setBusy(true); setNotice(await copyInvitationLink(member.id)); setBusy(false); } },
          { key: "revoke", label: "Revoke invite", disabled: !canResend || busy || !invitationPending(member.status), hint: canResend ? "Only for an invitation not yet accepted or withdrawn." : "Same rights as resending an invitation.", onSelect: () => setRevoking({ userId: member.id, label: member.name ?? member.email }) },
          { key: "move", label: "Move to team…", disabled: !canManage || busy, hint: "Administrators only.", onSelect: () => setMoving({ member, team: owner }) },
          { key: "remove", label: "Remove from team", danger: true, separated: true, disabled: !canManage || busy, hint: "Administrators only.", onSelect: () => { if (window.confirm(`Remove ${member.name ?? member.email} from ${owner.name}? Their login is switched off.`)) void act(() => postJson(`/api/admin/va-teams/${owner.id}/members/${member.id}`, undefined, "DELETE"), "Removed from the team; the login is switched off."); } },
        ]}
      />
    );
  }

  const rows = grouped ? visibleTeams : [{ team: null, members: visibleTeams.flatMap((entry) => entry.members) }];

  const chipLabel: Record<StatusChip, string> = { all: "All", active: "Active", invited: "Invite pending", suspended: "Suspended" };
  const assistantFilters: EActiveFilter[] = [];
  if (q.trim()) assistantFilters.push({ key: "q", label: `Search: ${q.trim()}`, onRemove: () => setQ("") });
  if (chip !== "all") assistantFilters.push({ key: "chip", label: chipLabel[chip], onRemove: () => setChip("all") });
  if (clientId) assistantFilters.push({ key: "client", label: `Client: ${clients.find((client) => client.id === clientId)?.name ?? "Selected"}`, onRemove: () => setClientId("") });

  return (
    <div className="flex min-w-0 gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Client assistants: people a client lets act for them in the client portal. They always belong to a client team. Office assistants who work for sNeek are office staff.</p>
        <EFilterBar
          label="Filter assistants"
          active={assistantFilters}
          onClear={() => { setQ(""); setChip("all"); setClientId(""); }}
          tools={<button type="button" aria-pressed={grouped} onClick={() => setGrouped((value) => !value)} className={cn(E_CHIP_CLASS, grouped && E_CHIP_ON_CLASS)}>Group by team</button>}
        >
          <input type="search" value={q} onChange={(event) => setQ(event.target.value)} aria-label="Search assistants" placeholder="Search name, email, client, team" className="h-8 w-full min-w-0 rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-2.5 text-[0.8125rem] sm:w-[240px]" />
          <div role="group" aria-label="Status" className="flex flex-wrap gap-1.5">
            {(["all", "active", "invited", "suspended"] as StatusChip[]).map((key) => (
              <button key={key} type="button" aria-pressed={chip === key} onClick={() => setChip(key)} className={cn(E_CHIP_CLASS, chip === key && E_CHIP_ON_CLASS)}>
                {key === "all" ? "All" : key === "active" ? "Active" : key === "invited" ? "Invite pending" : "Suspended"} <span className="e-tnum ml-1">{counts[key]}</span>
              </button>
            ))}
          </div>
          <select aria-label="Client" value={clientId} onChange={(event) => setClientId(event.target.value)} className="h-8 rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-2 text-[0.8125rem]">
            <option value="">Every client</option>
            {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
          </select>
          <span className="hidden flex-1 sm:block" />
        </EFilterBar>
        {notice ? <EAlert tone={notice.ok ? "success" : "danger"}>{notice.message}</EAlert> : null}
        {read.error ? <EAlert tone="danger">{read.error} <button type="button" className="underline" onClick={read.reload}>Try again</button></EAlert> : null}
        {read.loading && !read.data ? <p role="status" className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Loading assistants…</p> : null}
        {read.data && teams.length === 0 ? <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No assistant teams yet. Open a client team to invite assistants, or ask the client to create one in their portal.</p> : null}
        {teams.length > 0 ? (
          <div className="overflow-x-auto rounded-[12px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
            <table className={cn("w-full min-w-[52rem] text-[0.8125rem]", PHONE_TABLE)}>
              <caption className="sr-only">Client assistants{grouped ? ", grouped by team" : ""}</caption>
              <thead className="max-sm:hidden">
                <tr className="bg-[hsl(var(--e-surface-raised))] text-left text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  <th className="w-9 px-3 py-2"><span className="sr-only">Select</span></th>
                  <th className="px-3 py-2">Assistant</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">May do</th><th className="px-3 py-2">Properties</th><th className="px-3 py-2">Last seen</th><th className="px-3 py-2"><span className="sr-only">Next step</span></th><th className="px-3 py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="max-sm:block max-sm:divide-y max-sm:divide-[hsl(var(--e-border))]">
                {rows.map((entry) => (
                  <GroupRows key={entry.team?.id ?? "all"} entry={entry} memberTeam={(id) => memberById.get(id)?.team ?? null} selected={selected} setSelected={setSelected} busy={busy} onOpenTeam={setOpenTeam} primaryButton={primaryButton} rowMenu={rowMenu} canManage={canManage} onChanged={read.reload} />
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <AssistantsBulk
          selected={Array.from(selected).map((id) => memberById.get(id)?.member).filter((member): member is AssistantMember => Boolean(member))}
          canResend={canResend}
          canSuspend={canManage}
          onClear={() => setSelected(new Set())}
          onFinished={() => { setSelected(new Set()); read.reload(); }}
          onRunningChange={setBusy}
        />
        {/* Creating a new team for a client (and its first invitations) keeps the existing manager, in a lazy disclosure. */}
        <details className="rounded-[12px] border border-[hsl(var(--e-border))] px-4 py-3">
          <summary className="cursor-pointer text-[0.8125rem] font-[550]">Invite assistants or create a team for a client</summary>
          <div className="mt-3"><EstateVaManager clients={clients} canManage={canManage} /></div>
        </details>
      </div>
      {team ? <TeamPanel team={team} canManage={canManage} onClose={() => setOpenTeam("")} onChanged={read.reload} onMove={(member) => setMoving({ member, team })} /> : null}
      {revoking ? (
        <RevokeInvitationDialog
          targets={[revoking]}
          onClose={() => setRevoking(null)}
          onDone={(outcome) => { setRevoking(null); setNotice(outcome); read.reload(); }}
        />
      ) : null}
      {moving ? (
        <MoveTeamDialog
          key={`${moving.team.id}:${moving.member.id}`}
          member={moving.member}
          from={moving.team}
          teams={teams}
          onClose={() => setMoving(null)}
          onMoved={(message) => { setMoving(null); setNotice({ ok: true, message }); read.reload(); }}
        />
      ) : null}
    </div>
  );
}

function GroupRows({
  entry,
  memberTeam,
  selected,
  setSelected,
  busy,
  onOpenTeam,
  primaryButton,
  rowMenu,
  canManage,
  onChanged,
}: {
  entry: { team: AssistantTeam | null; members: AssistantMember[] };
  memberTeam: (id: string) => AssistantTeam | null;
  selected: Set<string>;
  setSelected: (next: Set<string>) => void;
  busy: boolean;
  onOpenTeam: (id: string) => void;
  primaryButton: (member: AssistantMember, team: AssistantTeam) => React.ReactNode;
  rowMenu: (member: AssistantMember, team: AssistantTeam) => React.ReactNode;
  canManage: boolean;
  onChanged: () => void;
}) {
  const head = entry.team;
  return (
    <>
      {head ? (
        <tr className="border-t border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised)/0.6)] max-sm:block">
          <td className="max-sm:hidden" />
          <td colSpan={7} className="px-3 py-2 max-sm:block">
            <button type="button" onClick={() => onOpenTeam(head.id)} className="text-left font-[600] hover:underline">{head.client.name} · {head.name}</button>{" "}
            <EPill tone={head.isActive ? "ok" : "neutral"}>{head.isActive ? "Team on" : "Team off"}</EPill>{" "}
            <span className="text-[hsl(var(--e-muted-foreground))]">{head.members.length} assistant{head.members.length === 1 ? "" : "s"} · {head.grantedCount} of {VA_PERMISSION_KEYS.length} permissions · {head.propertyIds === null ? `all ${head.client.propertyCount} properties` : `${head.propertyIds.length} of ${head.client.propertyCount} properties`}</span>{" "}
            <Link href={`/v2/admin/clients/${head.client.id}`} className="text-[0.75rem] underline">Client</Link>
          </td>
        </tr>
      ) : null}
      {entry.members.map((member) => {
        const owner = head ?? memberTeam(member.id);
        if (!owner) return null;
        const checked = selected.has(member.id);
        return (
          <tr key={member.id} className={cn("border-t border-[hsl(var(--e-border)/0.7)]", PHONE_ROW, checked && "bg-[hsl(var(--e-primary-soft)/0.4)]")}>
            <td className="px-3 py-2 max-sm:p-0">
              <input type="checkbox" className="max-sm:h-6 max-sm:w-6" aria-label={`Select ${member.name ?? member.email}`} checked={checked} disabled={busy} onChange={(event) => { const next = new Set(selected); if (event.target.checked) next.add(member.id); else next.delete(member.id); setSelected(next); }} />
            </td>
            <td className="px-3 py-2 max-sm:min-w-0 max-sm:flex-1 max-sm:p-0">
              <div className="flex items-center gap-2">
                <Avatar name={member.name} email={member.email} />
                <div className="min-w-0"><b className="block truncate">{member.name ?? "Unnamed"}</b><span className="block truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{member.email}{head ? "" : ` · ${owner.client.name}`}</span></div>
              </div>
            </td>
            <td data-label="Status" className={cn("px-3 py-2", PHONE_PAIR)}><EPill tone={MEMBER_STATUS_TONE[member.status]}>{MEMBER_STATUS_LABEL[member.status]}</EPill></td>
            <td data-label="May do" className={cn("px-3 py-2", PHONE_PAIR)}>{mayAct(member.status) ? `${owner.grantedCount} of ${VA_PERMISSION_KEYS.length}` : <span className="text-[hsl(var(--e-muted-foreground))]">Nothing</span>}</td>
            <td data-label="Properties" className={cn("px-3 py-2", PHONE_PAIR)}>{scopeText(owner)}</td>
            <td data-label="Last seen" className={cn("px-3 py-2 text-[hsl(var(--e-muted-foreground))]", PHONE_PAIR)}>{invitationPending(member.status) || member.status === "INVITE_REVOKED" ? "Never" : formatLastSeen(member.lastSeenAt)}</td>
            <td className="px-3 py-2 max-sm:flex-1 max-sm:p-0">{primaryButton(member, owner)}</td>
            <td className="px-3 py-2 max-sm:p-0">
              <div className="flex items-center gap-1">
                {rowMenu(member, owner)}
                {canManage ? <AccountActionsMenu account={{ id: member.id, name: member.name, email: member.email }} onChanged={onChanged} /> : null}
              </div>
            </td>
          </tr>
        );
      })}
    </>
  );
}
