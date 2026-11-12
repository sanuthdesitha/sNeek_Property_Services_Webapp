// @vitest-environment node
/** Wave F routes: live session guards, same-origin writes, server identity passed to the services. */
import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ session: vi.fn(), role: vi.fn(), add: vi.fn(), runs: vi.fn(), ask: vi.fn(), notice: vi.fn(), record: vi.fn(), answer: vi.fn(), charge: vi.fn(), times: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireSession: m.session, requireRole: m.role }));
vi.mock("@/lib/inventory/urgent-stock-shopping", () => ({ addUrgentNeedsToShoppingRun: m.add, listOpenShoppingRuns: m.runs }));
vi.mock("@/lib/inventory/urgent-stock-ask", () => ({ createPurchaseAsk: m.ask, recordAskOutcomes: m.record, askCandidates: vi.fn(), answerPurchaseAsk: m.answer, withdrawPurchaseAsk: vi.fn() }));
vi.mock("@/lib/inventory/urgent-stock-ask-notify", () => ({ sendPurchaseAskNotice: m.notice }));
vi.mock("@/lib/billing/client-invoice-case-charge", () => ({ addCaseChargeToInvoice: m.charge, caseChargeContext: vi.fn() }));
vi.mock("@/lib/laundry/planned-times", () => ({ setLaundryPlannedTimes: m.times }));

import { POST as addToRun } from "@/app/api/inventory/urgent-stock/shopping-run/route";
import { POST as ask } from "@/app/api/inventory/urgent-stock/asks/route";
import { POST as answer } from "@/app/api/cleaner/urgent-stock/asks/[id]/route";
import { POST as charge } from "@/app/api/admin/cases/[id]/invoice-charge/route";
import { PATCH as times } from "@/app/api/admin/laundry/[taskId]/times/route";

const same = { origin: "https://app.invalid", host: "app.invalid", "x-forwarded-proto": "https" };
const post = (path: string, body: unknown, headers: Record<string, string> = same, method = "POST") => new NextRequest(`https://app.invalid${path}`, { method, headers, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  m.session.mockResolvedValue({ user: { id: "ops", role: "OPS_MANAGER" } });
  m.role.mockResolvedValue({ user: { id: "admin", role: "ADMIN" }, impersonation: null });
});

it("refuses cross-origin writes before any service runs", async () => {
  const cross = { origin: "https://evil.invalid", host: "app.invalid", "x-forwarded-proto": "https" };
  expect((await addToRun(post("/api/inventory/urgent-stock/shopping-run", {}, cross))).status).toBe(403);
  expect((await ask(post("/api/inventory/urgent-stock/asks", {}, cross))).status).toBe(403);
  expect((await answer(post("/api/cleaner/urgent-stock/asks/a", {}, cross), { params: { id: "a" } })).status).toBe(403);
  expect((await charge(post("/api/admin/cases/c/invoice-charge", {}, cross), { params: { id: "c" } })).status).toBe(403);
  expect((await times(post("/api/admin/laundry/t/times", {}, cross, "PATCH"), { params: { taskId: "t" } })).status).toBe(403);
  for (const fn of [m.add, m.ask, m.answer, m.charge, m.times]) expect(fn).not.toHaveBeenCalled();
});

it("passes the live session identity to the services and maps their refusals", async () => {
  m.add.mockRejectedValueOnce(new Error("FORBIDDEN"));
  expect((await addToRun(post("/api/inventory/urgent-stock/shopping-run", { needIds: [] }))).status).toBe(403);
  expect(m.add).toHaveBeenCalledWith({ id: "ops", role: "OPS_MANAGER" }, { needIds: [] });
  m.ask.mockResolvedValueOnce({ id: "ask" });
  m.notice.mockResolvedValueOnce([{ transport: "INBOX", state: "inbox_available" }]);
  const asked = await ask(post("/api/inventory/urgent-stock/asks", { needId: "n" }));
  expect(asked.status).toBe(200);
  expect(m.notice).toHaveBeenCalledWith("ops", { id: "ask" });
  expect(m.record).toHaveBeenCalledWith("ask", [{ transport: "INBOX", state: "inbox_available" }]);
  m.charge.mockRejectedValueOnce(new Error("CONFLICT: A case charge can only be added to a draft invoice."));
  const refused = await charge(post("/api/admin/cases/c/invoice-charge", {}), { params: { id: "c" } });
  expect([refused.status, (await refused.json()).error]).toEqual([409, "A case charge can only be added to a draft invoice."]);
  expect(m.role).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER"]);
});

it("lets only a cleaner answer an ask", async () => {
  m.role.mockRejectedValueOnce(new Error("FORBIDDEN"));
  expect((await answer(post("/api/cleaner/urgent-stock/asks/a", { decision: "accept", note: null }), { params: { id: "a" } })).status).toBe(403);
  expect(m.role).toHaveBeenCalledWith(["CLEANER"]);
  expect(m.answer).not.toHaveBeenCalled();
});
