import type { NotificationTransport } from "@/lib/notifications/catalog-types";

/** Client-side copy of an office send outcome (lib/notifications/office-sends.ts). */
export type RecipientOutcomeView = {
  userId: string;
  name: string;
  /** SMS appears only for a "Send test to me" by SMS (direct to your own phone). */
  transport: NotificationTransport;
  path: "pipeline" | "direct";
  state: string;
  errorCode?: string | null;
};

const LABEL: Record<string, string> = {
  queued: "queued",
  inbox_available: "in the inbox",
  provider_accepted: "accepted by the provider (delivery not confirmed)",
  requested: "requested (no receipt from the push service)",
  already_requested: "already requested earlier",
  uncertain: "outcome unknown",
  skipped: "skipped",
  failed: "failed",
  switched_off: "switched off for this type",
};

export function outcomeLabel(outcome: RecipientOutcomeView): string {
  const base = LABEL[outcome.state] ?? outcome.state;
  return outcome.errorCode ? `${base} (${outcome.errorCode.replace(/_/g, " ")})` : base;
}
