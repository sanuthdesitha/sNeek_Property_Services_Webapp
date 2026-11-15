"use client";

/**
 * The New agent form, beside the agents list on desktop and below it on a
 * phone. Estate fields; read areas and write packs no wider than the
 * administrator's own access; expiry as chips (7 to 365 days, default 90).
 * "Create agent…" opens the tier C PIN dialog; the draft stays here until the
 * agent is created, so a wrong PIN loses nothing. Fields lock while saving.
 */
import * as React from "react";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { EChoiceChips } from "@/components/v2/ui/form-dialog-parts";
import { EField, EInput } from "@/components/v2/admin/estate-kit";
import { AGENT_EXPIRY_CHOICES, type AgentScopeKey } from "@/lib/agents/scopes";
import type { AgentWriteScopeKey } from "@/lib/agents/write-scopes";
import { EMPTY_AGENT_DRAFT, type AgentDraft } from "./agent-model";
import { ReadAreaFields, WritePackFields } from "./agent-scope-fields";

export const AGENT_NAME_INPUT_ID = "new-agent-name";

const EXPIRY_OPTIONS = AGENT_EXPIRY_CHOICES.map((days) => ({ value: String(days), label: `${days} days` }));

export function ExpiryChoice({ name, label, value, disabled, onChange }: { name: string; label: string; value: number; disabled?: boolean; onChange: (days: number) => void }) {
  return <EChoiceChips label={label} name={name} value={String(value)} options={EXPIRY_OPTIONS} disabled={disabled} onChange={(next) => onChange(Number(next))} />;
}

type NewAgentFormProps = {
  draft: AgentDraft;
  grantable: AgentScopeKey[];
  grantableWrite: AgentWriteScopeKey[];
  /** True while any change is being saved: every field locks. */
  busy: boolean;
  onChange: (next: AgentDraft) => void;
  onCreate: () => void;
};

export function NewAgentForm({ draft, grantable, grantableWrite, busy, onChange, onCreate }: NewAgentFormProps) {
  const ready = draft.name.trim().length > 0 && draft.areas.length > 0;
  const pristine = draft.name === "" && draft.areas.length === 0 && draft.writeAreas.length === 0 && draft.expiresInDays === EMPTY_AGENT_DRAFT.expiresInDays;
  return (
    <ECard className="min-w-0 p-4" role="region" aria-labelledby="new-agent-heading">
      <h2 id="new-agent-heading" className="text-[0.9375rem] font-semibold">New agent</h2>
      <fieldset disabled={busy} className="mt-3 min-w-0 space-y-4">
        <legend className="sr-only">New agent</legend>
        <EField label="Name">
          <EInput
            id={AGENT_NAME_INPUT_ID}
            maxLength={60}
            value={draft.name}
            placeholder="For example Hermes or Claude"
            className="max-sm:h-11 max-sm:text-[1rem]"
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
          />
        </EField>
        <ReadAreaFields value={draft.areas} grantable={grantable} onChange={(areas) => onChange({ ...draft, areas })} />
        <WritePackFields legend="May ask to change · no wider than what you can manage" value={draft.writeAreas} grantable={grantableWrite} onChange={(writeAreas) => onChange({ ...draft, writeAreas })} />
        <ExpiryChoice name="new-agent-expiry" label="Token expires after" value={draft.expiresInDays} onChange={(expiresInDays) => onChange({ ...draft, expiresInDays })} />
        <div className="flex flex-wrap justify-end gap-2 max-sm:flex-col-reverse">
          <EButton type="button" variant="outline" disabled={pristine} onClick={() => onChange(EMPTY_AGENT_DRAFT)}>Clear</EButton>
          <EButton type="button" disabled={!ready} onClick={onCreate}>Create agent…</EButton>
        </div>
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          {ready ? "The form keeps what you chose if the PIN step fails." : "Give it a name and at least one area it may read."}
        </p>
      </fieldset>
    </ECard>
  );
}
