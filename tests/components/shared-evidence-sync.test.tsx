import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSharedEvidenceSync } from "@/hooks/use-shared-evidence-sync";
afterEach(() => vi.unstubAllGlobals());
it("reconciles a second device's photos, moves and removals without replacing local answers", async () => {
  const media = { key: "photo", url: "/photo.jpg", kind: "image" };
  let local: Record<string, unknown> = {
    answers: { note: "Unsaved local note" },
    bulkPool: [],
    uploads: {},
  };
  let server = {
    state: { bulkPool: [media] },
    evidenceReceipts: {
      capture: {
        key: media.key,
        destination: { type: "bulkPool" },
        fieldId: "bulkPool",
        draftIdentity: "same-cleaner",
        formRevision: "form",
      },
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ draft: server }))),
  );
  const restore = vi.fn((state) => {
    local = state;
  });
  renderHook(() =>
    useSharedEvidenceSync({
      jobId: "job",
      draftIdentity: "same-cleaner",
      canSync: () => true,
      readState: () => ({ ...local, updatedAt: new Date().toISOString() }),
      restore,
    }),
  );
  act(() => window.dispatchEvent(new Event("focus")));
  await waitFor(() => expect(local.bulkPool).toEqual([media]));
  expect(local.answers).toEqual({ note: "Unsaved local note" });
  server = {
    state: { bulkPool: [] },
    evidenceReceipts: {
      capture: { ...server.evidenceReceipts.capture, detached: true },
    },
  } as typeof server;
  act(() => window.dispatchEvent(new Event("focus")));
  await waitFor(() => expect(local.bulkPool).toEqual([]));
  expect(local.answers).toEqual({ note: "Unsaved local note" });
});
it("does not overwrite edits made while a remote read is pending", async () => {
  let resolve!: (response: Response) => void;
  let local = { answers: { note: "before" } };
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    ),
  );
  const restore = vi.fn();
  renderHook(() =>
    useSharedEvidenceSync({
      jobId: "job",
      draftIdentity: "actor",
      canSync: () => true,
      readState: () => local,
      restore,
    }),
  );
  act(() => window.dispatchEvent(new Event("focus")));
  local = { answers: { note: "after" } };
  await act(async () =>
    resolve(
      new Response(
        JSON.stringify({ draft: { state: {}, evidenceReceipts: {} } }),
      ),
    ),
  );
  expect(restore).not.toHaveBeenCalled();
});

it("does not restore unchanged evidence just because local timestamps advance", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ draft: { state: {}, evidenceReceipts: {} } }),
        ),
    ),
  );
  const restore = vi.fn();
  renderHook(() =>
    useSharedEvidenceSync({
      jobId: "job",
      draftIdentity: "actor",
      canSync: () => true,
      readState: () => ({
        answers: { note: "kept" },
        bulkPool: [],
        laundry: { photo: [] },
        carryForward: { photos: [] },
        updatedAt: new Date().toISOString(),
      }),
      restore,
    }),
  );
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(restore).not.toHaveBeenCalled();
});

it("ignores a late response after the job scope unmounts", async () => {
  let resolve!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    ),
  );
  const restore = vi.fn();
  const hook = renderHook(() =>
    useSharedEvidenceSync({
      jobId: "job",
      draftIdentity: "actor",
      canSync: () => true,
      readState: () => ({}),
      restore,
    }),
  );
  act(() => window.dispatchEvent(new Event("focus")));
  hook.unmount();
  await act(async () =>
    resolve(
      new Response(
        JSON.stringify({ draft: { state: {}, evidenceReceipts: {} } }),
      ),
    ),
  );
  expect(restore).not.toHaveBeenCalled();
});

it("surfaces failed synchronization and retries on focus", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ draft: null })));
  vi.stubGlobal("fetch", fetcher);
  const hook = renderHook(() =>
    useSharedEvidenceSync({
      jobId: "job",
      draftIdentity: "actor",
      canSync: () => true,
      readState: () => ({}),
      restore: vi.fn(),
    }),
  );
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(hook.result.current).toBe(true);
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(hook.result.current).toBe(false);
});
