"use client";

/**
 * By property (was "Investigate property"): one property's runs, who recorded
 * what, evidence and a copyable update. Starts from the workspace's shared feed
 * window; "Load date range" reads an explicit earlier range through the same
 * read-only feed. Restyled with Estate primitives; behaviour unchanged.
 */
import { Tags } from "lucide-react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { LinenBags } from "@/components/operations/linen-bags";
import { OperationsDisclosure } from "@/components/operations/ui";
import { EButton, ECard, ECardBody } from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect, ETextarea } from "@/components/v2/admin/estate-kit";
import { EPill } from "@/components/v2/ui/pill";
import { LaundryHandoffReceipts } from "@/components/v2/laundry/handoff-receipts";
import { MediaGallery } from "@/components/shared/media-gallery";
import { investigateLaundry, investigationPropertyKey, investigationDate } from "@/lib/laundry/investigation";
import { buildTaskMedia, statusLabel, type LaundryTaskDTO } from "./laundry-shared";

function RunArticle({ task, canReviewBags }: { task: LaundryTaskDTO; canReviewBags: boolean }) {
  const facts = investigateLaundry(task);
  const media = buildTaskMedia(task);
  return (
    <article className="space-y-3 rounded-[12px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-4" aria-label={`Laundry run ${task.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{statusLabel(task.status)} · Pickup {investigationDate(task.pickupDate)}</h3>
        <EPill>{statusLabel(task.status)}</EPill>
      </div>
      <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">Planned return: {investigationDate(task.dropoffDate)} · Supplier: {task.supplier?.name ?? "Not recorded"}</p>
      {task.jobId ? <Link className="text-[0.8125rem] text-[hsl(var(--e-primary))] hover:underline" href={`/v2/admin/jobs/${task.jobId}`}>Open linked job</Link> : null}
      <dl className="grid gap-x-3 gap-y-1 text-[0.8125rem] sm:grid-cols-[180px_minmax(0,1fr)]">
        <dt className="font-semibold">Readiness</dt><dd>{facts.ready}</dd>
        <dt className="font-semibold">Current holder / location</dt><dd>{facts.holder}</dd>
        <dt className="font-semibold">Next responsibility</dt><dd>{facts.next}</dd>
      </dl>
      <div className="text-[0.8125rem]">
        <h4 className="font-semibold">Recorded issues</h4>
        {facts.issues.length ? <ul className="list-disc pl-5">{facts.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul> : <p>None recorded.</p>}
      </div>
      {facts.milestones.length ? <ul className="text-[0.8125rem]">{facts.milestones.map((row) => <li key={row.label}>{row.at} — {row.label}</li>)}</ul> : null}
      {canReviewBags ? (
        <OperationsDisclosure title="Individual bag history (optional)" description="Observations of labelled bags recorded for this run." icon={<Tags />}>
          <LinenBags initialTaskId={task.id} role="ADMIN" panel />
        </OperationsDisclosure>
      ) : null}
      <LaundryHandoffReceipts confirmations={task.confirmations ?? []} />
      {media.length ? (
        <details>
          <summary className="cursor-pointer text-[0.8125rem] font-[550]">Evidence ({media.length})</summary>
          <MediaGallery items={media} title="Laundry investigation evidence" className="mt-2 grid grid-cols-3 gap-2" />
        </details>
      ) : <p className="text-[0.8125rem]">No recorded photo evidence.</p>}
    </article>
  );
}

export function LaundryInvestigation({ initialTasks, canReviewBags = false }: { initialTasks: LaundryTaskDTO[]; canReviewBags?: boolean }) {
  const [tasks, setTasks] = useState(initialTasks);
  const [customRange, setCustomRange] = useState(false);
  useEffect(() => { if (!customRange) setTasks(initialTasks); }, [initialTasks, customRange]);
  const [property, setProperty] = useState("");
  const [from, setFrom] = useState("");
  const [through, setThrough] = useState("");
  const [scope, setScope] = useState("Current workspace window, plus flagged runs. Choose dates to investigate earlier records.");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const properties = new Map(tasks.map((task) => [investigationPropertyKey(task), task.property?.name ?? "Property not recorded"]));
  const selected = tasks
    .filter((task) => investigationPropertyKey(task) === property)
    .sort((a, b) => new Date(b.pickupDate).getTime() - new Date(a.pickupDate).getTime());
  const update = selected.map((task) => investigateLaundry(task).summary).join("\n\n");

  async function loadRange() {
    const first = new Date(`${from}T00:00:00Z`);
    const last = new Date(`${through}T00:00:00Z`);
    const days = Math.round((last.getTime() - first.getTime()) / 86400000) + 1;
    if (!Number.isFinite(days) || days < 1 || days > 366) { setError("Choose a valid range of 1–366 days."); return; }
    setBusy(true); setError(""); setCopyStatus("");
    try {
      const start = first.toISOString();
      const response = await fetch(`/api/laundry/week?start=${encodeURIComponent(start)}&days=${days}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !Array.isArray(body)) throw new Error(body?.error || "Could not load laundry history.");
      setCustomRange(true); setTasks(body); setProperty("");
      setScope(`${from} through ${through} (scheduled pickup or return dates), plus flagged runs outside that range.`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not load laundry history.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try { await navigator.clipboard.writeText(update); setCopyStatus("Update copied. Nothing was sent."); }
    catch { setCopyStatus("Clipboard unavailable. Select and copy the update below."); }
  }

  return (
    <ECard>
      <ECardBody className="space-y-4 pt-5">
        <section className="space-y-4" aria-label="Property laundry investigation">
          <h2 className="text-[1.0625rem] font-semibold">Investigate property laundry</h2>
          <div className="flex flex-wrap items-end gap-3">
            <EField label="From date" className="min-w-[10rem] flex-1 sm:flex-none"><EInput type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></EField>
            <EField label="Through date" className="min-w-[10rem] flex-1 sm:flex-none"><EInput type="date" value={through} onChange={(event) => setThrough(event.target.value)} /></EField>
            <EButton variant="outline" disabled={busy} onClick={() => void loadRange()}>{busy ? "Loading history…" : "Load date range"}</EButton>
          </div>
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{scope}</p>
          {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error} Previous records remain visible.</p> : null}
          <EField label="Property" className="max-w-md">
            <ESelect value={property} onChange={(event) => { setProperty(event.target.value); setCopyStatus(""); }}>
              <option value="">Choose a property</option>
              {Array.from(properties).sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </ESelect>
          </EField>
          {!tasks.length ? <p className="text-[0.8125rem]">No laundry runs in this range.</p> : !property ? <p className="text-[0.8125rem]">Select a property to inspect its runs, participants and evidence.</p> : null}
          {selected.length ? (
            <>
              <p className="text-[0.8125rem]">{selected.length} recorded run(s). Actions identify who recorded them; they do not establish who accepted custody.</p>
              <EButton variant="outline" onClick={() => void copy()}>Copy property update</EButton>
              {copyStatus ? <p role="status" className="text-[0.8125rem]">{copyStatus}</p> : null}
              <details>
                <summary className="cursor-pointer text-[0.8125rem] font-[550]">Review copyable update</summary>
                <ETextarea rows={8} aria-label="Property update" readOnly value={update} />
              </details>
              {selected.map((task) => <RunArticle key={task.id} task={task} canReviewBags={canReviewBags} />)}
            </>
          ) : null}
        </section>
      </ECardBody>
    </ECard>
  );
}
