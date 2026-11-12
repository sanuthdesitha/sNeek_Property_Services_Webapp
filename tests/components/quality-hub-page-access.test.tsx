import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ role: vi.fn(), ops: vi.fn(), settings: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/rbac/ops-access", () => ({ getOpsAccess: m.ops }));
vi.mock("@/lib/settings", () => ({ getAppSettings: m.settings }));
vi.mock("@/components/v2/admin/quality/hub/quality-hub", () => ({ QualityHub: () => null }));

import Page from "@/app/v2/admin/quality/page";
import { allOpsLevels } from "@/lib/rbac/ops-catalog";

type HubElement = { props: { context: { canManage: boolean; inspectorView: boolean; falseConfirmationDeduction: number | null } } };

beforeEach(() => {
  vi.clearAllMocks();
  m.settings.mockResolvedValue({ timezone: "Australia/Sydney", accountability: { scoring: { falseConfirmationExtraDeduction: 10 } } });
  m.ops.mockResolvedValue(null);
});

describe("Quality hub page access", () => {
  it("admits ADMIN, OPS_MANAGER and QA_INSPECTOR through the live guard", async () => {
    m.role.mockResolvedValue({ user: { id: "a", role: "ADMIN" } });
    const element = (await Page()) as unknown as HubElement;
    expect(m.role).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER", "QA_INSPECTOR"]);
    expect(element.props.context).toMatchObject({ canManage: true, inspectorView: false, falseConfirmationDeduction: 10 });
  });

  it("gives a QA inspector the read-only Issues view", async () => {
    m.role.mockResolvedValue({ user: { id: "q", role: "QA_INSPECTOR" } });
    const element = (await Page()) as unknown as HubElement;
    expect(element.props.context).toMatchObject({ canManage: false, inspectorView: true });
    expect(m.ops).not.toHaveBeenCalled();
  });

  it("hides actions from an operations manager whose quality pack is read-only", async () => {
    m.role.mockResolvedValue({ user: { id: "o", role: "OPS_MANAGER" } });
    m.ops.mockResolvedValue({ ...allOpsLevels("manage"), quality: "read" });
    expect(((await Page()) as unknown as HubElement).props.context.canManage).toBe(false);
    m.ops.mockResolvedValue({ ...allOpsLevels("manage") });
    expect(((await Page()) as unknown as HubElement).props.context.canManage).toBe(true);
  });

  it("never invents the false-confirmation deduction when settings cannot be read", async () => {
    m.role.mockResolvedValue({ user: { id: "a", role: "ADMIN" } });
    m.settings.mockRejectedValue(new Error("down"));
    expect(((await Page()) as unknown as HubElement).props.context.falseConfirmationDeduction).toBeNull();
  });
});
