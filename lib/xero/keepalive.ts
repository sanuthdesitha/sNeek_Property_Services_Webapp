/**
 * The daily Xero keep-alive (worker job `xero-token-keepalive`, 2026-11-15).
 *
 * Xero expires a refresh token that goes unused for 60 days, so an idle
 * connection (no invoices to push or check) used to lapse. Once a day this
 * renews the sign-in through the token service (forced, single flight,
 * recorded in lastRefreshedAt), checks that the organisation is still
 * connected to the app, and retries a reconnect notice that could not be
 * queued. It never pushes or reads financial documents.
 */
import { db } from "@/lib/db";
import {
  getXeroAccessToken,
  sendPendingReconnectNotice,
  verifyXeroTenant,
  type XeroTokenDeps,
  type XeroTokenFailureKind,
} from "./token-service";

export type XeroKeepAliveOutcome =
  | { outcome: "not-connected" }
  | { outcome: "renewed"; tenantCheck: "present" | "unknown"; renewedHere: boolean }
  | { outcome: "needs-reconnect"; reason: string; noticeQueued: boolean }
  | { outcome: "failed"; kind: Exclude<XeroTokenFailureKind, "not-connected" | "needs-reconnect">; reason: string };

export async function runXeroKeepAlive(partial: Partial<XeroTokenDeps> = {}): Promise<XeroKeepAliveOutcome> {
  const table = partial.db ?? db;
  const conn = await table.xeroConnection.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, statusReason: true },
  });
  if (!conn) return { outcome: "not-connected" };
  if (conn.status === "NEEDS_RECONNECT") {
    const noticeQueued = await sendPendingReconnectNotice(conn.id, partial);
    return { outcome: "needs-reconnect", reason: conn.statusReason ?? "Xero needs reconnecting.", noticeQueued };
  }

  const renewed = await getXeroAccessToken({ force: true }, partial);
  if (!renewed.ok) {
    if (renewed.kind === "not-connected") return { outcome: "not-connected" };
    if (renewed.kind === "needs-reconnect") return { outcome: "needs-reconnect", reason: renewed.reason, noticeQueued: false };
    return { outcome: "failed", kind: renewed.kind, reason: renewed.reason };
  }

  const check = await verifyXeroTenant(renewed.token, partial);
  if (check.state === "removed") return { outcome: "needs-reconnect", reason: check.failure.reason, noticeQueued: true };
  return { outcome: "renewed", tenantCheck: check.state, renewedHere: renewed.refreshed };
}
