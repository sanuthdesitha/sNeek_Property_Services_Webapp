/**
 * Owner decision 2026-11-12 (item B): the Accounts "Request document" dialog
 * asks which transport to use (Inbox / Email / SMS, each disabled with the
 * reason), sends the explicit choice, offers "Don't ask again", and afterwards
 * shows the saved choice as a visible "Sending by: … · Change" line. Command's
 * "Send reminder" uses the same choice component.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { DocumentRequestOptions } from "@/lib/workforce/document-request-transports";

import { DocumentRequestDialog } from "@/components/v2/admin/accounts/document-request-dialog";
import { DocumentReminderDialog } from "@/components/v2/admin/command/document-reminder-dialog";

const baseOptions = (overrides: Partial<DocumentRequestOptions> = {}): DocumentRequestOptions => ({
  person: { id: "c1", name: "Jane", hasEmail: true, hasPhone: false, active: true },
  transports: {
    PUSH: { available: true, reason: null },
    EMAIL: { available: true, reason: null },
    SMS: { available: false, reason: "No phone number recorded." },
  },
  saved: null,
  savedReadable: true,
  impersonating: false,
  ...overrides,
});

let currentOptions: DocumentRequestOptions = baseOptions();
const fetchMock = vi.fn();

function answer(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  currentOptions = baseOptions();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/admin/workforce/document-request?")) return answer(currentOptions);
    if (url.startsWith("/api/admin/workforce/document-reminder?")) {
      return answer({ documentId: "d1", title: "Police check", category: "COMPLIANCE", expiresAt: "2026-11-20T00:00:00.000Z", person: currentOptions.person, requestTitle: "Renewed Police check", wording: "The office requested Renewed Police check.", sentToday: null, options: currentOptions });
    }
    if (url === "/api/me/send-transports" && init?.method === "DELETE") return answer({ impersonating: false, readable: true, kinds: {} });
    if (url === "/api/admin/workforce" && init?.method === "POST") {
      return answer({ ok: true, result: { id: "req-1", requestId: "req-1", dayKey: "2026-11-12", replayed: false, delivery: { outcomes: [{ userId: "c1", name: "Jane", transport: "INBOX", path: "pipeline", state: "inbox_available" }, { userId: "c1", name: "Jane", transport: "EMAIL", path: "direct", state: "provider_accepted" }], sms: null } } });
    }
    return answer({ error: "not found" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const lastPost = () => {
  const call = fetchMock.mock.calls.filter(([url, init]) => url === "/api/admin/workforce" && (init as RequestInit | undefined)?.method === "POST").at(-1);
  return JSON.parse(String((call?.[1] as RequestInit).body));
};

function renderRequest() {
  const onSent = vi.fn();
  render(<DocumentRequestDialog open people={[{ id: "c1", name: "Jane", role: "CLEANER" }]} initialUserId="c1" onClose={() => undefined} onSent={onSent} />);
  return { onSent };
}

describe("Request document: Send by", () => {
  it("offers Inbox, Email and SMS with the reason a transport cannot be used, and sends the explicit choice", async () => {
    const { onSent } = renderRequest();
    const dialog = await screen.findByRole("dialog", { name: "Request a document" });
    const sms = await within(dialog).findByRole("checkbox", { name: /SMS/ });
    expect(sms).toBeDisabled();
    expect(within(dialog).getByText("No phone number recorded.")).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: /Inbox/ })).toBeChecked();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /^Email/ }));
    fireEvent.change(within(dialog).getByLabelText("Document title"), { target: { value: "Police check" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send request" }));
    expect(await within(dialog).findByText("In-app inbox: In their inbox")).toBeInTheDocument();
    expect(dialog.textContent).not.toMatch(/\bSent\b|Delivered/);
    expect(lastPost()).toMatchObject({ action: "REQUEST_DOCUMENT", userId: "c1", title: "Police check", transports: ["PUSH", "EMAIL"], rememberTransports: false });
    expect(onSent).toHaveBeenCalled();
  });

  it("remembers the choice for this office user only when Don't ask again is ticked", async () => {
    renderRequest();
    const dialog = await screen.findByRole("dialog", { name: "Request a document" });
    fireEvent.click(await within(dialog).findByRole("checkbox", { name: /Don't ask again/ }));
    fireEvent.change(within(dialog).getByLabelText("Document title"), { target: { value: "Licence" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send request" }));
    await within(dialog).findByText("In-app inbox: In their inbox");
    expect(lastPost()).toMatchObject({ transports: ["PUSH"], rememberTransports: true });
  });

  it("uses a saved choice with a visible Sending by line, names a saved transport this person cannot get, and Change shows the boxes again", async () => {
    currentOptions = baseOptions({ saved: { transports: ["PUSH", "EMAIL", "SMS"], savedAt: "2026-11-12T00:00:00.000Z" } });
    renderRequest();
    const dialog = await screen.findByRole("dialog", { name: "Request a document" });
    expect(await within(dialog).findByText("Inbox, Email")).toBeInTheDocument();
    expect(within(dialog).getByText(/SMS is not used for this person: No phone number recorded\./)).toBeInTheDocument();
    expect(within(dialog).queryByRole("checkbox", { name: /Inbox/ })).toBeNull();
    fireEvent.change(within(dialog).getByLabelText("Document title"), { target: { value: "Licence" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send request" }));
    await within(dialog).findByText("In-app inbox: In their inbox");
    // Only the usable saved transports are named; the saved choice is not re-saved.
    expect(lastPost()).toMatchObject({ transports: ["PUSH", "EMAIL"], rememberTransports: false });
  });

  it("Change reveals the choices with the saved ones ticked", async () => {
    currentOptions = baseOptions({ saved: { transports: ["EMAIL"], savedAt: "2026-11-12T00:00:00.000Z" } });
    renderRequest();
    const dialog = await screen.findByRole("dialog", { name: "Request a document" });
    fireEvent.click(await within(dialog).findByRole("button", { name: "Change" }));
    expect(within(dialog).getByRole("checkbox", { name: /^Email/ })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: /Inbox/ })).not.toBeChecked();
  });

  it("Ask me again forgets the saved choice on the server and shows the choices", async () => {
    currentOptions = baseOptions({ saved: { transports: ["EMAIL"], savedAt: "2026-11-12T00:00:00.000Z" } });
    renderRequest();
    const dialog = await screen.findByRole("dialog", { name: "Request a document" });
    fireEvent.click(await within(dialog).findByRole("button", { name: "Ask me again" }));
    await waitFor(() => expect(within(dialog).getByRole("checkbox", { name: /^Email/ })).toBeInTheDocument());
    expect(fetchMock.mock.calls.some(([url, init]) => url === "/api/me/send-transports" && (init as RequestInit).method === "DELETE")).toBe(true);
  });

  it("keeps the draft and shows the server's refusal", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/admin/workforce/document-request?")) return answer(currentOptions);
      if (url === "/api/admin/workforce" && init?.method === "POST") return answer({ error: "Document requests cannot be sent while impersonating." }, 403);
      return answer({}, 404);
    });
    renderRequest();
    const dialog = await screen.findByRole("dialog", { name: "Request a document" });
    await within(dialog).findByRole("checkbox", { name: /Inbox/ });
    fireEvent.change(within(dialog).getByLabelText("Document title"), { target: { value: "Licence" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send request" }));
    expect(await within(dialog).findByText("Document requests cannot be sent while impersonating.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Document title")).toHaveValue("Licence");
  });
});

describe("Command Send reminder uses the same choice and saved preference", () => {
  it("shows the saved choice line and sends the usable saved transports explicitly", async () => {
    currentOptions = baseOptions({ saved: { transports: ["EMAIL"], savedAt: "2026-11-12T00:00:00.000Z" } });
    render(<DocumentReminderDialog documentId="d1" endpoint="/api/admin/workforce" timeZone="Australia/Sydney" onClose={() => undefined} onSent={() => undefined} />);
    const dialog = await screen.findByRole("dialog", { name: "Send reminder" });
    expect(await within(dialog).findByText("Email")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Change" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Send reminder" }));
    await within(dialog).findByText("Email: Accepted by the provider");
    expect(lastPost()).toMatchObject({ action: "REQUEST_DOCUMENT", documentId: "d1", transports: ["EMAIL"], rememberTransports: false });
  });
});
