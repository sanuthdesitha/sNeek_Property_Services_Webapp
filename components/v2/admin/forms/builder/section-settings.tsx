"use client";

/**
 * Settings of the selected section, in a lazy disclosure under its heading:
 * title, description, collapsible, per-room repeat, show/hide rule, and the
 * section actions (move, duplicate, delete). Collapsing keeps what was typed
 * (everything is in the builder document).
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect, ESwitch, ETextarea } from "@/components/v2/admin/estate-kit";
import type { FormCondition, FormSection, SectionRepeatBy } from "@/lib/forms/types";
import type { ConditionSourceField } from "./condition-editor";
import { RuleEditor } from "./rule-editor";

export function SectionSettings({
  section,
  conditionFields,
  isFirst,
  isLast,
  disabled,
  onChange,
  onMove,
  onDuplicate,
  onRemove,
}: {
  section: FormSection;
  conditionFields: ConditionSourceField[];
  isFirst: boolean;
  isLast: boolean;
  disabled: boolean;
  onChange: (patch: (section: FormSection) => FormSection, coalesceKey?: string) => void;
  onMove: (direction: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const setRule = (rule: FormCondition | undefined) =>
    onChange((current) => {
      const next = { ...current };
      if (rule) next.conditional = rule;
      else delete next.conditional;
      return next;
    });
  const setRepeat = (value: string) =>
    onChange((current) => {
      const next = { ...current };
      if (value === "bedrooms" || value === "bathrooms") next.repeatBy = value as SectionRepeatBy;
      else delete next.repeatBy;
      return next;
    });
  return (
    <details className="group rounded-[10px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
      <summary className="cursor-pointer select-none px-3 py-2 text-[0.8125rem] font-[550] text-[hsl(var(--e-text-secondary))]">
        Section settings
      </summary>
      <fieldset disabled={disabled} className="grid gap-3 border-t border-[hsl(var(--e-border))] px-3 py-3 md:grid-cols-2">
        <EField label="Section title">
          <EInput value={section.title} onChange={(event) => onChange((current) => ({ ...current, title: event.target.value }), `section-title:${section.id}`)} />
        </EField>
        <EField label="Repeat" hint="Shown once per room of the job's property; each copy keeps its own answers and photos.">
          <ESelect value={section.repeatBy ?? "none"} onChange={(event) => setRepeat(event.target.value)}>
            <option value="none">Once</option>
            <option value="bedrooms">Once per bedroom</option>
            <option value="bathrooms">Once per bathroom</option>
          </ESelect>
        </EField>
        <EField label="Description" className="md:col-span-2">
          <ETextarea
            rows={2}
            value={section.description ?? ""}
            onChange={(event) =>
              onChange((current) => ({ ...current, description: event.target.value || undefined }), `section-description:${section.id}`)
            }
          />
        </EField>
        <div className="flex items-center justify-between gap-3 md:col-span-2">
          <span className="text-[0.8125rem]">Cleaner can collapse this section</span>
          <ESwitch
            checked={Boolean(section.collapsible)}
            onCheckedChange={(value) =>
              onChange((current) => {
                const next = { ...current };
                if (value) next.collapsible = true;
                else delete next.collapsible;
                return next;
              })
            }
          />
        </div>
        <div className="md:col-span-2">
          <RuleEditor condition={section.conditional} onChange={setRule} availableFields={conditionFields} />
        </div>
        <div className="flex flex-wrap gap-2 md:col-span-2">
          <EButton type="button" variant="outline" size="sm" disabled={isFirst} onClick={() => onMove(-1)}>
            Move section up
          </EButton>
          <EButton type="button" variant="outline" size="sm" disabled={isLast} onClick={() => onMove(1)}>
            Move section down
          </EButton>
          <EButton type="button" variant="outline" size="sm" onClick={onDuplicate}>
            Duplicate section
          </EButton>
          <EButton type="button" variant="outline" size="sm" className="text-[hsl(var(--e-danger))]" onClick={onRemove}>
            Delete section
          </EButton>
        </div>
      </fieldset>
    </details>
  );
}
