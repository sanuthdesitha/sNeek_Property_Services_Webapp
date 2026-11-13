import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentRequestsTab } from "@/components/v2/admin/approvals/agent-requests-tab";
import { readApprovalsUrl } from "@/components/v2/admin/approvals/use-approvals-state";
import type { AgentRequestView, AgentRequestsResponse } from "@/lib/agents/action-views";

const hourAgo = new Date(Date.now() - 3 * 3_600_000).toISOString();
const waiting: AgentRequestView = {
  id: "req-1", agentName: "Hermes", agentStatus: "ACTIVE", tool: "request_reschedule_job", toolLabel: "Reschedule a job",
  status: "WAITING", statusLabel: "Waiting", summary: "Reschedule job J-12 at Beach House from Thu 20 Nov 10:00 to Fri 21 Nov 10:00.",
  details: ["From Thu 20 Nov, 10:00", "To Fri 21 Nov, 10:00", "Reason given by the agent: \"Guest checks out late\""],
  effects: ["The reschedule notifies the assigned cleaners and sends the client's schedule-update email when that is switched on."],
  createdAt: hourAgo, expiresAt: new Date(Date.now() + 20 * 3_600_000).toISOString(), decidedAt: null, decidedBy: null, decisionReason: null, outcome: null,
  canDecide: true, refusal: null, needsPin: false,
};
const refused: AgentRequestView = { ...waiting, id: "req-2", tool: "request_case_note", toolLabel: "Internal note on a case", summary: "Add an internal note to the case \"Broken lamp\".", details: [], effects: [], canDecide: false, refusal: "Adding case notes needs Cases set to Manage in your access." };
const failed: AgentRequestView = { ...waiting, id: "req-3", status: "FAILED", statusLabel: "Not applied", outcome: "Job J-12 · Beach House changed after the agent asked, so this preview is out of date. Nothing was applied; ask the agent for a new request.", decidedAt: hourAgo, decidedBy: "Owner", canDecide: false };
const state: AgentRequestsResponse = { paused: false, waiting: [waiting, refused], history: [failed] };

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
function setPhone(phone: boolean) {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: (query: string) => ({ matches: phone, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
}
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) => (String(url).includes("/api/me/admin-pin") ? json({ hasPin: true, lockedUntil: null, userId: "admin-1" }) : json(state)));
  setPhone(false);
});
afterEach(() => vi.unstubAllGlobals());

describe("Approvals › Agent requests", () => {
  it("is reached by ?tab=agents", () => {
    expect(readApprovalsUrl("?tab=agents").tab).toBe("agents");
    expect(readApprovalsUrl("?tab=other").tab).toBe("waiting");
  });

  it("lists waiting requests with the agent, the exact change, its age and what approving also does; history shows the outcome", async () => {
    render(<AgentRequestsTab timezone="Australia/Sydney" />);
    const cards = await screen.findAllByTestId("agent-request");
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByText("Hermes · Reschedule a job")).toBeInTheDocument();
    expect(within(cards[0]).getByText(/from Thu 20 Nov 10:00 to Fri 21 Nov 10:00/)).toBeInTheDocument();
    expect(within(cards[0]).getByText("Waiting 3 h")).toBeInTheDocument();
    expect(within(cards[0]).getByText(/notifies the assigned cleaners/)).toBeInTheDocument();
    expect(within(cards[1]).getByText(/You cannot decide this: Adding case notes needs Cases/)).toBeInTheDocument();
    expect(within(cards[1]).getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByText("Not applied")).toBeInTheDocument();
    expect(screen.getByText(/Outcome: Job J-12 · Beach House changed after the agent asked/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Waiting (2)" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(document.querySelector("main")).toBeNull();
  });

  it("approves after a confirmation, shows the server's outcome and reloads", async () => {
    render(<AgentRequestsTab timezone="Australia/Sydney" />);
    const [card] = await screen.findAllByTestId("agent-request");
    fireEvent.click(within(card).getByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/checks your access and the current state again/)).toBeInTheDocument();
    fetchMock.mockImplementation((url: string, init?: RequestInit) => (init?.method === "POST" ? json({ status: "EXECUTED", message: "Rescheduled." }) : json(state)));
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    expect(await screen.findByText("Rescheduled.")).toHaveAttribute("role", "status");
    const post = fetchMock.mock.calls.find((call) => call[1]?.method === "POST")!;
    expect(post[0]).toBe("/api/admin/agent-requests/req-1");
    expect(JSON.parse(post[1].body)).toEqual({ decision: "approve" });
  });

  it("reports a stale preview as not applied, with the reason, as an alert", async () => {
    render(<AgentRequestsTab timezone="Australia/Sydney" />);
    const [card] = await screen.findAllByTestId("agent-request");
    fireEvent.click(within(card).getByRole("button", { name: "Approve" }));
    fetchMock.mockImplementation((url: string, init?: RequestInit) => (init?.method === "POST" ? json({ status: "FAILED", message: "The job changed after the agent asked." }) : json(state)));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not applied: The job changed after the agent asked.");
  });

  it("rejects with an optional reason; a refused decision keeps the dialog and the typed reason", async () => {
    render(<AgentRequestsTab timezone="Australia/Sydney" />);
    const [card] = await screen.findAllByTestId("agent-request");
    fireEvent.click(within(card).getByRole("button", { name: "Reject" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Reason (optional)"), { target: { value: "Client asked to keep Thursday" } });
    fetchMock.mockImplementation((url: string, init?: RequestInit) => (init?.method === "POST" ? json({ error: "Agent requests cannot be decided while testing as someone.", code: "IMPERSONATING" }, 403) : json(state)));
    fireEvent.click(within(dialog).getByRole("button", { name: "Reject" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("testing as someone");
    expect(within(dialog).getByLabelText("Reason (optional)")).toHaveValue("Client asked to keep Thursday");
    const post = fetchMock.mock.calls.find((call) => call[1]?.method === "POST")!;
    expect(JSON.parse(post[1].body)).toEqual({ decision: "reject", reason: "Client asked to keep Thursday" });
  });

  it("asks for the approver's own PIN when the action needs one", async () => {
    fetchMock.mockImplementation((url: string) => (String(url).includes("/api/me/admin-pin") ? json({ hasPin: true, lockedUntil: null, userId: "admin-1" }) : json({ ...state, waiting: [{ ...waiting, needsPin: true }] })));
    render(<AgentRequestsTab timezone="Australia/Sydney" />);
    const [card] = await screen.findAllByTestId("agent-request");
    fireEvent.click(within(card).getByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Approve" });
    expect(confirm).toBeDisabled();
    fireEvent.change(await within(dialog).findByLabelText("Your PIN"), { target: { value: "2468" } });
    await waitFor(() => expect(confirm).not.toBeDisabled());
  });

  it("says when agents are paused, and separates loading, failure and empty", async () => {
    fetchMock.mockImplementation(() => json({ paused: true, waiting: [], history: [] }));
    const { unmount } = render(<AgentRequestsTab timezone="Australia/Sydney" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading agent requests");
    expect(await screen.findByText("All agents are paused")).toBeInTheDocument();
    expect(screen.getByText("No agent request is waiting.")).toBeInTheDocument();
    unmount();
    fetchMock.mockImplementation(() => json({ error: "You do not have access to agent requests." }, 403));
    render(<AgentRequestsTab timezone="Australia/Sydney" />);
    expect(await screen.findByText("Agent requests unavailable")).toBeInTheDocument();
    expect(screen.queryByText("No agent request is waiting.")).toBeNull();
  });

  it("on a phone: section chips for Waiting and Decided, full-width decision buttons and the bottom-sheet dialog", async () => {
    setPhone(true);
    render(<AgentRequestsTab timezone="Australia/Sydney" />);
    const [card] = await screen.findAllByTestId("agent-request");
    const sections = screen.getByRole("navigation", { name: "Agent request sections" });
    expect(within(sections).getByText(/Waiting/)).toBeInTheDocument();
    expect(within(sections).getByText("Decided")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Approve" }).className).toContain("max-sm:flex-1");
    fireEvent.click(within(card).getByRole("button", { name: "Reject" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Reason (optional)").className).toContain("text-[16px]");
  });
});
