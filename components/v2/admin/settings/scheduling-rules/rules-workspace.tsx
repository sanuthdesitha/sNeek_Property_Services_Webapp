"use client";

/**
 * Settings › Scheduling rules (owner decision 2026-11-14).
 *
 * Read-only by default for ADMIN and OPS_MANAGER: every laundry and job
 * auto-scheduling rule in plain words with its live value. An administrator
 * (or a person granted "Change the scheduling rules") unlocks with their own
 * PIN for 15 minutes, edits a draft, reviews the dry run and publishes with a
 * reason and the PIN again. History, compare, restore and backups sit in their
 * own tabs. The draft is kept when switching tabs and on any failed publish.
 */
import * as React from "react";
import { Lock, LockOpen } from "lucide-react";
import { EAlert, EBadge, EButton, ECard, ECardBody } from "@/components/v2/ui/primitives";
import { EToneNotice } from "@/components/v2/ui/tone-band";
import { EConfirmModal } from "@/components/v2/admin/estate-kit";
import { draftChanges, type DraftValues, type RuleDraft } from "@/lib/scheduling-rules/draft";
import type { RuleVersionView, SchedulingRulesView } from "@/lib/scheduling-rules/view-types";
import type { EditableRuleKey } from "@/lib/scheduling-rules/values";
import { RuleList } from "./rule-list";
import { ReviewPanel, type PublishRequest } from "./review-panel";
import { HistoryPanel } from "./history-panel";
import { BackupsPanel } from "./backups-panel";

type Tab = "laundry" | "jobs" | "history" | "backups";
const TABS: Array<{ key: Tab; label: string }> = [
  { key: "laundry", label: "Laundry" },
  { key: "jobs", label: "Jobs" },
  { key: "history", label: "History" },
  { key: "backups", label: "Backups" },
];

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string; unavailable: boolean }
  | { status: "ready"; view: SchedulingRulesView; stale: string | null };

type Unlock = { token: string; expiresAt: string };

function liveValues(view: SchedulingRulesView): DraftValues {
  return view.versions.find((version) => version.status === "LIVE")!.values;
}

export function RulesWorkspace() {
  const [state, setState] = React.useState<LoadState>({ status: "loading" });
  const [tab, setTab] = React.useState<Tab>("laundry");
  const [unlock, setUnlock] = React.useState<Unlock | null>(null);
  const [unlockOpen, setUnlockOpen] = React.useState(false);
  const [unlocking, setUnlocking] = React.useState(false);
  const [unlockError, setUnlockError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<RuleDraft | null>(null);
  const [reviewing, setReviewing] = React.useState(false);
  const [publishing, setPublishing] = React.useState(false);
  const [publishError, setPublishError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [now, setNow] = React.useState(() => Date.now());
  const loadAbort = React.useRef<AbortController | null>(null);

  const load = React.useCallback(async () => {
    loadAbort.current?.abort();
    const controller = new AbortController();
    loadAbort.current = controller;
    setState((previous) => (previous.status === "ready" ? previous : { status: "loading" }));
    try {
      const res = await fetch("/api/admin/settings/scheduling-rules", { cache: "no-store", signal: controller.signal });
      const body = await res.json().catch(() => null);
      if (controller.signal.aborted) return;
      if (!res.ok || !body || !Array.isArray(body.rules)) {
        const message = body?.error ?? "The scheduling rules could not be loaded.";
        setState((previous) => (previous.status === "ready" ? { ...previous, stale: message } : { status: "error", message, unavailable: res.status === 503 }));
        return;
      }
      setState({ status: "ready", view: body as SchedulingRulesView, stale: null });
    } catch {
      if (controller.signal.aborted) return;
      const message = "The scheduling rules could not be loaded. Check your connection.";
      setState((previous) => (previous.status === "ready" ? { ...previous, stale: message } : { status: "error", message, unavailable: false }));
    }
  }, []);

  React.useEffect(() => {
    void load();
    return () => loadAbort.current?.abort();
  }, [load]);

  // Unlock countdown; an expired unlock locks the screen but keeps the draft.
  React.useEffect(() => {
    if (!unlock) return;
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, [unlock]);
  const unlockExpired = unlock ? new Date(unlock.expiresAt).getTime() <= now : false;
  const unlocked = Boolean(unlock) && !unlockExpired;

  async function doUnlock(credentials?: { pin?: string; password?: string; newPin?: string }) {
    if (!credentials) return;
    setUnlocking(true);
    setUnlockError(null);
    try {
      const res = await fetch("/api/admin/settings/scheduling-rules/unlock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(credentials) });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.token) throw new Error(body?.error ?? "The rules could not be unlocked.");
      setUnlock({ token: body.token, expiresAt: body.expiresAt });
      setNow(Date.now());
      setUnlockOpen(false);
    } catch (error) {
      setUnlockError(error instanceof Error ? error.message : "The rules could not be unlocked.");
    } finally {
      setUnlocking(false);
    }
  }

  async function doLock() {
    setUnlock(null);
    setReviewing(false);
    await fetch("/api/admin/settings/scheduling-rules/unlock", { method: "DELETE" }).catch(() => undefined);
  }

  function startDraft(view: SchedulingRulesView, values: DraftValues, origin: RuleDraft["origin"]) {
    setDraft({ values: { ...values }, origin, baseVersion: view.latestVersion });
    setPublishError(null);
    setNotice(null);
  }

  function changeDraft(key: EditableRuleKey, value: number | boolean | string) {
    if (state.status !== "ready") return;
    const base = draft ?? { values: { ...liveValues(state.view) }, origin: { kind: "EDIT" as const }, baseVersion: state.view.latestVersion };
    setDraft({ ...base, values: { ...base.values, [key]: value } });
  }

  async function publish(request: PublishRequest) {
    if (!draft || !unlock) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const res = await fetch("/api/admin/settings/scheduling-rules/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: unlock.token,
          credentials: request.credentials,
          values: draft.values,
          effectiveFrom: request.effectiveFrom,
          reason: request.reason,
          expectedLatestVersion: draft.baseVersion,
          appliesToExisting: request.appliesToExisting,
          confirmed: true,
          kind: draft.origin.kind,
          restoredFromVersion: draft.origin.kind === "RESTORE" ? draft.origin.restoredFromVersion : null,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        if (res.status === 423 && (body?.code === "LOCKED" || body?.code === "UNLOCK_EXPIRED")) setUnlock(null);
        throw new Error(body?.error ?? "The rules could not be published.");
      }
      setDraft(null);
      setReviewing(false);
      setNotice(`Version ${body.version} published. It takes effect from ${body.effectiveFrom}. A backup was taken first.`);
      await load();
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : "The rules could not be published.");
      throw error;
    } finally {
      setPublishing(false);
    }
  }

  if (state.status === "loading") {
    return <p role="status" className="text-[0.875rem]">Loading the scheduling rules…</p>;
  }
  if (state.status === "error") {
    return (
      <EAlert tone="danger" title={state.unavailable ? "Scheduling rules unavailable" : "Could not load"}>
        <p>{state.message}</p>
        {state.unavailable ? <p className="mt-1">Automatic scheduling that depends on these rules is paused until this is fixed; nothing is planned on guessed values.</p> : null}
        <EButton className="mt-2" size="sm" variant="outline" onClick={() => void load()}>Try again</EButton>
      </EAlert>
    );
  }

  const view = state.view;
  const live = liveValues(view);
  const changes = draft ? draftChanges(live, draft.values) : [];
  const scheduled = view.versions.filter((version) => version.status === "SCHEDULED");

  return (
    <div className="space-y-5">
      {state.stale ? (
        <EToneNotice tone="attention" title="Showing the last loaded rules">
          {state.stale} <EButton size="sm" variant="outline" onClick={() => void load()}>Refresh</EButton>
        </EToneNotice>
      ) : null}
      {notice ? <EAlert tone="success" title="Published">{notice}</EAlert> : null}

      <ECard>
        <ECardBody className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 space-y-1 text-[0.875rem]">
            <p className="font-semibold">Version {view.liveVersion} is live <span className="font-normal text-[hsl(var(--e-text-secondary))]">({view.liveEffectiveLabel})</span></p>
            {scheduled.map((version) => <p key={version.version}>Version {version.version} is scheduled {version.effectiveLabel.toLowerCase()}.</p>)}
            <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{unlocked ? `Unlocked until ${new Date(unlock!.expiresAt).toLocaleTimeString("en-AU", { timeZone: view.timezone, hour: "2-digit", minute: "2-digit" })}.` : "Locked. The rules cannot be changed by accident."}</p>
          </div>
          {view.canEdit ? (
            unlocked ? (
              <EButton variant="outline" onClick={() => void doLock()} disabled={publishing}><Lock className="h-4 w-4" aria-hidden />Lock now</EButton>
            ) : (
              <EButton onClick={() => { setUnlockError(null); setUnlockOpen(true); }}><LockOpen className="h-4 w-4" aria-hidden />Unlock to change…</EButton>
            )
          ) : (
            <EBadge tone="neutral">View only</EBadge>
          )}
        </ECardBody>
      </ECard>

      {view.drift.length > 0 ? (
        <EAlert tone="warning" title="Settings differ from the live version">
          {view.drift.length} stored setting(s) no longer match version {view.liveVersion}. The live version is what the planner uses; the next activation writes it back.
        </EAlert>
      ) : null}
      {unlockExpired && draft ? <EToneNotice tone="attention" title="Unlock expired">Your draft is kept. Unlock again to continue.</EToneNotice> : null}

      <div role="tablist" aria-label="Scheduling rules" className="flex flex-wrap gap-2">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            onClick={() => { setTab(item.key); setReviewing(false); }}
            className={tab === item.key
              ? "min-h-[44px] rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary))] px-4 text-[0.875rem] text-[hsl(var(--e-primary-foreground))] sm:min-h-0 sm:py-1.5"
              : "min-h-[44px] rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border-strong))] px-4 text-[0.875rem] sm:min-h-0 sm:py-1.5"}
          >
            {item.label}
          </button>
        ))}
      </div>

      {draft && changes.length > 0 && !reviewing ? (
        <EToneNotice tone="attention" title={`Draft: ${changes.length} change${changes.length === 1 ? "" : "s"}`}>
          <div className="flex flex-wrap gap-2 pt-1">
            <EButton size="sm" onClick={() => setReviewing(true)} disabled={!unlocked}>Review changes…</EButton>
            <EButton size="sm" variant="outline" onClick={() => setDraft(null)}>Discard draft</EButton>
          </div>
        </EToneNotice>
      ) : null}

      <div role="tabpanel">
        {reviewing && draft && unlock && changes.length > 0 ? (
          <ReviewPanel
            view={view}
            draft={draft}
            changes={changes}
            token={unlock.token}
            publishing={publishing}
            publishError={publishError}
            onBack={() => setReviewing(false)}
            onPublish={publish}
          />
        ) : tab === "laundry" || tab === "jobs" ? (
          <>
            {tab === "jobs" ? (
              <ECard className="mb-5">
                <ECardBody className="space-y-2">
                  <h2 className="text-[1rem] font-semibold">The schedule that runs these rules</h2>
                  <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">Fixed in the worker (Australia/Sydney time); shown for reference.</p>
                  <ul className="space-y-1 text-[0.8125rem]">
                    {view.workerSchedule.map((item) => <li key={item.name} className="break-words"><span className="font-medium">{item.when}</span>: {item.does}</li>)}
                  </ul>
                </ECardBody>
              </ECard>
            ) : null}
            <RuleList view={view} domain={tab} editing={unlocked} disabled={publishing} draft={draft?.values ?? (unlocked ? live : null)} onDraftChange={changeDraft} />
          </>
        ) : tab === "history" ? (
          <HistoryPanel
            view={view}
            unlocked={unlocked}
            busy={publishing}
            onRestore={(version: RuleVersionView) => { startDraft(view, version.values, { kind: "RESTORE", restoredFromVersion: version.version }); setReviewing(true); }}
          />
        ) : (
          <BackupsPanel
            view={view}
            token={unlocked ? unlock!.token : null}
            busy={publishing}
            onRestoreValues={(values, label) => { startDraft(view, values, { kind: "IMPORT", label }); setReviewing(true); }}
          />
        )}
        {reviewing && draft && changes.length === 0 ? (
          <EAlert tone="info" title="Nothing to change">These values are the same as the live version.</EAlert>
        ) : null}
      </div>

      <EConfirmModal
        open={unlockOpen}
        onClose={() => setUnlockOpen(false)}
        title="Unlock the scheduling rules"
        description={unlockError ?? "Confirm with your own PIN. The rules stay unlocked for you for 15 minutes; publishing asks for your PIN again."}
        confirmLabel="Unlock"
        requireSecurity
        danger={false}
        loading={unlocking}
        onConfirm={(credentials) => doUnlock(credentials)}
      />
    </div>
  );
}
