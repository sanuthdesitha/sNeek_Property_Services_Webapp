import React from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EvidenceContext } from "@/components/v2/cleaner/evidence-context";
import { useSubmissionPreflight } from "@/components/v2/cleaner/use-submission-preflight";
import { beginActiveEvidenceUpload, retainVolatileEvidence, releaseVolatileEvidence } from "@/lib/cleaner/evidence-volatile";
import type { EvidenceRecord } from "@/lib/cleaner/evidence-store";

const list = vi.hoisted(() => vi.fn());
vi.mock("@/lib/cleaner/evidence-store", () => ({ listEvidence: list }));
const scope = { draftIdentity: "actor", jobId: "job", formRevision: "revision", templateId: "template" };
const wrapper = ({ children }: { children: React.ReactNode }) => <EvidenceContext.Provider value={scope}>{children}</EvidenceContext.Provider>;
beforeEach(() => { list.mockReset().mockResolvedValue([]); Object.defineProperty(navigator, "onLine", { configurable: true, value: true }); });
afterEach(() => { cleanup(); ["camera-1", "camera-2", "other-actor", "other-job"].forEach(releaseVolatileEvidence); });

describe("submission synchronization preflight", () => {
  it("does not scan hundreds of saved or abandoned uploads before submission", () => {
    list.mockResolvedValue(Array.from({ length: 300 }, () => ({ ...scope, status: "uploading" })));
    const { result } = renderHook(() => useSubmissionPreflight(true), { wrapper });
    expect(result.current).toEqual([]);
    expect(list).not.toHaveBeenCalled();
  });
  it("does not block submission when device storage is unavailable", () => {
    list.mockRejectedValue(new Error("quota"));
    const { result } = renderHook(() => useSubmissionPreflight(true), { wrapper });
    expect(result.current).toEqual([]);
    expect(list).not.toHaveBeenCalled();
  });
  it("tracks real scoped uploads across remounts and releases the blocker when they finish", () => {
    const finish = beginActiveEvidenceUpload(scope);
    const otherActor = beginActiveEvidenceUpload({ ...scope, draftIdentity: "other" });
    const otherJob = beginActiveEvidenceUpload({ ...scope, jobId: "other" });
    try {
      const first = renderHook(() => useSubmissionPreflight(true), { wrapper });
      expect(first.result.current.join()).toMatch(/upload is still running/);
      first.unmount();
      const second = renderHook(() => useSubmissionPreflight(true), { wrapper });
      expect(second.result.current.join()).toMatch(/upload is still running/);
      act(() => finish());
      expect(second.result.current).toEqual([]);
    } finally { act(() => { finish(); otherActor(); otherJob(); }); }
  });
  it("reflects connection loss and recovery without promising offline clock-out", async () => {
    const { result } = renderHook(() => useSubmissionPreflight(true), { wrapper });
    await waitFor(() => expect(result.current).toEqual([]));
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    act(() => window.dispatchEvent(new Event("offline")));
    expect(result.current.join()).toMatch(/clock-out is not queued/);
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    act(() => window.dispatchEvent(new Event("online")));
    expect(result.current).toEqual([]);
  });
  it("does not require failed memory-only originals to be removed before submission", async () => {
    const { result } = renderHook(() => useSubmissionPreflight(true), { wrapper });
    await waitFor(() => expect(result.current).toEqual([]));
    const original: EvidenceRecord = { ...scope, id: "camera-1", fieldId: "proof", filename: "proof.jpg", mime: "image/jpeg", blob: new File(["original"], "proof.jpg", { type: "image/jpeg" }), createdAt: 1, folder: "forms", source: "camera", status: "captured" };
    act(() => {
      retainVolatileEvidence(original);
      retainVolatileEvidence({ ...original, id: "camera-2" });
      retainVolatileEvidence({ ...original, id: "other-actor", draftIdentity: "other" });
      retainVolatileEvidence({ ...original, id: "other-job", jobId: "other" });
    });
    expect(result.current).toEqual([]);
    cleanup();
    const remounted = renderHook(() => useSubmissionPreflight(true), { wrapper });
    expect(remounted.result.current).toEqual([]);
    act(() => { releaseVolatileEvidence("camera-1"); releaseVolatileEvidence("camera-2"); });
    expect(remounted.result.current).toEqual([]);
  });
  it("does not load device evidence for a submitted job", () => {
    const { result } = renderHook(() => useSubmissionPreflight(false), { wrapper });
    expect(result.current).toEqual([]); expect(list).not.toHaveBeenCalled();
  });
});
