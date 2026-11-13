import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { ProviderCallError, type AdapterRequest, type AdapterResult, type ProviderImage } from "../types";
import { parseJsonText, retryAfterFromHeaders } from "./shared";

const FAILURE = "Vision analysis could not be completed. No result was applied.";

function imageBlocks(images: ProviderImage[]): Anthropic.Messages.ContentBlockParam[] {
  return images.flatMap((image) => [
    { type: "text" as const, text: `Image identifier: ${JSON.stringify(image.id)}` },
    { type: "image" as const, source: { type: "base64" as const, media_type: image.mediaType, data: image.data } },
  ]);
}

/** Maps SDK errors to provider codes without keeping the provider's message. */
function classify(error: unknown): ProviderCallError {
  const status = typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : null;
  const name = error instanceof Error ? error.name : "";
  const headers = (error as { headers?: unknown })?.headers;
  if (status === 429) return new ProviderCallError("RATE_LIMITED", FAILURE, status, retryAfterFromHeaders(headers));
  if (status !== null && status >= 500) return new ProviderCallError("SERVER", FAILURE, status, retryAfterFromHeaders(headers));
  if (status === 401 || status === 403) return new ProviderCallError("AUTH", FAILURE, status);
  if (status !== null && status >= 400) return new ProviderCallError("BAD_REQUEST", FAILURE, status);
  if (/timeout/i.test(name)) return new ProviderCallError("TIMEOUT", FAILURE);
  if (/connection/i.test(name)) return new ProviderCallError("CONNECTION", FAILURE);
  return new ProviderCallError("UNKNOWN", FAILURE);
}

/** Native structured output (`output_config.format`) for text and image requests alike. */
export async function requestAnthropicStructured(request: AdapterRequest): Promise<AdapterResult> {
  if (!request.apiKey) throw new ProviderCallError("AUTH", FAILURE);
  const client = new Anthropic({ apiKey: request.apiKey, timeout: request.timeoutMs, maxRetries: 0 });
  let response: Anthropic.Messages.Message;
  try {
    response = await client.messages.create({
      model: request.model,
      max_tokens: request.maxOutputTokens,
      system: request.instructions,
      messages: [{ role: "user", content: [{ type: "text", text: request.prompt }, ...imageBlocks(request.images)] }],
      output_config: { format: { type: "json_schema", schema: request.jsonSchema } },
    });
  } catch (error) {
    throw classify(error);
  }
  const usage = { inputTokens: response.usage?.input_tokens ?? null, outputTokens: response.usage?.output_tokens ?? null };
  if (response.stop_reason && response.stop_reason !== "end_turn") throw new ProviderCallError("INCOMPLETE", FAILURE);
  const text = (response.content ?? []).filter((block) => block.type === "text").map((block) => (block as { text: string }).text).join("");
  return { data: parseJsonText(text, FAILURE), usage };
}

/** Metadata lookup only. */
export async function checkAnthropicModel(apiKey: string, model: string): Promise<string> {
  const client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 0 });
  const result = await client.models.retrieve(model);
  if (typeof result?.id !== "string" || !result.id) throw new Error("Invalid provider model response");
  return result.id;
}
