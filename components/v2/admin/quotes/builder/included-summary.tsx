"use client";

/**
 * Included / Not included / Checklist (board row under the lines). This is
 * what the client receives; "Add exclusion" and "Edit checklist" open the
 * per-quote checklist editor (unchanged rules: edits mark it customised and
 * write an override on save; Reset returns to the service default).
 */
import { Loader2, RotateCcw } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { ChecklistEditor } from "./checklist-editor";
import type { QuoteBuilderState } from "./use-quote-builder";

const LINK = "inline-flex min-h-[32px] items-center text-left text-[0.8125rem] font-[600] text-[hsl(var(--e-primary))] hover:underline disabled:opacity-50";

function list(items: string[], empty: string) {
  return items.length === 0 ? empty : items.join(", ");
}

export function IncludedSummary({ builder }: { builder: QuoteBuilderState }) {
  const c = builder.checklist;
  const label = builder.pricing.serviceLabel.toLowerCase();
  if (c.loading) {
    return (
      <p role="status" className="flex items-center gap-2 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading the {label} checklist…
      </p>
    );
  }
  if (!c.editChecklist) {
    return <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No checklist is configured for this service yet, so nothing is listed as included.</p>;
  }
  const itemCount = c.editChecklist.sections.reduce((sum, s) => sum + s.items.length, 0);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="min-w-0 space-y-1">
          <b className="text-[0.8125rem]">Included</b>
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))] [overflow-wrap:anywhere]">{list(c.includedItems, "No items listed.")}</p>
        </div>
        <div className="min-w-0 space-y-1">
          <b className="text-[0.8125rem]">Not included</b>
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))] [overflow-wrap:anywhere]">{list(c.notIncludedItems, "Nothing specifically excluded.")}</p>
          <button type="button" className={LINK} onClick={() => c.setEditing(true)}>Add exclusion</button>
        </div>
        <div className="min-w-0 space-y-1">
          <b className="flex flex-wrap items-center gap-2 text-[0.8125rem]">Checklist {c.touched ? <EPill tone="gold">Customised</EPill> : null}</b>
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            {builder.pricing.serviceLabel} checklist, {itemCount} item{itemCount === 1 ? "" : "s"}{c.editChecklist.summary ? ", summary set" : ""}
          </p>
          <div className="flex flex-wrap gap-3">
            <button type="button" className={LINK} aria-expanded={c.editing} onClick={() => c.setEditing((v) => !v)}>{c.editing ? "Done editing" : "Edit checklist"}</button>
            {c.touched ? (
              <EButton type="button" size="sm" variant="ghost" onClick={c.ops.reset}><RotateCcw className="h-3.5 w-3.5" /> Reset</EButton>
            ) : null}
          </div>
        </div>
      </div>
      {c.editing ? <ChecklistEditor checklist={c} /> : null}
    </div>
  );
}
