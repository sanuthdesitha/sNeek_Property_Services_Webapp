/**
 * Pure half of location ingest: request parsing, clock-skew correction and
 * the reason every refused fix is dropped for. No Prisma, unit-tested.
 *
 * Clock skew. A phone's clock can be minutes out. Each batch carries `sentAt`
 * (the phone's clock when it sent); the server's receive time minus `sentAt`
 * is the phone's offset, and every fix's timestamp is corrected by it. A
 * phone five minutes slow used to lose every fix (each looked five minutes
 * old and was dropped with a 200 the client cleared on).
 *
 * Backlog. Fixes queued while offline are accepted as HISTORY (up to the start
 * of the person's tracking day) and never as live: freshness is always judged
 * from the corrected measured time, so a backlog never paints a live dot.
 */
import { z } from "zod";
import { LOCATION_LIVE_MS, isTrackingState, type TrackingState } from "./staleness";

/** A fix claiming to be taken later than this after receipt is refused. */
export const FUTURE_TOLERANCE_MS = 2 * 60_000;
/** An offset beyond this means the phone clock cannot be trusted at all. */
export const MAX_TRUSTED_OFFSET_MS = 24 * 60 * 60_000;
/** Oldest backlog accepted, regardless of the window start. */
export const MAX_BACKLOG_MS = 14 * 60 * 60_000;
/** Most fixes accepted in one request (unchanged from the old contract). */
export const MAX_BATCH = 50;

export const DROP_REASONS = [
  "INVALID",
  "TOO_OLD",
  "FUTURE",
  "CLOCK_UNTRUSTED",
  "OUTSIDE_WINDOW",
  "NOT_ASSIGNED",
  "DUPLICATE",
  "IMPERSONATING",
] as const;
export type DropReason = (typeof DROP_REASONS)[number];
export type DropCounts = Partial<Record<DropReason, number>>;

const fixSchema = z.object({
  clientId: z.string().trim().min(1).max(80).optional(),
  jobId: z.string().trim().min(1).max(64).optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().nonnegative().max(1_000_000).optional().nullable(),
  heading: z.number().optional().nullable(),
  speed: z.number().optional().nullable(),
  timestamp: z.string().datetime().optional(),
});

const stateSchema = z.object({
  state: z.string().refine(isTrackingState, "Unknown tracking state"),
  at: z.string().datetime().optional(),
});

const envelopeSchema = z.object({
  sentAt: z.string().datetime().optional(),
  pings: z.array(fixSchema).max(MAX_BATCH).default([]),
  state: stateSchema.optional(),
});

export type IncomingFix = z.infer<typeof fixSchema>;

export type ParsedBatch = {
  sentAt: Date | null;
  fixes: IncomingFix[];
  state: { state: TrackingState; at: Date | null } | null;
};

/**
 * Accepts the current envelope `{ sentAt, pings, state }` and, for older
 * clients still in the field, a single fix or a bare array of fixes.
 */
export function parseLocationBatch(body: unknown): { ok: true; batch: ParsedBatch } | { ok: false; error: string } {
  if (Array.isArray(body)) {
    const parsed = z.array(fixSchema).max(MAX_BATCH).safeParse(body);
    return parsed.success ? { ok: true, batch: { sentAt: null, fixes: parsed.data, state: null } } : { ok: false, error: "Invalid input" };
  }
  if (body && typeof body === "object" && ("pings" in body || "state" in body || "sentAt" in body)) {
    const parsed = envelopeSchema.safeParse(body);
    if (!parsed.success) return { ok: false, error: "Invalid input" };
    const state = parsed.data.state
      ? { state: parsed.data.state.state as TrackingState, at: parsed.data.state.at ? new Date(parsed.data.state.at) : null }
      : null;
    return {
      ok: true,
      batch: { sentAt: parsed.data.sentAt ? new Date(parsed.data.sentAt) : null, fixes: parsed.data.pings, state },
    };
  }
  const single = fixSchema.safeParse(body);
  return single.success ? { ok: true, batch: { sentAt: null, fixes: [single.data], state: null } } : { ok: false, error: "Invalid input" };
}

/** Receive time minus the phone's send time; 0 when unknown; null when untrustworthy. */
export function clockOffsetMs(sentAt: Date | null, receivedAt: Date): number | null {
  if (!sentAt || !Number.isFinite(sentAt.getTime())) return 0;
  const offset = receivedAt.getTime() - sentAt.getTime();
  return Math.abs(offset) > MAX_TRUSTED_OFFSET_MS ? null : offset;
}

export type CorrectedFix = IncomingFix & { measuredAt: Date };

export function addDrop(counts: DropCounts, reason: DropReason, n = 1): DropCounts {
  if (n > 0) counts[reason] = (counts[reason] ?? 0) + n;
  return counts;
}

/**
 * Correct each fix's time by the phone's clock offset and drop what cannot be
 * stored: from the future, older than the window start (or the backlog cap),
 * or from a phone whose clock is untrustworthy. A fix without a timestamp is
 * taken as measured at receipt (older clients).
 */
export function correctFixes(
  fixes: IncomingFix[],
  input: { sentAt: Date | null; receivedAt: Date; notBefore: Date },
): { accepted: CorrectedFix[]; dropped: DropCounts } {
  const dropped: DropCounts = {};
  const offset = clockOffsetMs(input.sentAt, input.receivedAt);
  if (offset === null) return { accepted: [], dropped: addDrop(dropped, "CLOCK_UNTRUSTED", fixes.length) };
  const received = input.receivedAt.getTime();
  const floor = Math.max(input.notBefore.getTime(), received - MAX_BACKLOG_MS);
  const accepted: CorrectedFix[] = [];
  for (const fix of fixes) {
    const raw = fix.timestamp ? Date.parse(fix.timestamp) : received;
    if (!Number.isFinite(raw)) {
      addDrop(dropped, "INVALID");
      continue;
    }
    const measured = fix.timestamp ? raw + offset : raw;
    if (measured > received + FUTURE_TOLERANCE_MS) {
      addDrop(dropped, "FUTURE");
      continue;
    }
    if (measured < floor) {
      addDrop(dropped, "TOO_OLD");
      continue;
    }
    accepted.push({ ...fix, measuredAt: new Date(Math.min(measured, received)) });
  }
  accepted.sort((a, b) => a.measuredAt.getTime() - b.measuredAt.getTime());
  return { accepted, dropped };
}

/** A fix is live (may drive arrival/departure and live views) only if recent when received. */
export function isLiveFix(measuredAt: Date, receivedAt: Date): boolean {
  return receivedAt.getTime() - measuredAt.getTime() <= LOCATION_LIVE_MS;
}

export function mergeDrops(target: DropCounts, source: DropCounts): DropCounts {
  for (const reason of DROP_REASONS) addDrop(target, reason, source[reason] ?? 0);
  return target;
}

export function totalDropped(counts: DropCounts): number {
  return Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0);
}
