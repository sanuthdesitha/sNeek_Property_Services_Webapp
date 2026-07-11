/**
 * Personal QA-mistake aggregation — "watch-outs" for a cleaner.
 *
 * Reads two existing signals (no schema changes) over a rolling window and
 * ranks the cleaner's most recurring quality misses so they can be surfaced in
 * the daily briefing (and, later, an admin view):
 *
 *   1. QAReview.flags — arrays of failed form-field ids on the cleaner's jobs.
 *   2. QaReworkTransfer.reason — admin/QA-confirmed reworks attributed to the
 *      cleaner (cleanerUserId), each a concrete miss the QA had to redo.
 *
 * Flagged field ids are resolved to human labels via ChecklistModuleItem (whose
 * `key` doubles as the generated form-field id) when a cheap lookup hits, else
 * the id is prettified ("kitchen.benchtops" → "Kitchen · benchtops").
 *
 * Every query is wrapped so a schema/relation issue degrades to an empty result
 * instead of throwing — the briefing must never fail because of this section.
 */
import { db } from "@/lib/db";
import type { BriefingMistake, CleanerMistakeAggregate } from "@/lib/briefing/types";

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[mistakes] query failed:", err instanceof Error ? err.message : err);
    }
    return fallback;
  }
}

/** Prettify a form-field id into a readable label. */
export function prettifyFieldId(raw: string): string {
  const cleaned = String(raw || "").trim();
  if (!cleaned) return "Item";
  // Split "kitchen.benchtops" / "kitchen_benchtops" / "kitchen-benchtops".
  const parts = cleaned.split(/[.\-_/]+/).filter(Boolean);
  const words = parts
    .map((part) => part.replace(/([a-z])([A-Z])/g, "$1 $2")) // camelCase → words
    .join(" · ")
    .split(" ")
    .map((w) => (w.length > 2 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** One-line coaching advice keyed off the mistake label (best-effort heuristics). */
function adviceFor(label: string): string {
  const l = label.toLowerCase();
  if (/(photo|image|evidence)/.test(l)) return "Capture clear before/after photos before you leave.";
  if (/(bath|shower|toilet|tap|sink|grout|mould)/.test(l)) return "Give wet areas an extra wipe — QA checks these first.";
  if (/(kitchen|bench|stove|oven|fridge|microwave|dish)/.test(l)) return "Double-check surfaces and appliance interiors.";
  if (/(floor|vacuum|mop|carpet)/.test(l)) return "Do a final floor pass, corners and edges included.";
  if (/(bin|rubbish|trash|waste)/.test(l)) return "Empty and reline every bin, then re-check.";
  if (/(bed|linen|sheet|towel|laundry)/.test(l)) return "Confirm fresh linen is set and presented neatly.";
  if (/(window|glass|mirror|balcony|outdoor)/.test(l)) return "Wipe glass and don't skip the balcony/outdoor items.";
  if (/(dust|surface|skirting|shelf)/.test(l)) return "Run a dust check on high and low surfaces.";
  return "Slow down here on your final walk-through.";
}

/**
 * Aggregate the cleaner's recurring QA mistakes over the last `windowDays`.
 * Returns the top 3–5 items with counts + advice, plus the full aggregate shape.
 */
export async function getCleanerCommonMistakes(
  cleanerId: string,
  windowDays = 90
): Promise<CleanerMistakeAggregate> {
  const empty: CleanerMistakeAggregate = {
    cleanerId,
    windowDays,
    sampleSize: 0,
    items: [],
  };
  if (!cleanerId) return empty;

  const windowStart = new Date(Date.now() - windowDays * 86_400_000);

  // The cleaner's jobs in-window (active assignments only), so QA reviews can be
  // attributed to them. Reviews don't carry a cleanerId, so we scope by job.
  const jobs = await safe(
    db.job.findMany({
      where: {
        assignments: { some: { userId: cleanerId, removedAt: null } },
        scheduledDate: { gte: windowStart },
      },
      select: { id: true },
    }),
    [] as Array<{ id: string }>
  );
  const jobIds = jobs.map((j) => j.id);

  const [reviews, transfers] = await Promise.all([
    jobIds.length
      ? safe(
          db.qAReview.findMany({
            where: { jobId: { in: jobIds }, createdAt: { gte: windowStart } },
            select: { flags: true },
          }),
          [] as Array<{ flags: unknown }>
        )
      : Promise.resolve([] as Array<{ flags: unknown }>),
    safe(
      db.qaReworkTransfer.findMany({
        where: {
          cleanerUserId: cleanerId,
          affectsCleanerStats: true,
          status: { in: ["PENDING", "APPROVED"] },
          createdAt: { gte: windowStart },
        },
        select: { reason: true },
      }),
      [] as Array<{ reason: string | null }>
    ),
  ]);

  // Tally flagged field ids.
  const counts = new Map<string, number>();
  const rawIds = new Set<string>();
  for (const review of reviews) {
    const flags = review.flags;
    if (!Array.isArray(flags)) continue;
    for (const raw of flags) {
      if (typeof raw !== "string") continue;
      const id = raw.trim();
      if (!id) continue;
      rawIds.add(id);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }

  // Rework reasons — count each distinct reason string as its own miss.
  for (const t of transfers) {
    const reason = (t.reason || "").trim();
    if (!reason) continue;
    const key = `reason:${reason.slice(0, 80).toLowerCase()}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  // Resolve field ids → labels via the checklist library (key === field id).
  const labelById = new Map<string, string>();
  if (rawIds.size > 0) {
    const items = await safe(
      db.checklistModuleItem.findMany({
        where: { key: { in: Array.from(rawIds) } },
        select: { key: true, label: true },
      }),
      [] as Array<{ key: string; label: string }>
    );
    for (const item of items) {
      if (item.key && item.label) labelById.set(item.key, item.label);
    }
  }

  const ranked = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map<BriefingMistake>(([key, count]) => {
      let label: string;
      if (key.startsWith("reason:")) {
        // Recover the original-cased reason from the first matching transfer.
        const match = transfers.find(
          (t) => `reason:${(t.reason || "").trim().slice(0, 80).toLowerCase()}` === key
        );
        const reason = (match?.reason || "").trim();
        label = reason.length > 60 ? `${reason.slice(0, 57)}…` : reason || "Rework noted";
      } else {
        label = labelById.get(key) ?? prettifyFieldId(key);
      }
      return { label, count, advice: adviceFor(label) };
    });

  return {
    cleanerId,
    windowDays,
    sampleSize: reviews.length + transfers.length,
    items: ranked,
  };
}
