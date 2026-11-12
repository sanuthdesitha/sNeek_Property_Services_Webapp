"use client";

/**
 * The stop screen's unsent answers, kept on this phone per login, run and leg
 * (`laundry-stop:<user>:<task>:<kind>`), so a lost signal or a closed tab
 * does not lose them. Browser storage can be missing or refuse writes (private
 * mode): the screen still works, the draft is then only kept while it is open.
 * Nothing here is sent; "saved on this phone" never means "sent".
 */
import * as React from "react";
import type { CapturedMedia } from "@/components/v2/cleaner/media-capture";

export type PickupDraft = {
  readiness: "READY" | "NOT_READY" | null;
  bagCount: number;
  reason: string;
  notes: string;
  photos: CapturedMedia[];
  keyPhotos: CapturedMedia[];
};

function emptyDraft(expected: number): PickupDraft {
  return { readiness: null, bagCount: Math.min(50, Math.max(1, expected)), reason: "", notes: "", photos: [], keyPhotos: [] };
}

function readDraft(key: string, expected: number): { draft: PickupDraft; restored: boolean } {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return { draft: emptyDraft(expected), restored: false };
    const parsed = JSON.parse(raw) as Partial<PickupDraft>;
    const base = emptyDraft(expected);
    return {
      draft: {
        readiness: parsed.readiness === "READY" || parsed.readiness === "NOT_READY" ? parsed.readiness : null,
        bagCount: Number.isInteger(parsed.bagCount) && (parsed.bagCount as number) >= 1 && (parsed.bagCount as number) <= 50 ? (parsed.bagCount as number) : base.bagCount,
        reason: typeof parsed.reason === "string" ? parsed.reason : "",
        notes: typeof parsed.notes === "string" ? parsed.notes : "",
        photos: Array.isArray(parsed.photos) ? parsed.photos : [],
        keyPhotos: Array.isArray(parsed.keyPhotos) ? parsed.keyPhotos : [],
      },
      restored: true,
    };
  } catch {
    return { draft: emptyDraft(expected), restored: false };
  }
}

export function useStopDraft(key: string, expected: number) {
  const [draft, setDraft] = React.useState<PickupDraft>(() => emptyDraft(expected));
  const [restored, setRestored] = React.useState(false);
  const [persisted, setPersisted] = React.useState<boolean | null>(null);

  // Read after mount (no storage on the server); a different stop starts from its own draft.
  React.useEffect(() => {
    const result = readDraft(key, expected);
    setDraft(result.draft);
    setRestored(result.restored);
  }, [key, expected]);

  const latest = React.useRef(draft);
  latest.current = draft;
  const update = React.useCallback((next: Partial<PickupDraft>) => {
    const value = { ...latest.current, ...next };
    latest.current = value;
    setDraft(value);
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      setPersisted(true);
    } catch {
      setPersisted(false);
    }
  }, [key]);

  const clear = React.useCallback(() => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* nothing stored */
    }
    setRestored(false);
  }, [key]);

  return { draft, update, clear, restored, persisted };
}
