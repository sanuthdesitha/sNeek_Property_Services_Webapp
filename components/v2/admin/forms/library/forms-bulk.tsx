"use client";

/**
 * The bulk bar for selected job forms and the panel each action opens below
 * it. A panel stays mounted (hidden) after it is closed, so half-typed input
 * survives switching between actions; clearing the selection or changing the
 * filters unmounts everything.
 */
import * as React from "react";
import { EBulkBar, EBulkButton } from "@/components/v2/ui/bulk-bar";
import { cn } from "@/lib/utils";
import type { FormGroupSummary } from "@/lib/forms/library-types";
import { BULK_MAX_FORMS } from "@/lib/forms/template-bulk-types";
import { BulkQuestionPanel } from "./bulk-question-panel";
import { BulkAddSectionPanel, BulkFindReplacePanel } from "./bulk-content-panels";
import { BulkLifecyclePanel, BulkMoveToGroupPanel, BulkTagsPanel } from "./bulk-organise-panels";
import { exportFormsHref } from "./import-forms";
import { EXPORT_MAX_FORMS } from "@/lib/forms/template-transfer";

type PanelKey = "question" | "section" | "replace" | "group" | "tags" | "publish" | "duplicate" | "archive";

const ACTIONS: Array<{ key: PanelKey; label: string }> = [
  { key: "question", label: "Edit a question in all" },
  { key: "section", label: "Add section to all" },
  { key: "replace", label: "Find and replace" },
  { key: "group", label: "Move to group" },
  { key: "tags", label: "Tags" },
  { key: "publish", label: "Publish" },
  { key: "duplicate", label: "Duplicate" },
  { key: "archive", label: "Archive" },
];

const LIFECYCLE: ReadonlySet<PanelKey> = new Set<PanelKey>(["publish", "duplicate", "archive"]);

export type FormsBulkProps = {
  selectedIds: string[];
  groups: FormGroupSummary[];
  onClear: () => void;
  /** Re-read the list after something was applied. */
  onApplied: () => void;
};

function Panel({ panel, ids, groups, onApplied }: { panel: PanelKey; ids: string[]; groups: FormGroupSummary[]; onApplied: () => void }) {
  switch (panel) {
    case "question":
      return <BulkQuestionPanel templateIds={ids} onApplied={onApplied} />;
    case "section":
      return <BulkAddSectionPanel templateIds={ids} onApplied={onApplied} />;
    case "replace":
      return <BulkFindReplacePanel templateIds={ids} onApplied={onApplied} />;
    case "group":
      return <BulkMoveToGroupPanel templateIds={ids} onApplied={onApplied} groups={groups} />;
    case "tags":
      return <BulkTagsPanel templateIds={ids} onApplied={onApplied} />;
    default:
      return <BulkLifecyclePanel key={`${panel}:${ids.join(",")}`} type={panel} templateIds={ids} onApplied={onApplied} />;
  }
}

export function FormsBulk({ selectedIds, groups, onClear, onApplied }: FormsBulkProps) {
  const [active, setActive] = React.useState<PanelKey | null>(null);
  const [opened, setOpened] = React.useState<PanelKey[]>([]);
  const tooMany = selectedIds.length > BULK_MAX_FORMS;

  function toggle(key: PanelKey) {
    setActive((current) => (current === key ? null : key));
    setOpened((current) => (current.includes(key) ? current : [...current, key]));
  }

  if (selectedIds.length === 0) return null;
  return (
    <div className="space-y-3">
      <EBulkBar
        count={selectedIds.length}
        noun={{ one: "form", many: "forms" }}
        onClear={onClear}
        note={tooMany ? `Bulk actions take up to ${BULK_MAX_FORMS} forms at a time.` : "Selection stays while you page through this filter."}
      >
        {ACTIONS.map((action) => (
          <EBulkButton
            key={action.key}
            aria-expanded={active === action.key}
            disabled={tooMany}
            className={cn(active === action.key && "bg-[hsl(var(--e-sidebar-hairline))]")}
            onClick={() => toggle(action.key)}
          >
            {action.label}
          </EBulkButton>
        ))}
        {/* Export downloads a file; it changes nothing, so it needs no preview. */}
        <EBulkButton disabled={selectedIds.length > EXPORT_MAX_FORMS} onClick={() => window.location.assign(exportFormsHref(selectedIds))}>
          Export
        </EBulkButton>
      </EBulkBar>
      {tooMany
        ? null
        : opened
            // Lifecycle panels preview on open, so they mount only while shown.
            .filter((key) => active === key || !LIFECYCLE.has(key))
            .map((key) => (
            <div key={key} hidden={active !== key}>
              <Panel panel={key} ids={selectedIds} groups={groups} onApplied={onApplied} />
            </div>
          ))}
    </div>
  );
}
