"use client";

/**
 * One domain's rules (Laundry or Jobs), grouped by section, each in plain
 * words with its current value, where it applies and how it takes effect.
 * Editable values become inputs only while the rules are unlocked; the draft
 * lives in the parent so it survives switching tabs.
 */
import * as React from "react";
import { EBadge } from "@/components/v2/ui/primitives";
import { EToneCard, EToneNotice } from "@/components/v2/ui/tone-band";
import { EInput, ESwitch } from "@/components/v2/admin/estate-kit";
import { formatRuleValue, type RuleDomain } from "@/lib/scheduling-rules/registry";
import { boundsText, parseDraftInput, type DraftValues } from "@/lib/scheduling-rules/draft";
import type { RuleRowView, SchedulingRulesView } from "@/lib/scheduling-rules/view-types";
import type { EditableRuleKey } from "@/lib/scheduling-rules/values";

const KIND_LABEL: Record<RuleRowView["kind"], string> = {
  editable: "Changeable",
  logic: "Fixed (how it works)",
  "not-applied": "Not applied",
  unused: "Stored, not used",
};

const EFFECT_LABEL: Record<RuleRowView["takesEffect"], string> = {
  "new-work": "New runs and jobs follow a new version; existing ones keep theirs unless re-planned",
  "run-time": "Checked at each run",
  display: "Display only",
};

type Props = {
  view: SchedulingRulesView;
  domain: RuleDomain;
  editing: boolean;
  disabled: boolean;
  draft: DraftValues | null;
  onDraftChange: (key: EditableRuleKey, value: number | boolean | string) => void;
};

function RuleInput({ row, view, draft, disabled, onDraftChange }: { row: RuleRowView; view: SchedulingRulesView; draft: DraftValues; disabled: boolean; onDraftChange: Props["onDraftChange"] }) {
  const key = row.editableKey as EditableRuleKey;
  const spec = view.specs[key];
  const current = draft[key];
  const [text, setText] = React.useState(String(current));
  const [problem, setProblem] = React.useState<string | null>(null);
  React.useEffect(() => {
    setText(String(current));
  }, [current]);
  if (spec.type === "boolean") {
    return <ESwitch checked={current === true} disabled={disabled} onCheckedChange={(value) => onDraftChange(key, value)} label={current ? "On" : "Off"} />;
  }
  const bounds = boundsText(spec);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <EInput
        aria-label={`${row.title}${bounds ? ` (${bounds})` : ""}`}
        type={spec.type === "time" ? "time" : "number"}
        inputMode={spec.type === "time" ? undefined : "numeric"}
        min={spec.min}
        max={spec.max}
        value={text}
        disabled={disabled}
        className="h-10 w-32"
        onChange={(event) => {
          setText(event.target.value);
          const parsed = parseDraftInput(spec, event.target.value);
          if (parsed === null) {
            setProblem(bounds ? `Use ${bounds}.` : "Use a 24-hour time such as 10:00.");
          } else {
            setProblem(null);
            onDraftChange(key, parsed);
          }
        }}
      />
      {spec.unit && spec.type === "integer" ? <span className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{spec.unit}</span> : null}
      {problem ? <span role="alert" className="text-[0.75rem] text-[hsl(var(--e-band-problem-fg))]">{problem}</span> : bounds ? <span className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">{bounds}</span> : null}
    </div>
  );
}

export function RuleList({ view, domain, editing, disabled, draft, onDraftChange }: Props) {
  const rows = view.rules.filter((row) => row.domain === domain);
  const sections = Array.from(new Set(rows.map((row) => row.section)));
  return (
    <div className="space-y-6">
      {sections.map((section) => (
        <section key={section} aria-labelledby={`rules-${domain}-${section}`} className="space-y-3">
          <h2 id={`rules-${domain}-${section}`} className="text-[1rem] font-semibold">{section}</h2>
          <ul className="space-y-3">
            {rows.filter((row) => row.section === section).map((row) => {
              const changed = draft && row.editableKey ? draft[row.editableKey] !== view.versions.find((v) => v.status === "LIVE")?.values[row.editableKey] : false;
              const tone = row.kind === "not-applied" || row.kind === "unused" ? "info" : changed ? "attention" : undefined;
              return (
                <li key={row.id}>
                  <EToneCard
                    tone={tone}
                    header={
                      <div className="min-w-0">
                        <p className="break-words text-[0.9375rem] font-semibold">{row.title}</p>
                        <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-text-faint))]">{KIND_LABEL[row.kind]}</p>
                      </div>
                    }
                    pill={changed ? "Changed in your draft" : row.valueText}
                  >
                    <div className="space-y-2 text-[0.875rem]">
                      <p className="break-words">{row.sentence}</p>
                      {editing && row.editableKey && draft ? (
                        <RuleInput row={row} view={view} draft={draft} disabled={disabled} onDraftChange={onDraftChange} />
                      ) : null}
                      {row.scheduledValueText ? (
                        <EToneNotice tone="info" title="Scheduled change">
                          A published version will change this to {row.scheduledValueText} on its effective day.
                        </EToneNotice>
                      ) : null}
                      {row.quirk ? (
                        <EToneNotice tone="info" title="How it really works">{row.quirk}</EToneNotice>
                      ) : null}
                      <dl className="grid gap-x-4 gap-y-1 text-[0.75rem] text-[hsl(var(--e-text-secondary))] sm:grid-cols-[auto_1fr]">
                        <dt className="font-medium">Applies to</dt>
                        <dd className="break-words">{row.appliesTo}</dd>
                        <dt className="font-medium">Takes effect</dt>
                        <dd className="break-words">{EFFECT_LABEL[row.takesEffect]}</dd>
                        <dt className="font-medium">Source</dt>
                        <dd className="break-words">{row.origin}</dd>
                      </dl>
                      {editing && row.editableKey && draft && changed ? (
                        <p className="text-[0.75rem]">
                          <EBadge tone="warning" soft>Live: {formatRuleValue(row.editableKey, view.versions.find((v) => v.status === "LIVE")!.values[row.editableKey])}</EBadge>
                        </p>
                      ) : null}
                    </div>
                  </EToneCard>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
