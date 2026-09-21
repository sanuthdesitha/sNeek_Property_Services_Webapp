import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BulkPhotoAssign } from "@/components/v2/cleaner/bulk-photo-assign";
import { EvidenceContext } from "@/components/v2/cleaner/evidence-context";
import type { EvidenceScope } from "@/lib/cleaner/evidence-store";
import type { CapturedMedia } from "@/components/v2/cleaner/media-capture";
import type { UploadMap } from "@/components/v2/cleaner/form-renderer";
const mocks = vi.hoisted(() => ({ move: vi.fn(), prepare: vi.fn() }));
vi.mock("@/lib/cleaner/evidence-client", () => ({ moveEvidence: mocks.move, removeEvidence: vi.fn() }));
vi.mock("@/components/v2/cleaner/media-capture", () => ({ prepareAndUploadFiles: vi.fn() }));
const scope: EvidenceScope = { jobId: "job", templateId: "template", formRevision: "revision", draftIdentity: "actor" };
const media = (key: string): CapturedMedia => ({ key, url: `https://media.invalid/${key}.jpg`, kind: "image", name: `Photo ${key}` });
const fields = [{ id: "kitchen", label: "Kitchen photos", sectionTitle: "Kitchen" }, { id: "bathroom", label: "Bathroom photos", sectionTitle: "Bathroom" }];
const proposal = (key: string, fieldId: string | null = "kitchen", confidence = .95) => ({ captureId: `capture-${key}`, key, version: 2, fieldId, confidence, reason: fieldId ? "Bench and sink visible" : "Room is unclear" });
const response = (proposals = [proposal("one"), proposal("two", null, .4)]) => ({ ...scope, minConfidence: .8, proposals });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const draft = () => ({ draft: { evidenceReceipts: Object.fromEntries(["one", "two", "manual"].map(key => [`capture-${key}`, { ...scope, key, version: 2, destination: { type: key === "manual" ? "formField" : "bulkPool", fieldId: "bathroom" } }])) } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function Harness({ currentScope = scope, open = true, initialKeys = ["one", "two"] }: { currentScope?: EvidenceScope | null; open?: boolean; initialKeys?: string[] }) {
  const [pool, setPool] = React.useState(initialKeys.map(media));
  const [uploads, setUploads] = React.useState<UploadMap>({ bathroom: [media("manual")] });
  return <EvidenceContext.Provider value={currentScope}><button onClick={() => setPool(current => [...current, media("new")])}>Concurrent upload</button><output data-testid="state">{JSON.stringify({ pool, uploads })}</output><BulkPhotoAssign open={open} onClose={vi.fn()} pool={pool} setPool={setPool} uploads={uploads} setUploads={setUploads} fields={fields} prepareAutoAssign={mocks.prepare} /></EvidenceContext.Provider>;
}
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => { mocks.move.mockReset().mockResolvedValue(undefined); mocks.prepare.mockReset().mockResolvedValue(undefined); fetcher = vi.fn(async (url: string) => json(url.endsWith("/draft") ? draft() : response())); vi.stubGlobal("fetch", fetcher); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const state = () => JSON.parse(screen.getByTestId("state").textContent!);
async function analyse() { fireEvent.click(screen.getByRole("button", { name: "Auto assign", exact: true })); await screen.findByText("Bench and sink visible"); }

it("verifies older saved photos before analysing without re-uploading or auto-applying", async () => {
  const key = "forms/cleaner/old.jpg"; let ack: any;
  fetcher.mockImplementation(async (url: string, init: RequestInit) => {
    if (url.endsWith("/draft")) return json({ draft: { evidenceReceipts: ack ? { [ack.captureId]: { ...scope, key, version: 0, destination: { type: "bulkPool" } } } : {} } });
    if (url.endsWith("/evidence")) { ack = JSON.parse(init.body as string); return json({ ok: true, ...ack, version: 0 }); }
    return json(response([{ ...proposal(key), captureId: ack.captureId, version: 0 }]));
  });
  render(<Harness initialKeys={[key]} />); await analyse();
  expect(fetcher.mock.calls.map(call => call[0].split("/").pop())).toEqual(["draft", "evidence", "draft", "auto-assign"]);
  expect(ack).toMatchObject({ legacy: true, key, destination: { type: "bulkPool" }, templateId: scope.templateId, formRevision: scope.formRevision });
  expect(fetcher.mock.calls[1][1].headers["X-Cleaner-Draft-Identity"]).toBe(scope.draftIdentity);
  expect(mocks.move).not.toHaveBeenCalled(); expect(state().pool[0].key).toBe(key);
});
it("keeps legacy originals and never requests AI when verification fails", async () => {
  const key = "jobs/job/cleaner/old.jpg";
  fetcher.mockImplementation(async (url: string) => url.endsWith("/draft") ? json({ draft: { evidenceReceipts: {} } }) : json({ error: "Invalid evidence ownership." }, 403));
  render(<Harness initialKeys={[key]} />);
  fireEvent.click(screen.getByRole("button", { name: "Auto assign", exact: true }));
  await screen.findByText("Invalid evidence ownership.");
  expect(fetcher).toHaveBeenCalledTimes(2); expect(state().pool[0].key).toBe(key); expect(mocks.move).not.toHaveBeenCalled();
});
it("does not adopt old photos with another actor's existing receipt", async () => {
  const key = "forms/cleaner/old.jpg";
  fetcher.mockResolvedValue(json({ draft: { evidenceReceipts: { previous: { ...scope, draftIdentity: "other", key, version: 0, destination: { type: "bulkPool" } } } } }));
  render(<Harness initialKeys={[key]} />);
  fireEvent.click(screen.getByRole("button", { name: "Auto assign", exact: true }));
  await screen.findByText(/No photos are eligible/);
  expect(fetcher).toHaveBeenCalledTimes(1); expect(state().pool[0].key).toBe(key);
});
it("recovers a lost legacy acknowledgement from the server without adopting twice", async () => {
  const key = "forms/cleaner/old.jpg"; let ack: any;
  fetcher.mockImplementation(async (url: string, init: RequestInit) => {
    if (url.endsWith("/draft")) return json({ draft: { evidenceReceipts: ack ? { [ack.captureId]: { ...scope, key, version: 0, destination: { type: "bulkPool" } } } : {} } });
    if (url.endsWith("/evidence")) { ack = JSON.parse(init.body as string); throw new Error("Connection interrupted"); }
    return json(response([{ ...proposal(key), captureId: ack.captureId, version: 0 }]));
  });
  render(<Harness initialKeys={[key]} />);
  fireEvent.click(screen.getByRole("button", { name: "Auto assign", exact: true }));
  await screen.findByText("Connection interrupted");
  await analyse();
  expect(fetcher.mock.calls.filter(call => call[0].endsWith("/evidence"))).toHaveLength(1);
  expect(state().pool[0].key).toBe(key);
});

it("waits for confirmed draft save, proposes only unassigned receipts, and explicitly accepts high confidence through strict moves", async () => {
  const save = deferred<void>(); mocks.prepare.mockReturnValue(save.promise); render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Auto assign", exact: true })); expect(fetcher).not.toHaveBeenCalled();
  await act(async () => save.resolve()); await screen.findByText("Bench and sink visible");
  expect(JSON.parse(fetcher.mock.calls[1][1].body).photos.map((row: any) => row.key)).toEqual(["one", "two"]);
  expect(mocks.move).not.toHaveBeenCalled(); expect(screen.getByText("40% confidence · Review needed")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Accept 1 high-confidence suggestion" }));
  await waitFor(() => expect(state().uploads.kitchen.map((row: any) => row.key)).toEqual(["one"]));
  expect(mocks.move).toHaveBeenCalledWith(scope, media("one"), { type: "bulkPool" }, { type: "formField", fieldId: "kitchen" }, { captureId: "capture-one", version: 2 });
  expect(state().uploads.bathroom.map((row: any) => row.key)).toEqual(["manual"]); expect(state().pool.map((row: any) => row.key)).toEqual(["two"]);
  fireEvent.click(screen.getByRole("button", { name: /Photo one Kitchen photos/ })); fireEvent.click(screen.getByRole("button", { name: "Unassign" }));
  await waitFor(() => expect(state().pool.map((row: any) => row.key)).toContain("one"));
});
it("does not overwrite a manual assignment made while analysis is running", async () => {
  const pending = deferred<Response>(); fetcher.mockImplementation((url: string) => url.endsWith("/draft") ? Promise.resolve(json(draft())) : pending.promise); render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Auto assign", exact: true })); await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole("button", { name: "Photo one", exact: true })); fireEvent.click(screen.getByRole("button", { name: /Assign 1 to Kitchen photos/ }));
  await waitFor(() => expect(state().uploads.kitchen).toHaveLength(1)); await act(async () => pending.resolve(json(response())));
  expect(screen.queryByText("Bench and sink visible")).not.toBeInTheDocument(); expect(mocks.move).toHaveBeenCalledTimes(1);
});
it("keeps a concurrent upload when an accepted receipt resolves", async () => {
  const move = deferred<void>(); mocks.move.mockReturnValue(move.promise); render(<Harness />); await analyse();
  fireEvent.click(screen.getByRole("button", { name: "Accept 1 high-confidence suggestion" })); fireEvent.click(screen.getByRole("button", { name: "Concurrent upload" }));
  await act(async () => move.resolve()); expect(state().pool.map((row: any) => row.key)).toEqual(["two", "new"]);
});
it.each(["scope", "close"])("ignores late analysis after %s changes", async change => {
  const pending = deferred<Response>(); fetcher.mockImplementation((url: string) => url.endsWith("/draft") ? Promise.resolve(json(draft())) : pending.promise); const view = render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Auto assign", exact: true })); await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  view.rerender(<Harness currentScope={change === "scope" ? { ...scope, draftIdentity: "other" } : scope} open={change !== "close"} />);
  await act(async () => pending.resolve(json(response()))); if (change === "close") view.rerender(<Harness />);
  expect(screen.queryByText("Bench and sink visible")).not.toBeInTheDocument(); expect(mocks.move).not.toHaveBeenCalled();
});
it("cancels analysis without moving photos and retries only when requested", async () => {
  const pending = deferred<Response>(); fetcher.mockImplementation((url: string) => url.endsWith("/draft") ? Promise.resolve(json(draft())) : pending.promise); render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Auto assign", exact: true })); await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  const signal = fetcher.mock.calls[1][1].signal; fireEvent.click(screen.getByRole("button", { name: "Cancel analysis" })); expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(json(response()))); expect(screen.queryByText("Bench and sink visible")).not.toBeInTheDocument(); expect(fetcher).toHaveBeenCalledTimes(2);
  fetcher.mockImplementation(async (url: string) => json(url.endsWith("/draft") ? draft() : response())); await analyse(); expect(fetcher).toHaveBeenCalledTimes(4);
});
it("rejects unknown destinations without assigning any photos", async () => {
  fetcher.mockImplementation(async (url: string) => json(url.endsWith("/draft") ? draft() : response([proposal("one", "hidden-field"), proposal("two")]))); render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Auto assign", exact: true })); await screen.findByText(/Suggestions no longer match/); expect(mocks.move).not.toHaveBeenCalled(); expect(state().pool).toHaveLength(2);
});
it("retains photos after failed move and does not automatically retry", async () => {
  mocks.move.mockRejectedValue(new Error("Evidence receipt changed. Refresh suggestions before assigning.")); render(<Harness />); await analyse(); fireEvent.click(screen.getByRole("button", { name: "Accept 1 high-confidence suggestion" }));
  await screen.findByText(/0 photos assigned.*Evidence receipt changed/); expect(state().pool).toHaveLength(2); expect(mocks.move).toHaveBeenCalledTimes(1);
});
it("does not analyse after an unconfirmed draft save", async () => {
  mocks.prepare.mockRejectedValue(new Error("Draft save not confirmed")); render(<Harness />); fireEvent.click(screen.getByRole("button", { name: "Auto assign", exact: true }));
  await screen.findByText("Draft save not confirmed"); expect(fetcher).not.toHaveBeenCalled();
});
it("disables AI when durable scope is unavailable", () => { render(<Harness currentScope={null} />); expect(screen.getByRole("button", { name: "Auto assign", exact: true })).toBeDisabled(); });
it("reduces batch size once on a pre-provider limit rejection and completes all photos", async () => {
  fetcher.mockImplementation(async (url: string, init: RequestInit) => {
    if (url.endsWith("/draft")) return json(draft());
    const photos = JSON.parse(init.body as string).photos;
    return photos.length > 1 ? json({ error: "Use one photo per batch", maxBatchSize: 1 }, 400) : json(response(photos.map((photo: any) => proposal(photo.key))));
  }); render(<Harness />); fireEvent.click(screen.getByRole("button", { name: "Auto assign", exact: true }));
  await screen.findByText("Analysed 2 of 2 photos."); expect(fetcher).toHaveBeenCalledTimes(4); expect(mocks.move).not.toHaveBeenCalled();
});
it("analyses all nine acknowledged photos in sequential batches from one click", async () => {
  const keys = Array.from({ length: 9 }, (_, i) => `photo-${i}`);
  const receipts = Object.fromEntries(keys.map(key => [`capture-${key}`, { ...scope, key, version: 2, destination: { type: "bulkPool" } }]));
  fetcher.mockImplementation(async (url: string, init: RequestInit) => json(url.endsWith("/draft") ? { draft: { evidenceReceipts: receipts } } : response(JSON.parse(init.body as string).photos.map((photo: any) => proposal(photo.key)))));
  render(<Harness initialKeys={keys} />); fireEvent.click(screen.getByRole("button", { name: "Auto assign", exact: true }));
  await screen.findByText("Analysed 9 of 9 photos.");
  expect(fetcher.mock.calls.slice(1).map(call => JSON.parse(call[1].body).photos.length)).toEqual([4, 4, 1]);
  expect(screen.getByRole("button", { name: "Accept 9 high-confidence suggestions" })).toBeEnabled(); expect(mocks.move).not.toHaveBeenCalled();
});
it("cancels a later batch, keeps completed review, and retries only remaining photos", async () => {
  const keys = Array.from({ length: 6 }, (_, i) => `photo-${i}`);
  const receipts = Object.fromEntries(keys.map(key => [`capture-${key}`, { ...scope, key, version: 2, destination: { type: "bulkPool" } }]));
  const pending = deferred<Response>(); let posts = 0;
  fetcher.mockImplementation(async (url: string, init: RequestInit) => {
    if (url.endsWith("/draft")) return json({ draft: { evidenceReceipts: receipts } });
    if (++posts === 2) return pending.promise;
    return json(response(JSON.parse(init.body as string).photos.map((photo: any) => proposal(photo.key))));
  }); render(<Harness initialKeys={keys} />); fireEvent.click(screen.getByRole("button", { name: "Auto assign", exact: true }));
  await screen.findByText("Analysed 4 of 6 photos."); await waitFor(() => expect(posts).toBe(2)); fireEvent.click(screen.getByRole("button", { name: "Cancel analysis" }));
  expect(screen.getByRole("button", { name: "Accept 4 high-confidence suggestions" })).toBeEnabled();
  await act(async () => pending.resolve(json(response(keys.slice(4).map(key => proposal(key))))));
  fireEvent.click(screen.getByRole("button", { name: "Auto assign", exact: true })); await screen.findByText("Analysed 2 of 2 photos.");
  expect(JSON.parse(fetcher.mock.calls.at(-1)![1].body).photos.map((photo: any) => photo.key)).toEqual(keys.slice(4));
  expect(screen.getByRole("button", { name: "Accept 6 high-confidence suggestions" })).toBeEnabled();
});
it("keeps completed suggestions after an uncertain later request and never automatically resends it", async () => {
  const keys = Array.from({ length: 6 }, (_, i) => `photo-${i}`);
  const receipts = Object.fromEntries(keys.map(key => [`capture-${key}`, { ...scope, key, version: 2, destination: { type: "bulkPool" } }]));
  let posts = 0;
  fetcher.mockImplementation(async (url: string, init: RequestInit) => {
    if (url.endsWith("/draft")) return json({ draft: { evidenceReceipts: receipts } });
    if (++posts === 2) throw new Error("Connection lost during analysis");
    return json(response(JSON.parse(init.body as string).photos.map((photo: any) => proposal(photo.key))));
  }); render(<Harness initialKeys={keys} />); fireEvent.click(screen.getByRole("button", { name: "Auto assign", exact: true }));
  await screen.findByText("Connection lost during analysis"); expect(posts).toBe(2);
  expect(screen.getByRole("button", { name: "Accept 4 high-confidence suggestions" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Auto assign", exact: true })); await screen.findByText("Analysed 2 of 2 photos.");
  expect(posts).toBe(3); expect(JSON.parse(fetcher.mock.calls.at(-1)![1].body).photos.map((photo: any) => photo.key)).toEqual(keys.slice(4));
});
it("gives each request its own deadline rather than timing out a long successful multi-batch run", async () => {
  vi.useFakeTimers();
  const keys = Array.from({ length: 9 }, (_, i) => `photo-${i}`);
  const receipts = Object.fromEntries(keys.map(key => [`capture-${key}`, { ...scope, key, version: 2, destination: { type: "bulkPool" } }]));
  fetcher.mockImplementation((url: string, init: RequestInit) => url.endsWith("/draft") ? Promise.resolve(json({ draft: { evidenceReceipts: receipts } })) : new Promise(resolve => setTimeout(() => resolve(json(response(JSON.parse(init.body as string).photos.map((photo: any) => proposal(photo.key))))), 40_000)));
  render(<Harness initialKeys={keys} />); fireEvent.click(screen.getByRole("button", { name: "Auto assign", exact: true }));
  await act(async () => { await vi.advanceTimersByTimeAsync(120_001); });
  expect(screen.getByText("Analysed 9 of 9 photos.")).toBeVisible(); expect(fetcher).toHaveBeenCalledTimes(4);
  expect(fetcher.mock.calls.every(call => !call[1].signal.aborted)).toBe(true);
});
