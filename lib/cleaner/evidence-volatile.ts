"use client";
import type { EvidenceRecord } from "./evidence-store";

type Scope = { draftIdentity: string; jobId: string };
const listeners = new Set<() => void>();
const originals = new Map<string, EvidenceRecord>();
let revision = 0;
function beforeUnload(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = ""; }
function changed() {
  revision++;
  if (typeof window !== "undefined") {
    window.removeEventListener("beforeunload", beforeUnload);
    if (originals.size) window.addEventListener("beforeunload", beforeUnload);
  }
  listeners.forEach(listener => listener());
}
/** Retain before the first asynchronous storage operation, across field/stage unmounts. */
export function retainVolatileEvidence(record: EvidenceRecord) { originals.set(record.id, record); changed(); }
export function releaseVolatileEvidence(id: string) { if (originals.delete(id)) changed(); }
export function getVolatileEvidence(scope: Scope) {
  return Array.from(originals.values()).filter(record => record.draftIdentity === scope.draftIdentity && record.jobId === scope.jobId);
}
export function getVolatileEvidenceRevision() { return revision; }

export function getVolatileEvidenceCount(scope: Scope | null | undefined) {
  return scope ? getVolatileEvidence(scope).length : 0;
}

export function subscribeVolatileEvidence(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
