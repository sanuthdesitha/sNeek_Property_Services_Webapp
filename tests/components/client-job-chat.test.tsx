import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { JobChatSheet } from "@/components/v2/client/job-chat";
const session = vi.hoisted(() => ({ user: { id: "client-one", role: "CLIENT" } }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ status: "authenticated", data: session }) }));
const context = "a".repeat(64);
const key = `client-job-message-v1:${context}`;
const row = { id: "message-one", jobId: "job-one", body: "Please check the key", isFromAdmin: false, createdAt: new Date().toISOString(), sentBy: { id: "client-one", name: "Client", role: "CLIENT" } };
const reply = (value: unknown, status = 200, scope = context) => new Response(JSON.stringify(value), { status, headers: { "X-Client-Message-Context": scope } });
const props = { jobId: "job-one", jobLabel: "Harbour House - clean 42", open: true, onClose: vi.fn() };
beforeEach(() => { sessionStorage.clear(); session.user.id = "client-one"; Object.defineProperty(navigator, "onLine", { configurable: true, value: true }); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply([]))); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const composer = () => screen.getByRole("textbox", { name: "Message the sNeek team about this clean" });
async function ready() { await waitFor(() => expect(composer()).toBeEnabled()); }
it("keeps job and client correspondence context visible and restores only a verified context draft", async () => {
  sessionStorage.setItem(key, JSON.stringify({ version: 1, body: "Saved draft", pending: null }));
  render(<JobChatSheet {...props}/>); await ready();
  expect(composer()).toHaveValue("Saved draft"); expect(screen.getByText(props.jobLabel)).toBeVisible(); expect(screen.getByText("Client correspondence with the office")).toBeVisible();
});
it("does not disguise a malformed or failed read as an empty conversation", async () => {
  vi.mocked(fetch).mockResolvedValue(reply({ malformed: true })); render(<JobChatSheet {...props}/>);
  expect(await screen.findByText("Messages could not be verified. Refresh to try again.")).toBeVisible();
  expect(screen.queryByText(/Ask anything/)).toBeNull(); expect(composer()).toBeDisabled();
  vi.mocked(fetch).mockResolvedValue(reply([], 503)); fireEvent.click(screen.getByRole("button", { name: "Refresh messages" }));
  expect(await screen.findByText(/Could not refresh messages/)).toBeVisible();
});
it("persists the exact request before dispatch and retries an uncertain result with the same receipt", async () => {
  const calls: any[] = [];
  vi.mocked(fetch).mockImplementation(async (_url, init) => {
    if (init?.method !== "POST") return reply([]);
    const request = JSON.parse(String(init.body)); calls.push(request);
    expect(JSON.parse(sessionStorage.getItem(key)!)).toMatchObject({ pending: request.requestId ? { requestId: request.requestId, body: request.body, context } : null });
    if (calls.length === 1) throw new Error("Connection lost");
    return reply({ ...row, requestId: request.requestId, duplicated: true, deliveryWarning: "Message already saved; office delivery unconfirmed." });
  });
  render(<JobChatSheet {...props}/>); await ready(); fireEvent.change(composer(), { target: { value: row.body } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await screen.findByText("Connection lost"); expect(composer()).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Retry same message" }));
  await waitFor(() => expect(composer()).toHaveValue("")); expect(calls).toHaveLength(2); expect(calls[0]).toEqual(calls[1]); expect(sessionStorage.getItem(key)).toBeNull();
  expect(screen.getAllByText(row.body)).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Refresh messages" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4)); expect(screen.getByText("Message already saved; office delivery unconfirmed.")).toBeVisible();
});
it("retains malformed acknowledgements and restores their original UUID after remount", async () => {
  vi.mocked(fetch).mockImplementation(async (_url, init) => init?.method === "POST" ? reply({ ...row, requestId: "wrong" }) : reply([]));
  const view = render(<JobChatSheet {...props}/>); await ready(); fireEvent.change(composer(), { target: { value: row.body } }); fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await screen.findByText(/send receipt could not be verified/); const saved = sessionStorage.getItem(key); view.unmount();
  render(<JobChatSheet {...props}/>); await waitFor(() => expect(screen.getByRole("button", { name: "Retry same message" })).toBeEnabled()); expect(composer()).toHaveValue(row.body); expect(sessionStorage.getItem(key)).toBe(saved);
});
it("keeps an unreadable saved draft intact and refuses sends", async () => {
  sessionStorage.setItem(key, "broken"); render(<JobChatSheet {...props}/>);
  expect(await screen.findByText(/saved conversation draft could not be read safely/)).toBeVisible(); expect(composer()).toBeDisabled(); expect(sessionStorage.getItem(key)).toBe("broken");
});
it("clears visible messages on access loss and preserves the earlier scoped draft", async () => {
  vi.mocked(fetch).mockResolvedValue(reply([row])); render(<JobChatSheet {...props}/>); await ready();
  fireEvent.change(composer(), { target: { value: "Earlier draft" } }); vi.mocked(fetch).mockResolvedValue(reply({}, 403)); fireEvent.click(screen.getByRole("button", { name: "Refresh messages" }));
  await screen.findByText(/Conversation access changed/); expect(screen.queryByText(row.body)).toBeNull(); expect(composer()).toHaveValue(""); expect(sessionStorage.getItem(key)).toContain("Earlier draft");
});
it("blocks changed server context instead of transferring a draft", async () => {
  render(<JobChatSheet {...props}/>); await ready(); fireEvent.change(composer(), { target: { value: "Old context draft" } });
  vi.mocked(fetch).mockResolvedValue(reply([], 200, "b".repeat(64))); fireEvent.click(screen.getByRole("button", { name: "Refresh messages" }));
  await screen.findByText(/Conversation context changed/); expect(composer()).toBeDisabled(); expect(sessionStorage.getItem(key)).toContain("Old context draft"); expect(sessionStorage.getItem(`client-job-message-v1:${"b".repeat(64)}`)).toBeNull();
});
it("does not dispatch offline or when it cannot save a recovery receipt", async () => {
  render(<JobChatSheet {...props}/>); await ready(); fireEvent.change(composer(), { target: { value: row.body } });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false }); act(() => window.dispatchEvent(new Event("offline")));
  expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true }); act(() => window.dispatchEvent(new Event("online")));
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); }); fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await screen.findByText(/Browser storage is unavailable/); expect(fetch).toHaveBeenCalledTimes(1);
});
it("remounts on account changes so another client cannot see the earlier draft", async () => {
  const view = render(<JobChatSheet {...props}/>); await ready(); fireEvent.change(composer(), { target: { value: "Private draft" } });
  session.user.id = "client-two"; vi.mocked(fetch).mockResolvedValue(reply([], 200, "b".repeat(64))); view.rerender(<JobChatSheet {...props}/>); await ready(); expect(composer()).toHaveValue(""); expect(sessionStorage.getItem(key)).toContain("Private draft");
});
it("ignores a read started before a successful send and refreshes after that acknowledgement", async () => {
  let completeOld: (response: Response) => void = () => {};
  let reads = 0;
  vi.mocked(fetch).mockImplementation(async (_url, init) => {
    if (init?.method === "POST") return reply({ ...row, requestId: JSON.parse(String(init.body)).requestId });
    reads += 1;
    if (reads === 2) return new Promise<Response>(resolve => { completeOld = resolve; });
    return reply(reads > 2 ? [row] : []);
  });
  render(<JobChatSheet {...props}/>); await ready();
  fireEvent.click(screen.getByRole("button", { name: "Refresh messages" }));
  fireEvent.change(composer(), { target: { value: row.body } }); fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await screen.findByText("Message saved.");
  await act(async () => completeOld(reply([])));
  await waitFor(() => expect(reads).toBe(3)); expect(screen.getByText(row.body)).toBeVisible();
});
