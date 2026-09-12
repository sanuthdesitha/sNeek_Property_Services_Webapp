"use client";
import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { JobDialog } from "./job-dialog";
import { statusLabel } from "./job-row";
import { JOBS_EXPORT_HEADERS, jobsExportCsv, parseJobsExport, type JobsExportSnapshot } from "@/lib/jobs/export-preview";

export function JobsExportPreview({ query, context, disabled = false }: { query: string; context?: string; disabled?: boolean }) {
  return <ScopedExport key={JSON.stringify([context, query])} query={query} disabled={disabled} />;
}
function ScopedExport({ query, disabled }: { query: string; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<JobsExportSnapshot | null>(null);
  const [error, setError] = useState("");
  const [downloadMessage, setDownloadMessage] = useState("");
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const objectUrl = useRef<string | null>(null);
  useEffect(() => () => { if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); }, []);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const controller = new AbortController();
    setLoading(true); setError(""); setSnapshot(null); setDownloadMessage(""); setPage(0);
    void (async () => {
      try {
        const response = await fetch(`/api/jobs?${query}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Could not load export. Refresh and try again.");
        const result = parseJobsExport(await response.json().catch(() => null), statusLabel);
        if (alive) setSnapshot(result);
      } catch (error) { if (alive) setError(error instanceof Error ? error.message : "Could not load export."); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; controller.abort(); };
  }, [open, query, revision]);
  function download() {
    if (!snapshot?.rows.length) return;
    setError(""); setDownloadMessage("");
    try {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      const url = URL.createObjectURL(new Blob([jobsExportCsv(snapshot)], { type: "text/csv;charset=utf-8" })); objectUrl.current = url;
      const link = document.createElement("a"); link.href = url; link.download = `jobs_export_${snapshot.createdAt.slice(0, 10)}.csv`;
      document.body.appendChild(link); link.click(); link.remove();
      setDownloadMessage(`CSV prepared for ${snapshot.rows.length} jobs. Your browser handles saving the file.`);
    } catch { setError("Could not prepare the download. Try again."); }
  }
  return <>
    <EButton variant="outline" size="md" disabled={disabled} onClick={() => setOpen(true)}><Download className="h-4 w-4" />Export</EButton>
    <JobDialog open={open} title="Review Jobs export" onClose={() => setOpen(false)}>
      <div className="space-y-3 text-sm">
        <p>Exports jobs matching the current filters and sort order, starting at the first result. Selected checkboxes do not limit this export.</p>
        {loading ? <p role="status">Loading export preview…</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        {!loading ? <button type="button" className="min-h-11 rounded border px-3" onClick={() => setRevision(value => value + 1)}>Refresh preview</button> : null}
        {snapshot ? <>
          <p>{snapshot.rows.length} rows prepared from {snapshot.totalCount} matching jobs.</p>
          {snapshot.truncated ? <p role="alert">This export contains only the first 5,000 matching jobs. Narrow the filters to include a smaller complete result set, or download this limited export.</p> : null}
          {!snapshot.rows.length ? <p role="status">No jobs match these export filters.</p> : <>
            <div className="max-w-full overflow-x-auto" role="region" aria-label="Export rows" tabIndex={0}>
              <table className="w-max min-w-full text-left text-xs"><thead><tr>{JOBS_EXPORT_HEADERS.map(header => <th key={header} className="border p-2">{header}</th>)}</tr></thead>
                <tbody>{snapshot.rows.slice(page * 25, (page + 1) * 25).map((row, index) => <tr key={page * 25 + index}>{row.map((value, column) => <td key={column} className="max-w-64 break-words border p-2">{value}</td>)}</tr>)}</tbody>
              </table>
            </div>
            <p>Preview rows {page * 25 + 1}–{Math.min((page + 1) * 25, snapshot.rows.length)} of {snapshot.rows.length}.</p>
            <div className="flex gap-2"><button type="button" className="min-h-11 rounded border px-3" disabled={page === 0} onClick={() => setPage(value => value - 1)}>Previous rows</button><button type="button" className="min-h-11 rounded border px-3" disabled={(page + 1) * 25 >= snapshot.rows.length} onClick={() => setPage(value => value + 1)}>Next rows</button></div>
            <button type="button" className="min-h-11 rounded border px-3" onClick={download}>{snapshot.truncated ? "Download reviewed 5,000 rows" : `Download reviewed CSV (${snapshot.rows.length})`}</button>
            <p>The download uses these reviewed values. Refresh this preview to include later changes.</p>
          </>}
        </> : null}
        {downloadMessage ? <p role="status">{downloadMessage}</p> : null}
      </div>
    </JobDialog>
  </>;
}
