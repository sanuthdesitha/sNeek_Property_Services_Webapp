"use client";

/**
 * Compare view of the Job forms tab: the selected forms (2–4) side by side by
 * section and question, computed on the server
 * (GET /api/admin/form-templates/compare). Every difference is written out
 * ("Added", "Missing", "Changed: Required, Choices"), never colour alone.
 * "Only differences" hides rows that are the same everywhere. From a
 * difference, CopyDifferencePanel copies the question or the setting to the
 * other forms through the bulk service (preview first, saved as drafts).
 *
 * The read is cancelled when the selection changes, and a late answer for an
 * older selection is ignored.
 */
import * as React from "react";
import Link from "next/link";
import { ECard } from "@/components/v2/ui/primitives";
import { EPill, type EPillTone } from "@/components/v2/ui/pill";
import { COMPARE_MAX_FORMS, COMPARE_MIN_FORMS, type CompareCell, type CompareRow, type TemplateComparison } from "@/lib/forms/template-compare";
import { CopyDifferencePanel, type CopyRequest } from "./compare-copy-panel";

const MARKER: Record<CompareCell["state"], { label: string; tone: EPillTone }> = {
  reference: { label: "Reference", tone: "neutral" },
  same: { label: "Same", tone: "ok" },
  changed: { label: "Changed", tone: "warn" },
  added: { label: "Added", tone: "info" },
  missing: { label: "Missing", tone: "bad" },
  repeated: { label: "Asked more than once", tone: "warn" },
};

type Load = { key: string; data: TemplateComparison | null; error: string | null; loading: boolean };

function useComparison(ids: string[], reloadToken: number): Load {
  const key = ids.join(",");
  const [state, setState] = React.useState<Load>({ key: "", data: null, error: null, loading: false });
  React.useEffect(() => {
    if (ids.length < COMPARE_MIN_FORMS || ids.length > COMPARE_MAX_FORMS) {
      setState({ key, data: null, error: null, loading: false });
      return;
    }
    const controller = new AbortController();
    setState((prev) => ({ key, data: prev.key === key ? prev.data : null, error: null, loading: true }));
    fetch(`/api/admin/form-templates/compare?ids=${encodeURIComponent(key)}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!response.ok) {
          const message = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error : `Compare failed (${response.status}).`;
          setState({ key, data: null, error: message, loading: false });
          return;
        }
        setState({ key, data: body as TemplateComparison, error: null, loading: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ key, data: null, error: "Could not reach the server.", loading: false });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reloadToken]);
  return state.key === key ? state : { key, data: null, error: null, loading: true };
}

function CellView({ cell, row, comparison }: { cell: CompareCell; row: CompareRow; comparison: TemplateComparison }) {
  const marker = MARKER[cell.state];
  const changed = cell.changed.map((entry) => entry.label).join(", ");
  return (
    <div className="space-y-1">
      <EPill tone={marker.tone}>{cell.state === "changed" ? `Changed: ${changed}` : marker.label}</EPill>
      {cell.state === "changed" ? (
        <ul className="space-y-0.5 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
          {cell.changed.map((entry) => (
            <li key={entry.key}>
              <span className="font-[550]">{entry.label}:</span> {cell.values[entry.key] ?? "–"}
              <span className="text-[hsl(var(--e-text-faint))]"> (first form: {row.cells[0].values[entry.key] ?? "–"})</span>
            </li>
          ))}
        </ul>
      ) : null}
      {cell.state === "reference" && row.differs ? (
        <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
          {comparison.properties.filter((p) => ["required", "frequency", "conditional"].includes(p.key)).map((p) => `${p.label}: ${cell.values[p.key]}`).join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

function copyRequestsFor(row: CompareRow, comparison: TemplateComparison): CopyRequest[] {
  const requests: CopyRequest[] = [];
  const source = row.cells.find((cell) => cell.field && (cell.state === "reference" || cell.state === "added" || cell.state === "same" || cell.state === "changed"));
  const missing = row.cells.filter((cell) => cell.state === "missing").map((cell) => cell.formId);
  if (source?.field && missing.length > 0) {
    requests.push({ kind: "question", row, sourceFormId: source.formId, targetIds: missing, field: source.field });
  }
  const reference = row.cells[0];
  if (reference.state === "reference" && reference.field) {
    const changedKeys = new Set(row.cells.flatMap((cell) => cell.changed.map((entry) => entry.key)));
    for (const property of comparison.properties) {
      if (!property.copyable || !changedKeys.has(property.key)) continue;
      const targets = row.cells.filter((cell) => cell.changed.some((entry) => entry.key === property.key)).map((cell) => cell.formId);
      requests.push({ kind: "setting", row, sourceFormId: reference.formId, targetIds: targets, field: reference.field, property: property.key, propertyLabel: property.label });
    }
  }
  return requests;
}

export function FormsCompare({ selectedIds, onApplied }: { selectedIds: string[]; onApplied: () => void }) {
  const [onlyDifferences, setOnlyDifferences] = React.useState(true);
  const [reloadToken, setReloadToken] = React.useState(0);
  const [copy, setCopy] = React.useState<CopyRequest | null>(null);
  const ids = React.useMemo(() => selectedIds.slice(0, COMPARE_MAX_FORMS + 1), [selectedIds]);
  const load = useComparison(ids, reloadToken);
  const toggleId = React.useId();

  React.useEffect(() => setCopy(null), [ids.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  if (ids.length < COMPARE_MIN_FORMS || ids.length > COMPARE_MAX_FORMS) {
    return (
      <ECard className="p-4 text-[0.875rem] text-[hsl(var(--e-text-secondary))]">
        {ids.length > COMPARE_MAX_FORMS
          ? `Compare shows up to ${COMPARE_MAX_FORMS} forms. Untick some in the list.`
          : `Tick ${COMPARE_MIN_FORMS} to ${COMPARE_MAX_FORMS} forms in the list, then choose Compare.`}
      </ECard>
    );
  }
  if (load.error) return <ECard role="alert" className="p-4 text-[0.875rem] text-[hsl(var(--e-danger))]">{load.error}</ECard>;
  if (!load.data) return <ECard className="p-4 text-[0.875rem] text-[hsl(var(--e-text-faint))]" aria-busy="true">Comparing…</ECard>;
  const comparison = load.data;
  const formName = (id: string) => comparison.forms.find((form) => form.id === id)?.name ?? id;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]" aria-live="polite">
          {comparison.summary.differing} of {comparison.summary.questions} questions differ. Compared with the first form, by section, question and type.
          {load.loading ? " Updating…" : ""}
        </p>
        <label htmlFor={toggleId} className="flex items-center gap-2 text-[0.8125rem]">
          <input id={toggleId} type="checkbox" className="accent-[hsl(var(--e-primary))]" checked={onlyDifferences} onChange={(e) => setOnlyDifferences(e.target.checked)} />
          Only differences
        </label>
      </div>
      {copy ? (
        <CopyDifferencePanel
          key={`${copy.kind}:${copy.row.key}:${copy.property ?? ""}`}
          request={copy}
          formName={formName}
          onClose={() => setCopy(null)}
          onApplied={() => {
            onApplied();
            setReloadToken((value) => value + 1);
          }}
        />
      ) : null}
      {comparison.sections.map((section) => {
        const rows = onlyDifferences ? section.rows.filter((row) => row.differs) : section.rows;
        if (rows.length === 0) return null;
        return (
          <ECard key={section.title} className="overflow-hidden p-0">
            <h3 className="border-b border-[hsl(var(--e-border))] px-3 py-2 text-[0.875rem] font-[600]">{section.title}</h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-left text-[0.8125rem]">
                <caption className="sr-only">Questions in {section.title}, one column per form</caption>
                <thead>
                  <tr className="border-b border-[hsl(var(--e-border))] text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    <th scope="col" className="w-[30%] px-3 py-2 font-[550]">Question</th>
                    {comparison.forms.map((form, index) => (
                      <th key={form.id} scope="col" className="px-3 py-2 font-[550]">
                        <Link href={`/v2/admin/forms/${form.id}/edit`} className="hover:underline">{form.name}</Link>
                        <span className="block font-normal">v{form.version}{form.source === "draft" ? " · draft" : " · live"}{index === 0 ? " · reference" : ""}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const requests = copyRequestsFor(row, comparison);
                    return (
                      <tr key={row.key} className="border-b border-[hsl(var(--e-border))] align-top last:border-0">
                        <th scope="row" className="px-3 py-2 font-normal">
                          <span className="font-[550]">{row.label || "(no label)"}</span>
                          <span className="block text-[0.75rem] text-[hsl(var(--e-text-faint))]">{row.typeLabel}</span>
                          {requests.map((request) => (
                            <button
                              key={`${request.kind}-${request.property ?? "q"}`}
                              type="button"
                              onClick={() => setCopy(request)}
                              className="mt-1 block text-left text-[0.75rem] font-[550] text-[hsl(var(--e-primary))] hover:underline"
                            >
                              {request.kind === "question"
                                ? `Copy this question to ${request.targetIds.length} form${request.targetIds.length === 1 ? "" : "s"} missing it`
                                : `Copy “${request.propertyLabel}” from the first form to ${request.targetIds.length} other${request.targetIds.length === 1 ? "" : "s"}`}
                            </button>
                          ))}
                        </th>
                        {row.cells.map((cell) => (
                          <td key={cell.formId} className="px-3 py-2">
                            <CellView cell={cell} row={row} comparison={comparison} />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </ECard>
        );
      })}
      {comparison.sections.every((section) => (onlyDifferences ? section.rows.every((row) => !row.differs) : section.rows.length === 0)) ? (
        <ECard className="p-4 text-[0.875rem] text-[hsl(var(--e-text-secondary))]">{onlyDifferences ? "No differences: every question matches." : "These forms have no questions."}</ECard>
      ) : null}
      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
        Settings that cannot be copied from here (choices, rules, how often, tables, effects) are changed in each form&apos;s builder.
      </p>
    </div>
  );
}
