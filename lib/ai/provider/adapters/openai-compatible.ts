import "server-only";
import { assertSafePublicUrl } from "@/lib/security/ssrf";
import { isAcceptableCompatibleBaseUrl } from "../routing-schema";
import { ProviderCallError, type AdapterRequest, type AdapterResult } from "../types";
import { fetchFailure, parseJsonText, readBoundedJson } from "./shared";

const FAILURE = "AI request to the OpenAI-compatible endpoint could not be completed. No result was applied.";

/** The chat-completions URL for a saved base such as https://example.ai/v1. */
export function compatibleEndpoint(baseUrl: string, path: "chat/completions" | `models/${string}`): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path}`;
}

/** Re-checks https, credentials and public DNS on every call (anti-SSRF). Never follows redirects. */
async function safeFetch(url: string, init: RequestInit): Promise<Response> {
  if (!isAcceptableCompatibleBaseUrl(url)) throw new ProviderCallError("BAD_REQUEST", FAILURE);
  try {
    await assertSafePublicUrl(url);
  } catch {
    throw new ProviderCallError("BAD_REQUEST", FAILURE);
  }
  try {
    return await fetch(url, { ...init, redirect: "error", cache: "no-store" });
  } catch (error) {
    throw fetchFailure(error, FAILURE);
  }
}

/** Chat Completions with a strict JSON schema response format; images as base64 data URLs only. */
export async function requestCompatibleStructured(request: AdapterRequest): Promise<AdapterResult> {
  if (!request.baseUrl) throw new ProviderCallError("BAD_REQUEST", FAILURE);
  const content = [
    { type: "text", text: request.prompt },
    ...request.images.flatMap((image) => [
      { type: "text", text: `Image identifier: ${JSON.stringify(image.id)}` },
      { type: "image_url", image_url: { url: `data:${image.mediaType};base64,${image.data}` } },
    ]),
  ];
  const response = await safeFetch(compatibleEndpoint(request.baseUrl, "chat/completions"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(request.apiKey ? { Authorization: `Bearer ${request.apiKey}` } : {}) },
    body: JSON.stringify({
      model: request.model,
      max_tokens: request.maxOutputTokens,
      temperature: 0,
      messages: [
        { role: "system", content: request.instructions },
        { role: "user", content: request.images.length ? content : request.prompt },
      ],
      response_format: { type: "json_schema", json_schema: { name: "structured_result", strict: true, schema: request.jsonSchema } },
    }),
    signal: AbortSignal.timeout(request.timeoutMs),
  });
  const body = await readBoundedJson(response, FAILURE) as {
    choices?: { finish_reason?: string; message?: { content?: unknown; refusal?: unknown; tool_calls?: unknown[] } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const usage = {
    inputTokens: Number.isFinite(body?.usage?.prompt_tokens) ? Number(body.usage!.prompt_tokens) : null,
    outputTokens: Number.isFinite(body?.usage?.completion_tokens) ? Number(body.usage!.completion_tokens) : null,
  };
  const choice = Array.isArray(body?.choices) && body.choices.length === 1 ? body.choices[0] : null;
  if (!choice || choice.finish_reason !== "stop" || typeof choice.message?.content !== "string" || choice.message.refusal || (choice.message.tool_calls?.length ?? 0) > 0) {
    throw new ProviderCallError("INCOMPLETE", FAILURE);
  }
  return { data: parseJsonText(choice.message.content, FAILURE), usage };
}

/** Metadata lookup only (GET /models/{model}). */
export async function checkCompatibleModel(baseUrl: string, apiKey: string | null, model: string): Promise<string> {
  const response = await safeFetch(compatibleEndpoint(baseUrl, `models/${encodeURIComponent(model)}`), {
    method: "GET",
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(15_000),
  });
  const body = await readBoundedJson(response, FAILURE) as { id?: unknown };
  if (typeof body?.id !== "string" || !body.id) throw new ProviderCallError("INCOMPLETE", FAILURE);
  return body.id;
}
