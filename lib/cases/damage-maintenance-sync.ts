import "server-only";

import { MaintenanceSource, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getAppSettings } from "@/lib/settings";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { sendSms } from "@/lib/notifications/sms";
import { resolveAppUrl } from "@/lib/app-url";
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

    // ── Client side ────────────────────────────────────────────────────────
    if (input.clientId) {
      const client = await db.client
        .findUnique({ where: { id: input.clientId }, select: { email: true, phone: true, name: true } })
        .catch(() => null);
      const clientEmail = client?.email?.trim();
      if (clientEmail) {
        await sendEmailDetailed({
          to: [clientEmail],
          subject: `${settings.companyName} - Damage reported at ${input.propertyName}`,
          html: `
            <p>We reported damage at <strong>${escapeHtml(input.propertyName)}</strong> and have raised a repair for it.</p>
            <p><strong>${escapeHtml(input.title)}</strong></p>
            ${input.description ? `<p>${escapeHtml(input.description)}</p>` : ""}
            <p>We will keep you updated as the repair progresses.</p>
          `,
        }).catch((err) => logger.error({ err, caseId: input.caseId }, "CP-7: client damage email failed"));
      }
      const clientPhone = client?.phone?.trim();
      if (clientPhone) {
        await sendSms(
          clientPhone,
          `${settings.companyName}: damage reported at ${input.propertyName} - ${input.title}. A repair has been raised.`,
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
      await sendEmailDetailed({
        kind: "admin_alert",
        to: adminEmails,
        subject: `${settings.companyName} - Damage case + repair raised (${input.propertyName})`,
        html: `
          <p>A DAMAGE case was opened at <strong>${escapeHtml(input.propertyName)}</strong> and a maintenance item was created automatically.</p>
          <p><strong>${escapeHtml(input.title)}</strong>${input.severity ? ` (${escapeHtml(input.severity)})` : ""}</p>
          ${input.description ? `<p>${escapeHtml(input.description)}</p>` : ""}
          <p><a href="${caseUrl}">Open the case</a> · <a href="${maintenanceUrl}">Open the repair</a></p>
        `,
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
          `${settings.companyName}: CRITICAL damage at ${input.propertyName} - ${input.title}. Repair raised.`,
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
  caseRow: DamageCaseLike & { clientId?: string | null };
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
        // The damage is the client's loss even when a cleaner spotted it, and
        // CLIENT is the source that keeps it client-visible by default.
        source: MaintenanceSource.CLIENT,
        category: draft.category,
        title: draft.title,
        description: draft.description,
        priority: draft.priority,
        photoKeys: input.photoKeys && input.photoKeys.length > 0 ? (input.photoKeys as any) : undefined,
        clientVisible: true,
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
      clientId: input.caseRow.clientId ?? property?.clientId ?? null,
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
