"use client";

import * as React from "react";
import { useEvidenceScope } from "./evidence-context";
import { listEvidence } from "@/lib/cleaner/evidence-store";
import { getVolatileEvidenceCount, subscribeVolatileEvidence } from "@/lib/cleaner/evidence-volatile";

/** Readiness is advisory; submission still rechecks scope and server policy. */
export function useSubmissionPreflight(enabled: boolean) {
  const scope = useEvidenceScope();
  const [offline, setOffline] = React.useState(false);
  const [read, setRead] = React.useState<{ key: string; pending: number; failed: boolean } | null>(null);
  const key = scope ? JSON.stringify([scope.draftIdentity, scope.jobId, scope.formRevision]) : "";
  const volatile = React.useSyncExternalStore(subscribeVolatileEvidence, () => getVolatileEvidenceCount(scope), () => 0);
  React.useEffect(() => {
    const update = () => setOffline(navigator.onLine === false);
    update();
    window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  React.useEffect(() => {
    if (!enabled || !scope) return;
    let active = true;
    let generation = 0;
    const refresh = async () => {
      const current = ++generation;
      try {
        const records = await listEvidence();
        if (!active || current !== generation) return;
        setRead({ key, failed: false, pending: records.filter(record =>
          record.draftIdentity === scope.draftIdentity && record.jobId === scope.jobId &&
          record.formRevision === scope.formRevision && !["attached", "detached"].includes(record.status)).length });
      } catch { if (active && current === generation) setRead({ key, failed: true, pending: 0 }); }
    };
    void refresh();
    window.addEventListener("cleaner-evidence-changed", refresh); window.addEventListener("focus", refresh);
    return () => { active = false; window.removeEventListener("cleaner-evidence-changed", refresh); window.removeEventListener("focus", refresh); };
  }, [enabled, key, scope?.draftIdentity, scope?.jobId, scope?.formRevision]);
  const blockers: string[] = [];
  if (!enabled) return blockers;
  if (offline) blockers.push("You are offline. Connect before submitting; clock-out is not queued.");
  if (scope && read?.key !== key) blockers.push("Checking evidence saved on this device…");
  else if (scope && read?.failed) blockers.push("Device evidence could not be checked. Keep originals and reload before submitting.");
  else if (scope && read?.pending) blockers.push(`${read.pending} evidence file${read.pending === 1 ? "" : "s"} still need attachment. Use Device evidence recovery before submitting.`);
  if (volatile) blockers.push(`${volatile} original file${volatile === 1 ? " is" : "s are"} only in memory. Save or retry the failed capture before leaving this page.`);
  return blockers;
}
