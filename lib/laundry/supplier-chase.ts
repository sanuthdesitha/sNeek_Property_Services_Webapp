import "server-only";
/**
 * "Chase supplier" (catalog `laundry.supplier_chase`): the preview the run
 * panel shows (draft, stored contact, which transports can be used and why
 * not, the cool-down) and the send. The send re-reads the run, re-applies the
 * Pipeline's exception rule and uses the supplier's STORED email / phone only,
 * through the shared external-recipient path (rate limits, one send per key,
 * audit with a masked address, the provider's truthful state).
 */
import { formatInTimeZone } from "date-fns-tz";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { sydneyTodayKey, SYDNEY_TZ } from "@/lib/time/sydney-range";
import {
  ExternalMessageError,
  externalTransportAvailability,
  idempotencyKeySchema,
  isValidExternalAddress,
  maskContact,
  sendExternalRecipientMessage,
  type ExternalMessageResult,
  type TransportAvailability,
} from "@/lib/notifications/external-recipient";
import { dayKeyOf, daysBetweenKeys, detectExceptions, latestBagCount, latestReadiness } from "./pipeline";
import { laundryTeamRequestKinds, type LaundryTeamRequestKind } from "./nudge-rules";
import { loadSupplierTeams, teamForRun } from "./partners";
import type { OfficeActorRole } from "@/lib/notifications/office-send-rules";
import {
  SUPPLIER_CHASE_COOL_DOWN_MINUTES,
  draftSupplierChase,
  supplierChaseBlockedReason,
  type SupplierChaseDraft,
  type SupplierChaseTransport,
} from "./supplier-chase-rules";

const AUDIT_ACTION = "LAUNDRY_SUPPLIER_CHASE_SENT";

export type SupplierChasePreview = {
  taskId: string;
  blockedReason: string | null;
  supplier: { id: string; name: string; email: string | null; phone: string | null } | null;
  draft: SupplierChaseDraft | null;
  transports: Record<SupplierChaseTransport, TransportAvailability>;
  lastChasedAt: string | null;
  nextAllowedAt: string | null;
};

export type SupplierChaseOutcome = ExternalMessageResult & { transport: SupplierChaseTransport; to: string };

async function loadRun(taskId: string) {
  return db.laundryTask.findUnique({
    where: { id: taskId },
    select: {
      id: true, jobId: true, status: true, pickupDate: true, dropoffDate: true, pickedUpAt: true, droppedAt: true, flagReason: true,
      supplier: { select: { id: true, name: true, email: true, phone: true, avgTurnaround: true } },
      property: { select: { name: true, suburb: true, accessInfo: true, laundryEnabled: true } },
      job: { select: { status: true } },
      confirmations: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { laundryReady: true, photoUrl: true, notes: true, createdAt: true } },
    },
  });
}

type ChaseRun = NonNullable<Awaited<ReturnType<typeof loadRun>>>;

async function pipelineSettings() {
  const settings = await getAppSettings();
  return {
    settings,
    pipeline: {
      maxOutdoorDays: settings.laundryOperations?.maxOutdoorDays ?? 3,
      requireDropoffPhoto: settings.laundryPortalVisibility?.requireDropoffPhoto === true,
    },
  };
}

/**
 * The team request the run calls for when its partner has no laundry portal
 * users who can see the property (then the chase stands in for it), else null.
 */
async function unansweredTeamRequest(run: ChaseRun, exceptions: ReturnType<typeof detectExceptions>, now: Date): Promise<LaundryTeamRequestKind | null> {
  if (!run.supplier) return null;
  const kinds = laundryTeamRequestKinds({
    status: run.status, pickupDate: run.pickupDate, dropoffDate: run.dropoffDate, exceptions,
    readiness: latestReadiness(run.confirmations), jobStatus: run.job?.status ?? null, hasJob: Boolean(run.jobId), hasSupplier: true,
  }, sydneyTodayKey(now));
  if (!kinds.length) return null;
  const team = teamForRun(await loadSupplierTeams([run.supplier.id]), run.supplier.id, run.property);
  return team.length ? null : kinds[0];
}

async function chaseContext(run: ChaseRun, pipeline: { maxOutdoorDays: number; requireDropoffPhoto: boolean }, now: Date) {
  const exceptions = detectExceptions(run, { todayKey: sydneyTodayKey(now), now, settings: pipeline });
  const unanswered = await unansweredTeamRequest(run, exceptions, now);
  const overTurnaround = exceptions.some((item) => item.code === "OVER_TURNAROUND");
  return {
    blockedReason: supplierChaseBlockedReason({ status: run.status, hasSupplier: Boolean(run.supplier), exceptions, unansweredTeamRequest: unanswered }),
    purpose: overTurnaround ? null : unanswered,
  };
}

function draftFor(run: ChaseRun, settings: { companyName: string; companyPhone?: string | null }, now: Date, purpose: LaundryTeamRequestKind | null): SupplierChaseDraft | null {
  if (!run.supplier) return null;
  const pickedKey = dayKeyOf(run.pickedUpAt ?? run.pickupDate);
  const days = pickedKey ? Math.max(0, daysBetweenKeys(pickedKey, sydneyTodayKey(now))) : 0;
  const pickedAt = run.pickedUpAt ?? run.pickupDate;
  return draftSupplierChase({
    supplierName: run.supplier.name,
    propertyName: run.property?.name ?? "the property",
    propertySuburb: run.property?.suburb ?? null,
    bagCount: latestBagCount(run.confirmations),
    daysAtLaundry: days,
    pickedUpLabel: formatInTimeZone(pickedAt, SYDNEY_TZ, "EEE d MMM"),
    turnaroundHours: run.supplier.avgTurnaround ?? null,
    officeName: settings.companyName,
    officePhone: settings.companyPhone || null,
    purpose,
  });
}

/** The most recent chase that reached a provider (or was a retry of one) inside the cool-down. */
async function lastTakenChase(taskId: string, now: Date) {
  const since = new Date(now.getTime() - SUPPLIER_CHASE_COOL_DOWN_MINUTES * 60_000);
  const rows = await db.auditLog.findMany({
    where: { action: AUDIT_ACTION, entity: "LaundryTask", entityId: taskId, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { createdAt: true, after: true },
  });
  return rows.find((row) => {
    const state = (row.after as { state?: unknown } | null)?.state;
    return state === "provider_accepted" || state === "already_requested";
  }) ?? null;
}

function transportsFor(
  supplier: ChaseRun["supplier"],
  providers: Record<SupplierChaseTransport, TransportAvailability>,
): Record<SupplierChaseTransport, TransportAvailability> {
  const email = supplier?.email?.trim() || null;
  const phone = supplier?.phone?.trim() || null;
  return {
    EMAIL: !email
      ? { available: false, reason: "The supplier has no email address recorded." }
      : !isValidExternalAddress("EMAIL", email)
        ? { available: false, reason: "The supplier's stored email address is not valid." }
        : providers.EMAIL,
    SMS: !phone
      ? { available: false, reason: "The supplier has no phone number recorded." }
      : !isValidExternalAddress("SMS", phone)
        ? { available: false, reason: "The supplier's stored phone number is not valid for SMS." }
        : providers.SMS,
  };
}

export async function loadSupplierChasePreview(taskId: string, now = new Date()): Promise<SupplierChasePreview | null> {
  const run = await loadRun(taskId);
  if (!run) return null;
  const [{ settings, pipeline }, providers, last] = await Promise.all([pipelineSettings(), externalTransportAvailability(), lastTakenChase(taskId, now)]);
  const context = await chaseContext(run, pipeline, now);
  return {
    taskId: run.id,
    blockedReason: context.blockedReason,
    supplier: run.supplier ? { id: run.supplier.id, name: run.supplier.name, email: run.supplier.email?.trim() || null, phone: run.supplier.phone?.trim() || null } : null,
    draft: draftFor(run, settings, now, context.purpose),
    transports: transportsFor(run.supplier, providers),
    lastChasedAt: last ? last.createdAt.toISOString() : null,
    nextAllowedAt: last ? new Date(last.createdAt.getTime() + SUPPLIER_CHASE_COOL_DOWN_MINUTES * 60_000).toISOString() : null,
  };
}

export const supplierChaseSchema = z.object({
  laundryTaskId: z.string().trim().min(1).max(200),
  transports: z.array(z.enum(["EMAIL", "SMS"])).min(1).max(2),
  body: z.string().trim().min(1).max(1000),
  subject: z.string().trim().min(1).max(200),
  idempotencyKey: idempotencyKeySchema,
}).strict();

/** Refuses a second chase inside the cool-down unless it is a retry of the same request. */
async function refuseWithinCoolDown(taskId: string, chaseKey: string, now: Date) {
  const last = await lastTakenChase(taskId, now);
  if (!last) return;
  if ((last.after as { chaseKey?: unknown } | null)?.chaseKey === chaseKey) return;
  const zone = (await getAppSettings().catch(() => null))?.timezone || SYDNEY_TZ;
  const at = formatInTimeZone(last.createdAt, zone, "HH:mm");
  const next = formatInTimeZone(new Date(last.createdAt.getTime() + SUPPLIER_CHASE_COOL_DOWN_MINUTES * 60_000), zone, "HH:mm");
  throw new ExternalMessageError(409, `The supplier was already chased at ${at}. You can chase again after ${next}.`);
}

/**
 * Sends the chase by each chosen transport to the supplier's stored contact.
 * ADMIN, or OPS_MANAGER with the Laundry pack at manage (route,
 * `office-send-rules.ts`); `actorRole` is the role that allowed it, kept on the
 * audit row.
 */
export async function sendSupplierChase(actorId: string, input: unknown, now = new Date(), actorRole: OfficeActorRole | null = null): Promise<{ outcomes: SupplierChaseOutcome[] }> {
  const request = supplierChaseSchema.parse(input);
  const run = await loadRun(request.laundryTaskId);
  if (!run) throw new ExternalMessageError(404, "Laundry run not found.");
  const [{ pipeline }, providers] = await Promise.all([pipelineSettings(), externalTransportAvailability()]);
  const { blockedReason: blocked } = await chaseContext(run, pipeline, now);
  if (blocked) throw new ExternalMessageError(409, blocked);
  const transports = transportsFor(run.supplier, providers);
  const chosen = Array.from(new Set(request.transports));
  for (const transport of chosen) {
    const state = transports[transport];
    if (!state.available) throw new ExternalMessageError(409, state.reason ?? "This transport cannot be used.");
  }
  await refuseWithinCoolDown(run.id, request.idempotencyKey, now);

  const outcomes: SupplierChaseOutcome[] = [];
  for (const transport of chosen) {
    const to = (transport === "EMAIL" ? run.supplier?.email : run.supplier?.phone)?.trim() ?? "";
    const sent = await sendExternalRecipientMessage({
      kind: "laundry.supplier_chase",
      actorId,
      entityId: run.id,
      jobId: run.jobId,
      transport,
      to,
      subject: request.subject,
      body: request.body,
      idempotencyKey: `${request.idempotencyKey}:${transport}`,
      audit: { chaseKey: request.idempotencyKey, supplierId: run.supplier?.id ?? null, actorRole },
      now,
    });
    outcomes.push({ transport, state: sent.state, errorCode: sent.errorCode, to: maskContact(to) });
  }
  return { outcomes };
}
