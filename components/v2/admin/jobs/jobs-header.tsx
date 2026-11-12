"use client";

/**
 * Jobs page heading: "Jobs", a line with the real number of matching jobs and
 * when the list was last read, and the page actions (Export, Import or bulk
 * create, New job). "Import or bulk create" opens its own dialog: a link to
 * the New job page's bulk create and the CSV import.
 */
import Link from "next/link";
import { useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { EButton } from "@/components/v2/ui/primitives";
import { SYDNEY_TZ } from "@/lib/time/sydney-range";
import { JobsExportPreview } from "./export-preview";
import { JobsImportDialog } from "./jobs-import-dialog";
import type { JobsListStatus } from "./use-jobs-list";

type HeaderProps = {
  status: JobsListStatus;
  totalCount: number;
  loadedAt: Date | null;
  now: Date;
  refreshFailed: boolean;
  exportQuery: string;
  exportDisabled: boolean;
  viewsContext?: string;
  showTitle: boolean;
  /** Read-only views cannot create jobs. */
  readOnly?: boolean;
  /** Reload the list after an import created jobs. */
  onImported?: () => void;
};

export function updatedLabel(loadedAt: Date, now: Date): string {
  const seconds = Math.max(0, Math.round((now.getTime() - loadedAt.getTime()) / 1000));
  if (seconds < 60) return "updated just now";
  if (seconds < 3600) return `updated ${Math.floor(seconds / 60)} min ago`;
  return `updated at ${formatInTimeZone(loadedAt, SYDNEY_TZ, "HH:mm")}`;
}

function summaryLine({ status, totalCount, loadedAt, now, refreshFailed }: HeaderProps): string {
  if (status === "loading" && !loadedAt) return "Loading jobs…";
  if (status === "error") return "Jobs could not be loaded";
  if (status === "loading") return "Updating…";
  const count = `${totalCount} job${totalCount === 1 ? "" : "s"} match`;
  if (!loadedAt) return count;
  return `${count} · ${refreshFailed ? "last " : ""}${updatedLabel(loadedAt, now)}`;
}

export function JobsHeader(props: HeaderProps) {
  const [importOpen, setImportOpen] = useState(false);
  const actions = (
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
      <JobsExportPreview query={props.exportQuery} context={props.viewsContext} disabled={props.exportDisabled} />
      <EButton variant="outline" onClick={() => setImportOpen(true)} disabled={props.readOnly}>Import or bulk create</EButton>
      <EButton asChild><Link href="/v2/admin/jobs/new">New job</Link></EButton>
      <JobsImportDialog open={importOpen} onClose={() => setImportOpen(false)} onImported={() => props.onImported?.()} />
    </div>
  );
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {props.showTitle ? <h1 className="e-display-md">Jobs</h1> : null}
        <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{summaryLine(props)}</p>
      </div>
      {actions}
    </header>
  );
}
