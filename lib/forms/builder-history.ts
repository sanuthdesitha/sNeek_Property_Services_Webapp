/**
 * Undo / redo history for the form builder: a bounded list of past schemas,
 * the present one, and the undone ones. Session-only (never stored); the
 * builder clears it when it publishes or reloads.
 *
 * Consecutive edits that share a `coalesceKey` (typing in one input) become
 * ONE undo step, so Undo does not walk back a label one letter at a time.
 *
 * PURE: no React.
 */

export const DEFAULT_HISTORY_LIMIT = 100;

export type History<T> = {
  past: T[];
  present: T;
  future: T[];
  /** Key of the edit that produced `present`; null after undo/redo/reset. */
  lastKey: string | null;
  limit: number;
};

export function createHistory<T>(present: T, limit: number = DEFAULT_HISTORY_LIMIT): History<T> {
  return { past: [], present, future: [], lastKey: null, limit: Math.max(1, limit) };
}

/** Record an edit. A no-op edit (same reference) changes nothing. */
export function pushHistory<T>(history: History<T>, next: T, coalesceKey?: string): History<T> {
  if (next === history.present) return history;
  if (coalesceKey && history.lastKey === coalesceKey) {
    return { ...history, present: next, future: [] };
  }
  const past = [...history.past, history.present];
  if (past.length > history.limit) past.splice(0, past.length - history.limit);
  return { ...history, past, present: next, future: [], lastKey: coalesceKey ?? null };
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0;
}

export function undo<T>(history: History<T>): History<T> {
  if (!canUndo(history)) return history;
  const past = history.past.slice(0, -1);
  const previous = history.past[history.past.length - 1];
  return { ...history, past, present: previous, future: [history.present, ...history.future], lastKey: null };
}

export function redo<T>(history: History<T>): History<T> {
  if (!canRedo(history)) return history;
  const [next, ...future] = history.future;
  return { ...history, past: [...history.past, history.present], present: next, future, lastKey: null };
}

/** Start again from a new present (publish, reload, conflict resolution). */
export function resetHistory<T>(history: History<T>, present: T): History<T> {
  return createHistory(present, history.limit);
}

/**
 * Whether a keyboard event is a builder undo/redo shortcut. Text inputs keep
 * their own native undo: the shortcut only applies when focus is NOT in an
 * editable control.
 */
export function historyShortcut(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  target: EventTarget | null;
}): "undo" | "redo" | null {
  if (!(event.metaKey || event.ctrlKey)) return null;
  const target = event.target as { tagName?: string; isContentEditable?: boolean } | null;
  const tag = target?.tagName?.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return null;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y") return "redo";
  return null;
}
