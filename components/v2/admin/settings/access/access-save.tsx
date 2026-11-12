"use client";

import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { EButton } from "@/components/v2/ui/primitives";
import { policyChanges, type AccessChange } from "@/lib/rbac/access-diff";
import type { OpsPolicy } from "@/lib/rbac/ops-policy";
import type { SensitiveCredentialsInput } from "@/lib/security/pin-rules";
import { OwnPinFields, useOwnPinPrompt } from "@/components/v2/shared/own-pin-fields";

export type SaveConflict = { current: OpsPolicy };

function changeLabel(change: AccessChange, names: Record<string, string>): string {
  const who = change.subject.kind === "person" ? names[change.subject.id] ?? "Someone" : `Preset ${change.subject.name}`;
  return `${who}: ${change.text}`;
}

/** The dark bar under the matrix while anything is unsaved. */
export function AccessUnsavedBar({
  saved,
  draft,
  names,
  busy,
  onDiscard,
  onReview,
}: {
  saved: OpsPolicy;
  draft: OpsPolicy;
  names: Record<string, string>;
  busy: boolean;
  onDiscard: () => void;
  onReview: () => void;
}) {
  const changes = policyChanges(saved, draft);
  if (changes.length === 0) return null;
  return (
    <div role="region" aria-label="Unsaved changes" className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-[var(--e-radius-lg)] bg-[hsl(160_20%_14%)] px-4 py-2.5 text-[0.8125rem] text-[hsl(42_25%_94%)] shadow-[var(--e-elevation-2)]">
      <b>{changes.length} unsaved {changes.length === 1 ? "change" : "changes"}</b>
      <span className="min-w-0 truncate text-[hsl(42_25%_80%)]">{changeLabel(changes[0], names)}{changes.length > 1 ? ` and ${changes.length - 1} more` : ""}</span>
      <span className="flex-1" />
      <EButton size="sm" variant="outline" disabled={busy} onClick={onDiscard} className="bg-transparent text-inherit">Discard</EButton>
      <EButton size="sm" disabled={busy} onClick={onReview} className="border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold))] text-[hsl(var(--e-gold-foreground))]">Review and save</EButton>
    </div>
  );
}

/**
 * Review every change, then confirm with the editor's own PIN (or, while they
 * have none, their password once and a new PIN).
 * On a conflict both versions are listed and nothing is overwritten until the
 * editor chooses.
 */
export function AccessSaveDialog({
  open,
  saved,
  draft,
  names,
  busy,
  error,
  conflict,
  onClose,
  onSave,
  onKeepMine,
  onTakeTheirs,
}: {
  open: boolean;
  saved: OpsPolicy;
  draft: OpsPolicy;
  names: Record<string, string>;
  busy: boolean;
  error: string;
  conflict: SaveConflict | null;
  onClose: () => void;
  onSave: (security: SensitiveCredentialsInput) => void;
  onKeepMine: () => void;
  onTakeTheirs: () => void;
}) {
  const ownPin = useOwnPinPrompt(open && !conflict);
  const mine = policyChanges(saved, draft);
  const theirs = conflict ? policyChanges(saved, conflict.current) : [];
  return (
    <EActionDialog
      open={open}
      title={conflict ? "Someone else saved first" : "Review and save access"}
      eyebrow="Access and permissions"
      busy={busy}
      onClose={onClose}
      footer={
        conflict ? (
          <>
            <EButton variant="outline" disabled={busy} onClick={onTakeTheirs}>Discard mine, load theirs</EButton>
            <EButton disabled={busy} onClick={onKeepMine}>Put my changes on top</EButton>
          </>
        ) : (
          <>
            <EButton variant="outline" disabled={busy} onClick={onClose}>Back</EButton>
            <EButton disabled={busy || !ownPin.credentials} onClick={() => ownPin.credentials && onSave(ownPin.credentials)}>{busy ? "Saving…" : "Save"}</EButton>
          </>
        )
      }
    >
      {conflict ? (
        <>
          <p>Nothing has been overwritten. Their saved changes:</p>
          <ul className="list-disc space-y-1 pl-5">{theirs.map((change, index) => <li key={`t${index}`}>{changeLabel(change, names)}</li>)}</ul>
          <p>Your unsaved changes:</p>
          <ul className="list-disc space-y-1 pl-5">{mine.map((change, index) => <li key={`m${index}`}>{changeLabel(change, names)}</li>)}</ul>
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Putting yours on top keeps their other changes and replaces only the people and presets you changed. You review again before saving.</p>
        </>
      ) : (
        <>
          <ul className="list-disc space-y-1 pl-5">{mine.map((change, index) => <li key={index}>{changeLabel(change, names)}</li>)}</ul>
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Each person&apos;s next request uses the new access.</p>
          <OwnPinFields {...ownPin.fieldProps} disabled={busy} />
        </>
      )}
      {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
    </EActionDialog>
  );
}

/** Rebase: the newer stored policy, with only what this editor changed laid over it. */
export function rebaseDraft(saved: OpsPolicy, draft: OpsPolicy, current: OpsPolicy): OpsPolicy {
  const assignments = { ...current.assignments };
  const people = new Set([...Object.keys(saved.assignments), ...Object.keys(draft.assignments)]);
  for (const id of Array.from(people)) {
    if (JSON.stringify(saved.assignments[id] ?? null) === JSON.stringify(draft.assignments[id] ?? null)) continue;
    if (draft.assignments[id]) assignments[id] = draft.assignments[id];
    else delete assignments[id];
  }
  const presetIds = new Set([...saved.presets.map((preset) => preset.id), ...draft.presets.map((preset) => preset.id)]);
  let presets = [...current.presets];
  for (const id of Array.from(presetIds)) {
    const before = saved.presets.find((preset) => preset.id === id);
    const mine = draft.presets.find((preset) => preset.id === id);
    if (JSON.stringify(before ?? null) === JSON.stringify(mine ?? null)) continue;
    presets = presets.filter((preset) => preset.id !== id);
    if (mine) presets.push(mine);
  }
  return { ...current, assignments, presets };
}
