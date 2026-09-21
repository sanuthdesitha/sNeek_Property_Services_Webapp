import { beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_VISION_SETTINGS } from "@/lib/ai/vision-settings-schema";
const mocks = vi.hoisted(() => ({ find: vi.fn(), upsert: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { appSetting: { findUnique: mocks.find, upsert: mocks.upsert } } }));
vi.mock("@/lib/ai/config", () => ({ getAiConfiguration: () => ({ model: "configured-model" }) }));
import { getVisionSettings, saveVisionSettings, VISION_SETTINGS_KEY } from "@/lib/ai/vision-settings";
beforeEach(() => vi.clearAllMocks());
it("defaults disabled and respects the server model", async () => {
  mocks.find.mockResolvedValue(null);
  expect(await getVisionSettings()).toEqual({ ...DEFAULT_VISION_SETTINGS, model: "configured-model" });
});
it("adds historical example default to older stored settings without enabling assignment", async () => {
  const { historicalAssignmentExamplesEnabled, ...legacy } = DEFAULT_VISION_SETTINGS;
  mocks.find.mockResolvedValue({ value: legacy });
  expect(await getVisionSettings()).toMatchObject({ historicalAssignmentExamplesEnabled: true, assignmentEnabled: false });
});
it("corrupt persisted settings fail closed without replacement", async () => {
  mocks.find.mockResolvedValue({ value: { comparisonEnabled: true } });
  await expect(getVisionSettings()).rejects.toThrow(); expect(mocks.upsert).not.toHaveBeenCalled();
});
it("validates before storing the public settings only", async () => {
  await expect(saveVisionSettings({ ...DEFAULT_VISION_SETTINGS, secret: "never" })).rejects.toThrow();
  expect(mocks.upsert).not.toHaveBeenCalled();
  expect(await saveVisionSettings(DEFAULT_VISION_SETTINGS)).toEqual(DEFAULT_VISION_SETTINGS);
  expect(mocks.upsert).toHaveBeenCalledWith({ where: { key: VISION_SETTINGS_KEY }, create: { key: VISION_SETTINGS_KEY, value: DEFAULT_VISION_SETTINGS }, update: { value: DEFAULT_VISION_SETTINGS } });
});
