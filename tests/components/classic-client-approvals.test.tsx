import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientApprovalsClient } from "@/components/client/approvals-client";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), toast: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ toast: mocks.toast }));
const row = (extra = {}) => ({
  id: "one/two", version: "a".repeat(64), title: "Extra cleaning", description: "Extra work",
  amount: 50, currency: "AUD", status: "PENDING", requestedAt: "2026-09-09T10:00:00Z",
  expiresAt: null, responseNote: null, property: null, job: null, ...extra,
});
const response = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", mocks.fetch); });
afterEach(() => vi.unstubAllGlobals());

describe("classic client approval versions", () => {
  it.each(["Approve", "Decline"])("sends the displayed version for %s and locks duplicate sends", async (action) => {
    const post = deferred<ReturnType<typeof response>>();
    mocks.fetch.mockResolvedValueOnce(response([row(), row({ id: "two", title: "Second" })]))
      .mockReturnValueOnce(post.promise).mockResolvedValueOnce(response([]));
    render(<ClientApprovalsClient />);
    await screen.findByText("Extra cleaning");
    fireEvent.change(screen.getAllByLabelText("Optional note")[0], { target: { value: " My note " } });
    const buttons = screen.getAllByRole("button", { name: action });
    act(() => { buttons[0].click(); buttons[0].click(); buttons[1].click(); });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch.mock.calls[1][0]).toBe("/api/client/approvals/one%2Ftwo/respond");
    expect(JSON.parse(mocks.fetch.mock.calls[1][1].body)).toEqual({
      decision: action.toUpperCase(), expectedVersion: "a".repeat(64), responseNote: "My note",
    });
    await act(async () => { post.resolve(response({})); });
    await screen.findByText("No approval requests found.");
  });

  it.each([undefined, null, "", "a".repeat(63), "A".repeat(64), 123])("disables invalid version %s", async (version) => {
    mocks.fetch.mockResolvedValueOnce(response([row({ version })]));
    render(<ClientApprovalsClient />);
    await screen.findByText(/Approval terms could not be verified/);
    for (const name of ["Approve", "Decline"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name }));
    }
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["Approve", "Decline"])("blocks stale %s until refresh succeeds and retains notes", async (action) => {
    const refresh = deferred<ReturnType<typeof response>>();
    mocks.fetch.mockResolvedValueOnce(response([row()]))
      .mockResolvedValueOnce(response({ code: "STALE_APPROVAL" }, 409))
      .mockRejectedValueOnce(new Error("offline"))
      .mockReturnValueOnce(refresh.promise)
      .mockResolvedValueOnce(response({})).mockResolvedValueOnce(response([]));
    render(<ClientApprovalsClient />);
    await screen.findByText("Extra cleaning");
    fireEvent.change(screen.getByLabelText("Optional note"), { target: { value: "Keep this note" } });
    fireEvent.click(screen.getByRole("button", { name: action }));
    await screen.findByText(/Approval terms have changed/);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: action })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: action }));
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByText(/Approvals unavailable/);
    expect(screen.getByRole("button", { name: action })).toBeDisabled();
    expect(screen.getByLabelText("Optional note")).toHaveValue("Keep this note");
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await act(async () => { refresh.resolve(response([row({ version: "b".repeat(64), amount: 70 })])); });
    expect(screen.queryByText(/Approval terms have changed/)).not.toBeInTheDocument();
    expect(screen.getByText("AUD 70.00")).toBeVisible();
    expect(screen.getByLabelText("Optional note")).toHaveValue("Keep this note");
    expect(mocks.fetch).toHaveBeenCalledTimes(4);
    fireEvent.click(screen.getByRole("button", { name: action }));
    await screen.findByText("No approval requests found.");
    expect(JSON.parse(mocks.fetch.mock.calls[4][1].body).expectedVersion).toBe("b".repeat(64));
  });

  it.each(["network", "HTTP", "JSON"])("shows honest %s load errors", async (failure) => {
    mocks.fetch.mockImplementationOnce(async () => {
      if (failure === "network") throw new Error("offline");
      if (failure === "HTTP") return response([], 503);
      return { ok: true, json: async () => { throw new Error("invalid JSON"); } };
    });
    render(<ClientApprovalsClient />);
    await screen.findByText(/Approvals unavailable/);
    expect(screen.queryByText("No approval requests found.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
  });

  it.each(["network", "HTTP"])("handles %s send failure without success or automatic retry", async (failure) => {
    mocks.fetch.mockResolvedValueOnce(response([row()])).mockImplementationOnce(async () => {
      if (failure === "network") throw new Error("Connection lost");
      return response({ error: "Response rejected" }, 500);
    });
    render(<ClientApprovalsClient />);
    await screen.findByText("Extra cleaning");
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await screen.findByText(failure === "network" ? "Connection lost" : "Response rejected");
    await waitFor(() => expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled());
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
});
