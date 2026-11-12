"use client";

import { EButton } from "@/components/v2/ui/primitives";
import { FIELD_LABEL, type WordingFields } from "@/lib/notifications/wording/types";
import type { WordingPartView } from "@/lib/notifications/wording/view-types";
import { WordingChecks } from "./wording-checks";

type Props = {
  part: WordingPartView;
  proposal: WordingFields;
  current: WordingFields;
  busy: boolean;
  onUse: () => void;
  onRetry: () => void;
  onDiscard: () => void;
};

/**
 * A regenerated wording PROPOSAL beside the current wording. "Use this
 * wording" only puts it in the editor; nothing is saved or sent until the
 * admin saves.
 */
export function WordingProposal({ part, proposal, current, busy, onUse, onRetry, onDiscard }: Props) {
  return (
    <section aria-labelledby="wording-proposal-heading" className="flex flex-col gap-2 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold-soft))] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="wording-proposal-heading" className="font-semibold">Suggested wording</h3>
        <span className="text-xs text-[hsl(var(--e-muted-foreground))]">&quot;Use&quot; puts it in the editor; nothing is saved until you save</span>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-semibold text-[hsl(var(--e-text-secondary))]">Current</p>
          {part.fields.map((field) => (
            <p key={field} className="whitespace-pre-wrap break-words rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-2 text-sm">
              <span className="sr-only">{FIELD_LABEL[part.transport][field]}: </span>{current[field] ?? ""}
            </p>
          ))}
        </div>
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-semibold text-[hsl(var(--e-text-secondary))]">Suggested</p>
          {part.fields.map((field) => (
            <p key={field} className="whitespace-pre-wrap break-words rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-2 text-sm">
              <span className="sr-only">{FIELD_LABEL[part.transport][field]}: </span>{proposal[field] ?? ""}
            </p>
          ))}
        </div>
      </div>
      <WordingChecks part={part} fields={proposal} compareTo={current} />
      <div className="flex flex-wrap gap-2">
        <EButton size="sm" onClick={onUse} disabled={busy}>Use this wording</EButton>
        <EButton size="sm" variant="outline" onClick={onRetry} disabled={busy}>{busy ? "Asking…" : "Try again"}</EButton>
        <EButton size="sm" variant="ghost" onClick={onDiscard} disabled={busy}>Discard</EButton>
      </div>
    </section>
  );
}
