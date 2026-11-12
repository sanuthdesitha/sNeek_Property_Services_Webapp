"use client";

/** The per-quote checklist editor, unchanged from the old builder: sections, items, summary, exclusions. */
import { Check, Plus, Trash2, X } from "lucide-react";
import { EButton, EEyebrow } from "@/components/v2/ui/primitives";
import { EConfirmButton, EField, EInput, ETextarea } from "@/components/v2/admin/estate-kit";
import type { QuoteChecklistState } from "./use-checklist";

const REMOVE = "inline-flex h-9 shrink-0 items-center rounded-[var(--e-radius)] border border-[hsl(var(--e-danger))] px-1.5 text-[0.6875rem] text-[hsl(var(--e-danger))]";

export function ChecklistEditor({ checklist }: { checklist: QuoteChecklistState }) {
  const c = checklist;
  const model = c.editChecklist;
  if (!model) return null;
  return (
    <div className="space-y-4 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
      <EField label="Summary (shown at the top of the checklist)">
        <ETextarea value={model.summary} onChange={(e) => c.ops.updateSummary(e.target.value)} rows={2} placeholder="One-line description of this service…" />
      </EField>
      {model.sections.map((section) => (
        <div key={section.id} className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
          <EEyebrow>{section.title}</EEyebrow>
          {section.items.length === 0 ? <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">No items.</p> : null}
          {section.items.map((item) => (
            <div key={item.id} className="flex items-center gap-2">
              <button
                type="button"
                aria-pressed={item.covered}
                aria-label={item.covered ? `${item.label}: included, choose to exclude` : `${item.label}: excluded, choose to include`}
                onClick={() => c.ops.toggleItem(section.id, item.id)}
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--e-radius)] border ${
                  item.covered ? "border-[hsl(var(--e-success))] bg-[hsl(var(--e-success)/0.12)] text-[hsl(var(--e-success))]" : "border-[hsl(var(--e-danger))] bg-[hsl(var(--e-danger)/0.1)] text-[hsl(var(--e-danger))]"
                }`}
              >
                {item.covered ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
              </button>
              <EInput aria-label={`Checklist item in ${section.title}`} value={item.label} onChange={(e) => c.ops.renameItem(section.id, item.id, e.target.value)} className={item.covered ? "" : "line-through opacity-70"} />
              <EConfirmButton ariaLabel={`Remove ${item.label}`} confirmLabel="Remove?" className={REMOVE} onConfirm={() => c.ops.removeItem(section.id, item.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </EConfirmButton>
            </div>
          ))}
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <EInput
              aria-label={`Add an item to ${section.title}`}
              value={c.newItemLabels[section.id] ?? ""}
              placeholder={`Add an item to ${section.title}…`}
              onChange={(e) => c.setNewItemLabels((prev) => ({ ...prev, [section.id]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  c.ops.addItem(section.id);
                }
              }}
            />
            <EButton type="button" variant="outline" size="sm" onClick={() => c.ops.addItem(section.id)}><Plus className="h-4 w-4" /> Add item</EButton>
          </div>
        </div>
      ))}
      <div className="space-y-2 rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border-strong))] p-3">
        <EEyebrow>Not included</EEyebrow>
        {model.notCovered.map((line, i) => (
          <div key={i} className="flex items-center gap-2">
            <X className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--e-danger))]" aria-hidden />
            <EInput aria-label={`Exclusion ${i + 1}`} value={line} onChange={(e) => c.ops.updateExclusion(i, e.target.value)} />
            <EConfirmButton ariaLabel="Remove exclusion" confirmLabel="Remove?" className={REMOVE} onConfirm={() => c.ops.removeExclusion(i)}>
              <Trash2 className="h-3.5 w-3.5" />
            </EConfirmButton>
          </div>
        ))}
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <EInput
            aria-label="New exclusion"
            value={c.newExclusion}
            placeholder="Add an exclusion the client should know about…"
            onChange={(e) => c.setNewExclusion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                c.ops.addExclusion();
              }
            }}
          />
          <EButton type="button" variant="outline" size="sm" onClick={c.ops.addExclusion}><Plus className="h-4 w-4" /> Add exclusion</EButton>
        </div>
      </div>
    </div>
  );
}
