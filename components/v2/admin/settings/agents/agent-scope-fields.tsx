"use client";

/**
 * Tick-box rows for what an agent may read and what it may ask to change.
 * Estate checkbox rows: a hairline between rows, the label and its one-line
 * description, 44px tall on phones. A pack outside the administrator's own
 * access is shown disabled with the reason; the server refuses it anyway.
 */
import * as React from "react";
import { ECheckbox } from "@/components/v2/cleaner/fields";
import { cn } from "@/lib/utils";
import { AGENT_SCOPES, type AgentScopeKey } from "@/lib/agents/scopes";
import { AGENT_WRITE_SCOPES, type AgentWriteScopeKey } from "@/lib/agents/write-scopes";

const LEGEND = "text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]";

type ScopeRowProps = {
  label: string;
  description: string;
  checked: boolean;
  allowed: boolean;
  disabledReason: string;
  onChange: (checked: boolean) => void;
};

function ScopeRow({ label, description, checked, allowed, disabledReason, onChange }: ScopeRowProps) {
  return (
    <label
      className={cn(
        "flex min-h-11 items-start gap-2.5 border-t border-[hsl(var(--e-border))] py-2 text-[0.8125rem] first-of-type:border-t-0",
        allowed ? "cursor-pointer" : "cursor-not-allowed text-[hsl(var(--e-muted-foreground))]",
      )}
    >
      <ECheckbox className="mt-0.5 shrink-0 disabled:cursor-not-allowed" disabled={!allowed} checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="min-w-0">
        <span className="block font-[550]">{label}</span>
        <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{allowed ? description : disabledReason}</span>
      </span>
    </label>
  );
}

function toggle<T extends string>(list: readonly T[], key: T, on: boolean): T[] {
  return on ? (list.includes(key) ? [...list] : [...list, key]) : list.filter((item) => item !== key);
}

/** How many read areas show before "Show N more areas". */
const READ_AREAS_SHOWN = 4;

export function ReadAreaFields({ value, grantable, onChange }: { value: AgentScopeKey[]; grantable: AgentScopeKey[]; onChange: (next: AgentScopeKey[]) => void }) {
  const [expanded, setExpanded] = React.useState(false);
  // Ticked areas always stay visible, so nothing chosen is ever hidden.
  const visible = AGENT_SCOPES.filter((scope, index) => expanded || index < READ_AREAS_SHOWN || value.includes(scope.key));
  const hiddenCount = AGENT_SCOPES.length - visible.length;
  return (
    <fieldset className="min-w-0">
      <legend className={LEGEND}>May read · no wider than your own access</legend>
      <div className="mt-1">
        {visible.map((scope) => (
          <ScopeRow
            key={scope.key}
            label={scope.label}
            description={scope.description}
            checked={value.includes(scope.key)}
            allowed={grantable.includes(scope.key)}
            disabledReason="Outside your own access."
            onChange={(checked) => onChange(toggle(value, scope.key, checked))}
          />
        ))}
      </div>
      {hiddenCount > 0 ? (
        <button type="button" className="min-h-11 text-[0.8125rem] font-[550] text-[hsl(var(--e-primary))] underline underline-offset-2" onClick={() => setExpanded(true)}>
          Show {hiddenCount} more {hiddenCount === 1 ? "area" : "areas"}
        </button>
      ) : null}
    </fieldset>
  );
}

export function WritePackFields({
  legend,
  value,
  grantable,
  onChange,
}: {
  legend: string;
  value: AgentWriteScopeKey[];
  grantable: AgentWriteScopeKey[];
  onChange: (next: AgentWriteScopeKey[]) => void;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className={LEGEND}>{legend}</legend>
      <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        Off by default. The agent can only ask: every change waits in Approvals › Agent requests until someone who could make it approves it.
      </p>
      <div className="mt-1">
        {AGENT_WRITE_SCOPES.map((scope) => (
          <ScopeRow
            key={scope.key}
            label={scope.label}
            description={scope.description}
            checked={value.includes(scope.key)}
            allowed={grantable.includes(scope.key)}
            disabledReason="Outside what you can manage yourself."
            onChange={(checked) => onChange(toggle(value, scope.key, checked))}
          />
        ))}
      </div>
    </fieldset>
  );
}
