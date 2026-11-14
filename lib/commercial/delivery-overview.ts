import "server-only";
/**
 * Delivery profiles screen data (board "Delivery profiles", 2026-11-16).
 * Reads only. One row per active client: the stored lists, the fallback the
 * send paths add (lib/commercial/delivery-model.ts), bounce-list marks from
 * the existing suppression list, and the last email to those addresses from
 * the sending log (OutboundMessageEvent, one row per address).
 */
import type { Session } from "next-auth";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { getOpsAccess } from "@/lib/rbac/ops-access";
import { isAdministrator } from "@/lib/rbac/access-evaluator";
import { isOpsSubject } from "@/lib/rbac/ops-policy";
import { MARKETING_OPT_OUT } from "@/lib/email/suppression";
import { SUPPRESSION_REASON_LABEL, isSuppressionReason } from "@/lib/notifications/safeguards/config";
import { listClientDeliveryProfiles, type ClientDeliveryProfile } from "./delivery-profiles";
import {
  deliveryProblems,
  deliveryRoute,
  routeAddresses,
  sendResultFor,
  type BounceMark,
  type DeliveryOverview,
  type DeliveryOverviewRow,
  type DeliveryProfileView,
  type LastSent,
  type RecentSend,
} from "./delivery-model";

const LAST_SENT_WINDOW_DAYS = 90;
const RECENT_SENDS = 20;

export type DeliveryEditDecision = { canEdit: true; reason: null } | { canEdit: false; reason: string };

/**
 * Who may change recipients: administrators, and operations managers whose
 * communications pack is at Manage (as the existing route allowed through
 * middleware). Never while impersonating. Read on every request.
 */
export async function deliveryEditDecision(session: Session): Promise<DeliveryEditDecision> {
  if (session.impersonation) return { canEdit: false, reason: "Recipients cannot be changed while testing as someone else." };
  const subject = { id: session.user.id, role: String(session.user.role), heldRoles: (session.user.heldRoles ?? [session.user.role]).map(String) };
  if (isAdministrator(subject)) return { canEdit: true, reason: null };
  if (!isOpsSubject(subject)) return { canEdit: false, reason: "Only administrators and operations managers can change recipients." };
  const levels = await getOpsAccess(subject);
  if (levels?.communications !== "manage") return { canEdit: false, reason: "Your access to Notifications is view only, so recipients are read only." };
  return { canEdit: true, reason: null };
}

async function bounceMarks(): Promise<Map<string, BounceMark>> {
  const rows = await db.emailSuppression.findMany({ where: { reason: { not: MARKETING_OPT_OUT } }, select: { email: true, reason: true, createdAt: true } });
  return new Map(rows.map((row) => [row.email.trim().toLowerCase(), { reason: row.reason, since: row.createdAt.toISOString() }]));
}

async function names(ids: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (!unique.length) return new Map();
  const users = await db.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, email: true } });
  return new Map(users.map((user) => [user.id, user.name || user.email || "Someone"]));
}

export function profileView(profile: ClientDeliveryProfile | null | undefined, people: Map<string, string>): DeliveryProfileView {
  return {
    reportRecipients: profile?.reportRecipients ?? [],
    invoiceRecipients: profile?.invoiceRecipients ?? [],
    autoSendReports: profile?.autoSendReports ?? false,
    autoSendInvoices: profile?.autoSendInvoices ?? false,
    updatedAt: profile?.updatedAt ?? null,
    updatedBy: profile?.updatedByUserId ? { id: profile.updatedByUserId, name: people.get(profile.updatedByUserId) ?? "Someone" } : null,
  };
}

async function lastSentByAddress(addresses: string[], now: Date): Promise<Map<string, NonNullable<LastSent>>> {
  if (!addresses.length) return new Map();
  const rows = await db.outboundMessageEvent.findMany({
    where: { transport: "EMAIL", recipientKey: { in: addresses }, createdAt: { gte: new Date(now.getTime() - LAST_SENT_WINDOW_DAYS * 86_400_000) } },
    orderBy: { createdAt: "desc" },
    distinct: ["recipientKey"],
    select: { recipientKey: true, createdAt: true, subject: true, decision: true, outcome: true },
  });
  return new Map(rows.map((row) => [row.recipientKey, { at: row.createdAt.toISOString(), subject: row.subject, address: row.recipientKey, result: sendResultFor(row.decision, row.outcome) }]));
}

export async function buildDeliveryOverview(session: Session, now = new Date()): Promise<DeliveryOverview> {
  const [clients, profiles, bounces, propertyCounts, portalUsers, settings, access] = await Promise.all([
    db.client.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
    listClientDeliveryProfiles(),
    bounceMarks(),
    db.property.groupBy({ by: ["clientId"], where: { isActive: true }, _count: { _all: true } }),
    db.user.findMany({ where: { role: Role.CLIENT, isActive: true, clientId: { not: null } }, select: { clientId: true, name: true, email: true } }),
    getAppSettings().catch(() => null),
    deliveryEditDecision(session),
  ]);
  const byClient = new Map(profiles.map((profile) => [profile.clientId, profile]));
  const people = await names(profiles.map((profile) => profile.updatedByUserId ?? ""));
  const routes = clients.map((client) => {
    const profile = byClient.get(client.id);
    return {
      client,
      profile,
      reports: deliveryRoute(profile?.reportRecipients ?? [], client.email, bounces),
      invoices: deliveryRoute(profile?.invoiceRecipients ?? [], client.email, bounces),
    };
  });
  const allAddresses = Array.from(new Set(routes.flatMap((row) => [...routeAddresses(row.reports), ...routeAddresses(row.invoices)])));
  const lastSent = await lastSentByAddress(allAddresses, now);
  const rows: DeliveryOverviewRow[] = routes.map(({ client, profile, reports, invoices }) => {
    const latest = [...routeAddresses(reports), ...routeAddresses(invoices)]
      .map((address) => lastSent.get(address))
      .filter((entry): entry is NonNullable<LastSent> => Boolean(entry))
      .sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
    return {
      client: {
        id: client.id,
        name: client.name,
        email: client.email,
        propertyCount: propertyCounts.find((row) => row.clientId === client.id)?._count._all ?? 0,
        portalUsers: portalUsers
          .filter((user) => user.clientId === client.id && user.email)
          .map((user) => ({ name: user.name || user.email!, email: user.email! })),
      },
      profile: profileView(profile, people),
      reports,
      invoices,
      problems: deliveryProblems(reports, invoices),
      lastSent: latest,
    };
  });
  return { rows, timeZone: settings?.timezone || "Australia/Sydney", canEdit: access.canEdit, readOnlyReason: access.reason };
}

function reasonWords(reason: string | null): string | null {
  if (!reason) return null;
  return isSuppressionReason(reason) ? SUPPRESSION_REASON_LABEL[reason] : reason;
}

/** The last emails to a client's report and invoice addresses, newest first. */
export async function recentClientSends(clientId: string): Promise<RecentSend[] | null> {
  const client = await db.client.findUnique({ where: { id: clientId }, select: { id: true, email: true } });
  if (!client) return null;
  const profile = (await listClientDeliveryProfiles()).find((row) => row.clientId === clientId);
  const empty = new Map<string, BounceMark>();
  const addresses = Array.from(new Set([
    ...routeAddresses(deliveryRoute(profile?.reportRecipients ?? [], client.email, empty)),
    ...routeAddresses(deliveryRoute(profile?.invoiceRecipients ?? [], client.email, empty)),
  ]));
  if (!addresses.length) return [];
  const rows = await db.outboundMessageEvent.findMany({
    where: { transport: "EMAIL", recipientKey: { in: addresses } },
    orderBy: { createdAt: "desc" },
    take: RECENT_SENDS,
    select: { id: true, createdAt: true, subject: true, recipientKey: true, decision: true, outcome: true, reason: true },
  });
  return rows.map((row) => ({
    id: row.id,
    at: row.createdAt.toISOString(),
    subject: row.subject,
    address: row.recipientKey,
    result: sendResultFor(row.decision, row.outcome),
    reason: row.decision === "SUPPRESSED" ? reasonWords(row.reason) : null,
  }));
}
