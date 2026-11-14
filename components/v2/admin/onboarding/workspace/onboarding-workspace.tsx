"use client";

/**
 * The onboarding workspace (board "Property onboarding steps"): checklist on
 * the left, one step in the middle, "this step sets up" on the right. Steps
 * open in any order (checklist, Next, or a #step deep link) and every field
 * saves on its own. On a phone the checklist is the menu and a step opens full
 * screen with Previous and Next docked.
 */
import * as React from "react";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { EButton, EPageHeader } from "@/components/v2/ui/primitives";
import { EToneNotice } from "@/components/v2/ui/tone-band";
import { useIsPhone } from "@/components/v2/ui/use-phone";
import { EstateLoader } from "@/components/v2/ui/estate-loader";
import { ONBOARDING_SECTIONS, isOnboardingStepKey, sectionDef, type OnboardingSectionKey, type OnboardingStepKey } from "@/lib/onboarding/workspace/sections";
import { sectionMark } from "@/lib/onboarding/workspace/readiness";
import type { OnboardingWorkspaceView, SaveConflictView } from "@/lib/onboarding/workspace/view-types";
import { useOnboardingWorkspace, type OnboardingWorkspaceApi, type SaveState } from "./use-onboarding-workspace";
import { ChecklistMark, ONB_MUTED, ReadinessBar, formatClock, formatSavedAt } from "./onboarding-kit";
import { BasicsStep, ClientStep, RoomsStep } from "./steps-property";
import { AccessStep, LaundryStep, StockStep } from "./steps-access";
import { CalendarStep, PhotosStep, PricingStep, RulesStep, ScopeStep } from "./steps-service";
import { ReadinessStep } from "./readiness-step";
import { ClientLinkDialog } from "./client-link-dialog";

const STEP_ORDER: OnboardingStepKey[] = [...ONBOARDING_SECTIONS.map((section) => section.key), "readiness"];

function stepTitle(step: OnboardingStepKey): string {
  return step === "readiness" ? "Readiness and activate" : sectionDef(step).title;
}

function stepNumber(step: OnboardingStepKey): number {
  return step === "readiness" ? 12 : sectionDef(step).number;
}

function SaveChip({ save, view, onRetry }: { save: SaveState; view: OnboardingWorkspaceView; onRetry: () => void }) {
  if (save.kind === "saving") return <span role="status" className="rounded-[var(--e-radius-pill)] bg-[hsl(var(--e-band-good-bg))] px-2.5 py-1 text-[0.75rem] text-[hsl(var(--e-band-good-fg))]">Saving…</span>;
  if (save.kind === "failed") {
    return (
      <span role="alert" className="inline-flex flex-wrap items-center gap-2 rounded-[var(--e-radius-pill)] bg-[hsl(var(--e-band-problem-bg))] px-2.5 py-1 text-[0.75rem] text-[hsl(var(--e-band-problem-fg))]">
        Not saved. {save.message} <button type="button" className="font-[600] underline" onClick={onRetry}>Retry now</button>
      </span>
    );
  }
  const at = save.kind === "saved" ? save.at : view.lastSavedAt;
  return <span role="status" className="rounded-[var(--e-radius-pill)] bg-[hsl(var(--e-band-good-bg))] px-2.5 py-1 text-[0.75rem] text-[hsl(var(--e-band-good-fg))]">{at ? `✓ Saved ${formatClock(at, view.timezone)}` : "Nothing saved yet"}</span>;
}

function ConflictNotice({ conflict, view, onDismiss }: { conflict: SaveConflictView; view: OnboardingWorkspaceView; onDismiss: () => void }) {
  const [comparing, setComparing] = React.useState(false);
  const title = isOnboardingStepKey(conflict.section) && conflict.section !== "readiness" ? sectionDef(conflict.section).title : conflict.section;
  return (
    <EToneNotice tone="attention" role="status" title={`${conflict.actorName}${conflict.source === "CLIENT_SUBMITTED" ? "" : ""} changed ${title} at ${formatClock(conflict.at, view.timezone)}. Your edit is kept.`}>
      <div className="flex flex-wrap gap-3">
        <button type="button" className="font-[600] underline" aria-expanded={comparing} onClick={() => setComparing((open) => !open)}>Compare</button>
        <button type="button" className="underline" onClick={onDismiss}>Dismiss</button>
      </div>
      {comparing ? (
        <ul className="mt-2 space-y-1">
          {Object.entries(conflict.changes).map(([field, change]) => (
            <li key={field} className="break-words"><span className="font-[550]">{field.split(".").slice(1).join(".")}</span>: {JSON.stringify(change.before)} → {JSON.stringify(change.after)}</li>
          ))}
        </ul>
      ) : null}
    </EToneNotice>
  );
}

function Checklist({ view, active, onOpen, className }: { view: OnboardingWorkspaceView; active: OnboardingStepKey | null; onOpen: (step: OnboardingStepKey) => void; className?: string }) {
  return (
    <nav aria-label="Checklist" className={className}>
      <p className="mb-2 px-2 text-[0.6875rem] font-[650] uppercase tracking-[0.08em] text-[hsl(var(--e-text-secondary))] max-sm:hidden">Checklist</p>
      <ul className="space-y-0.5 max-sm:divide-y max-sm:divide-[hsl(var(--e-border))] max-sm:rounded-[var(--e-radius-lg)] max-sm:border max-sm:border-[hsl(var(--e-border))] max-sm:bg-[hsl(var(--e-surface))] max-sm:px-3">
        {ONBOARDING_SECTIONS.map((section) => {
          const mark = sectionMark(view.readiness, section.key, view.askedOfClient.includes(section.key));
          const detail = mark === "required" ? "required" : mark === "client" ? "client" : mark === "recommended" ? (view.skipped.includes(section.key) ? "skipped" : "recommended") : "";
          return (
            <li key={section.key}>
              <button
                type="button"
                aria-current={active === section.key ? "step" : undefined}
                onClick={() => onOpen(section.key)}
                className={cn(
                  "flex min-h-10 w-full items-center gap-2.5 rounded-[var(--e-radius)] px-2 text-left text-[0.8125rem] max-sm:min-h-12 max-sm:px-0 max-sm:text-[0.9375rem]",
                  active === section.key ? "bg-[hsl(var(--e-primary-soft))] font-[600]" : "hover:bg-[hsl(var(--e-muted))]",
                )}
              >
                <ChecklistMark mark={mark} />
                <span className={cn("min-w-0 flex-1 break-words", mark === "required" && "font-[600]")}>{section.title}</span>
                {detail ? <span className={cn("text-[0.6875rem]", mark === "required" ? "text-[hsl(var(--e-danger))]" : "text-[hsl(var(--e-muted-foreground))]")}>{detail}</span> : null}
              </button>
            </li>
          );
        })}
        <li className="sm:mt-2 sm:border-t sm:border-[hsl(var(--e-border))] sm:pt-2">
          <button type="button" aria-current={active === "readiness" ? "step" : undefined} onClick={() => onOpen("readiness")} className={cn("flex min-h-10 w-full items-center gap-2.5 rounded-[var(--e-radius)] px-2 text-left text-[0.8125rem] max-sm:min-h-12 max-sm:px-0", active === "readiness" ? "bg-[hsl(var(--e-primary-soft))] font-[600]" : "hover:bg-[hsl(var(--e-muted))]")}>
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-[hsl(var(--e-border-strong))]"><Star className="h-3 w-3" aria-hidden /></span>
            <span>Readiness and activate</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}

function SetsUpPanel({ step }: { step: OnboardingStepKey }) {
  if (step === "readiness") return null;
  const def = sectionDef(step);
  return (
    <aside aria-label="This step sets up" className="space-y-3">
      <div className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-band-info-bg))] p-3">
        <p className="text-[0.8125rem] font-[600] text-[hsl(var(--e-band-info-fg))]">This step sets up</p>
        <p className="text-[0.75rem] text-[hsl(var(--e-band-info-muted))]">on activation</p>
        <ul className="mt-2 space-y-2 text-[0.8125rem]">
          {def.setsUp.map((line) => <li key={line} className="flex gap-2"><span aria-hidden>→</span><span>{line}</span></li>)}
        </ul>
      </div>
      {def.note ? <p className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{def.note}</p> : null}
    </aside>
  );
}

function History({ view }: { view: OnboardingWorkspaceView }) {
  const [open, setOpen] = React.useState(false);
  return (
    <section aria-labelledby="answer-history" className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))]">
      <h2 id="answer-history" className="text-[0.8125rem]">
        <button type="button" aria-expanded={open} aria-controls="answer-history-list" className="flex min-h-11 w-full items-center justify-between px-3 text-left font-[600]" onClick={() => setOpen((value) => !value)}>
          History of answers <span className={ONB_MUTED}>{view.history.length ? `${view.history.length} recent` : "none yet"}</span>
        </button>
      </h2>
      <ol id="answer-history-list" hidden={!open} className="max-h-80 space-y-2 overflow-y-auto border-t border-[hsl(var(--e-border))] p-3 text-[0.75rem]">
        {view.history.length === 0 ? <li className={ONB_MUTED}>No saved changes yet.</li> : null}
        {view.history.map((entry) => (
          <li key={entry.revision}>
            <span className="font-[600]">{entry.actorName}</span>{entry.source === "CLIENT_SUBMITTED" ? " (from client)" : ""} · {formatSavedAt(entry.createdAt, view.timezone)}
            <span className="block break-words text-[hsl(var(--e-muted-foreground))]">{entry.fields.map((field) => field.split(".").slice(1).join(".")).join(", ")}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function StepBody({ step, api, view, busy, setBusy }: { step: OnboardingStepKey; api: OnboardingWorkspaceApi; view: OnboardingWorkspaceView; busy: boolean; setBusy: (busy: boolean) => void }) {
  const send = (section: OnboardingSectionKey) => (patch: Record<string, unknown>) => api.queueSave(section, patch);
  const key = `${view.id}:${step}`;
  switch (step) {
    case "basics":
      return <BasicsStep key={key} view={view} values={view.values.basics} send={send("basics")} />;
    case "client":
      return <ClientStep key={key} view={view} values={view.values.client} send={send("client")} />;
    case "rooms":
      return <RoomsStep key={key} view={view} values={view.values.rooms} send={send("rooms")} />;
    case "access":
      return <AccessStep key={key} view={view} values={view.values.access} send={send("access")} surveyId={view.id} onReviewed={() => void api.reload()} />;
    case "laundry":
      return <LaundryStep key={key} view={view} values={view.values.laundry} send={send("laundry")} />;
    case "stock":
      return <StockStep key={key} view={view} values={view.values.stock} send={send("stock")} />;
    case "scope":
      return <ScopeStep key={key} view={view} values={view.values.scope} send={send("scope")} surveyId={view.id} />;
    case "photos":
      return <PhotosStep key={key} view={view} values={view.values.photos} send={send("photos")} />;
    case "pricing":
      return <PricingStep key={key} view={view} values={view.values.pricing} send={send("pricing")} />;
    case "calendar":
      return <CalendarStep key={key} view={view} values={view.values.calendar} send={send("calendar")} />;
    case "rules":
      return <RulesStep key={key} view={view} values={view.values.rules} send={send("rules")} />;
    case "readiness":
      return <ReadinessStep key={view.id} view={view} hasUnsaved={api.hasUnsaved} onActivated={api.reload} onRejected={api.reload} onBusyChange={setBusy} />;
  }
  void busy;
  return null;
}

function readHashStep(): OnboardingStepKey | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.replace(/^#/, "");
  return isOnboardingStepKey(hash) ? hash : null;
}

export function OnboardingWorkspace({ surveyId }: { surveyId: string }) {
  const api = useOnboardingWorkspace(surveyId);
  const { view, load } = api;
  const isPhone = useIsPhone();
  const [step, setStep] = React.useState<OnboardingStepKey>("basics");
  const [phoneStepOpen, setPhoneStepOpen] = React.useState(false);
  const [linkOpen, setLinkOpen] = React.useState(false);
  const [activating, setActivating] = React.useState(false);
  const stepHeadingRef = React.useRef<HTMLHeadingElement>(null);

  React.useEffect(() => {
    const fromHash = readHashStep();
    if (fromHash) {
      setStep(fromHash);
      setPhoneStepOpen(true);
    }
    if (new URLSearchParams(window.location.search).get("send") === "1") setLinkOpen(true);
    // A deep link followed on the same page (#access) only changes the hash.
    const onHash = () => {
      const target = readHashStep();
      if (target) {
        setStep(target);
        setPhoneStepOpen(true);
      }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [surveyId]);

  const open = (next: OnboardingStepKey) => {
    setStep(next);
    setPhoneStepOpen(true);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#${next}`);
    window.setTimeout(() => stepHeadingRef.current?.focus(), 0);
  };

  if (load.kind === "loading" || (!view && load.kind !== "failed")) return <EstateLoader label="Loading the onboarding…" />;
  if (load.kind === "failed" || !view) {
    return (
      <div className="space-y-4">
        <EPageHeader eyebrow={<Link href="/v2/admin/onboarding" className="inline-flex items-center gap-1"><ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Property onboarding</Link>} title="Property onboarding" />
        <EToneNotice tone="problem" role="alert" title="The onboarding could not be loaded">
          {load.kind === "failed" ? load.message : "Unknown error."}{" "}
          <button type="button" className="font-[600] underline" onClick={() => void api.reload()}>Try again</button>
        </EToneNotice>
      </div>
    );
  }

  const readiness = view.readiness;
  const index = STEP_ORDER.indexOf(step);
  const previous = index > 0 ? STEP_ORDER[index - 1] : null;
  const next = index < STEP_ORDER.length - 1 ? STEP_ORDER[index + 1] : null;
  const editable = view.status === "DRAFT" || view.status === "PENDING_REVIEW";
  const name = view.values.basics.propertyName || "Unnamed property";
  const meta = [view.surveyNumber, view.clientName, view.startedByName ? `started by ${view.startedByName} on ${formatSavedAt(view.createdAt, view.timezone).replace(/ \d{2}:\d{2}$/, "")}` : null, view.sourceType === "ADMIN_CREATED" ? "office-created" : view.sourceType === "WEB_FORM" ? "web form" : "client"].filter(Boolean).join(" · ");
  const requiredLeft = readiness.requiredTotal - readiness.requiredDone;
  const canSkip = step !== "readiness" && !readiness.items.some((item) => item.section === step && item.required);
  const skipped = step !== "readiness" && view.skipped.includes(step);

  const stepCard = (
    <section aria-labelledby={isPhone ? "phone-step-title" : "step-title"} className="min-w-0 space-y-4">
      {!isPhone ? (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 id="step-title" ref={stepHeadingRef} tabIndex={-1} className="text-[1.125rem] font-semibold outline-none">{stepNumber(step)} · {stepTitle(step)}</h2>
          {step !== "readiness" ? <span className={ONB_MUTED}>{sectionDef(step).filledBy}</span> : null}
        </div>
      ) : null}
      {api.conflict ? <ConflictNotice conflict={api.conflict} view={view} onDismiss={api.dismissConflict} /> : null}
      {!editable && step !== "readiness" ? <EToneNotice tone="info">{view.status === "APPROVED" ? "This onboarding is activated. Change the property itself from now on." : "This onboarding was rejected; its answers are kept read only."}</EToneNotice> : null}
      <fieldset disabled={!editable || activating} className="min-w-0">
        <legend className="sr-only">{stepTitle(step)}</legend>
        <StepBody step={step} api={api} view={view} busy={activating} setBusy={setActivating} />
      </fieldset>
      {canSkip && editable ? (
        <label className="flex min-h-11 items-center gap-2 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          <input type="checkbox" checked={skipped} onChange={(event) => api.queueSave(step as OnboardingSectionKey, {}, { skipped: event.target.checked })} />
          Skip this recommended step (it never blocks activation)
        </label>
      ) : null}
      {!isPhone ? (
        <div className="flex justify-between gap-2">
          {previous ? <EButton variant="outline" onClick={() => open(previous)}>Previous</EButton> : <span />}
          {next ? <EButton onClick={() => open(next)}>Next: {next === "readiness" ? "Readiness" : sectionDef(next).short}</EButton> : null}
        </div>
      ) : null}
    </section>
  );

  if (isPhone) {
    return (
      <div className="space-y-3 pb-24">
        <div className="flex items-center gap-2">
          <EButton variant="outline" size="icon" aria-label={phoneStepOpen ? "Back to the checklist" : "Back to property onboarding"} onClick={() => (phoneStepOpen ? setPhoneStepOpen(false) : window.location.assign("/v2/admin/onboarding"))}>
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </EButton>
          <div className="min-w-0 flex-1">
            {phoneStepOpen ? <p id="phone-step-title" className="text-[0.9375rem] font-[600]">{stepNumber(step)} · {stepTitle(step)}</p> : null}
            <h1 className={cn("break-words", phoneStepOpen ? "text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]" : "text-[1.0625rem] font-[600]")}>{name}</h1>
            {!phoneStepOpen ? <p className={ONB_MUTED}>{view.surveyNumber}{view.clientName ? ` · ${view.clientName}` : ""}</p> : null}
          </div>
          <SaveChip save={api.save} view={view} onRetry={api.retry} />
        </div>
        {!phoneStepOpen ? (
          <>
            <div className="flex items-center gap-3">
              <span className="e-display-md text-[2rem]">{readiness.percent}%</span>
              <div className="min-w-0 flex-1">
                <p className={ONB_MUTED}>Required {readiness.requiredDone} of {readiness.requiredTotal} · recommended {readiness.recommendedDone} of {readiness.recommendedTotal}</p>
                <ReadinessBar percent={readiness.percent} label="Readiness" />
              </div>
            </div>
            <Checklist view={view} active={null} onOpen={open} />
            {editable ? <EButton variant="outline" className="w-full" onClick={() => setLinkOpen(true)}>Send link to client…</EButton> : null}
            <History view={view} />
            <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+3.5rem)] z-30 border-t border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3">
              <EButton className="w-full" onClick={() => open(readiness.next ? readiness.next.section : "readiness")}>
                {readiness.next ? `Continue: ${sectionDef(readiness.next.section).title}` : "Review and activate"}
              </EButton>
            </div>
          </>
        ) : (
          <>
            {stepCard}
            <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+3.5rem)] z-30 grid grid-cols-2 gap-2 border-t border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3">
              <EButton variant="outline" disabled={!previous} onClick={() => previous && open(previous)}>Previous</EButton>
              <EButton disabled={!next} onClick={() => next && open(next)}>{next ? `Next: ${next === "readiness" ? "Readiness" : sectionDef(next).short}` : "Last step"}</EButton>
            </div>
          </>
        )}
        <ClientLinkDialog open={linkOpen} onClose={() => setLinkOpen(false)} view={view} onChanged={api.reload} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <EPageHeader
        eyebrow={<Link href="/v2/admin/onboarding" className="inline-flex items-center gap-1 normal-case"><ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Property onboarding</Link>}
        title={name}
        description={meta}
        actions={
          <>
            <SaveChip save={api.save} view={view} onRetry={api.retry} />
            <div className="w-40 space-y-1">
              <p className="text-[0.75rem] font-[600]">{readiness.percent}% ready{requiredLeft ? ` · ${requiredLeft} required left` : ""}</p>
              <ReadinessBar percent={readiness.percent} label="Readiness" />
            </div>
            {editable ? <EButton variant="outline" onClick={() => setLinkOpen(true)}>Send link to client…</EButton> : null}
            <EButton onClick={() => open("readiness")}>Review and activate</EButton>
          </>
        }
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_17rem]">
        <Checklist view={view} active={step} onOpen={open} className="lg:sticky lg:top-4 lg:self-start" />
        <div className="min-w-0 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-5">{stepCard}</div>
        <div className="space-y-3 lg:col-start-2 xl:col-start-auto">
          <SetsUpPanel step={step} />
          <History view={view} />
        </div>
      </div>
      <ClientLinkDialog open={linkOpen} onClose={() => setLinkOpen(false)} view={view} onChanged={api.reload} />
    </div>
  );
}
