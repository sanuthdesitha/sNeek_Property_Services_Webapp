"use client";
import { useEffect, useState } from "react";
import { DRAFT_STATUS_EVENT, readDraftStatus, type DraftStatusSnapshot } from "@/lib/cleaner/draft-status-snapshot";
import { listEvidence } from "@/lib/cleaner/evidence-store";
import { getVolatileEvidenceCount, subscribeVolatileEvidence } from "@/lib/cleaner/evidence-volatile";

export function ActiveWorkStatus({ identity, jobId, clock, checkedAt }: {
  identity: string; jobId: string; clock: { running: boolean; startedAt: string | null }; checkedAt: string;
}) {
  const [draft, setDraft] = useState<DraftStatusSnapshot | null>(null);
  const [evidence, setEvidence] = useState<{ pending: number; volatile: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let disposed = false; let generation = 0;
    const refresh = async () => {
      const own = ++generation;
      setDraft(readDraftStatus(identity));
      const volatile = getVolatileEvidenceCount({ draftIdentity: identity, jobId });
      try {
        const records = await listEvidence();
        if (!disposed && own === generation) {
          setEvidence({ volatile, pending: records.filter(record => record.draftIdentity === identity && record.jobId === jobId && !["attached", "detached"].includes(record.status)).length });
          setFailed(false);
        }
      } catch { if (!disposed && own === generation) { setEvidence({ volatile, pending: 0 }); setFailed(true); } }
    };
    const update = () => { void refresh(); };
    update();
    const unsubscribe = subscribeVolatileEvidence(update);
    window.addEventListener(DRAFT_STATUS_EVENT, update);
    window.addEventListener("cleaner-evidence-changed", update);
    window.addEventListener("focus", update);
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => { disposed = true; unsubscribe(); clearInterval(timer); window.removeEventListener(DRAFT_STATUS_EVENT, update); window.removeEventListener("cleaner-evidence-changed", update); window.removeEventListener("focus", update); };
  }, [identity, jobId]);
  const stale = now - Date.parse(checkedAt) > 90_000;
  return <div className="mt-1 space-y-0.5 text-xs text-[hsl(var(--e-muted-foreground))]">
    <p>{stale ? "Last checked clock" : "Your clock"}: {clock.running ? "running" : "stopped"}{stale ? " - status may have changed" : ""}.</p>
    <p>{draft?.phase === "saved" ? `Draft save last confirmed ${new Date(draft.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`
      : draft ? "Latest draft save not confirmed. Resume to check or retry." : "Draft save status not checked in this tab."}</p>
    <p>{evidence?.volatile ? `${evidence.volatile} original file(s) only in memory. Resume to save them. ` : ""}
      {failed ? "Device evidence status unavailable. Resume to check recovery." : evidence === null ? "Checking device evidence..."
        : evidence.pending ? `${evidence.pending} evidence item(s) need recovery. Resume to continue.` : "No pending evidence found on this device."}</p>
  </div>;
}
