/**
 * What the onboarding routes send to the screens. Plain module (types only).
 */
import type { ReadinessSummary } from "./readiness";
import type { ClientLinkSection, OnboardingSectionKey } from "./sections";
import type { OnboardingAnswerSource } from "./types";
import type { SectionValuesMap } from "./values";

export type OnboardingStatus = "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "REJECTED";
export type OnboardingBoardTab = "open" | "progress" | "waiting" | "ready" | "activated" | "rejected";

export type ClientLinkView = {
  id: string;
  sections: ClientLinkSection[];
  transport: "EMAIL" | "SMS";
  recipientMasked: string;
  createdAt: string;
  createdByName: string | null;
  expiresAt: string;
  revokedAt: string | null;
  firstOpenedAt: string | null;
  lastOpenedAt: string | null;
  finishedAt: string | null;
  deliveryState: string | null;
  deliveryError: string | null;
  /** Open = not revoked, not expired. */
  open: boolean;
};

export type AnswerRevisionView = {
  revision: number;
  section: string;
  fields: string[];
  source: OnboardingAnswerSource;
  actorName: string;
  createdAt: string;
  changes: Record<string, { before: unknown; after: unknown }>;
};

export type LaundryRulesView =
  | { state: "ok"; version: number; lines: string[] }
  | { state: "unavailable"; reason: string };

export type ActivationOutcomeView = {
  propertyId: string;
  propertyName: string;
  activatedAt: string | null;
  activatedByName: string | null;
  warnings: string[];
};

export type OnboardingWorkspaceView = {
  id: string;
  surveyNumber: string;
  status: OnboardingStatus;
  sourceType: "ADMIN_CREATED" | "CLIENT_SUBMITTED" | "WEB_FORM";
  revision: number;
  createdAt: string;
  startedByName: string | null;
  lastSavedAt: string | null;
  lastSavedByName: string | null;
  lastSavedSource: OnboardingAnswerSource | null;
  timezone: string;
  values: SectionValuesMap;
  clientName: string | null;
  clientContact: { email: string | null; phone: string | null };
  laundryPartnerName: string | null;
  legacyAccess: Array<{ detailType: string; hasValue: boolean; photoUrl: string | null }>;
  legacyAlarmCodeSaved: boolean;
  checklistReviewed: boolean;
  skipped: OnboardingSectionKey[];
  readiness: ReadinessSummary;
  clientLinks: ClientLinkView[];
  /** Workspace sections with an open client link asking for them. */
  askedOfClient: OnboardingSectionKey[];
  history: AnswerRevisionView[];
  laundryRules: LaundryRulesView;
  rejectionReason: string | null;
  activation: ActivationOutcomeView | null;
  canDeleteDrafts: boolean;
};

export type SaveConflictView = {
  actorName: string;
  source: OnboardingAnswerSource;
  at: string;
  section: string;
  changes: Record<string, { before: unknown; after: unknown }>;
};

export type WorkspaceSaveResponse = {
  revision: number;
  savedAt: string;
  section: OnboardingSectionKey;
  values: SectionValuesMap[OnboardingSectionKey];
  readiness: ReadinessSummary;
  skipped: OnboardingSectionKey[];
  conflict: SaveConflictView | null;
};

export type OnboardingBoardRow = {
  id: string;
  surveyNumber: string;
  status: OnboardingStatus;
  tab: Exclude<OnboardingBoardTab, "open">;
  sourceType: "ADMIN_CREATED" | "CLIENT_SUBMITTED" | "WEB_FORM";
  propertyName: string | null;
  address: string | null;
  clientName: string | null;
  isNewClient: boolean;
  readiness: Pick<ReadinessSummary, "percent" | "requiredDone" | "requiredTotal" | "recommendedDone" | "recommendedTotal" | "ready"> & {
    missingRequired: string[];
    next: { section: OnboardingSectionKey; label: string } | null;
    items: Array<{ section: OnboardingSectionKey; label: string; required: boolean; state: "done" | "missing" | "skipped"; detail: string }>;
  };
  clientLink: { openedAt: string | null; finishedAt: string | null; createdAt: string; sections: ClientLinkSection[]; doneSections: number } | null;
  askedOfClient: OnboardingSectionKey[];
  lastSavedAt: string;
  lastSavedByName: string | null;
  lastSavedSource: OnboardingAnswerSource | null;
  startedByName: string | null;
  createdPropertyId: string | null;
};

export type OnboardingBoardResponse = {
  rows: OnboardingBoardRow[];
  counts: Record<OnboardingBoardTab, number>;
  timezone: string;
};
