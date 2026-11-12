"use client";

import * as React from "react";
import { FIELD_LABEL, type WordingField, type WordingFields } from "@/lib/notifications/wording/types";
import type { WordingPartView } from "@/lib/notifications/wording/view-types";
import { E_CHIP_CLASS } from "@/components/v2/ui/filter-chips";
import { insertVariable } from "./wording-model";

type Props = {
  part: WordingPartView;
  value: WordingFields;
  disabled: boolean;
  describedBy?: string;
  onChange: (next: WordingFields) => void;
};

const VARIABLE_CLASS = "rounded bg-[hsl(var(--e-info-soft))] px-1 font-mono text-[0.71875rem] text-[hsl(var(--e-info))] whitespace-nowrap";

/**
 * The wording fields of one part, with variable chips that insert
 * `{{name}}` at the caret of the field last focused (the body by default).
 */
export function WordingFieldsEditor({ part, value, disabled, describedBy, onChange }: Props) {
  const refs = React.useRef<Partial<Record<WordingField, HTMLTextAreaElement | null>>>({});
  const lastField = React.useRef<WordingField>(part.fields.includes("body") ? "body" : part.fields[0]);
  const idBase = React.useId();

  function insert(name: string) {
    const field = lastField.current;
    const element = refs.current[field];
    const current = value[field] ?? "";
    const next = insertVariable(current, element?.selectionStart ?? null, element?.selectionEnd ?? null, name);
    onChange({ ...value, [field]: next.value });
    requestAnimationFrame(() => {
      const target = refs.current[field];
      if (!target) return;
      target.focus();
      target.setSelectionRange(next.caret, next.caret);
    });
  }

  return (
    <div className="space-y-3">
      {part.fields.map((field) => {
        const id = `${idBase}-${field}`;
        const single = field === "title" || field === "subject";
        return (
          <div key={field} className="space-y-1">
            <label htmlFor={id} className="text-xs font-semibold text-[hsl(var(--e-text-secondary))]">{FIELD_LABEL[part.transport][field] ?? field}</label>
            <textarea
              id={id}
              ref={(element) => { refs.current[field] = element; }}
              value={value[field] ?? ""}
              disabled={disabled}
              aria-describedby={describedBy}
              rows={single ? 1 : part.transport === "EMAIL" ? 9 : 4}
              spellCheck
              onFocus={() => { lastField.current = field; }}
              onChange={(event) => onChange({ ...value, [field]: event.target.value })}
              className={`w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-3 py-2 text-base leading-[1.7] sm:text-sm disabled:opacity-70 ${part.transport === "EMAIL" && field === "body" ? "font-mono text-[0.8125rem]" : ""}`}
            />
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Insert a variable">
        <span className="text-xs text-[hsl(var(--e-muted-foreground))]">Insert:</span>
        {part.variables.map((variable) => (
          <button key={variable.name} type="button" disabled={disabled} onClick={() => insert(variable.name)} className={`${E_CHIP_CLASS} min-h-9 px-1.5`} title={variable.label} aria-label={`Insert ${variable.label} ({{${variable.name}}})`}>
            <span className={VARIABLE_CLASS}>{`{{${variable.name}}}`}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
