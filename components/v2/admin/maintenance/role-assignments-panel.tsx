"use client";

/**
 * CP-6 — ESTATE admin panel: who is on this maintenance item, by role.
 *
 * The three roles render as three SEPARATE cards with their own picker and
 * their own save button. That separation is the feature: a maintenance worker,
 * a cleaner and a QA inspector do different jobs on the same item, and an admin
 * saving the cleaner column must never disturb the QA column.
 *
 * Endpoints:
 *   GET  /api/admin/maintenance/:id/assignees → { assignments, candidates }
 *   POST /api/admin/maintenance/:id/assignees   { role, userIds }
 */

import * as React from "react";
import { MaintenanceAssigneeRole } from "@prisma/client";
import { Loader2, Mail, MailCheck, UserCheck, Users } from "lucide-react";
import {
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EBadge,
  EAlert,
} from "@/components/v2/ui/primitives";
import {
  MAINTENANCE_ASSIGNEE_ROLES,
  MAINTENANCE_ASSIGNEE_ROLE_LABELS,
} from "@/lib/maintenance/assignment-roles";

interface Candidate {
  id: string;
  name: string | null;
  email: string | null;
}

interface AssignmentRow {
  id: string;
  role: MaintenanceAssigneeRole;
  userId: string;
  assignedAt: string;
  removedAt: string | null;
  notifiedAt: string | null;
  user: { id: string; name: string | null; email: string | null } | null;
}

type Candidates = Record<MaintenanceAssigneeRole, Candidate[]>;

const EMPTY_CANDIDATES: Candidates = {
  [MaintenanceAssigneeRole.MAINTENANCE]: [],
  [MaintenanceAssigneeRole.CLEANER]: [],
  [MaintenanceAssigneeRole.QA]: [],
};

/** Roles are never collapsed — an empty role still renders its own card. */
function activeIdsByRole(rows: AssignmentRow[]): Record<MaintenanceAssigneeRole, string[]> {
  const out: Record<MaintenanceAssigneeRole, string[]> = {
    [MaintenanceAssigneeRole.MAINTENANCE]: [],
    [MaintenanceAssigneeRole.CLEANER]: [],
    [MaintenanceAssigneeRole.QA]: [],
  };
  for (const row of rows) {
    if (row.removedAt) continue;
    out[row.role].push(row.userId);
  }
  return out;
}

function fmtSydney(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-AU", {
    timeZone: "Australia/Sydney",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function MaintenanceRoleAssignmentsPanel({ itemId }: { itemId: string }) {
  const [rows, setRows] = React.useState<AssignmentRow[]>([]);
  const [candidates, setCandidates] = React.useState<Candidates>(EMPTY_CANDIDATES);
  const [selected, setSelected] = React.useState<Record<MaintenanceAssigneeRole, string[]>>(
    activeIdsByRole([])
  );
  const [loading, setLoading] = React.useState(true);
  const [savingRole, setSavingRole] = React.useState<MaintenanceAssigneeRole | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/maintenance/${itemId}/assignees`, { cache: "no-store" });
      if (!res.ok) return;
      const body = await res.json();
      const loaded: AssignmentRow[] = Array.isArray(body.assignments) ? body.assignments : [];
      setRows(loaded);
      setCandidates({ ...EMPTY_CANDIDATES, ...(body.candidates ?? {}) });
      setSelected(activeIdsByRole(loaded));
    } catch {
      setError("Could not load the assignment roster. Please refresh.");
    }
  }, [itemId]);

  React.useEffect(() => {
    void load().finally(() => setLoading(false));
  }, [load]);

  function toggle(role: MaintenanceAssigneeRole, userId: string) {
    setSelected((prev) => {
      const current = prev[role] ?? [];
      // Immutable update — never splice the array in place.
      return {
        ...prev,
        [role]: current.includes(userId)
          ? current.filter((id) => id !== userId)
          : [...current, userId],
      };
    });
  }

  async function save(role: MaintenanceAssigneeRole) {
    setSavingRole(role);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/maintenance/${itemId}/assignees`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, userIds: selected[role] ?? [] }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Could not save this role. Please retry.");
        return;
      }
      const added: string[] = Array.isArray(body.added) ? body.added : [];
      const removed: string[] = Array.isArray(body.removed) ? body.removed : [];
      const label = MAINTENANCE_ASSIGNEE_ROLE_LABELS[role].toLowerCase();
      setNotice(
        added.length > 0
          ? `${added.length} ${label}${added.length === 1 ? "" : "s"} assigned — an email has been sent.`
          : removed.length > 0
            ? `${removed.length} ${label}${removed.length === 1 ? "" : "s"} removed.`
            : "No change."
      );
      await load();
    } catch {
      setError("Could not save this role. Please retry.");
    } finally {
      setSavingRole(null);
    }
  }

  const byRole = React.useMemo(() => activeIdsByRole(rows), [rows]);
  const rowByUser = React.useMemo(() => {
    const map = new Map<string, AssignmentRow>();
    for (const row of rows) {
      if (!row.removedAt) map.set(`${row.role}:${row.userId}`, row);
    }
    return map;
  }, [rows]);

  if (loading) {
    return (
      <ECard>
        <ECardBody className="flex items-center gap-2 py-6 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading team…
        </ECardBody>
      </ECard>
    );
  }

  return (
    <ECard>
      <ECardHeader>
        <ECardTitle className="flex items-center gap-2 text-[1rem]">
          <Users className="h-4 w-4" /> Team on this item
        </ECardTitle>
      </ECardHeader>
      <ECardBody className="space-y-4">
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          Each role is saved on its own. Newly assigned people are emailed and the item appears in
          their portal.
        </p>

        {error ? <EAlert tone="danger">{error}</EAlert> : null}
        {notice ? <EAlert tone="success">{notice}</EAlert> : null}

        {MAINTENANCE_ASSIGNEE_ROLES.map((role) => {
          const options = candidates[role] ?? [];
          const chosen = selected[role] ?? [];
          const saved = byRole[role] ?? [];
          const dirty =
            chosen.length !== saved.length || chosen.some((id) => !saved.includes(id));

          return (
            <div
              key={role}
              className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-[0.8125rem] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--e-muted-foreground))]">
                  <UserCheck className="h-3.5 w-3.5" />
                  {MAINTENANCE_ASSIGNEE_ROLE_LABELS[role]}
                </p>
                <EBadge tone={saved.length > 0 ? "primary" : "neutral"} soft>
                  {saved.length} assigned
                </EBadge>
              </div>

              {options.length === 0 ? (
                <p className="mt-2 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                  No active accounts with this role.
                </p>
              ) : (
                <div className="mt-2 max-h-56 space-y-1 overflow-y-auto pr-1">
                  {options.map((person) => {
                    const checked = chosen.includes(person.id);
                    const existing = rowByUser.get(`${role}:${person.id}`);
                    const notifiedOn = fmtSydney(existing?.notifiedAt ?? null);
                    return (
                      <label
                        key={person.id}
                        className="flex cursor-pointer items-center gap-2 rounded-[var(--e-radius-sm,0.5rem)] px-1.5 py-1 text-[0.875rem] hover:bg-[hsl(var(--e-surface))]"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(role, person.id)}
                          className="h-3.5 w-3.5 accent-[hsl(var(--e-primary))]"
                        />
                        <span className="min-w-0 flex-1 truncate text-[hsl(var(--e-foreground))]">
                          {person.name ?? person.email ?? "Unnamed"}
                        </span>
                        {existing ? (
                          notifiedOn ? (
                            <span
                              className="flex items-center gap-1 text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]"
                              title={`Assignment email sent ${notifiedOn}`}
                            >
                              <MailCheck className="h-3 w-3" /> {notifiedOn}
                            </span>
                          ) : (
                            <span
                              className="flex items-center gap-1 text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]"
                              title="Assigned, but no email has gone out yet"
                            >
                              <Mail className="h-3 w-3" /> not emailed
                            </span>
                          )
                        ) : null}
                      </label>
                    );
                  })}
                </div>
              )}

              <div className="mt-2 flex items-center gap-2">
                <EButton
                  size="sm"
                  disabled={!dirty || savingRole !== null}
                  onClick={() => void save(role)}
                >
                  {savingRole === role ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                  Save {MAINTENANCE_ASSIGNEE_ROLE_LABELS[role].toLowerCase()}
                </EButton>
                {dirty ? (
                  <EButton
                    size="sm"
                    variant="ghost"
                    onClick={() => setSelected((prev) => ({ ...prev, [role]: saved }))}
                  >
                    Reset
                  </EButton>
                ) : null}
              </div>
            </div>
          );
        })}
      </ECardBody>
    </ECard>
  );
}
