import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiConfigurationWorkspace } from "@/components/v2/admin/ai/ai-configuration-workspace";
import { AI_FEATURES, DEFAULT_AI_ROUTING, type AiRoutingSettings } from "@/lib/ai/provider/routing-schema";
import { DEFAULT_VISION_SETTINGS } from "@/lib/ai/vision-settings-schema";

vi.mock("@/components/v2/admin/settings/ollama-section", () => ({ OllamaSection: () => <p>Ollama setup panel</p> }));
vi.mock("@/components/v2/admin/property-photo-memory", () => ({ PropertyPhotoMemoryPanel: () => <p>Photo memory panel</p> }));

const NOW = new Date();
const iso = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();

function configuredRouting(): AiRoutingSettings {
  const routing = structuredClone(DEFAULT_AI_ROUTING);
  routing.revision = 3;
  routing.defaultRoute = { provider: "anthropic", model: "claude-haiku-4-5" };
  routing.features.photo_compare.route = { provider: "ollama", model: "qwen2.5vl:7b" };
  routing.features.photo_assign.route = { provider: "anthropic", model: "claude-sonnet-4-5" };
  routing.features.assistant.route = { provider: "anthropic", model: "claude-sonnet-4-5" };
  routing.features.draft_reply.route = { provider: "openai_compatible", model: "meta-llama-3.1-70b" };
  routing.compatible = { baseUrl: "https://api.together.xyz/v1", label: "Together" };
  return routing;
}

function routeRows(routing: AiRoutingSettings) {
  return AI_FEATURES.map((feature) => {
    const route = routing.features[feature].route ?? (feature.startsWith("photo") ? { provider: "ollama", model: "qwen2.5vl:7b" } : routing.defaultRoute ?? { provider: "anthropic", model: "claude-sonnet-5" });
    return { feature, provider: route.provider, model: route.model, configured: true, enabled: routing.features[feature].enabled, cloud: route.provider !== "ollama", allowImages: route.provider === "ollama", source: routing.features[feature].route ? "feature" : "default", error: null };
  });
}

function configuredState(overrides: Record<string, unknown> = {}) {
  const routing = configuredRouting();
  return {
    routing,
    credentials: [
      { provider: "anthropic", state: "environment", hint: "••••a9F2" },
      { provider: "openai", state: "missing", hint: null },
      { provider: "openai_compatible", state: "saved", hint: "••••7Qe1" },
    ],
    routes: routeRows(routing),
    usage: { monthLabel: "November 2026", timezone: "Australia/Sydney", rows: [
      { feature: "assistant", provider: "anthropic", model: "claude-sonnet-4-5", calls: 61, succeeded: 61, failed: 0, refused: 0, inputTokens: 3_600_000, outputTokens: 230_000, knownCostMicroUsd: 14_200_000, unknownCostCalls: 0 },
      { feature: "draft_reply", provider: "openai_compatible", model: "meta-llama-3.1-70b", calls: 9, succeeded: 7, failed: 2, refused: 0, inputTokens: 20_000, outputTokens: 10_000, knownCostMicroUsd: 0, unknownCostCalls: 9 },
      { feature: "photo_compare", provider: "ollama", model: "qwen2.5vl:7b", calls: 1020, succeeded: 1020, failed: 0, refused: 0, inputTokens: 2_900_000, outputTokens: 310_000, knownCostMicroUsd: 0, unknownCostCalls: 0 },
    ] },
    timezone: "Australia/Sydney",
    status: {
      lastTests: {
        photo_compare: { status: "SUCCEEDED", at: iso(60), ok: true, message: "Two-image comparison returned a valid result.", provider: "ollama", model: "qwen2.5vl:7b", durationMs: 4100, detail: null },
        assistant: { status: "SUCCEEDED", at: iso(90), ok: true, message: "Text generation returned valid structured output.", provider: "anthropic", model: "claude-sonnet-4-5", durationMs: 2300, detail: null },
        draft_reply: { status: "FAILED", at: iso(30), ok: false, message: "The provider did not return a usable result.", provider: null, model: null, durationMs: 900, detail: "AUTH · openai_compatible" },
      },
      providers: { openai_compatible: { lastOkAt: iso(3000), lastFailure: { at: iso(20), outcome: "PROVIDER_ERROR", errorCode: "AUTH", feature: "draft_reply" }, failuresSinceOk: 4 } },
      limitHits: { assistant: { resetsAt: new Date(NOW.getTime() + 30 * 60_000).toISOString(), people: [{ name: "Chloe Martin", used: 60 }, { name: "Ravi Mehta", used: 60 }] } },
      lastSaved: { at: iso(40), by: "Hannah Lee" },
      ollama: { configured: true, host: "sneek-ollama:11434", textModel: "llama3.1:8b", visionModel: "qwen2.5vl:7b", useForText: false },
    },
    canEdit: true,
    isAdmin: true,
    encryptionReady: true,
    ...overrides,
  };
}

function emptyState() {
  const routing = structuredClone(DEFAULT_AI_ROUTING);
  return {
    routing,
    credentials: [
      { provider: "anthropic", state: "missing", hint: null },
      { provider: "openai", state: "missing", hint: null },
      { provider: "openai_compatible", state: "missing", hint: null },
    ],
    routes: routeRows(routing).map((row) => ({ ...row, configured: false })),
    usage: { monthLabel: "November 2026", timezone: "Australia/Sydney", rows: [] },
    timezone: "Australia/Sydney",
    status: { lastTests: {}, providers: {}, limitHits: {}, lastSaved: null, ollama: { configured: false, host: null, textModel: null, visionModel: null, useForText: false } },
    canEdit: true,
    isAdmin: true,
    encryptionReady: true,
  };
}

const vision = { ...DEFAULT_VISION_SETTINGS, provider: "ollama" as const, model: "qwen2.5vl:7b", comparisonEnabled: true, assignmentEnabled: true, minConfidence: 0.7 };
const optOut = { revision: 1, propertyIds: ["p1"], corrupt: false, properties: [{ id: "p1", name: "Bronte Flat", suburb: "Bronte" }, { id: "p2", name: "Vaucluse House", suburb: "Vaucluse" }] };

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response> | undefined;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const fetchMock = vi.fn();

function serve(settings: unknown, extra?: Handler) {
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const custom = extra?.(url, init);
    if (custom) return custom;
    if (url.includes("/api/me/admin-pin")) return json({ hasPin: true, lockedUntil: null, userId: "admin-1", attemptsLeft: 5 });
    if (url.includes("/api/admin/ai/settings")) return json(settings);
    if (url.includes("/api/admin/ai/vision")) return json({ settings: vision, recognitionConfigured: false });
    if (url.includes("/api/admin/ai/photo-review-opt-out")) return json(optOut);
    return json({ error: "unexpected" }, 500);
  });
}

function renderPage(props: Partial<React.ComponentProps<typeof AiConfigurationWorkspace>> = {}) {
  return render(<AiConfigurationWorkspace canEdit readOnlyReason={null} timezone="Australia/Sydney" agreement={{ since: iso(90 * 1440), rows: [{ provider: "ollama", model: "qwen2.5vl:7b", reviews: 412, photos: 900, cannotTell: 4, notChecked: 2, findings: 386, confirmed: 301, notSelected: 52, dismissed: 33, agreement: 0.78 }], skipped: 0 }} recognitionConfigured={false} initialSection={null} {...props} />);
}

beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("AI configuration page", () => {
  it("shows the first-run guide instead of Sections 1 to 4 while nothing is set up, with Section 5 visible", async () => {
    serve(emptyState());
    renderPage();
    expect(await screen.findByRole("heading", { name: "Set up your first provider" })).toBeVisible();
    expect(screen.getByText("AI is not set up")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Where AI runs" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Privacy and safety" })).toBeVisible();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Show every setting anyway" }));
    expect(screen.getByRole("heading", { name: "Where AI runs" })).toBeVisible();
  });

  it("first run offers Ollama setup and a cloud key with a provider choice", async () => {
    serve(emptyState());
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Set up Ollama" }));
    expect(screen.getByText("Ollama setup panel")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add a cloud key" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Provider"), { target: { value: "openai" } });
    expect(within(dialog).getByRole("heading", { name: "Add an OpenAI key" })).toBeInTheDocument();
  });

  it("renders the configured page: status strip, provider bands, last four, unknown cost as Not known and unbuilt features", async () => {
    serve(configuredState());
    renderPage();
    expect(await screen.findByRole("heading", { name: "Where AI runs" })).toBeVisible();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const strip = screen.getByRole("region", { name: "AI status" });
    expect(within(strip).getByText("AI is on")).toBeInTheDocument();
    expect(within(strip).getByText("2 providers connected")).toBeInTheDocument();
    expect(within(strip).getByText(/1 endpoint failing/)).toBeInTheDocument();
    expect(within(strip).getByText("Photos stay on this server")).toBeInTheDocument();
    expect(within(strip).getByText("About $14.20 this month")).toBeInTheDocument();
    const anthropic = screen.getByRole("region", { name: "Anthropic" });
    expect(within(anthropic).getByText("Connected")).toBeInTheDocument();
    expect(within(anthropic).getByText(/••••a9F2/)).toBeInTheDocument();
    const together = screen.getByRole("region", { name: "Together (OpenAI-compatible)" });
    expect(within(together).getByText("Failing")).toBeInTheDocument();
    expect(within(together).getByText("The key was refused")).toBeInTheDocument();
    expect(within(together).getByText(/What people see/)).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "OpenAI" })).getByText("Not set up")).toBeInTheDocument();
    expect(screen.getAllByText("Not known").length).toBeGreaterThan(0);
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
    expect(screen.getAllByText(/Not available yet/).length).toBeGreaterThan(0);
    expect(screen.getByText("All changes saved", { exact: false })).toBeInTheDocument();
  });

  it("shows the blocked photo feature with its two ways out and the limit-hit card", async () => {
    serve(configuredState());
    renderPage();
    await screen.findByRole("heading", { name: "What AI does" });
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use Local Ollama" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /Allow photos to go to Anthropic/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/time and address stamp blacked out/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Allow photos" }));
    await waitFor(() => expect(screen.queryByText("Blocked")).not.toBeInTheDocument());
    expect(screen.getByText("Limit hit")).toBeInTheDocument();
    expect(screen.getByText(/Chloe Martin \(60\), Ravi Mehta \(60\)/)).toBeInTheDocument();
  });

  it("keeps the draft on a stale save, names who saved first and offers both resolutions", async () => {
    const state = configuredState();
    serve(state, (url, init) => (url.includes("/settings") && init?.method === "PUT" ? json({ error: "stale", current: { ...state.routing, revision: 5 }, savedBy: { at: iso(1), by: "Hannah Lee" } }, 409) : undefined));
    renderPage();
    await screen.findByRole("heading", { name: "What AI does" });
    const limit = screen.getAllByLabelText("Requests per person per hour: Social post drafts")[0];
    fireEvent.change(limit, { target: { value: "45" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save changes" })[0]);
    expect(await screen.findByText("Someone else saved first")).toBeInTheDocument();
    expect(screen.getByText(/Hannah Lee saved AI settings at/)).toBeInTheDocument();
    expect((screen.getAllByLabelText("Requests per person per hour: Social post drafts")[0] as HTMLInputElement).value).toBe("45");
    const put = fetchMock.mock.calls.find((call) => call[1]?.method === "PUT")!;
    const body = JSON.parse(put[1].body);
    expect(body.expectedRevision).toBe(3);
    expect(body.settings.revision).toBeUndefined();
    expect(body.settings.features.text_compose.hourlyLimitPerActor).toBe(45);
    serve(state, (url, init) => (url.includes("/settings") && init?.method === "PUT" ? json({ ...state, routing: { ...state.routing, revision: 6, features: { ...state.routing.features, text_compose: { ...state.routing.features.text_compose, hourlyLimitPerActor: 45 } } } }) : undefined));
    fireEvent.click(screen.getByRole("button", { name: "Put mine on top" }));
    expect(await screen.findByText(/Saved. Changes apply to the next request/)).toBeInTheDocument();
    const second = fetchMock.mock.calls.filter((call) => call[1]?.method === "PUT").pop()!;
    expect(JSON.parse(second[1].body).expectedRevision).toBe(5);
  });

  // Owner decision 2026-11-14: a save that turns "photos may leave the
  // server" on asks for the administrator's own PIN (tier C) and sends it
  // with the routing; a refused PIN keeps the dialog, the reason and the draft.
  it("asks for the PIN only when a save turns cloud photos on, and keeps the draft when it is refused", async () => {
    const state = configuredState();
    const allowed = { ...state, routing: { ...state.routing, revision: 4, features: { ...state.routing.features, photo_assign: { ...state.routing.features.photo_assign, allowCloudImages: true } } } };
    const answers = [
      () => json({ error: "That was not accepted. Check your PIN and try again. Nothing was saved.", code: "INVALID_SECURITY_VERIFICATION", needsCredential: true, features: ["photo_assign"] }, 423),
      () => json(allowed),
    ];
    serve(state, (url, init) => (url.includes("/settings") && init?.method === "PUT" ? answers.shift()!() : undefined));
    renderPage();
    await screen.findByRole("heading", { name: "What AI does" });
    fireEvent.click(screen.getByRole("button", { name: /Allow photos to go to Anthropic/ }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Allow photos" }));
    await waitFor(() => expect(screen.queryByText("Blocked")).not.toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: "Save changes" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "Let photos leave this server?" });
    expect(within(dialog).getByText(/Sensitive · your PIN/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Photo assignment \(Anthropic\)/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === "PUT")).toHaveLength(0);
    await waitFor(() => expect(within(dialog).getByLabelText("Your PIN")).toBeInTheDocument());
    fireEvent.change(within(dialog).getByLabelText("Your PIN"), { target: { value: "0000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save and allow photos" }));
    expect(await within(dialog).findByText(/That was not accepted. Check your PIN and try again. Nothing was saved./)).toBeInTheDocument();
    expect(screen.queryByText("Blocked")).not.toBeInTheDocument();
    expect(screen.getAllByText("Unsaved changes").length).toBeGreaterThan(0);
    await waitFor(() => expect(within(dialog).getByLabelText("Your PIN")).toHaveValue(""));
    fireEvent.change(within(dialog).getByLabelText("Your PIN"), { target: { value: "2468" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save and allow photos" }));
    expect(await screen.findByText(/Saved. Changes apply to the next request/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Let photos leave this server?" })).not.toBeInTheDocument());
    const puts = fetchMock.mock.calls.filter((call) => call[1]?.method === "PUT").map((call) => JSON.parse(call[1].body));
    expect(puts.map((body) => body.security)).toEqual([{ pin: "0000" }, { pin: "2468" }]);
    expect(puts[1].settings.features.photo_assign.allowCloudImages).toBe(true);
  });

  it("saves other changes without asking for a PIN", async () => {
    const state = configuredState();
    serve(state, (url, init) => (url.includes("/settings") && init?.method === "PUT" ? json({ ...state, routing: { ...state.routing, revision: 4 } }) : undefined));
    renderPage();
    await screen.findByRole("heading", { name: "What AI does" });
    fireEvent.change(screen.getAllByLabelText("Requests per person per hour: Social post drafts")[0], { target: { value: "45" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save changes" })[0]);
    expect(await screen.findByText(/Saved. Changes apply to the next request/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const put = fetchMock.mock.calls.find((call) => call[1]?.method === "PUT")!;
    expect(JSON.parse(put[1].body)).not.toHaveProperty("security");
  });

  it("freezes fields while saving and keeps a failed draft", async () => {
    let release: (value: Response) => void = () => undefined;
    serve(configuredState(), (url, init) => (url.includes("/settings") && init?.method === "PUT" ? new Promise<Response>((resolve) => { release = resolve; }) as unknown as Response : undefined));
    renderPage();
    await screen.findByRole("heading", { name: "What AI does" });
    const limit = screen.getAllByLabelText("Requests per person per hour: Ask (assistant)")[0];
    fireEvent.change(limit, { target: { value: "90" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save changes" })[0]);
    await waitFor(() => expect(screen.getAllByLabelText("Requests per person per hour: Ask (assistant)")[0]).toBeDisabled());
    await act(async () => { release(json({ error: "Database unavailable." }, 500)); });
    expect(await screen.findByText(/Database unavailable. Your changes are kept./)).toBeInTheDocument();
    expect((screen.getAllByLabelText("Requests per person per hour: Ask (assistant)")[0] as HTMLInputElement).value).toBe("90");
  });

  it("queues a feature test and shows Queued, then Passed", async () => {
    serve(configuredState(), (url, init) => {
      if (url.endsWith("/api/admin/ai/tests") && init?.method === "POST") return json({ task: { id: "task-1", status: "PENDING" } }, 202);
      if (url.includes("/api/admin/ai/tests/task-1")) return json({ task: { id: "task-1", status: "SUCCEEDED", finishedAt: new Date().toISOString(), error: null, result: { ok: true, message: "Text generation returned valid structured output.", provider: "anthropic", model: "claude-haiku-4-5", durationMs: 1200 } } });
      return undefined;
    });
    renderPage();
    await screen.findByRole("heading", { name: "What AI does" });
    fireEvent.click(screen.getByRole("button", { name: "Test Notification wording" }));
    expect(await screen.findAllByText("Queued")).not.toHaveLength(0);
    await waitFor(() => expect(screen.getAllByText(/Passed today/).length).toBeGreaterThan(2), { timeout: 5000 });
    expect(fetchMock.mock.calls.find((call) => String(call[0]).endsWith("/api/admin/ai/tests"))![1].body).toBe(JSON.stringify({ feature: "wording" }));
  });

  it("shows a recorded failed test with its reason and turns Test off while edits are unsaved", async () => {
    serve(configuredState());
    renderPage();
    await screen.findByRole("heading", { name: "What AI does" });
    expect(screen.getAllByText(/Failed today/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Test Social post drafts" })).toBeEnabled();
    fireEvent.change(screen.getAllByLabelText("Requests per person per hour: Ask (assistant)")[0], { target: { value: "61" } });
    expect(screen.getByRole("button", { name: "Test Social post drafts" })).toBeDisabled();
  });

  it("adds a key with the person's own PIN through the shared sensitive dialog and keeps the key after a refusal", async () => {
    serve(configuredState(), (url) => (url.includes("/api/admin/ai/credentials") ? json({ error: "That PIN is not right." }, 403) : undefined));
    renderPage();
    const openai = await screen.findByRole("region", { name: "OpenAI" });
    fireEvent.click(within(openai).getByRole("button", { name: "Add key…" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Sensitive · your PIN/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("API key"), { target: { value: "sk-proj-typed-4c7D" } });
    expect(within(dialog).getByText(/last four characters: 4c7D/)).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByLabelText("Your PIN")).toBeInTheDocument());
    fireEvent.change(within(dialog).getByLabelText("Your PIN"), { target: { value: "2468" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save key" }));
    expect(await within(dialog).findByText(/Not saved. That PIN is not right. Your new key is still in the box./)).toBeInTheDocument();
    expect((within(dialog).getByLabelText("API key") as HTMLInputElement).value).toBe("sk-proj-typed-4c7D");
    const call = fetchMock.mock.calls.find((item) => String(item[0]).includes("/credentials"))!;
    expect(JSON.parse(call[1].body)).toEqual({ provider: "openai", apiKey: "sk-proj-typed-4c7D", security: { pin: "2468" } });
  });

  it("removes a key with clear: true and the PIN", async () => {
    serve(configuredState(), (url) => (url.includes("/api/admin/ai/credentials") ? json({ credentials: [{ provider: "anthropic", state: "cleared", hint: null }, { provider: "openai", state: "missing", hint: null }, { provider: "openai_compatible", state: "saved", hint: "••••7Qe1" }] }) : undefined));
    renderPage();
    const anthropic = await screen.findByRole("region", { name: "Anthropic" });
    fireEvent.click(within(anthropic).getByRole("button", { name: "Remove key…" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByLabelText("Your PIN")).toBeInTheDocument());
    fireEvent.change(within(dialog).getByLabelText("Your PIN"), { target: { value: "2468" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove key" }));
    expect(await screen.findByText(/Key removed/)).toBeInTheDocument();
    const call = fetchMock.mock.calls.find((item) => String(item[0]).includes("/credentials"))!;
    expect(JSON.parse(call[1].body)).toEqual({ provider: "anthropic", clear: true, security: { pin: "2468" } });
  });

  it("is read-only for an operations manager: every control disabled, no key actions, no last four", async () => {
    const state = configuredState({ canEdit: false, isAdmin: false, credentials: [
      { provider: "anthropic", state: "environment", hint: null },
      { provider: "openai", state: "missing", hint: null },
      { provider: "openai_compatible", state: "saved", hint: null },
    ] });
    serve(state);
    renderPage({ canEdit: false, readOnlyReason: "Administrators change these settings." });
    await screen.findByRole("heading", { name: "What AI does" });
    expect(screen.getAllByText("View only").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add key|Replace key|Remove key/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/••••/)).not.toBeInTheDocument();
    for (const input of screen.getAllByLabelText(/Requests per person per hour:/)) expect(input).toBeDisabled();
    for (const select of screen.getAllByLabelText(/^Runs on:/)) expect(select).toBeDisabled();
    expect(screen.getByLabelText("Photos per request")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Test Social post drafts" })).toBeDisabled();
  });

  it("phone lists open the provider page and the feature sheet", async () => {
    serve(configuredState());
    renderPage();
    const providers = await screen.findByRole("list", { name: "Providers" });
    fireEvent.click(within(providers).getByRole("button", { name: /^Anthropic/ }));
    const sheet = await screen.findByRole("dialog", { name: "Anthropic" });
    expect(within(sheet).getAllByText("Used by").length).toBeGreaterThan(0);
    expect(within(sheet).getByRole("button", { name: "Replace key…" })).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "Close" }));
    const features = screen.getAllByRole("list", { name: "AI features" })[0];
    fireEvent.click(within(features).getByRole("button", { name: /^Photo comparison/ }));
    const featureSheet = await screen.findByRole("dialog", { name: "Photo comparison" });
    expect(within(featureSheet).getByText("Use AI for this")).toBeInTheDocument();
    expect(within(featureSheet).getByRole("button", { name: "Run a test" })).toBeInTheDocument();
  });

  it("closes a sheet while its key confirmation is open and brings it back afterwards", async () => {
    serve(configuredState());
    renderPage();
    const providers = await screen.findByRole("list", { name: "Providers" });
    fireEvent.click(within(providers).getByRole("button", { name: /^Anthropic/ }));
    const sheet = await screen.findByRole("dialog", { name: "Anthropic" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Replace key…" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Anthropic" })).not.toBeInTheDocument());
    const dialog = await screen.findByRole("dialog", { name: /Replace the Anthropic key/ });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("dialog", { name: "Anthropic" })).toBeInTheDocument();
  });

  it("keeps every control of the old Settings › AI, photo checks and Ollama screens reachable", async () => {
    serve(configuredState());
    renderPage();
    await screen.findByRole("heading", { name: "Photo checks" });
    // Settings › AI: default route, compatible endpoint, per-feature switch/route/model/photo switch/limit/test, prices, usage.
    expect(screen.getByLabelText("Default for text features")).toBeInTheDocument();
    expect(screen.getByLabelText("Cloud deadline")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /Endpoint address and name|Hide endpoint address/ })[0]);
    expect(screen.getAllByLabelText("Base address (https)")[0]).toBeInTheDocument();
    expect(screen.getAllByLabelText("Name shown here")[0]).toBeInTheDocument();
    for (const feature of ["Photo comparison", "Photo assignment", "Social post drafts", "Notification wording", "Ask (assistant)", "Explain this flag"]) {
      expect(screen.getAllByLabelText(`Use AI for ${feature}`).length).toBeGreaterThan(0);
      expect(screen.getAllByLabelText(`Runs on: ${feature}`).length).toBeGreaterThan(0);
      expect(screen.getAllByLabelText(`Requests per person per hour: ${feature}`).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByLabelText("Send photos to a cloud provider: Photo comparison").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Model for Ask (assistant)").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "+ Add a price" })).toBeInTheDocument();
    expect(screen.getAllByRole("region", { name: "Usage this month" }).length + screen.getAllByRole("list", { name: "Usage this month" }).length).toBeGreaterThan(0);
    // Photo checks page: thresholds, points, memory, recognition, opt-out, agreement.
    expect(screen.getByLabelText("Lowest band that may propose a deduction")).toHaveValue("medium");
    fireEvent.click(screen.getByRole("button", { name: "Exact minimum confidence" }));
    expect(screen.getByLabelText("Minimum confidence (0 to 1)")).toHaveValue(0.7);
    for (const label of ["Approved minor finding", "Approved major finding", "Most a check may propose", "Photos per request"]) expect(screen.getByLabelText(label)).toBeInTheDocument();
    expect(screen.getByLabelText("Use prior photos from the same property to recognize rooms")).toBeInTheDocument();
    expect(screen.getByLabelText("Train and use dedicated property recognition")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review photo memory ›" }));
    expect(screen.getByText("Photo memory panel")).toBeInTheDocument();
    expect(await screen.findByText("Bronte Flat")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    const optOutDialog = await screen.findByRole("dialog", { name: "Properties opted out of AI photo checks" });
    expect(within(optOutDialog).getByLabelText("Find a property")).toBeInTheDocument();
    fireEvent.click(within(optOutDialog).getAllByRole("button", { name: "Close" })[0]);
    expect(screen.getByText("78%")).toBeInTheDocument();
    // Photo workflow switches, photo default provider/model and the model check live in the feature sheet.
    fireEvent.click(screen.getByRole("button", { name: "Settings for Photo comparison" }));
    const sheet = await screen.findByRole("dialog", { name: "Photo comparison" });
    expect(within(sheet).getByLabelText("Compare submitted photos with references")).toBeChecked();
    expect(within(sheet).getByLabelText("Cloud deadline (seconds)")).toBeInTheDocument();
    fireEvent.change(within(sheet).getByLabelText("Runs on: Photo comparison"), { target: { value: "" } });
    expect(within(sheet).getByLabelText("Photo analysis provider")).toHaveValue("ollama");
    expect(within(sheet).getByLabelText("Vision model")).toBeDisabled();
    expect(within(sheet).getByRole("button", { name: "Check provider and saved model" })).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    // Ollama tab: the setup opens from the Local Ollama card.
    fireEvent.click(screen.getByRole("button", { name: "Ollama setup ›" }));
    expect(screen.getByText("Ollama setup panel")).toBeInTheDocument();
  });

  it("opens the Ollama setup for the old ?tab=ollama link", async () => {
    serve(configuredState());
    renderPage({ initialSection: "ollama" });
    expect(await screen.findByText("Ollama setup panel")).toBeInTheDocument();
  });

  it("separates loading and failure: a failed read offers Retry and never shows an empty state", async () => {
    let fail = true;
    serve(configuredState(), (url) => (url.includes("/api/admin/ai/settings") && fail ? json({ error: "AI settings could not be loaded." }, 500) : undefined));
    renderPage();
    expect(screen.getByText("Loading AI configuration…")).toBeInTheDocument();
    expect(await screen.findByText("AI configuration could not be loaded")).toBeInTheDocument();
    expect(screen.queryByText("Set up your first provider")).not.toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { name: "Where AI runs" })).toBeInTheDocument();
  });

  it("says Not known when the recorded facts cannot be read", async () => {
    serve(configuredState({ status: null, usage: null }));
    renderPage();
    await screen.findByRole("heading", { name: "What AI does" });
    expect(screen.getByText("Cost not known")).toBeInTheDocument();
    expect(screen.getAllByText("Not known").length).toBeGreaterThan(3);
  });
});
