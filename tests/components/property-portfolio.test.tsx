import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PropertyPortfolio } from "@/components/v2/client/property-portfolio";
const fetchMock = vi.fn();
const state = { version: 1, revision: 0, ids: [], view: "cards" };
const data = { state, context: "a".repeat(64), readOnly: false };
const response = (body: unknown, status = 200) => ({ ok: status === 200, status, json: async () => body });
const rows = [{ id: "p1", name: "Alpha", suburb: "Sydney", bedrooms: 2, bathrooms: 1, hasBalcony: false, next: null, last: null, approvals: 0 }, { id: "p2", name: "Beta", suburb: "Sydney", bedrooms: 1, bathrooms: 1, hasBalcony: false, next: null, last: "unavailable", approvals: "unavailable" }] as any;
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset().mockResolvedValue(response(data)); });
afterEach(() => vi.unstubAllGlobals());
async function open() { render(<PropertyPortfolio rows={rows} expectedContext={data.context} scope="client" />); await waitFor(() => expect(screen.getByRole("button", { name: "Pin Beta" })).toBeEnabled()); }
it("reorders only after a valid saved pin acknowledgement", async () => {
  fetchMock.mockResolvedValueOnce(response(data)).mockResolvedValueOnce(response({ ...data, state: { ...state, revision: 1, ids: ["p2"] } }));
  await open(); fireEvent.click(screen.getByRole("button", { name: "Pin Beta" }));
  await screen.findByRole("button", { name: "Unpin Beta" }); expect(screen.getAllByRole("article")[0]).toHaveTextContent("Beta");
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ action: "pin", propertyId: "p2", revision: 0 });
  expect(screen.getByText("History unavailable")).toBeVisible(); expect(screen.getByText("Approval requests unavailable")).toBeVisible();
});
it.each(["network", "bad ack", "wrong revision", "wrong context"])("blocks further changes after %s until reload", async mode => {
  fetchMock.mockResolvedValueOnce(response(data));
  if (mode === "network") fetchMock.mockRejectedValueOnce(new Error("offline"));
  else fetchMock.mockResolvedValueOnce(response(mode === "bad ack" ? {} : { ...data, context: mode === "wrong context" ? "b".repeat(64) : data.context, state: { ...state, revision: mode === "wrong revision" ? 0 : 1 } }));
  await open(); fireEvent.click(screen.getByRole("button", { name: "Pin Beta" }));
  await screen.findByText(/save could not be confirmed/); expect(screen.getByRole("button", { name: "Compact" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Reload preferences" })); await waitFor(() => expect(screen.getByRole("button", { name: "Compact" })).toBeEnabled());
  expect(fetchMock.mock.calls.filter(call => call[1]?.method === "PATCH")).toHaveLength(1);
});
it("requires reload after concurrent revision conflict", async () => {
  fetchMock.mockResolvedValueOnce(response(data)).mockResolvedValueOnce(response({ error: "Changed elsewhere" }, 409));
  await open(); fireEvent.click(screen.getByRole("button", { name: "Pin Beta" })); await screen.findByText("Changed elsewhere");
  expect(screen.getByRole("button", { name: "Pin Beta" })).toBeDisabled(); expect(screen.getByRole("heading", { name: "Beta" })).toBeVisible();
});
it("keeps property summaries accessible when saved preferences cannot load", async () => {
  fetchMock.mockRejectedValue(new Error("offline")); render(<PropertyPortfolio rows={rows} expectedContext={data.context} scope="client" />);
  await screen.findByRole("alert"); expect(screen.getByRole("heading", { name: "Alpha" })).toBeVisible(); expect(screen.getByRole("button", { name: "Compact" })).toBeDisabled();
});
it("disables all changes while impersonating", async () => {
  fetchMock.mockResolvedValue(response({ ...data, readOnly: true })); render(<PropertyPortfolio rows={rows} expectedContext={data.context} scope="client" />);
  await screen.findByText(/read-only while impersonating/); expect(screen.getByRole("button", { name: "Pin Alpha" })).toBeDisabled();
});
it("ignores a prior account's slow preference response", async () => {
  let resolve!: (value: unknown) => void; fetchMock.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const view = render(<PropertyPortfolio rows={rows} expectedContext={data.context} scope="first" />); view.rerender(<PropertyPortfolio rows={rows} expectedContext={data.context} scope="second" />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Compact" })).toBeEnabled());
  await act(async () => resolve(response({ ...data, state: { ...state, ids: ["p2"] } })));
  expect(screen.getAllByRole("article")[0]).toHaveTextContent("Alpha");
});
it("requires full page reload when preference reload belongs to a new account", async () => {
  fetchMock.mockResolvedValueOnce(response(data)).mockResolvedValueOnce(response({}, 403)).mockResolvedValueOnce(response({ ...data, context: "b".repeat(64) }));
  await open(); fireEvent.click(screen.getByRole("button", { name: "Pin Beta" }));
  fireEvent.click(await screen.findByRole("button", { name: "Reload preferences" }));
  await screen.findByRole("link", { name: "Reload this page" });
  expect(screen.getByRole("button", { name: "Pin Beta" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Reload preferences" })).toBeNull();
});
it("offers explicit clear even when persisted pins are all hidden", async () => {
  await open(); expect(screen.getByRole("button", { name: "Clear favorites" })).toBeEnabled();
});
it("shows planned timing, truthful progress freshness and only shared report links", async () => {
  const populated = [{ ...rows[0], hasBalcony: true, next: { id: "next", day: "2026-10-04", startTime: "09:00", phase: "Cleaner on the way", updatedAt: "2026-10-03T23:00:00Z" }, last: { id: "last", day: "2026-09-01", reportId: "shared" }, approvals: 2 },
    { ...rows[1], next: { id: "later", day: "2026-10-05", startTime: null, phase: null, updatedAt: "2026-10-04T23:00:00Z" }, last: { id: "private", day: "2026-09-02", reportId: null }, approvals: 1 }];
  render(<PropertyPortfolio rows={populated} expectedContext={data.context} scope="client" />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Pin Beta" })).toBeEnabled());
  expect(screen.getByRole("link", { name: /planned 09:00/ })).toHaveAttribute("href", "/v2/client/jobs/next");
  expect(screen.getByText("Cleaner on the way")).toBeVisible(); expect(screen.getByText(/^Updated .*Sydney$/)).toBeVisible();
  expect(screen.getAllByRole("link", { name: "View shared reports" })).toHaveLength(1);
  expect(screen.getByRole("link", { name: "2 pending requests" })).toBeVisible(); expect(screen.getByRole("link", { name: "1 pending request" })).toBeVisible();
  expect(screen.getByText("Live service status is not shared for this account.")).toBeVisible();
});
it("renders hidden jobs and decisions without service identifiers or links", async () => {
  render(<PropertyPortfolio rows={[{ ...rows[0], next: "hidden", last: "hidden", approvals: "hidden" }]} expectedContext={data.context} scope="client" />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Pin Alpha" })).toBeEnabled());
  expect(screen.getByText("Service details are not shared for this account.")).toBeVisible();
  expect(document.querySelector('a[href^="/v2/client/jobs/"]')).toBeNull(); expect(screen.queryByText("Approval inbox")).toBeNull();
});
it("does not fetch mutable preferences without a page-bound account context", () => {
  render(<PropertyPortfolio rows={rows} expectedContext={null} scope="client" />);
  expect(fetchMock).not.toHaveBeenCalled(); expect(screen.getByRole("link", { name: "Reload this page" })).toBeVisible();
});
it("saves compact view and requires explicit clear confirmation", async () => {
  fetchMock.mockResolvedValueOnce(response(data)).mockResolvedValueOnce(response({ ...data, state: { ...state, revision: 1, view: "compact", ids: ["p2"] } }));
  await open(); fireEvent.click(screen.getByRole("button", { name: "Compact" })); await screen.findByRole("button", { name: "Clear favorites" });
  expect(screen.getByRole("button", { name: "Compact" })).toHaveAttribute("aria-pressed", "true");
  vi.spyOn(window, "confirm").mockReturnValue(false); fireEvent.click(screen.getByRole("button", { name: "Clear favorites" })); expect(fetchMock).toHaveBeenCalledTimes(2);
});
