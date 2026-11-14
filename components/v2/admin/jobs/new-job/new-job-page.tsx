"use client";

/**
 * The New job page (owner-approved boards "New job" and "New job on a
 * phone", 2026-11). One page with a live summary rail on desktop; five steps
 * (Property, Job, When, Who, Review) with a docked Next on a phone. Both post
 * the same request through `useCreateJob`; steps are layout only.
 *
 * - Reads: the read-only preview routes (`/api/admin/jobs/new-job/*`).
 * - Writes: the existing `POST /api/admin/jobs` (with a request key) and
 *   assign route; Repeats posts to the existing recurring-rule API.
 * - The unsaved job is kept in this browser (scoped to the signed-in person),
 *   offered back on return, cleared on save, and reset when the property
 *   changes (after asking).
 */
import { tourTarget } from "@/lib/tutorials/targets";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { EButton, ECard, EPageHeader } from "@/components/v2/ui/primitives";
import { EConfirmDialog } from "@/components/v2/ui/confirm-dialog";
import { EToneCard, ETonePill } from "@/components/v2/ui/tone-band";
import { useIsPhone } from "@/components/v2/ui/use-phone";
import { JobDialog } from "@/components/v2/admin/jobs/job-dialog";
import { JobTemplatesPanel, type JobTemplate, type TemplateSnapshot } from "@/components/v2/admin/jobs/job-templates-panel";
import { JobsImportDialog } from "@/components/v2/admin/jobs/jobs-import-dialog";
import {
  NEW_JOB_STEPS,
  NEW_JOB_STEP_LABELS,
  dayLabel,
  draftForAnother,
  draftFromDuplicate,
  draftHasContent,
  draftStorageKey,
  emptyDraft,
  isNewJobType,
  jobTypeLabel,
  parseStoredDraft,
  parseTags,
  propertyChangeLosesWork,
  resetForPropertyChange,
  targetDays,
  timingApiRule,
  validateDraft,
  type CreatedDayRecord,
  type DraftProblem,
  type NewJobDraft,
  type NewJobStep,
  type OneOffDraft,
  type TimingChoice,
} from "@/lib/jobs/new-job/draft";
import type { NewJobRights } from "@/lib/jobs/new-job/rights";
import type { NewJobDuplicateSource } from "@/lib/jobs/new-job/types";
import { useDayCheck, useNewJobOptions, usePropertyFacts, type DayCheckQuery } from "./use-new-job-data";
import { useCreateJob } from "./use-create-job";
import { SectionCard, Faint, NewMark } from "./new-job-ui";
import { PropertySection } from "./property-section";
import { WhatSection } from "./what-section";
import { WhenSection } from "./when-section";
import { WhoSection, whoAside } from "./who-section";
import { ClientEmailSection, ExtrasSection, LaundryAside, LaundryPreviewBody, emailAside } from "./extras-sections";
import { SeveralDates } from "./several-dates";
import { RepeatsPanel, repeatsBody, type RepeatsSave } from "./repeats-panel";
import { DuplicateDialog } from "./duplicate-dialog";
import { ProblemList, SavedPanel, StatusPill, SummaryList, cleanerSummary, summaryRows } from "./summary";

export type NewJobPageProps = {
  storageScope: string;
  timezone: string;
  todayKey: string;
  initialPropertyId: string | null;
  initialDuplicateId: string | null;
  initialMode: "one" | "several" | "repeats" | null;
  rights: NewJobRights;
};

type Pending =
  | { kind: "property"; propertyId: string }
  | { kind: "duplicate"; source: NewJobDuplicateSource }
  | { kind: "clash"; asDraftJob: boolean; days: string[] }
  | { kind: "discard" }
  | { kind: "leave" };

const FIELD_TARGET: Record<string, string> = {
  property: "new-job-property-search",
  date: "new-job-date",
  dueTime: "new-job-dueTime",
  hours: "new-job-hours",
  fixedPrice: "new-job-fixed",
  siteName: "new-job-siteName",
  siteAddress: "new-job-siteName",
  siteSuburb: "new-job-siteSuburb",
};

const SECTION_ID: Record<DraftProblem["section"], string> = {
  property: "new-job-property",
  what: "new-job-what",
  when: "new-job-when",
  who: "new-job-who",
  extras: "new-job-extras",
};

function clashDetail(job: { fromCalendar: boolean; cleaners: string[]; accepted: boolean }): string {
  const parts: string[] = [];
  if (job.fromCalendar) parts.push("calendar sync");
  if (job.cleaners.length) parts.push(`${job.cleaners.join(", ")} ${job.accepted ? "accepted" : "offered, not accepted"}`);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

function readStorage(key: string): NewJobDraft | null {
  try {
    return parseStoredDraft(window.localStorage.getItem(key));
  } catch {
    return null;
  }
}

function writeStorage(key: string, draft: NewJobDraft): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

function clearStorage(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Storage blocked: nothing to clear.
  }
}

export function NewJobPage(props: NewJobPageProps) {
  const { timezone, todayKey, rights } = props;
  const router = useRouter();
  const isPhone = useIsPhone();
  const storageKey = draftStorageKey(props.storageScope);
  const options = useNewJobOptions();
  const [draft, setDraftState] = useState<NewJobDraft>(() => {
    const fresh = emptyDraft(props.initialPropertyId ?? "");
    return props.initialMode ? { ...fresh, mode: props.initialMode } : fresh;
  });
  const [restoreOffer, setRestoreOffer] = useState<NewJobDraft | null>(null);
  const [storageChecked, setStorageChecked] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [allowSecond, setAllowSecond] = useState(false);
  const [includeClash, setIncludeClash] = useState<Set<string>>(new Set());
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [step, setStep] = useState<NewJobStep>("property");
  const [visited, setVisited] = useState<Set<NewJobStep>>(() => new Set<NewJobStep>(["property"]));
  const [repeatsSave, setRepeatsSave] = useState<RepeatsSave>({ status: "idle", message: null });
  const [repeatsRefresh, setRepeatsRefresh] = useState(0);
  const focusAfterStep = useRef<string | null>(null);

  const setDraft = useCallback((next: (current: NewJobDraft) => NewJobDraft) => setDraftState(next), []);
  const update = useCallback((patch: Partial<NewJobDraft>) => setDraftState((current) => ({ ...current, ...patch })), []);

  const draftRef = useRef(draft);
  draftRef.current = draft;
  // Written to storage at once (not inside a state updater, which React may run
  // later): a created day must be remembered before anything else happens.
  const recordDay = useCallback((record: CreatedDayRecord) => {
    const current = draftRef.current;
    const next = { ...current, created: [...current.created.filter((item) => item.dayKey !== record.dayKey), record] };
    draftRef.current = next;
    writeStorage(storageKey, next);
    setDraftState(next);
  }, [storageKey]);
  const { run, submit, reset: resetRun } = useCreateJob(recordDay);
  const saving = run.status === "saving" || repeatsSave.status === "saving";

  // The browser draft: offered back once, never applied silently.
  useEffect(() => {
    const stored = readStorage(storageKey);
    if (stored && draftHasContent(stored)) setRestoreOffer(stored);
    setStorageChecked(true);
    if (typeof window !== "undefined" && window.location.hash === "#bulk-create") update({ mode: "several" });
  }, [storageKey, update]);

  // Duplicate from a job (header button or a job's More menu).
  useEffect(() => {
    if (!props.initialDuplicateId) return;
    const controller = new AbortController();
    fetch(`/api/admin/jobs/new-job/duplicate?jobId=${encodeURIComponent(props.initialDuplicateId)}`, { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { sources?: NewJobDuplicateSource[] } | null) => {
        if (controller.signal.aborted) return;
        const source = body?.sources?.[0];
        if (source) setDraftState(draftFromDuplicate(source));
        else setAnnounce("The job to copy was not found.");
      })
      .catch(() => {});
    return () => controller.abort();
  }, [props.initialDuplicateId]);

  // Keep the unsaved job on this device while it is edited.
  useEffect(() => {
    if (!storageChecked || restoreOffer || run.status === "done") return;
    if (!draftHasContent(draft)) return;
    const timer = setTimeout(() => {
      const savedAt = new Date().toISOString();
      if (writeStorage(storageKey, { ...draft, savedAt })) setLastSavedAt(savedAt);
    }, 600);
    return () => clearTimeout(timer);
  }, [draft, storageChecked, restoreOffer, storageKey, run.status]);

  const usesProperty = draft.jobType === "AIRBNB_TURNOVER" || draft.siteMode === "property";
  const facts = usePropertyFacts(usesProperty ? draft.propertyId : "", draft.jobType);
  const factsData = facts.data && facts.data.property.id === draft.propertyId ? facts.data : null;

  const dayKeys = draft.mode === "one" ? (draft.dayKey ? [draft.dayKey] : []) : draft.mode === "several" ? draft.severalDays.map((day) => day.dayKey).sort() : [];
  const dayQuery: DayCheckQuery | null = useMemo(
    () =>
      usesProperty && draft.propertyId && dayKeys.length
        ? { propertyId: draft.propertyId, jobType: draft.jobType, dayKeys, startTime: draft.startTime, dueTime: draft.dueTime, endTime: draft.endTime, estimatedHours: draft.estimatedHours, suggest: true }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [usesProperty, draft.propertyId, draft.jobType, dayKeys.join(","), draft.startTime, draft.dueTime, draft.endTime, draft.estimatedHours],
  );
  const day = useDayCheck(dayQuery);
  const check = day.data;
  const firstDay = check?.days[0] ?? null;

  // Fill pay hours and times from the property until the office edits them.
  useEffect(() => {
    if (!factsData) return;
    setDraftState((current) => {
      if (current.propertyId !== factsData.property.id) return current;
      const next = { ...current };
      if (!current.hoursEdited) next.estimatedHours = factsData.hours != null ? String(factsData.hours) : "";
      if (!current.timesEdited && current.jobType === "AIRBNB_TURNOVER") {
        next.startTime = factsData.property.defaultCheckoutTime;
        next.dueTime = factsData.property.defaultCheckinTime;
      }
      return next;
    });
  }, [factsData]);

  const optionsList = options.data?.properties ?? [];
  const selectedOption = optionsList.find((property) => property.id === draft.propertyId) ?? null;
  const propertyName = factsData?.property.name ?? selectedOption?.name ?? null;

  // Phone: a step shows "!" only once Next was pressed on it (or Create was pressed).
  const [flaggedSteps, setFlaggedSteps] = useState<Set<NewJobStep>>(() => new Set<NewJobStep>());
  const asDraftProblems = useMemo(() => validateDraft(draft, { asDraftJob: false }), [draft]);

  const problems = useMemo(
    () => (attempted ? asDraftProblems : asDraftProblems.filter((problem) => flaggedSteps.has(problem.step))),
    [attempted, asDraftProblems, flaggedSteps],
  );
  const problemFields = useMemo(() => new Set(problems.map((problem) => problem.field)), [problems]);
  const problemSteps = useMemo(
    () => new Set(asDraftProblems.map((problem) => problem.step).filter((item) => flaggedSteps.has(item))),
    [asDraftProblems, flaggedSteps],
  );

  // ── Scope changes ────────────────────────────────────────────────────────
  function chooseProperty(propertyId: string) {
    if (propertyId === draft.propertyId) return;
    if (propertyChangeLosesWork(draft)) {
      setPending({ kind: "property", propertyId });
      return;
    }
    setIncludeClash(new Set());
    setDraftState((current) => resetForPropertyChange(current, propertyId));
  }

  function setSiteMode(mode: NewJobDraft["siteMode"]) {
    setDraftState((current) => {
      if (mode === current.siteMode) return current;
      if (mode === "one_off") {
        return { ...resetForPropertyChange(current, ""), siteMode: "one_off", jobType: current.jobType === "AIRBNB_TURNOVER" ? "GENERAL_CLEAN" : current.jobType };
      }
      return { ...current, siteMode: "property" };
    });
  }

  function setOneOff(patch: Partial<OneOffDraft>) {
    setDraftState((current) => ({ ...current, oneOff: { ...current.oneOff, ...patch } }));
  }

  function updateWhat(patch: Partial<NewJobDraft>) {
    setDraftState((current) => {
      const next = { ...current, ...patch };
      if (patch.jobType && patch.jobType !== "AIRBNB_TURNOVER") {
        next.earlyCheckin = { preset: "none", time: "" };
        next.lateCheckout = { preset: "none", time: "" };
      }
      if (patch.jobType === "AIRBNB_TURNOVER" && current.siteMode === "one_off") {
        next.siteMode = "property";
      }
      return next;
    });
  }

  // ── Create ───────────────────────────────────────────────────────────────
  function focusProblem(problem: DraftProblem) {
    const target = FIELD_TARGET[problem.field] ?? null;
    if (isPhone) {
      focusAfterStep.current = target;
      goToStep(problem.step);
      return;
    }
    const element = target ? document.getElementById(target) : null;
    const section = document.getElementById(SECTION_ID[problem.section]);
    (section ?? element)?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (element instanceof HTMLElement) element.focus({ preventScroll: true });
  }

  useEffect(() => {
    if (!focusAfterStep.current) return;
    const element = document.getElementById(focusAfterStep.current);
    focusAfterStep.current = null;
    if (element instanceof HTMLElement) element.focus();
  }, [step]);

  const clashDays = useMemo(() => (check?.days ?? []).filter((item) => item.sameDayJobs.length > 0).map((item) => item.dayKey), [check]);

  async function startCreate(asDraftJob: boolean) {
    if (!rights.canCreate || saving) return;
    setAttempted(true);
    setFlaggedSteps(new Set<NewJobStep>(NEW_JOB_STEPS));
    const found = validateDraft(draft, { asDraftJob });
    if (found.length) {
      setAnnounce(`${found.length} to fix: ${found.map((problem) => problem.message).join("; ")}`);
      focusProblem(found[0]);
      return;
    }
    if (draft.mode === "repeats") {
      await saveRepeats();
      return;
    }
    const days = targetDays(draft).map((target) => target.dayKey);
    const clashing = days.filter((dayKey) => clashDays.includes(dayKey) && (draft.mode === "one" || includeClash.has(dayKey)));
    const alreadyCreated = new Set(draft.created.map((record) => record.dayKey));
    if (clashing.filter((dayKey) => !alreadyCreated.has(dayKey)).length) {
      setPending({ kind: "clash", asDraftJob, days: clashing });
      return;
    }
    await runCreate(asDraftJob);
  }

  async function runCreate(asDraftJob: boolean) {
    const skipDays = draft.mode === "several" ? new Set(clashDays.filter((dayKey) => !includeClash.has(dayKey))) : undefined;
    const result = await submit(draft, { asDraftJob, skipDays });
    if (result.status === "done") {
      clearStorage(storageKey);
      setLastSavedAt(null);
    }
    requestAnimationFrame(() => document.getElementById("new-job-result")?.focus());
  }

  async function saveRepeats() {
    if (!rights.canRepeat) return;
    setRepeatsSave({ status: "saving", message: null });
    try {
      const response = await fetch("/api/admin/recurring-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(repeatsBody(draft, propertyName)),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setRepeatsSave({ status: "failed", message: response.status === 403 ? "Your access does not include recurring rules (Calendar)." : body.error ?? "The rule was not saved." });
        return;
      }
      setRepeatsSave({ status: "saved", message: "Rule saved. Jobs appear when the nightly generation runs; nothing was created now." });
      setRepeatsRefresh((value) => value + 1);
      clearStorage(storageKey);
    } catch {
      setRepeatsSave({ status: "failed", message: "The connection dropped. Save again: the same rule is updated, not duplicated." });
    }
  }

  function discard() {
    setFlaggedSteps(new Set<NewJobStep>());
    clearStorage(storageKey);
    setLastSavedAt(null);
    setAttempted(false);
    setIncludeClash(new Set());
    resetRun();
    setDraftState(emptyDraft(""));
    setStep("property");
  }

  function another() {
    setFlaggedSteps(new Set<NewJobStep>());
    resetRun();
    setAttempted(false);
    setIncludeClash(new Set());
    setDraftState((current) => draftForAnother(current));
    setStep("when");
  }

  function copyFrom(source: NewJobDuplicateSource) {
    setDuplicateOpen(false);
    if (draftHasContent(draft)) {
      setPending({ kind: "duplicate", source });
      return;
    }
    setDraftState(draftFromDuplicate(source));
  }

  function applyTemplate(template: JobTemplate) {
    const toChoice = (rule?: JobTemplate["earlyCheckin"]): TimingChoice => {
      const preset: TimingChoice["preset"] = rule?.enabled && rule.preset && rule.preset !== "none" ? rule.preset : "none";
      return { preset, time: preset === "custom" ? rule?.time ?? "" : preset === "none" ? "" : preset };
    };
    setDraftState((current) => ({
      ...current,
      jobType: isNewJobType(template.jobType) ? template.jobType : current.jobType,
      startTime: template.startTime ?? current.startTime,
      dueTime: template.dueTime ?? current.dueTime,
      endTime: template.endTime ?? "",
      timesEdited: true,
      estimatedHours: template.estimatedHours != null ? String(template.estimatedHours) : current.estimatedHours,
      hoursEdited: template.estimatedHours != null ? true : current.hoursEdited,
      notes: template.notes ?? "",
      internalNote: template.internalNotes ?? "",
      tagsText: Array.isArray(template.tags) ? template.tags.join(", ") : "",
      attachments: Array.isArray(template.attachments) ? template.attachments : [],
      earlyCheckin: toChoice(template.earlyCheckin),
      lateCheckout: toChoice(template.lateCheckout),
    }));
    setTemplatesOpen(false);
  }

  function templateSnapshot(): TemplateSnapshot {
    const isAirbnb = draft.jobType === "AIRBNB_TURNOVER";
    return {
      jobType: draft.jobType,
      startTime: draft.startTime,
      dueTime: draft.dueTime,
      endTime: draft.endTime,
      estimatedHours: draft.estimatedHours,
      notes: draft.notes,
      internalNotes: draft.internalNote,
      isDraft: false,
      tags: parseTags(draft.tagsText),
      attachments: draft.attachments,
      earlyCheckin: isAirbnb ? timingApiRule(draft.earlyCheckin) : { enabled: false, preset: "none" },
      lateCheckout: isAirbnb ? timingApiRule(draft.lateCheckout) : { enabled: false, preset: "none" },
    };
  }

  // ── Phone steps ──────────────────────────────────────────────────────────
  function goToStep(next: NewJobStep) {
    setStep(next);
    setVisited((current) => new Set(current).add(next));
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }

  function stepProblems(target: NewJobStep): DraftProblem[] {
    return validateDraft(draft, { asDraftJob: false }).filter((problem) => problem.step === target);
  }

  function next() {
    const index = NEW_JOB_STEPS.indexOf(step);
    const found = stepProblems(step);
    if (found.length) {
      setFlaggedSteps((current) => new Set(current).add(step));
      setAnnounce(`${found.length} to fix on this step: ${found.map((problem) => problem.message).join("; ")}`);
      const target = FIELD_TARGET[found[0].field];
      const element = target ? document.getElementById(target) : null;
      element?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (element instanceof HTMLElement) element.focus({ preventScroll: true });
      return;
    }
    if (index < NEW_JOB_STEPS.length - 1) goToStep(NEW_JOB_STEPS[index + 1]);
  }

  // ── Shared pieces ────────────────────────────────────────────────────────
  const savedLabel = lastSavedAt ? `Saved ${formatInTimeZone(new Date(lastSavedAt), timezone, "HH:mm")}` : null;
  const rows = summaryRows(draft, factsData, check, propertyName);
  const cleanerText = cleanerSummary(draft, factsData).value;
  const preferredName = factsData?.preferredCleaner?.name ?? null;
  const createCount = draft.mode === "several" ? draft.severalDays.filter((item) => !clashDays.includes(item.dayKey) || includeClash.has(item.dayKey)).length : 1;
  const createLabel = draft.mode === "repeats" ? "Save repeating rule" : draft.mode === "several" ? `Create ${createCount} job${createCount === 1 ? "" : "s"}` : "Create job";
  const showResult = run.status === "done" || run.status === "partial" || run.status === "failed";

  const restoreCard = restoreOffer ? (
    <EToneCard tone="info" header={<p className="text-[0.875rem] font-[600]">Coming back to an unsaved job <Faint className="font-normal">· This device only</Faint></p>} pill="Draft kept">
      <div className="space-y-2 text-[0.8125rem]">
        <p>
          You started a job{restoreOffer.savedAt ? ` at ${formatInTimeZone(new Date(restoreOffer.savedAt), timezone, "HH:mm")}` : ""}:{" "}
          {[
            optionsList.find((property) => property.id === restoreOffer.propertyId)?.name ?? (restoreOffer.siteMode === "one_off" ? restoreOffer.oneOff.siteName || "a one-off address" : null),
            jobTypeLabel(restoreOffer.jobType),
            restoreOffer.dayKey ? dayLabel(restoreOffer.dayKey) : null,
            restoreOffer.cleaner.kind === "chosen" ? restoreOffer.cleaner.names.join(", ") : null,
          ].filter(Boolean).join(", ")}.
          {restoreOffer.created.length ? ` ${restoreOffer.created.length} of its jobs were already created.` : ""}
        </p>
        <div className="flex flex-wrap gap-2">
          <EButton type="button" size="sm" onClick={() => { setDraftState(restoreOffer); setRestoreOffer(null); }}>Continue</EButton>
          <EButton type="button" size="sm" variant="outline" onClick={() => { clearStorage(storageKey); setRestoreOffer(null); }}>Start again</EButton>
        </div>
        <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">Choosing another property clears the date, cleaner, tasks and warnings but keeps notes, after asking. A draft kept here is not a saved job. <NewMark /></p>
      </div>
    </EToneCard>
  ) : null;

  const resultCard = showResult ? (
    <SavedPanel run={run} draft={draft} propertyName={propertyName ?? draft.oneOff.siteName ?? null} preferredName={preferredName} onAnother={another} onRetry={() => runCreate(false)} canRetry={rights.canCreate} />
  ) : null;

  const rightsNotice = !rights.canCreate ? (
    <p role="note" className="rounded-[var(--e-radius)] bg-[hsl(var(--e-band-attention-bg))] p-3 text-[0.8125rem] text-[hsl(var(--e-band-attention-fg))]">{rights.reason}</p>
  ) : null;

  const propertySection = (compact: boolean) => (
    <PropertySection draft={draft} options={options} facts={facts} onChooseProperty={chooseProperty} onSiteMode={setSiteMode} onOneOff={setOneOff} problemFields={problemFields} compact={compact} />
  );
  const whatSection = (compact: boolean) => (
    <WhatSection draft={draft} facts={facts} firstDay={firstDay} update={updateWhat} problemFields={problemFields} compact={compact} />
  );
  const severalSlot = (compact: boolean) => (
    <SeveralDates
      draft={draft}
      update={update}
      days={check?.days ?? []}
      dayStatus={day.status}
      todayKey={todayKey}
      includeClashDays={includeClash}
      setIncludeClash={(dayKey, include) => setIncludeClash((current) => { const nextSet = new Set(current); if (include) nextSet.add(dayKey); else nextSet.delete(dayKey); return nextSet; })}
      compact={compact}
    />
  );
  const repeatsSlot = (
    <RepeatsPanel draft={draft} update={update} propertyName={propertyName} recurring={options.data?.recurring ?? null} cleanerText={cleanerText} todayKey={todayKey} save={repeatsSave} onSave={() => startCreate(false)} refreshKey={repeatsRefresh} canRepeat={rights.canRepeat} />
  );
  const whenSection = (compact: boolean) => (
    <WhenSection draft={draft} setDraft={setDraft} update={update} facts={facts} day={day} timezone={timezone} todayKey={todayKey} problemFields={problemFields} compact={compact} severalSlot={severalSlot(compact)} repeatsSlot={repeatsSlot} />
  );
  const whoSection = (compact: boolean) => (
    <WhoSection draft={draft} facts={facts} day={day} update={update} allowSecond={allowSecond} setAllowSecond={setAllowSecond} compact={compact} />
  );
  const emailSection = (compact: boolean) => (
    <ClientEmailSection email={check?.bookingEmail ?? null} draft={draft} update={update} loading={day.status === "loading"} compact={compact} />
  );

  const createButtons = (stacked: boolean) => (
    <div className={cn("grid gap-2", stacked ? "grid-cols-1" : "grid-cols-[1fr_auto]")}>
      <EButton {...tourTarget("admin.jobs.create.submit")} type="button" className={stacked ? undefined : "col-span-2"} onClick={() => startCreate(false)} disabled={!rights.canCreate || saving} aria-busy={saving || undefined}>
        {saving ? "Saving…" : createLabel}
      </EButton>
      {draft.mode !== "repeats" ? (
        <EButton type="button" variant="outline" onClick={() => startCreate(true)} disabled={!rights.canCreate || saving}>Save as draft job</EButton>
      ) : null}
      <EButton type="button" variant="ghost" onClick={() => setPending({ kind: "discard" })} disabled={saving}>Discard…</EButton>
    </div>
  );

  const liveRegion = <p className="sr-only" role="status" aria-live="polite">{announce}</p>;

  const confirmations = (
    <>
      <EConfirmDialog
        open={pending?.kind === "property"}
        onClose={() => setPending(null)}
        tier="ordinary"
        title={`Choose ${pending?.kind === "property" ? optionsList.find((property) => property.id === pending.propertyId)?.name ?? "this property" : "this property"}?`}
        description="The date, cleaner, tasks and warnings are cleared. The notice, notes, tags and files are kept."
        confirmLabel="Choose property"
        onConfirm={() => {
          if (pending?.kind === "property") {
            setIncludeClash(new Set());
            setDraftState((current) => resetForPropertyChange(current, pending.propertyId));
          }
          setPending(null);
        }}
      />
      <EConfirmDialog
        open={pending?.kind === "duplicate"}
        onClose={() => setPending(null)}
        tier="ordinary"
        title={`Replace this job with a copy of ${pending?.kind === "duplicate" ? pending.source.jobNumber : "that job"}?`}
        description="What you entered here is replaced by the copied values. The date and cleaners stay empty."
        confirmLabel="Copy the job"
        onConfirm={() => {
          if (pending?.kind === "duplicate") setDraftState(draftFromDuplicate(pending.source));
          setPending(null);
        }}
      />
      <EConfirmDialog
        open={pending?.kind === "clash"}
        onClose={() => setPending(null)}
        tier="ordinary"
        title={pending?.kind === "clash" && pending.days.length === 1 ? `Create a second job at ${propertyName ?? "this property"} on ${dayLabel(pending.days[0])}?` : `Create jobs on ${pending?.kind === "clash" ? pending.days.length : 0} days that already have one?`}
        description={
          <span className="space-y-2">
            {(check?.days ?? []).filter((item) => pending?.kind === "clash" && pending.days.includes(item.dayKey)).flatMap((item) => item.sameDayJobs.map((job) => (
              <span key={job.jobId} className="block">
                {job.jobNumber} {jobTypeLabel(job.jobType)} is already at {propertyName ?? "the property"} that day{clashDetail(job)}.{" "}
                <Link className="underline" href={`/v2/admin/jobs/${encodeURIComponent(job.jobId)}`}>Open {job.jobNumber} instead</Link>
              </span>
            )))}
            <span className="block">The calendar sync would skip a turnover on this day for the same reason.</span>
          </span>
        }
        confirmLabel="Create anyway"
        onConfirm={async () => {
          const asDraftJob = pending?.kind === "clash" ? pending.asDraftJob : false;
          setPending(null);
          await runCreate(asDraftJob);
        }}
      />
      <EConfirmDialog
        open={pending?.kind === "discard"}
        onClose={() => setPending(null)}
        tier="destructive"
        title="Discard this unsaved job?"
        description="It is removed from this device. This cannot be undone."
        confirmLabel="Discard"
        onConfirm={() => { discard(); setPending(null); }}
      />
      <EConfirmDialog
        open={pending?.kind === "leave"}
        onClose={() => setPending(null)}
        tier="ordinary"
        title="Leave New job?"
        description="This unsaved job stays on this phone and is offered back next time."
        confirmLabel="Keep it and leave"
        onConfirm={() => { setPending(null); router.push("/v2/admin/jobs"); }}
      >
        <EButton type="button" variant="ghost" className="w-full" onClick={() => setPending({ kind: "discard" })}>Discard it instead</EButton>
      </EConfirmDialog>
      <DuplicateDialog open={duplicateOpen} onClose={() => setDuplicateOpen(false)} onCopy={copyFrom} />
      <JobDialog open={templatesOpen} title="Saved job templates" onClose={() => setTemplatesOpen(false)}>
        <p className="mb-3 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">A template only fills type, times, hours, notes, tags and files; property, dates and cleaners stay as chosen.</p>
        <JobTemplatesPanel snapshot={templateSnapshot} onApply={applyTemplate} />
      </JobDialog>
      <JobsImportDialog open={importOpen} onClose={() => setImportOpen(false)} onImported={() => {}} />
    </>
  );

  if (isPhone) {
    return (
      <PhoneLayout
        step={step}
        visited={visited}
        problemSteps={problemSteps}
        onStep={goToStep}
        onBack={() => {
          const index = NEW_JOB_STEPS.indexOf(step);
          if (index > 0) goToStep(NEW_JOB_STEPS[index - 1]);
        }}
        onClose={() => (draftHasContent(draft) ? setPending({ kind: "leave" }) : router.push("/v2/admin/jobs"))}
        onNext={next}
        title={step === "property" ? "New job" : step === "review" ? "Review" : step === "who" && draft.dayKey ? `${dayLabel(draft.dayKey)}${draft.startTime ? ` · ${draft.startTime}` : ""}` : propertyName ?? "New job"}
        savedLabel={savedLabel}
        onDuplicate={() => setDuplicateOpen(true)}
        saving={saving}
        footer={run.status === "done" ? <span /> : step === "review" ? createButtons(false) : null}
      >
        {liveRegion}
        {restoreCard}
        {resultCard}
        {rightsNotice}
        <fieldset disabled={saving} hidden={run.status === "done"} className="m-0 min-w-0 space-y-4 border-0 p-0">
          {step === "property" ? propertySection(true) : null}
          {step === "job" ? (
            <>
              {whatSection(true)}
              <ExtrasSection draft={draft} facts={factsData} update={update} compact />
            </>
          ) : null}
          {step === "when" ? (
            <>
              {whenSection(true)}
              {draft.mode === "one" && draft.jobType === "AIRBNB_TURNOVER" ? (
                <ECard className="p-3">
                  <p className="text-[0.875rem] font-[600]">Laundry preview</p>
                  <p className="mb-1 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{firstDay?.laundry.kind === "preview" ? `Rules live version ${firstDay.laundry.rulesVersion} · nothing planned now` : "Nothing is planned now"}</p>
                  <LaundryPreviewBody preview={firstDay?.laundry ?? null} compact />
                </ECard>
              ) : null}
            </>
          ) : null}
          {step === "who" ? whoSection(true) : null}
          {step === "review" ? (
            <>
              <ECard className="px-3">
                <SummaryList rows={rows.filter((row) => row.label !== "Pay hours" && row.label !== "Client")} />
              </ECard>
              {attempted ? <ProblemList problems={problems} onGo={focusProblem} /> : null}
              <ECard className="p-3">
                <p className="text-[0.875rem] font-[600]">Tell the client</p>
                {emailSection(true)}
              </ECard>
            </>
          ) : null}
        </fieldset>
        {confirmations}
      </PhoneLayout>
    );
  }

  return (
    <div className="min-w-0 space-y-6 max-sm:hidden">
      {liveRegion}
      <EPageHeader
        eyebrow={
          <Link href="/v2/admin/jobs" className="inline-flex items-center gap-1 normal-case tracking-normal text-[hsl(var(--e-primary))] underline-offset-2 hover:underline">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Jobs
          </Link>
        }
        title="New job"
        description={
          <>
            Property first, then what and when. Everything the property already knows is filled in and marked <span className="rounded-full bg-[hsl(var(--e-gold-soft))] px-1.5 py-0.5 text-[0.75rem] text-[hsl(var(--e-gold-ink))]">from property</span>. The summary on the right is what will be created; nothing is created until you press Create job.
          </>
        }
        actions={
          <>
            <EButton type="button" variant="outline" size="sm" onClick={() => setDuplicateOpen(true)}>Duplicate a job…</EButton>
            <EButton type="button" variant="ghost" size="sm" onClick={() => setImportOpen(true)} disabled={!rights.canCreate}>Import CSV</EButton>
          </>
        }
      />
      {restoreCard}
      {resultCard}
      {rightsNotice}
      {run.status === "done" ? null : <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <fieldset disabled={saving} className="m-0 min-w-0 space-y-5 border-0 p-0">
          <SectionCard id="new-job-property" index={1} done={Boolean(draft.propertyId || (draft.siteMode === "one_off" && draft.oneOff.siteName && draft.oneOff.siteAddress))} title="Property">
            {propertySection(false)}
          </SectionCard>
          <SectionCard id="new-job-what" index={2} done={Boolean(factsData)} title="What" aside="Change any value; it applies to this job only">
            {whatSection(false)}
          </SectionCard>
          <SectionCard id="new-job-when" index={3} done={targetDays(draft).length > 0 || (draft.mode === "repeats" && draft.repeats.daysOfWeek.length > 0)} title="When">
            {whenSection(false)}
          </SectionCard>
          <SectionCard id="new-job-who" index={4} done={Boolean(draft.dayKey && check)} title="Who" aside={whoAside(draft)}>
            {whoSection(false)}
          </SectionCard>
          {draft.jobType === "AIRBNB_TURNOVER" ? (
            <SectionCard id="new-job-laundry" index={5} done={false} title="Laundry, what the rules will do" aside={<LaundryAside preview={firstDay?.laundry ?? null} />}>
              <LaundryPreviewBody preview={draft.mode === "one" ? firstDay?.laundry ?? null : null} />
              {draft.mode !== "one" ? <Faint>For several dates the preview is per date in the table above; repeating jobs are planned when each job is made.</Faint> : null}
            </SectionCard>
          ) : null}
          <SectionCard id="new-job-extras" index={draft.jobType === "AIRBNB_TURNOVER" ? 6 : 5} done={false} title="Extras and instructions">
            <ExtrasSection draft={draft} facts={factsData} update={update} />
          </SectionCard>
          <SectionCard
            id="new-job-client"
            index={draft.jobType === "AIRBNB_TURNOVER" ? 7 : 6}
            done={false}
            title="Tell the client"
            aside={emailAside(check?.bookingEmail ?? null).tone ? <ETonePill tone={emailAside(check?.bookingEmail ?? null).tone!}>{emailAside(check?.bookingEmail ?? null).text}</ETonePill> : null}
          >
            {emailSection(false)}
          </SectionCard>
        </fieldset>
        <aside aria-label="Summary" className="min-w-0 space-y-4 lg:sticky lg:top-6 lg:self-start">
          <EToneCard tone="good" header={<div><p className="text-[0.9375rem] font-[600]">Summary</p><p className="text-[0.75rem] font-normal">This is what {createLabel} saves</p></div>} pill={<StatusPill count={asDraftProblems.length} />}>
            <SummaryList rows={rows} />
            {attempted && problems.length ? (
              <div className="mt-2 space-y-1">
                <p className="text-[0.75rem] font-[600]">Shown in the summary and at the field · {problems.length} to fix</p>
                <ProblemList problems={problems} onGo={focusProblem} />
              </div>
            ) : null}
            <div className="mt-3">{createButtons(false)}</div>
            <p className="mt-2 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
              A draft job is hidden from cleaners&apos; job lists and cannot be assigned until it is published; the preferred-cleaner offer and booking email still follow the choices above, as today. Unsaved work is kept on this device and offered back if you leave{savedLabel ? ` (${savedLabel.toLowerCase()})` : ""}. <NewMark />
            </p>
          </EToneCard>
          <ECard className="p-4">
            <p className="mb-2 text-[0.9375rem] font-[600]">Shortcuts</p>
            <dl className="divide-y divide-[hsl(var(--e-border))] text-[0.8125rem]">
              <div className="flex items-center justify-between gap-2 py-2">
                <dt>Same property, more dates</dt>
                <dd><button type="button" className="text-[hsl(var(--e-primary))] underline" onClick={() => { update({ mode: "several" }); document.getElementById("new-job-when")?.scrollIntoView({ behavior: "smooth" }); }}>Several dates</button></dd>
              </div>
              <div className="flex items-center justify-between gap-2 py-2">
                <dt>Copy an earlier job</dt>
                <dd><button type="button" className="text-[hsl(var(--e-primary))] underline" onClick={() => setDuplicateOpen(true)}>Duplicate…</button></dd>
              </div>
              <div className="flex items-center justify-between gap-2 py-2">
                <dt>Saved job templates</dt>
                <dd><button type="button" className="text-[hsl(var(--e-primary))] underline" onClick={() => setTemplatesOpen(true)}>Apply…</button></dd>
              </div>
            </dl>
            <p className="mt-2 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">A template only fills type, times, hours, notes, tags and files; property, dates and cleaners stay as chosen.</p>
          </ECard>
        </aside>
      </div>}
      {confirmations}
    </div>
  );
}

function PhoneLayout({
  step,
  visited,
  problemSteps,
  onStep,
  onBack,
  onClose,
  onNext,
  title,
  savedLabel,
  onDuplicate,
  saving,
  footer,
  children,
}: {
  step: NewJobStep;
  visited: ReadonlySet<NewJobStep>;
  problemSteps: ReadonlySet<NewJobStep>;
  onStep: (step: NewJobStep) => void;
  onBack: () => void;
  onClose: () => void;
  onNext: () => void;
  title: string;
  savedLabel: string | null;
  onDuplicate: () => void;
  saving: boolean;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  const index = NEW_JOB_STEPS.indexOf(step);
  const nextStep = NEW_JOB_STEPS[index + 1];
  return (
    <div className="min-w-0 space-y-4 pb-40 sm:hidden">
      <header className="flex items-center gap-3">
        <EButton type="button" variant="outline" size="icon" aria-label={index === 0 ? "Leave New job" : "Previous step"} onClick={index === 0 ? onClose : onBack} disabled={saving}>
          {index === 0 ? "✕" : "‹"}
        </EButton>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[1.0625rem] font-[600] text-[hsl(var(--e-foreground))]">{title}</h1>
          <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">Step {index + 1} of {NEW_JOB_STEPS.length}</p>
        </div>
        {index === 0 ? (
          <button type="button" className="min-h-[44px] text-[0.8125rem] text-[hsl(var(--e-primary))] underline" onClick={onDuplicate}>Duplicate…</button>
        ) : savedLabel ? (
          <span className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{savedLabel}</span>
        ) : null}
      </header>
      <nav aria-label="New job steps" className="-mx-1 overflow-x-auto px-1">
        <ol className="grid min-w-[22rem] grid-cols-5 gap-1">
          {NEW_JOB_STEPS.map((item, position) => {
            const current = item === step;
            const done = position < index || (visited.has(item) && !current && !problemSteps.has(item));
            const problem = problemSteps.has(item);
            return (
              <li key={item}>
                <button
                  type="button"
                  aria-current={current ? "step" : undefined}
                  onClick={() => onStep(item)}
                  className={cn(
                    "flex min-h-[44px] w-full items-center justify-center gap-0.5 rounded-[var(--e-radius-sm)] border px-1 text-[0.75rem]",
                    current
                      ? "border-[hsl(var(--e-border-gold))] bg-[hsl(var(--e-gold-soft))] font-[600] text-[hsl(var(--e-foreground))]"
                      : problem
                        ? "border-[hsl(var(--e-band-problem-line))] bg-[hsl(var(--e-band-problem-bg))] text-[hsl(var(--e-band-problem-fg))]"
                        : done
                          ? "border-[hsl(var(--e-band-good-line))] text-[hsl(var(--e-band-good-fg))]"
                          : "border-[hsl(var(--e-border))] text-[hsl(var(--e-text-secondary))]",
                  )}
                >
                  {NEW_JOB_STEP_LABELS[item]}
                  {problem ? <span aria-label="has a problem"> !</span> : done && !current ? <span aria-label="done"> ✓</span> : null}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
      {children}
      <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+3.5rem)] z-40 border-t border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface)/0.97)] px-4 py-3 backdrop-blur">
        {footer ?? (
          <EButton type="button" className="w-full" onClick={onNext} disabled={saving}>
            Next: {nextStep ? NEW_JOB_STEP_LABELS[nextStep].toLowerCase() : "review"}
          </EButton>
        )}
      </div>
    </div>
  );
}
