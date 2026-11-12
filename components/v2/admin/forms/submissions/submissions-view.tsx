"use client";

/**
 * Forms → Results and stats → Submissions (the classic /admin/forms
 * "Submissions" tab, moved here): every submitted form, server-paged and
 * sortable (submitted, form, property, job, cleaner), filtered by search,
 * form, submitted date and "with warnings", with each row's PDF report and the
 * submission view (`?submission=`) that offers every classic function.
 */
import * as React from "react";
import { format } from "date-fns";
import { EButton } from "@/components/v2/ui/primitives";
import { EDataTable, type EDataColumn } from "@/components/v2/ui/data-table";
import { EPagination } from "@/components/v2/ui/pagination";
import { EPill } from "@/components/v2/ui/pill";
import { EInput, ESelect } from "@/components/v2/admin/estate-kit";
import { downloadFromApi } from "@/lib/client/download";
import type { SubmissionListRow, SubmissionSort } from "@/lib/forms/submission-list";
import { SUBMISSIONS_PAGE_SIZE, useSubmissionList, useSubmissionsView } from "./use-submission-list";
import { SubmissionPanel } from "./submission-panel";
import type { SubmissionsView as View } from "./submissions-query";

const muted = "text-[0.75rem] text-[hsl(var(--e-muted-foreground))]";

function PdfButton({ jobId }: { jobId: string }) {
  const [state, setState] = React.useState<"idle" | "busy" | "failed">("idle");
  async function download() {
    setState("busy");
    try {
      await downloadFromApi(`/api/reports/${jobId}/download`, `job-report-${jobId}.pdf`);
      setState("idle");
    } catch {
      setState("failed");
    }
  }
  return (
    <EButton size="sm" variant="outline" disabled={state === "busy"} aria-label="Download the job report PDF" onClick={(event) => { event.stopPropagation(); void download(); }}>
      {state === "busy" ? "Generating…" : state === "failed" ? "Retry PDF" : "PDF"}
    </EButton>
  );
}

function columns(onOpen: (row: SubmissionListRow) => void): Array<EDataColumn<SubmissionListRow, SubmissionSort>> {
  return [
    {
      key: "form", header: "Form", sortKey: "form", className: "min-w-[12rem]",
      cell: (row) => (
        <div className="min-w-0">
          <button type="button" onClick={() => onOpen(row)} className="max-w-full truncate text-left font-[600] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]">{row.form.name}</button>
          <p className={muted}>{row.form.serviceType.replace(/_/g, " ").toLowerCase()}</p>
        </div>
      ),
    },
    { key: "property", header: "Property", sortKey: "property", className: "min-w-[9rem]", cell: (row) => row.property ? `${row.property.name}${row.property.suburb ? `, ${row.property.suburb}` : ""}` : <span className={muted}>No property</span> },
    { key: "job", header: "Job", sortKey: "job", className: "whitespace-nowrap", cell: (row) => <span>{row.job.jobNumber ?? "Job"} <span className={muted}>· {format(new Date(row.job.scheduledDate), "d MMM")}</span></span> },
    { key: "cleaner", header: "Cleaner", sortKey: "cleaner", cell: (row) => row.cleaner.name },
    { key: "submitted", header: "Submitted", sortKey: "submitted", className: "whitespace-nowrap e-tnum", cell: (row) => format(new Date(row.createdAt), "d MMM yyyy HH:mm") },
    { key: "warnings", header: "Warnings", align: "right", cell: (row) => row.warningCount > 0 ? <EPill tone="warn">{row.warningCount}</EPill> : <span className={muted}>0</span> },
    { key: "media", header: "Media", align: "right", className: "e-tnum", cell: (row) => row.mediaCount },
    { key: "laundry", header: "Laundry", cell: (row) => row.laundryReady === null ? <span className={muted}>Not set</span> : <EPill tone={row.laundryReady ? "ok" : "warn"}>{row.laundryReady ? "Ready" : "Not ready"}</EPill> },
    { key: "pdf", header: <span className="sr-only">Report</span>, cell: (row) => <PdfButton jobId={row.jobId} /> },
  ];
}

export function SubmissionsView({ initial, canWrite }: { initial: View; canWrite: boolean }) {
  const [view, update] = useSubmissionsView(initial);
  const list = useSubmissionList(view);
  const data = list.data;
  const searchId = React.useId();
  const open = React.useCallback((row: SubmissionListRow) => update({ open: row.id }), [update]);
  const tableColumns = React.useMemo(() => columns(open), [open]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[12rem] flex-1">
          <label htmlFor={searchId} className="text-[0.75rem] font-[550] text-[hsl(var(--e-text-secondary))]">Search</label>
          <EInput id={searchId} type="search" value={view.q} placeholder="Form, property, job or cleaner" onChange={(event) => update({ q: event.target.value })} />
        </div>
        <label className="flex flex-col text-[0.75rem] font-[550] text-[hsl(var(--e-text-secondary))]">
          Form
          <ESelect value={view.templateId} onChange={(event) => update({ templateId: event.target.value })}>
            <option value="">All forms</option>
            {(data?.forms ?? []).map((form) => <option key={form.id} value={form.id}>{form.name}</option>)}
          </ESelect>
        </label>
        <label className="flex flex-col text-[0.75rem] font-[550] text-[hsl(var(--e-text-secondary))]">
          From
          <EInput type="date" value={view.from} onChange={(event) => update({ from: event.target.value })} />
        </label>
        <label className="flex flex-col text-[0.75rem] font-[550] text-[hsl(var(--e-text-secondary))]">
          To
          <EInput type="date" value={view.to} onChange={(event) => update({ to: event.target.value })} />
        </label>
        <label className="flex min-h-10 items-center gap-2 text-[0.8125rem]">
          <input type="checkbox" className="h-4 w-4" checked={view.warnings} onChange={(event) => update({ warnings: event.target.checked })} />
          With warnings
        </label>
      </div>
      <div className="overflow-hidden rounded-[12px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
        <EDataTable<SubmissionListRow, SubmissionSort>
          label="Form submissions"
          columns={tableColumns}
          rows={data?.rows ?? []}
          rowKey={(row) => row.id}
          sort={{ key: view.sort, dir: view.dir }}
          onSortChange={(next) => update({ sort: next.key, dir: next.dir })}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          emptyTitle="No submissions match"
          emptyDescription="Clear the search and filters, or pick another form."
          onRowClick={open}
          activeRowKey={view.open}
          minWidth="62rem"
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {data ? <EPagination className="min-w-0 flex-1" page={data.page} pageSize={SUBMISSIONS_PAGE_SIZE} total={data.total} noun="submissions" disabled={list.loading} onPageChange={(page) => update({ page })} /> : <span />}
        <EButton size="sm" variant="ghost" disabled={list.loading} onClick={list.reload}>Refresh</EButton>
      </div>
      {view.open ? (
        <SubmissionPanel key={view.open} submissionId={view.open} canWrite={canWrite} onClose={() => update({ open: null })} onChanged={list.reload} />
      ) : null}
    </div>
  );
}
