"use client";

import * as React from "react";
import { useEvidenceScope } from "./evidence-context";
import { getActiveEvidenceUploadCount, subscribeVolatileEvidence } from "@/lib/cleaner/evidence-volatile";

/** Readiness is advisory; submission still rechecks scope and server policy. */
export function useSubmissionPreflight(enabled: boolean) {
  const scope = useEvidenceScope();
  const [offline, setOffline] = React.useState(false);
  const activeUploads = React.useSyncExternalStore(subscribeVolatileEvidence, () => getActiveEvidenceUploadCount(scope), () => 0);
  React.useEffect(() => {
    const update = () => setOffline(navigator.onLine === false);
    update();
    window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  const blockers: string[] = [];
  if (!enabled) return blockers;
  if (offline) blockers.push("You are offline. Connect before submitting; clock-out is not queued.");
  if (activeUploads) blockers.push("An upload is still running. Wait for it to finish before submitting.");
  return blockers;
}
