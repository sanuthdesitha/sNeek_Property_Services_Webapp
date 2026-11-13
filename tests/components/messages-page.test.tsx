/**
 * Messages page (board "Messages", 2026-11): the old compose URL keeps its
 * query, the server page reads the composer capability and the classic
 * `?recipient=`, the composer says why a transport is off and sends each
 * transport explicitly, a failed reply stays with Retry, and the thread
 * shows read receipts honestly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const m = vi.hoisted(() => ({ redirect: vi.fn(), can: vi.fn(), client: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    m.redirect(url);
    throw new Error("NEXT_REDIRECT");
  },
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: vi.fn(async () => ({ user: { id: "u1", role: "OPS_MANAGER" } })) }));
vi.mock("@/lib/rbac/can", () => ({ can: m.can }));
vi.mock("@/lib/db", () => ({ db: { client: { findFirst: m.client } } }));
vi.mock("@/lib/settings", () => ({ getAppSettings: vi.fn(async () => ({ timezone: "Australia/Sydney" })) }));

import ComposeRedirect from "@/app/v2/admin/messages/compose/page";
import MessagesRoute from "@/app/v2/admin/messages/page";
import { MessagesPage } from "@/components/v2/admin/messages/inbox/messages-page";

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let failReplies = false;

const threads = [
  {
    id: "c1",
    name: "Harbour View Stays",
    email: "emma@harbourview.com.au",
    updatedAt: "2026-11-12T00:00:00Z",
    messages: [{ id: "m2", body: "Can the Manly Loft clean start at 9?", createdAt: "2026-11-11T23:42:00Z", isFromAdmin: false, isRead: false }],
    _count: { messages: 1 },
  },
];
const thread = [
  { id: "m1", body: "We moved Friday's clean.", isFromAdmin: true, isRead: true, createdAt: "2026-11-11T05:34:00Z", sentBy: { id: "o", name: "Chloe Martin", email: null, role: "ADMIN" } },
  { id: "m2", body: "Can the Manly Loft clean start at 9?", isFromAdmin: false, createdAt: "2026-11-11T23:42:00Z", jobId: "job-1066", sentBy: { id: "g", name: "Grace Kim", email: null, role: "VA" } },
];

beforeEach(() => {
  calls = [];
  failReplies = false;
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const json = (data: unknown, ok = true) => ({ ok, json: async () => data });
      if (url === "/api/admin/messages" && method === "POST") return failReplies ? json({ error: "Client not found." }, false) : json({ id: "m3", body: "ok", isFromAdmin: true, isRead: false, createdAt: "2026-11-12T00:00:00Z" });
      if (url.startsWith("/api/admin/messages?clientId=")) return json({ clients: threads, messages: thread });
      if (url === "/api/admin/messages") return json({ clients: threads });
      if (url.startsWith("/api/admin/messages/templates")) return json({ templates: [] });
      if (url.startsWith("/api/admin/messages/send")) return json({ ok: true, channel: "EMAIL" });
      if (url.startsWith("/api/admin/messages/preview")) return json({ body: "Hi" });
      return json([]);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("routes", () => {
  it("redirects the old compose URL into the page and keeps its query", async () => {
    await expect(ComposeRedirect({ searchParams: { recipient: "c1", compose: "x" } })).rejects.toThrow("NEXT_REDIRECT");
    expect(m.redirect).toHaveBeenCalledWith("/v2/admin/messages?recipient=c1&compose=1");
  });

  it("reads the composer capability and the classic recipient on the server", async () => {
    m.can.mockResolvedValue(false);
    m.client.mockResolvedValue({ id: "c1", name: "Harbour View Stays", email: "e@x", phone: null });
    const element = await MessagesRoute({ searchParams: { recipient: "c1" } });
    expect(m.can).toHaveBeenCalledWith(expect.anything(), "messages.compose_send");
    expect(m.client).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "c1", isActive: true } }));
    expect(element.props).toMatchObject({ canSend: false, initialCompose: true, recipientMissing: false, initialRecipient: { id: "c1", kind: "client", phone: null } });
  });
});

describe("Messages page", () => {
  const page = (overrides: Partial<React.ComponentProps<typeof MessagesPage>> = {}) =>
    render(<MessagesPage canSend timezone="Australia/Sydney" initialCompose={false} initialRecipient={null} recipientMissing={false} initialClientId={null} {...overrides} />);

  it("shows real counts and opens a thread with authors and read receipts", async () => {
    page();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    await waitFor(() => expect(screen.getByRole("button", { name: /Unread 1/ })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Harbour View Stays/ }));
    const conversation = await screen.findByRole("region", { name: "Harbour View Stays conversation" });
    await waitFor(() => expect(conversation.textContent).toMatch(/Chloe Martin · 16:34 · Read/));
    expect(conversation.textContent).toMatch(/Grace Kim, assistant · 10:42/);
    expect(within(conversation).getByRole("link", { name: "Open job" }).getAttribute("href")).toBe("/v2/admin/jobs/job-1066");
  });

  it("keeps a failed reply with its error and Retry", async () => {
    failReplies = true;
    page({ initialClientId: "c1" });
    const reply = await screen.findByLabelText("Reply");
    fireEvent.change(reply, { target: { value: "Yes, 09:00 works." } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByText(/Not saved: Client not found\./)).toBeTruthy());
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(calls.find((c) => c.method === "POST" && c.url === "/api/admin/messages")?.body).toEqual({ clientId: "c1", body: "Yes, 09:00 works." });
  });

  it("disables SMS and Both with the reason when the recipient has no phone, and sends email explicitly", async () => {
    page({ initialCompose: true, initialRecipient: { id: "c2", kind: "client", name: "Northside Lets", email: "kim@northside.com", phone: null } });
    const compose = screen.getByRole("complementary", { name: "Compose with a template" });
    expect(within(compose).getByRole("radio", { name: "SMS" }).hasAttribute("disabled")).toBe(true);
    expect(within(compose).getByRole("radio", { name: "Both" }).hasAttribute("disabled")).toBe(true);
    expect(compose.textContent).toMatch(/no phone on file, so SMS would not send/);
    fireEvent.change(within(compose).getByLabelText("Message"), { target: { value: "Hi {{client.firstName}}" } });
    fireEvent.click(within(compose).getByRole("button", { name: "Send email" }));
    await waitFor(() => expect(calls.find((c) => c.url === "/api/admin/messages/send")?.body).toMatchObject({ channel: "EMAIL", recipientEmail: "kim@northside.com", context: { clientId: "c2" } }));
    expect(calls.filter((c) => c.url === "/api/admin/messages/send")).toHaveLength(1);
  });

  it("says before sending when the composer send is not allowed", () => {
    page({ canSend: false, initialCompose: true, initialRecipient: { id: "c2", kind: "client", name: "Northside Lets", email: "kim@northside.com", phone: null } });
    const compose = screen.getByRole("complementary", { name: "Compose with a template" });
    expect(within(compose).getByRole("button", { name: "Send email" }).hasAttribute("disabled")).toBe(true);
    expect(compose.textContent).toMatch(/access does not include sending from the composer/);
  });

  it("docks New message on the phone conversation list and hides it once composing (board M-QuotesMessages)", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("max-width"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    page();
    const bar = await screen.findByRole("region", { name: "Messages actions" });
    fireEvent.click(within(bar).getByRole("button", { name: "New message" }));
    expect(screen.getByRole("complementary", { name: "Compose with a template" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Messages actions" })).toBeNull();
  });
});
