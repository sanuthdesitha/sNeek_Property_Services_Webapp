import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AccountActionsMenu } from "@/components/v2/admin/accounts/account-actions-menu";

// The VA screens' account menu. Before 2026-11-11 it called reset-password,
// disable-2fa and DELETE without the PIN or password the routes verify, so
// every one of those actions failed with 423.
const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

async function confirmWithPin(menuItem: string, confirmLabel: string, phrase?: string) {
  render(<AccountActionsMenu account={{ id: "va1", name: "Vera", email: "vera@example.com" }} onChanged={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Manage vera@example.com" }));
  fireEvent.click(screen.getByRole("button", { name: menuItem }));
  const dialog = await screen.findByRole("dialog");
  if (phrase) fireEvent.change(within(dialog).getByLabelText(`Type ${phrase} to continue`), { target: { value: phrase } });
  fireEvent.change(within(dialog).getByLabelText("Your PIN"), { target: { value: "2468" } });
  fireEvent.click(within(dialog).getByRole("button", { name: confirmLabel }));
  // The prompt first reads the viewer's own PIN state (2026-11-13); the action is the next call.
  const isAction = ([url]: [string, RequestInit?]) => url !== "/api/me/admin-pin";
  await waitFor(() => expect(fetchMock.mock.calls.some(isAction)).toBe(true));
  return fetchMock.mock.calls.find(isAction) as [string, RequestInit];
}

describe("VA account actions send the PIN to the server", () => {
  it("reset password", async () => {
    const [url, init] = await confirmWithPin("Reset password", "Reset password");
    expect(url).toBe("/api/admin/users/va1/reset-password");
    expect(JSON.parse(String(init.body))).toEqual({ security: { pin: "2468" } });
  });

  it("reset 2FA", async () => {
    const [url, init] = await confirmWithPin("Reset 2FA", "Reset 2FA");
    expect(url).toBe("/api/admin/users/va1/disable-2fa");
    expect(JSON.parse(String(init.body)).security.pin).toBe("2468");
  });

  it("delete", async () => {
    const [url, init] = await confirmWithPin("Delete account", "Delete account", "DELETE");
    expect(url).toBe("/api/admin/users/va1");
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(String(init.body)).security.pin).toBe("2468");
  });
});
