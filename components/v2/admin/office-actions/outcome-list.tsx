"use client";

/** Per-recipient delivery states after an office action, in the standard result style. */
import { EPill } from "@/components/v2/ui/pill";
import { outcomeText, outcomeTone, outcomesByRecipient, type RecipientOutcome } from "./office-outcomes";

export function OfficeOutcomeList({ outcomes, refused = [], names }: {
  outcomes: RecipientOutcome[];
  refused?: Array<{ id: string; reason: string }>;
  /** Display names for refused ids (the server only returns ids for them). */
  names?: ReadonlyMap<string, string>;
}) {
  const groups = outcomesByRecipient(outcomes);
  if (groups.length === 0 && refused.length === 0) {
    return <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No recipient was reached.</p>;
  }
  return (
    <ul aria-label="Results" className="max-h-64 divide-y divide-[hsl(var(--e-border))] overflow-y-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
      {groups.map((group) => (
        <li key={group.userId} className="space-y-1 px-3 py-2 text-[0.8125rem]">
          <p className="font-[550] [overflow-wrap:anywhere]">{group.name}</p>
          <ul className="flex flex-wrap gap-1.5">
            {group.outcomes.map((outcome) => (
              <li key={`${outcome.transport}:${outcome.path}`}><EPill tone={outcomeTone(outcome.state)}>{outcomeText(outcome)}</EPill></li>
            ))}
          </ul>
        </li>
      ))}
      {refused.map((row) => (
        <li key={`refused:${row.id}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[0.8125rem]">
          <span className="min-w-0 font-[550] [overflow-wrap:anywhere]">{names?.get(row.id) ?? row.id}</span>
          <span className="text-[hsl(var(--e-danger))]">Refused · {row.reason}</span>
        </li>
      ))}
    </ul>
  );
}

/** Transport checkboxes shared by the office action dialogs. */
export function TransportChoices<T extends string>({ choices, value, labels, disabled, onChange, legend = "Send by" }: {
  choices: readonly T[];
  value: readonly T[];
  labels: Record<T, string>;
  disabled?: boolean;
  onChange: (next: T[]) => void;
  legend?: string;
}) {
  return (
    <fieldset disabled={disabled} className="space-y-1.5">
      <legend className="text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]">{legend}</legend>
      {choices.map((choice) => (
        <label key={choice} className="flex items-center gap-2 text-[0.8125rem]">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={value.includes(choice)}
            onChange={(event) => onChange(event.target.checked ? [...value, choice] : value.filter((item) => item !== choice))}
          />
          {labels[choice]}
        </label>
      ))}
    </fieldset>
  );
}
