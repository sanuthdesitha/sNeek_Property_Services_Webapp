/**
 * Messages board (2026-11): explicit transports with missing-contact
 * reasons, variable source checks, send blocking (incl. the composer send
 * capability) and honest per-channel outcomes; thread counts, filters,
 * authors, read state and the stacked phone views.
 */
import { describe, expect, it } from "vitest";
import { channelOutcome, channelsFor, checkVariables, reconcileTransport, sendBlock, sendButtonLabel, transportOptions, type ComposeRecipient } from "@/lib/messages/compose-checks";
import { authorLabel, filterThreads, initialView, nextView, officeMessageState, threadCounts, threadDayLabel, type ThreadSummary } from "@/lib/messages/thread-model";

const kim: ComposeRecipient = { id: "c2", kind: "client", name: "Northside Lets", email: "kim@northside.com", phone: null };
const both: ComposeRecipient = { ...kim, phone: "0400 000 000" };

describe("transports", () => {
  it("disables a transport the recipient cannot receive, with the reason", () => {
    const options = transportOptions(kim);
    expect(options.find((o) => o.transport === "EMAIL")).toEqual({ transport: "EMAIL", enabled: true, reason: null });
    expect(options.find((o) => o.transport === "SMS")?.reason).toBe("Northside Lets has no phone on file, so SMS would not send.");
    expect(options.find((o) => o.transport === "BOTH")?.enabled).toBe(false);
    expect(transportOptions(null).every((o) => !o.enabled && o.reason === "Choose a recipient first.")).toBe(true);
  });

  it("never silently swaps a chosen transport: keeps it when possible, else picks a single one", () => {
    expect(reconcileTransport("BOTH", both)).toBe("BOTH");
    expect(reconcileTransport("SMS", kim)).toBe("EMAIL");
    expect(reconcileTransport("EMAIL", { ...kim, email: null })).toBeNull();
    expect(channelsFor("BOTH")).toEqual(["EMAIL", "SMS"]);
    expect(sendButtonLabel("BOTH")).toBe("Send email and SMS");
  });

  it("blocks sending with a reason (capability, recipient, contact, empty message)", () => {
    const base = { canSend: true, recipient: both, transport: "EMAIL" as const, body: "Hi", sending: false };
    expect(sendBlock(base)).toEqual({ blocked: false, reason: null });
    expect(sendBlock({ ...base, canSend: false }).reason).toMatch(/access does not include sending/);
    expect(sendBlock({ ...base, recipient: null }).reason).toBe("Choose a recipient.");
    expect(sendBlock({ ...base, recipient: kim, transport: "SMS" }).reason).toMatch(/no phone/);
    expect(sendBlock({ ...base, body: "  " }).reason).toBe("Write the message first.");
  });

  it("reports provider outcomes honestly (skipped and failed are not sent)", () => {
    expect(channelOutcome("EMAIL", true, { ok: true }).state).toBe("sent");
    expect(channelOutcome("EMAIL", true, { ok: false, error: "RESEND_API_KEY is not configured" })).toMatchObject({ state: "failed", detail: expect.stringContaining("RESEND_API_KEY") });
    expect(channelOutcome("SMS", true, { ok: false, status: "not_configured" }).state).toBe("skipped");
    expect(channelOutcome("SMS", false, { error: "Capability required" }).state).toBe("failed");
    expect(channelOutcome("EMAIL", true, { ok: true }).detail).toMatch(/not confirmed/);
  });
});

describe("variable sources", () => {
  it("lists variables with no source and passes when every root has one", () => {
    expect(checkVariables("", "Hello", {})).toEqual({ state: "none" });
    expect(checkVariables("About {{property.name}}", "Hi {{client.firstName}} {{job.scheduledFor | date short}}", { clientId: "c1" })).toEqual({
      state: "missing",
      missing: [{ root: "property", needs: "a property" }, { root: "job", needs: "a job" }],
    });
    expect(checkVariables("", "Hi {{client.firstName}} at {{property.name}}", { clientId: "c1", propertyId: "p1" })).toEqual({ state: "sourced", roots: ["client", "property"] });
    expect(checkVariables("", "{{weather.today}}", {})).toMatchObject({ state: "missing", missing: [{ root: "weather" }] });
  });
});

const thread = (id: string, last: { isFromAdmin: boolean } | null, unread = 0): ThreadSummary => ({
  id,
  name: `Client ${id}`,
  email: `${id}@x.com`,
  updatedAt: "2026-11-12T00:00:00Z",
  messages: last ? [{ id: `m-${id}`, body: `hello from ${id}`, createdAt: "2026-11-12T00:00:00Z", isFromAdmin: last.isFromAdmin, isRead: false }] : [],
  _count: { messages: unread },
});

describe("conversations", () => {
  const threads = [thread("a", { isFromAdmin: false }, 2), thread("b", { isFromAdmin: true }), thread("c", { isFromAdmin: false }), thread("d", null)];

  it("counts real conversations, unread and waiting on us", () => {
    expect(threadCounts(threads)).toEqual({ all: 3, unread: 1, waiting: 2, capped: false });
  });

  it("filters conversations, and a search also finds clients with no messages yet", () => {
    expect(filterThreads(threads, "all", "").map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(filterThreads(threads, "waiting", "").map((t) => t.id)).toEqual(["a", "c"]);
    expect(filterThreads(threads, "all", "client d").map((t) => t.id)).toEqual(["d"]);
  });

  it("names who wrote each message, including a client's assistant, and says read only when read", () => {
    expect(authorLabel({ id: "1", body: "", isFromAdmin: false, createdAt: "", sentBy: { id: "u", name: "Grace Kim", email: null, role: "VA" } }, "Harbour")).toBe("Grace Kim, assistant");
    expect(authorLabel({ id: "1", body: "", isFromAdmin: false, createdAt: "", sentBy: null }, "Harbour")).toBe("Harbour");
    expect(officeMessageState({ id: "1", body: "", isFromAdmin: true, createdAt: "", isRead: false })).toBe("Saved · not read yet");
    expect(officeMessageState({ id: "1", body: "", isFromAdmin: true, createdAt: "", isRead: true })).toBe("Read");
  });

  it("labels days by the organisation's calendar", () => {
    const now = new Date("2026-11-12T01:00:00Z"); // 12:00 in Sydney
    expect(threadDayLabel("2026-11-11T22:00:00Z", "Australia/Sydney", now)).toBe("Today");
    expect(threadDayLabel("2026-11-11T05:00:00Z", "Australia/Sydney", now)).toBe("Yesterday");
  });
});

describe("stacked phone views", () => {
  it("goes list → thread → compose and back again", () => {
    let state = initialView({ compose: false, threadOpen: false });
    expect(state.view).toBe("list");
    state = nextView(state, { type: "open-thread" });
    expect(state.view).toBe("thread");
    state = nextView(state, { type: "open-compose" });
    expect(state.view).toBe("compose");
    state = nextView(state, { type: "back" });
    expect(state.view).toBe("thread");
    state = nextView(state, { type: "back" });
    expect(state.view).toBe("list");
  });

  it("opens straight into compose from the old compose URL, with back to the list", () => {
    const state = initialView({ compose: true, threadOpen: false });
    expect(state.view).toBe("compose");
    expect(nextView(state, { type: "close-compose" }).view).toBe("list");
  });
});
