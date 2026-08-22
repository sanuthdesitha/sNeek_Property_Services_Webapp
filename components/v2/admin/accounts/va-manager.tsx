"use client";

import * as React from "react";
import { Loader2, Plus, Trash2, UserPlus } from "lucide-react";
import {
  EConfirmButton,
  EConfirmModal,
  EInput,
  EField,
  ESelect,
  ESwitch,
  verifyAdminSecurity,
} from "@/components/v2/admin/estate-kit";
import {
  EAlert,
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEmptyState,
} from "@/components/v2/ui/primitives";
import {
  VA_PERMISSION_KEYS,
  VA_PERMISSION_LABELS,
  type VaPermissionKey,
} from "@/lib/va/permissions";
import { AccountActionsMenu } from "@/components/v2/admin/accounts/account-actions-menu";

/**
 * Admin-side VA onboarding.
 *
 * A VA is ALWAYS attached to a client — there is no unattached assistant, so
 * the client picker is required and everything else on this form is disabled
 * until one is chosen. The server enforces the same rule; this is only the
 * honest version of it in the UI.
 *
 * Bulk by design: an agency hands over five assistants at once, and the client
 * gets ONE "these people now have access" email rather than five.
 *
 * PERMISSIONS are offered only when creating a NEW team. Adding people to an
 * existing team inherits that team's grants and never rewrites them — the
 * client may have deliberately narrowed them, and an admin adding a sixth
 * assistant must not silently re-widen the team.
 */

export interface EstateVaClientOption {
  id: string;
  name: string;
  email: string | null;
}

interface TeamMember {
  id: string;
  name: string | null;
  email: string;
  isActive: boolean;
  acceptedAt: string | null;
}

interface TeamOption {
  id: string;
  name: string;
  isActive: boolean;
  memberCount: number;
  permissions: Record<string, boolean> | null;
  propertyIds: string[] | null;
  members: TeamMember[];
}

interface PropertyOption {
  id: string;
  name: string;
}

interface MemberRow {
  key: string;
  name: string;
  email: string;
}

interface InviteResult {
  email: string;
  name?: string;
  ok: boolean;
  error?: string;
}

const NEW_TEAM = "__new__";
const MAX_MEMBERS = 20;

/** One place that knows the shape of the client-scoped VA payload. */
async function fetchClientData(clientId: string) {
  const res = await fetch(`/api/admin/va-invites?clientId=${encodeURIComponent(clientId)}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Could not load assistant teams.");
  const data = (await res.json()) as { teams?: TeamOption[]; properties?: PropertyOption[] };
  return {
    teams: Array.isArray(data.teams) ? data.teams : [],
    properties: Array.isArray(data.properties) ? data.properties : [],
  };
}

let rowSeq = 0;
function blankRow(): MemberRow {
  rowSeq += 1;
  return { key: `row-${rowSeq}`, name: "", email: "" };
}

export function EstateVaManager({
  clients,
  canManage = true,
}: {
  clients: EstateVaClientOption[];
  /** Only an ADMIN may delete a team outright; OPS_MANAGER can still retune it. */
  canManage?: boolean;
}) {
  const [clientId, setClientId] = React.useState("");
  const [teamChoice, setTeamChoice] = React.useState<string>(NEW_TEAM);
  const [teamName, setTeamName] = React.useState("");
  const [permissions, setPermissions] = React.useState<Record<string, boolean>>({});
  const [propertyIds, setPropertyIds] = React.useState<string[]>([]);
  const [rows, setRows] = React.useState<MemberRow[]>(() => [blankRow()]);

  const [teams, setTeams] = React.useState<TeamOption[]>([]);
  const [properties, setProperties] = React.useState<PropertyOption[]>([]);
  const [loadingClient, setLoadingClient] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [summary, setSummary] = React.useState<
    | {
        teamName: string;
        createdTeam: boolean;
        results: InviteResult[];
        clientNotified: boolean;
        clientNotifyError?: string;
      }
    | null
  >(null);

  const client = clients.find((c) => c.id === clientId) ?? null;
  const creatingTeam = teamChoice === NEW_TEAM;

  // Teams and properties belong to the chosen client, so they are refetched on
  // every change — showing a stale list would let an admin aim an invite at
  // another client's team, which the server rejects anyway.
  React.useEffect(() => {
    if (!clientId) {
      setTeams([]);
      setProperties([]);
      return;
    }
    let cancelled = false;
    setLoadingClient(true);
    fetchClientData(clientId)
      .then((data) => {
        if (cancelled) return;
        setTeams(data.teams);
        setProperties(data.properties);
      })
      .catch(() => {
        if (cancelled) return;
        setTeams([]);
        setProperties([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingClient(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const reloadClientData = React.useCallback(async () => {
    if (!clientId) return;
    try {
      const data = await fetchClientData(clientId);
      setTeams(data.teams);
      setProperties(data.properties);
    } catch {
      // Leave the last known state on screen: blanking the teams because one
      // refresh failed would read as the teams having been deleted.
    }
  }, [clientId]);

  function onClientChange(next: string) {
    setClientId(next);
    setTeamChoice(NEW_TEAM);
    setTeamName("");
    setPropertyIds([]);
    setSummary(null);
    setError(null);
  }

  function updateRow(key: string, patch: Partial<MemberRow>) {
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function removeRow(key: string) {
    setRows((current) => (current.length === 1 ? current : current.filter((r) => r.key !== key)));
  }

  function toggleProperty(id: string, next: boolean) {
    setPropertyIds((current) =>
      next ? [...current, id] : current.filter((existing) => existing !== id)
    );
  }

  const filledRows = rows.filter((r) => r.email.trim().length > 0);
  const canSubmit =
    Boolean(clientId) &&
    filledRows.length > 0 &&
    (creatingTeam ? teamName.trim().length > 0 : true) &&
    !submitting;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);
    setSummary(null);

    try {
      const payload: Record<string, unknown> = {
        clientId,
        members: filledRows.map((r) => ({
          email: r.email.trim(),
          ...(r.name.trim() ? { name: r.name.trim() } : {}),
        })),
      };

      if (creatingTeam) {
        payload.teamName = teamName.trim();
        payload.permissions = permissions;
        // An empty scope means "every property" — send it only when narrowed.
        if (propertyIds.length > 0) payload.propertyIds = propertyIds;
      } else {
        payload.teamId = teamChoice;
      }

      const res = await fetch("/api/admin/va-invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data?.error ?? "Could not invite assistants.");
        // Per-member failures still come back on a rejected batch.
        if (Array.isArray(data?.results)) {
          setSummary({
            teamName: data.teamName ?? teamName,
            createdTeam: Boolean(data.createdTeam),
            results: data.results,
            clientNotified: false,
            clientNotifyError: data.clientNotifyError,
          });
        }
        return;
      }

      setSummary({
        teamName: data.teamName,
        createdTeam: Boolean(data.createdTeam),
        results: Array.isArray(data.results) ? data.results : [],
        clientNotified: Boolean(data.clientNotified),
        clientNotifyError: data.clientNotifyError,
      });

      // Keep the client and team selected — onboarding usually continues.
      setRows([blankRow()]);
      setTeamName("");
      setPropertyIds([]);
      setPermissions({});
      // The new team must appear in the picker without a reload.
      if (data.teamId) setTeamChoice(data.teamId);
      // Refetch rather than fabricate a row: the server owns member state and
      // the parsed grants, and a hand-built row would show a new team as
      // having no permissions when it was just created with some.
      void reloadClientData();
    } catch (err: any) {
      setError(err?.message ?? "Could not invite assistants.");
    } finally {
      setSubmitting(false);
    }
  }

  if (clients.length === 0) {
    return (
      <EEmptyState
        title="No active clients"
        description="An assistant is always linked to a client, so add a client first."
      />
    );
  }

  return (
    <div className="space-y-6">
      <ECard>
        <ECardHeader>
          <ECardTitle>Invite virtual assistants</ECardTitle>
        </ECardHeader>
        <ECardBody>
          <p className="mb-4 text-[0.8125rem] text-[hsl(var(--e-text-muted))]">
            Every assistant works on behalf of one client. They get a portal login with a
            temporary password, and the client is emailed a single notice listing everyone
            added. Assistants can never approve quotes or extras, approve costs, or pay an
            invoice.
          </p>

          <form onSubmit={submit} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <EField label="Client" hint="Required — an assistant is always linked to a client.">
                <ESelect value={clientId} onChange={(e) => onClientChange(e.target.value)}>
                  <option value="">Select a client…</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </ESelect>
              </EField>

              <EField
                label="Assistant team"
                hint={
                  creatingTeam
                    ? "A new team — set its starting access below."
                    : "Existing team — new members inherit its current access."
                }
              >
                <ESelect
                  value={teamChoice}
                  disabled={!clientId || loadingClient}
                  onChange={(e) => setTeamChoice(e.target.value)}
                >
                  <option value={NEW_TEAM}>+ New team</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.memberCount}){t.isActive ? "" : " — disabled"}
                    </option>
                  ))}
                </ESelect>
              </EField>
            </div>

            {creatingTeam ? (
              <EField
                label="Team name"
                hint="How the client will see this group, e.g. “Manila VA team”."
              >
                <EInput
                  value={teamName}
                  disabled={!clientId}
                  maxLength={120}
                  placeholder="Assistant team"
                  onChange={(e) => setTeamName(e.target.value)}
                />
              </EField>
            ) : null}

            {creatingTeam ? (
              <div className="space-y-3 rounded-[var(--e-radius-md)] border border-[hsl(var(--e-border))] p-4">
                <div>
                  <p className="text-[0.8125rem] font-medium text-[hsl(var(--e-text))]">
                    Starting access
                  </p>
                  <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                    So the team is useful on day one. The client can change any of this
                    afterwards from their own portal.
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {VA_PERMISSION_KEYS.map((key: VaPermissionKey) => (
                    <div
                      key={key}
                      className="flex items-start justify-between gap-3 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] px-3 py-2"
                    >
                      <div className="min-w-0">
                        <span className="block text-[0.8125rem] font-medium text-[hsl(var(--e-text))]">
                          {VA_PERMISSION_LABELS[key].title}
                        </span>
                        <span className="block text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                          {VA_PERMISSION_LABELS[key].hint}
                        </span>
                      </div>
                      <ESwitch
                        checked={permissions[key] === true}
                        disabled={!clientId}
                        onCheckedChange={(next) =>
                          setPermissions((current) => ({ ...current, [key]: next }))
                        }
                      />
                    </div>
                  ))}
                </div>

                {properties.length > 0 ? (
                  <div className="space-y-2 pt-1">
                    <p className="text-[0.8125rem] font-medium text-[hsl(var(--e-text))]">
                      Properties
                    </p>
                    <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                      Leave all unticked for every property. Tick some to narrow the team to
                      just those.
                    </p>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {properties.map((p) => (
                        <label
                          key={p.id}
                          className="flex items-center gap-2 text-[0.8125rem] text-[hsl(var(--e-text-muted))]"
                        >
                          <input
                            type="checkbox"
                            checked={propertyIds.includes(p.id)}
                            onChange={(e) => toggleProperty(p.id, e.target.checked)}
                            className="h-3.5 w-3.5 rounded border-[hsl(var(--e-border-strong))]"
                          />
                          <span className="truncate">{p.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="space-y-2">
              <p className="text-[0.8125rem] font-medium text-[hsl(var(--e-text))]">Assistants</p>
              {rows.map((row) => (
                <div key={row.key} className="flex items-center gap-2">
                  <EInput
                    className="w-[38%]"
                    value={row.name}
                    disabled={!clientId}
                    maxLength={120}
                    placeholder="Name (optional)"
                    onChange={(e) => updateRow(row.key, { name: e.target.value })}
                  />
                  <EInput
                    className="flex-1"
                    type="email"
                    value={row.email}
                    disabled={!clientId}
                    placeholder="name@example.com"
                    onChange={(e) => updateRow(row.key, { email: e.target.value })}
                  />
                  {/* Low tier: an unsent invite row is two fields the admin
                      can retype in seconds. */}
                  <EConfirmButton
                    ariaLabel="Remove row"
                    confirmLabel="Remove?"
                    disabled={rows.length === 1}
                    onConfirm={() => removeRow(row.key)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </EConfirmButton>
                </div>
              ))}
              <EButton
                type="button"
                variant="ghost"
                size="sm"
                disabled={!clientId || rows.length >= MAX_MEMBERS}
                onClick={() => setRows((current) => [...current, blankRow()])}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add another
              </EButton>
            </div>

            {error ? <EAlert tone="danger">{error}</EAlert> : null}

            <div className="flex items-center gap-3">
              <EButton type="submit" variant="gold" disabled={!canSubmit}>
                {submitting ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <UserPlus className="mr-1 h-3.5 w-3.5" />
                )}
                Send {filledRows.length > 1 ? `${filledRows.length} invites` : "invite"}
              </EButton>
              {client && !client.email ? (
                <span className="text-[0.75rem] text-[hsl(var(--e-warning))]">
                  This client has no email on file — they will not be notified.
                </span>
              ) : null}
            </div>
          </form>
        </ECardBody>
      </ECard>

      {summary ? (
        <ECard>
          <ECardHeader>
            <ECardTitle>
              {summary.createdTeam ? "Team created" : "Invites sent"} — {summary.teamName}
            </ECardTitle>
          </ECardHeader>
          <ECardBody className="space-y-3">
            <ul className="space-y-1.5">
              {summary.results.map((r) => (
                <li
                  key={r.email}
                  className="flex items-center justify-between gap-3 text-[0.8125rem]"
                >
                  <span className="truncate text-[hsl(var(--e-text))]">
                    {r.name ? `${r.name} · ` : ""}
                    {r.email}
                  </span>
                  {r.ok ? (
                    <EBadge tone="success">Invited</EBadge>
                  ) : (
                    <span className="shrink-0 text-[hsl(var(--e-danger))]">{r.error}</span>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
              {summary.clientNotified
                ? "The client has been emailed the list of assistants added."
                : summary.clientNotifyError ?? "The client was not notified."}
            </p>
          </ECardBody>
        </ECard>
      ) : null}

      {clientId && teams.length > 0 ? (
        <div className="space-y-4">
          <div>
            <h3 className="text-[1rem] font-semibold tracking-[-0.01em] text-[hsl(var(--e-foreground))]">
              Existing teams
            </h3>
            <p className="mt-0.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              These grants belong to the client and they can change them from their own portal.
              Editing here is for when they ask you to.
            </p>
          </div>
          {teams.map((team) => (
            <VaTeamEditor
              key={team.id}
              team={team}
              properties={properties}
              canDelete={canManage}
              onChanged={reloadClientData}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * One existing team, editable in place.
 *
 * The money rule is not represented here at all — no toggle exists for quote,
 * extra, cost or invoice-payment approval, and assertVaMayAct refuses them
 * independently of whatever this screen writes. A permission that could be
 * granted by a checkbox would only ever be as safe as the checkbox.
 *
 * After every write the whole client payload is refetched rather than patched
 * locally: the client may be editing the same team from their own portal, and
 * a card that trusted its own optimistic state would quietly show one grant
 * while the chokepoint enforced another.
 */
function VaTeamEditor({
  team,
  properties,
  canDelete,
  onChanged,
}: {
  team: TeamOption;
  properties: PropertyOption[];
  canDelete: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [name, setName] = React.useState(team.name);
  const [isActive, setIsActive] = React.useState(team.isActive);
  const [permissions, setPermissions] = React.useState<Record<string, boolean>>(
    () => team.permissions ?? {}
  );
  const [scope, setScope] = React.useState<string[]>(() => team.propertyIds ?? []);
  // PIN tier for both deletes below: these destroy a working login. An assistant
  // removed here loses access mid-task, and there is no undo — the client has to
  // re-invite and the invitation has to be accepted again.
  const [removeMemberTarget, setRemoveMemberTarget] = React.useState<
    { id: string; label: string } | null
  >(null);
  const [deleteTeamOpen, setDeleteTeamOpen] = React.useState(false);

  // The server is the source of truth, so a refetch after anyone's edit wins
  // over whatever this card was holding.
  React.useEffect(() => {
    setName(team.name);
    setIsActive(team.isActive);
    setPermissions(team.permissions ?? {});
    setScope(team.propertyIds ?? []);
  }, [team]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/va-teams/${team.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), isActive, permissions, propertyIds: scope }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "Could not save the team.");
      await onChanged();
      setOpen(false);
    } catch (err: any) {
      setError(err?.message ?? "Could not save the team.");
    } finally {
      setSaving(false);
    }
  }

  async function removeMember(credentials?: { pin?: string; password?: string }) {
    const target = removeMemberTarget;
    if (!target) return;
    setSaving(true);
    setError(null);
    try {
      // The members route takes no security payload of its own.
      await verifyAdminSecurity(credentials);
      const res = await fetch(`/api/admin/va-teams/${team.id}/members/${target.id}`, {
        method: "DELETE",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "Could not remove the assistant.");
      setRemoveMemberTarget(null);
      await onChanged();
    } catch (err: any) {
      setError(err?.message ?? "Could not remove the assistant.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteTeam(credentials?: { pin?: string; password?: string }) {
    setSaving(true);
    setError(null);
    try {
      // The team route takes no security payload of its own.
      await verifyAdminSecurity(credentials);
      const res = await fetch(`/api/admin/va-teams/${team.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "Could not remove the team.");
      setDeleteTeamOpen(false);
      await onChanged();
    } catch (err: any) {
      setError(err?.message ?? "Could not remove the team.");
    } finally {
      setSaving(false);
    }
  }

  const grantedCount = VA_PERMISSION_KEYS.filter((k) => permissions[k] === true).length;
  const activeMembers = team.members.filter((m) => m.isActive);

  return (
    <ECard>
      <ECardBody className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[0.9375rem] font-semibold text-[hsl(var(--e-foreground))]">
              {team.name}
            </p>
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              {activeMembers.length} {activeMembers.length === 1 ? "assistant" : "assistants"} ·{" "}
              {grantedCount} of {VA_PERMISSION_KEYS.length} permissions ·{" "}
              {scope.length === 0 ? "all properties" : `${scope.length} properties`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {team.isActive ? null : <EBadge tone="danger">Disabled</EBadge>}
            <EButton size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
              {open ? "Close" : "Manage access"}
            </EButton>
          </div>
        </div>

        <ul className="space-y-1">
          {team.members.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 text-[0.8125rem]">
              <span className="truncate text-[hsl(var(--e-text-secondary))]">
                {m.name ? `${m.name} · ` : ""}
                {m.email}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {!m.isActive ? (
                  <EBadge tone="danger" soft>
                    Removed
                  </EBadge>
                ) : m.acceptedAt ? null : (
                  <EBadge tone="warning" soft>
                    Invite pending
                  </EBadge>
                )}
                {m.isActive ? (
                  <button
                    type="button"
                    aria-label={`Remove ${m.email} from this team`}
                    disabled={saving}
                    onClick={() => setRemoveMemberTarget({ id: m.id, label: m.name || m.email })}
                    className="rounded-[var(--e-radius-sm)] p-1 text-[hsl(var(--e-text-faint))] transition-colors hover:text-[hsl(var(--e-danger))] disabled:opacity-40"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
                {/* Removing someone from a TEAM and managing their LOGIN are
                    different things: a VA who has lost their authenticator
                    still belongs on the team. Both are offered, deliberately
                    side by side. */}
                {canDelete ? (
                  <AccountActionsMenu
                    account={{ id: m.id, name: m.name ?? null, email: m.email }}
                    disabled={saving}
                    onChanged={onChanged}
                  />
                ) : null}
              </span>
            </li>
          ))}
        </ul>

        {open ? (
          <div className="space-y-4 border-t border-[hsl(var(--e-border))] pt-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
              <EField label="Team name">
                <EInput value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
              </EField>
              <EField label="Active" hint="Off suspends every assistant on this team.">
                <ESwitch checked={isActive} onCheckedChange={setIsActive} />
              </EField>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {VA_PERMISSION_KEYS.map((key: VaPermissionKey) => (
                <div
                  key={key}
                  className="flex items-start justify-between gap-3 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] px-3 py-2"
                >
                  <div className="min-w-0">
                    <span className="block text-[0.8125rem] font-medium text-[hsl(var(--e-text))]">
                      {VA_PERMISSION_LABELS[key].title}
                    </span>
                    <span className="block text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                      {VA_PERMISSION_LABELS[key].hint}
                    </span>
                  </div>
                  <ESwitch
                    checked={permissions[key] === true}
                    onCheckedChange={(next) =>
                      setPermissions((current) => ({ ...current, [key]: next }))
                    }
                  />
                </div>
              ))}
            </div>

            {properties.length > 0 ? (
              <div className="space-y-2">
                <p className="text-[0.8125rem] font-medium text-[hsl(var(--e-text))]">Properties</p>
                <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                  Nothing ticked means every property. Ticking some narrows the team to just those.
                </p>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {properties.map((prop) => (
                    <label
                      key={prop.id}
                      className="flex items-center gap-2 text-[0.8125rem] text-[hsl(var(--e-text-muted))]"
                    >
                      <input
                        type="checkbox"
                        checked={scope.includes(prop.id)}
                        onChange={(e) =>
                          setScope((current) =>
                            e.target.checked
                              ? [...current, prop.id]
                              : current.filter((id) => id !== prop.id)
                          )
                        }
                        className="h-3.5 w-3.5 rounded border-[hsl(var(--e-border-strong))]"
                      />
                      <span className="truncate">{prop.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            {error ? <EAlert tone="danger">{error}</EAlert> : null}

            <div className="flex items-center justify-between gap-3">
              <EButton variant="gold" size="sm" disabled={saving} onClick={() => void save()}>
                {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                Save access
              </EButton>
              {canDelete ? (
                <EButton variant="ghost" size="sm" disabled={saving} onClick={() => setDeleteTeamOpen(true)}>
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                  Delete team
                </EButton>
              ) : null}
            </div>
          </div>
        ) : null}
      </ECardBody>

      <EConfirmModal
        open={Boolean(removeMemberTarget)}
        onClose={() => setRemoveMemberTarget(null)}
        title="Remove assistant"
        description={
          removeMemberTarget
            ? `${removeMemberTarget.label} loses their login immediately and would have to be invited and onboarded again. Enter your PIN or password to continue.`
            : undefined
        }
        confirmLabel="Remove assistant"
        requireSecurity
        loading={saving}
        onConfirm={removeMember}
      />

      <EConfirmModal
        open={deleteTeamOpen}
        onClose={() => setDeleteTeamOpen(false)}
        title="Delete assistant team"
        description={`Every assistant on ${team.name} loses access immediately, along with the team's permissions and property scope. This cannot be undone. Enter your PIN or password to continue.`}
        confirmLabel="Delete team"
        confirmPhrase="DELETE"
        requireSecurity
        loading={saving}
        onConfirm={deleteTeam}
      />
    </ECard>
  );
}
