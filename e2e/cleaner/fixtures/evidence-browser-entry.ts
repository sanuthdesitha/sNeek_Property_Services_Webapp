import { prepareAndUploadFiles } from "../../../components/v2/cleaner/media-capture";
import { getEvidence, listEvidence, clearAttachedEvidence } from "../../../lib/cleaner/evidence-store";
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { EvidenceRecovery } from "../../../components/v2/cleaner/evidence-recovery";
import { getVolatileEvidenceCount } from "../../../lib/cleaner/evidence-volatile";
import type { EvidenceDestination } from "../../../lib/cleaner/evidence-destination";

// Bundled only by the Playwright synthetic page; never an application route.
const scope = { jobId: "synthetic-job", draftIdentity: "a".repeat(64), templateId: "synthetic-template", formRevision: "b".repeat(64), fieldId: "proof" };
let lastResult: Awaited<ReturnType<typeof prepareAndUploadFiles>> | undefined;
let recoveryRoot: Root | undefined;
let retainedBeforeStorage = 0;
const snapshot = async () => Promise.all((await listEvidence()).map(async record => ({
  id: record.id, status: record.status, allocation: record.allocation, receipt: record.receipt,
  destination: record.destination,
  original: await record.blob.text(), prepared: record.prepared ? await record.prepared.text() : null,
  error: record.error,
})));
const summarize = () => ({ results: lastResult?.results, failures: lastResult?.failed.map(item => ({
  name: item.name, reason: item.reason, captureId: item.captureId,
})) });
(window as any).__evidenceFixture = {
  snapshot,
  mountRecovery() {
    const host = document.createElement("div"); document.body.appendChild(host);
    recoveryRoot = createRoot(host);
    recoveryRoot.render(React.createElement(EvidenceRecovery, { scope, locked: false, onRecovered: () => {} }));
  },
  unmountRecovery() { recoveryRoot?.unmount(); lastResult = undefined; },
  volatileCount() { return getVolatileEvidenceCount(scope); },
  retainedBeforeStorage() { return retainedBeforeStorage; },
  async capture(destination?: EvidenceDestination) {
    const pending = prepareAndUploadFiles([new File(["%PDF-1.4\nsynthetic original evidence"], "proof.pdf", { type: "application/pdf" })], {
      folder: "forms", source: "gallery", stamp: null, evidence: { ...scope, destination },
    });
    retainedBeforeStorage = getVolatileEvidenceCount(scope);
    lastResult = await pending;
    return summarize();
  },
  async recover(id: string, scopePatch: Record<string, string> = {}) {
    const record = await getEvidence(id);
    if (!record) throw new Error("Missing fixture evidence");
    lastResult = await prepareAndUploadFiles([new File([record.blob], record.filename, { type: record.mime })], {
      folder: record.folder, source: record.source, stamp: null, evidence: { ...scope, ...scopePatch }, recoveryRecords: [record],
    });
    return summarize();
  },
  async clear(id: string) { const record = await getEvidence(id); if (record) await clearAttachedEvidence(record); },
  async volatileOriginal() { return lastResult?.failed[0]?.file.text(); },
  failStorage(phase: "original" | "receipt") {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value: any, key?: IDBValidKey) {
      if (this.name === "evidence" && (phase === "original" ? value.status === "captured" : Boolean(value.receipt))) {
        throw new DOMException("Synthetic quota exhausted", "QuotaExceededError");
      }
      return key === undefined ? original.call(this, value) : original.call(this, value, key);
    };
  },
};
