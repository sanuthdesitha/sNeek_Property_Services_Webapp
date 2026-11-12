import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ role: vi.fn(), ops: vi.fn(), settings: vi.fn(), emailSettings: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/rbac/ops-access", () => ({ getOpsAccess: m.ops }));
vi.mock("@/lib/settings", () => ({ getAppSettings: m.settings }));
vi.mock("@/components/v2/admin/insights/insights-page", () => ({ InsightsPage: () => null }));
vi.mock("@/lib/insights/monthly-email", () => ({ readInsightsEmailSettings: m.emailSettings }));

import Page from "@/app/v2/admin/reports/page";
import { allOpsLevels, canUseOpsPath, opsRequestFeature } from "@/lib/rbac/ops-catalog";

type Element = { props: { context: { access: { finance: boolean }; canManageReports: boolean; timeZone: string } } };

beforeEach(() => {
  vi.clearAllMocks();
  m.settings.mockResolvedValue({ timezone: "Australia/Sydney" });
  m.role.mockResolvedValue({ user: { id: "a", role: "ADMIN" } });
  m.ops.mockResolvedValue(null);
  m.emailSettings.mockResolvedValue({ enabled: false, recipientIds: [], dayOfMonth: 1, hour: 8, sections: [] });
});

describe("Insights page access", () => {
  it("keeps the reports page guard (ADMIN, OPS_MANAGER) and gives an admin everything", async () => {
    const element = (await Page()) as unknown as Element;
    expect(m.role).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER"]);
    // The header's "Email monthly" shows the setting's state; an administrator may open it.
    expect(element.props.context).toEqual({ access: { finance: true }, canManageReports: true, timeZone: "Australia/Sydney", monthlyEmail: { enabled: false, canConfigure: true } });
  });

  it("follows the operations pack: finance for money, reports manage for report writes", async () => {
    m.role.mockResolvedValue({ user: { id: "o", role: "OPS_MANAGER" } });
    m.ops.mockResolvedValue({ ...allOpsLevels("off"), reports: "read" });
    expect(((await Page()) as unknown as Element).props.context).toMatchObject({ access: { finance: false }, canManageReports: false });
    m.ops.mockResolvedValue({ ...allOpsLevels("off"), reports: "manage", finance: "read" });
    expect(((await Page()) as unknown as Element).props.context).toMatchObject({ access: { finance: true }, canManageReports: true });
  });

  it("maps the Insights API to the reports feature for operations managers", () => {
    expect(opsRequestFeature("/api/admin/insights/business")).toBe("reports");
    expect(opsRequestFeature("/api/admin/reports/bulk")).toBe("reports");
    expect(canUseOpsPath({ ...allOpsLevels("off"), reports: "read" }, "/api/admin/insights/clients")).toBe(true);
    expect(canUseOpsPath({ ...allOpsLevels("off"), reports: "read" }, "/api/admin/reports/bulk", "POST")).toBe(false);
    expect(canUseOpsPath({ ...allOpsLevels("manage"), reports: "off" }, "/api/admin/insights/clients")).toBe(false);
  });
});
