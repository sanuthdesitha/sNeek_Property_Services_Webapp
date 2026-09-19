"use client";
import * as React from "react";
import { postOnlineAction, UnknownActionOutcome } from "@/lib/cleaner/online-action";
import { pendingActionSchema, recoveredActionSchema, type PendingAction } from "@/lib/cleaner/action-contract";
export type RecoveredAction = { state: "COMMITTED" | "CANCELLED"; result: { status: number; body: Record<string, unknown> } };

/** Retains uncertainty across reloads; reconnecting never replays a command. */
export function useOnlineAction(scope: string) {
  const key = `cleaner-action-pending:${scope}`;
  const [online, setOnline] = React.useState(true);
  const [uncertain, setUncertain] = React.useState<string | null>(null);
  const pending = React.useRef<PendingAction | null>(null);
  const inFlight = React.useRef(false);
  const [checking, setChecking] = React.useState(false);
  const initializedKey = React.useRef<string | null>(null);
  const [readyKey, setReadyKey] = React.useState<string | null>(null);
  React.useEffect(() => {
    initializedKey.current = key;
    inFlight.current = false; pending.current = null;
    setUncertain(null); setChecking(false);
    const update = () => setOnline(navigator.onLine !== false);
    update(); window.addEventListener("online", update); window.addEventListener("offline", update);
    try {
      const stored = sessionStorage.getItem(key);
      if (stored) {
        const parsed = pendingActionSchema.parse(JSON.parse(stored));
        if (parsed.scope !== scope) throw new Error("Invalid recovery scope");
        pending.current = parsed; setUncertain(parsed.label);
      }
    } catch { setUncertain("Stored action recovery needs review"); }
    setReadyKey(key);
    return () => { initializedKey.current = null; window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, [key]);
  function retain(action: PendingAction | null) {
    if (initializedKey.current !== key) throw new Error("Account context changed.");
    if (action) sessionStorage.setItem(key, JSON.stringify(action)); else sessionStorage.removeItem(key);
    pending.current = action;
  }
  function begin(action: string) {
    if (initializedKey.current !== key || readyKey !== key) throw new Error("Wait for the current account context to load.");
    if (navigator.onLine === false) throw new Error("This action needs a connection. Your draft and retained photos remain available; reconnect to continue.");
    if (inFlight.current) throw new Error("An action is already being checked. Please wait.");
    if (pending.current || uncertain) throw new Error("Check the latest server status before trying another action.");
    // Commit the recovery marker before a request can leave this page.
    try { retain({ version: 1, phase: "ADMITTED", scope, label: action, requestId: crypto.randomUUID() }); }
    catch { throw new Error("Action recovery storage is unavailable. Enable site storage before changing server status."); }
    inFlight.current = true;
  }
  async function post(url: string, input: Record<string, unknown>, identity: string) {
    if (!inFlight.current || !pending.current || initializedKey.current !== key) throw new Error("Action context is not ready.");
    const match = /^\/api\/cleaner\/jobs\/([^/]+)\/(gps-checkin|start|stop|clock-out-early|assignment-response|submit|laundry-status)$/.exec(url);
    if (!match || !/^[a-f0-9]{64}$/.test(identity)) throw new Error("Invalid action context.");
    const marker = pendingActionSchema.parse({ ...pending.current, phase: "DISPATCHED", jobId: match[1], action: match[2], identity, input: JSON.parse(JSON.stringify(input)) });
    if (marker.phase !== "DISPATCHED") throw new Error("Invalid action phase.");
    // Persist the exact operation before fetch, so recovery can fence it.
    retain(marker);
    return postOnlineAction(url, marker.input, { "X-Cleaner-Action-Id": marker.requestId, "X-Cleaner-Draft-Identity": identity });
  }
  function finish(error?: unknown) {
    if (initializedKey.current !== key) return;
    inFlight.current = false;
    if (error instanceof UnknownActionOutcome) setUncertain(pending.current?.label ?? "Action");
    else {
      try { retain(null); setUncertain(null); }
      catch { setUncertain(pending.current?.label ?? "Stored action recovery needs review"); }
    }
  }
  async function reconcile(read: (receipt: RecoveredAction | null) => Promise<void>) {
    if (initializedKey.current !== key || readyKey !== key) return;
    if (navigator.onLine === false || inFlight.current) return;
    const marker = pending.current;
    if (!marker) throw new Error("This recovery record cannot be verified. Ask the office to review the action before continuing.");
    inFlight.current = true; setChecking(true);
    try {
      let receipt: RecoveredAction | null = null;
      if (marker.phase === "DISPATCHED") {
        const result = await postOnlineAction(`/api/cleaner/jobs/${marker.jobId}/action-recovery`, { requestId: marker.requestId, action: marker.action, input: marker.input }, { "X-Cleaner-Draft-Identity": marker.identity });
        const parsed = recoveredActionSchema.safeParse(result);
        if (!parsed.success) throw new Error("Action recovery was not confirmed.");
        receipt = parsed.data;
      }
      // An admission marker without a phase never permitted a request to leave.
      if (initializedKey.current !== key) return;
      await read(receipt);
      if (initializedKey.current === key) { retain(null); setUncertain(null); }
    }
    finally { if (initializedKey.current === key) { inFlight.current = false; setChecking(false); } }
  }
  const ready = readyKey === key;
  return { online, uncertain: ready ? uncertain : null, checking: ready && checking, blocked: !ready || !online || Boolean(uncertain) || checking, begin, post, finish, reconcile };
}
