import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import AiConfigurationPage from "@/app/v2/admin/ai/page";
const mocks = vi.hoisted(() => ({ role: vi.fn(), config: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: mocks.role }));
vi.mock("@/lib/ai/config", () => ({ getAiConfiguration: mocks.config }));
beforeEach(() => { vi.resetAllMocks(); mocks.role.mockResolvedValue({}); });
describe("AI configuration page", () => {
  it.each([false, true])("does not claim connectivity from credential presence=%s", async configured => {
    mocks.config.mockReturnValue({ provider: "Anthropic", model: "configured-model", configured });
    render(await AiConfigurationPage());
    expect(mocks.role).toHaveBeenCalledWith([Role.ADMIN, Role.OPS_MANAGER]);
    expect(screen.getByText("Not tested")).toBeVisible();
    expect(screen.getByText(configured ? "Configured, not verified" : "Not configured")).toBeVisible();
    expect(screen.getByRole("link", { name: "Refresh status" })).toHaveAttribute("href", "/v2/admin/ai");
  });
  it("checks role before reading configuration", async () => {
    mocks.role.mockRejectedValue(new Error("FORBIDDEN"));
    await expect(AiConfigurationPage()).rejects.toThrow("FORBIDDEN");
    expect(mocks.config).not.toHaveBeenCalled();
  });
});
