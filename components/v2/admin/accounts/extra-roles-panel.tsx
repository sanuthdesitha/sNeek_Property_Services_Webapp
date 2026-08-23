"use client";

/**
 * "ALSO WORKS AS" — the extra hats on one staff account.
 *
 * The business has people who clean and also inspect, or drive laundry and also
 * clean. Their PRIMARY role is their job and does not move; this grants the
 * second one, which is what lets them switch portals and what every
 * authorisation check is then answered against.
 *
 * THE LIST IS DELIBERATELY SHORT. Admin and ops manager are not offerable —
 * administrative reach as a side hat is a privilege-escalation path — and
 * client / VA are scoped to a particular client account rather than granted
 * generically. The API refuses all four on its own; this only avoids offering
 * what it would reject.
 *
 *   POST   /api/admin/users/:id/roles   { role }
 *   DELETE /api/admin/users/:id/roles?role=…
 */
import * as React from "react";
import { Role } from "@prisma/client";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  EAlert,
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
} from "@/components/v2/ui/primitives";
import { EConfirmButton, EField, ESelect } from "@/components/v2/admin/estate-kit";
import { GRANTABLE_EXTRA_ROLES, ROLE_LABELS } from "@/lib/auth/roles";

export interface ExtraRoleView {
  role: Role;
  label: string;
  /** ISO string — this is a client component, so Dates cannot cross the boundary. */
  grantedAt: string;
  grantedBy: { id: string; name: string | null; email: string | null } | null;
}

/** Sydney, always. The business runs on one clock and grants are dated by it. */
function fmtSydney(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown date";
  return date.toLocaleString("en-AU", {
    timeZone: "Australia/Sydney",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ExtraRolesPanel({
  userId,
  userName,
  primaryRole,
  initialExtraRoles,
  canManage,
}: {
  userId: string;
  userName: string;
  primaryRole: Role;
  initialExtraRoles: ExtraRoleView[];
  /**
   * ADMIN only. An ops manager can read this account and needs to know which
   * hats it wears, but the endpoints refuse them — showing controls that answer
   * 403 would teach them the screen is broken rather than that the power is not
   * theirs.
   */
  canManage: boolean;
}) {
  const [rows, setRows] = React.useState<ExtraRoleView[]>(initialExtraRoles);
  const [pending, setPending] = React.useState<string | null>(null);
  const [choice, setChoice] = React.useState<string>("");

  // Their own job is never on the menu: `heldRoles` collapses a duplicate, so
  // granting it would create a row that changes nothing yet looks revocable.
  const available = GRANTABLE_EXTRA_ROLES.filter(
    (role) => role !== primaryRole && !rows.some((row) => row.role === role)
  );

  async function mutate(request: () => Promise<Response>, busyKey: string, successTitle: string) {
    setPending(busyKey);
    try {
      const res = await request();
      const body = await res.json().catch(() => ({}));
      // Even the refusals carry the current list where they can, so a second
      // admin's change lands on this screen instead of leaving it stale.
      if (Array.isArray(body.extraRoles)) setRows(body.extraRoles as ExtraRoleView[]);
      if (!res.ok) throw new Error(body.error ?? "The change was not saved.");
      setChoice("");
      toast({ title: successTitle });
    } catch (err: any) {
      toast({
        title: "Role change failed",
        description: err?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setPending(null);
    }
  }

  return (
    <ECard>
      <ECardHeader className="pb-2">
        <ECardTitle className="text-[0.95rem]">
          <span className="inline-flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> Also works as
          </span>
        </ECardTitle>
      </ECardHeader>
      <ECardBody className="space-y-3 pt-0 text-[0.8125rem]">
        <p className="text-[hsl(var(--e-muted-foreground))]">
          {userName} is a <span className="font-[550]">{ROLE_LABELS[primaryRole]}</span>. Extra roles
          let them switch portals and are checked by every permission in the app — grant them only
          for work this person actually does.
        </p>

        {rows.length === 0 ? (
          <p className="text-[hsl(var(--e-text-faint))]">
            No extra roles. They see only the {ROLE_LABELS[primaryRole]} portal.
          </p>
        ) : (
          <ul className="divide-y divide-[hsl(var(--e-border)/0.7)] border-y border-[hsl(var(--e-border)/0.7)]">
            {rows.map((row) => (
              <li key={row.role} className="flex flex-wrap items-center gap-2 py-2.5">
                <div className="min-w-0 flex-1">
                  <EBadge tone="gold" soft>
                    {row.label ?? ROLE_LABELS[row.role]}
                  </EBadge>
                  <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                    Granted {fmtSydney(row.grantedAt)}
                    {/* The granter can be null: `grantedById` is SetNull, so the
                        record survives the admin who made it leaving. */}
                    {row.grantedBy
                      ? ` by ${row.grantedBy.name ?? row.grantedBy.email ?? "an admin"}`
                      : " · granting admin no longer on file"}
                  </p>
                </div>
                {!canManage ? null : (
                <EConfirmButton
                  disabled={pending !== null}
                  ariaLabel={`Remove the ${row.label ?? ROLE_LABELS[row.role]} role`}
                  confirmLabel="Remove?"
                  onConfirm={() =>
                    mutate(
                      () =>
                        fetch(
                          `/api/admin/users/${userId}/roles?role=${encodeURIComponent(row.role)}`,
                          { method: "DELETE" }
                        ),
                      row.role,
                      `${row.label ?? ROLE_LABELS[row.role]} removed`
                    )
                  }
                >
                  {pending === row.role ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Remove"}
                </EConfirmButton>
                )}
              </li>
            ))}
          </ul>
        )}

        {!canManage ? (
          <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
            Only an admin can add or remove roles.
          </p>
        ) : available.length === 0 ? (
          <EAlert tone="info">
            Every role that can be granted as an extra is already on this account.
          </EAlert>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <EField label="Add a role" className="min-w-[12rem] flex-1">
              <ESelect
                value={choice}
                disabled={pending !== null}
                onChange={(event) => setChoice(event.target.value)}
              >
                <option value="">Select a role…</option>
                {available.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </ESelect>
            </EField>
            <EButton
              variant="gold"
              size="sm"
              disabled={!choice || pending !== null}
              onClick={() =>
                mutate(
                  () =>
                    fetch(`/api/admin/users/${userId}/roles`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ role: choice }),
                    }),
                  choice,
                  `${ROLE_LABELS[choice as Role]} added`
                )
              }
            >
              {pending === choice ? "Granting…" : "Grant"}
            </EButton>
          </div>
        )}
      </ECardBody>
    </ECard>
  );
}
