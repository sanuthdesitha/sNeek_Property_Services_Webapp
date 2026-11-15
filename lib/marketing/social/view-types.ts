/**
 * Shapes the social post generator's routes return and its screens read
 * (2026-11-17). Types and a few constants only; safe everywhere.
 */
import type { SocialFormat, SocialNetwork, SocialRatio, SplitLayout } from "./networks";
import type { PhotoFieldKind } from "./photo-fields";
import type { MeasuredComponents } from "./scoring-rules";

export type CandidatePhotoState = "usable" | "needs_look" | "left_out" | "checking" | "not_scored";

export type CandidatePhoto = {
  photoId: string;
  jobId: string;
  jobNumber: string;
  propertyName: string;
  room: string;
  fieldLabel: string;
  fieldKind: PhotoFieldKind;
  /** 0–100, or null when not scored yet / could not be scored. */
  score: number | null;
  scoreWord: string;
  components: (MeasuredComponents & { fresh: number; recency: number }) | null;
  reasons: string[];
  leftOutReason: string | null;
  state: CandidatePhotoState;
  usedBefore: boolean;
  fits: SocialRatio[];
  /** Calendar day the job finished (organisation time zone). */
  finishedOn: string;
};

export type CandidatePermission = {
  givenByName: string;
  method: string;
  givenAt: string;
  allowSuburb: boolean;
  allowBefore: boolean;
};

export type CandidateJob = {
  jobId: string;
  jobNumber: string;
  propertyId: string;
  propertyName: string;
  /** Present only when the permission allows naming it. */
  suburb: string | null;
  bedrooms: number | null;
  finishedOn: string;
  qaScore: number | null;
  state: "usable" | "not_usable" | "left_out";
  reason: string | null;
  permission: CandidatePermission | null;
  counts: { usable: number; listing: number; before: number; usedInPost: number; leftOut: number; checking: number };
};

export type CandidateSummary = {
  jobsCompleted: number;
  qaPassedClean: number;
  qaNotReviewed: number;
  qaFailed: number;
  openCase: number;
  atPermission: number;
  noPermission: number;
  photosScored: number;
  stillChecking: number;
  usable: number;
  leftOut: number;
};

export type CandidateList = {
  from: string;
  to: string;
  ratio: SocialRatio;
  summary: CandidateSummary;
  jobs: CandidateJob[];
  photos: CandidatePhoto[];
};

export type GroupPhotoView = {
  photoId: string;
  order: number;
  role: "PHOTO" | "BEFORE" | "AFTER";
  altText: string;
  altHint: string;
  room: string;
  fieldLabel: string;
  fieldKind: PhotoFieldKind;
  jobNumber: string;
  propertyName: string;
  beforeCheckedAt: string | null;
  /** Null while eligible; otherwise why it can no longer be used. */
  refusal: string | null;
};

export type NetworkPostView = {
  postId: string;
  network: SocialNetwork;
  status: string;
  deliveryMode: "API" | "MANUAL" | null;
  caption: string;
  hashtags: string[];
  scheduledFor: string | null;
  publishedAt: string | null;
  externalId: string | null;
  externalUrl: string | null;
  failureReason: string | null;
  failureCode: string | null;
  attemptCount: number;
  removalNeededAt: string | null;
  removalDoneAt: string | null;
  metrics: { fetchedAt: string; reach: number | null; likes: number | null; comments: number | null; shares: number | null } | null;
};

export type GroupView = {
  id: string;
  title: string;
  format: SocialFormat;
  status: string;
  createdVia: "USER" | "AGENT";
  ratio: SocialRatio;
  splitLayout: SplitLayout | null;
  frameText: string | null;
  revision: number;
  reviewedAt: string | null;
  reviewedByName: string | null;
  plannedFor: string | null;
  createdAt: string;
  updatedAt: string;
  photos: GroupPhotoView[];
  posts: NetworkPostView[];
  /** Derivative copies already made for this group (admin preview links). */
  derivatives: Array<{ assetId: string; kind: string; ratio: string | null; width: number | null; height: number | null; sourcePhotoId: string | null }>;
};

export type AccountView = {
  id: string;
  network: SocialNetwork;
  displayName: string;
  status: "CONNECTED" | "NEEDS_RECONNECT" | "DISCONNECTED";
  statusReason: string | null;
  connectedByName: string | null;
  connectedAt: string;
  lastCheckAt: string | null;
  lastCheckResult: string | null;
  scopes: string[];
  tokenExpiresAt: string | null;
  publishingLimit: { used: number | null; total: number | null } | null;
};

export type PublishResultRow = {
  network: SocialNetwork;
  outcome: "POSTED" | "SENT_TO_INBOX" | "FAILED" | "UNCONFIRMED" | "NOT_CONNECTED" | "REFUSED" | "ALREADY";
  message: string;
  externalUrl: string | null;
};
