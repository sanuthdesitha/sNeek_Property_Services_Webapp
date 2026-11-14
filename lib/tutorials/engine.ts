/**
 * Tutorial engine rules (plain module, no DOM, no React): which tour may start,
 * which steps it shows (What's new, permission skips, administrator wording),
 * how it moves past a missing target, and when urgent work defers it.
 *
 * The browser layer (components/v2/tutorials) supplies the facts — the person's
 * progress, what is on screen — and these functions decide. Tests drive them
 * directly (tests/lib/tutorials-engine.test.ts).
 */
import { TOUR_TARGETS, isTourTargetId, type TourTargetId } from "./targets";
import type {
  TourDefinition,
  TourProgressRecord,
  TourRole,
  TourSettingView,
  TourStepDefinition,
} from "./types";

/**
 * A tour's effective version folds an administrator's What's new revision into
 * the code version: code v2 + revision 3 = 2003. Code versions dominate, so a
 * code bump always outranks any number of wording revisions.
 */
export const VERSION_STRIDE = 1000;

export function effectiveVersion(tour: TourDefinition, setting?: TourSettingView | null): number {
  return tour.version * VERSION_STRIDE + Math.max(0, setting?.revision ?? 0);
}

/** A step as it will be shown: administrator wording applied, its What's new version resolved. */
export type ResolvedStep = TourStepDefinition & {
  /** Effective version this step was added or last marked What's new. */
  sinceEffective: number;
};

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Code steps with the administrator's order, wording and hidden flags applied. */
export function resolveSteps(tour: TourDefinition, setting?: TourSettingView | null): ResolvedStep[] {
  const overrides = new Map((setting?.overrides.steps ?? []).map((entry) => [entry.id, entry]));
  const order = setting?.overrides.order ?? [];
  const byId = new Map(tour.steps.map((step) => [step.id, step]));
  const ordered: TourStepDefinition[] = [
    ...order.map((id) => byId.get(id)).filter((step): step is TourStepDefinition => Boolean(step)),
    ...tour.steps.filter((step) => !order.includes(step.id)),
  ];
  const resolved: ResolvedStep[] = [];
  for (const step of ordered) {
    const override = overrides.get(step.id);
    if (override?.hidden) continue;
    const title = override?.title?.trim() ? override.title.trim() : step.title;
    const body = override?.body?.trim() && countWords(override.body) <= 25 ? override.body.trim() : step.body;
    // A target override must name a registered target on the same page; code wins otherwise.
    const target = override?.target && isTourTargetId(override.target) && sameTargetPage(step.target, override.target)
      ? override.target
      : step.target;
    const sinceEffective = override?.whatsNewRevision
      ? tour.version * VERSION_STRIDE + override.whatsNewRevision
      : step.since * VERSION_STRIDE;
    resolved.push({ ...step, title, body, target, sinceEffective });
  }
  return resolved;
}

function sameTargetPage(original: TourTargetId | null, replacement: TourTargetId): boolean {
  if (!original) return false;
  return TOUR_TARGETS[original].page === TOUR_TARGETS[replacement].page;
}

/** Route patterns: exact, `[id]` for one segment, `*` for every page of the portal. */
export function matchesRoute(pattern: string, pathname: string): boolean {
  if (pattern === "*") return true;
  const clean = (value: string) => value.split("?")[0].replace(/\/+$/, "") || "/";
  const patternParts = clean(pattern).split("/");
  const pathParts = clean(pathname).split("/");
  if (patternParts.length !== pathParts.length) return false;
  return patternParts.every((part, index) => (/^\[[^\]]+\]$/.test(part) ? pathParts[index] !== "" : part === pathParts[index]));
}

/** What the viewer may see, from the same role and pack checks as the pages. */
export type TourViewer = {
  role: TourRole;
  canOpen: (href: string) => boolean;
  canManage: (href: string) => boolean;
};

export type ViewerSteps = { steps: ResolvedStep[]; permissionSkipped: string[] };

/** Steps for controls the person cannot see are skipped (and not reported as missing). */
export function stepsForViewer(steps: ResolvedStep[], viewer: TourViewer): ViewerSteps {
  const kept: ResolvedStep[] = [];
  const permissionSkipped: string[] = [];
  for (const step of steps) {
    const roleOk = !step.roles || step.roles.includes(viewer.role);
    const openOk = !step.requiresHref || viewer.canOpen(step.requiresHref);
    const manageOk = !step.requiresManageHref || viewer.canManage(step.requiresManageHref);
    if (roleOk && openOk && manageOk) kept.push(step);
    else permissionSkipped.push(step.id);
  }
  return { steps: kept, permissionSkipped };
}

export type RunMode = "full" | "whatsNew" | "continue" | "intro" | "replay";

export type RunPlan = {
  tourKey: string;
  mode: RunMode;
  steps: ResolvedStep[];
  startIndex: number;
  /** Effective version the run records when it ends. */
  version: number;
  permissionSkipped: string[];
};

export type AutoRunContext = {
  progress: TourProgressRecord | undefined;
  setting: TourSettingView | undefined;
  viewer: TourViewer;
  recordable: boolean;
  toursOn: boolean;
  roleToursOn: boolean;
  legacyWelcomeSeen: boolean;
  /** The person chose "Don't show again" for this tour (survives a reset of its progress row). */
  dontShowAgain?: boolean;
};

export function tourIsLive(setting: TourSettingView | undefined): boolean {
  return !setting || setting.status === "LIVE";
}

/**
 * Should this tour start on its own? Never while testing as someone else,
 * never when tours are off (person or role), never for walkthroughs.
 *
 * Existing people (the retired "tutorial seen" flag) never get a welcome and
 * get a one-card "This page has a tour" offer instead of a full page tour.
 */
export function planAutoRun(tour: TourDefinition, context: AutoRunContext): RunPlan | null {
  if (!context.recordable || !context.toursOn || !context.roleToursOn) return null;
  if (!tourIsLive(context.setting) || tour.kind === "walkthrough") return null;
  if (!tour.roles.includes(context.viewer.role)) return null;
  const version = effectiveVersion(tour, context.setting);
  const { steps, permissionSkipped } = stepsForViewer(resolveSteps(tour, context.setting), context.viewer);
  if (steps.length === 0) return null;
  const progress = context.progress;
  const base = { tourKey: tour.key, version, permissionSkipped };

  if (tour.kind === "welcome") {
    if (context.legacyWelcomeSeen) return null;
    if (progress && progress.status !== "NOT_STARTED") return null;
    return { ...base, mode: "full", steps, startIndex: 0 };
  }

  if (!progress || progress.status === "NOT_STARTED") {
    if (context.dontShowAgain) return null;
    if (context.legacyWelcomeSeen) return { ...base, mode: "intro", steps, startIndex: 0 };
    return { ...base, mode: "full", steps, startIndex: 0 };
  }
  if ((progress.status === "DONE" || progress.status === "DISMISSED") && progress.version < version) {
    const changed = whatsNewSteps(steps, progress.version);
    return changed.length > 0 ? { ...base, mode: "whatsNew", steps: changed, startIndex: 0 } : null;
  }
  // In progress or skipped: offered as "Continue tour" in the header, never popped up again.
  return null;
}

/** Only the steps added or changed after the version the person finished. */
export function whatsNewSteps(steps: ResolvedStep[], completedVersion: number): ResolvedStep[] {
  return steps.filter((step) => step.sinceEffective > completedVersion);
}

/** A tour started from Help: Replay starts at step 1, Continue where they stopped. */
export function planManualRun(
  tour: TourDefinition,
  setting: TourSettingView | undefined,
  viewer: TourViewer,
  progress: TourProgressRecord | undefined,
  mode: "replay" | "continue" | "whatsNew",
): RunPlan | null {
  const version = effectiveVersion(tour, setting);
  const { steps, permissionSkipped } = stepsForViewer(resolveSteps(tour, setting), viewer);
  if (steps.length === 0) return null;
  if (mode === "whatsNew") {
    const changed = progress ? whatsNewSteps(steps, progress.version) : steps;
    return { tourKey: tour.key, mode, steps: changed.length ? changed : steps, startIndex: 0, version, permissionSkipped };
  }
  const startIndex = mode === "continue" && progress ? Math.min(Math.max(progress.currentStep, 0), steps.length - 1) : 0;
  return { tourKey: tour.key, mode: mode === "continue" ? "continue" : "replay", steps, startIndex, version, permissionSkipped };
}

/** "Continue tour 3 of 5" for a tour stopped part-way. */
export function continueOffer(
  tour: TourDefinition,
  progress: TourProgressRecord | undefined,
  setting: TourSettingView | undefined,
  viewer: TourViewer,
): { step: number; total: number } | null {
  if (!progress || progress.status !== "IN_PROGRESS" || !tourIsLive(setting)) return null;
  const { steps } = stepsForViewer(resolveSteps(tour, setting), viewer);
  if (steps.length === 0) return null;
  return { step: Math.min(progress.currentStep, steps.length - 1) + 1, total: steps.length };
}

/**
 * Walk from `from` in `direction` to the next step whose target is on screen.
 * Steps without a target (centred cards) are always available. Returns the
 * index and the ids passed over because their target was missing.
 */
export function nextAvailableIndex(
  steps: ResolvedStep[],
  from: number,
  direction: 1 | -1,
  isAvailable: (target: TourTargetId) => boolean,
): { index: number | null; missing: string[] } {
  const missing: string[] = [];
  for (let index = from; index >= 0 && index < steps.length; index += direction) {
    const step = steps[index];
    if (!step.target || isAvailable(step.target)) return { index, missing };
    missing.push(step.id);
  }
  return { index: null, missing };
}

/** Facts about the screen that mean "not now". */
export type UrgencySignals = {
  /** A cleaner's clock is running (job in progress). */
  clockRunning: boolean;
  /** Another dialog or sheet is open. */
  dialogOpen: boolean;
  /** The person is typing in a field or a form has unsaved changes. */
  unsavedForm: boolean;
  /** Pages mark other urgent states with data-tour-busy (SOS, offline, failed send). */
  busyMarkers: string[];
};

export type DeferralReason = "clock" | "dialog" | "unsaved" | "busy";

export const DEFERRAL_MESSAGES: Record<DeferralReason, string> = {
  clock: "Tours never start while your clock is running. This one comes back once the job is submitted.",
  dialog: "Paused while a window is open. It continues when you close it.",
  unsaved: "Paused while you have unsaved changes. Continue it from Help when you're ready.",
  busy: "Paused while something needs your attention. Continue it from Help later.",
};

export function deferralReason(signals: UrgencySignals): DeferralReason | null {
  if (signals.clockRunning || signals.busyMarkers.includes("clock")) return "clock";
  if (signals.dialogOpen) return "dialog";
  if (signals.unsavedForm) return "unsaved";
  if (signals.busyMarkers.length > 0) return "busy";
  return null;
}

/** Help's done / not done label for a tour. */
export type HelpStatus = "done" | "notDone" | "inProgress" | "new";

export function helpStatus(
  tour: TourDefinition,
  progress: TourProgressRecord | undefined,
  setting: TourSettingView | undefined,
): HelpStatus {
  if (!progress || progress.status === "NOT_STARTED" || progress.status === "SKIPPED") return "notDone";
  if (progress.status === "IN_PROGRESS") return "inProgress";
  const version = effectiveVersion(tour, setting);
  if (progress.version < version && whatsNewSteps(resolveSteps(tour, setting), progress.version).length > 0) return "new";
  return progress.status === "DONE" ? "done" : "notDone";
}

/** Welcome titles may greet by first name; without one the greeting stays plain. */
export function personalise(text: string, firstName: string | null | undefined): string {
  const name = firstName?.trim();
  return name ? text.replace(/\{firstName\}/g, name) : text.replace(/ \{firstName\}/g, "").replace(/\{firstName\}/g, "");
}
