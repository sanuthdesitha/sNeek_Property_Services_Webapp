import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentsWorkspace } from "@/components/v2/admin/settings/agents/agents-workspace";
import { callOutcome } from "@/components/v2/admin/settings/agents/agent-call-outcome";

const agent = {
  id: "agent-1", name: "Hermes", status: "ACTIVE", createdAt: "2026-11-01T00:00:00.000Z", createdBy: "Owner", areas: ["jobs", "laundry"],
  effective: ["jobs"], withheld: ["laundry"],
  writeAreas: ["cases_write", "jobs_reschedule"], writeEffective: ["cases_write"], writeWithheld: ["jobs_reschedule"], waitingRequests: 2,
  token: { prefix: "snk_agent_AbCdEf", expiresAt: "2026-12-01T00:00:00.000Z", lastUsedAt: null, expired: false },
  recentCalls: [
    { at: "2026-11-13T00:00:00.000Z", method: "tools/call", tool: "list_today_jobs", outcome: "OK", errorCode: null, latencyMs: 42, resultBytes: 900 },
    { at: "2026-11-12T23:00:00.000Z", method: "tools/call", tool: "request_reschedule_job", outcome: "OK", errorCode: null, latencyMs: 80, resultBytes: 300 },
    { at: "2026-11-12T22:00:00.000Z", method: "tools/call", tool: "invoice_summary", outcome: "DENIED", errorCode: "SCOPE", latencyMs: 5, resultBytes: null },
  ],
};
const readOnly = {
  id: "agent-2", name: "Claude desktop", status: "ACTIVE", createdAt: "2026-10-19T00:00:00.000Z", createdBy: "Ravi", areas: ["jobs"],
  effective: ["jobs"], withheld: [], writeAreas: [], writeEffective: [], writeWithheld: [], waitingRequests: 0,
  token: { prefix: "snk_agent_ZyXwVu", expiresAt: "2027-04-17T00:00:00.000Z", lastUsedAt: null, expired: false },
  recentCalls: [],
};
const state = { paused: false, agents: [agent], grantable: ["jobs", "laundry"], grantableWrite: ["cases_write"], mcpUrl: "https://estate.example/api/agent/mcp" };
const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
const posts = () => fetchMock.mock.calls.filter((call) => call[1]?.method === "POST");

function serve(screenState: unknown, post?: () => Promise<Response>) {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (String(url).includes("/api/me/admin-pin")) return json({ hasPin: true, lockedUntil: null, userId: "admin-1" });
    if (init?.method === "POST" && post) return post();
    return json(screenState);
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset();
  serve(state);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
afterEach(() => vi.unstubAllGlobals());

it("lists agents with effective and withheld access, token prefix only, last use and recent calls, plus the real connection guide", async () => {
  render(<AgentsWorkspace timeZone="Australia/Sydney" />);
  const card = await screen.findByRole("article", { name: "Hermes" });
  expect(within(card).getByText("2 withheld")).toBeInTheDocument();
  expect(card.getAttribute("data-tone")).toBe("attention");
  expect(within(card).getByText("May read · 1 area")).toBeInTheDocument();
  expect(within(card).getByText(/Withheld because its creator, Owner, can no longer read them:/)).toHaveTextContent("Laundry. They come back if that access does.");
  expect(within(card).getByText("snk_agent_AbCdEf…")).toBeInTheDocument();
  expect(within(card).getByText("Never")).toBeInTheDocument();
  expect(within(card).getByText(/list_today_jobs/)).toHaveTextContent("list_today_jobs · 42 ms · 900 bytes");
  expect(within(card).getByText("Allowed")).toBeInTheDocument();
  expect(within(card).getByText("Sent to Approvals")).toBeInTheDocument();
  expect(within(card).getByText("Refused: not in its access")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Agents are on" })).toBeInTheDocument();
  expect(screen.getByText(/1 agent with valid tokens can read/)).toBeInTheDocument();
  expect(screen.getAllByText(/https:\/\/estate\.example\/api\/agent\/mcp/).length).toBeGreaterThan(1);
  expect(screen.getByText(/claude mcp add --transport http sneek/)).toBeInTheDocument();
  expect(screen.queryByText(/Defaults pending owner confirmation/)).toBeNull();
  expect(screen.queryByText("—")).toBeNull();
  expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  expect(document.querySelector("table")).toBeNull();
});

it("says Never and Nothing in words, never a dash or zero", async () => {
  const revoked = { ...readOnly, id: "agent-4", name: "Gone", status: "REVOKED", effective: [], token: null };
  serve({ ...state, agents: [readOnly, { ...agent, id: "agent-3", name: "Old", token: null }, revoked] });
  render(<AgentsWorkspace />);
  const card = await screen.findByRole("article", { name: "Claude desktop" });
  expect(within(card).getByText("Nothing: read only")).toBeInTheDocument();
  expect(within(card).getByText("Never")).toBeInTheDocument();
  expect(within(card).getByText("No calls yet.")).toBeInTheDocument();
  expect(within(card).getByText("Active")).toBeInTheDocument();
  expect(card.getAttribute("data-tone")).toBeNull();
  const noToken = screen.getByRole("article", { name: "Old" });
  expect(within(noToken).getAllByText("No live token").length).toBeGreaterThan(1);
  const gone = screen.getByRole("article", { name: "Gone" });
  expect(within(gone).getByText("Revoked")).toBeInTheDocument();
  expect(within(gone).getByText("Nothing: revoked.")).toBeInTheDocument();
  expect(within(gone).queryByRole("button")).toBeNull();
  expect(document.body.textContent).not.toMatch(/—/);
  expect(document.body.textContent).not.toMatch(/\b0 (areas|requests)/);
});

it("words every recorded outcome from the call record and says when an outcome is not known", () => {
  const base = { at: "2026-11-13T00:00:00.000Z", method: "tools/call", tool: "get_job", latencyMs: 1, resultBytes: null };
  expect(callOutcome({ ...base, outcome: "REFUSED", errorCode: "AGENTS_PAUSED" }).label).toBe("Refused: agents paused");
  expect(callOutcome({ ...base, outcome: "REFUSED", errorCode: "SOMETHING_NEW" }).label).toBe("Refused: reason not recorded");
  expect(callOutcome({ ...base, outcome: "INVALID", errorCode: "ARGUMENTS" }).label).toBe("Refused: invalid arguments");
  expect(callOutcome({ ...base, outcome: "ERROR", errorCode: "INTERNAL" }).label).toBe("Failed: the data could not be read");
  expect(callOutcome({ ...base, outcome: "WEIRD", errorCode: null })).toEqual({ label: "Outcome not known (WEIRD)", tone: "neutral" });
});

it("creates an agent only with the PIN in the tier C dialog, offers only the creator's areas, and shows the token once", async () => {
  render(<AgentsWorkspace />);
  await screen.findByRole("article", { name: "Hermes" });
  fireEvent.change(screen.getByPlaceholderText("For example Hermes or Claude"), { target: { value: "Claude" } });
  fireEvent.click(screen.getByRole("button", { name: "Show 7 more areas" }));
  expect(screen.getByLabelText(/Invoices/)).toBeDisabled();
  expect(screen.getByLabelText(/Invoices/).closest("label")).toHaveTextContent("Outside your own access.");
  expect(screen.getByLabelText(/Ask to reschedule jobs/)).toBeDisabled();
  expect(screen.getByLabelText("90 days")).toBeChecked();
  fireEvent.click(screen.getByLabelText(/^Jobs/));
  fireEvent.click(screen.getByRole("button", { name: "Create agent…" }));
  const dialog = await screen.findByRole("dialog");
  expect(dialog).toHaveTextContent("Sensitive · your PIN");
  expect(within(dialog).getByText("Create Claude?")).toBeInTheDocument();
  expect(within(dialog).getByText(/It may read 1 area\. It may ask to change nothing: read only\./)).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Create agent" })).toBeDisabled();
  fireEvent.change(await within(dialog).findByLabelText("Your PIN"), { target: { value: "2468" } });
  serve(state, () => json({ agentId: "agent-2", token: "snk_agent_THE_ONE_TIME_TOKEN", prefix: "snk_agent_THE_ON", expiresAt: "2027-02-12T00:00:00.000Z" }, 201));
  fireEvent.click(within(dialog).getByRole("button", { name: "Create agent" }));
  expect(await screen.findByTestId("agent-token")).toHaveTextContent("snk_agent_THE_ONE_TIME_TOKEN");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  const sent = JSON.parse(posts()[0][1].body);
  expect(sent).toEqual({ action: "create", name: "Claude", areas: ["jobs"], writeAreas: [], expiresInDays: 90, credentials: { pin: "2468" } });
  expect((screen.getByPlaceholderText("For example Hermes or Claude") as HTMLInputElement).value).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Copy MCP configuration" }));
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("Bearer snk_agent_THE_ONE_TIME_TOKEN")));
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("https://estate.example/api/agent/mcp"));
  fireEvent.click(screen.getByRole("button", { name: "I have stored it" }));
  expect(screen.queryByText("snk_agent_THE_ONE_TIME_TOKEN")).toBeNull();
});

it("keeps the dialog open and clears only the PIN when the server refuses it", async () => {
  render(<AgentsWorkspace />);
  const card = await screen.findByRole("article", { name: "Hermes" });
  fireEvent.click(within(card).getByRole("button", { name: "Revoke…" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(await within(dialog).findByLabelText("Your PIN"), { target: { value: "1111" } });
  serve(state, () => json({ error: "INVALID_SECURITY_VERIFICATION", code: "INVALID_SECURITY_VERIFICATION" }, 423));
  fireEvent.click(within(dialog).getByRole("button", { name: "Revoke agent" }));
  expect(await within(dialog).findByText("That was not accepted. Check your PIN and try again.")).toBeInTheDocument();
  expect(posts()).toHaveLength(1);
  expect(within(screen.getByRole("dialog")).getByText("Revoke Hermes?")).toBeInTheDocument();
  await waitFor(() => expect((within(screen.getByRole("dialog")).getByLabelText("Your PIN") as HTMLInputElement).value).toBe(""));
});

it("keeps the New agent draft when the PIN is wrong, and sends it unchanged on the next try", async () => {
  render(<AgentsWorkspace />);
  await screen.findByRole("article", { name: "Hermes" });
  fireEvent.change(screen.getByPlaceholderText("For example Hermes or Claude"), { target: { value: "Hermes two" } });
  fireEvent.click(screen.getByLabelText(/^Laundry/));
  fireEvent.click(screen.getByLabelText(/Ask to open cases/));
  fireEvent.click(screen.getByLabelText("30 days"));
  fireEvent.click(screen.getByRole("button", { name: "Create agent…" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(await within(dialog).findByLabelText("Your PIN"), { target: { value: "9999" } });
  serve(state, () => json({ error: "That PIN is not right." }, 423));
  fireEvent.click(within(dialog).getByRole("button", { name: "Create agent" }));
  expect(await within(dialog).findByText("That PIN is not right.")).toBeInTheDocument();
  expect(screen.queryByTestId("agent-token")).toBeNull();
  await waitFor(() => expect((within(dialog).getByLabelText("Your PIN") as HTMLInputElement).value).toBe(""));
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect((screen.getByPlaceholderText("For example Hermes or Claude") as HTMLInputElement).value).toBe("Hermes two");
  expect(screen.getByLabelText(/^Laundry/)).toBeChecked();
  expect(screen.getByLabelText(/Ask to open cases/)).toBeChecked();
  expect(screen.getByLabelText("30 days")).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Create agent…" }));
  const again = await screen.findByRole("dialog");
  fireEvent.change(await within(again).findByLabelText("Your PIN"), { target: { value: "2468" } });
  serve(state, () => json({ agentId: "agent-9", token: "snk_agent_SECOND", prefix: "snk_agent_SECOND", expiresAt: "2026-12-15T00:00:00.000Z" }, 201));
  fireEvent.click(within(again).getByRole("button", { name: "Create agent" }));
  expect(await screen.findByTestId("agent-token")).toHaveTextContent("snk_agent_SECOND");
  expect(JSON.parse(posts().at(-1)![1].body)).toEqual({ action: "create", name: "Hermes two", areas: ["laundry"], writeAreas: ["cases_write"], expiresInDays: 30, credentials: { pin: "2468" } });
});

it("shows what an agent may ask to change, withheld write packs, waiting requests, and edits write packs only with the PIN", async () => {
  render(<AgentsWorkspace />);
  const card = await screen.findByRole("article", { name: "Hermes" });
  expect(within(card).getByText("Ask to open cases and add internal notes")).toBeInTheDocument();
  expect(within(card).getByText("2 requests waiting in Approvals › Agent requests.")).toBeInTheDocument();
  expect(within(card).getByText(/Write packs withheld because its creator, Owner, can no longer manage them:/)).toHaveTextContent("Ask to reschedule jobs");
  fireEvent.click(within(card).getByRole("button", { name: "Change what it may ask…" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByLabelText(/Ask to reschedule jobs/)).toBeDisabled();
  fireEvent.click(within(dialog).getByLabelText(/Ask to open cases/));
  fireEvent.change(await within(dialog).findByLabelText("Your PIN"), { target: { value: "2468" } });
  serve(state, () => json({ writeAreas: ["jobs_reschedule"] }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Save what it may ask" }));
  expect(await screen.findByText("What Hermes may ask for was saved.")).toBeInTheDocument();
  const post = posts()[0];
  expect(post[0]).toBe("/api/admin/agents/agent-1");
  expect(JSON.parse(post[1].body)).toEqual({ action: "write-areas", writeAreas: ["jobs_reschedule"], credentials: { pin: "2468" } });
});

it("rotates a token with the chosen expiry and shows the new token once", async () => {
  render(<AgentsWorkspace />);
  const card = await screen.findByRole("article", { name: "Hermes" });
  fireEvent.click(within(card).getByRole("button", { name: "Rotate token…" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByLabelText("90 days")).toBeChecked();
  fireEvent.click(within(dialog).getByLabelText("180 days"));
  fireEvent.change(await within(dialog).findByLabelText("Your PIN"), { target: { value: "2468" } });
  serve(state, () => json({ token: "snk_agent_ROTATED", prefix: "snk_agent_ROTATE", expiresAt: "2027-05-12T00:00:00.000Z" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Rotate token" }));
  expect(await screen.findByTestId("agent-token")).toHaveTextContent("snk_agent_ROTATED");
  expect(JSON.parse(posts()[0][1].body)).toEqual({ action: "rotate", expiresInDays: 180, credentials: { pin: "2468" } });
});

it("pauses every agent through the PIN dialog, then offers Resume through the same dialog", async () => {
  render(<AgentsWorkspace />);
  await screen.findByRole("article", { name: "Hermes" });
  fireEvent.click(screen.getByRole("button", { name: "Pause all agents…" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("Pause every agent now?")).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Pause agents" })).toBeDisabled();
  fireEvent.change(await within(dialog).findByLabelText("Your PIN"), { target: { value: "2468" } });
  serve({ ...state, paused: true }, () => json({ ok: true, paused: true }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Pause agents" }));
  expect(await screen.findByRole("heading", { name: "Agents are paused" })).toBeInTheDocument();
  expect(JSON.parse(posts()[0][1].body)).toEqual({ action: "pause", paused: true, credentials: { pin: "2468" } });
  fireEvent.click(screen.getByRole("button", { name: "Resume all agents…" }));
  const resume = await screen.findByRole("dialog");
  expect(within(resume).getByText("Let agents connect again?")).toBeInTheDocument();
  expect(within(resume).getByLabelText("Your PIN")).toBeInTheDocument();
});

it("asks for the password alone when the administrator has no PIN", async () => {
  fetchMock.mockImplementation((url: string) => (String(url).includes("/api/me/admin-pin") ? json({ hasPin: false, lockedUntil: null, userId: "admin-1" }) : json(state)));
  render(<AgentsWorkspace />);
  const card = await screen.findByRole("article", { name: "Hermes" });
  fireEvent.click(within(card).getByRole("button", { name: "Revoke…" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(await within(dialog).findByLabelText("Your password"), { target: { value: "secret-pass" } });
  fetchMock.mockImplementation((url: string, init?: RequestInit) => (String(url).includes("/api/me/admin-pin") ? json({ hasPin: false }) : init?.method === "POST" ? json({ ok: true }) : json(state)));
  fireEvent.click(within(dialog).getByRole("button", { name: "Revoke agent" }));
  expect(await screen.findByText("Hermes was revoked. Its token stops working now.")).toBeInTheDocument();
  expect(JSON.parse(posts()[0][1].body)).toEqual({ action: "revoke", credentials: { password: "secret-pass" } });
});

it("works at phone width: one column of cards and controls, every action reachable", async () => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
  window.dispatchEvent(new Event("resize"));
  render(<AgentsWorkspace />);
  const card = await screen.findByRole("article", { name: "Hermes" });
  for (const name of ["New agent", "Pause all agents…", "Create agent…"]) expect(screen.getByRole("button", { name })).toBeInTheDocument();
  for (const name of ["Rotate token…", "Change what it may ask…", "Revoke…"]) expect(within(card).getByRole("button", { name })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "New agent" }));
  expect(document.activeElement).toBe(screen.getByPlaceholderText("For example Hermes or Claude"));
  expect(document.querySelector("table")).toBeNull();
  expect(within(card).getByText(/Recent calls · 3 shown/)).toBeInTheDocument();
});

it("shows a retry when agents cannot be loaded, and loads again on Retry", async () => {
  fetchMock.mockImplementation(() => json({ error: "Only administrators, acting as themselves, can manage agents." }, 403));
  render(<AgentsWorkspace />);
  expect(await screen.findByText("Agents unavailable")).toBeInTheDocument();
  expect(screen.getByText("Only administrators, acting as themselves, can manage agents.")).toBeInTheDocument();
  serve(state);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("article", { name: "Hermes" })).toBeInTheDocument();
});

it("shows an empty list in words, separate from loading", async () => {
  serve({ ...state, agents: [] });
  render(<AgentsWorkspace />);
  expect(screen.getByRole("status")).toHaveTextContent("Loading agents…");
  expect(await screen.findByText("No agents yet.")).toBeInTheDocument();
  expect(screen.getByText("No agent has a valid token yet.", { exact: false })).toBeInTheDocument();
});

it("cancels an obsolete read: a newer load aborts the older one and its late answer is ignored", async () => {
  const stale = { ...state, paused: true, agents: [{ ...agent, name: "Stale answer" }] };
  let releaseSecond: (value: Response) => void = () => undefined;
  const signals: AbortSignal[] = [];
  let reads = 0;
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (String(url).includes("/api/me/admin-pin")) return json({ hasPin: true });
    if (init?.method === "POST") return json({ ok: true });
    reads += 1;
    if (init?.signal) signals.push(init.signal);
    if (reads === 2) return new Promise<Response>((resolve) => { releaseSecond = resolve; });
    return json(state);
  });
  render(<AgentsWorkspace />);
  await screen.findByRole("article", { name: "Hermes" });
  for (const [button, confirmLabel] of [["Pause all agents…", "Pause agents"], ["Pause all agents…", "Pause agents"]] as const) {
    fireEvent.click(screen.getByRole("button", { name: button }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(await within(dialog).findByLabelText("Your PIN"), { target: { value: "2468" } });
    fireEvent.click(within(dialog).getByRole("button", { name: confirmLabel }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  }
  await waitFor(() => expect(reads).toBe(3));
  expect(signals[1].aborted).toBe(true);
  releaseSecond(new Response(JSON.stringify(stale)));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(screen.queryByText("Stale answer")).toBeNull();
  expect(screen.getByRole("heading", { name: "Agents are on" })).toBeInTheDocument();
});
