import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_VISION_SETTINGS } from "@/lib/ai/vision-settings-schema";
const mocks = vi.hoisted(() => ({ local: vi.fn(), check: vi.fn(), openai: vi.fn(), openaiCheck: vi.fn(), anthropic: vi.fn(), settings: vi.fn(), config: vi.fn() }));
vi.mock("@/lib/ai/ollama", () => ({ requestOllamaJson: mocks.local, checkOllamaModel: mocks.check }));
vi.mock("@/lib/ai/openai-vision", () => ({ requestOpenAiVision: mocks.openai, checkOpenAiModelAccess: mocks.openaiCheck }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class { constructor() { mocks.anthropic(); } } }));
vi.mock("@/lib/ai/vision-settings", () => ({ getVisionSettings: mocks.settings }));
vi.mock("@/lib/ai/config", () => ({ getVisionProviderConfiguration: mocks.config }));
import { assignPhotosToFields, compareReferencePhotos, checkVisionConnection, type VisionImage } from "@/lib/ai/vision";
const photo: VisionImage = { id: "photo", mediaType: "image/jpeg", data: "YWJj" };
const settings = { ...DEFAULT_VISION_SETTINGS, provider: "ollama" as const, model: "gemma3:4b", assignmentEnabled: true, comparisonEnabled: true };
const pass = { assessment: "pass", confidence: .9, summary: "Matches", issues: [] };
const assignment = { photoId: "photo", fieldId: "room", confidence: .9, reason: "Matching window" };
const input = { photos: [photo], fields: [{ id: "room", label: "Bedroom" }] };
beforeEach(() => { vi.resetAllMocks(); mocks.settings.mockResolvedValue(settings); mocks.config.mockReturnValue({ configured: true }); });
function noCloud() { expect(mocks.openai).not.toHaveBeenCalled(); expect(mocks.openaiCheck).not.toHaveBeenCalled(); expect(mocks.anthropic).not.toHaveBeenCalled(); }

describe("Ollama vision routing", () => {
  it("passes every photo, reference and historical example with distinct labels and strict schema", async () => {
    mocks.local.mockResolvedValue({ assignments: [assignment] });
    await assignPhotosToFields({ ...input, fields: [{ ...input.fields[0], referenceImages: [photo, photo], historicalExamples: [photo] }] });
    const request = mocks.local.mock.calls[0][0];
    expect(request.model).toBe("gemma3:4b");
    expect(request.images.map((image: VisionImage) => image.id)).toEqual(["photo", "field-reference-0-0", "field-reference-0-1", "historical-location-0-0"]);
    expect(request.images.every((image: VisionImage) => image.data === photo.data)).toBe(true);
    expect(request.prompt).toContain("NOT standards");
    expect(request.schema).toMatchObject({ type: "object", additionalProperties: false, required: ["assignments"] });
    noCloud();
  });
  it("honors a queued model snapshot while the selected provider remains unchanged", async () => {
    mocks.settings.mockResolvedValue({ ...settings, model: "gemma3:12b" });
    mocks.local.mockResolvedValue(pass);
    await expect(compareReferencePhotos({ references: [photo, photo], submission: photo }, settings)).resolves.toEqual(pass);
    expect(mocks.local.mock.calls[0][0]).toMatchObject({ model: "gemma3:4b", images: [{ id: "reference-0" }, { id: "reference-1" }, { id: "submission" }] });
    noCloud();
  });
  it.each(["openai", "anthropic"] as const)("blocks an older %s review after switching to Ollama", async provider => {
    await expect(compareReferencePhotos({ references: [photo], submission: photo }, { ...settings, provider, model: provider === "openai" ? "gpt-4.1" : "claude-sonnet-5" })).rejects.toThrow("provider changed");
    expect(mocks.local).not.toHaveBeenCalled(); noCloud();
  });
  it("does not silently reroute a queued local review after selecting a cloud provider", async () => {
    mocks.settings.mockResolvedValue({ ...settings, provider: "openai", model: "gpt-4.1" });
    await expect(compareReferencePhotos({ references: [photo], submission: photo }, settings)).rejects.toThrow("provider changed");
    expect(mocks.local).not.toHaveBeenCalled(); noCloud();
  });
  it("keeps the current comparison kill switch authoritative over queued settings", async () => {
    mocks.settings.mockResolvedValue({ ...settings, comparisonEnabled: false });
    await expect(compareReferencePhotos({ references: [photo], submission: photo }, settings)).rejects.toThrow("disabled");
    expect(mocks.local).not.toHaveBeenCalled(); noCloud();
  });
  it("does not call local or cloud providers when assignment is disabled", async () => {
    mocks.settings.mockResolvedValue({ ...settings, assignmentEnabled: false });
    await expect(assignPhotosToFields(input)).rejects.toThrow("disabled");
    expect(mocks.local).not.toHaveBeenCalled(); noCloud();
  });
  it("never falls back to cloud after a local model or transport failure", async () => {
    mocks.local.mockRejectedValue(new Error("private endpoint detail"));
    await expect(assignPhotosToFields(input)).rejects.toThrow("Vision analysis could not be completed. No result was applied.");
    expect(mocks.local).toHaveBeenCalledTimes(1); noCloud();
  });
  it("rejects unconfigured local transport before any request", async () => {
    mocks.config.mockReturnValue({ configured: false });
    await expect(assignPhotosToFields(input)).rejects.toThrow("No result was applied");
    expect(mocks.local).not.toHaveBeenCalled(); noCloud();
  });
  it.each([
    { assignments: [] },
    { assignments: [{ ...assignment, fieldId: "foreign" }] },
    { assignments: [{ ...assignment, photoId: "foreign" }] },
    { assignments: [assignment, assignment] },
    { assignments: [{ ...assignment, confidence: 2 }] },
    { assignments: [assignment], extra: true },
  ])("rejects invalid local structured assignments", async result => {
    mocks.local.mockResolvedValue(result);
    await expect(assignPhotosToFields(input)).rejects.toThrow(); noCloud();
  });
  it("rejects contradictory local comparison findings", async () => {
    mocks.local.mockResolvedValue({ ...pass, assessment: "issue" });
    await expect(compareReferencePhotos({ references: [photo], submission: photo })).rejects.toThrow("Missing vision findings");
    noCloud();
  });
  it("applies shared image limits before contacting the local model", async () => {
    await expect(compareReferencePhotos({ references: Array(20).fill(photo), submission: photo })).rejects.toThrow("Too many vision images");
    await expect(assignPhotosToFields({ ...input, photos: [{ ...photo, data: "not base64" }] })).rejects.toThrow("Invalid vision image");
    expect(mocks.local).not.toHaveBeenCalled(); noCloud();
  });
  it("checks local vision model access without running image analysis", async () => {
    mocks.check.mockResolvedValue("gemma3:4b");
    await expect(checkVisionConnection()).resolves.toMatchObject({ model: "gemma3:4b", configuredModel: "gemma3:4b" });
    expect(mocks.check).toHaveBeenCalledWith("gemma3:4b", true);
    expect(mocks.local).not.toHaveBeenCalled(); noCloud();
  });
  it("sanitizes local connection failures without contacting cloud providers", async () => {
    mocks.check.mockRejectedValue(new Error("private host detail"));
    await expect(checkVisionConnection()).rejects.toThrow("Could not verify provider and model access");
    expect(mocks.local).not.toHaveBeenCalled(); noCloud();
  });
});
