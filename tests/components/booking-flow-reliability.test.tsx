import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EstateBookingFlow } from "@/components/v2/client/booking-flow";
import ClientBookingPage from "@/app/v2/client/booking/page";
vi.mock("@/components/v2/client/booking-review-details", () => ({ BookingReviewDetails: () => null }));

const mocks = vi.hoisted(() => ({ auth: vi.fn(), properties: vi.fn(), scope: vi.fn() }));
vi.mock("@/lib/auth/client-portal", () => ({
  requireClientPortalPage: mocks.auth, propertyScopeWhere: mocks.scope,
}));
vi.mock("@/lib/db", () => ({ db: { property: { findMany: mocks.properties } } }));

const properties = [
  { id: "p-1", name: "Harbour apartment", suburb: "Sydney", bedrooms: 2, bathrooms: 1 },
  { id: "p-2", name: "Garden house", suburb: "Glebe", bedrooms: 3, bathrooms: 2 },
];
const identity = { actorName: "Alex Assistant", actingFor: "Harbour Stays" };
const slots = (available = ["2099-09-10", "2099-09-11"]) => ({
  available, windowStart: "2099-09-01", windowEnd: "2099-09-30",
});
function response(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const fetchMock = vi.fn<typeof fetch>();
const randomUUID = vi.fn(() => "11111111-1111-4111-8111-111111111111");
const next = () => fireEvent.click(screen.getByRole("button", { name: "Continue" }));
const back = () => fireEvent.click(screen.getByRole("button", { name: "Back" }));
const postCalls = () => fetchMock.mock.calls.filter(([, options]) => options?.method === "POST");
async function review() {
  next();
  await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
  next();
  expect(screen.getByText("Confirm your request")).toBeVisible();
}
function mount() {
  return render(<EstateBookingFlow properties={properties} {...identity} />);
}
function portal(overrides = {}) {
  return {
    actor: "VA", userId: "actor-1", userName: identity.actorName, clientId: "client-1",
    team: { id: "team-1", name: "Office" }, actorLabel: "VA login (Office) on behalf of Harbour Stays",
    propertyIds: ["p-1", "p-2"], ...overrides,
  };
}

beforeEach(() => {
  sessionStorage.clear();
  vi.resetAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  randomUUID.mockReturnValue("11111111-1111-4111-8111-111111111111");
  vi.stubGlobal("crypto", { randomUUID });
  fetchMock.mockImplementation(async (_url, options) => options?.method === "POST"
    ? response({ ok: true, requestId: "request-1", pendingApproval: true })
    : response(slots()));
  mocks.auth.mockResolvedValue(portal());
  mocks.scope.mockImplementation((ctx) => ctx.propertyIds === null
    ? { clientId: ctx.clientId }
    : { clientId: ctx.clientId, id: { in: ctx.propertyIds } });
  mocks.properties.mockResolvedValue(properties.map((p) => ({ ...p, client: { name: identity.actingFor } })));
});
afterEach(() => vi.unstubAllGlobals());

describe("booking availability and review", () => {
  it("shows current property, service, full date and authorized identity and posts only the API payload", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Garden house/ }));
    fireEvent.click(screen.getByRole("button", { name: /Deep Clean/ }));
    next();
    await screen.findByRole("button", { name: "11" });
    fireEvent.click(screen.getByRole("button", { name: "11" }));
    next();
    for (const text of [identity.actorName, identity.actingFor, "Garden house", "Deep Cleaning"]) {
      expect(screen.getByText(text)).toBeVisible();
    }
    expect(screen.getByText(/11 Sep 2099/)).toBeVisible();
    fireEvent.change(screen.getByLabelText("Special instructions"), { target: { value: "Use side entrance" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm booking" }));
    await screen.findByText("Request received");
    expect(JSON.parse(postCalls()[0][1]!.body as string)).toEqual({
      propertyId: "p-2", jobType: "DEEP_CLEAN", scheduledDate: "2099-09-11", notes: "Use side entrance",
    });
    expect(postCalls()[0][1]!.headers).toEqual({
      "Content-Type": "application/json", "Idempotency-Key": "11111111-1111-4111-8111-111111111111",
    });
  });

  it.each(["property", "service"])("blocks stale selection while new %s availability is pending", async (kind) => {
    mount();
    await review();
    back(); back();
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole("button", { name: kind === "property" ? /Garden house/ : /Deep Clean/ }));
    next();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "10" })).not.toBeInTheDocument();
    next();
    expect(screen.queryByText("Confirm your request")).not.toBeInTheDocument();
    await act(async () => pending.resolve(response(slots(["2099-09-12"]))));
    expect(screen.getByRole("button", { name: "12" })).toBeEnabled();
    next();
    expect(screen.getByText(/12 Sep 2099/)).toBeVisible();
  });

  it.each(["resolve", "reject"])("ignores an obsolete request that later %ss, even when fetch ignores abort", async (outcome) => {
    const old = deferred<Response>();
    fetchMock.mockReturnValueOnce(old.promise);
    mount();
    const signal = fetchMock.mock.calls[0][1]!.signal!;
    fireEvent.click(screen.getByRole("button", { name: /Garden house/ }));
    await review();
    expect(signal.aborted).toBe(true);
    await act(async () => {
      if (outcome === "resolve") old.resolve(response(slots(["2099-09-20"])));
      else old.reject(new Error("obsolete failure"));
    });
    expect(screen.getByText(/10 Sep 2099/)).toBeVisible();
    expect(screen.queryByText(/obsolete failure/)).not.toBeInTheDocument();
  });

  it("does not reuse the first request when changing A to B to A", async () => {
    const first = deferred<Response>();
    const last = deferred<Response>();
    fetchMock.mockReturnValueOnce(first.promise).mockResolvedValueOnce(response(slots())).mockReturnValueOnce(last.promise);
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Garden house/ }));
    fireEvent.click(screen.getByRole("button", { name: /Harbour apartment/ }));
    next();
    await act(async () => first.resolve(response(slots())));
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    await act(async () => last.resolve(response(slots(["2099-09-13"]))));
    next();
    expect(screen.getByText(/13 Sep 2099/)).toBeVisible();
  });

  it.each([
    ["HTTP error", () => Promise.resolve(response({ error: "Calendar unavailable" }, 503))],
    ["network error", () => Promise.reject(new TypeError("offline"))],
    ["malformed JSON", () => Promise.resolve({ ok: true, status: 200, json: async () => { throw new SyntaxError(); } } as Response)],
    ["missing array", () => Promise.resolve(response({}))],
    ["invalid date", () => Promise.resolve(response(slots(["2099-09-31"])))],
    ["outside window", () => Promise.resolve(response(slots(["2099-10-01"])))],
  ])("distinguishes %s from empty availability and supports retry", async (_label, fail) => {
    fetchMock.mockImplementationOnce(fail as typeof fetch);
    mount(); next();
    fireEvent.click(await screen.findByRole("button", { name: "Retry availability" }));
    expect(screen.queryByText("No open dates right now")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "10" })).toBeEnabled();
  });

  it("shows genuine empty availability, blocks review and retries", async () => {
    fetchMock.mockResolvedValueOnce(response(slots([])));
    mount(); next();
    await screen.findByText("No open dates right now");
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry availability" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
  });

  it.each([401, 403])("treats availability %s as access failure with a reload, not a transient retry", async (status) => {
    fetchMock.mockResolvedValueOnce(response({ error: "FORBIDDEN" }, status));
    mount(); next();
    await screen.findByText(/Your booking access could not be verified/);
    expect(screen.getByRole("link", { name: "Reload booking" })).toHaveAttribute("href", "/v2/client/booking");
    expect(screen.queryByRole("button", { name: "Retry availability" })).not.toBeInTheDocument();
    expect(screen.queryByText("No open dates right now")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("aborts availability on unmount", () => {
    fetchMock.mockReturnValueOnce(new Promise(() => {}));
    const view = mount();
    const signal = fetchMock.mock.calls[0][1]!.signal!;
    view.unmount();
    expect(signal.aborted).toBe(true);
  });
});

describe("booking submission reliability", () => {
  it("sends once for same-tick repeated clicks and freezes the reviewed draft while pending", async () => {
    mount(); await review();
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    const confirm = screen.getByRole("button", { name: "Confirm booking" });
    act(() => { confirm.click(); confirm.click(); confirm.click(); });
    expect(postCalls()).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    expect(screen.getByLabelText("Special instructions")).toBeDisabled();
    await act(async () => pending.resolve(response({ ok: true, requestId: "request-1" })));
    expect(screen.getByText("Request received")).toBeVisible();
    expect(postCalls()).toHaveLength(1);
  });

  it.each([
    ["network loss", () => Promise.reject(new TypeError("offline"))],
    ["malformed JSON", () => Promise.resolve({ ok: true, status: 200, json: async () => { throw new SyntaxError(); } } as Response)],
    ["invalid success", () => Promise.resolve(response({ ok: true }))],
    ["server failure", () => Promise.resolve(response({ error: "Notification failed" }, 500))],
    ["post-commit 400", () => Promise.resolve(response({ error: "Audit failed" }, 400))],
  ])("freezes an uncertain %s outcome until an explicit retry with the same payload and key", async (_label, fail) => {
    mount(); await review();
    expect(randomUUID).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Special instructions"), { target: { value: "Keep this draft" } });
    fetchMock.mockImplementationOnce(fail as typeof fetch);
    fireEvent.click(screen.getByRole("button", { name: "Confirm booking" }));
    const retry = await screen.findByRole("button", { name: "Retry request" });
    expect(retry).toBeEnabled();
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    expect(screen.getByLabelText("Special instructions")).toHaveValue("Keep this draft");
    expect(screen.getByLabelText("Special instructions")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Special instructions"), { target: { value: "Changed draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await act(async () => { await Promise.resolve(); });
    expect(postCalls()).toHaveLength(1);
    expect(screen.queryByText("Request received")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Book another service" })).not.toBeInTheDocument();
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    act(() => { retry.click(); retry.click(); retry.click(); });
    expect(postCalls()).toHaveLength(2);
    expect(postCalls()[1][1]).toEqual(postCalls()[0][1]);
    expect(JSON.parse(postCalls()[1][1]!.body as string).notes).toBe("Keep this draft");
    expect(randomUUID).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /Sending/ })).toBeDisabled();
    await act(async () => pending.resolve(response({ ok: true, requestId: "request-1" })));
    expect(screen.getByText("Request received")).toBeVisible();
  });

  it("retains the original request through repeated uncertainty, then blocks a definitive retry conflict", async () => {
    mount(); await review();
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm booking" }));
    const retry = await screen.findByRole("button", { name: "Retry request" });
    fetchMock.mockResolvedValueOnce(response({ error: "Unavailable" }, 503));
    fireEvent.click(retry);
    await screen.findByRole("button", { name: "Retry request" });
    expect(postCalls()).toHaveLength(2);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 409, json: async () => { throw new SyntaxError(); } } as Response);
    fireEvent.click(screen.getByRole("button", { name: "Retry request" }));
    await screen.findByText(/This request conflicts/);
    expect(postCalls()).toHaveLength(3);
    for (const [, options] of postCalls()) expect(options).toEqual(postCalls()[0][1]);
    expect(randomUUID).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Retry request" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm booking" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Reload booking" })).toBeVisible();
  });

  it.each([401, 403, 404, 409])("blocks resubmission after definitive status %s and offers context reload", async (status) => {
    mount(); await review();
    fetchMock.mockResolvedValueOnce(response({ error: "FORBIDDEN" }, status));
    fireEvent.click(screen.getByRole("button", { name: "Confirm booking" }));
    await screen.findByText(status === 409 ? /This request conflicts/ : /Your account or property access could not be verified/);
    expect(screen.getByRole("button", { name: "Confirm booking" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Reload booking" })).toBeVisible();
    expect(screen.queryByText("Request received")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry request" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm booking" }));
    expect(postCalls()).toHaveLength(1);
  });

  it("refreshes dates and clears notes before another intentional booking", async () => {
    randomUUID.mockReturnValueOnce("11111111-1111-4111-8111-111111111111")
      .mockReturnValueOnce("22222222-2222-4222-8222-222222222222");
    mount(); await review();
    fireEvent.change(screen.getByLabelText("Special instructions"), { target: { value: "First booking only" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm booking" }));
    const another = await screen.findByRole("button", { name: "Book another service" });
    fetchMock.mockResolvedValueOnce(response(slots(["2099-09-15"])));
    fireEvent.click(another);
    await review();
    expect(screen.getByLabelText("Special instructions")).toHaveValue("");
    expect(screen.getByText(/15 Sep 2099/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Confirm booking" }));
    await screen.findByText("Request received");
    expect(postCalls()).toHaveLength(2);
    expect(randomUUID).toHaveBeenCalledTimes(2);
    expect(new Headers(postCalls()[0][1]!.headers).get("Idempotency-Key")).toBe("11111111-1111-4111-8111-111111111111");
    expect(new Headers(postCalls()[1][1]!.headers).get("Idempotency-Key")).toBe("22222222-2222-4222-8222-222222222222");
  });

  it.each([undefined, {}, { randomUUID: () => { throw new Error("unavailable"); } }])(
    "honestly blocks without sending when secure UUID generation is unavailable (%j)", async (crypto) => {
      vi.stubGlobal("crypto", crypto);
      mount(); await review();
      fireEvent.click(screen.getByRole("button", { name: "Confirm booking" }));
      expect(await screen.findByText(/No request was sent. Secure request identification is unavailable/)).toBeVisible();
      expect(screen.getByRole("button", { name: "Confirm booking" })).toBeDisabled();
      expect(screen.getByRole("link", { name: "Reload booking" })).toBeVisible();
      expect(screen.queryByRole("button", { name: "Retry request" })).not.toBeInTheDocument();
      expect(postCalls()).toHaveLength(0);
    }
  );
});

describe("authorized booking page context", () => {
  it.each([null, [], ["p-1"]])("uses authorized property scope %j and exactly the original active filter", async (propertyIds) => {
    const ctx = portal({ propertyIds });
    mocks.auth.mockResolvedValue(ctx);
    render(await ClientBookingPage({}));
    expect(mocks.auth).toHaveBeenCalledWith({ module: "booking", permission: "bookings" });
    expect(mocks.scope).toHaveBeenCalledWith(ctx);
    expect(mocks.properties).toHaveBeenCalledWith({
      where: { clientId: "client-1", isActive: true, ...(propertyIds === null ? {} : { id: { in: propertyIds } }) },
      select: { id: true, name: true, suburb: true, bedrooms: true, bathrooms: true, client: { select: { name: true } } },
      orderBy: { name: "asc" },
    });
  });

  it("shows read failure instead of empty state and recovers on a new server render", async () => {
    mocks.properties.mockRejectedValueOnce(new Error("Database unavailable"));
    const view = render(await ClientBookingPage({}));
    expect(screen.getByText("Properties could not be loaded")).toBeVisible();
    expect(screen.queryByText("No properties on file")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Retry" })).toHaveAttribute("href", "/v2/client/booking");
    expect(fetchMock).not.toHaveBeenCalled();
    view.rerender(await ClientBookingPage({}));
    await review();
    expect(screen.getByText(identity.actingFor)).toBeVisible();
  });

  it("renders a genuine empty account without requesting availability", async () => {
    mocks.properties.mockResolvedValue([]);
    render(await ClientBookingPage({}));
    expect(screen.getByText("No properties on file")).toBeVisible();
    expect(screen.queryByText("Properties could not be loaded")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("propagates auth denial before any property reads", async () => {
    mocks.auth.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(ClientBookingPage({})).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.properties).not.toHaveBeenCalled();
  });

  it.each([
    ["user", { userId: "actor-2", userName: "New Assistant" }],
    ["actor role", { actor: "CLIENT" }],
    ["client", { clientId: "client-2" }],
    ["team", { team: { id: "team-2", name: "New Office" } }],
    ["restricted scope", { propertyIds: ["p-1"] }],
    ["unrestricted scope", { propertyIds: null }],
  ])("discards in-memory review and notes when authorized %s changes", async (_label, changes) => {
    const view = render(await ClientBookingPage({}));
    await review();
    fireEvent.change(screen.getByLabelText("Special instructions"), { target: { value: "Old draft" } });
    mocks.auth.mockResolvedValue(portal(changes));
    view.rerender(await ClientBookingPage({}));
    expect(screen.queryByText("Confirm your request")).not.toBeInTheDocument();
    await review();
    expect(screen.getByLabelText("Special instructions")).toHaveValue("");
  });

  it("resets when the available property set changes even with unrestricted scope", async () => {
    mocks.auth.mockResolvedValue(portal({ propertyIds: null }));
    const view = render(await ClientBookingPage({}));
    await review();
    mocks.properties.mockResolvedValue([{ ...properties[1], client: { name: identity.actingFor } }]);
    view.rerender(await ClientBookingPage({}));
    await review();
    expect(screen.getByText("Garden house")).toBeVisible();
    expect(screen.queryByText("Harbour apartment")).not.toBeInTheDocument();
  });

  it("preserves the draft for equivalent reordered scope and property results", async () => {
    const view = render(await ClientBookingPage({}));
    await review();
    fireEvent.change(screen.getByLabelText("Special instructions"), { target: { value: "Current draft" } });
    mocks.auth.mockResolvedValue(portal({ propertyIds: ["p-2", "p-1"] }));
    mocks.properties.mockResolvedValue([...properties].reverse().map((p) => ({ ...p, client: { name: identity.actingFor } })));
    view.rerender(await ClientBookingPage({}));
    expect(screen.getByLabelText("Special instructions")).toHaveValue("Current draft");
  });
});
