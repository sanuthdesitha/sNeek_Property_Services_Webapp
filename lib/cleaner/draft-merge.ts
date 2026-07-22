/**
 * Shared cleaner job-draft merging.
 *
 * The job draft is ONE envelope per job (shared across devices + co-cleaners),
 * so a naive whole-envelope replace loses work: two cleaners editing, or a
 * device restoring a stale local mirror, can clobber uploads that already
 * reached S3. Media loss is the worst outcome (the file exists but the draft
 * forgot it), so uploads are ALWAYS unioned by storage key and never dropped.
 *
 * Merge rules (newer = larger `state.updatedAt`):
 *  - uploads / media arrays: UNION by `key` (older first, then unseen newer).
 *  - answers: per-key last-write-wins from the newer state; keys only present
 *    in the older state survive.
 *  - taskDrafts: per task — newer decision/note wins, `proof` unioned.
 *  - laundry / carryForward: newer scalar fields win, photo arrays unioned.
 */

type AnyRec = Record<string, any>;

function ts(state: AnyRec | null | undefined): number {
  const raw = state?.updatedAt;
  const n = raw ? Date.parse(String(raw)) : NaN;
  return Number.isFinite(n) ? n : 0;
}

/** Union two media arrays by `key`, preserving first-seen order. */
export function unionMedia(a: unknown, b: unknown): any[] {
  const out: any[] = [];
  const seen = new Set<string>();
  for (const list of [a, b]) {
    if (!Array.isArray(list)) continue;
    for (const m of list) {
      if (!m || typeof m !== "object") continue;
      const key = typeof (m as AnyRec).key === "string" ? (m as AnyRec).key : "";
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(m);
    }
  }
  return out;
}

function mergeUploadMaps(older: AnyRec, newer: AnyRec): AnyRec {
  const out: AnyRec = {};
  const fieldIds = Array.from(new Set(Object.keys(older ?? {}).concat(Object.keys(newer ?? {}))));
  for (const fieldId of fieldIds) {
    out[fieldId] = unionMedia(older?.[fieldId], newer?.[fieldId]);
  }
  return out;
}

function mergeTaskDrafts(older: AnyRec, newer: AnyRec): AnyRec {
  const out: AnyRec = {};
  const ids = Array.from(new Set(Object.keys(older ?? {}).concat(Object.keys(newer ?? {}))));
  for (const id of ids) {
    const o = older?.[id] ?? {};
    const n = newer?.[id] ?? {};
    out[id] = {
      // Newer wins for the decision/note, but never downgrade a real decision
      // back to OPEN just because the newer device hadn't touched this task.
      decision: n.decision && n.decision !== "OPEN" ? n.decision : o.decision ?? n.decision ?? "OPEN",
      note: typeof n.note === "string" && n.note ? n.note : (o.note ?? ""),
      proof: unionMedia(o.proof, n.proof),
    };
  }
  return out;
}

/**
 * Merge two draft states. Order-independent for media (always unioned); scalar
 * conflicts resolve to whichever state has the newer `updatedAt`.
 */
export function mergeDraftStates(a: AnyRec | null | undefined, b: AnyRec | null | undefined): AnyRec {
  if (!a || typeof a !== "object") return (b && typeof b === "object" ? b : {}) as AnyRec;
  if (!b || typeof b !== "object") return a as AnyRec;

  const aNewer = ts(a) >= ts(b);
  const newer = aNewer ? a : b;
  const older = aNewer ? b : a;

  return {
    ...older,
    ...newer,
    updatedAt: newer.updatedAt ?? older.updatedAt,
    answers: { ...(older.answers ?? {}), ...(newer.answers ?? {}) },
    uploads: mergeUploadMaps(older.uploads ?? {}, newer.uploads ?? {}),
    taskDrafts: mergeTaskDrafts(older.taskDrafts ?? {}, newer.taskDrafts ?? {}),
    laundry: {
      ...(older.laundry ?? {}),
      ...(newer.laundry ?? {}),
      photo: unionMedia(older.laundry?.photo, newer.laundry?.photo),
    },
    carryForward: {
      ...(older.carryForward ?? {}),
      ...(newer.carryForward ?? {}),
      photos: unionMedia(older.carryForward?.photos, newer.carryForward?.photos),
    },
  };
}
