import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import AiConfigurationPage from "@/app/v2/admin/ai/page";
import { DEFAULT_VISION_SETTINGS } from "@/lib/ai/vision-settings-schema";
const mocks = vi.hoisted(() => ({ role: vi.fn(), config: vi.fn() }));
vi.mock("@/components/v2/admin/property-photo-memory", () => ({ PropertyPhotoMemoryPanel: () => null }));
vi.mock("@/lib/auth/session", () => ({ requireRole: mocks.role }));
vi.mock("@/lib/ai/config", () => ({ getAiConfiguration: mocks.config, getVisionProviderConfiguration: mocks.config }));
vi.mock("@/lib/ai/property-photo-model", () => ({ getRecognitionConfiguration: () => ({ configured: false }) }));
vi.mock("@/lib/ai/vision-settings", () => ({ getVisionSettings: async () => DEFAULT_VISION_SETTINGS }));
beforeEach(() => { vi.resetAllMocks(); mocks.role.mockResolvedValue({ user: { role: Role.ADMIN } }); });
describe("AI configuration page", () => {
  it.each([false, true])("does not claim connectivity from credential presence=%s", async configured => {
    mocks.config.mockReturnValue({ provider: "Anthropic", model: "configured-model", configured });
    render(await AiConfigurationPage());
    expect(mocks.role).toHaveBeenCalledWith([Role.ADMIN, Role.OPS_MANAGER]);
    expect(screen.getAllByText("Not tested")).toHaveLength(2);
    expect(screen.getByText(configured ? "Configured, not verified" : "Not configured")).toBeVisible();
    expect(screen.getByRole("link", { name: "Refresh status" })).toHaveAttribute("href", "/v2/admin/ai");
  });
  it("checks role before reading configuration", async () => {
    mocks.role.mockRejectedValue(new Error("FORBIDDEN"));
    await expect(AiConfigurationPage()).rejects.toThrow("FORBIDDEN");
    expect(mocks.config).not.toHaveBeenCalled();
  });
});
