import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceApi } from "@/components/v2/cleaner/job-stages/shared";

const device = vi.hoisted(() => ({ gps: vi.fn() }));
vi.mock("@/lib/cleaner/evidence-store", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/cleaner/evidence-store")>(), listEvidence: vi.fn(async () => []),
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/geo/get-position", () => ({ getAccuratePosition: device.gps }));
vi.mock("@/components/v2/admin/estate-kit", () => ({ EModal: () => null }));
vi.mock("@/components/v2/cleaner/contact-sheet", () => ({ ContactSheet: () => null }));
vi.mock("@/components/v2/cleaner/property-info-drawer", () => ({ PropertyInfoDrawer: () => null }));
vi.mock("@/components/v2/cleaner/start-briefing-dialog", () => ({ StartBriefingDialog: () => null }));
vi.mock("@/components/v2/cleaner/final-checkup-dialog", () => ({ FinalCheckupDialog: () => null }));
vi.mock("@/components/v2/cleaner/job-stages/timing-banner", () => ({ TimingRuleBanners: () => null }));
vi.mock("@/components/v2/cleaner/job-stages/job-header", () => ({ JobHeader: ({ api }: { api: WorkspaceApi }) => (
  <><span data-testid="job-status">{api.status}</span><button onClick={() => void api.load()}>Refresh fixture</button></>
) }));
vi.mock("@/components/v2/cleaner/job-stages/stage-nav", () => ({ StageNav: () => null }));
vi.mock("@/components/v2/cleaner/job-stages/stage-accept", () => ({ StageAccept: () => null }));
vi.mock("@/components/v2/cleaner/job-stages/stage-travel", () => ({ StageTravel: () => null }));
vi.mock("@/components/v2/cleaner/job-stages/stage-setup", () => ({ StageSetup: () => null }));
vi.mock("@/components/v2/cleaner/job-stages/stage-clean", () => ({ StageClean: FixtureStage }));
vi.mock("@/components/v2/cleaner/job-stages/stage-wrapup", () => ({ StageWrapup: FixtureStage }));
vi.mock("@/components/v2/cleaner/job-stages/stage-footer", () => ({ StageFooterNav: () => null }));
vi.mock("@/components/v2/cleaner/job-stages/action-fab", () => ({ ActionFab: () => null }));

import { JobWorkspace } from "@/components/v2/cleaner/job-workspace";

// Only presentation is replaced: these controls invoke the real parent's
// editing, validation, submission and refresh callbacks. Save/status stay real.
function FixtureStage({ api }: { api: WorkspaceApi }) {
  return <>
    <label>Fixture answer<input value={String(api.answers.note ?? "")} disabled={api.locked}
      onChange={(event) => api.onAnswer("note", event.target.value)} /></label>
    <button disabled={api.locked || Boolean(api.busy)} onClick={api.requestSubmit}>Submit fixture</button>
  </>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const acknowledgement = () => json({ ok: true, updatedAt: "2026-09-09T10:00:00Z" });
const draftEnvelope = (note = "server answer") => ({ draft: {
  updatedAt: "2026-09-09T10:00:00Z", updatedByUserId: "other-cleaner",
  updatedByName: "Other Cleaner", editorSessionId: "other-editor",
  state: { updatedAt: "2026-09-09T10:00:00Z", answers: { note } },
} });
const identity = "a".repeat(64);
const mirrorKey = `cleaner-job-draft-v3:${identity}`;
const localEnvelope = (state: Record<string, unknown>) => JSON.stringify({ version: 1, identity, state });
function form(status = "IN_PROGRESS") {
  return {
    draftIdentity: identity,
    formRevision: "b".repeat(64),
    job: { id: "job", status, jobType: "GENERAL_CLEAN", propertyId: "property",
      property: { id: "property", name: "Test property", laundryEnabled: false } },
    template: { id: "template", schema: { sections: [] } },
    jobTasks: [], assignmentState: { responseStatus: "ACCEPTED" },
    timeState: { isRunning: false, completedSeconds: 60 },
    requireJobStartConfirmation: false, finalCheckup: { items: [] },
  };
}
let patches: { body: any; options: RequestInit; response: ReturnType<typeof deferred<Response>> }[];
let submitResponse: ReturnType<typeof deferred<Response>>;
let gpsResponse: ReturnType<typeof deferred<{ lat: number; lng: number; accuracy: number }>>;
let formResponses: Promise<Response>[];
let fetchMock: ReturnType<typeof vi.fn>;
let unexpected: string[];
let currentStatus: string;
let readDraft: () => Promise<Response>;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  patches = []; formResponses = []; unexpected = []; currentStatus = "IN_PROGRESS";
  readDraft = () => Promise.resolve(json({ draft: null }));
  submitResponse = deferred<Response>(); gpsResponse = deferred();
  device.gps.mockReset().mockReturnValue(gpsResponse.promise);
  // The client has no independent auth fetch: authenticated form/briefing/draft
  // responses are fixtures; PATCH 401/403 behavior is exercised below.
  fetchMock = vi.fn((input: RequestInfo | URL, options: RequestInit = {}) => {
    const url = String(input); const method = options.method ?? "GET";
    if (url === "/api/jobs/job/form" && method === "GET") return formResponses.shift() ?? Promise.resolve(json(form(currentStatus)));
    if (url === "/api/cleaner/jobs/job/briefing" && method === "GET") return Promise.resolve(json({}));
    if (url === "/api/cleaner/property-access/property" && method === "GET") return Promise.resolve(json({}));
    if (url === "/api/cleaner/jobs/job/draft") {
      if (method === "GET") return readDraft();
      if (method === "DELETE") return Promise.resolve(json({ ok: true }));
      if (method === "PATCH") {
        const response = deferred<Response>();
        patches.push({ body: JSON.parse(String(options.body)), options, response });
        return response.promise;
      }
    }
    if (url === "/api/cleaner/jobs/job/submit" && method === "POST") return submitResponse.promise;
    if (url === "/api/cleaner/jobs/job/gps-checkout" && method === "POST") return Promise.resolve(json({ ok: true }));
    unexpected.push(`${method} ${url}`);
    return Promise.reject(new Error(`Unexpected fixture request: ${method} ${url}`));
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
  expect(unexpected).toEqual([]);
});

async function mount(expectForm = true) {
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(<JobWorkspace key={identity} jobId="job" draftIdentity={identity} />); });
  if (expectForm) expect(screen.getByLabelText("Fixture answer")).toBeInTheDocument();
  return view;
}
const edit = (value: string) => fireEvent.change(screen.getByLabelText("Fixture answer"), { target: { value } });
async function advance(ms = 1500) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function respond(index: number, response = acknowledgement()) {
  await act(async () => { patches[index].response.resolve(response); });
}
const calls = (suffix: string, method: string) => fetchMock.mock.calls.filter(([url, options]) => String(url).endsWith(suffix) && (options?.method ?? "GET") === method);
async function submit() {
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Submit fixture" })); });
  expect(calls("/submit", "POST")).toHaveLength(1);
  currentStatus = "SUBMITTED";
  await act(async () => { submitResponse.resolve(json({ ok: true, submissionId: "submission" })); });
  expect(device.gps).toHaveBeenCalledTimes(1);
  expect(calls("/draft", "DELETE")).toHaveLength(1);
}

describe("real JobWorkspace draft lifecycle", () => {
  it("keeps answers and the local evidence draft when the server rejects a changed form", async () => {
    await mount(); edit("keep my work"); await advance();
    fireEvent.click(screen.getByRole("button", { name: "Submit fixture" }));
    await act(async () => { submitResponse.resolve(json({ code: "FORM_CHANGED",
      error: "The job form changed. Your answers and evidence have been kept." }, 409)); });
    expect(screen.getByLabelText("Fixture answer")).toHaveValue("keep my work");
    expect(localStorage.getItem(mirrorKey)).toContain("keep my work");
    expect(calls("/draft", "DELETE")).toHaveLength(0);
    expect(device.gps).not.toHaveBeenCalled();
    expect(screen.getByText(/The job form changed/)).toBeInTheDocument();
  });
  it("invalidates active and queued draft saves when refresh detects a different actor", async () => {
    await mount(); edit("first"); await advance();
    edit("queued"); await advance();
    expect(patches).toHaveLength(1);
    const mirror = localStorage.getItem(mirrorKey);
    formResponses.push(Promise.resolve(json({ ...form(), draftIdentity: "b".repeat(64) })));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Refresh fixture" })); });
    expect(screen.getByRole("button", { name: "Reload workspace" })).toBeInTheDocument();
    await respond(0); await advance();
    fireEvent(window, new Event("pagehide")); await advance(0);
    expect(patches).toHaveLength(1);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(localStorage.getItem(mirrorKey)).toBe(mirror);
  });

  it("refuses a different actor context before reading or writing drafts", async () => {
    formResponses.push(Promise.resolve(json({ ...form(), draftIdentity: "b".repeat(64) })));
    localStorage.setItem(mirrorKey, localEnvelope({ answers: { note: "retained" } }));
    await mount(false); await advance();
    expect(screen.getByRole("button", { name: "Reload workspace" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Fixture answer")).not.toBeInTheDocument();
    expect(calls("/draft", "GET")).toHaveLength(0);
    expect(patches).toHaveLength(0);
    expect(localStorage.getItem(mirrorKey)).toContain("retained");
  });

  it("does not restore legacy or other-identity local answers and sends the identity header", async () => {
    const legacy = "cleaner-job-draft-v2:job";
    localStorage.setItem(legacy, JSON.stringify({ answers: { note: "legacy private" } }));
    localStorage.setItem(`cleaner-job-draft-v3:${"b".repeat(64)}`, JSON.stringify({ version: 1, identity: "b".repeat(64), state: { answers: { note: "other private" } } }));
    await mount();
    expect(screen.getByLabelText("Fixture answer")).toHaveValue("");
    expect(screen.getByText(/older unscoped local draft was not loaded/i)).toBeInTheDocument();
    expect(calls("/draft", "GET")[0][1].headers).toMatchObject({ "X-Cleaner-Draft-Identity": identity });
    edit("current actor"); await advance();
    expect(patches[0].options.headers).toMatchObject({ "X-Cleaner-Draft-Identity": identity });
    expect(patches[0].body.state.answers.note).toBe("current actor");
    await respond(0);
    await submit();
    expect(calls("/draft", "DELETE")[0][1].headers).toMatchObject({ "X-Cleaner-Draft-Identity": identity });
    expect(localStorage.getItem(legacy)).toContain("legacy private");
  });

  it.each(["http", "parse", "network"] as const)("blocks saves and preserves the mirror after failed initial read (%s), then restores on retry", async (failure) => {
    const mirror = localEnvelope({ answers: { localOnly: "unsent" }, updatedAt: "2026-09-08T10:00:00Z" });
    localStorage.setItem(mirrorKey, mirror);
    readDraft = () => failure === "network"
      ? Promise.reject(new Error("Draft read unavailable"))
      : Promise.resolve(failure === "http" ? json({}, 503) : new Response("{"));
    await mount(false);
    expect(screen.getByText(/Could not restore saved progress/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Fixture answer")).not.toBeInTheDocument();
    expect(calls("/draft", "GET")).toHaveLength(1);
    await advance();
    expect(patches).toHaveLength(0);
    fireEvent(window, new Event("pagehide"));
    await advance(0);
    expect(patches).toHaveLength(0);
    expect(localStorage.getItem(mirrorKey)).toBe(mirror);
    readDraft = () => Promise.resolve(json(draftEnvelope()));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Try again" })); });
    expect(calls("/draft", "GET")).toHaveLength(2);
    expect(screen.getByLabelText("Fixture answer")).toHaveValue("server answer");
    await advance();
    expect(patches).toHaveLength(1);
    expect(patches[0].body.state.answers).toEqual({ note: "server answer", localOnly: "unsent" });
    await respond(0);
    expect(screen.getByRole("status")).toHaveTextContent("Draft save confirmed");
  });

  it.each([null, {}, { draft: [] }, { draft: {} },
    { draft: { ...draftEnvelope().draft, state: [] } },
    { draft: { ...draftEnvelope().draft, editorSessionId: null } },
  ])("rejects malformed draft envelope %j without overwriting local progress", async (body) => {
    const mirror = localEnvelope({ answers: { note: "local" } });
    localStorage.setItem(mirrorKey, mirror);
    readDraft = () => Promise.resolve(json(body));
    await mount(false); await advance();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(patches).toHaveLength(0);
    expect(localStorage.getItem(mirrorKey)).toBe(mirror);
  });

  it("a confirmed empty server draft restores local progress and enables saving", async () => {
    localStorage.setItem(mirrorKey, localEnvelope({ answers: { note: "local answer" } }));
    await mount();
    expect(screen.getByLabelText("Fixture answer")).toHaveValue("local answer");
    await advance(); expect(patches[0].body.state.answers.note).toBe("local answer");
    await respond(0);
  });

  it.each(["success", "failure"])("ignores stale initial hydration %s after a newer load restores and the user edits", async (outcome) => {
    const older = deferred<Response>();
    let readCount = 0;
    readDraft = () => ++readCount === 1 ? older.promise : Promise.resolve(json(draftEnvelope("newer restoration")));
    const mirror = localEnvelope({ answers: { localOnly: "unsent" } });
    localStorage.setItem(mirrorKey, mirror);
    await mount(false);
    await advance(); fireEvent(window, new Event("pagehide")); await advance(0);
    expect(patches).toHaveLength(0);
    expect(localStorage.getItem(mirrorKey)).toBe(mirror);
    await act(async () => { fireEvent(window, new Event("focus")); });
    expect(calls("/draft", "GET")).toHaveLength(2);
    expect(screen.getByLabelText("Fixture answer")).toHaveValue("newer restoration");
    edit("new edit");
    await act(async () => { older.resolve(outcome === "success" ? json(draftEnvelope("stale restoration")) : json({}, 503)); });
    expect(screen.getByLabelText("Fixture answer")).toHaveValue("new edit");
    expect(screen.queryByText(/Could not restore saved progress/)).not.toBeInTheDocument();
    await advance();
    expect(patches).toHaveLength(1);
    expect(patches[0].body.state.answers.note).toBe("new edit");
    await respond(0);
  });

  it("focus refreshes keep the active control mounted on success and failure without restoring again", async () => {
    await mount();
    const input = screen.getByLabelText("Fixture answer");
    edit("upload in progress");
    const refresh = deferred<Response>(); formResponses.push(refresh.promise);
    await act(async () => { fireEvent(window, new Event("focus")); });
    expect(screen.getByLabelText("Fixture answer")).toBe(input);
    await act(async () => { refresh.resolve(json({}, 503)); });
    expect(screen.getByLabelText("Fixture answer")).toBe(input);
    expect(input).toHaveValue("upload in progress");
    await act(async () => { fireEvent(window, new Event("focus")); });
    expect(screen.getByLabelText("Fixture answer")).toBe(input);
    expect(calls("/draft", "GET")).toHaveLength(1);
    await advance(); await respond(0);
  });

  it.each([401, 403])("refresh %s removes job content/actions and invalidates queued saves even with a non-JSON error", async (status) => {
    await mount(); edit("running"); await advance();
    edit("queued"); await advance();
    expect(patches).toHaveLength(1);
    const mirror = localStorage.getItem(mirrorKey);
    formResponses.push(Promise.resolve(new Response("Access denied", { status })));
    await act(async () => { fireEvent(window, new Event("focus")); });
    expect(screen.queryByTestId("job-status")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Fixture answer")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit fixture" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByText(status === 401 ? "Sign in again to access this job." : "You no longer have access to this job.")).toBeInTheDocument();
    await respond(0);
    fireEvent(window, new Event("pagehide")); await advance(5000);
    expect(patches).toHaveLength(1);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry save" })).not.toBeInTheDocument();
    expect(localStorage.getItem(mirrorKey)).toBe(mirror);

    // A successful authorization retry must restore again, not trust the old
    // hydrated flag. Hold that read to verify pagehide cannot save prematurely.
    const restoration = deferred<Response>(); readDraft = () => restoration.promise;
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Try again" })); });
    expect(calls("/draft", "GET")).toHaveLength(2);
    fireEvent(window, new Event("pagehide")); await advance();
    expect(patches).toHaveLength(1);
    expect(screen.queryByLabelText("Fixture answer")).not.toBeInTheDocument();
    await act(async () => { restoration.resolve(json({ draft: null })); });
    expect(screen.getByLabelText("Fixture answer")).toHaveValue("queued");
    await advance(); expect(patches).toHaveLength(2);
    await respond(1);
  });

  it("stale initial success cannot hydrate after a newer restoration fails", async () => {
    const older = deferred<Response>();
    let reads = 0;
    readDraft = () => ++reads === 1 ? older.promise : Promise.resolve(json({}, 503));
    const mirror = localEnvelope({ answers: { note: "local progress" } });
    localStorage.setItem(mirrorKey, mirror);
    await mount(false);
    await act(async () => { fireEvent(window, new Event("focus")); });
    expect(calls("/draft", "GET")).toHaveLength(2);
    expect(screen.getByText(/Could not restore saved progress/)).toBeInTheDocument();
    await act(async () => { older.resolve(json(draftEnvelope("stale success"))); });
    fireEvent(window, new Event("pagehide")); await advance();
    expect(screen.queryByLabelText("Fixture answer")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(localStorage.getItem(mirrorKey)).toBe(mirror);
    expect(patches).toHaveLength(0);
  });

  it("mirrors edits immediately and debounces without a PATCH on each cleanup or acknowledgement loop", async () => {
    const view = await mount();
    edit("first"); await advance(700);
    edit("latest");
    expect(JSON.parse(localStorage.getItem(mirrorKey)!).state.answers.note).toBe("latest");
    expect(patches).toHaveLength(0);
    await advance(1499); expect(patches).toHaveLength(0);
    await advance(1); expect(patches).toHaveLength(1);
    expect(patches[0].body.state.answers.note).toBe("latest");
    expect(screen.getByRole("status")).toHaveTextContent("Saving draft...");
    await respond(0);
    expect(screen.getByRole("status")).toHaveTextContent("Draft save confirmed");
    await advance(5000); expect(patches).toHaveLength(1);
    edit("local before leaving"); view.unmount(); await advance();
    expect(patches).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(mirrorKey)!).state.answers.note).toBe("local before leaving");
  });

  it.each([401, 403, 503])("shows a failed PATCH %s and retries the current snapshot through the real status button", async (status) => {
    await mount(); edit("retry me"); await advance();
    await respond(0, json({ error: "private server details" }, status));
    expect(screen.getByRole("alert")).toHaveTextContent("Draft not saved");
    expect(screen.queryByText(/private server details/)).not.toBeInTheDocument();
    expect(localStorage.getItem(mirrorKey)).toContain("retry me");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retry save" })); });
    expect(patches).toHaveLength(2);
    expect(patches[1].body.state.answers).toEqual({ note: "retry me" });
    await respond(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Draft save confirmed");
  });

  it("an edit invalidates an older acknowledgement before the next debounce sends", async () => {
    await mount(); edit("old"); await advance();
    edit("new"); await respond(0);
    expect(screen.getByRole("status")).toHaveTextContent("Saving draft...");
    expect(patches).toHaveLength(1);
    await advance(); expect(patches[1].body.state.answers.note).toBe("new");
    await respond(1); expect(screen.getByRole("status")).toHaveTextContent("Draft save confirmed");
  });

  it.each([200, 409])("submit drops queued saves and suppresses a late PATCH %s while GPS is pending", async (status) => {
    await mount(); edit("running"); await advance();
    edit("queued"); await advance();
    expect(patches).toHaveLength(1); // Second snapshot waits in the real hook.
    await submit();
    expect(JSON.parse(String(calls("/submit", "POST")[0][1].body)).data.note).toBe("queued");
    expect(JSON.parse(String(calls("/submit", "POST")[0][1].body))).toMatchObject({
      formContractVersion: 1, formRevision: "b".repeat(64),
    });
    expect(localStorage.getItem(mirrorKey)).toBeNull();
    await respond(0, status === 200 ? acknowledgement() : json({}, status));
    fireEvent(window, new Event("pagehide")); await advance(5000);
    expect(patches).toHaveLength(1);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry save" })).not.toBeInTheDocument();
    expect(localStorage.getItem(mirrorKey)).toBeNull();
    expect(calls("/form", "GET")).toHaveLength(1); // GPS has prevented the submit refresh.
    await act(async () => { gpsResponse.resolve({ lat: -33, lng: 151, accuracy: 5 }); });
    expect(screen.getByTestId("job-status")).toHaveTextContent("SUBMITTED");
    await advance(); expect(patches).toHaveLength(1);
    expect(localStorage.getItem(mirrorKey)).toBeNull();
  });

  it("a pre-submit refresh cannot release the submit guard; a fresh reopened read resumes saving", async () => {
    await mount(); edit("submitted answer");
    const stale = deferred<Response>(); formResponses.push(stale.promise);
    fireEvent.click(screen.getByRole("button", { name: "Refresh fixture" }));
    await submit();
    await act(async () => { stale.resolve(json(form("IN_PROGRESS"))); });
    fireEvent(window, new Event("pagehide")); await advance();
    expect(patches).toHaveLength(0);
    expect(localStorage.getItem(mirrorKey)).toBeNull();
    currentStatus = "IN_PROGRESS";
    await act(async () => { gpsResponse.resolve({ lat: -33, lng: 151, accuracy: 5 }); });
    edit("reopened answer");
    expect(JSON.parse(localStorage.getItem(mirrorKey)!).state.answers.note).toBe("reopened answer");
    await advance(); expect(patches).toHaveLength(1);
    expect(patches[0].body.state.answers.note).toBe("reopened answer");
    await respond(0); expect(screen.getByRole("status")).toHaveTextContent("Draft save confirmed");
  });
});
