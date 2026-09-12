import React from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EvidenceContext } from "@/components/v2/cleaner/evidence-context";
import { useSubmissionPreflight } from "@/components/v2/cleaner/use-submission-preflight";
import { retainVolatileEvidence, releaseVolatileEvidence } from "@/lib/cleaner/evidence-volatile";
import type { EvidenceRecord } from "@/lib/cleaner/evidence-store";

const list = vi.hoisted(() => vi.fn());
vi.mock("@/lib/cleaner/evidence-store", () => ({ listEvidence: list }));
const scope = { draftIdentity: "actor", jobId: "job", formRevision: "revision", templateId: "template" };
const wrapper = ({ children }: { children: React.ReactNode }) => <EvidenceContext.Provider value={scope}>{children}</EvidenceContext.Provider>;
beforeEach(() => { list.mockReset().mockResolvedValue([]); Object.defineProperty(navigator, "onLine", { configurable: true, value: true }); });
afterEach(() => { cleanup(); ["camera-1", "camera-2", "other-actor", "other-job"].forEach(releaseVolatileEvidence); });

describe("submission synchronization preflight", () => {
  it("waits for the local read and does not equate a pending read with no evidence", async () => {
    let resolve!: (rows: unknown[]) => void;
    list.mockReturnValue(new Promise(done => { resolve = done; }));
    const { result } = renderHook(() => useSubmissionPreflight(true), { wrapper });
    expect(result.current.join()).toMatch(/Checking evidence/);
    await act(async () => resolve([]));
    expect(result.current).toEqual([]);
  });
  it("counts only pending evidence for this actor, job and revision", async () => {
    list.mockResolvedValue([
      { ...scope, status: "uploading" }, { ...scope, status: "attached" }, { ...scope, status: "detached" },
      { ...scope, status: "pending", draftIdentity: "other" },
      { ...scope, status: "pending", jobId: "other" },
      { ...scope, status: "pending", formRevision: "old" },
    ]);
    const { result } = renderHook(() => useSubmissionPreflight(true), { wrapper });
    await waitFor(() => expect(result.current.join()).toMatch(/1 evidence file still/));
  });
  it("keeps failed local reads explicit and recovers on focus", async () => {
    list.mockRejectedValueOnce(new Error("quota"));
    const { result } = renderHook(() => useSubmissionPreflight(true), { wrapper });
    await waitFor(() => expect(result.current.join()).toMatch(/could not be checked/));
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(result.current).toEqual([]));
  });
  it("ignores older asynchronous reads when a newer capture update finishes", async () => {
    let old!: (rows: unknown[]) => void;
    list.mockReturnValueOnce(new Promise(done => { old = done; }));
    const { result } = renderHook(() => useSubmissionPreflight(true), { wrapper });
    act(() => window.dispatchEvent(new Event("cleaner-evidence-changed")));
    await waitFor(() => expect(result.current).toEqual([]));
    await act(async () => old([{ ...scope, status: "uploading" }]));
    expect(result.current).toEqual([]);
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
  it("tracks scoped original files across preflight remount until saved or explicitly removed", async () => {
    const { result } = renderHook(() => useSubmissionPreflight(true), { wrapper });
    await waitFor(() => expect(result.current).toEqual([]));
    const original: EvidenceRecord = { ...scope, id: "camera-1", fieldId: "proof", filename: "proof.jpg", mime: "image/jpeg", blob: new File(["original"], "proof.jpg", { type: "image/jpeg" }), createdAt: 1, folder: "forms", source: "camera", status: "captured" };
    act(() => {
      retainVolatileEvidence(original);
      retainVolatileEvidence({ ...original, id: "camera-2" });
      retainVolatileEvidence({ ...original, id: "other-actor", draftIdentity: "other" });
      retainVolatileEvidence({ ...original, id: "other-job", jobId: "other" });
    });
    expect(result.current.join()).toMatch(/2 original files are only in memory/);
    cleanup();
    const remounted = renderHook(() => useSubmissionPreflight(true), { wrapper });
    await waitFor(() => expect(remounted.result.current.join()).toMatch(/2 original files are only in memory/));
    act(() => { releaseVolatileEvidence("camera-1"); releaseVolatileEvidence("camera-2"); });
    expect(remounted.result.current).toEqual([]);
  });
  it("does not load device evidence for a submitted job", () => {
    const { result } = renderHook(() => useSubmissionPreflight(false), { wrapper });
    expect(result.current).toEqual([]); expect(list).not.toHaveBeenCalled();
  });
});
