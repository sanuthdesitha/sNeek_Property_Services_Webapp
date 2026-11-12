"use client";

import { EAlert, EButton } from "@/components/v2/ui/primitives";
import { E_CHIP_CLASS, E_CHIP_ON_CLASS } from "@/components/v2/ui/filter-chips";
import { cn } from "@/lib/utils";
import { WORDING_TRANSPORT_LABEL, type WordingFields, type WordingTransport } from "@/lib/notifications/wording/types";
import type { TypeWordingResponse, WordingPartView } from "@/lib/notifications/wording/view-types";
import { WordingChecks } from "./wording-checks";
import { WordingFieldsEditor } from "./wording-fields";
import { WordingProposal } from "./wording-proposal";
import { draftKey, nextVersion, partsForTab, problemsFor, sameFields, type TabState } from "./wording-model";

export type EditorMessage = { tone: "success" | "danger" | "warning"; text: string };

type Props = {
  view: TypeWordingResponse;
  tabs: TabState[];
  tab: WordingTransport;
  part: WordingPartView;
  draft: WordingFields;
  saving: boolean;
  message: EditorMessage | null;
  conflict: boolean;
  proposal: WordingFields | null;
  regenerating: boolean;
  onTab: (tab: WordingTransport) => void;
  onPart: (key: string) => void;
  onDraft: (fields: WordingFields) => void;
  onSave: () => void;
  onCancel: () => void;
  onReset: () => void;
  onRegenerate: () => void;
  onUseProposal: () => void;
  onDiscardProposal: () => void;
  onReload: () => void;
};

/** The wording card: transport tabs, audience/part chips, fields, checks, proposal and the save row. */
export function WordingEditor(props: Props) {
  const { view, part, draft } = props;
  const dirty = !sameFields(draft, part.live);
  const problems = problemsFor(part, draft);
  const locked = props.saving || !view.canEdit;
  const checksId = `wording-checks-${part.id}-${part.transport}`;
  const parts = partsForTab(view.parts, props.tab);
  const pushShared = props.tab === "PUSH" && part.transport === "INBOX";
  const isDefault = part.liveSource === "default" && !dirty;

  return (
    <section aria-labelledby="wording-editor-heading" className="flex flex-col gap-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4">
      <h3 id="wording-editor-heading" className="sr-only">Wording</h3>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Transport" className="flex flex-wrap gap-1">
          {props.tabs.map((tab) => (
            <button key={tab.transport} type="button" role="tab" aria-selected={props.tab === tab.transport} disabled={!tab.enabled || props.saving} title={tab.title ?? undefined}
              onClick={() => props.onTab(tab.transport)}
              className={cn("min-h-9 rounded-[var(--e-radius)] px-3 text-[0.8125rem] font-[550] disabled:opacity-50", props.tab === tab.transport ? "bg-[hsl(var(--e-surface-raised))] text-[hsl(var(--e-foreground))] shadow-[var(--e-elevation-1)]" : "text-[hsl(var(--e-muted-foreground))]")}>
              {WORDING_TRANSPORT_LABEL[tab.transport]}
              {tab.title ? <span className="sr-only"> ({tab.title})</span> : null}
            </button>
          ))}
        </div>
        {parts.length > 1 ? (
          <div role="group" aria-label="Audience or part" className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-[hsl(var(--e-muted-foreground))]">Audience:</span>
            {parts.map((item) => (
              <button key={draftKey(item)} type="button" aria-pressed={draftKey(item) === draftKey(part)} disabled={props.saving} onClick={() => props.onPart(draftKey(item))} className={cn(E_CHIP_CLASS, "min-h-9", draftKey(item) === draftKey(part) && E_CHIP_ON_CLASS)}>
                {item.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {view.status === "PARTS" && view.reason ? <p className="text-xs text-[hsl(var(--e-muted-foreground))]">Still in code: {view.reason}</p> : null}
      {pushShared ? <p className="text-xs">Push uses the inbox title and body: editing here changes both.</p> : null}
      {part.note ? <p className="text-xs text-[hsl(var(--e-muted-foreground))]">{part.note}</p> : null}

      <WordingFieldsEditor key={draftKey(part)} part={part} value={draft} disabled={locked} describedBy={checksId} onChange={props.onDraft} />
      <WordingChecks part={part} fields={draft} id={checksId} />

      {props.proposal ? (
        <WordingProposal part={part} proposal={props.proposal} current={draft} busy={props.regenerating} onUse={props.onUseProposal} onRetry={props.onRegenerate} onDiscard={props.onDiscardProposal} />
      ) : null}

      {props.conflict ? (
        <EAlert tone="warning" title="Changed since you opened it">
          Someone saved this wording (here or in Forms) after you opened it. Your draft is kept. <button type="button" className="underline" onClick={props.onReload}>Load the current version</button>, then save again.
        </EAlert>
      ) : null}
      {props.message ? (
        <div role={props.message.tone === "danger" ? "alert" : "status"}>
          <EAlert tone={props.message.tone} title={props.message.tone === "success" ? "Saved" : props.message.tone === "warning" ? "Not available" : "Not saved"}>{props.message.text}</EAlert>
        </div>
      ) : null}
      {!view.canEdit && view.editReason ? <p className="text-xs">{view.editReason}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <EButton variant="outline" size="sm" onClick={props.onRegenerate} disabled={locked || props.regenerating || !view.regenerate.available} title={view.regenerate.reason ?? undefined}>
          {props.regenerating ? "Asking…" : "Regenerate wording"}
        </EButton>
        <EButton variant="outline" size="sm" onClick={props.onReset} disabled={locked || isDefault}>Reset to default</EButton>
        <span className="grow" />
        {dirty ? <span className="text-xs text-[hsl(var(--e-muted-foreground))]">Unsaved changes</span> : null}
        <EButton variant="ghost" size="sm" onClick={props.onCancel} disabled={props.saving || !dirty}>Cancel</EButton>
        <EButton size="sm" onClick={props.onSave} disabled={locked || !dirty || problems.length > 0}>{props.saving ? "Saving…" : `Save as v${nextVersion(part)}`}</EButton>
      </div>
      {!view.regenerate.available && view.regenerate.reason && view.canEdit ? <p className="text-xs text-[hsl(var(--e-muted-foreground))]">Regenerate wording: {view.regenerate.reason}</p> : null}
    </section>
  );
}
