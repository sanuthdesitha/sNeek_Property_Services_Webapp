import { sydneyDateKey, sydneyDayEndInclusive } from "@/lib/time/sydney-range";

/**
 * Laundry-team accountability stats (pure).
 *
 * Actor attribution: LaundryTask itself has no actor columns, but every status
 * transition (POST /api/laundry/[taskId]/status) writes a LaundryConfirmation
 * with `confirmedById` = the acting user and an `event` discriminator
 * ("PICKED_UP" / "DROPPED" / reverts / …) inside its JSON `notes`. We therefore
 * attribute each task's pickup/drop to the LATEST confirmation of that event
 * kind (reverts create newer events, so the latest one reflects who actually
 * completed the step). Stuck PENDING/CONFIRMED tasks have no actor yet and are
 * counted at team level only (`teamTotals.stuckUnattributed`).
 */

export const STUCK_STATUSES = ["PENDING", "CONFIRMED", "PICKED_UP"] as const;
export const STUCK_THRESHOLD_MS = 48 * 60 * 60 * 1000;

export type LaundryTaskLite = {
  id: string;
  status: string;
  pickupDate: Date;
  dropoffDate: Date;
  pickedUpAt: Date | null;
  droppedAt: Date | null;
};

export type LaundryConfirmationLite = {
  laundryTaskId: string;
  confirmedById: string;
  photoUrl: string | null;
  s3Key: string | null;
  /** JSON payload with an `event` field, as written by the status route. */
  notes: string | null;
  createdAt: Date;
};

export type LaundryUserStats = {
  userId: string;
  pickups: number;
  drops: number;
  /** % of counted drops with droppedAt ≤ Sydney end-of-day of dropoffDate. Null when no drops. */
  onTimeDropPct: number | null;
  /** % of counted drops whose drop confirmation carried a photo. Null when no drops. */
  photoCompliancePct: number | null;
  /** Mean pickup→drop cycle in days (1 dp). Null when no measurable drops. */
  avgCycleDays: number | null;
  /** Open tasks attributable to this user (PICKED_UP > 48h ago) at `now`. */
  stuckCount: number;
};

export type LaundryTeamTotals = Omit<LaundryUserStats, "userId"> & {
  /** Stuck PENDING/CONFIRMED tasks with no acting user yet. */
  stuckUnattributed: number;
};

export type LaundryTeamStats = {
  perUser: LaundryUserStats[];
  teamTotals: LaundryTeamTotals;
};

export type ComputeLaundryTeamStatsInput = {
  tasks: LaundryTaskLite[];
  confirmations: LaundryConfirmationLite[];
  rangeStart: Date;
  rangeEnd: Date;
  now: Date;
  /** Users to always include (zero-activity rows), e.g. the active LAUNDRY roster. */
  userIds?: string[];
};

function eventOf(c: LaundryConfirmationLite): string | null {
  if (!c.notes) return null;
  try {
    const parsed = JSON.parse(c.notes);
    return parsed && typeof parsed === "object" && typeof parsed.event === "string" ? parsed.event : null;
  } catch {
    return null;
  }
}

function pct(hits: number, total: number): number | null {
  return total > 0 ? Math.round((hits / total) * 100) : null;
}

type Acc = {
  pickups: number;
  drops: number;
  onTimeDrops: number;
  photoDrops: number;
  cycleSumDays: number;
  cycleN: number;
  stuckCount: number;
};

function emptyAcc(): Acc {
  return { pickups: 0, drops: 0, onTimeDrops: 0, photoDrops: 0, cycleSumDays: 0, cycleN: 0, stuckCount: 0 };
}

function finalize(a: Acc): Omit<LaundryUserStats, "userId"> {
  return {
    pickups: a.pickups,
    drops: a.drops,
    onTimeDropPct: pct(a.onTimeDrops, a.drops),
    photoCompliancePct: pct(a.photoDrops, a.drops),
    avgCycleDays: a.cycleN > 0 ? Math.round((a.cycleSumDays / a.cycleN) * 10) / 10 : null,
    stuckCount: a.stuckCount,
  };
}

export function computeLaundryTeamStats({
  tasks,
  confirmations,
  rangeStart,
  rangeEnd,
  now,
  userIds = [],
}: ComputeLaundryTeamStatsInput): LaundryTeamStats {
  // Latest PICKED_UP / DROPPED confirmation per task (actor + drop photo).
  const latestPickup = new Map<string, LaundryConfirmationLite>();
  const latestDrop = new Map<string, LaundryConfirmationLite>();
  for (const c of confirmations) {
    const event = eventOf(c);
    const bucket = event === "PICKED_UP" ? latestPickup : event === "DROPPED" ? latestDrop : null;
    if (!bucket) continue;
    const cur = bucket.get(c.laundryTaskId);
    if (!cur || c.createdAt > cur.createdAt) bucket.set(c.laundryTaskId, c);
  }

  const perUser = new Map<string, Acc>();
  for (const id of userIds) perUser.set(id, emptyAcc());
  const accFor = (userId: string): Acc => {
    let acc = perUser.get(userId);
    if (!acc) {
      acc = emptyAcc();
      perUser.set(userId, acc);
    }
    return acc;
  };
  const team = emptyAcc();
  let stuckUnattributed = 0;

  const inRange = (d: Date | null): d is Date => d != null && d >= rangeStart && d <= rangeEnd;

  for (const task of tasks) {
    const pickupActor = latestPickup.get(task.id)?.confirmedById ?? null;
    const dropConf = latestDrop.get(task.id) ?? null;

    // Pickups in period.
    if (inRange(task.pickedUpAt)) {
      team.pickups += 1;
      if (pickupActor) accFor(pickupActor).pickups += 1;
    }

    // Drops in period (on-time, photo, cycle).
    if (task.status === "DROPPED" && inRange(task.droppedAt)) {
      const onTime = task.droppedAt <= sydneyDayEndInclusive(sydneyDateKey(task.dropoffDate));
      const hasPhoto = Boolean(dropConf?.photoUrl || dropConf?.s3Key);
      const cycleDays =
        task.pickedUpAt && task.droppedAt >= task.pickedUpAt
          ? (task.droppedAt.getTime() - task.pickedUpAt.getTime()) / (24 * 60 * 60 * 1000)
          : null;
      const targets = [team];
      const dropActor = dropConf?.confirmedById ?? null;
      if (dropActor) targets.push(accFor(dropActor));
      for (const acc of targets) {
        acc.drops += 1;
        if (onTime) acc.onTimeDrops += 1;
        if (hasPhoto) acc.photoDrops += 1;
        if (cycleDays != null) {
          acc.cycleSumDays += cycleDays;
          acc.cycleN += 1;
        }
      }
    }

    // Stuck detection (at `now`, independent of the period window).
    if ((STUCK_STATUSES as readonly string[]).includes(task.status)) {
      const anchor = task.status === "PICKED_UP" ? task.pickedUpAt ?? task.pickupDate : task.pickupDate;
      if (now.getTime() - anchor.getTime() > STUCK_THRESHOLD_MS) {
        team.stuckCount += 1;
        if (task.status === "PICKED_UP" && pickupActor) accFor(pickupActor).stuckCount += 1;
        else stuckUnattributed += 1;
      }
    }
  }

  return {
    perUser: Array.from(perUser.entries()).map(([userId, acc]) => ({ userId, ...finalize(acc) })),
    teamTotals: { ...finalize(team), stuckUnattributed },
  };
}
