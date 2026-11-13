import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AiSection } from "@/components/v2/admin/settings/ai-section";
import { AI_FEATURES, DEFAULT_AI_ROUTING } from "@/lib/ai/provider/routing-schema";

const routes = AI_FEATURES.map((feature) => ({ feature, provider: feature.startsWith("photo") ? "anthropic" : "ollama", model: "m", configured: true, enabled: !["assistant", "agent_summaries"].includes(feature), cloud: feature.startsWith("photo"), allowImages: !feature.startsWith("photo"), source: feature.startsWith("photo") ? "photo-settings" : "environment", error: null }));
const state = {
  routing: DEFAULT_AI_ROUTING,
  credentials: [{ provider: "anthropic", state: "environment", hint: "••••1234" }, { provider: "openai", state: "missing", hint: null }, { provider: "openai_compatible", state: "missing", hint: null }],
  routes,
  usage: { monthLabel: "November 2026", timezone: "Australia/Sydney", rows: [{ feature: "wording", provider: "anthropic", model: "claude-sonnet-5", calls: 3, succeeded: 2, failed: 1, refused: 0, inputTokens: 100, outputTokens: 50, knownCostMicroUsd: 0, unknownCostCalls: 2 }] },
  encryptionReady: true,
};
const fetchMock = vi.fn();
const json = (data: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(data), { status }));
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); fetchMock.mockImplementation(() => json(state)); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("shows the image default, key states without values, per-feature status and unknown costs as not known", async () => {
  render(<AiSection />);
  await screen.findByText("Defaults pending owner confirmation");
  expect(screen.getByText(/Using the server environment key ••••1234/)).toBeVisible();
  expect(screen.getAllByText("Images stay on the server: unavailable")).toHaveLength(2);
  expect(screen.getAllByText("Not built yet")).toHaveLength(1); // agent summaries only (Ask is built since step 5)
  expect(screen.getByText(/not known for 2/)).toBeVisible();
  expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
});

it("keeps the draft on a stale save and offers both resolutions", async () => {
  render(<AiSection />);
  const cloud = await screen.findAllByLabelText(/Allow photos to go to a cloud provider/);
  fireEvent.click(cloud[0]);
  fetchMock.mockImplementation((_url, init) => (init?.method === "PUT" ? json({ error: "stale", current: { ...DEFAULT_AI_ROUTING, revision: 5 } }, 409) : json(state)));
  fireEvent.click(screen.getByRole("button", { name: "Save AI settings" }));
  await screen.findByText(/Someone saved AI settings after you opened them/);
  expect((screen.getAllByLabelText(/Allow photos to go to a cloud provider/)[0] as HTMLInputElement).checked).toBe(true);
  const body = JSON.parse(fetchMock.mock.calls.find((call) => call[1]?.method === "PUT")![1].body);
  expect(body).toMatchObject({ expectedRevision: 0, settings: { features: { photo_compare: { allowCloudImages: true } } } });
  expect(body.settings.revision).toBeUndefined();
  fetchMock.mockImplementation((_url, init) => (init?.method === "PUT" ? json({ ...state, routing: { ...DEFAULT_AI_ROUTING, revision: 6 } }) : json(state)));
  fireEvent.click(screen.getByRole("button", { name: "Put my changes on top" }));
  await screen.findByText(/AI settings saved/);
  expect(JSON.parse(fetchMock.mock.calls.filter((call) => call[1]?.method === "PUT")[1][1].body).expectedRevision).toBe(5);
});

it("needs a password to save a key, clears the password after a failure and keeps the typed key", async () => {
  render(<AiSection />);
  await screen.findByText("Defaults pending owner confirmation");
  const card = screen.getByRole("heading", { name: "OpenAI" }).closest("div")!.parentElement!;
  const key = within(card).getByLabelText("New API key"); const password = within(card).getByLabelText("Your password");
  fireEvent.change(key, { target: { value: "sk-typed" } });
  expect(within(card).getByRole("button", { name: "Save key" })).toBeDisabled();
  fireEvent.change(password, { target: { value: "wrong" } });
  fetchMock.mockImplementation((url) => (String(url).includes("credentials") ? json({ error: "Incorrect password. The key was not changed." }, 403) : json(state)));
  fireEvent.click(within(card).getByRole("button", { name: "Save key" }));
  await within(card).findByText("Incorrect password. The key was not changed.");
  expect((password as HTMLInputElement).value).toBe(""); expect((key as HTMLInputElement).value).toBe("sk-typed");
});

it("queues a real test and polls until the worker finishes", async () => {
  render(<AiSection />);
  await screen.findByText("Defaults pending owner confirmation");
  fetchMock.mockImplementation((url, init) => {
    if (init?.method === "POST") return json({ task: { id: "task-1", status: "PENDING" } }, 202);
    if (String(url).includes("/tests/task-1")) return json({ task: { status: "SUCCEEDED", error: null, result: { ok: true, message: "Text generation returned valid structured output.", provider: "ollama", model: "gemma3:4b", durationMs: 1200 } } });
    return json(state);
  });
  const wordingCard = screen.getByRole("heading", { name: "Notification wording" }).closest("div")!.parentElement!.parentElement!;
  fireEvent.click(within(wordingCard).getByRole("button", { name: "Run a real test" }));
  await waitFor(() => expect(within(wordingCard).getByText(/Text generation returned valid structured output/)).toBeVisible(), { timeout: 5000 });
  expect(within(wordingCard).getByText("Passed:")).toBeVisible();
});

it("shows a retry when settings cannot be read", async () => {
  fetchMock.mockImplementation(() => json({ error: "AI settings could not be loaded." }, 500));
  render(<AiSection />);
  expect(await screen.findByText("AI settings unavailable")).toBeVisible();
  expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
});
