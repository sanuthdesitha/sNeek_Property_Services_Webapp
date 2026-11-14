import "server-only";
/**
 * What the Sending safeguards screen shows: today's volumes (organisation
 * day) by type and transport, the people receiving the most, what was not
 * sent and why, what is paused, recent incidents, the limits and the
 * emergency stop. Addresses are masked; account names are shown where known.
 */
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { NOTIFICATION_CATALOG, catalogEntry } from "../catalog";
import { isPausableTypeKey } from "./classify";
import { maskRecipient } from "./breaker";
import { SUPPRESSION_REASON_LABEL, isSuppressionReason } from "./config";
import { readSafeguardSettings } from "./store";
import type { SafeguardIncidentView, SafeguardsOverview } from "./overview-types";

function organisationDayStart(now: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const elapsed = (get("hour") * 3600 + get("minute") * 60 + get("second")) * 1000;
  return new Date(Math.floor((now.getTime() - elapsed) / 1000) * 1000);
}

function typeName(typeKey: string): string {
  return catalogEntry(typeKey)?.name ?? typeKey;
}

function reasonLabel(reason: string | null): string {
  return reason && isSuppressionReason(reason) ? SUPPRESSION_REASON_LABEL[reason] : reason ?? "";
}

async function namesFor(userIds: string[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (ids.length === 0) return new Map();
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return new Map(users.map((user) => [user.id, user.name ?? ""]));
}

function incidentView(row: {
  id: string; kind: string; scopeKind: string; scopeKey: string; label: string; status: string; pausesSending: boolean;
  attemptCount: number; sampleRecipients: unknown; detail: unknown; createdAt: Date; resolvedAt: Date | null; alertedAt: Date | null; resolutionNote: string | null;
}): SafeguardIncidentView {
  const detail = row.detail && typeof row.detail === "object" && !Array.isArray(row.detail) ? (row.detail as Record<string, unknown>) : {};
  return {
    id: row.id,
    kind: row.kind,
    scopeKind: row.scopeKind,
    // A person's address is never shown in full.
    scopeLabel: row.scopeKind === "RECIPIENT" ? row.label : row.scopeKind === "TYPE" ? typeName(row.scopeKey) : row.label,
    label: row.label,
    status: row.status,
    pausesSending: row.pausesSending,
    attempts: row.attemptCount,
    recipients: Array.isArray(row.sampleRecipients) ? row.sampleRecipients.map(String) : [],
    transport: typeof detail.transport === "string" ? detail.transport : null,
    windowMinutes: typeof detail.windowMinutes === "number" ? detail.windowMinutes : null,
    threshold: typeof detail.threshold === "number" ? detail.threshold : null,
    note: typeof detail.note === "string" ? detail.note : typeof detail.error === "string" ? detail.error : null,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    alertedAt: row.alertedAt?.toISOString() ?? null,
    resolutionNote: row.resolutionNote,
  };
}

export async function buildSafeguardsOverview(now = new Date()): Promise<SafeguardsOverview> {
  const timeZone = (await getAppSettings().catch(() => null))?.timezone || "Australia/Sydney";
  const since = organisationDayStart(now, timeZone);
  const today = { createdAt: { gte: since } };
  const [settings, byType, byRecipient, reasons, recent, paused, incidents] = await Promise.all([
    readSafeguardSettings(),
    db.outboundMessageEvent.groupBy({ by: ["typeKey", "transport", "decision"], where: today, _count: { _all: true } }),
    db.outboundMessageEvent.groupBy({ by: ["recipientKey", "transport", "recipientUserId"], where: { ...today, decision: "ALLOWED" }, _count: { _all: true }, orderBy: { _count: { recipientKey: "desc" } }, take: 10 }),
    db.outboundMessageEvent.groupBy({ by: ["reason"], where: { ...today, decision: { in: ["SUPPRESSED", "HELD", "RELEASED"] } }, _count: { _all: true } }),
    db.outboundMessageEvent.findMany({ where: { decision: { in: ["SUPPRESSED", "HELD"] } }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, createdAt: true, transport: true, typeKey: true, recipientKey: true, recipientUserId: true, reason: true, subject: true, decision: true } }),
    db.outboundSafeguardIncident.findMany({ where: { status: "ACTIVE", pausesSending: true }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.outboundSafeguardIncident.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
  ]);

  const typeRows = new Map<string, { typeKey: string; typeName: string; transport: string; sent: number; notSent: number; held: number }>();
  for (const row of byType) {
    const key = `${row.typeKey}|${row.transport}`;
    const entry = typeRows.get(key) ?? { typeKey: row.typeKey, typeName: typeName(row.typeKey), transport: row.transport, sent: 0, notSent: 0, held: 0 };
    if (row.decision === "ALLOWED") entry.sent += row._count._all;
    else if (row.decision === "HELD") entry.held += row._count._all;
    else if (row.decision === "SUPPRESSED") entry.notSent += row._count._all;
    typeRows.set(key, entry);
  }
  const names = await namesFor([...byRecipient.map((row) => row.recipientUserId ?? ""), ...recent.map((row) => row.recipientUserId ?? "")]);
  const display = (key: string, userId: string | null) => (userId && names.get(userId)) || maskRecipient(key);

  return {
    generatedAt: now.toISOString(),
    timeZone,
    since: since.toISOString(),
    settings,
    volumes: Array.from(typeRows.values()).sort((a, b) => b.sent + b.notSent + b.held - (a.sent + a.notSent + a.held)),
    topRecipients: byRecipient.map((row) => ({ recipient: display(row.recipientKey, row.recipientUserId), transport: row.transport, sent: row._count._all })),
    suppressedByReason: reasons
      .filter((row) => row.reason)
      .map((row) => ({ reason: String(row.reason), label: reasonLabel(row.reason), count: row._count._all }))
      .sort((a, b) => b.count - a.count),
    recentNotSent: recent.map((row) => ({
      id: row.id, createdAt: row.createdAt.toISOString(), transport: row.transport, typeName: typeName(row.typeKey),
      recipient: display(row.recipientKey, row.recipientUserId), reason: String(row.reason ?? ""), label: reasonLabel(row.reason),
      held: row.decision === "HELD", subject: row.subject,
    })),
    paused: paused.map(incidentView),
    incidents: incidents.map(incidentView),
    pausableTypes: NOTIFICATION_CATALOG.filter((entry) => isPausableTypeKey(entry.key) && entry.transports.some((transport) => transport !== "INBOX"))
      .map((entry) => ({ key: entry.key, name: entry.name })),
  };
}

/** Command's attention card: something paused, or the emergency stop on. */
export async function safeguardAttention(): Promise<{ emergencyStop: boolean; paused: number }> {
  const [settings, paused] = await Promise.all([
    readSafeguardSettings(),
    db.outboundSafeguardIncident.count({ where: { status: "ACTIVE", pausesSending: true } }),
  ]);
  return { emergencyStop: settings.emergencyStop.on, paused };
}
