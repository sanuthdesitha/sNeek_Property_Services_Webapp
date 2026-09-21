// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_VISION_SETTINGS } from "@/lib/ai/vision-settings-schema";
const mocks = vi.hoisted(() => ({ settings: vi.fn(), anthropicCreate: vi.fn(), anthropicRetrieve: vi.fn() }));
vi.mock("@/lib/ai/vision-settings", () => ({ getVisionSettings: mocks.settings }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create: mocks.anthropicCreate }; models = { retrieve: mocks.anthropicRetrieve }; } }));
import { assignPhotosToFields, compareReferencePhotos, checkVisionConnection, type VisionImage } from "@/lib/ai/vision";
const settings = { ...DEFAULT_VISION_SETTINGS, provider: "openai" as const, model: "gpt-4.1", assignmentEnabled: true, comparisonEnabled: true };
const image: VisionImage = { id: "photo", mediaType: "image/jpeg", data: "YWJj" };
const assignment = { assignments: [{ photoId: "photo", fieldId: "room", confidence: .9, reason: "Matching fixed layout" }] };
const comparison = { assessment: "pass", confidence: .9, summary: "No visible issue", issues: [] };
const input = { photos: [image], fields: [{ id: "room", label: "Kitchen", sectionLabel: "Ground floor", referenceImages: [image], historicalExamples: [image] }] };
const envelope = (value: unknown) => ({ status: "completed", error: null, incomplete_details: null, output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(value) }] }] });
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("OPENAI_API_KEY", "synthetic-openai-key"); vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-anthropic-key");
  mocks.settings.mockResolvedValue(settings); fetchMock = vi.fn().mockResolvedValue(response(envelope(assignment))); vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("uses Responses vision with strict structured output and store:false", async () => {
  expect(await assignPhotosToFields(input)).toEqual(assignment);
  expect(fetchMock).toHaveBeenCalledTimes(1); expect(mocks.anthropicCreate).not.toHaveBeenCalled();
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe("https://api.openai.com/v1/responses");
  expect(init).toMatchObject({ method: "POST", redirect: "error", cache: "no-store", headers: { Authorization: "Bearer synthetic-openai-key" } });
  expect(init.signal).toBeInstanceOf(AbortSignal);
  const body = JSON.parse(init.body);
  expect(body).toMatchObject({ model: "gpt-4.1", store: false, max_output_tokens: 4096, text: { format: { name: "property_photo_analysis", type: "json_schema", strict: true, schema: { additionalProperties: false } } } });
  expect(body.input[0].content.filter((item: any) => item.type === "input_image")).toEqual(Array(3).fill({ type: "input_image", image_url: "data:image/jpeg;base64,YWJj", detail: "auto" }));
  expect(JSON.stringify(body)).toContain("historical-location-0-0"); expect(JSON.stringify(body)).toContain("NOT standards");
  expect(JSON.stringify(body)).not.toContain("synthetic-openai-key");
});
it("compares using the queued OpenAI model snapshot", async () => {
  fetchMock.mockResolvedValue(response(envelope(comparison)));
  expect(await compareReferencePhotos({ references: [image], submission: image }, { ...settings, model: "gpt-4.1-2025-04-14" })).toEqual(comparison);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe("gpt-4.1-2025-04-14");
});
it("legacy queued settings retain Anthropic while it is still selected", async () => {
  const { provider, ...legacy } = { ...settings, model: "claude-sonnet-5" };
  mocks.settings.mockResolvedValue({ ...settings, provider: "anthropic", model: "new-anthropic-model" });
  mocks.anthropicCreate.mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(comparison) }] });
  expect(await compareReferencePhotos({ references: [image], submission: image }, legacy as any)).toEqual(comparison);
  expect(fetchMock).not.toHaveBeenCalled(); expect(mocks.anthropicCreate).toHaveBeenCalledTimes(1);
});
it("legacy snapshots missing provider cannot dispatch to Anthropic after switching to Ollama", async () => {
  const { provider, ...legacy } = { ...settings, model: "claude-sonnet-5" };
  mocks.settings.mockResolvedValue({ ...settings, provider: "ollama", model: "gemma3:4b" });
  await expect(compareReferencePhotos({ references: [image], submission: image }, legacy as any)).rejects.toThrow("provider changed");
  expect(fetchMock).not.toHaveBeenCalled(); expect(mocks.anthropicCreate).not.toHaveBeenCalled();
});
it("disabled processing, missing keys and invalid images never send a request", async () => {
  mocks.settings.mockResolvedValue({ ...settings, assignmentEnabled: false });
  await expect(assignPhotosToFields(input)).rejects.toThrow("disabled");
  mocks.settings.mockResolvedValue(settings); vi.stubEnv("OPENAI_API_KEY", "");
  await expect(assignPhotosToFields(input)).rejects.toThrow("No result was applied");
  vi.stubEnv("OPENAI_API_KEY", "synthetic-openai-key");
  await expect(assignPhotosToFields({ ...input, photos: [{ ...image, data: "https://untrusted.test/photo" }] })).rejects.toThrow("Invalid vision image");
  expect(fetchMock).not.toHaveBeenCalled();
});
it.each(["incomplete", "failed", "in_progress", "cancelled"])("rejects noncompleted response %s", async status => {
  fetchMock.mockResolvedValue(response({ ...envelope(assignment), status }));
  await expect(assignPhotosToFields(input)).rejects.toThrow("No result was applied"); expect(fetchMock).toHaveBeenCalledTimes(1);
});
it.each([
  { type: "refusal", refusal: "private provider refusal" },
  { type: "output_text", text: "not JSON" },
])("rejects refusal or malformed content without exposing provider details", async content => {
  const body = envelope(assignment); body.output[0].content = [content as any]; fetchMock.mockResolvedValue(response(body));
  await expect(assignPhotosToFields(input)).rejects.toThrow("Vision analysis could not be completed. No result was applied.");
});
it("rejects multiple outputs and refuses convenient top-level output_text spoofing", async () => {
  const body = envelope(assignment); body.output.push(body.output[0]); fetchMock.mockResolvedValueOnce(response(body)).mockResolvedValueOnce(response({ status: "completed", output_text: JSON.stringify(assignment), output: [] }));
  await expect(assignPhotosToFields(input)).rejects.toThrow("No result was applied");
  await expect(assignPhotosToFields(input)).rejects.toThrow("No result was applied");
});
it("retains exact destination and completeness validation after OpenAI parsing", async () => {
  fetchMock.mockResolvedValueOnce(response(envelope({ assignments: [{ ...assignment.assignments[0], fieldId: "foreign-room" }] }))).mockResolvedValueOnce(response(envelope({ assignments: [] })));
  await expect(assignPhotosToFields(input)).rejects.toThrow("identifiers");
  await expect(assignPhotosToFields(input)).rejects.toThrow("Incomplete vision assignments");
});
it("bounds provider responses even without Content-Length", async () => {
  fetchMock.mockResolvedValueOnce(new Response("x", { headers: { "Content-Length": String(2 * 1024 * 1024) } })).mockResolvedValueOnce(new Response("x".repeat(1024 * 1024 + 1)));
  await expect(assignPhotosToFields(input)).rejects.toThrow("No result was applied");
  await expect(assignPhotosToFields(input)).rejects.toThrow("No result was applied");
});
it("never retries or exposes failed provider bodies or transport errors", async () => {
  fetchMock.mockResolvedValueOnce(new Response("private provider key details", { status: 429 }));
  await expect(assignPhotosToFields(input)).rejects.toThrow("Vision analysis could not be completed. No result was applied.");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  fetchMock.mockRejectedValueOnce(new Error("private transport failure"));
  await expect(assignPhotosToFields(input)).rejects.toThrow("Vision analysis could not be completed. No result was applied.");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
it("connection check only retrieves model access, without images or a generation request", async () => {
  fetchMock.mockResolvedValue(response({ object: "model", id: "gpt-4.1" }));
  expect(await checkVisionConnection()).toMatchObject({ model: "gpt-4.1", configuredModel: "gpt-4.1", message: "Credential and model access verified. Image analysis was not run." });
  expect(fetchMock).toHaveBeenCalledWith("https://api.openai.com/v1/models/gpt-4.1", expect.objectContaining({ method: "GET" }));
  expect(fetchMock.mock.calls[0][1].body).toBeUndefined(); expect(mocks.anthropicRetrieve).not.toHaveBeenCalled();
});
it("rejects invalid model metadata and model-access errors safely", async () => {
  fetchMock.mockResolvedValueOnce(response({ object: "error", id: "spoofed" })).mockResolvedValueOnce(new Response("secret", { status: 401 }));
  await expect(checkVisionConnection()).rejects.toThrow("Could not verify provider and model access");
  await expect(checkVisionConnection()).rejects.toThrow("Could not verify provider and model access");
});
