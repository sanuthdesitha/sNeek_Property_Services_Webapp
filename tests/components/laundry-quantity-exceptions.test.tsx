import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { QuantityExceptions } from "@/components/v2/laundry/quantity-exceptions";
const m = vi.hoisted(() => ({ user: "first", impersonation: undefined as any }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ status: "authenticated", data: { user: { id: m.user, role: "ADMIN" }, impersonation: m.impersonation } }) }));
const row = { id: "exception", propertyName: "Visible house", expectedCount: 3, actualCount: 1, reason: "Missing bags", photoUrl: "https://example.invalid/photo.jpg", createdAt: "2026-09-13T00:00:00Z", resolvedAt: null, resolutionNote: null, version: 0, laundryTaskId: null };
const response = (body: unknown) => ({ ok: true, json: async () => body });
const feed = { rows: [row], total: 1, nextCursor: null, canResolve: true };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); m.user = "first"; m.impersonation = undefined; });
it("rejects malformed queue data instead of presenting false totals", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ ...feed, rows: [{ ...row, actualCount: 1.5 }] })));
  render(<QuantityExceptions />); expect(await screen.findByRole("alert")).toHaveTextContent("unavailable"); expect(screen.queryByText("Visible house")).not.toBeInTheDocument();
});
it("clears old account rows and ignores an outstanding old request after identity change", async () => {
  let old!: (value: unknown) => void; const pending = new Promise(resolve => old = resolve);
  vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(pending).mockResolvedValue(response({ rows: [], total: 0, nextCursor: null, canResolve: false })));
  const view = render(<QuantityExceptions />); m.user = "second"; view.rerender(<QuantityExceptions />);
  await screen.findByText("0 open exceptions · 0 shown"); await act(async () => old(response(feed)));
  expect(screen.queryByText("Visible house")).not.toBeInTheDocument();
});
it("blocks repeated resolution after an unknown response until explicit refresh", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(response(feed)).mockRejectedValueOnce(new Error("lost ACK")); vi.stubGlobal("fetch", fetch);
  render(<QuantityExceptions />); await screen.findByText("Visible house"); fireEvent.change(screen.getByRole("textbox", { name: "Resolution note" }), { target: { value: "Reviewed with cleaner" } }); fireEvent.click(screen.getByRole("button", { name: "Resolve exception" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("not confirmed")); expect(screen.getByRole("button", { name: "Resolve exception" })).toBeDisabled(); expect(fetch).toHaveBeenCalledTimes(2);
});
it("shows scoped records read-only while impersonating", async () => {
  m.impersonation = { actorId: "admin", mode: "READ_ONLY" }; vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(feed))); render(<QuantityExceptions />);
  await screen.findByText("Visible house"); expect(screen.queryByRole("button", { name: "Resolve exception" })).not.toBeInTheDocument();
});
