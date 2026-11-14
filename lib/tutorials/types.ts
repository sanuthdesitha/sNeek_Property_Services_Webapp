/**
 * Tutorial system types (plain module: safe for server pages and API routes).
 * See docs/SYSTEM.md › "In-app tutorials" for how the layers fit together.
 */
import type { TourPortal, TourTargetId } from "./targets";

export type { TourPortal, TourTargetId } from "./targets";

/** Roles a tour can be shown to. VA is the client assistant. */
export type TourRole =
  | "ADMIN"
  | "OPS_MANAGER"
  | "CLEANER"
  | "CLIENT"
  | "VA"
  | "LAUNDRY"
  | "QA_INSPECTOR"
  | "MAINTENANCE";

export const TOUR_ROLES: readonly TourRole[] = [
  "ADMIN",
  "OPS_MANAGER",
  "CLEANER",
  "CLIENT",
  "VA",
  "LAUNDRY",
  "QA_INSPECTOR",
  "MAINTENANCE",
];

export const TOUR_ROLE_LABELS: Record<TourRole, string> = {
  ADMIN: "Administrators",
  OPS_MANAGER: "Operations managers",
  CLEANER: "Cleaners",
  CLIENT: "Clients",
  VA: "Client assistants",
  LAUNDRY: "Laundry partners",
  QA_INSPECTOR: "QA inspectors",
  MAINTENANCE: "Maintenance",
};

/** welcome: first sign-in screens. page: first visit to a page. walkthrough: a task, from Help. */
export type TourKind = "welcome" | "page" | "walkthrough";

export type TourPlacement = "auto" | "top" | "bottom" | "left" | "right";

/** A button on a welcome screen or at the end of a tour. */
export type TourStepAction =
  | { kind: "startTour"; label: string; tourKey: string; primary?: boolean }
  | { kind: "navigate"; label: string; href: string; primary?: boolean }
  | { kind: "finish"; label: string; primary?: boolean };

export type TourStepDefinition = {
  /** Stable within the tour; progress records step ids, never indexes. */
  id: string;
  /** Registered control; null shows a centred card (welcome screens). */
  target: TourTargetId | null;
  /** Two to four words. */
  title: string;
  /** At most 25 words (tests/lib/tutorials-registry.test.ts counts them). */
  body: string;
  placement?: TourPlacement;
  /** The tour version this step was added or visibly changed in (What's new). */
  since: number;
  /** The step runs on a practice screen (labelled "Practice"). */
  practice?: boolean;
  /** Route this step lives on when it differs from the tour's route. */
  route?: string;
  /** Shown only to these roles (others skip it as a permission skip). */
  roles?: TourRole[];
  /** Shown only when the viewer may open this destination (ops packs, adminOnly). */
  requiresHref?: string;
  /** Shown only when the viewer may change things there (ops pack at Manage). */
  requiresManageHref?: string;
  /** A state the practice screen moves to before this step (practice job stages). */
  practiceState?: string;
  /** Buttons replacing Next on the last step or a welcome screen. */
  actions?: TourStepAction[];
  /** A short reassurance line under the body (welcome screens). */
  note?: string;
};

export type TourDefinition = {
  key: string;
  kind: TourKind;
  portal: TourPortal;
  roles: TourRole[];
  /** Route pattern that starts the tour (page tours) or where it begins. */
  route: string;
  title: string;
  /** Bump when a step is added, removed, reordered or visibly changed. */
  version: number;
  steps: TourStepDefinition[];
  /** Practice walkthroughs: the banner on every practice screen, and where End practice goes. */
  practice?: { banner: string; exitHref: string };
  /** A walkthrough offered on the last step of this page tour. */
  offerWalkthrough?: string;
};

/** Stored per person and tour. DISMISSED = "Don't show again". */
export type TourProgressStatus = "NOT_STARTED" | "IN_PROGRESS" | "DONE" | "SKIPPED" | "DISMISSED";

export const TOUR_PROGRESS_STATUSES: readonly TourProgressStatus[] = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "DONE",
  "SKIPPED",
  "DISMISSED",
];

export type TourProgressRecord = {
  tourKey: string;
  /** Effective version (see effectiveVersion) the record refers to. */
  version: number;
  status: TourProgressStatus;
  seenSteps: string[];
  missingSteps: string[];
  currentStep: number;
  updatedAt: string | null;
  completedAt: string | null;
};

/** Administrator status of a tour (Settings › System › Tutorials). */
export type TourPublishStatus = "LIVE" | "DRAFT" | "PAUSED";

/** Administrator wording/order overrides. Targets always come from code. */
export type TourStepOverride = {
  id: string;
  title?: string;
  body?: string;
  hidden?: boolean;
  target?: TourTargetId;
  /** Revision at which an administrator marked this step as What's new. */
  whatsNewRevision?: number;
};

export type TourOverrides = {
  steps?: TourStepOverride[];
  order?: string[];
};

export type TourSettingView = {
  status: TourPublishStatus;
  revision: number;
  overrides: TourOverrides;
  updatedAt: string | null;
};

/** What GET /api/me/tours returns. */
export type TourClientState = {
  /** False while testing as / impersonating: nothing is read or recorded. */
  recordable: boolean;
  notRecordableReason: string | null;
  role: TourRole;
  toursOn: boolean;
  roleToursOn: boolean;
  dontShowAgain: string[];
  /** The retired v1 "tutorial seen" flag: counts as every welcome done. */
  legacyWelcomeSeen: boolean;
  progress: Record<string, TourProgressRecord>;
  settings: Record<string, TourSettingView>;
};
