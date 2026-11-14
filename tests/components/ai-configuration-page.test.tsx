import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const mocks = vi.hoisted(() => ({ role: vi.fn(), agreement: vi.fn(), workspace: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: mocks.role }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Perth" }) }));
vi.mock("@/lib/ai/property-photo-model", () => ({ getRecognitionConfiguration: () => ({ configured: false }) }));
vi.mock("@/lib/ai/photo-review-evaluation", () => ({ getPhotoReviewAgreement: mocks.agreement }));
vi.mock("@/components/v2/admin/ai/ai-configuration-workspace", () => ({ AiConfigurationWorkspace: () => null }));

import Page from "@/app/v2/admin/ai/page";

/** The page returns the workspace element; record the props it is given. */
async function AiConfigurationPage(...args: Parameters<typeof Page>) {
  const element = await Page(...args);
  mocks.workspace(element.props);
  return element;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.agreement.mockResolvedValue({ since: "2026-08-16T00:00:00.000Z", rows: [], skipped: 0 });
});

describe("AI configuration page (server)", () => {
  it("lets administrators edit and opens the Ollama section for the old Ollama tab link", async () => {
    mocks.role.mockResolvedValue({ user: { role: Role.ADMIN } });
    await AiConfigurationPage({ searchParams: { section: "ollama" } });
    expect(mocks.role).toHaveBeenCalledWith([Role.ADMIN, Role.OPS_MANAGER]);
    expect(mocks.workspace).toHaveBeenCalledWith(expect.objectContaining({ canEdit: true, readOnlyReason: null, timezone: "Australia/Perth", initialSection: "ollama" }));
  });

  it("is read-only for operations managers and for an administrator testing as someone", async () => {
    mocks.role.mockResolvedValue({ user: { role: Role.OPS_MANAGER } });
    await AiConfigurationPage({});
    expect(mocks.workspace).toHaveBeenLastCalledWith(expect.objectContaining({ canEdit: false, readOnlyReason: expect.stringContaining("Administrators change") }));
    mocks.role.mockResolvedValue({ user: { role: Role.ADMIN }, impersonation: { actorId: "a" } });
    await AiConfigurationPage({});
    expect(mocks.workspace).toHaveBeenLastCalledWith(expect.objectContaining({ canEdit: false, readOnlyReason: "Changes are off while testing as someone." }));
  });

  it("checks the role before reading anything and passes an unreadable agreement report as null", async () => {
    mocks.role.mockRejectedValue(new Error("FORBIDDEN"));
    await expect(AiConfigurationPage({})).rejects.toThrow("FORBIDDEN");
    expect(mocks.agreement).not.toHaveBeenCalled();
    mocks.role.mockResolvedValue({ user: { role: Role.ADMIN } });
    mocks.agreement.mockRejectedValue(new Error("db"));
    await AiConfigurationPage({});
    expect(mocks.workspace).toHaveBeenLastCalledWith(expect.objectContaining({ agreement: null }));
  });
});
