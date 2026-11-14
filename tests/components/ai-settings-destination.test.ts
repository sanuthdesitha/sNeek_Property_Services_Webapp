import { describe, expect, it } from "vitest";
import { availableSettings, settingsHref, SETTINGS_DESTINATIONS } from "@/components/v2/admin/settings/settings-catalog";
import { canUseOpsPath, opsRequestFeature } from "@/lib/rbac/ops-catalog";

describe("AI settings destination", () => {
  it("opens the one AI page from Settings, with the old photo checks and Ollama entries as its sections", () => {
    expect(settingsHref("ai")).toBe("/v2/admin/ai");
    expect(settingsHref("ai-workflows")).toBe("/v2/admin/ai#photo-checks");
    expect(settingsHref("ollama")).toBe("/v2/admin/ai?section=ollama");
    expect(SETTINGS_DESTINATIONS.filter((item) => item.group === "ai").map((item) => item.key)).toEqual(["ai", "ai-workflows", "ollama"]);
  });

  it("lists AI for operations managers (read) but keeps Ollama setup for administrators", () => {
    const keys = availableSettings(false).map((item) => item.key);
    expect(keys).toContain("ai");
    expect(keys).not.toContain("ollama");
  });

  it("routes the page, the old tab and the settings read through the AI tools pack; writes need Manage", () => {
    expect(opsRequestFeature("/v2/admin/settings?tab=ai")).toBe("ai");
    expect(opsRequestFeature("/v2/admin/ai")).toBe("ai");
    expect(opsRequestFeature("/api/admin/ai/settings")).toBe("ai");
    const levels = Object.fromEntries(Object.keys({}).map((key) => [key, "off"])) as Record<string, string>;
    const read = new Proxy(levels, { get: (_target, key) => (key === "ai" ? "read" : "off") }) as never;
    expect(canUseOpsPath(read, "/api/admin/ai/settings", "GET")).toBe(true);
    expect(canUseOpsPath(read, "/api/admin/ai/settings", "PUT")).toBe(false);
    expect(canUseOpsPath(read, "/v2/admin/settings?tab=ai", "GET")).toBe(true);
  });
});
