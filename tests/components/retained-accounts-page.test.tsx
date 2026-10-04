import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import AccountsPage from "@/app/accounts/page";
let posts: any[];
beforeEach(() => {
 posts = [];
 vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
  if (options?.method === "POST") { const body = JSON.parse(options.body); posts.push(body); return new Response(JSON.stringify({ ok: true, required: false })); }
  return new Response(JSON.stringify({ accounts: [], canEnroll: true, currentEmail: "admin@example.invalid" }));
 }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("requires both verification steps and final owner consent, clearing credentials between identities", async () => {
 render(<AccountsPage />);
 await waitFor(() => expect(screen.getByLabelText("Email")).toHaveValue("admin@example.invalid"));
 fireEvent.change(screen.getByLabelText("Password"), { target: { value: "admin-fixture-password" } });
 fireEvent.click(screen.getByRole("button", { name: "Verify account" }));
 await screen.findByText("Verify your other account");
 expect(screen.getByLabelText("Password")).toHaveValue("");
 fireEvent.change(screen.getByLabelText("Email"), { target: { value: "cleaner@example.invalid" } });
 fireEvent.change(screen.getByLabelText("Password"), { target: { value: "cleaner-fixture-password" } });
 fireEvent.click(screen.getByRole("button", { name: "Verify account" }));
 await screen.findByText("Confirm account linking");
 expect(screen.getByRole("button", { name: "Link my accounts" })).toBeDisabled();
 expect(posts.filter(body => body.action === "prepare").map(body => body.slot)).toEqual(["owner", "other"]);
 expect(posts.some(body => body.action === "link")).toBe(false);
 fireEvent.click(screen.getByRole("checkbox"));
 fireEvent.click(screen.getByRole("button", { name: "Link my accounts" }));
 await waitFor(() => expect(posts).toContainEqual({ action: "link", consent: true }));
});
it("does not expose a switch for an expired retained account", async () => {
 (fetch as any).mockResolvedValue(new Response(JSON.stringify({ accounts: [{ contextId: "a".repeat(32), name: "Cleaner", role: "CLEANER", available: false }], canEnroll: false })));
 render(<AccountsPage />);
 await screen.findByText(/Expired or removed/);
 expect(screen.queryByRole("link", { name: "Open Cleaner" })).toBeNull();
});

it("shows loading before deciding whether sign-in is needed, and offers retry after a failed read", async () => {
 let finish!: (response: Response) => void;
 (fetch as any).mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
 render(<AccountsPage />);
 expect(screen.getByRole("status")).toHaveTextContent("Loading your accounts");
 expect(screen.queryByRole("link", { name: /Sign in to link/ })).toBeNull();
 finish(new Response(JSON.stringify({ error: "Accounts temporarily unavailable" }), { status: 503 }));
 expect(await screen.findByRole("alert")).toHaveTextContent("Accounts temporarily unavailable");
 fireEvent.click(screen.getByRole("button", { name: "Retry loading accounts" }));
 expect(await screen.findByLabelText("Email")).toHaveValue("admin@example.invalid");
 expect(screen.queryByRole("alert")).toBeNull();
});
