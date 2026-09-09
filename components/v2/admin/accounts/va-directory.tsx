"use client";

import * as React from "react";
import Link from "next/link";
import { Loader2, ShieldCheck } from "lucide-react";
import { EInput, ESwitch } from "@/components/v2/admin/estate-kit";
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
 * Every assistant login, across every client — the DIRECTORY.
 *
 * The invite manager below this on the page is client-scoped by design: pick a
 * client, then work on that client's teams. Which meant the accounts page could
 * CREATE assistants but never LIST them — an assistant onboarded last month
 * appeared nowhere unless you already remembered which client they belonged
 * to. Every other account type gets a flat list on its tab; this is the same
 * list for assistants, with the team context (client, grants, scope) that
 * makes a VA row meaningful.
 *
 * Row actions are the SAME menu every other account row gets (edit details,
 * reset password, reset 2FA, delete — the /api/admin/users/[id]/* routes were
 * always role-agnostic), plus the two things only an assistant has: a link to
 * the full profile (which carries the activity log), and the team's
 * permissions editor.
 */

interface DirectoryVaTeam {
  id: string;
  name: string;
  isActive: boolean;
  permissions: Record<string, boolean> | null;
  propertyIds: string[] | null;
  client: { id: string; name: string } | null;
}

interface DirectoryRow {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  isActive: boolean;
  emailVerified: string | null;
  twoFactorEnabled: boolean;
  vaTeam: DirectoryVaTeam | null;
}

interface PropertyOption {
  id: string;
  name: string;
}

function grantedCount(permissions: Record<string, boolean> | null): number {
  if (!permissions) return 0;
  return VA_PERMISSION_KEYS.filter((key) => permissions[key] === true).length;
}

export function EstateVaDirectory({ canManage }: { canManage: boolean }) {
  const [rows, setRows] = React.useState<DirectoryRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [editingTeam, setEditingTeam] = React.useState<DirectoryVaTeam | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/admin/users?role=VA&includeInactive=1", { cache: "no-store" });
      if (!res.ok) throw new Error("Could not load assistants.");
      setRows((await res.json()) as DirectoryRow[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load assistants.");
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const needle = query.trim().toLowerCase();
  const visible = (rows ?? []).filter((row) => {
    if (!needle) return true;
    return [row.name, row.email, row.vaTeam?.name, row.vaTeam?.client?.name]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(needle));
  });

  return (
    <ECard>
      <ECardHeader className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <ECardTitle>All assistants</ECardTitle>
          <p className="mt-1 text-sm text-[hsl(var(--e-text-muted))]">
            Every assistant login across every client. Onboard new ones below.
          </p>
        </div>
        <div className="w-full sm:w-64">
          <EInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, email, client, team"
            aria-label="Search assistants"
          />
        </div>
      </ECardHeader>
      <ECardBody>
        {error ? <EAlert tone="danger">{error}</EAlert> : null}
        {rows === null && !error ? (
          <div className="flex items-center gap-2 py-8 text-sm text-[hsl(var(--e-text-muted))]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading assistants…
          </div>
        ) : null}
        {rows !== null && rows.length === 0 ? (
          <EEmptyState
            title="No assistants yet"
            description="Invite the first one below — pick the client they will act for."
          />
        ) : null}
        {rows !== null && rows.length > 0 && visible.length === 0 ? (
          <EEmptyState title="No matches" description={`Nothing matches “${query.trim()}”.`} />
        ) : null}

        <ul className="divide-y divide-[hsl(var(--e-border))]">
          {visible.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium">{row.name || row.email}</span>
                  {!row.isActive ? <EBadge tone="neutral">Inactive</EBadge> : null}
                  {!row.emailVerified ? <EBadge tone="warning">Invite pending</EBadge> : null}
                  {row.twoFactorEnabled ? <EBadge tone="success">2FA</EBadge> : null}
                </div>
                <div className="mt-0.5 truncate text-sm text-[hsl(var(--e-text-muted))]">
                  {row.email}
                  {row.vaTeam?.client ? <> · {row.vaTeam.client.name}</> : null}
                  {row.vaTeam ? <> · {row.vaTeam.name}</> : null}
                </div>
                {row.vaTeam ? (
                  <div className="mt-0.5 text-xs text-[hsl(var(--e-text-muted))]">
                    {grantedCount(row.vaTeam.permissions)} of {VA_PERMISSION_KEYS.length} permissions ·{" "}
                    {row.vaTeam.propertyIds?.length
                      ? `${row.vaTeam.propertyIds.length} properties`
                      : "all properties"}
                    {!row.vaTeam.isActive ? " · team disabled" : ""}
                  </div>
                ) : (
                  // Input-with-no-output guard: a VA row with no team is a
                  // stranded login that can access nothing. Say so rather than
                  // rendering it indistinguishable from a working one.
                  <div className="mt-0.5 text-xs text-[hsl(var(--e-warning))]">
                    No team — this login has no client access. Re-invite them below or delete it.
                  </div>
                )}
              </div>
              <span className="flex shrink-0 items-center gap-2">
                <EButton asChild size="sm" variant="ghost">
                  <Link href={`/v2/admin/accounts/users/${row.id}`}>Profile</Link>
                </EButton>
                {canManage && row.vaTeam ? (
                  <EButton
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditingTeam(row.vaTeam)}
                    title="Edit this team's permissions and property scope"
                  >
                    <ShieldCheck className="mr-1 h-3.5 w-3.5" /> Permissions
                  </EButton>
                ) : null}
                {canManage ? (
                  <AccountActionsMenu
                    account={{ id: row.id, name: row.name, email: row.email }}
                    onChanged={load}
                  />
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </ECardBody>

      {editingTeam ? (
        <VaTeamPermissionsEditor
          team={editingTeam}
          onClose={() => setEditingTeam(null)}
          onSaved={async () => {
            setEditingTeam(null);
            await load();
          }}
        />
      ) : null}
    </ECard>
  );
}

/**
 * Edit ONE team's grants, property scope and active state, as an admin.
 *
 * Changes apply to the TEAM — every assistant on it — because that is the unit
 * the model has: grants have always lived on VaTeam, and a per-person editor
 * would be a misleading UI over the same column.
 */
function VaTeamPermissionsEditor({
  team,
  onClose,
  onSaved,
}: {
  team: DirectoryVaTeam;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [permissions, setPermissions] = React.useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const key of VA_PERMISSION_KEYS) initial[key] = team.permissions?.[key] === true;
    return initial;
  });
  const [teamActive, setTeamActive] = React.useState(team.isActive);
  const [scopeIds, setScopeIds] = React.useState<string[]>(team.propertyIds ?? []);
  const [properties, setProperties] = React.useState<PropertyOption[] | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // The scope picker needs the client's property list; the invite endpoint
  // already serves exactly that per client, so reuse it rather than adding a
  // second properties-by-client route.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!team.client) {
        setProperties([]);
        return;
      }
      try {
        const res = await fetch(
          `/api/admin/va-invites?clientId=${encodeURIComponent(team.client.id)}`,
          { cache: "no-store" }
        );
        if (!res.ok) throw new Error("Could not load properties.");
        const data = (await res.json()) as { properties?: PropertyOption[] };
        if (!cancelled) setProperties(Array.isArray(data.properties) ? data.properties : []);
      } catch {
        if (!cancelled) setProperties([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [team.client]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/va-invites/${encodeURIComponent(team.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          permissions,
          isActive: teamActive,
          // Empty selection means "every property this client owns" — the
          // stored convention (null) rather than an impossible empty scope.
          propertyIds: scopeIds.length > 0 ? scopeIds : null,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Could not save the team.");
      }
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the team.");
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${team.name}`}
    >
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">{team.name}</h3>
            <p className="mt-0.5 text-sm text-[hsl(var(--e-text-muted))]">
              {team.client?.name ?? "Unknown client"} · changes apply to every assistant on this team
            </p>
          </div>
          <EButton size="sm" variant="ghost" onClick={onClose} disabled={saving}>
            Close
          </EButton>
        </div>

        {error ? (
          <div className="mt-3">
            <EAlert tone="danger">{error}</EAlert>
          </div>
        ) : null}

        <div className="mt-4">
          <ESwitch
            checked={teamActive}
            onCheckedChange={setTeamActive}
            label={
              <span>
                Team enabled
                <span className="block text-xs font-normal text-[hsl(var(--e-text-muted))]">
                  Off pauses portal access for everyone on the team, without deleting anything.
                </span>
              </span>
            }
          />
        </div>

        <h4 className="mt-5 text-sm font-semibold">Permissions</h4>
        <div className="mt-2 space-y-2">
          {VA_PERMISSION_KEYS.map((key: VaPermissionKey) => (
            <ESwitch
              key={key}
              checked={permissions[key] === true}
              onCheckedChange={(next) =>
                setPermissions((prev) => ({ ...prev, [key]: next === true }))
              }
              label={
                <span>
                  {VA_PERMISSION_LABELS[key].title}
                  <span className="block text-xs font-normal text-[hsl(var(--e-text-muted))]">
                    {VA_PERMISSION_LABELS[key].hint}
                  </span>
                </span>
              }
            />
          ))}
        </div>

        <h4 className="mt-5 text-sm font-semibold">Property scope</h4>
        <p className="mt-1 text-xs text-[hsl(var(--e-text-muted))]">
          Nothing ticked means every property this client owns, now and in future.
        </p>
        <div className="mt-2 space-y-1.5">
          {properties === null ? (
            <div className="flex items-center gap-2 text-sm text-[hsl(var(--e-text-muted))]">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading properties…
            </div>
          ) : properties.length === 0 ? (
            <p className="text-sm text-[hsl(var(--e-text-muted))]">This client has no properties.</p>
          ) : (
            properties.map((property) => (
              <label key={property.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={scopeIds.includes(property.id)}
                  onChange={(event) =>
                    setScopeIds((prev) =>
                      event.target.checked
                        ? [...prev, property.id]
                        : prev.filter((id) => id !== property.id)
                    )
                  }
                />
                {property.name}
              </label>
            ))
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <EButton variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </EButton>
          <EButton onClick={save} disabled={saving}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Save team
          </EButton>
        </div>
      </div>
    </div>
  );
}
