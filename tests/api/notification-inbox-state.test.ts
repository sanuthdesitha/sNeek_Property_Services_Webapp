// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { PATCH } from "@/app/api/notifications/inbox-state/route";
import { InboxStateError } from "@/lib/notifications/inbox-state-store";
const m = vi.hoisted(() => ({ session: vi.fn(), change: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireSession: m.session }));
vi.mock("@/lib/notifications/inbox-state-store", () => ({ changeInboxState: m.change, InboxStateError: class extends Error { constructor(public status: number, message: string) { super(message); } } }));
beforeEach(() => { vi.resetAllMocks(); m.session.mockResolvedValue({ user: { id: "recipient", role: "CLIENT" } }); m.change.mockResolvedValue({ revision: 1 }); });
const request = () => PATCH(new Request("http://localhost/api/notifications/inbox-state", { method: "PATCH", body: JSON.stringify({ id: "note", revision: 0, action: "ARCHIVE" }) }));
it("returns a conflict without reporting success", async () => {
  m.change.mockRejectedValue(new InboxStateError(409, "Refresh notifications.")); const result = await request();
  expect(result.status).toBe(409); expect(await result.json()).toEqual({ error: "Refresh notifications." });
});
it("passes malformed JSON as invalid input for validation", async () => {
  m.change.mockRejectedValue(new InboxStateError(400, "Invalid follow-up action."));
  const result = await PATCH(new Request("http://localhost/api/notifications/inbox-state", { method: "PATCH", body: "{" }));
  expect(result.status).toBe(400); expect(m.change).toHaveBeenCalledWith("recipient", "CLIENT", null);
});
it("takes identity from session, not request, and returns private state", async () => {
  const result = await request(); expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toBe("private, no-store");
  expect(m.change).toHaveBeenCalledWith("recipient", "CLIENT", { id: "note", revision: 0, action: "ARCHIVE" });
});
it.each(["READ_ONLY", "INTERACTIVE"])("denies %s impersonation without writes", async mode => {
  m.session.mockResolvedValue({ user: { id: "recipient", role: "ADMIN" }, impersonation: { mode } });
  expect((await request()).status).toBe(403); expect(m.change).not.toHaveBeenCalled();
});
it.each(["UNAUTHORIZED", "FORBIDDEN", "secret database info"])("masks errors and preserves auth denials %s", async message => {
  m.session.mockRejectedValue(new Error(message)); const result = await request();
  expect(result.status).toBe(message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 503);
  expect(JSON.stringify(await result.json())).not.toContain(message); expect(m.change).not.toHaveBeenCalled();
});
