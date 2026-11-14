"use client";

/**
 * The limits of the sending safeguards. Administrators edit them inside their
 * safe bounds and confirm with their own PIN; everyone else reads them. The
 * draft is frozen while saving and kept when a save fails.
 */
import * as React from "react";
import { EAlert, EButton, ECard } from "@/components/v2/ui/primitives";
import { EConfirmDialog, type ConfirmResult } from "@/components/v2/ui/confirm-dialog";
import {
  GROUP_LIMIT_BOUNDS,
  GROUP_LIMIT_LABEL,
  LIMIT_BOUNDS,
  LIMIT_GROUPS,
  LIMIT_GROUP_LABEL,
  LIMIT_LABEL,
  limitsOutOfBounds,
  type GroupLimits,
  type LimitGroup,
  type SafeguardLimits,
  type SafeguardSettings,
} from "@/lib/notifications/safeguards/config";

type Props = {
  settings: SafeguardSettings;
  canManage: boolean;
  saving: boolean;
  disabled: boolean;
  onSave: (limits: SafeguardLimits, credentials: ConfirmResult["credentials"]) => Promise<string | null>;
};

type ScalarKey = keyof typeof LIMIT_BOUNDS;

function NumberField({ id, label, value, min, max, onChange }: { id: string; label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  const hintId = `${id}-hint`;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-[0.8125rem] font-medium [overflow-wrap:anywhere]">{label}</label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={Number.isFinite(value) ? value : ""}
        aria-describedby={hintId}
        onChange={(event) => onChange(event.target.value === "" ? Number.NaN : Number(event.target.value))}
        className="min-h-[44px] rounded-[var(--e-radius-md)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 text-[1rem] sm:text-[0.875rem]"
      />
      <span id={hintId} className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{min} to {max}</span>
    </div>
  );
}

export function SafeguardLimitsForm({ settings, canManage, saving, disabled, onSave }: Props) {
  const [draft, setDraft] = React.useState<SafeguardLimits>(settings.limits);
  const [dirty, setDirty] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  // A fresh server copy replaces the draft only when nothing is being edited.
  React.useEffect(() => {
    if (!dirty) setDraft(settings.limits);
  }, [settings.limits, dirty]);

  const problems = canManage && dirty ? limitsOutOfBounds(draft) : [];

  function setGroup(group: LimitGroup, key: keyof GroupLimits, value: number) {
    setDirty(true);
    setDraft((current) => ({ ...current, [group]: { ...current[group], [key]: value } }));
  }

  function setScalar(key: ScalarKey, value: number) {
    setDirty(true);
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function setQuiet(patch: Partial<SafeguardLimits["quietHours"]>) {
    setDirty(true);
    setDraft((current) => ({ ...current, quietHours: { ...current.quietHours, ...patch } }));
  }

  async function confirmSave(result: ConfirmResult) {
    setSaveError(null);
    const problem = await onSave(draft, result.credentials);
    if (problem) {
      setSaveError(problem);
      return;
    }
    setDirty(false);
    setConfirmOpen(false);
  }

  return (
    <ECard className="min-w-0">
      <section aria-labelledby="limits-title" className="space-y-4 p-4 sm:p-6">
        <div>
          <h2 id="limits-title" className="text-[1rem] font-semibold">Limits</h2>
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            Per person and per transport; the inbox is never limited. Security messages (sign-in codes, password resets, invitations) skip the ceilings but are still never sent twice. Defaults are pending the owner's confirmation.
          </p>
        </div>
        <fieldset disabled={!canManage || saving || disabled} className="min-w-0 space-y-4">
          <legend className="sr-only">Sending limits</legend>
          <div className="grid min-w-0 gap-4 lg:grid-cols-3">
            {LIMIT_GROUPS.map((group) => (
              <div key={group} className="min-w-0 space-y-3 rounded-[var(--e-radius-md)] border border-[hsl(var(--e-border))] p-3">
                <h3 className="text-[0.875rem] font-semibold">{LIMIT_GROUP_LABEL[group]}</h3>
                {(Object.keys(GROUP_LIMIT_BOUNDS[group]) as Array<keyof GroupLimits>).map((key) => (
                  <NumberField key={key} id={`limit-${group}-${key}`} label={GROUP_LIMIT_LABEL[key]} value={draft[group][key]} min={GROUP_LIMIT_BOUNDS[group][key].min} max={GROUP_LIMIT_BOUNDS[group][key].max} onChange={(value) => setGroup(group, key, value)} />
                ))}
              </div>
            ))}
          </div>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(Object.keys(LIMIT_BOUNDS) as ScalarKey[]).map((key) => (
              <NumberField key={key} id={`limit-${key}`} label={LIMIT_LABEL[key]} value={draft[key]} min={LIMIT_BOUNDS[key].min} max={LIMIT_BOUNDS[key].max} onChange={(value) => setScalar(key, value)} />
            ))}
          </div>
          <div className="grid min-w-0 gap-3 sm:grid-cols-3">
            <label className="flex min-h-[44px] items-center gap-2 text-[0.875rem] font-medium">
              <input type="checkbox" className="h-5 w-5" checked={draft.quietHours.enabled} onChange={(event) => setQuiet({ enabled: event.target.checked })} />
              Quiet hours for staff
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-[0.8125rem] font-medium">
              Quiet from
              <input type="time" value={draft.quietHours.start} onChange={(event) => setQuiet({ start: event.target.value })} className="min-h-[44px] rounded-[var(--e-radius-md)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 text-[1rem] sm:text-[0.875rem]" />
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-[0.8125rem] font-medium">
              Quiet until
              <input type="time" value={draft.quietHours.end} onChange={(event) => setQuiet({ end: event.target.value })} className="min-h-[44px] rounded-[var(--e-radius-md)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 text-[1rem] sm:text-[0.875rem]" />
            </label>
          </div>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            Quiet hours use the organisation timezone. Urgent types (cancellations, job changes, offers, field alerts) always go. Reminders and summaries are dropped at night (inbox copy kept); other email and SMS is held and sent once in the morning, or dropped after 12 hours.
          </p>
        </fieldset>
        {problems.length ? (
          <EAlert tone="warning" title="Check these values"><ul className="list-disc pl-4">{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul></EAlert>
        ) : null}
        {canManage ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <EButton variant="ghost" className="min-h-[44px]" disabled={!dirty || saving} onClick={() => { setDirty(false); setDraft(settings.limits); setSaveError(null); }}>Discard changes</EButton>
            <EButton className="min-h-[44px]" disabled={!dirty || saving || disabled || problems.length > 0} onClick={() => { setSaveError(null); setConfirmOpen(true); }}>{saving ? "Saving…" : "Save limits"}</EButton>
          </div>
        ) : null}
      </section>
      <EConfirmDialog
        open={confirmOpen}
        onClose={() => { if (!saving) setConfirmOpen(false); }}
        tier="sensitive"
        title="Save the new limits?"
        description="They apply to the next message sent, on every server."
        confirmLabel="Save limits"
        busy={saving}
        error={saveError}
        onConfirm={confirmSave}
      />
    </ECard>
  );
}
