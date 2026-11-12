// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ role: vi.fn(), redirect: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
import CaseRedirect from "@/app/v2/admin/cases/[id]/page";
import StatsRedirect from "@/app/v2/admin/laundry/stats/page";

beforeEach(() => {
  vi.resetAllMocks();
  m.role.mockResolvedValue({ user: { id: "a", role: "ADMIN" } });
});

it("a case's own address (used by damage notifications) opens it in the inbox", async () => {
  await CaseRedirect({ params: { id: "case_123" } });
  expect(m.redirect).toHaveBeenCalledWith("/v2/admin/cases?open=case_123");
  await CaseRedirect({ params: { id: "../x" } });
  expect(m.redirect).toHaveBeenLastCalledWith("/v2/admin/cases");
});

it("the old statistics page redirects to the Statistics tab, keeping parameters, after the role check", async () => {
  await StatsRedirect({ searchParams: { period: "month" } });
  expect(m.role).toHaveBeenCalled();
  expect(m.redirect).toHaveBeenCalledWith("/v2/admin/laundry?period=month&tab=statistics");
});

it("refuses other roles before redirecting", async () => {
  m.role.mockRejectedValue(new Error("FORBIDDEN"));
  await expect(StatsRedirect({})).rejects.toThrow("FORBIDDEN");
  expect(m.redirect).not.toHaveBeenCalled();
});
