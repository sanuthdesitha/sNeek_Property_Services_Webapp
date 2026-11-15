/**
 * When the cleaner job workspace may write its shared draft (2026-11-14).
 *
 * Opening a job used to save the freshly hydrated form straight away, so a
 * job the cleaner had only been OFFERED gained an empty saved draft. Now:
 *   - nothing is written until the hydrated form actually changes (a real
 *     edit, or recovered device work the server does not hold yet);
 *   - nothing goes to the server while this cleaner's assignment is still an
 *     offer (the server refuses it too, OFFER_NOT_ACCEPTED). A change made
 *     then is still kept in the device mirror and saved after accepting.
 * Plain module: no React, no server imports.
 */

/** The draft state without its volatile `updatedAt`, for "did anything change?". */
export function cleanerDraftFingerprint(state: Readonly<Record<string, unknown>>): string {
  const { updatedAt: _updatedAt, ...rest } = state;
  return JSON.stringify(rest);
}

export type CleanerDraftPersistGate = {
  /** The shared draft was read and restored for this identity. */
  hydrated: boolean;
  locked: boolean;
  submitted: boolean;
  /** This cleaner's assignment is still an offer (response PENDING). */
  needsAcceptance: boolean;
  /** The form differs from what was hydrated, now or earlier in this session. */
  changed: boolean;
};

/** Whether the device mirror may hold the current state (a real change exists). */
export function mayMirrorCleanerDraft(gate: CleanerDraftPersistGate): boolean {
  return gate.hydrated && !gate.locked && !gate.submitted && gate.changed;
}

/** Whether the current state may be sent to the shared server draft. */
export function mayPersistCleanerDraft(gate: CleanerDraftPersistGate): boolean {
  return mayMirrorCleanerDraft(gate) && !gate.needsAcceptance;
}

/**
 * Whether recovered state differs from what the server holds, so the
 * recovery must reach the server without waiting for another edit.
 */
export function recoveredDraftNeedsSync(
  merged: Readonly<Record<string, unknown>> | null | undefined,
  server: Readonly<Record<string, unknown>> | null | undefined,
): boolean {
  if (!merged) return false;
  if (!server) return true;
  return cleanerDraftFingerprint(merged) !== cleanerDraftFingerprint(server);
}
