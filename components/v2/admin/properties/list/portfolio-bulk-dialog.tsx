"use client";

/**
 * One dialog per bulk action. Choices are read from the existing endpoints
 * (laundry accounts; the form templates per job type), the request is sent
 * once with an idempotent body, and every property's outcome is listed. The
 * choices stay after a failure so the office can retry without re-picking.
 */
import { useEffect, useMemo, useState } from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EModal, ESelect } from "@/components/v2/admin/estate-kit";
import { PROPERTY_BULK_OUTCOME_LABEL, type PropertyBulkAction, type PropertyBulkResult } from "@/lib/properties/bulk-types";
import type { PortfolioRow } from "@/lib/properties/portfolio-options";

export type BulkDialogKind = PropertyBulkAction;

const TITLE: Record<BulkDialogKind, string> = {
  "set-laundry-team": "Set laundry partner",
  "assign-checklist": "Assign checklist",
  "sync-calendars": "Sync calendars now",
};

type LaundryAccount = { id: string; name: string; email: string };
type TemplateOption = { id: string; name: string; version: number };
type TemplateChoices = { jobTypes: string[]; templatesByJobType: Record<string, TemplateOption[]> };
type RunState = { status: "idle" } | { status: "running" } | { status: "finished"; results: PropertyBulkResult[] } | { status: "failed"; message: string };
type Options = { status: "loading" } | { status: "ready" } | { status: "failed"; message: string };

function enumLabel(value: string): string {
  const text = value.replace(/_/g, " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function BulkDialog({
  kind,
  rows: initialRows,
  onClose,
  onRunningChange,
  onFinished,
}: {
  kind: BulkDialogKind;
  rows: PortfolioRow[];
  onClose: () => void;
  onRunningChange: (running: boolean) => void;
  onFinished: (results: PropertyBulkResult[]) => void;
}) {
  // The selection when the dialog opened: results keep their names after the list reloads.
  const [rows] = useState(initialRows);
  const names = useMemo(() => new Map(rows.map((row) => [row.id, row.name])), [rows]);
  const [options, setOptions] = useState<Options>(kind === "sync-calendars" ? { status: "ready" } : { status: "loading" });
  const [accounts, setAccounts] = useState<LaundryAccount[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [templates, setTemplates] = useState<TemplateChoices | null>(null);
  const [jobType, setJobType] = useState("AIRBNB_TURNOVER");
  const [templateId, setTemplateId] = useState("");
  const [run, setRun] = useState<RunState>({ status: "idle" });
  const running = run.status === "running";

  useEffect(() => {
    if (kind === "sync-calendars" || rows.length === 0) return;
    const controller = new AbortController();
    const url = kind === "set-laundry-team" ? "/api/admin/users?role=LAUNDRY" : `/api/admin/properties/${encodeURIComponent(rows[0].id)}/form-overrides`;
    fetch(url, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!response.ok || !body) throw new Error((body as { error?: string } | null)?.error ?? `Could not load the choices (${response.status}).`);
        if (kind === "set-laundry-team") {
          const list = Array.isArray(body) ? (body as Array<{ id?: string; name?: string | null; email?: string | null; isActive?: boolean }>) : [];
          setAccounts(list.filter((row) => row.id && row.isActive !== false).map((row) => ({ id: String(row.id), name: row.name ?? row.email ?? String(row.id), email: row.email ?? "" })));
        } else {
          setTemplates(body as TemplateChoices);
        }
        setOptions({ status: "ready" });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setOptions({ status: "failed", message: error instanceof Error ? error.message : "Could not load the choices." });
      });
    return () => controller.abort();
  }, [kind, rows]);

  const templateOptions = templates?.templatesByJobType[jobType] ?? [];
  const canRun =
    options.status === "ready" &&
    !running &&
    (kind !== "assign-checklist" || Boolean(templateId)) &&
    run.status !== "finished";

  async function confirm() {
    const body =
      kind === "set-laundry-team"
        ? { action: kind, ids: rows.map((row) => row.id), userIds: chosen }
        : kind === "assign-checklist"
          ? { action: kind, ids: rows.map((row) => row.id), jobType, templateId }
          : { action: kind, ids: rows.map((row) => row.id) };
    setRun({ status: "running" });
    onRunningChange(true);
    try {
      const response = await fetch("/api/admin/properties/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const parsed = (await response.json().catch(() => null)) as { results?: PropertyBulkResult[]; error?: string } | null;
      if (!response.ok || !Array.isArray(parsed?.results)) throw new Error(parsed?.error ?? `The bulk action failed (${response.status}).`);
      setRun({ status: "finished", results: parsed.results });
      onFinished(parsed.results);
    } catch (error) {
      setRun({ status: "failed", message: error instanceof Error ? error.message : "The bulk action failed." });
    } finally {
      onRunningChange(false);
    }
  }

  return (
    <EModal open onClose={() => (running ? undefined : onClose())} eyebrow="Properties" title={TITLE[kind]}>
      <div className="space-y-4">
        <p className="text-[0.8125rem]">{rows.length} selected.</p>
        {options.status === "loading" ? <p role="status" className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Loading choices…</p> : null}
        {options.status === "failed" ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{options.message}</p> : null}
        {options.status === "ready" && run.status !== "finished" ? (
          <fieldset disabled={running} className="space-y-3">
            {kind === "set-laundry-team" ? (
              <div className="space-y-2">
                <p className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">Replaces each property&apos;s laundry partners with the accounts ticked here. Properties with laundry service off are refused.</p>
                {accounts.length === 0 ? <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No active laundry accounts.</p> : null}
                <div className="grid max-h-56 gap-2 overflow-y-auto sm:grid-cols-2">
                  {accounts.map((account) => (
                    <label key={account.id} className="flex min-h-[44px] items-center gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2 text-[0.8125rem]">
                      <input
                        type="checkbox"
                        className="accent-[hsl(var(--e-primary))]"
                        checked={chosen.includes(account.id)}
                        onChange={() => setChosen((current) => (current.includes(account.id) ? current.filter((id) => id !== account.id) : [...current, account.id]))}
                      />
                      <span className="min-w-0 truncate"><span className="font-[550]">{account.name}</span> <span className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">{account.email}</span></span>
                    </label>
                  ))}
                </div>
                {chosen.length === 0 ? <p className="text-[0.75rem] text-[hsl(var(--e-warning))]">With nobody ticked the allocation is cleared: every active laundry account sees these properties and is notified.</p> : null}
              </div>
            ) : null}
            {kind === "assign-checklist" && templates ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <EField label="Job type">
                  <ESelect value={jobType} onChange={(event) => { setJobType(event.target.value); setTemplateId(""); }}>
                    {templates.jobTypes.map((type) => <option key={type} value={type}>{enumLabel(type)}</option>)}
                  </ESelect>
                </EField>
                <EField label="Checklist (form template)">
                  <ESelect value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
                    <option value="">Choose a template</option>
                    {templateOptions.map((template) => <option key={template.id} value={template.id}>{template.name} v{template.version}</option>)}
                  </ESelect>
                </EField>
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))] sm:col-span-2">Sets this property override for the job type; other job types keep their override. Jobs already started keep the form they were opened with.</p>
              </div>
            ) : null}
            {kind === "sync-calendars" ? (
              <p className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">Runs &quot;Sync now&quot; for each linked calendar, one after another. Properties without a linked calendar are refused. Each run can be undone from the property&apos;s calendar card.</p>
            ) : null}
          </fieldset>
        ) : null}
        {run.status === "failed" ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{run.message}</p> : null}
        {run.status === "finished" ? (
          <ul aria-label="Results" className="max-h-64 divide-y divide-[hsl(var(--e-border))] overflow-y-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
            {run.results.map((result) => (
              <li key={result.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[0.8125rem]">
                <span className="min-w-0 truncate font-[550]">{names.get(result.id) ?? result.id}</span>
                <span className={result.outcome === "refused" || result.outcome === "failed" ? "text-[hsl(var(--e-danger))]" : "text-[hsl(var(--e-muted-foreground))]"}>
                  {PROPERTY_BULK_OUTCOME_LABEL[result.outcome]} · {result.message}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
          {run.status === "finished" ? (
            <EButton size="sm" onClick={onClose}>Close</EButton>
          ) : (
            <>
              <EButton size="sm" variant="outline" disabled={running} onClick={onClose}>Cancel</EButton>
              <EButton size="sm" disabled={!canRun} onClick={confirm}>{running ? "Working…" : TITLE[kind]}</EButton>
            </>
          )}
        </div>
      </div>
    </EModal>
  );
}
