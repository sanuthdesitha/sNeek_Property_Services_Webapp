"use client";

/**
 * Backups of the scheduling rules: download a JSON file, take a backup now,
 * the stored backups (before every publish and weekly), and restoring from a
 * stored backup or an uploaded file. A restore only fills the draft: it is
 * published as a new version through the usual review and PIN.
 */
import * as React from "react";
import { EAlert, EButton, ECard, ECardBody, ECardHeader, ECardTitle, EEmptyState } from "@/components/v2/ui/primitives";
import type { DraftValues } from "@/lib/scheduling-rules/draft";
import type { SchedulingRulesView } from "@/lib/scheduling-rules/view-types";

type Snapshot = { id: string; source: string; liveVersion: number; checksum: string; createdAt: string };
type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; rows: Snapshot[] };

const SOURCE_LABEL: Record<string, string> = { PRE_PUBLISH: "Before a publish", WEEKLY: "Weekly", MANUAL: "Taken by hand" };

type Props = {
  view: SchedulingRulesView;
  token: string | null;
  busy: boolean;
  onRestoreValues: (values: DraftValues, label: string) => void;
};

export function BackupsPanel({ view, token, busy, onRestoreValues }: Props) {
  const [state, setState] = React.useState<LoadState>({ status: "loading" });
  const [message, setMessage] = React.useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [working, setWorking] = React.useState(false);
  const abort = React.useRef<AbortController | null>(null);

  const load = React.useCallback(async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/admin/settings/scheduling-rules/snapshots", { cache: "no-store", signal: controller.signal });
      const body = await res.json().catch(() => null);
      if (controller.signal.aborted) return;
      if (!res.ok || !body || !Array.isArray(body.snapshots)) setState({ status: "error", message: body?.error ?? "Backups could not be loaded." });
      else setState({ status: "ready", rows: body.snapshots as Snapshot[] });
    } catch {
      if (!controller.signal.aborted) setState({ status: "error", message: "Backups could not be loaded." });
    }
  }, []);

  React.useEffect(() => {
    if (view.canEdit) void load();
    return () => abort.current?.abort();
  }, [load, view.canEdit]);

  async function takeBackup() {
    if (!token) return;
    setWorking(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/settings/scheduling-rules/snapshots", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "The backup could not be taken.");
      setMessage({ tone: "success", text: `Backup saved (version ${body.liveVersion}).` });
      await load();
    } catch (error) {
      setMessage({ tone: "danger", text: error instanceof Error ? error.message : "The backup could not be taken." });
    } finally {
      setWorking(false);
    }
  }

  async function restoreSnapshot(snapshot: Snapshot) {
    setWorking(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/settings/scheduling-rules/snapshots/${encodeURIComponent(snapshot.id)}`, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.values) throw new Error(body?.error ?? "This backup cannot be used.");
      onRestoreValues(body.values as DraftValues, `the ${SOURCE_LABEL[snapshot.source]?.toLowerCase() ?? "stored"} backup of version ${snapshot.liveVersion}`);
    } catch (error) {
      setMessage({ tone: "danger", text: error instanceof Error ? error.message : "This backup cannot be used." });
    } finally {
      setWorking(false);
    }
  }

  async function restoreFile(file: File) {
    if (!token) return;
    setWorking(true);
    setMessage(null);
    try {
      if (file.size > 2_000_000) throw new Error("The file is too large to be a scheduling rules backup.");
      const text = await file.text();
      const res = await fetch("/api/admin/settings/scheduling-rules/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, text }) });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.values) {
        const problems: string[] = Array.isArray(body?.problems) ? body.problems : [];
        throw new Error([body?.error ?? "This file cannot be used.", ...problems.slice(1, 3)].join(" "));
      }
      onRestoreValues(body.values as DraftValues, `the file "${file.name}" (version ${body.sourceVersion}, ${String(body.exportedAt).slice(0, 10)})`);
    } catch (error) {
      setMessage({ tone: "danger", text: error instanceof Error ? error.message : "This file cannot be used." });
    } finally {
      setWorking(false);
    }
  }

  if (!view.canEdit) {
    return <EAlert tone="info" title="Backups">Only an administrator can download or restore scheduling rule backups.</EAlert>;
  }

  const disabled = busy || working;
  return (
    <div className="space-y-4">
      <ECard>
        <ECardHeader><ECardTitle>Download a backup</ECardTitle></ECardHeader>
        <ECardBody className="space-y-2 text-[0.875rem]">
          <p>A JSON file with every version, checked by a checksum when it is read back.</p>
          <div className="flex flex-wrap gap-2">
            <EButton asChild variant="outline"><a href="/api/admin/settings/scheduling-rules/backup">Download rules</a></EButton>
            <EButton asChild variant="outline"><a href="/api/admin/settings/scheduling-rules/backup?extras=1">Download with calendar options, recurring rules and partner schedules</a></EButton>
          </div>
          <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">Restoring a file brings back the rule values only; the extras are kept in the file for reference.</p>
        </ECardBody>
      </ECard>

      <ECard>
        <ECardHeader><ECardTitle>Restore from a file</ECardTitle></ECardHeader>
        <ECardBody className="space-y-2 text-[0.875rem]">
          <p>The file is checked first; then you review it and publish it as a new version with your PIN.</p>
          <input
            type="file"
            accept="application/json,.json"
            aria-label="Choose a scheduling rules backup file"
            disabled={disabled || !token}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void restoreFile(file);
            }}
          />
          {!token ? <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">Unlock the rules first.</p> : null}
        </ECardBody>
      </ECard>

      <ECard>
        <ECardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <ECardTitle>Stored backups</ECardTitle>
          <EButton size="sm" variant="outline" disabled={disabled || !token} onClick={() => void takeBackup()}>Take a backup now</EButton>
        </ECardHeader>
        <ECardBody className="space-y-2 text-[0.875rem]">
          {message ? <EAlert tone={message.tone} title={message.tone === "success" ? "Done" : "Not done"}>{message.text}</EAlert> : null}
          {state.status === "loading" ? <p>Loading backups…</p> : null}
          {state.status === "error" ? <EAlert tone="danger" title="Unavailable">{state.message} <EButton size="sm" variant="outline" onClick={() => void load()}>Try again</EButton></EAlert> : null}
          {state.status === "ready" && state.rows.length === 0 ? <EEmptyState title="No backups yet" description="One is taken before every publish and every Monday." /> : null}
          {state.status === "ready" && state.rows.length > 0 ? (
            <ul className="space-y-2">
              {state.rows.map((snapshot) => (
                <li key={snapshot.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-[hsl(var(--e-border))] pb-2">
                  <span className="break-words">{SOURCE_LABEL[snapshot.source] ?? snapshot.source} · version {snapshot.liveVersion} · {new Date(snapshot.createdAt).toLocaleString("en-AU", { timeZone: view.timezone })}</span>
                  <EButton size="sm" variant="outline" disabled={disabled || !token} onClick={() => void restoreSnapshot(snapshot)}>Restore…</EButton>
                </li>
              ))}
            </ul>
          ) : null}
        </ECardBody>
      </ECard>
    </div>
  );
}
