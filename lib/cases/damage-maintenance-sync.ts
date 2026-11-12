import "server-only";

import { MaintenanceSource, Role, type Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getAppSettings } from "@/lib/settings";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { sendSms } from "@/lib/notifications/sms";
import { resolveAppUrl } from "@/lib/app-url";
import { loadNotificationWording } from "@/lib/notifications/wording/render";
import {
  buildMaintenanceDraftFromCase,
  caseStatusForMaintenanceStatus,
  isMeaningfulChange,
  maintenanceStatusForCaseStatus,
  shouldAutoCreateMaintenance,
  type DamageCaseLike,
} from "@/lib/cases/damage-maintenance";

/**
 * CP-7 orchestration: turn a DAMAGE case into a repair, tell the people who
 * need to know, and keep the two records agreeing afterwards.
 *
 * EVERY function here is best-effort by contract. Reporting damage must never
 * fail because the repair could not be raised or an SMS bounced — a lost
 * automation is an inconvenience, a lost damage report is a dispute with a
 * client. All of them swallow and log rather than throw.
 *
 * The rules themselves (which cases qualify, how statuses map) are pure and
 * live in ./damage-maintenance so they can be tested without a database.
 */

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** SMS carries only the headline; email carries the detail. */
async function notifyDamageMaintenance(input: {
  caseId: string;
  itemId: string;
  propertyName: string;
  clientId: string | null;
  title: string;
  description: string | null;
  severity: string | null;
}): Promise<void> {
  try {
    const settings = await getAppSettings();
    const caseUrl = resolveAppUrl(`/v2/admin/cases/${input.caseId}`);
    const maintenanceUrl = resolveAppUrl(`/v2/admin/maintenance/${input.itemId}`);

    const wording = await loadNotificationWording("office.field_alerts");
    const damageValues = {
      companyName: settings.companyName,
      propertyName: input.propertyName,
      title: input.title,
      descriptionParagraph: wording.line("description-paragraph", "EMAIL", { description: input.description }, Boolean(input.description)),
      severitySuffix: wording.line("severity-suffix", "EMAIL", { severity: input.severity }, Boolean(input.severity)),
      caseUrl,
      maintenanceUrl,
    };
    // ── Client side ────────────────────────────────────────────────────────
    if (input.clientId) {
      const client = await db.client
        .findUnique({ where: { id: input.clientId }, select: { email: true, phone: true, name: true } })
        .catch(() => null);
      const clientEmail = client?.email?.trim();
      if (clientEmail) {
        const clientEmailText = wording.render("damage-client", "EMAIL", damageValues);
        await sendEmailDetailed({
          to: [clientEmail],
          subject: clientEmailText.subject,
          html: clientEmailText.html,
        }).catch((err) => logger.error({ err, caseId: input.caseId }, "CP-7: client damage email failed"));
      }
      const clientPhone = client?.phone?.trim();
      if (clientPhone) {
        await sendSms(
          clientPhone,
          wording.render("damage-client", "SMS", damageValues).body,
          "CLIENT"
        ).catch((err) => logger.error({ err, caseId: input.caseId }, "CP-7: client damage SMS failed"));
      }
    }

    // ── Admin side ─────────────────────────────────────────────────────────
    const admins = await db.user
      .findMany({
        where: { role: { in: [Role.ADMIN, Role.OPS_MANAGER] }, isActive: true },
        select: { email: true, phone: true },
        take: 20,
      })
      .catch(() => []);
    const adminEmails = admins
      .map((a) => a.email?.trim())
      .filter((value): value is string => Boolean(value));
    if (adminEmails.length > 0) {
      const officeEmail = wording.render("damage-office", "EMAIL", damageValues);
      await sendEmailDetailed({
        kind: "admin_alert",
        to: adminEmails,
        subject: officeEmail.subject,
        html: officeEmail.html,
      }).catch((err) => logger.error({ err, caseId: input.caseId }, "CP-7: admin damage email failed"));
    }
    // Admin SMS is reserved for the urgent end — a text per damage report would
    // train everyone to ignore them.
    if (String(input.severity ?? "").trim().toUpperCase() === "CRITICAL") {
      for (const admin of admins) {
        const phone = admin.phone?.trim();
        if (!phone) continue;
        await sendSms(
          phone,
          wording.render("damage-critical", "SMS", damageValues).body,
          "STAFF_ADMIN"
        ).catch((err) => logger.error({ err, caseId: input.caseId }, "CP-7: admin damage SMS failed"));
      }
    }
  } catch (err) {
    logger.error({ err, caseId: input.caseId }, "CP-7: damage notification failed");
  }
}

/**
 * Raise the repair for a freshly-created DAMAGE case, then notify.
 * No-op for cases that do not qualify, and for a case that already has one.
 */
export async function autoCreateMaintenanceForDamageCase(input: {
  caseRow: DamageCaseLike & { clientId?: string | null; clientVisible?: boolean };
  reportedByUserId: string;
  jobId?: string | null;
  photoKeys?: string[];
}): Promise<string | null> {
  try {
    if (!shouldAutoCreateMaintenance(input.caseRow)) return null;
    const propertyId = String(input.caseRow.propertyId ?? "").trim();
    if (!propertyId) return null;

    const existing = await db.propertyMaintenanceItem.findFirst({
      where: { caseId: input.caseRow.id },
      select: { id: true },
    });
    if (existing) return existing.id;

    const draft = buildMaintenanceDraftFromCase(input.caseRow);
    const created = await db.propertyMaintenanceItem.create({
      data: {
        propertyId,
        caseId: input.caseRow.id,
        jobId: input.jobId?.trim() || undefined,
        reportedByUserId: input.reportedByUserId,
        // A private damage review must not become public through its repair.
        source: input.caseRow.clientVisible === true ? MaintenanceSource.CLIENT : MaintenanceSource.CLEANER,
        category: draft.category,
        title: draft.title,
        description: draft.description,
        priority: draft.priority,
        photoKeys: input.photoKeys && input.photoKeys.length > 0 ? (input.photoKeys as any) : undefined,
        clientVisible: input.caseRow.clientVisible === true,
      },
      select: { id: true },
    });

    const property = await db.property
      .findUnique({ where: { id: propertyId }, select: { name: true, clientId: true } })
      .catch(() => null);

    await notifyDamageMaintenance({
      caseId: input.caseRow.id,
      itemId: created.id,
      propertyName: property?.name ?? "the property",
      clientId: input.caseRow.clientVisible === true ? input.caseRow.clientId ?? property?.clientId ?? null : null,
      title: draft.title,
      description: draft.description,
      severity: input.caseRow.severity ?? null,
    });

    return created.id;
  } catch (err) {
    logger.error({ err, caseId: input.caseRow.id }, "CP-7: could not auto-create maintenance for damage case");
    return null;
  }
}

/** Case status changed → carry it to the linked repair(s). */
export async function syncMaintenanceFromCase(input: {
  caseId: string;
  status: string | null | undefined;
}): Promise<void> {
  try {
    const next = maintenanceStatusForCaseStatus(input.status);
    if (!next) return;
    const items = await db.propertyMaintenanceItem.findMany({
      where: { caseId: input.caseId },
      select: { id: true, status: true },
    });
    for (const item of items) {
      if (!isMeaningfulChange(item.status, next)) continue;
      await db.propertyMaintenanceItem.update({
        where: { id: item.id },
        data: {
          status: next,
          ...(next === "RESOLVED" ? { resolvedAt: new Date() } : {}),
        },
      });
    }
  } catch (err) {
    logger.error({ err, caseId: input.caseId }, "CP-7: could not sync maintenance from case");
  }
}

/** Repair status changed → carry it back to the case that spawned it. */
export async function syncCaseFromMaintenance(input: {
  itemId: string;
  status: string | null | undefined;
}): Promise<void> {
  try {
    const next = caseStatusForMaintenanceStatus(input.status);
    if (!next) return;
    const item = await db.propertyMaintenanceItem.findUnique({
      where: { id: input.itemId },
      select: { caseId: true },
    });
    if (!item?.caseId) return;
    const caseRow = await db.issueTicket.findUnique({
      where: { id: item.caseId },
      select: { id: true, status: true },
    });
    if (!caseRow) return;
    if (!isMeaningfulChange(caseRow.status, next)) return;
    await db.issueTicket.update({ where: { id: caseRow.id }, data: { status: next } });
  } catch (err) {
    logger.error({ err, itemId: input.itemId }, "CP-7: could not sync case from maintenance");
  }
}


/** Mandatory repair creation alongside a new transactional damage case. No
 * communications here, and private damage must stay private in maintenance. */
export async function createDamageMaintenanceInTransaction(tx: Prisma.TransactionClient, input: {
  caseRow: DamageCaseLike & { clientVisible?: boolean }; reportedByUserId: string; jobId?: string | null; photoKeys?: string[];
}): Promise<string | null> {
  if (!shouldAutoCreateMaintenance(input.caseRow)) return null;
  const existing = await tx.propertyMaintenanceItem.findFirst({ where: { caseId: input.caseRow.id }, select: { id: true } });
  if (existing) return existing.id;
  const draft = buildMaintenanceDraftFromCase(input.caseRow);
  const item = await tx.propertyMaintenanceItem.create({ data: {
    propertyId: String(input.caseRow.propertyId), caseId: input.caseRow.id,
    jobId: input.jobId || undefined, reportedByUserId: input.reportedByUserId,
    source: input.caseRow.clientVisible === true ? MaintenanceSource.CLIENT : MaintenanceSource.CLEANER,
    category: draft.category, title: draft.title, description: draft.description, priority: draft.priority,
    photoKeys: input.photoKeys?.length ? input.photoKeys : undefined,
    clientVisible: input.caseRow.clientVisible === true,
  }, select: { id: true } });
  return item.id;
}
