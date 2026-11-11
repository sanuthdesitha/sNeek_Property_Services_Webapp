"use client";

/**
 * "Copy this question / setting to the other form(s)" from the Compare view.
 * Uses the existing bulk service (POST /api/admin/form-templates/bulk):
 *  - a missing question → "insert-questions" into the section of the same
 *    title (ids regenerated per form by the service);
 *  - a differing setting → "edit-question" matched by section, label and type
 *    (the same matching rule as the comparison).
 * Preview first; saving writes DRAFTS only (nothing reaches cleaners until
 * each form is published).
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { copyableEdit, type CompareRow } from "@/lib/forms/template-compare";
import type { BulkOperation } from "@/lib/forms/template-bulk-types";
import type { SchemaNode } from "@/lib/forms/template-questions";
import { BulkPanelShell } from "./bulk-panel-shell";
import { useBulkRun } from "./use-bulk-run";

export type CopyRequest = {
  kind: "question" | "setting";
  row: CompareRow;
  sourceFormId: string;
  targetIds: string[];
  field: SchemaNode;
  property?: string;
  propertyLabel?: string;
};

function operationFor(request: CopyRequest): BulkOperation | { invalid: string } {
  if (request.kind === "question") {
    return { type: "insert-questions", sectionTitle: request.row.section.slice(0, 120), fields: [request.field] };
  }
  const edit = request.property ? copyableEdit(request.property, request.field) : null;
  if (!edit) return { invalid: "This setting has no value to copy from the first form." };
  return {
    type: "edit-question",
    match: { kind: "wording", section: request.row.section, label: request.row.label, type: request.row.type },
    edit: edit as Extract<BulkOperation, { type: "edit-question" }>["edit"],
  };
}

export function CopyDifferencePanel({
  request,
  formName,
  onClose,
  onApplied,
}: {
  request: CopyRequest;
  formName: (id: string) => string;
  onClose: () => void;
  onApplied: () => void;
}) {
  const run = useBulkRun(request.targetIds, onApplied);
  const operation = React.useMemo(() => operationFor(request), [request]);
  const what = request.kind === "question" ? `“${request.row.label}”` : `“${request.propertyLabel}” of “${request.row.label}”`;
  return (
    <div className="space-y-2">
      <BulkPanelShell
        title={`Copy ${what} from ${formName(request.sourceFormId)} to ${request.targetIds.map(formName).join(", ")}`}
        operation={operation}
        run={run}
        previewLabel={`Preview ${request.targetIds.length} change${request.targetIds.length === 1 ? "" : "s"}`}
        saveLabel="Save as drafts"
        footnote="Saved as a new draft of each form. Nothing reaches cleaners until you publish, and any version can be restored."
      >
        {() => null}
      </BulkPanelShell>
      <EButton size="sm" variant="ghost" onClick={onClose}>
        Close
      </EButton>
    </div>
  );
}
