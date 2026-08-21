/**
 * "Is this save based on a version that is still current?"
 *
 * A form template's `schema` is replaced wholesale on save, so a write from an
 * editor that loaded an older version destroys everything saved since. That is
 * not hypothetical: the builder seeds its React state from the server payload
 * exactly once, and a back-navigation re-mounts it from the payload Next kept
 * in its client Router Cache — the PRE-EDIT one. The owner sees their work
 * missing, redoes it, saves, and the good schema is gone from the database.
 *
 * Refusing the write is the only place that failure can be stopped for certain,
 * because the server is the only party that knows what is actually stored.
 *
 * PURE — no DB, no I/O.
 */

/**
 * True when the client's base version no longer matches what is stored.
 *
 * An absent expectation is NOT stale. Older clients do not send one, and
 * treating "didn't tell me" as a conflict would block every save from them —
 * trading silent data loss for a portal nobody can save in. They keep the old
 * unguarded behaviour; clients that opt in get the protection.
 *
 * A malformed expectation IS stale. If a client sends something it believes is
 * a version and the server cannot read it, the honest answer is "I cannot
 * confirm you are current", and the safe one is to refuse.
 */
export function isStaleTemplateWrite(
  currentUpdatedAt: Date,
  expectedUpdatedAt: string | null | undefined
): boolean {
  if (expectedUpdatedAt == null || expectedUpdatedAt === "") return false;

  const expected = new Date(expectedUpdatedAt).getTime();
  if (Number.isNaN(expected)) return true;

  // Compared as epoch milliseconds, so an ISO string with a different offset
  // ("+10:00" vs "Z") still matches the same instant — a client in Sydney and
  // one sending UTC must not disagree about whether they are up to date.
  return currentUpdatedAt.getTime() !== expected;
}
