"use client";

/**
 * "Import or bulk create": the two ways to add many jobs.
 *
 * - Bulk create already exists on the New job page; this links straight to it
 *   (`/v2/admin/jobs/new#bulk-create`).
 * - Import a CSV: download the template, choose a file, check it (server-side
 *   validation, a row-by-row preview, nothing created), then confirm. Rows are
 *   created by the job-create service once per file row, so retrying the same
 *   file cannot create a job twice. A named cleaner is then assigned through
 *   the existing assign route, one created job at a time, with the outcome on
 *   each row.
 *
 * Choosing another file discards the preview. Controls freeze while a request
 * runs; a failed import keeps the file and its key for an explicit retry.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { IMPORT_TEMPLATE, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, type ImportRow } from "@/lib/jobs/csv-import";
import type { ImportApplyRow } from "@/lib/jobs/csv-import-server";
import { JobDialog } from "./job-dialog";
import { ImportPreviewList, ImportResultList, type AssignState } from "./jobs-import-rows";

type FileState = { name: string; text: string } | null;
type Stage =
  | { kind: "choose" }
  | { kind: "preview"; key: string; rows: ImportRow[] }
  | { kind: "results"; rows: ImportApplyRow[] };

async function postImport(body: unknown): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const response = await fetch("/api/admin/jobs/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const parsed: unknown = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body: parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {} };
}

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([`${IMPORT_TEMPLATE}\n`], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "jobs-import-template.csv";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function JobsImportDialog({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: () => void }) {
  const [file, setFile] = useState<FileState>(null);
  const [stage, setStage] = useState<Stage>({ kind: "choose" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [assigns, setAssigns] = useState<Record<number, AssignState>>({});
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => {
    if (open) return;
    setFile(null); setStage({ kind: "choose" }); setError(""); setAssigns({});
  }, [open]);

  async function chooseFile(selected: File | undefined) {
    setStage({ kind: "choose" }); setError(""); setAssigns({});
    if (!selected) { setFile(null); return; }
    if (selected.size > MAX_IMPORT_BYTES) { setFile(null); setError(`That file is larger than ${MAX_IMPORT_BYTES / 1000} KB. Split it into smaller files.`); return; }
    const text = await selected.text();
    if (alive.current) setFile({ name: selected.name, text });
  }

  async function check() {
    if (!file || busy) return;
    setBusy(true); setError("");
    try {
      const result = await postImport({ mode: "preview", csv: file.text });
      if (!alive.current) return;
      if (!result.ok || result.body.kind !== "ok" || !Array.isArray(result.body.rows) || typeof result.body.key !== "string") {
        setError(typeof result.body.error === "string" ? result.body.error : `The file could not be checked (${result.status}). Nothing was created.`);
        return;
      }
      setStage({ kind: "preview", key: result.body.key, rows: result.body.rows as ImportRow[] });
    } catch {
      if (alive.current) setError("The file could not be checked. Check the connection and try again. Nothing was created.");
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function assignCreated(rows: ImportApplyRow[]) {
    for (const row of rows) {
      if (!row.jobId || !row.assignCleanerId || !alive.current) continue;
      setAssigns((current) => ({ ...current, [row.line]: { status: "saving" } }));
      try {
        const response = await fetch(`/api/admin/jobs/${encodeURIComponent(row.jobId)}/assign`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userIds: [row.assignCleanerId], primaryUserId: row.assignCleanerId }),
        });
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        if (!alive.current) return;
        setAssigns((current) => ({ ...current, [row.line]: response.ok ? { status: "done" } : { status: "failed", message: body.error ?? `Assignment refused (${response.status}).` } }));
      } catch {
        if (alive.current) setAssigns((current) => ({ ...current, [row.line]: { status: "failed", message: "The connection failed; assign this cleaner from the job." } }));
      }
    }
  }

  async function apply() {
    if (!file || stage.kind !== "preview" || busy) return;
    setBusy(true); setError("");
    try {
      const result = await postImport({ mode: "apply", csv: file.text, key: stage.key });
      if (!alive.current) return;
      if (!result.ok || !Array.isArray(result.body.rows)) {
        setError(typeof result.body.error === "string" ? result.body.error : `The import did not finish (${result.status}). Import again with the same file: rows already created are not created twice.`);
        return;
      }
      const rows = result.body.rows as ImportApplyRow[];
      setStage({ kind: "results", rows });
      onImported();
      await assignCreated(rows);
    } catch {
      if (alive.current) setError("The connection failed during the import. Import again with the same file: rows already created are not created twice.");
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  const validCount = stage.kind === "preview" ? stage.rows.filter((row) => row.ok).length : 0;

  return (
    <JobDialog open={open} title="Import or bulk create" busy={busy} onClose={onClose}>
      <div className="space-y-5 text-[0.8125rem]">
        <section aria-labelledby="bulk-create-heading" className="space-y-2">
          <h3 id="bulk-create-heading" className="font-[600]">Bulk create</h3>
          <p className="text-[hsl(var(--e-muted-foreground))]">One job type and set of details for several properties or dates, on the New job page.</p>
          <EButton asChild variant="outline" size="sm"><Link href="/v2/admin/jobs/new#bulk-create">Open bulk create</Link></EButton>
        </section>

        <section aria-labelledby="csv-import-heading" className="space-y-3 border-t border-[hsl(var(--e-border))] pt-4">
          <h3 id="csv-import-heading" className="font-[600]">Import from a CSV file</h3>
          <p className="text-[hsl(var(--e-muted-foreground))]">
            Up to {MAX_IMPORT_ROWS} rows: property (exact name or id), date, start, due, job type, cleaner (email or exact name) and notes. Nothing is created until you confirm. Each created job sends the same booking confirmation as the New job page, when that is switched on.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <EButton variant="outline" size="sm" onClick={downloadTemplate} disabled={busy}>Download template</EButton>
            <label className="inline-flex min-w-0 max-w-full items-center gap-2">
              <span className="sr-only">CSV file</span>
              <input type="file" accept=".csv,text/csv" disabled={busy || stage.kind === "results"}
                onChange={(event) => void chooseFile(event.target.files?.[0])}
                className="min-w-0 max-w-full text-[0.8125rem] file:mr-2 file:rounded-[var(--e-radius)] file:border file:border-[hsl(var(--e-border))] file:bg-[hsl(var(--e-surface))] file:px-3 file:py-1.5" />
            </label>
          </div>

          {stage.kind === "preview" ? <ImportPreviewList rows={stage.rows} /> : null}
          {stage.kind === "results" ? <ImportResultList rows={stage.rows} assigns={assigns} /> : null}
          {error ? <p role="alert" className="text-[hsl(var(--e-danger))]">{error}</p> : null}

          <div className="flex flex-wrap justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
            {stage.kind === "results" ? <EButton onClick={onClose} disabled={busy}>Done</EButton> : (
              <>
                <EButton variant="outline" onClick={onClose} disabled={busy}>Cancel</EButton>
                {stage.kind === "choose" ? (
                  <EButton onClick={() => void check()} disabled={busy || !file}>{busy ? "Checking…" : "Check file"}</EButton>
                ) : (
                  <EButton onClick={() => void apply()} disabled={busy || validCount === 0}>
                    {busy ? "Creating…" : `Create ${validCount} job${validCount === 1 ? "" : "s"}`}
                  </EButton>
                )}
              </>
            )}
          </div>
        </section>
      </div>
    </JobDialog>
  );
}
