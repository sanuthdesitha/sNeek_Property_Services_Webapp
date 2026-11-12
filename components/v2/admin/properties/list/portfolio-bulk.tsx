"use client";

/**
 * The bulk bar as drawn: Set laundry partner, Assign checklist, Sync calendars
 * now, Export. Each change is one request to POST /api/admin/properties/bulk,
 * which runs every property through the single-property service and answers
 * per property; the dialog lists each outcome and refused rows stay selected.
 */
import { useState } from "react";
import { EBulkBar, EBulkButton } from "@/components/v2/ui/bulk-bar";
import { PROPERTY_BULK_MAX, PROPERTY_SYNC_BULK_MAX, type PropertyBulkResult } from "@/lib/properties/bulk-types";
import type { PortfolioRow } from "@/lib/properties/portfolio-options";
import { BulkDialog, type BulkDialogKind } from "./portfolio-bulk-dialog";

function IdleBar() {
  return (
    <div role="region" aria-label="Bulk actions" className="flex flex-wrap items-center gap-2.5 rounded-[10px] bg-[hsl(var(--e-sidebar-bg))] py-2 pl-3.5 pr-2.5 text-[hsl(var(--e-sidebar-active-bg))]">
      <b className="text-[0.8125rem] font-[600]">Select properties to</b>
      <span className="min-w-0 flex-1" />
      <fieldset disabled className="flex flex-wrap items-center gap-2">
        <EBulkButton>Set laundry partner</EBulkButton>
        <EBulkButton>Assign checklist</EBulkButton>
        <EBulkButton>Sync calendars now</EBulkButton>
        <EBulkButton>Export</EBulkButton>
      </fieldset>
    </div>
  );
}

export function PortfolioBulk({
  selectedRows,
  exportHref,
  onClear,
  onFinished,
  onRunningChange,
}: {
  selectedRows: PortfolioRow[];
  exportHref: string;
  onClear: () => void;
  onFinished: (results: PropertyBulkResult[]) => void;
  onRunningChange: (running: boolean) => void;
}) {
  const [dialog, setDialog] = useState<BulkDialogKind | null>(null);
  const [running, setRunning] = useState(false);
  if (selectedRows.length === 0 && dialog === null) return <IdleBar />;

  const tooMany = selectedRows.length > PROPERTY_BULK_MAX;
  const tooManyToSync = selectedRows.length > PROPERTY_SYNC_BULK_MAX;
  const note = tooMany
    ? `At most ${PROPERTY_BULK_MAX} at a time.`
    : tooManyToSync
      ? `Calendar sync runs at most ${PROPERTY_SYNC_BULK_MAX} at a time.`
      : "Selection covers this page of the current list.";

  return (
    <>
      <EBulkBar count={selectedRows.length} noun={{ one: "property", many: "properties" }} onClear={onClear} busy={running} note={note}>
        <EBulkButton disabled={tooMany} onClick={() => setDialog("set-laundry-team")}>Set laundry partner</EBulkButton>
        <EBulkButton disabled={tooMany} onClick={() => setDialog("assign-checklist")}>Assign checklist</EBulkButton>
        <EBulkButton disabled={tooManyToSync} onClick={() => setDialog("sync-calendars")}>Sync calendars now</EBulkButton>
        <a
          href={exportHref}
          download
          className="inline-flex h-8 items-center whitespace-nowrap rounded-[var(--e-radius)] border border-[hsl(var(--e-sidebar-hairline))] px-2.5 text-[0.75rem] font-[500] text-[hsl(var(--e-sidebar-active-bg))] hover:bg-[hsl(var(--e-sidebar-hairline))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-sidebar-active-bg))]"
        >
          Export
        </a>
      </EBulkBar>
      {dialog ? (
        <BulkDialog
          kind={dialog}
          rows={selectedRows}
          onClose={() => setDialog(null)}
          onRunningChange={(value) => {
            setRunning(value);
            onRunningChange(value);
          }}
          onFinished={onFinished}
        />
      ) : null}
    </>
  );
}
