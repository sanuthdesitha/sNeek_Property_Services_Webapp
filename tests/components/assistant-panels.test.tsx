import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AskPanel } from "@/components/v2/admin/command/ask-panel";
import { AiDraftButton, ExplainFlagButton } from "@/components/v2/shared/ai-help";

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

it("Ask shows the answer with links to the records and keeps the question", async () => {
  fetchMock.mockImplementation(() => json({ state: "answered", answer: "J-1 has no cleaner.", citations: [{ type: "job", id: "j1", label: "Job J-1", href: "/v2/admin/jobs/j1" }], untrustedIncluded: true }));
  render(<AskPanel />);
  fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "Which jobs need a cleaner?" } });
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  expect(await screen.findByText("J-1 has no cleaner.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Job J-1" })).toHaveAttribute("href", "/v2/admin/jobs/j1");
  expect(screen.getByText(/text written by clients or cleaners/)).toBeInTheDocument();
  expect((screen.getByLabelText("Your question") as HTMLInputElement).value).toBe("Which jobs need a cleaner?");
});

it("Ask shows unavailable separately from an error, and offers a retry on errors", async () => {
  fetchMock.mockImplementationOnce(() => json({ state: "unavailable", reason: "No AI provider is configured for Ask (Settings, AI)." }));
  render(<AskPanel />);
  fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "Jobs today?" } });
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  expect(await screen.findByText(/Ask is unavailable: No AI provider/)).toBeInTheDocument();
  expect(screen.queryByRole("alert")).toBeNull();
  fetchMock.mockImplementationOnce(() => json({ error: "Ask could not answer right now." }, 502));
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Ask could not answer right now.");
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
});

it("a draft only reaches the editor when the person chooses Use this draft", async () => {
  const onUse = vi.fn();
  fetchMock.mockImplementation(() => json({ state: "drafted", draft: "Hi Ana, thanks." }));
  render(<AiDraftButton scopeKey="c1" withIntent request={{ kind: "client_reply", clientId: "c1" }} onUse={onUse} />);
  fireEvent.change(screen.getByLabelText(/What should the reply say/), { target: { value: "say thanks" } });
  fireEvent.click(screen.getByRole("button", { name: "Draft with AI" }));
  expect(await screen.findByText("Hi Ana, thanks.")).toBeInTheDocument();
  expect(onUse).not.toHaveBeenCalled();
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ kind: "client_reply", clientId: "c1", intent: "say thanks" });
  fireEvent.click(screen.getByRole("button", { name: "Use this draft" }));
  expect(onUse).toHaveBeenCalledWith("Hi Ana, thanks.");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("Explain shows the explanation, or the unavailable reason", async () => {
  fetchMock.mockImplementationOnce(() => json({ state: "explained", explanation: "The glass shows spots.", whatToCheck: ["Lower glass"] }));
  const view = render(<ExplainFlagButton jobId="job-1" kind="finding" id="m1:0" />);
  fireEvent.click(screen.getByRole("button", { name: "Explain" }));
  expect(await screen.findByText("The glass shows spots.")).toBeInTheDocument();
  expect(screen.getByText("Lower glass")).toBeInTheDocument();
  fetchMock.mockImplementationOnce(() => json({ state: "unavailable", reason: "This AI feature is switched off in Settings, AI." }));
  view.rerender(<ExplainFlagButton jobId="job-1" kind="finding" id="m1:1" />);
  fireEvent.click(screen.getByRole("button", { name: "Explain" }));
  expect(await screen.findByText(/AI unavailable: This AI feature is switched off/)).toBeInTheDocument();
});
