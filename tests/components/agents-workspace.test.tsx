import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentsWorkspace } from "@/components/v2/admin/settings/agents/agents-workspace";

const agent = {
  id: "agent-1", name: "Hermes", status: "ACTIVE", createdAt: "2026-11-01T00:00:00.000Z", createdBy: "Owner", areas: ["jobs", "laundry"],
  effective: ["jobs"], withheld: ["laundry"],
  writeAreas: ["cases_write", "jobs_reschedule"], writeEffective: ["cases_write"], writeWithheld: ["jobs_reschedule"], waitingRequests: 2,
  token: { prefix: "snk_agent_AbCdEf", expiresAt: "2026-12-01T00:00:00.000Z", lastUsedAt: null, expired: false },
  recentCalls: [{ at: "2026-11-13T00:00:00.000Z", method: "tools/call", tool: "list_today_jobs", outcome: "OK", errorCode: null, latencyMs: 42, resultBytes: 900 }],
};
const state = { paused: false, agents: [agent], grantable: ["jobs", "laundry"], grantableWrite: ["cases_write"], mcpUrl: "https://estate.example/api/agent/mcp" };
const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) => (String(url).includes("/api/me/admin-pin") ? json({ hasPin: true, lockedUntil: null, userId: "admin-1" }) : json(state)));
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
afterEach(() => vi.unstubAllGlobals());

it("lists agents with effective and withheld access, token prefix only, last use and recent calls, plus the real connection guide", async () => {
  render(<AgentsWorkspace />);
  expect(await screen.findByText("Hermes")).toBeInTheDocument();
  expect(screen.getByText("Some access withheld")).toBeInTheDocument();
  expect(screen.getByText(/Withheld because its creator can no longer read them: Laundry/)).toBeInTheDocument();
  expect(screen.getByText("snk_agent_AbCdEf…")).toBeInTheDocument();
  expect(screen.getAllByText("Never").length).toBeGreaterThan(0);
  expect(screen.getByText(/list_today_jobs · OK · 42 ms/)).toBeInTheDocument();
  expect(screen.getAllByText(/https:\/\/estate\.example\/api\/agent\/mcp/).length).toBeGreaterThan(0);
  expect(screen.getByText(/claude mcp add --transport http sneek/)).toBeInTheDocument();
  expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  expect(document.querySelector("table")).toBeNull();
});

it("creates an agent only with the PIN, offers only the creator's areas, and shows the token once", async () => {
  render(<AgentsWorkspace />);
  fireEvent.click(await screen.findByRole("button", { name: "New agent" }));
  fireEvent.change(screen.getByPlaceholderText("For example Hermes or Claude"), { target: { value: "Claude" } });
  expect(screen.getByLabelText(/Invoices/)).toBeDisabled();
  fireEvent.click(screen.getByLabelText(/^Jobs/));
  fireEvent.click(screen.getByRole("button", { name: "Create agent" }));
  const confirm = screen.getByRole("button", { name: "Confirm" });
  expect(confirm).toBeDisabled();
  fireEvent.change(await screen.findByLabelText("Your PIN"), { target: { value: "2468" } });
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (String(url).includes("/api/me/admin-pin")) return json({ hasPin: true, lockedUntil: null });
    if (init?.method === "POST") return json({ agentId: "agent-2", token: "snk_agent_THE_ONE_TIME_TOKEN", prefix: "snk_agent_THE_ON", expiresAt: "2027-02-12T00:00:00.000Z" }, 201);
    return json(state);
  });
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  expect(await screen.findByTestId("agent-token")).toHaveTextContent("snk_agent_THE_ONE_TIME_TOKEN");
  const sent = JSON.parse(fetchMock.mock.calls.find((call) => call[1]?.method === "POST")![1].body);
  expect(sent).toEqual({ action: "create", name: "Claude", areas: ["jobs"], writeAreas: [], expiresInDays: 90, credentials: { pin: "2468" } });
  fireEvent.click(screen.getByRole("button", { name: "Copy MCP configuration" }));
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("Bearer snk_agent_THE_ONE_TIME_TOKEN")));
  fireEvent.click(screen.getByRole("button", { name: "I have stored it" }));
  expect(screen.queryByText("snk_agent_THE_ONE_TIME_TOKEN")).toBeNull();
});

it("keeps the prompt open and clears only the PIN when the server refuses it", async () => {
  render(<AgentsWorkspace />);
  await screen.findByText("Hermes");
  fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
  fireEvent.change(await screen.findByLabelText("Your PIN"), { target: { value: "1111" } });
  fetchMock.mockImplementation((url: string, init?: RequestInit) => (String(url).includes("/api/me/admin-pin") ? json({ hasPin: true }) : init?.method === "POST" ? json({ error: "That PIN is not right." }, 423) : json(state)));
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  expect(await screen.findByText("That PIN is not right.")).toBeInTheDocument();
  expect(screen.getByText(/Revoke Hermes\?/)).toBeInTheDocument();
  expect((screen.getByLabelText("Your PIN") as HTMLInputElement).value).toBe("");
});

it("shows what an agent may ask to change, withheld write packs, waiting requests, and edits write packs only with the PIN", async () => {
  render(<AgentsWorkspace />);
  await screen.findByText("Hermes");
  expect(screen.getByText(/Ask to open cases and add internal notes · 2 requests waiting in Approvals/)).toBeInTheDocument();
  expect(screen.getByText(/Write packs withheld because its creator can no longer manage them: Ask to reschedule jobs/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Change what it may ask" }));
  const group = screen.getByRole("group", { name: "Confirm with your PIN" });
  expect(within(group).getByLabelText(/Ask to reschedule jobs/)).toBeDisabled();
  fireEvent.click(within(group).getByLabelText(/Ask to open cases/));
  fireEvent.change(await screen.findByLabelText("Your PIN"), { target: { value: "2468" } });
  fetchMock.mockImplementation((url: string, init?: RequestInit) => (String(url).includes("/api/me/admin-pin") ? json({ hasPin: true }) : init?.method === "POST" ? json({ writeAreas: ["jobs_reschedule"] }) : json(state)));
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  await waitFor(() => expect(fetchMock.mock.calls.some((call) => call[1]?.method === "POST")).toBe(true));
  expect(await screen.findByText("What Hermes may ask for was saved.")).toBeInTheDocument();
  const post = fetchMock.mock.calls.find((call) => call[1]?.method === "POST")!;
  expect(post[0]).toBe("/api/admin/agents/agent-1");
  expect(JSON.parse(post[1].body)).toEqual({ action: "write-areas", writeAreas: ["jobs_reschedule"], credentials: { pin: "2468" } });
});

it("works at phone width: one column of cards and controls, every action reachable", async () => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
  window.dispatchEvent(new Event("resize"));
  render(<AgentsWorkspace />);
  await screen.findByText("Hermes");
  for (const name of ["New agent", "Pause all agents", "Rotate token", "Change what it may ask", "Revoke"]) expect(screen.getByRole("button", { name })).toBeInTheDocument();
  expect(document.querySelector("table")).toBeNull();
  expect(screen.getByText("Recent calls (1)")).toBeInTheDocument();
});

it("shows a retry when agents cannot be loaded", async () => {
  fetchMock.mockImplementation(() => json({ error: "Only administrators, acting as themselves, can manage agents." }, 403));
  render(<AgentsWorkspace />);
  expect(await screen.findByText("Agents unavailable")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
});
