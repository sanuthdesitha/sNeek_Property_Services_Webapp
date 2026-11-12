"use client";

/**
 * "Move to group", "Tags", and the Publish / Duplicate / Archive panels.
 * Organisation changes touch the library only. Lifecycle actions go through
 * the same services as the single-form buttons; their preview loads as soon
 * as the panel opens and the action needs one more click.
 */
import * as React from "react";
import { EInput, ESelect } from "@/components/v2/admin/estate-kit";
import type { BulkOperation } from "@/lib/forms/template-bulk-types";
import type { FormGroupSummary } from "@/lib/forms/library-types";
import { BulkLabel, BulkPanelShell } from "./bulk-panel-shell";
import { useBulkRun } from "./use-bulk-run";

type PanelProps = { templateIds: string[]; onApplied: () => void };

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function parseTags(raw: string): string[] {
  return Array.from(new Set(raw.split(",").map((tag) => tag.trim()).filter(Boolean))).slice(0, 20);
}

export function BulkMoveToGroupPanel({ templateIds, onApplied, groups }: PanelProps & { groups: FormGroupSummary[] }) {
  const run = useBulkRun(templateIds, onApplied);
  const [groupId, setGroupId] = React.useState("");
  const id = React.useId();
  const operation: BulkOperation | { invalid: string } = groupId
    ? { type: "move-to-group", groupId: groupId === "none" ? null : groupId }
    : { invalid: "Choose a group." };
  return (
    <BulkPanelShell
      title={`Move ${plural(templateIds.length, "selected form")} to a group`}
      operation={operation}
      run={run}
      previewLabel="Preview"
      saveLabel="Move"
      footnote="Groups only organise this library. They never change which form a job uses."
    >
      {() => (
        <div>
          <BulkLabel htmlFor={id}>Group</BulkLabel>
          <ESelect id={id} className="w-56" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">Choose a group</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>{group.name}</option>
            ))}
            <option value="none">No group</option>
          </ESelect>
        </div>
      )}
    </BulkPanelShell>
  );
}

export function BulkTagsPanel({ templateIds, onApplied }: PanelProps) {
  const run = useBulkRun(templateIds, onApplied);
  const [add, setAdd] = React.useState("");
  const [remove, setRemove] = React.useState("");
  const ids = { a: React.useId(), r: React.useId() };
  const addTags = parseTags(add);
  const removeTags = parseTags(remove);
  const tooLong = [...addTags, ...removeTags].some((tag) => tag.length > 30);
  const operation: BulkOperation | { invalid: string } = tooLong
    ? { invalid: "Keep each tag under 30 characters." }
    : addTags.length + removeTags.length === 0
      ? { invalid: "Enter tags to add or remove, separated by commas." }
      : { type: "set-tags", add: addTags, remove: removeTags };
  return (
    <BulkPanelShell
      title={`Tag ${plural(templateIds.length, "selected form")}`}
      operation={operation}
      run={run}
      previewLabel="Preview"
      saveLabel="Apply tags"
      footnote="Tags only organise this library."
    >
      {() => (
        <>
          <div>
            <BulkLabel htmlFor={ids.a}>Add tags</BulkLabel>
            <EInput id={ids.a} className="w-56 max-w-full" placeholder="Rework, Needs review" value={add} onChange={(e) => setAdd(e.target.value)} />
          </div>
          <div>
            <BulkLabel htmlFor={ids.r}>Remove tags</BulkLabel>
            <EInput id={ids.r} className="w-56 max-w-full" value={remove} onChange={(e) => setRemove(e.target.value)} />
          </div>
        </>
      )}
    </BulkPanelShell>
  );
}

const LIFECYCLE_COPY = {
  publish: {
    title: "Publish",
    action: "Publish",
    footnote:
      "Publishing makes each form's unpublished changes live for new jobs as a new version. A form with a problem to fix, or two defaults for the same job type, is not published.",
  },
  duplicate: {
    title: "Duplicate",
    action: "Duplicate",
    footnote: "Each copy is created as an unpublished draft in the same group, with the same tags.",
  },
  archive: {
    title: "Archive",
    action: "Archive",
    footnote: "Archived forms stop being used by new jobs. Past submissions are kept. You can unarchive a form from the Archived list.",
  },
} as const;

export function BulkLifecyclePanel({ templateIds, onApplied, type }: PanelProps & { type: "publish" | "duplicate" | "archive" }) {
  const run = useBulkRun(templateIds, onApplied);
  const copy = LIFECYCLE_COPY[type];
  const operation = React.useMemo<BulkOperation>(() => ({ type }), [type]);
  const { run: start, preview, result, busy, error } = run;
  const selectionKey = templateIds.join(",");

  // The preview is the confirmation step: load it as soon as the panel opens.
  React.useEffect(() => {
    if (!preview && !result && !busy && !error) void start(operation, true);
    // Re-run only when the selection or the action changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey, operation]);

  return (
    <BulkPanelShell
      title={`${copy.title} ${plural(templateIds.length, "selected form")}`}
      operation={operation}
      run={run}
      previewLabel="Refresh preview"
      saveLabel={`${copy.action} ${preview ? preview.summary.changed : ""}`.trim()}
      footnote={copy.footnote}
    >
      {() => null}
    </BulkPanelShell>
  );
}
