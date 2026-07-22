/**
 * Pure reducers for the cleaner's bulk photo pool → upload-field assignment.
 *
 * The cleaner uploads a whole batch of photos in one go (one gallery trip), and
 * then files them into the form's upload fields. That means two collections
 * move together:
 *
 *   - `pool`    — uploaded media not yet filed against any field.
 *   - `uploads` — the form's `UploadMap` (`fieldId → media[]`), the exact map the
 *                 workspace already validates and submits.
 *
 * Every mutation is expressed here as a pure `(state, …) → state` function so
 * the rules ("a key lives in exactly one place", "moving never duplicates") are
 * testable without React. The component only renders the result.
 *
 * INVARIANT: a media `key` appears at most once across `pool` + every field
 * array. Assign/move/unassign all remove the key from wherever it currently
 * lives before placing it.
 */

export interface MediaLike {
  key: string;
}

export interface BulkAssignState<T extends MediaLike = MediaLike> {
  pool: T[];
  uploads: Record<string, T[]>;
}

/** Minimal shape of an upload field the assign UI needs. */
export interface AssignField {
  id: string;
  label: string;
  sectionTitle: string;
  required?: boolean;
  minPhotos?: number;
}

function cleanKeys(keys: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const k of keys) {
    if (typeof k !== "string" || !k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

/** Locate the media objects for `keys` anywhere in the state (pool or a field). */
function collect<T extends MediaLike>(state: BulkAssignState<T>, keys: Set<string>): Map<string, T> {
  const found = new Map<string, T>();
  for (const m of state.pool) {
    if (m && keys.has(m.key) && !found.has(m.key)) found.set(m.key, m);
  }
  for (const list of Object.values(state.uploads ?? {})) {
    if (!Array.isArray(list)) continue;
    for (const m of list) {
      if (m && keys.has(m.key) && !found.has(m.key)) found.set(m.key, m);
    }
  }
  return found;
}

function stripFromUploads<T extends MediaLike>(
  uploads: Record<string, T[]>,
  keys: Set<string>,
  except?: string
): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const [fieldId, list] of Object.entries(uploads ?? {})) {
    const arr = Array.isArray(list) ? list : [];
    out[fieldId] = fieldId === except ? arr : arr.filter((m) => !keys.has(m.key));
  }
  return out;
}

/**
 * File `keys` into `fieldId`. Works from the pool OR from another field (that's
 * the "move" case — the key is removed from its previous field first, so it can
 * never end up in two sections). Assigning a key the field already holds is a
 * no-op for that key.
 */
export function assignToField<T extends MediaLike>(
  state: BulkAssignState<T>,
  keys: readonly string[],
  fieldId: string
): BulkAssignState<T> {
  const list = cleanKeys(keys);
  if (!fieldId || list.length === 0) return state;
  const keySet = new Set(list);
  const found = collect(state, keySet);
  if (found.size === 0) return state;

  const uploads = stripFromUploads(state.uploads ?? {}, keySet, fieldId);
  const target = Array.isArray(uploads[fieldId]) ? [...uploads[fieldId]] : [];
  const present = new Set(target.map((m) => m.key));
  for (const key of list) {
    const media = found.get(key);
    if (!media || present.has(key)) continue;
    present.add(key);
    target.push(media);
  }
  uploads[fieldId] = target;

  return { pool: state.pool.filter((m) => !keySet.has(m.key)), uploads };
}

/**
 * Move already-assigned media to a different field. Identical semantics to
 * `assignToField` (which already relocates) — named separately because that's
 * how the UI talks about it.
 */
export function moveToField<T extends MediaLike>(
  state: BulkAssignState<T>,
  keys: readonly string[],
  fieldId: string
): BulkAssignState<T> {
  return assignToField(state, keys, fieldId);
}

/** Pull `keys` out of every field and return them to the unassigned pool. */
export function unassignKeys<T extends MediaLike>(
  state: BulkAssignState<T>,
  keys: readonly string[]
): BulkAssignState<T> {
  const list = cleanKeys(keys);
  if (list.length === 0) return state;
  const keySet = new Set(list);
  const found = collect(state, keySet);
  if (found.size === 0) return state;

  const uploads = stripFromUploads(state.uploads ?? {}, keySet);
  const pool = [...state.pool];
  const inPool = new Set(pool.map((m) => m.key));
  for (const key of list) {
    const media = found.get(key);
    if (!media || inPool.has(key)) continue;
    inPool.add(key);
    pool.push(media);
  }
  return { pool, uploads };
}

/** Add freshly uploaded media to the pool, ignoring keys already known. */
export function addToPool<T extends MediaLike>(
  state: BulkAssignState<T>,
  media: readonly T[]
): BulkAssignState<T> {
  const incoming = (media ?? []).filter((m) => m && typeof m.key === "string" && m.key);
  if (incoming.length === 0) return state;
  const known = new Set<string>(state.pool.map((m) => m.key));
  for (const list of Object.values(state.uploads ?? {})) {
    for (const m of Array.isArray(list) ? list : []) known.add(m.key);
  }
  const pool = [...state.pool];
  for (const m of incoming) {
    if (known.has(m.key)) continue;
    known.add(m.key);
    pool.push(m);
  }
  return { pool, uploads: state.uploads };
}

/** `key → fieldId` for everything currently assigned. */
export function assignmentIndex<T extends MediaLike>(uploads: Record<string, T[]>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [fieldId, list] of Object.entries(uploads ?? {})) {
    for (const m of Array.isArray(list) ? list : []) {
      if (m && typeof m.key === "string" && !(m.key in out)) out[m.key] = fieldId;
    }
  }
  return out;
}

/** How many photos this field still needs (0 when satisfied). */
export function shortfall<T extends MediaLike>(
  field: AssignField,
  uploads: Record<string, T[]>
): number {
  const need = Math.max(field.minPhotos ?? 0, field.required ? 1 : 0);
  const have = Array.isArray(uploads?.[field.id]) ? uploads[field.id].length : 0;
  return Math.max(0, need - have);
}

/**
 * The next field that hasn't met its photo minimum, searching AFTER `afterId`
 * and wrapping around — this is what makes the "assign, assign, assign" loop
 * flow without scrolling back up. Returns null when everything is satisfied.
 */
export function nextUnmetField<T extends MediaLike>(
  fields: readonly AssignField[],
  uploads: Record<string, T[]>,
  afterId?: string | null
): AssignField | null {
  if (!Array.isArray(fields) || fields.length === 0) return null;
  const start = afterId ? fields.findIndex((f) => f.id === afterId) : -1;
  for (let i = 1; i <= fields.length; i += 1) {
    const field = fields[(start + i + fields.length) % fields.length];
    if (shortfall(field, uploads) > 0) return field;
  }
  return null;
}
