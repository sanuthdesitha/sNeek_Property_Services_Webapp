import "server-only";
import type { VisionImage } from "./vision";

const API = "https://api.openai.com/v1";
const MAX_RESPONSE_BYTES = 1024 * 1024;

async function requestJson(path: string, body?: unknown): Promise<any> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("OpenAI is not configured");
  const response = await fetch(`${API}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${key}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "error", cache: "no-store", signal: AbortSignal.timeout(30_000),
  });
  const declaredLength = Number(response.headers.get("content-length"));
  if (!response.ok || (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("Provider response unavailable");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0, text = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error("Provider response too large");
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally { await reader.cancel().catch(() => undefined); }
}

/** Inputs have passed the shared image limits. Only base64 bytes are sent;
 * no caller-provided remote image URL or alternate API host is accepted. */
export async function requestOpenAiVision(input: { model: string; instructions: string; prompt: string; images: VisionImage[]; schema: Record<string, unknown> }): Promise<unknown> {
  try {
    const result = await requestJson("/responses", {
      model: input.model, store: false, max_output_tokens: 4096, instructions: input.instructions,
      input: [{ role: "user", content: [
        { type: "input_text", text: input.prompt },
        ...input.images.flatMap(image => [
          { type: "input_text", text: `Image identifier: ${JSON.stringify(image.id)}` },
          { type: "input_image", image_url: `data:${image.mediaType};base64,${image.data}`, detail: "auto" },
        ]),
      ] }],
      text: { format: { type: "json_schema", name: "property_photo_analysis", strict: true, schema: input.schema } },
    });
    if (!result || result.status !== "completed" || result.error != null || result.incomplete_details != null || !Array.isArray(result.output)) throw new Error("Incomplete provider response");
    // Reject refusals, tool calls, multiple answers and partial structured data.
    if (result.output.length !== 1) throw new Error("Unexpected provider output");
    const message = result.output[0];
    if (message?.type !== "message" || message.role !== "assistant" || message.status !== "completed" || !Array.isArray(message.content) || message.content.length !== 1) throw new Error("Unexpected provider message");
    const output = message.content[0];
    if (output?.type !== "output_text" || typeof output.text !== "string") throw new Error("Provider did not return structured text");
    return JSON.parse(output.text);
  } catch { throw new Error("Vision analysis could not be completed. No result was applied."); }
}

export async function checkOpenAiModelAccess(model: string): Promise<string> {
  try {
    if (!/^[a-zA-Z0-9._-]{1,100}$/.test(model)) throw new Error("Invalid model");
    const result = await requestJson(`/models/${encodeURIComponent(model)}`);
    if (result?.object !== "model" || typeof result.id !== "string" || !result.id || result.id.length > 200) throw new Error("Invalid model response");
    return result.id;
  } catch { throw new Error("Could not verify provider and model access. Check the server credential and model configuration."); }
}
