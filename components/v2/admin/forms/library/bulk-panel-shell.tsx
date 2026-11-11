"use client";

/**
 * Frame shared by the bulk panels under the bulk bar: a titled card (the
 * concept's "Edit a question in all 3 selected forms"), the panel's inputs,
 * the Preview / Save pair and the per-form outcomes.
 *
 * Save is enabled only after a successful preview of the same inputs. The
 * inputs are frozen while a request runs and kept after a failure.
 */
import * as React from "react";
import { Loader2 } from "lucide-react";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { E_LABEL_CLASS } from "@/components/v2/admin/estate-kit";
import type { BulkOperation } from "@/lib/forms/template-bulk-types";
import { BulkOutcomes } from "./bulk-outcomes";
import type { BulkRunState } from "./use-bulk-run";

export function BulkLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className={E_LABEL_CLASS}>
      {children}
    </label>
  );
}

export type BulkPanelShellProps = {
  title: string;
  /** The operation the current inputs describe, or a reason they are incomplete. */
  operation: BulkOperation | { invalid: string };
  run: BulkRunState;
  previewLabel: string;
  saveLabel: string;
  /** Plain-language consequence shown under the inputs. */
  footnote: React.ReactNode;
  children: (disabled: boolean) => React.ReactNode;
};

function isOperation(value: BulkOperation | { invalid: string }): value is BulkOperation {
  return "type" in value;
}

export function BulkPanelShell({ title, operation, run, previewLabel, saveLabel, footnote, children }: BulkPanelShellProps) {
  const valid = isOperation(operation);
  const canSave = valid && run.previewMatches(operation) && (run.preview?.summary.changed ?? 0) > 0;
  const headingId = React.useId();

  return (
    <ECard className="space-y-3 p-4" aria-labelledby={headingId} role="region">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={headingId} className="text-[0.8125rem] font-[600] text-[hsl(var(--e-foreground))]">
          {title}
        </h3>
        <span className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Preview before anything is saved</span>
      </div>
      <fieldset disabled={run.busy} className="flex min-w-0 flex-wrap items-end gap-3">
        {children(run.busy)}
        <EButton
          size="sm"
          variant="outline"
          disabled={!valid || run.busy}
          title={valid ? undefined : operation.invalid}
          onClick={() => valid && void run.run(operation, true)}
        >
          {run.busy ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : null}
          {previewLabel}
        </EButton>
        <EButton
          size="sm"
          disabled={!canSave || run.busy}
          title={canSave ? undefined : "Preview first; only previewed changes can be saved."}
          onClick={() => valid && void run.run(operation, false)}
        >
          {saveLabel}
        </EButton>
      </fieldset>
      {!valid ? <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{operation.invalid}</p> : null}
      <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{footnote}</p>
      {run.error ? (
        <p role="alert" className="text-[0.8125rem] font-[500] text-[hsl(var(--e-danger))]">
          {run.error} Some forms may already have been saved; preview again to see the forms as they are now.
        </p>
      ) : null}
      {run.result ? <BulkOutcomes response={run.result} title="Result" /> : null}
      {!run.result && run.preview ? <BulkOutcomes response={run.preview} title="Preview" /> : null}
    </ECard>
  );
}
