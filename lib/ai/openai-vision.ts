import "server-only";
import type { ProviderImage, ProviderUsage } from "./provider/types";
import { ProviderCallError } from "./provider/types";
import { fetchFailure, readBoundedJson } from "./provider/adapters/shared";

const API = "https://api.openai.com/v1";
const FAILURE = "Vision analysis could not be completed. No result was applied.";

type RequestOptions = { apiKey?: string | null; timeoutMs?: number };

async function requestJson(path: string, body: unknown, options: RequestOptions): Promise<any> {
  const key = options.apiKey?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new ProviderCallError("AUTH", FAILURE);
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${key}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error", cache: "no-store", signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
    });
  } catch (error) {
    throw fetchFailure(error, FAILURE);
  }
  return readBoundedJson(response, FAILURE);
}

export type OpenAiVisionInput = {
  model: string; instructions: string; prompt: string; images: ProviderImage[]; schema: Record<string, unknown>;
  /** Provider layer options; absent values keep the original environment key, 30 s and 4096 tokens. */
  apiKey?: string | null; timeoutMs?: number; maxOutputTokens?: number; onUsage?: (usage: ProviderUsage) => void;
};

/** Inputs have passed the shared image limits. Only base64 bytes are sent;
 * no caller-provided remote image URL or alternate API host is accepted.
 * Failures keep one sanitized message and carry a provider code for retry rules. */
export async function requestOpenAiVision(input: OpenAiVisionInput): Promise<unknown> {
  try {
    const result = await requestJson("/responses", {
      model: input.model, store: false, max_output_tokens: input.maxOutputTokens ?? 4096, instructions: input.instructions,
      input: [{ role: "user", content: [
        { type: "input_text", text: input.prompt },
        ...input.images.flatMap(image => [
          { type: "input_text", text: `Image identifier: ${JSON.stringify(image.id)}` },
          { type: "input_image", image_url: `data:${image.mediaType};base64,${image.data}`, detail: "auto" },
        ]),
      ] }],
      text: { format: { type: "json_schema", name: "property_photo_analysis", strict: true, schema: input.schema } },
    }, { apiKey: input.apiKey, timeoutMs: input.timeoutMs });
    if (result?.usage && input.onUsage) {
      input.onUsage({ inputTokens: Number.isFinite(result.usage.input_tokens) ? result.usage.input_tokens : null, outputTokens: Number.isFinite(result.usage.output_tokens) ? result.usage.output_tokens : null });
    }
    if (!result || result.status !== "completed" || result.error != null || result.incomplete_details != null || !Array.isArray(result.output)) throw new ProviderCallError("INCOMPLETE", FAILURE);
    // Reject refusals, tool calls, multiple answers and partial structured data.
    if (result.output.length !== 1) throw new ProviderCallError("INCOMPLETE", FAILURE);
    const message = result.output[0];
    if (message?.type !== "message" || message.role !== "assistant" || message.status !== "completed" || !Array.isArray(message.content) || message.content.length !== 1) throw new ProviderCallError("INCOMPLETE", FAILURE);
    const output = message.content[0];
    if (output?.type !== "output_text" || typeof output.text !== "string") throw new ProviderCallError("INCOMPLETE", FAILURE);
    try { return JSON.parse(output.text); } catch { throw new ProviderCallError("INVALID_JSON", FAILURE); }
  } catch (error) {
    throw error instanceof ProviderCallError ? error : new ProviderCallError("UNKNOWN", FAILURE);
  }
}

export async function checkOpenAiModelAccess(model: string, apiKey?: string | null): Promise<string> {
  try {
    if (!/^[a-zA-Z0-9._-]{1,100}$/.test(model)) throw new Error("Invalid model");
    const result = await requestJson(`/models/${encodeURIComponent(model)}`, undefined, { apiKey });
    if (result?.object !== "model" || typeof result.id !== "string" || !result.id || result.id.length > 200) throw new Error("Invalid model response");
    return result.id;
  } catch { throw new Error("Could not verify provider and model access. Check the server credential and model configuration."); }
}
