"use client";

/**
 * "Add to shopping run" (one need from its row or panel, or the selection from
 * the bulk bar's "Add to one shopping run"): choose an open run or start a new
 * one, check the quantity for each need, and add. One answer per need. Adding
 * never marks a need ordered, bought or delivered; the form says so. The form
 * is frozen while saving and keeps its request id until the save succeeds.
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, EModal } from "@/components/v2/admin/estate-kit";
import type { AddToRunResponse, AddToRunResult, OpenRunOption } from "@/lib/inventory/urgent-stock-shopping";
import { newRequestId } from "./urgent-api";

export type AddToRunNeed = { id: string; itemName: string; propertyName: string; unit: string; purchaseQuantity: number | null; suggestedBuy: number | null };

type RunsLoad = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; runs: OpenRunOption[] };
type Save = { status: "idle" } | { status: "saving" } | { status: "failed"; message: string } | { status: "done"; response: AddToRunResponse };

function defaultTitle(needs: AddToRunNeed[]): string {
  const properties = Array.from(new Set(needs.map((need) => need.propertyName)));
  return properties.length === 1 ? `Urgent stock · ${properties[0]}` : "Urgent stock";
}

function initialQuantity(need: AddToRunNeed): string {
  const value = need.purchaseQuantity ?? need.suggestedBuy;
  return value && value > 0 ? String(value) : "";
}

export function AddToRunDialog({ needs, onClose, onDone }: { needs: AddToRunNeed[]; onClose: () => void; onDone: (results: AddToRunResult[]) => void }) {
  const [runs, setRuns] = React.useState<RunsLoad>({ status: "loading" });
  const [choice, setChoice] = React.useState<string>("new");
  const [title, setTitle] = React.useState(() => defaultTitle(needs));
  const [quantities, setQuantities] = React.useState<Record<string, string>>(() => Object.fromEntries(needs.map((need) => [need.id, initialQuantity(need)])));
  const [save, setSave] = React.useState<Save>({ status: "idle" });
  const request = React.useRef<{ key: string; id: string } | null>(null);
  const saving = save.status === "saving";

  React.useEffect(() => {
    const controller = new AbortController();
    fetch("/api/inventory/urgent-stock/shopping-run", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { runs?: OpenRunOption[]; error?: string } | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !body?.runs) throw new Error(body?.error ?? "Could not load the open shopping runs.");
        setRuns({ status: "ready", runs: body.runs });
        if (body.runs[0]) setChoice(body.runs[0].id);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setRuns({ status: "error", message: error instanceof Error ? error.message : "Could not load the open shopping runs." });
      });
    return () => controller.abort();
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const chosen = Object.fromEntries(needs.flatMap((need) => {
      const value = Number(quantities[need.id]);
      return quantities[need.id]?.trim() && Number.isFinite(value) && value > 0 ? [[need.id, value]] : [];
    }));
    const target = choice === "new" ? { kind: "new" as const, title: title.trim() } : { kind: "existing" as const, runId: choice };
    const body = { needIds: needs.map((need) => need.id), target, quantities: chosen };
    const key = JSON.stringify(body);
    if (request.current?.key !== key) request.current = { key, id: newRequestId() };
    setSave({ status: "saving" });
    try {
      const response = await fetch("/api/inventory/urgent-stock/shopping-run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, requestId: request.current.id }) });
      const result = (await response.json().catch(() => null)) as (AddToRunResponse & { error?: string }) | null;
      if (!response.ok || !result?.results) throw new Error(result?.error ?? `Not added (${response.status}).`);
      request.current = null;
      setSave({ status: "done", response: result });
      onDone(result.results);
    } catch (error) {
      setSave({ status: "failed", message: error instanceof Error ? error.message : "Not added." });
    }
  }

  const names = new Map(needs.map((need) => [need.id, `${need.itemName} · ${need.propertyName}`]));
  return (
    <EModal open onClose={() => (saving ? undefined : onClose())} eyebrow="Urgent needs" title={needs.length === 1 ? "Add to shopping run" : "Add to one shopping run"}>
      {save.status === "done" ? (
        <div className="space-y-3">
          <p className="text-[0.875rem]">Shopping run: <span className="font-[600]">{save.response.run.title}</span></p>
          <ul aria-label="Results" className="max-h-64 divide-y divide-[hsl(var(--e-border))] overflow-y-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
            {save.response.results.map((result) => (
              <li key={result.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[0.8125rem]">
                <span className="min-w-0 truncate font-[550]">{names.get(result.id) ?? result.id}</span>
                <span className={result.outcome === "refused" ? "text-[hsl(var(--e-danger))]" : "text-[hsl(var(--e-muted-foreground))]"}>{result.outcome === "refused" ? "Not added" : result.outcome === "already" ? "Already on it" : "Added"} · {result.message}</span>
              </li>
            ))}
          </ul>
          <div className="flex justify-end border-t border-[hsl(var(--e-border))] pt-4"><EButton size="sm" onClick={onClose}>Close</EButton></div>
        </div>
      ) : (
        <form onSubmit={submit}>
          <fieldset disabled={saving} className="space-y-3">
            <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
              Adds a planned line to the run. It does not buy anything or mark the need ordered or delivered; record those stages as they happen.
            </p>
            <fieldset className="space-y-1.5">
              <legend className="mb-1 text-[0.75rem] font-[600] text-[hsl(var(--e-muted-foreground))]">Shopping run</legend>
              {runs.status === "loading" ? <p role="status" className="text-[0.8125rem]">Loading open runs…</p> : null}
              {runs.status === "error" ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{runs.message}</p> : null}
              {runs.status === "ready" ? runs.runs.map((run) => (
                <label key={run.id} className="flex items-start gap-2 text-[0.8125rem]">
                  <input type="radio" name="shopping-run" className="mt-0.5" checked={choice === run.id} onChange={() => setChoice(run.id)} />
                  <span className="min-w-0"><span className="font-[550]">{run.title}</span> <span className="text-[hsl(var(--e-muted-foreground))]">· {run.ownerName} · {run.lineCount} {run.lineCount === 1 ? "line" : "lines"}{run.properties.length ? ` · ${run.properties.slice(0, 3).join(", ")}` : ""}</span></span>
                </label>
              )) : null}
              {runs.status === "ready" && runs.runs.length === 0 ? <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No open shopping runs.</p> : null}
              <label className="flex items-start gap-2 text-[0.8125rem]">
                <input type="radio" name="shopping-run" className="mt-0.5" checked={choice === "new"} onChange={() => setChoice("new")} />
                Start a new run
              </label>
              {choice === "new" ? <EField label="Run name"><EInput required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} /></EField> : null}
            </fieldset>
            <div className="space-y-2">
              {needs.map((need) => (
                <EField key={need.id} label={`${need.itemName} · ${need.propertyName} (${need.unit})`} hint={quantities[need.id] ? undefined : "No requested quantity or suggestion: enter one."}>
                  <EInput type="number" min="0.001" step="any" value={quantities[need.id] ?? ""} onChange={(event) => setQuantities((current) => ({ ...current, [need.id]: event.target.value }))} />
                </EField>
              ))}
            </div>
            {save.status === "failed" ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{save.message}</p> : null}
            <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
              <EButton type="button" size="sm" variant="outline" onClick={onClose}>Cancel</EButton>
              <EButton type="submit" size="sm" disabled={runs.status === "loading" || (choice === "new" && !title.trim())}>{saving ? "Adding…" : "Add"}</EButton>
            </div>
          </fieldset>
        </form>
      )}
    </EModal>
  );
}
