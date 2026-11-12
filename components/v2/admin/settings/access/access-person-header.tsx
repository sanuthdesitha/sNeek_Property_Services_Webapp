"use client";

import { ESwitch } from "@/components/v2/admin/estate-kit";
import { EButton } from "@/components/v2/ui/primitives";
import { isFullAccess } from "@/lib/rbac/access-draft";
import { personGroup, ROLE_NAMES, type AccessPerson } from "@/lib/rbac/access-screen-types";
import { listPresets, type OpsPolicy } from "@/lib/rbac/ops-policy";
import { AccessBadge } from "./access-badges";
import { displayName, formatDay, initials } from "./access-labels";

function roleLine(draft: OpsPolicy, person: AccessPerson): string {
  const group = personGroup(draft, person);
  if (group === "admin") return "Administrator";
  if (group === "assistant") return "Office assistant · operations manager login";
  if (group === "manager") return "Operations manager";
  return `${ROLE_NAMES[person.role] ?? person.role} with office access`;
}

export function AccessPersonHeader({
  person,
  draft,
  timeZone,
  isAdminTarget,
  editable,
  onPreset,
  onCopy,
  onFullAccess,
}: {
  person: AccessPerson;
  draft: OpsPolicy;
  timeZone: string;
  isAdminTarget: boolean;
  editable: boolean;
  onPreset: (presetId: string) => void;
  onCopy: () => void;
  onFullAccess: (on: boolean) => void;
}) {
  const presetId = draft.assignments[person.id]?.presetId ?? "existing";
  return (
    <div className="flex flex-col gap-2.5 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden className="inline-flex h-[42px] w-[42px] flex-none items-center justify-center rounded-full bg-[hsl(var(--e-primary-soft))] text-[0.875rem] font-[600] text-[hsl(var(--e-primary))]">
            {initials(person.name, person.email)}
          </span>
          <div className="min-w-0">
            <h2 className="e-display-sm break-words text-[1.25rem]">{displayName(person)}</h2>
            <span className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              {roleLine(draft, person)} · since {formatDay(person.createdAt, timeZone)}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <AccessBadge tone="ok">Active</AccessBadge>
          <AccessBadge>{person.twoFactorEnabled ? "2FA on" : "2FA off"}</AccessBadge>
        </div>
      </div>
      {isAdminTarget ? (
        <p className="text-[0.8125rem]">
          <b>Full access (administrator).</b> Administrators have every right by rule and are never limited by presets or levels. To limit this person, change their role in{" "}
          <a className="underline" href={`/v2/admin/accounts/users/${encodeURIComponent(person.id)}`}>Accounts</a>.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[0.75rem] font-[550] text-[hsl(var(--e-text-secondary))]" htmlFor="access-start-from">Start from</label>
              <select
                id="access-start-from"
                className="min-h-10 w-[210px] max-w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 text-base sm:text-[0.875rem]"
                value={presetId}
                disabled={!editable}
                onChange={(event) => onPreset(event.target.value)}
              >
                {listPresets(draft).map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
              </select>
            </div>
            <EButton variant="outline" size="sm" disabled={!editable} onClick={onCopy}>Copy access from…</EButton>
            <span className="flex-1" />
            <ESwitch checked={isFullAccess(draft, person.id)} disabled={!editable} onCheckedChange={onFullAccess} label={<b className="text-[hsl(var(--e-foreground))]">Full access</b>} />
          </div>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            <b>Off</b> hidden · <b>View</b> look, not change · <b>Manage</b> everyday actions · <b>Full</b> adds <AccessBadge tone="warn">!</AccessBadge> sensitive actions, asked for the person's own PIN
          </p>
        </>
      )}
    </div>
  );
}
