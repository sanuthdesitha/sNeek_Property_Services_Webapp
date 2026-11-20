/**
 * What the guest page, the office panel and the client view receive for
 * lost and found return requests (2026-11-20). Plain types, safe for client
 * bundles. Each view carries only what its reader may see.
 */
import type { AttentionReason, ReturnAddress, ReturnFeeState, ReturnMethod, ReturnStatus } from "./return-rules";

/** An upcoming clean offered as a pickup time: date and broad window only. */
export type UpcomingCleanOption = { jobId: string; date: string; window: string };

/** The guest's own request, as their page shows it. */
export type GuestRequestView = {
  id: string;
  version: number;
  status: ReturnStatus;
  method: ReturnMethod;
  contactName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  address: ReturnAddress | null;
  requestedDate: string | null;
  requestedJobId: string | null;
  proposedTime: string | null;
  otherDetails: string | null;
  guestNote: string | null;
  submittedAt: string;
  /** Set once approved or declined. */
  decision: {
    method: ReturnMethod | null;
    date: string | null;
    time: string | null;
    fee: string;
    note: string | null;
    decidedAt: string;
  } | null;
};

export type GuestPageView = {
  companyName: string;
  officePhone: string | null;
  officeEmail: string | null;
  item: {
    name: string;
    foundDate: string;
    foundWhere: string | null;
    propertyLabel: string | null;
    photoUrls: string[];
    /** Calendar date the office holds it until; null when no holding period applies. */
    heldUntil: string | null;
  };
  /** open: requests taken; returned / closed: the item is no longer waiting. */
  itemState: "open" | "returned" | "closed";
  linkExpiresAt: string;
  /** The last calendar day the link works, in the organisation's calendar. */
  linkExpiresOn: string;
  options: {
    upcomingCleans: UpcomingCleanOption[];
    postFee: string | null;
    dropOffFee: string | null;
  };
  /** The latest request through this link (any status), or null. */
  request: GuestRequestView | null;
};

/** One request as the office sees it. */
export type OfficeReturnRequestView = GuestRequestView & {
  itemId: string;
  supersedesId: string | null;
  clientReview: { verdict: string; note: string | null; byName: string | null; at: string } | null;
  decidedByName: string | null;
  decidedByRole: string | null;
  confirmedJob: { id: string; jobNumber: string | null; date: string; status: string } | null;
  feeState: ReturnFeeState;
  feeCents: number | null;
  feeNote: string | null;
  shareContactWithCleaner: boolean;
  jobTaskId: string | null;
  taskStatus: string | null;
  attention: AttentionReason | null;
  guestMessage: GuestMessageRecord | null;
  completedAt: string | null;
  completedByName: string | null;
  completionNote: string | null;
  trackingReference: string | null;
  evidence: Array<{ key: string; src: string }>;
};

/** The exact message sent (or not) for a decision, and the provider's answer. */
export type GuestMessageRecord = {
  transport: "EMAIL" | "SMS" | "NONE";
  to: string | null;
  subject: string;
  body: string;
  state: string;
  note: string;
  at: string;
};

export type OfficeReturnPanel = {
  requests: OfficeReturnRequestView[];
  link: { id: string; url: string; expiresAt: string; firstOpenedAt: string | null; lastOpenedAt: string | null } | null;
  publicRequestsEnabled: boolean;
  upcomingJobs: Array<{ id: string; jobNumber: string | null; date: string; window: string; cleanerNames: string[] }>;
  configuredFees: { POST: string | null; DROP_OFF: string | null };
  canDecide: { allowed: boolean; reason: string | null };
  canSendGuest: { allowed: boolean; reason: string | null };
  hasGuestPhoto: boolean;
  /** The photo URL the guest's email shows (through the open link), or null. */
  guestPhotoUrl: string | null;
  draftContext: { officeName: string; officePhone: string | null; propertyLabel: string; link: string | null };
  /** Each request's address as one line (for the decision message). */
  addresses: Record<string, string | null>;
};

/** One item in the client's Lost and found list. */
export type ClientLostFoundItem = {
  id: string;
  itemName: string;
  foundDate: string;
  foundWhere: string | null;
  propertyLabel: string | null;
  status: string;
  statusLabel: string;
  photoCount: number;
  guestName: string | null;
  requests: Array<{
    id: string;
    version: number;
    status: ReturnStatus;
    method: ReturnMethod;
    summary: string;
    submittedAt: string;
    clientReview: { verdict: string; note: string | null; at: string } | null;
    decision: { fee: string; date: string | null; time: string | null; note: string | null } | null;
    attention: AttentionReason | null;
  }>;
};

export type ClientLostFoundView = {
  items: ClientLostFoundItem[];
  clientsCanApprove: boolean;
  timeZone: string;
};
