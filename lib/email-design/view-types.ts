/**
 * Response shapes of the email design routes. Plain module (types only).
 */
import type { ContrastReport } from "./theme";
import type { BusinessDetails, EmailTheme } from "./types";
import type { DesignRow, ThemeRow } from "./store-types";

export type DesignAccessView = {
  canDraft: boolean;
  draftReason: string | null;
  canPublish: boolean;
  publishReason: string | null;
  actorRole: "ADMIN" | "OPS_MANAGER" | null;
};

export type DesignListItem = {
  key: string;
  publishedVersion: number | null;
  hasDraft: boolean;
  readFailed: boolean;
  /** A shared template an admin edited as raw HTML (it keeps rendering until a block version is published). */
  customHtml: boolean;
};

export type DesignListResponse = { items: DesignListItem[]; access: DesignAccessView };

export type DesignViewResponse = {
  key: string;
  row: DesignRow;
  theme: EmailTheme;
  business: BusinessDetails;
  appUrl: string;
  customHtml: boolean;
  access: DesignAccessView;
  impersonating: boolean;
};

export type LookViewResponse = {
  row: ThemeRow;
  published: EmailTheme;
  contrast: ContrastReport[];
  business: BusinessDetails;
  appUrl: string;
  sendingAddress: string;
  officeInbox: string;
  canEdit: boolean;
  editReason: string | null;
  canPublish: boolean;
  publishReason: string | null;
};
