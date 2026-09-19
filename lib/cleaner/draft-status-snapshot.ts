"use client";

export type DraftStatusSnapshot = { phase: "saving" | "saved" | "error"; checkedAt: number };
export const DRAFT_STATUS_EVENT = "cleaner-draft-status-changed";
const memory = new Map<string, DraftStatusSnapshot>();
const key = (identity: string) => `cleaner-draft-status:${identity}`;

/** Latest acknowledgement for this tab and actor/job; never contains answers. */
export function writeDraftStatus(identity: string | undefined, phase: DraftStatusSnapshot["phase"] | "idle") {
  if (!identity || typeof window === "undefined") return;
  const snapshot = phase === "idle" ? null : { phase, checkedAt: Date.now() };
  if (snapshot) memory.set(identity, snapshot); else memory.delete(identity);
  try { if (snapshot) sessionStorage.setItem(key(identity), JSON.stringify(snapshot)); else sessionStorage.removeItem(key(identity)); } catch { /* Mounted-tab state is still available. */ }
  window.dispatchEvent(new Event(DRAFT_STATUS_EVENT));
}

export function readDraftStatus(identity: string): DraftStatusSnapshot | null {
  const current = memory.get(identity);
  if (current) return current;
  try {
    const raw = sessionStorage.getItem(key(identity));
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (!["saving", "saved", "error"].includes(value?.phase) || !Number.isFinite(value?.checkedAt) || value.checkedAt <= 0 || value.checkedAt > Date.now()) return null;
    return { phase: value.phase, checkedAt: value.checkedAt };
  } catch { return null; }
}
