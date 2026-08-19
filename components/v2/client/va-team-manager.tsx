"use client";

/**
 * V2 — the client's own controls for their VA teams.
 *
 *   GET/POST     /api/client/va-teams
 *   PATCH/DELETE /api/client/va-teams/[id]
 *   POST         /api/client/va-teams/[id]/members
 *   DELETE       /api/client/va-teams/[id]/members/[userId]
 *
 * Only a CLIENT ever renders this — the API refuses a VA actor outright
 * (`assertTeamManager`), and the page guards with requireRole([Role.CLIENT]).
 * The UI is the third layer of that, not the only one.
 *
 * PERMISSION TOGGLES SAVE IMMEDIATELY, because a half-filled form that was
 * never submitted is indistinguishable from a grant the client decided against
 * — and here the difference is whether someone can see their homes. Each toggle
 * is optimistic and reverts on failure, with the error stated inline rather
 * than left as a silently un-applied switch.
 */

import * as React from "react";
import { Loader2, Plus, Trash2, UserPlus, X } from "lucide-react";
import { ECard, ECardBody, EEyebrow, EButton, EBadge, EEmptyState } from "@/components/v2/ui/primitives";
import { ECheckTile, EInlineNotice, EInput, ELabel } from "@/components/v2/client/fields";
import { ESwitch } from "@/components/v2/admin/estate-kit";
import { VA_PERMISSION_KEYS, type VaPermissionKey } from "@/lib/va/permissions";

/** Plain-language labels. The keys themselves are the contract; these are not. */
const PERMISSION_LABELS: Record<VaPermissionKey, { title: string; hint: string }> = {
  bookings: { title: "Bookings", hint: "Book, reschedule and cancel cleans" },
  maintenance: { title: "Maintenance", hint: "Raise jobs and assign a worker" },
  reports: { title: "Reports", hint: "View and download cleaning reports" },
  damage: { title: "Damage", hint: "View released damage reports" },
  invoicesView: { title: "See invoices", hint: "View only — never pay them" },
  messages: { title: "Messages", hint: "Read and post on job threads" },
  properties: { title: "Properties", hint: "View and edit property profiles" },
};

export interface VaMember {
  id: string;
  name: string | null;
  email: string;
  isActive: boolean;
  invitation: { acceptedAt: string | null; expiresAt: string } | null;
}

export interface VaTeamView {
  id: string;
  name: string;
  isActive: boolean;
  permissions: Record<string, boolean> | null;
  propertyIds: string[] | null;
  members: VaMember[];
}

export interface PropertyOption {
  id: string;
  name: string;
}

export function VaTeamManager({
  initialTeams,
  properties,
}: {
  initialTeams: VaTeamView[];
  properties: PropertyOption[];
}) {
  const [teams, setTeams] = React.useState(initialTeams);
  const [creating, setCreating] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [createError, setCreateError] = React.useState<string | null>(null);

  async function createTeam() {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/client/va-teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not create the team.");
      setTeams((prev) => [...prev, { ...body, members: body.members ?? [] }]);
      setNewName("");
    } catch (err: any) {
      setCreateError(err.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-5">
      {teams.length === 0 ? (
        <EEmptyState
          title="No assistant teams yet"
          description="Create a team, choose what it can do, then invite your assistant by email."
        />
      ) : null}

      {teams.map((team) => (
        <TeamCard
          key={team.id}
          team={team}
          properties={properties}
          onChange={(next) => setTeams((prev) => prev.map((t) => (t.id === next.id ? next : t)))}
          onRemoved={() => setTeams((prev) => prev.filter((t) => t.id !== team.id))}
        />
      ))}

      <ECard>
        <ECardBody className="space-y-3 p-6">
          <div>
            <EEyebrow>Add</EEyebrow>
            <h2 className="e-display-sm mt-1">New assistant team</h2>
            <p className="mt-1 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
              A new team starts with no permissions and access to every property. Narrow both below
              once it exists.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[220px] flex-1">
              <ELabel htmlFor="va-team-name">Team name</ELabel>
              <EInput
                id="va-team-name"
                value={newName}
                placeholder="e.g. Property assistants"
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <EButton onClick={createTeam} disabled={creating || !newName.trim()} size="sm">
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Create team
            </EButton>
          </div>
          {createError ? <EInlineNotice tone="danger">{createError}</EInlineNotice> : null}
        </ECardBody>
      </ECard>
    </div>
  );
}

function TeamCard({
  team,
  properties,
  onChange,
  onRemoved,
}: {
  team: VaTeamView;
  properties: PropertyOption[];
  onChange: (next: VaTeamView) => void;
  onRemoved: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const permissions = team.permissions ?? {};
  const scope = team.propertyIds ?? [];

  /** PATCH the team, reverting the optimistic state if the server refuses. */
  async function patch(payload: Record<string, unknown>, optimistic: VaTeamView) {
    const previous = team;
    onChange(optimistic);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/client/va-teams/${team.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not save.");
      onChange({ ...optimistic, ...body, members: optimistic.members });
      setNotice("Saved.");
    } catch (err: any) {
      onChange(previous);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function togglePermission(key: VaPermissionKey, next: boolean) {
    const nextPermissions = { ...permissions, [key]: next };
    void patch({ permissions: nextPermissions }, { ...team, permissions: nextPermissions });
  }

  function toggleProperty(propertyId: string, next: boolean) {
    const nextScope = next ? [...scope, propertyId] : scope.filter((id) => id !== propertyId);
    void patch(
      { propertyIds: nextScope },
      { ...team, propertyIds: nextScope.length > 0 ? nextScope : null }
    );
  }

  async function removeTeam() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/client/va-teams/${team.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Could not remove the team.");
      }
      onRemoved();
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <ECard>
      <ECardBody className="space-y-5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <EEyebrow>Team</EEyebrow>
            <h2 className="e-display-sm mt-1 flex items-center gap-2">
              {team.name}
              {team.isActive ? null : <EBadge tone="warning">Paused</EBadge>}
            </h2>
            <p className="mt-1 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
              {scope.length === 0
                ? "Access to every property you own."
                : `Access limited to ${scope.length} of your ${properties.length} properties.`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <ESwitch
              checked={team.isActive}
              disabled={busy}
              label="Active"
              onCheckedChange={(v) => patch({ isActive: v }, { ...team, isActive: v })}
            />
            <EButton variant="outline" size="sm" onClick={removeTeam} disabled={busy}>
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </EButton>
          </div>
        </div>

        <section className="space-y-2">
          <ELabel>What this team can do</ELabel>
          <div className="grid gap-2 sm:grid-cols-2">
            {VA_PERMISSION_KEYS.map((key) => (
              <ECheckTile
                key={key}
                checked={permissions[key] === true}
                onChange={(next) => togglePermission(key, next)}
              >
                <span>
                  <span className="block font-medium">{PERMISSION_LABELS[key].title}</span>
                  <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    {PERMISSION_LABELS[key].hint}
                  </span>
                </span>
              </ECheckTile>
            ))}
          </div>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            Approving quotes, extras and costs, and paying invoices, are never delegable — no
            setting here grants them.
          </p>
        </section>

        <section className="space-y-2">
          <ELabel>Which properties</ELabel>
          {properties.length === 0 ? (
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              You have no properties yet.
            </p>
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                {properties.map((p) => (
                  <ECheckTile
                    key={p.id}
                    checked={scope.includes(p.id)}
                    onChange={(next) => toggleProperty(p.id, next)}
                  >
                    {p.name}
                  </ECheckTile>
                ))}
              </div>
              <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                Select none to give the team every property, including ones you add later.
              </p>
            </>
          )}
        </section>

        <MemberSection team={team} onChange={onChange} onBusy={setBusy} onError={setError} />

        {error ? <EInlineNotice tone="danger">{error}</EInlineNotice> : null}
        {notice && !error ? <EInlineNotice tone="success">{notice}</EInlineNotice> : null}
      </ECardBody>
    </ECard>
  );
}

function MemberSection({
  team,
  onChange,
  onBusy,
  onError,
}: {
  team: VaTeamView;
  onChange: (next: VaTeamView) => void;
  onBusy: (v: boolean) => void;
  onError: (v: string | null) => void;
}) {
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [inviting, setInviting] = React.useState(false);
  const [inviteNotice, setInviteNotice] = React.useState<string | null>(null);
  const [inviteError, setInviteError] = React.useState<string | null>(null);

  async function invite() {
    if (!email.trim()) return;
    setInviting(true);
    setInviteError(null);
    setInviteNotice(null);
    try {
      const res = await fetch(`/api/client/va-teams/${team.id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), name: name.trim() || undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not send the invitation.");

      onChange({
        ...team,
        members: [
          ...team.members.filter((m) => m.id !== body.userId),
          {
            id: body.userId,
            email: body.email,
            name: name.trim() || null,
            isActive: true,
            invitation: { acceptedAt: null, expiresAt: body.expiresAt },
          },
        ],
      });
      // The invitation row is real either way; say so rather than implying the
      // email definitely arrived.
      setInviteNotice(
        body.emailSent
          ? `Invitation sent to ${body.email}.`
          : `Invitation created, but the email could not be sent (${body.emailError ?? "unknown error"}). Try again shortly.`
      );
      setEmail("");
      setName("");
    } catch (err: any) {
      setInviteError(err.message);
    } finally {
      setInviting(false);
    }
  }

  async function removeMember(userId: string) {
    onBusy(true);
    onError(null);
    try {
      const res = await fetch(`/api/client/va-teams/${team.id}/members/${userId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Could not remove the member.");
      }
      onChange({ ...team, members: team.members.filter((m) => m.id !== userId) });
    } catch (err: any) {
      onError(err.message);
    } finally {
      onBusy(false);
    }
  }

  return (
    <section className="space-y-2">
      <ELabel>Assistants</ELabel>

      {team.members.length === 0 ? (
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          Nobody invited yet.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {team.members.map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-[0.8125rem] font-medium">{m.name ?? m.email}</p>
                {m.name ? (
                  <p className="truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    {m.email}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {m.invitation?.acceptedAt ? (
                  <EBadge tone="success">Active</EBadge>
                ) : (
                  <EBadge tone="warning">Invited</EBadge>
                )}
                <EButton
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${m.email}`}
                  onClick={() => removeMember(m.id)}
                >
                  <X className="h-3.5 w-3.5" />
                </EButton>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-2 pt-1">
        <div className="min-w-[200px] flex-1">
          <ELabel htmlFor={`invite-email-${team.id}`}>Email</ELabel>
          <EInput
            id={`invite-email-${team.id}`}
            type="email"
            value={email}
            placeholder="assistant@example.com"
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="min-w-[150px] flex-1">
          <ELabel htmlFor={`invite-name-${team.id}`}>Name (optional)</ELabel>
          <EInput
            id={`invite-name-${team.id}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <EButton size="sm" variant="outline" onClick={invite} disabled={inviting || !email.trim()}>
          {inviting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <UserPlus className="h-3.5 w-3.5" />
          )}
          Invite
        </EButton>
      </div>

      {inviteError ? <EInlineNotice tone="danger">{inviteError}</EInlineNotice> : null}
      {inviteNotice && !inviteError ? (
        <EInlineNotice tone="info">{inviteNotice}</EInlineNotice>
      ) : null}
    </section>
  );
}
