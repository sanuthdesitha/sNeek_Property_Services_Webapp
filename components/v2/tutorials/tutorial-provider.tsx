"use client";

/**
 * The tutorial layer for one portal shell: loads the person's own progress,
 * starts the welcome or a page tour on a first visit, runs one tour at a time,
 * pauses for urgent work, and records progress for the person actually signed
 * in (never while testing as someone else).
 *
 * Rules live in lib/tutorials/engine.ts; this component supplies the facts and
 * renders the overlay (tour-overlay.tsx). Board: "Tutorials" (2026-11).
 */
import * as React from "react";
import * as navigation from "next/navigation";
import { useSession } from "next-auth/react";
import { useOpsAccess } from "@/components/shared/ops-access-provider";
import { canUseOpsPath } from "@/lib/rbac/ops-catalog";
import { findTour, toursForRole } from "@/lib/tutorials/registry";
import {
  continueOffer,
  deferralReason,
  helpStatus,
  matchesRoute,
  planAutoRun,
  planManualRun,
  stepsForViewer,
  resolveSteps,
  tourIsLive,
  type DeferralReason,
  type HelpStatus,
  type ResolvedStep,
  type RunPlan,
  type TourViewer,
} from "@/lib/tutorials/engine";
import type {
  TourClientState,
  TourDefinition,
  TourPortal,
  TourProgressRecord,
  TourProgressStatus,
  TourRole,
} from "@/lib/tutorials/types";
import { findTarget, readUrgencySignals, targetAvailable } from "./tour-dom";
import { TourOverlay } from "./tour-overlay";

/** How long a step waits for its control to appear before it is skipped and recorded as missing. */
export const TARGET_WAIT_MS = 1500;
/** After the tour opens a page (or on its first step) the page may still be loading: wait longer. */
export const TARGET_WAIT_AFTER_NAVIGATION_MS = 6000;
const TARGET_POLL_MS = 150;
const AUTO_START_DELAY_MS = 700;
const URGENCY_POLL_MS = 700;

export type RunPhase = "running" | "paused";
export type PauseReason = "user" | DeferralReason;

export type ActiveRun = {
  plan: RunPlan;
  index: number;
  phase: RunPhase;
  pauseReason: PauseReason | null;
  seen: string[];
  missing: string[];
  dontShowAgain: boolean;
  /** Navigation the tour itself started (a step on another page). */
  navigatingTo: string | null;
};

export type HelpEntry = {
  tour: TourDefinition;
  status: HelpStatus;
  stepCount: number;
  onThisPage: boolean;
};

export type TutorialContextValue = {
  portal: TourPortal;
  loading: boolean;
  loadError: string | null;
  state: TourClientState | null;
  run: ActiveRun | null;
  activeStep: ResolvedStep | null;
  deferred: { tourKey: string; reason: DeferralReason } | null;
  continueTour: { tourKey: string; step: number; total: number } | null;
  helpEntries: HelpEntry[];
  newCount: number;
  startTour: (tourKey: string, mode?: "replay" | "continue" | "whatsNew") => void;
  pauseRun: () => void;
  endPractice: (tourKey?: string) => void;
  setToursOn: (on: boolean) => Promise<boolean>;
  helpOpen: boolean;
  setHelpOpen: (open: boolean) => void;
};

const TutorialContext = React.createContext<TutorialContextValue | null>(null);

export function useTutorials(): TutorialContextValue | null {
  return React.useContext(TutorialContext);
}

/** The step a practice screen should show (its `practiceState`), or null outside a tour. */
export function useActiveTourStep(tourKey: string): ResolvedStep | null {
  const context = useTutorials();
  if (!context?.run || context.run.plan.tourKey !== tourKey) return null;
  return context.activeStep;
}

const PORTAL_HOME: Record<TourPortal, string> = {
  admin: "/v2/admin",
  cleaner: "/v2/cleaner",
  client: "/v2/client",
  laundry: "/v2/laundry",
  qa: "/v2/qa",
  maintenance: "/v2/maintenance",
};

const TOUR_ROLE_SET = new Set<string>(["ADMIN", "OPS_MANAGER", "CLEANER", "CLIENT", "VA", "LAUNDRY", "QA_INSPECTOR", "MAINTENANCE"]);

function toTourRole(role: string | undefined): TourRole | null {
  return role && TOUR_ROLE_SET.has(role) ? (role as TourRole) : null;
}

type RecordInput = {
  tourKey: string;
  version: number;
  status: TourProgressStatus;
  seenSteps: string[];
  missingSteps: string[];
  currentStep: number;
};

type TourRouter = { push: (href: string) => void };

/**
 * The tutorial layer must never stop the shell rendering. Outside the app
 * router (an isolated render, a test that mocks next/navigation partly) these
 * hooks are unavailable: tours then navigate with a full page load. Inside the
 * app the hooks always succeed, so the hook order never changes.
 */
function useOptionalRouter(): TourRouter {
  let router: TourRouter | null = null;
  try {
    router = navigation.useRouter();
  } catch {
    router = null;
  }
  return router ?? { push: (href: string) => window.location.assign(href) };
}

function useOptionalPathname(): string {
  try {
    return navigation.usePathname() ?? "";
  } catch {
    return typeof window === "undefined" ? "" : window.location.pathname;
  }
}

/** A usable GET /api/me/tours answer; anything else is treated as "unknown, show no tour". */
function isTourClientState(value: unknown): value is TourClientState {
  if (!value || typeof value !== "object") return false;
  const body = value as Partial<TourClientState>;
  const isRecord = (entry: unknown) => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry);
  return typeof body.recordable === "boolean"
    && typeof body.toursOn === "boolean"
    && typeof body.roleToursOn === "boolean"
    && typeof body.legacyWelcomeSeen === "boolean"
    && Array.isArray(body.dontShowAgain)
    && isRecord(body.progress)
    && isRecord(body.settings);
}

/** The path matches and every query parameter the route names (e.g. ?tab=invoices) is present. */
function locationMatches(route: string, pathname: string): boolean {
  if (!matchesRoute(route, pathname)) return false;
  const query = route.split("?")[1];
  if (!query || typeof window === "undefined") return true;
  const current = new URLSearchParams(window.location.search);
  return Array.from(new URLSearchParams(query).entries()).every(([key, value]) => current.get(key) === value);
}

export function TutorialProvider({ portal, children }: { portal: TourPortal; children: React.ReactNode }) {
  const pathname = useOptionalPathname();
  const router = useOptionalRouter();
  const { data: session } = useSession();
  const { canAccess, levels } = useOpsAccess();
  const role = toTourRole(session?.user?.role);
  const userId = session?.user?.id ?? null;
  const firstName = session?.user?.name?.split(" ")[0] ?? null;

  const [state, setState] = React.useState<TourClientState | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [run, setRun] = React.useState<ActiveRun | null>(null);
  const [deferred, setDeferred] = React.useState<{ tourKey: string; reason: DeferralReason } | null>(null);
  const [helpOpen, setHelpOpen] = React.useState(false);
  const [targetElement, setTargetElement] = React.useState<HTMLElement | null>(null);
  /** Re-checks the location while the tour waits for its own navigation (query changes keep the pathname). */
  const [navigationTick, setNavigationTick] = React.useState(0);
  const attemptedRef = React.useRef(new Set<string>());
  /** A welcome ended with Skip or Not now: no other tour pops up on this page load. */
  const suppressPathRef = React.useRef<string | null>(null);
  const returnFocusRef = React.useRef<HTMLElement | null>(null);
  const runRef = React.useRef<ActiveRun | null>(null);
  /** The tour has just navigated to its step's page. */
  const arrivedRef = React.useRef(false);
  runRef.current = run;

  const viewer = React.useMemo<TourViewer | null>(() => {
    if (!role) return null;
    return {
      role,
      canOpen: (href) => canAccess(href),
      canManage: (href) => !levels || canUseOpsPath(levels, href, "POST"),
    };
  }, [role, canAccess, levels]);

  /* ── Load the person's own state; reset everything when the identity changes ── */
  React.useEffect(() => {
    setRun(null);
    setState(null);
    setDeferred(null);
    attemptedRef.current = new Set();
    if (!userId || !role) return;
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const response = await fetch("/api/me/tours", { cache: "no-store", signal: controller.signal });
        const body = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!response.ok || !isTourClientState(body)) {
          // Unknown state: show no tour, never throw; Help says tours could not be loaded.
          setLoadError(typeof body?.error === "string" ? body.error : "Tours could not be loaded just now.");
          return;
        }
        setState(body);
      } catch {
        if (!controller.signal.aborted) setLoadError("Tours could not be loaded just now.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [userId, role]);

  /* ── Recording (the person's own rows only; nothing while testing as someone) ── */
  const record = React.useCallback(
    (input: RecordInput) => {
      if (!state?.recordable) return;
      const optimistic: TourProgressRecord = {
        ...input,
        updatedAt: new Date().toISOString(),
        completedAt: input.status === "DONE" ? new Date().toISOString() : null,
      };
      setState((current) => {
        if (!current) return current;
        const previous = current.progress[input.tourKey];
        // A finished version is never downgraded by a replay stopped part-way.
        if (previous?.status === "DONE" && previous.version >= input.version && input.status !== "DONE") return current;
        return { ...current, progress: { ...current.progress, [input.tourKey]: optimistic } };
      });
      void fetch("/api/me/tours", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }).catch(() => {
        /* Progress is a convenience: a failed write leaves the local state until the next load. */
      });
    },
    [state?.recordable],
  );

  const recordDontShowAgain = React.useCallback(
    (tourKey: string) => {
      if (!state?.recordable) return;
      setState((current) => (current ? { ...current, dontShowAgain: Array.from(new Set([...current.dontShowAgain, tourKey])) } : current));
      void fetch("/api/me/tours/preference", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dontShowAgain: { tourKey, value: true } }),
      }).catch(() => undefined);
    },
    [state?.recordable],
  );

  const restoreFocus = React.useCallback(() => {
    const element = returnFocusRef.current;
    returnFocusRef.current = null;
    if (element && document.contains(element)) element.focus({ preventScroll: true });
  }, []);

  const beginRun = React.useCallback(
    (plan: RunPlan) => {
      if (!returnFocusRef.current && document.activeElement instanceof HTMLElement) returnFocusRef.current = document.activeElement;
      setDeferred(null);
      setRun({ plan, index: plan.startIndex, phase: "running", pauseReason: null, seen: [], missing: [], dontShowAgain: false, navigatingTo: null });
      if (plan.mode !== "intro") {
        record({ tourKey: plan.tourKey, version: plan.version, status: "IN_PROGRESS", seenSteps: [], missingSteps: [], currentStep: plan.startIndex });
      }
    },
    [record],
  );

  /** End the run. `outcome` decides what is stored. */
  const finishRun = React.useCallback(
    (outcome: "done" | "skip" | "pause" | "notNow" | "silent") => {
      const current = runRef.current;
      if (!current) return;
      const { plan } = current;
      const tour = findTour(plan.tourKey);
      const base = { tourKey: plan.tourKey, version: plan.version, seenSteps: current.seen, missingSteps: current.missing, currentStep: current.index };
      if (outcome === "silent") {
        // Nothing could be shown (every control missing): keep the missing report, claim nothing.
        if (current.missing.length > 0) record({ ...base, status: "NOT_STARTED", currentStep: 0 });
      } else if (current.dontShowAgain && outcome !== "pause") {
        record({ ...base, status: "DISMISSED" });
        recordDontShowAgain(plan.tourKey);
      } else if (outcome === "done" || plan.mode === "whatsNew") {
        // What's new shows once: any ending counts as seen.
        record({ ...base, status: "DONE" });
      } else if (outcome === "notNow" || tour?.kind === "welcome") {
        record({ ...base, status: "SKIPPED" });
      } else {
        record({ ...base, status: "IN_PROGRESS" });
      }
      if (tour?.kind === "welcome" && outcome !== "done") suppressPathRef.current = window.location.pathname;
      if (outcome === "pause") {
        setRun({ ...current, phase: "paused", pauseReason: "user", navigatingTo: null });
      } else {
        setRun(null);
      }
      setTargetElement(null);
      restoreFocus();
    },
    [record, recordDontShowAgain, restoreFocus],
  );

  /* ── Auto-start: welcome first, then the page tour, never over urgent work ── */
  const autoPlan = React.useMemo<RunPlan | null>(() => {
    if (!state || !viewer) return null;
    const candidates = toursForRole(viewer.role).filter((tour) => tour.portal === portal);
    const welcome = candidates.filter((tour) => tour.kind === "welcome");
    const pages = candidates.filter((tour) => tour.kind === "page" && matchesRoute(tour.route, pathname));
    for (const tour of [...welcome, ...pages]) {
      const plan = planAutoRun(tour, {
        progress: state.progress[tour.key],
        setting: state.settings[tour.key],
        viewer,
        recordable: state.recordable,
        toursOn: state.toursOn,
        roleToursOn: state.roleToursOn,
        legacyWelcomeSeen: state.legacyWelcomeSeen,
        dontShowAgain: state.dontShowAgain.includes(tour.key),
      });
      if (plan) return plan;
    }
    return null;
  }, [state, viewer, portal, pathname]);

  React.useEffect(() => {
    if (run || !autoPlan || suppressPathRef.current === pathname) return;
    const attemptKey = `${autoPlan.tourKey}@${autoPlan.version}`;
    if (attemptedRef.current.has(attemptKey)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const attempt = () => {
      if (cancelled) return;
      const reason = deferralReason(readUrgencySignals());
      if (reason) {
        setDeferred({ tourKey: autoPlan.tourKey, reason });
        timer = setTimeout(attempt, 2000);
        return;
      }
      attemptedRef.current.add(attemptKey);
      beginRun(autoPlan);
    };
    timer = setTimeout(attempt, AUTO_START_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [run, autoPlan, beginRun, pathname]);

  /* ── Manual starts (Help, welcome actions, offered walkthroughs) ── */
  const startTour = React.useCallback(
    (tourKey: string, mode: "replay" | "continue" | "whatsNew" = "replay") => {
      const tour = findTour(tourKey);
      if (!tour || !state || !viewer) return;
      const plan = planManualRun(tour, state.settings[tourKey], viewer, state.progress[tourKey], mode);
      if (!plan) return;
      attemptedRef.current.add(`${plan.tourKey}@${plan.version}`);
      if (runRef.current && runRef.current.plan.tourKey !== tourKey) {
        // One tour at a time: the current one is paused where it is.
        const current = runRef.current;
        record({ tourKey: current.plan.tourKey, version: current.plan.version, status: "IN_PROGRESS", seenSteps: current.seen, missingSteps: current.missing, currentStep: current.index });
      }
      setHelpOpen(false);
      beginRun(plan);
    },
    [state, viewer, beginRun, record],
  );

  const pauseRun = React.useCallback(() => finishRun("pause"), [finishRun]);

  const resumeRun = React.useCallback(() => {
    setRun((current) => (current ? { ...current, phase: "running", pauseReason: null } : current));
  }, []);

  /* ── Step resolution: navigate to the step's page, wait for its control, skip if missing ── */
  const activeStep = run ? run.plan.steps[run.index] ?? null : null;
  const activeTour = run ? findTour(run.plan.tourKey) ?? null : null;
  // A welcome belongs to the portal, not a page: it follows the person wherever they first land.
  const expectedRoute = activeStep ? activeStep.route ?? (activeTour?.kind === "welcome" ? "*" : activeTour?.route ?? null) : null;

  React.useEffect(() => {
    if (!run || run.phase !== "running" || !activeStep || !activeTour) return;
    const routeMatches = !expectedRoute || expectedRoute === "*" || locationMatches(expectedRoute, pathname);
    if (!routeMatches) {
      if (run.navigatingTo === expectedRoute) {
        const recheck = setTimeout(() => setNavigationTick((tick) => tick + 1), 250);
        return () => clearTimeout(recheck);
      }
      // Welcome and page tours stay on their page; a walkthrough step may live on the next page.
      if (activeTour.kind === "walkthrough" || activeStep.route) {
        setRun({ ...run, navigatingTo: expectedRoute });
        router.push(expectedRoute!);
      } else {
        finishRun("pause");
      }
      return;
    }
    if (run.navigatingTo) {
      arrivedRef.current = true;
      setRun({ ...run, navigatingTo: null });
      return;
    }
    const patience = arrivedRef.current || run.index === run.plan.startIndex ? TARGET_WAIT_AFTER_NAVIGATION_MS : TARGET_WAIT_MS;
    arrivedRef.current = false;
    if (!activeStep.target) {
      setTargetElement(null);
      markSeen(activeStep.id);
      return;
    }
    const target = activeStep.target;
    let waited = 0;
    let cancelled = false;
    const poll = () => {
      if (cancelled) return;
      const element = findTarget(target);
      if (element) {
        setTargetElement(element);
        markSeen(activeStep.id);
        return;
      }
      waited += TARGET_POLL_MS;
      if (waited < patience) {
        timer = setTimeout(poll, TARGET_POLL_MS);
        return;
      }
      skipMissing(activeStep.id);
    };
    let timer = setTimeout(poll, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.index, run?.phase, run?.plan, run?.navigatingTo, pathname, navigationTick]);

  function markSeen(stepId: string) {
    const current = runRef.current;
    if (!current || current.seen.includes(stepId)) return;
    const seen = [...current.seen, stepId];
    if (current.plan.mode !== "intro") {
      record({ tourKey: current.plan.tourKey, version: current.plan.version, status: "IN_PROGRESS", seenSteps: seen, missingSteps: current.missing, currentStep: current.index });
    }
    const next = { ...current, seen };
    runRef.current = next;
    setRun(next);
  }

  /** A control that is not on screen: skip the step and record it, never an error. */
  function skipMissing(stepId: string) {
    const current = runRef.current;
    if (!current) return;
    const missing = current.missing.includes(stepId) ? current.missing : [...current.missing, stepId];
    const nextIndex = current.index + 1;
    if (nextIndex >= current.plan.steps.length) {
      runRef.current = { ...current, missing };
      finishRun(current.seen.length > 0 ? "done" : "silent");
      return;
    }
    setRun({ ...current, missing, index: nextIndex });
  }

  /* ── Urgent work pauses a running tour; it continues when the screen is clear ── */
  React.useEffect(() => {
    if (!run) return;
    const interval = setInterval(() => {
      const current = runRef.current;
      if (!current) return;
      const signals = readUrgencySignals();
      // Typing in a field does not pause a running tour (practice forms expect it).
      const reason = deferralReason({ ...signals, unsavedForm: false });
      if (current.phase === "running" && reason) {
        setRun({ ...current, phase: "paused", pauseReason: reason });
      } else if (current.phase === "paused" && current.pauseReason !== "user" && !reason) {
        setRun({ ...current, phase: "running", pauseReason: null });
      }
    }, URGENCY_POLL_MS);
    return () => clearInterval(interval);
  }, [run]);

  /* ── Escape pauses from anywhere while a step is showing ── */
  React.useEffect(() => {
    if (!run || run.phase !== "running") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) finishRun("pause");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [run, finishRun]);

  /* ── Overlay actions ── */
  const goNext = React.useCallback(() => {
    const current = runRef.current;
    if (!current) return;
    if (current.index + 1 >= current.plan.steps.length) {
      finishRun("done");
      return;
    }
    setTargetElement(null);
    setRun({ ...current, index: current.index + 1 });
  }, [finishRun]);

  const goBack = React.useCallback(() => {
    const current = runRef.current;
    if (!current || current.index === 0) return;
    // Back passes over steps whose control is not on screen, like Next does.
    let index = current.index - 1;
    while (index > 0) {
      const target = current.plan.steps[index].target;
      if (!target || targetAvailable(target)) break;
      index -= 1;
    }
    setTargetElement(null);
    setRun({ ...current, index });
  }, []);

  const toggleDontShowAgain = React.useCallback((value: boolean) => {
    setRun((current) => (current ? { ...current, dontShowAgain: value } : current));
  }, []);

  const takeFullTour = React.useCallback(() => {
    const current = runRef.current;
    if (!current) return;
    setRun({ ...current, plan: { ...current.plan, mode: "full" }, index: 0, seen: [] });
    record({ tourKey: current.plan.tourKey, version: current.plan.version, status: "IN_PROGRESS", seenSteps: [], missingSteps: [], currentStep: 0 });
  }, [record]);

  const runAction = React.useCallback(
    (action: NonNullable<ResolvedStep["actions"]>[number]) => {
      if (action.kind === "finish") {
        suppressPathRef.current = window.location.pathname;
        finishRun("done");
      } else if (action.kind === "navigate") {
        finishRun("done");
        router.push(action.href);
      } else {
        finishRun("done");
        // Let the finished run clear before the next one begins.
        setTimeout(() => startTour(action.tourKey, "replay"), 0);
      }
    },
    [finishRun, router, startTour],
  );

  const endPractice = React.useCallback((tourKey?: string) => {
    const current = runRef.current;
    const tour = findTour(tourKey ?? current?.plan.tourKey ?? "") ?? null;
    if (current) finishRun("pause");
    setRun(null);
    const exit = tour?.practice?.exitHref;
    if (exit) router.push(exit);
  }, [finishRun, router]);

  const setToursOn = React.useCallback(async (on: boolean) => {
    if (!state?.recordable) return false;
    try {
      const response = await fetch("/api/me/tours/preference", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toursOn: on }),
      });
      if (!response.ok) return false;
      setState((current) => (current ? { ...current, toursOn: on } : current));
      return true;
    } catch {
      return false;
    }
  }, [state?.recordable]);

  /* ── Help listing ── */
  const helpEntries = React.useMemo<HelpEntry[]>(() => {
    if (!state || !viewer) return [];
    return toursForRole(viewer.role)
      .filter((tour) => tour.portal === portal && tourIsLive(state.settings[tour.key]))
      .filter((tour) => tour.kind === "welcome" || tour.route.includes("[") || canAccess(tour.route))
      .map((tour) => {
        const { steps } = stepsForViewer(resolveSteps(tour, state.settings[tour.key]), viewer);
        return {
          tour,
          status: helpStatus(tour, state.progress[tour.key], state.settings[tour.key]),
          stepCount: steps.length,
          onThisPage: tour.kind === "page" && matchesRoute(tour.route, pathname),
        };
      })
      .filter((entry) => entry.stepCount > 0);
  }, [state, viewer, portal, pathname, canAccess]);

  const newCount = helpEntries.filter((entry) => entry.status === "new").length;

  const continueTour = React.useMemo(() => {
    if (run && run.phase === "paused") {
      return { tourKey: run.plan.tourKey, step: run.index + 1, total: run.plan.steps.length };
    }
    if (run || !state || !viewer) return null;
    for (const entry of helpEntries) {
      const offer = continueOffer(entry.tour, state.progress[entry.tour.key], state.settings[entry.tour.key], viewer);
      if (offer && (entry.onThisPage || entry.tour.kind === "walkthrough")) return { tourKey: entry.tour.key, ...offer };
    }
    return null;
  }, [run, state, viewer, helpEntries]);

  const value: TutorialContextValue = {
    portal,
    loading,
    loadError,
    state,
    run,
    activeStep,
    deferred,
    continueTour,
    helpEntries,
    newCount,
    startTour: (tourKey, mode) => {
      if (run && run.plan.tourKey === tourKey && run.phase === "paused" && mode === "continue") {
        resumeRun();
        return;
      }
      startTour(tourKey, mode);
    },
    pauseRun,
    endPractice,
    setToursOn,
    helpOpen,
    setHelpOpen,
  };

  return (
    <TutorialContext.Provider value={value}>
      {children}
      {run && run.phase === "running" && activeStep && activeTour && !run.navigatingTo && (activeStep.target === null || targetElement) ? (
        <TourOverlay
          tour={activeTour}
          plan={run.plan}
          index={run.index}
          step={activeStep}
          target={activeStep.target ? targetElement : null}
          firstName={firstName}
          dontShowAgain={run.dontShowAgain}
          onNext={goNext}
          onBack={goBack}
          onSkip={() => {
            finishRun("skip");
            // Skip on a welcome goes straight to the person's home page.
            if (activeTour.kind === "welcome" && pathname !== PORTAL_HOME[portal]) router.push(PORTAL_HOME[portal]);
          }}
          onPause={() => finishRun("pause")}
          onNotNow={() => finishRun("notNow")}
          onTakeTour={takeFullTour}
          onToggleDontShowAgain={toggleDontShowAgain}
          onAction={runAction}
          onOfferWalkthrough={(key) => {
            finishRun("done");
            setTimeout(() => startTour(key, "replay"), 0);
          }}
        />
      ) : null}
    </TutorialContext.Provider>
  );
}
