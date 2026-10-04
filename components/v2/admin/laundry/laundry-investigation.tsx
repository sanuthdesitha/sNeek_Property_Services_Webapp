"use client";
import { OperationsButton } from "@/components/operations/ui";
import { useEffect, useState } from "react";
import Link from "next/link";
import { EButton } from "@/components/v2/ui/primitives";
import { LaundryHandoffReceipts } from "@/components/v2/laundry/handoff-receipts";
import { MediaGallery } from "@/components/shared/media-gallery";
import { investigateLaundry, investigationPropertyKey, investigationDate } from "@/lib/laundry/investigation";
import { buildTaskMedia, statusLabel, type LaundryTaskDTO } from "./laundry-shared";

export function LaundryInvestigation({ initialTasks }: { initialTasks: LaundryTaskDTO[] }) {
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
  const properties = new Map(tasks.map(task => [investigationPropertyKey(task), task.property?.name ?? "Property not recorded"]));
  const selected = tasks.filter(task => investigationPropertyKey(task) === property)
    .sort((a,b) => new Date(b.pickupDate).getTime() - new Date(a.pickupDate).getTime());
  const update = selected.map(task => investigateLaundry(task).summary).join("\n\n");
  async function loadRange() {
    const first = new Date(`${from}T00:00:00Z`), last = new Date(`${through}T00:00:00Z`);
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
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not load laundry history."); }
    finally { setBusy(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(update); setCopyStatus("Update copied. Nothing was sent."); }
    catch { setCopyStatus("Clipboard unavailable. Select and copy the update below."); }
  }
  return <section className="space-y-4" aria-label="Property laundry investigation">
    <h2 className="text-lg font-semibold">Investigate property laundry</h2>
    <div className="flex flex-wrap items-end gap-3">
      <label>From date<input className="block rounded border p-2" type="date" value={from} onChange={event => setFrom(event.target.value)} /></label>
      <label>Through date<input className="block rounded border p-2" type="date" value={through} onChange={event => setThrough(event.target.value)} /></label>
      <EButton variant="outline" disabled={busy} onClick={() => void loadRange()}>{busy ? "Loading history…" : "Load date range"}</EButton>
    </div>
    <p className="text-sm">{scope}</p>
    {error ? <p role="alert">{error} Previous records remain visible.</p> : null}
    <label className="block">Property<select className="ml-2 rounded border p-2" value={property} onChange={event => {setProperty(event.target.value);setCopyStatus("");}}>
      <option value="">Choose a property</option>
      {Array.from(properties).sort((a,b)=>a[1].localeCompare(b[1])).map(([id,name])=><option key={id} value={id}>{name}</option>)}
    </select></label>
    {!tasks.length ? <p>No laundry runs in this range.</p> : !property ? <p>Select a property to inspect its runs, participants and evidence.</p> : null}
    {selected.length ? <>
      <p>{selected.length} recorded run(s). Actions identify who recorded them; they do not establish who accepted custody.</p>
      <EButton variant="outline" onClick={() => void copy()}>Copy property update</EButton>
      {copyStatus ? <p role="status">{copyStatus}</p> : null}
      <details><summary className="cursor-pointer underline">Review copyable update</summary><textarea className="mt-2 w-full rounded border p-2" rows={8} aria-label="Property update" readOnly value={update} /></details>
      {selected.map(task => {
        const facts = investigateLaundry(task), media = buildTaskMedia(task);
        return <article key={task.id} className="space-y-3 rounded border p-4" aria-label={`Laundry run ${task.id}`}>
          <h3 className="font-semibold">{statusLabel(task.status)} · Pickup {investigationDate(task.pickupDate)}</h3>
          <p>Planned return: {investigationDate(task.dropoffDate)} · Supplier: {task.supplier?.name ?? "Not recorded"}</p>
          {task.jobId ? <Link className="underline" href={`/v2/admin/jobs/${task.jobId}`}>Open linked job</Link> : null}
          <dl className="space-y-1 text-sm"><dt className="font-semibold">Readiness</dt><dd>{facts.ready}</dd><dt className="font-semibold">Current holder / location</dt><dd>{facts.holder}</dd><dt className="font-semibold">Next responsibility</dt><dd>{facts.next}</dd></dl>
          <div><h4 className="font-semibold">Recorded issues</h4>{facts.issues.length ? <ul>{facts.issues.map((issue,index)=><li key={index}>{issue}</li>)}</ul> : <p>None recorded.</p>}</div>
          {facts.milestones.length ? <ul className="text-sm">{facts.milestones.map(row=><li key={row.label}>{row.at} — {row.label}</li>)}</ul> : null}
          <OperationsButton asChild variant="outline" className="my-2"><Link href={`/linen-bags?taskId=${encodeURIComponent(task.id)}`}>Individual bag custody history</Link></OperationsButton>
          <LaundryHandoffReceipts confirmations={task.confirmations ?? []} />
          {media.length ? <details><summary className="cursor-pointer underline">Evidence ({media.length})</summary><MediaGallery items={media} title="Laundry investigation evidence" className="mt-2 grid grid-cols-3 gap-2" /></details> : <p className="text-sm">No recorded photo evidence.</p>}
        </article>;
      })}
    </> : null}
  </section>;
}
