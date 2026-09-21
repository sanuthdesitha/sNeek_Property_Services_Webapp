import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_VISION_SETTINGS } from "@/lib/ai/vision-settings-schema";
const mocks = vi.hoisted(() => ({ create: vi.fn(), retrieve: vi.fn(), settings: vi.fn(), config: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create: mocks.create }; models = { retrieve: mocks.retrieve }; } }));
vi.mock("@/lib/ai/vision-settings", () => ({ getVisionSettings: mocks.settings }));
vi.mock("@/lib/ai/config", () => ({ getVisionProviderConfiguration: mocks.config }));
import { assignPhotosToFields, compareReferencePhotos, checkVisionConnection, type VisionImage } from "@/lib/ai/vision";
const photo: VisionImage = { id: "photo", mediaType: "image/jpeg", data: "YWJj" };
const settings = { ...DEFAULT_VISION_SETTINGS, provider: "anthropic" as const, model: "claude-sonnet-5", comparisonEnabled: true, assignmentEnabled: true };
function response(body: unknown) { mocks.create.mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(body) }] }); }
beforeEach(() => { vi.clearAllMocks(); process.env.ANTHROPIC_API_KEY = "test-secret"; mocks.settings.mockResolvedValue(settings); mocks.config.mockReturnValue({ configured: true }); });
describe("vision provider boundary", () => {
  it("never calls provider when disabled", async () => {
    mocks.settings.mockResolvedValue(DEFAULT_VISION_SETTINGS);
    await expect(compareReferencePhotos({ references: [photo], submission: photo })).rejects.toThrow("disabled");
    await expect(assignPhotosToFields({ photos: [photo], fields: [{ id: "f", label: "Room" }] })).rejects.toThrow("disabled");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("does not guess without references", async () => {
    expect(await compareReferencePhotos({ references: [], submission: photo })).toMatchObject({ assessment: "inconclusive", issues: [] });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("binds the snapshot model and uses native structured output", async () => {
    response({ assessment: "issue", confidence: .9, summary: "Visible debris", issues: [{ code: "debris", description: "Debris on floor", severity: "minor", confidence: .9 }] });
    await compareReferencePhotos({ references: [photo], submission: photo }, { ...settings, model: "snapshot-model" });
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ model: "snapshot-model", output_config: { format: expect.objectContaining({ type: "json_schema" }) } }));
  });
  it.each(["max_tokens", "refusal"])("rejects incomplete/refused output %s", async reason => {
    mocks.create.mockResolvedValue({ stop_reason: reason, content: [] });
    await expect(compareReferencePhotos({ references: [photo], submission: photo })).rejects.toThrow("No result was applied");
  });
  it.each([
    { assessment: "pass", confidence: 2, summary: "ok", issues: [] },
    { assessment: "inconclusive", confidence: .9, summary: "unknown", issues: [{ code: "x", description: "x", severity: "major", confidence: .9 }] },
    { assessment: "issue", confidence: .9, summary: "unknown", issues: [] },
  ])("rejects invalid comparison response", async body => {
    response(body); await expect(compareReferencePhotos({ references: [photo], submission: photo })).rejects.toThrow();
  });
  it("includes authorized references and accepts uncertain assignment", async () => {
    response({ assignments: [{ photoId: "photo", fieldId: null, confidence: .2, reason: "Similar rooms" }] });
    expect(await assignPhotosToFields({ photos: [photo], fields: [{ id: "room", label: "Bedroom", sectionLabel: "Upstairs", referenceImages: [photo] }] })).toMatchObject({ assignments: [{ fieldId: null }] });
    expect(JSON.stringify(mocks.create.mock.calls[0][0])).toContain("field-reference-0-0");
  });
  it("labels historical images as location examples separately from quality references", async () => {
    response({ assignments: [{ photoId: "photo", fieldId: "room", confidence: .9, reason: "Matching fixed window" }] });
    await assignPhotosToFields({ photos: [photo], fields: [{ id: "room", label: "Bedroom", referenceImages: [photo], historicalExamples: [photo] }] });
    const body = JSON.stringify(mocks.create.mock.calls[0][0]);
    expect(body).toContain("historical-location-0-0"); expect(body).toContain("NOT standards");
    expect(mocks.create.mock.calls[0][0].messages[0].content.filter((block: any) => block.type === "image")).toHaveLength(3);
  });
  it("does not disclose historical images when the memory toggle is off", async () => {
    mocks.settings.mockResolvedValue({ ...settings, historicalAssignmentExamplesEnabled: false });
    response({ assignments: [{ photoId: "photo", fieldId: null, confidence: .1, reason: "Uncertain" }] });
    await assignPhotosToFields({ photos: [photo], fields: [{ id: "room", label: "Bedroom", historicalExamples: [{ ...photo, data: "aGlzdG9yeQ==" }] }] });
    expect(JSON.stringify(mocks.create.mock.calls[0][0])).not.toContain("aGlzdG9yeQ==");
    expect(mocks.create.mock.calls[0][0].messages[0].content.filter((block: any) => block.type === "image")).toHaveLength(1);
  });
  it.each([
    [], [{ photoId: "foreign", fieldId: "room", confidence: .9, reason: "match" }],
    [{ photoId: "photo", fieldId: "foreign", confidence: .9, reason: "match" }],
    [{ photoId: "photo", fieldId: "room", confidence: .9, reason: "match" }, { photoId: "photo", fieldId: "room", confidence: .9, reason: "match" }],
  ])("rejects missing, foreign or duplicate assignment identity", async (...items) => {
    response({ assignments: items });
    await expect(assignPhotosToFields({ photos: [photo], fields: [{ id: "room", label: "Room" }] })).rejects.toThrow();
  });
  it("rejects URL data and oversized requests before transfer", async () => {
    await expect(compareReferencePhotos({ references: [photo], submission: { ...photo, data: "https://example.com/image" } })).rejects.toThrow("Invalid vision image");
    await expect(compareReferencePhotos({ references: Array(20).fill(photo), submission: photo })).rejects.toThrow("Too many");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("connection check retrieves model only", async () => {
    mocks.retrieve.mockResolvedValue({ id: "resolved-model" });
    expect(await checkVisionConnection()).toMatchObject({ model: "resolved-model", configuredModel: settings.model });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("missing credential fails before provider requests", async () => {
    mocks.config.mockReturnValue({ configured: false });
    await expect(compareReferencePhotos({ references: [photo], submission: photo })).rejects.toThrow("No result was applied");
    await expect(checkVisionConnection()).rejects.toThrow("Could not verify");
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.retrieve).not.toHaveBeenCalled();
  });
  it("rejects malformed structured JSON without exposing the provider response", async () => {
    mocks.create.mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "text", text: "invalid provider content" }] });
    await expect(compareReferencePhotos({ references: [photo], submission: photo })).rejects.toThrow("No result was applied");
  });
  it("enforces per-image and aggregate byte limits before provider transfer", async () => {
    const large = { ...photo, data: Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64") };
    await expect(compareReferencePhotos({ references: [photo], submission: large })).rejects.toThrow("limit exceeded");
    const atLimit = { ...photo, data: Buffer.alloc(5 * 1024 * 1024).toString("base64") };
    await expect(compareReferencePhotos({ references: Array(4).fill(atLimit), submission: atLimit })).rejects.toThrow("limit exceeded");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("rejects ambiguous photo/reference identities and malformed model metadata", async () => {
    await expect(assignPhotosToFields({ photos: [{ ...photo, id: "field-reference-0-0" }], fields: [{ id: "f", label: "Room", referenceImages: [photo] }] })).rejects.toThrow("Conflicting");
    expect(mocks.create).not.toHaveBeenCalled(); mocks.retrieve.mockResolvedValue({});
    await expect(checkVisionConnection()).rejects.toThrow("Could not verify");
  });
});
