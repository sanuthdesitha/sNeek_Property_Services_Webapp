import "server-only";
import { isIP } from "node:net";
import type { VisionImage } from "./vision";
import { getOllamaSettings } from "./ollama-settings";
import { validateOllamaBaseUrl } from "./ollama-settings-schema";

export class OllamaError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = "OllamaError"; }
}
export function ollamaFailure(error: unknown): { code: string; message: string } {
  return error instanceof OllamaError ? { code: error.code, message: error.message }
    : { code: "INVALID_RESULT", message: "The model returned an invalid or incomplete result. Try a different model and run this check again." };
}
function providerFailure(status: number, text: string): OllamaError {
  if (/memory|out of memory|allocate|requires more|resource exhausted/i.test(text)) return new OllamaError("MEMORY", "Ollama could not allocate enough memory. Stop other loaded models, lower context size or use a smaller compatible model.");
  if (status === 404 || /not found|does not exist/i.test(text)) return new OllamaError("MODEL_MISSING", "The model or API endpoint was not found. Check the server address and download the selected model.");
  if (status === 401 || status === 403) return new OllamaError("AUTH", "Ollama rejected access. Check the optional API key or reverse-proxy access rules.");
  if (/vision|image.*support|support.*image/i.test(text)) return new OllamaError("VISION_UNSUPPORTED", "This model cannot process the supplied images. Select a vision model supporting multiple images.");
  return new OllamaError("SERVER", `Ollama returned an error (HTTP ${status}). Check the model and server, then retry. No cloud fallback was used.`);
}
type Runtime = Awaited<ReturnType<typeof getOllamaSettings>>;
/** Fixed API paths only; credentials and provider bodies never leave the server. */
export async function ollamaFetch(path: "show" | "chat" | "version" | "tags" | "ps" | "pull", body?: unknown, runtime?: Runtime): Promise<Response> {
  const settings = runtime ?? await getOllamaSettings();
  if (!validateOllamaBaseUrl(settings.baseUrl)) throw new OllamaError("CONFIGURATION", "Save a valid internal Ollama server address first.");
  try {
    return await fetch(`${settings.baseUrl.replace(/\/$/, "")}/api/${path}`, {
      method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: "error", cache: "no-store",
      signal: AbortSignal.timeout(path === "pull" ? 30 * 60_000 : path === "chat" ? settings.inferenceTimeoutSeconds * 1000 : 8_000),
    });
  } catch (error) {
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) throw new OllamaError("TIMEOUT", "Ollama exceeded the configured deadline. Try a warm model, fewer loaded models, a smaller context or a longer timeout.");
    throw new OllamaError("CONNECTION", "Local Ollama could not be reached. Check the internal address, running service and shared Docker network; no cloud fallback was used.");
  }
}
export async function readOllamaResponse(response: Response): Promise<Record<string, unknown>> {
  if (response.redirected || !response.body || Number(response.headers.get("content-length")) > 1024 * 1024) { await response.body?.cancel().catch(() => undefined); throw new OllamaError("RESPONSE", "Local Ollama could not return a valid bounded response."); }
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let size = 0, text = "";
  try {
    for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > 1024 * 1024) throw new OllamaError("RESPONSE", "Local Ollama could not return a valid bounded response."); text += decoder.decode(chunk.value, { stream: true }); }
    text += decoder.decode();
  } catch (error) {
    if (error instanceof OllamaError) throw error;
    throw new OllamaError("TIMEOUT", "Ollama stopped responding before completion. Check memory or increase the inference timeout.");
  } finally { await reader.cancel().catch(() => undefined); }
  if (!response.ok) throw providerFailure(response.status, text);
  let result: unknown; try { result = JSON.parse(text); } catch { throw new OllamaError("RESPONSE", "Ollama returned invalid JSON. Check the server address and model."); }
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new OllamaError("RESPONSE", "Ollama returned an invalid response.");
  const object = result as Record<string, unknown>;
  if (remote(object)) throw new OllamaError("REMOTE_MODEL", "Cloud-backed Ollama models are not permitted. Select an installed local model.");
  if (object.error) throw providerFailure(500, String(object.error));
  return object;
}

function endpoint() {
  const raw = process.env.OLLAMA_BASE_URL?.trim();
  if (!raw || /[\\\u0000-\u0020]/.test(raw)) throw new Error("Local Ollama is not configured.");
  const url = new URL(raw); const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const octets = host.split(".").map(Number);
  const privateV4 = isIP(host) === 4 && (octets[0] === 127 || octets[0] === 10 || (octets[0] === 192 && octets[1] === 168) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31));
  const privateV6 = isIP(host) === 6 && (host === "::1" || /^(fc|fd)/.test(host));
  const internalName = !isIP(host) && /^[a-z][a-z0-9-]*$/.test(host);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || !(privateV4 || privateV6 || internalName)) throw new Error("Ollama must use an internal server address.");
  return url.toString().replace(/\/$/, "");
}
export function isOllamaConfigured() { try { endpoint(); return true; } catch { return false; } }
export function localModel(value: string) {
  if (!value || value.length > 200 || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]*(?::[a-zA-Z0-9._-]+)?$/.test(value) || value.split("/").some(part => part === "." || part === "..") || /(?:^|[:/_-])cloud(?:$|[:/_-])/i.test(value)) throw new Error("Choose an installed local Ollama model. Cloud models are unavailable.");
  return value;
}
function remote(value: Record<string, unknown>) { return Boolean(value.remote_host || value.remote_model); }
async function post(path: "show" | "chat", body: unknown, runtime?: Runtime) {
  return readOllamaResponse(await ollamaFetch(path, body, runtime));
}
async function show(model: string, requireVision: boolean, runtime?: Runtime) {
  const checked = localModel(model);
  const info = await post("show", { model: checked, verbose: false }, runtime);
  const capabilities = info.capabilities;
  if (!Array.isArray(capabilities) || !capabilities.includes("completion") || (requireVision && !capabilities.includes("vision"))) throw new OllamaError("CAPABILITY", requireVision ? "The installed Ollama model does not support image analysis. Choose a vision model." : "The installed Ollama model does not support text generation.");
  return info;
}
/** Metadata lookup only: never pulls a model or generates content. */
export async function checkOllamaModel(model: string, requireVision = true): Promise<string> { await show(model, requireVision); return model; }

/** Callers validate this parsed JSON against their own domain result schema. */
export async function requestOllamaJson(input: { model: string; prompt: string; instructions: string; images: VisionImage[]; schema: Record<string, unknown> }): Promise<unknown> {
  localModel(input.model);
  if (input.images.length > 20 || input.prompt.length > 100_000 || input.instructions.length > 20_000 || JSON.stringify(input.schema).length > 50_000) throw new Error("Ollama request exceeds the supported size.");
  let bytes = 0; const ids = new Set<string>();
  for (const image of input.images) {
    if (!image.id || image.id.length > 200 || ids.has(image.id) || !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(image.mediaType) || !image.data || image.data.length > 7_000_000 || image.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) throw new Error("Invalid Ollama image.");
    ids.add(image.id); const size = Buffer.byteLength(image.data, "base64"); bytes += size;
    if (size > 5 * 1024 * 1024 || bytes > 20 * 1024 * 1024) throw new Error("Ollama image limit exceeded.");
  }
  const runtime = await getOllamaSettings();
  const info = await show(input.model, input.images.length > 0, runtime);
  const details = info.details as { family?: unknown; families?: unknown } | undefined;
  const families = [details?.family, ...(Array.isArray(details?.families) ? details.families : [])];
  if (input.images.length > 1 && families.includes("mllama")) throw new Error("This Ollama model supports only one image. Choose a model supporting multiple images.");
  const ordering = input.images.map((image, index) => ({ imageNumber: index + 1, id: image.id }));
  const response = await post("chat", { model: input.model, stream: false, format: input.schema, keep_alive: `${runtime.keepAliveMinutes}m`, options: { temperature: 0, num_predict: 4096, num_ctx: runtime.contextTokens }, messages: [
    { role: "system", content: input.instructions + " Return only JSON matching the supplied schema." },
    { role: "user", content: input.prompt + (ordering.length ? "\nImage identifiers in attachment order: " + JSON.stringify(ordering) : ""), ...(input.images.length ? { images: input.images.map(image => image.data) } : {}) },
  ] }, runtime);
  const message = response.message as { role?: unknown; content?: unknown; tool_calls?: unknown } | undefined;
  if (response.done !== true || response.done_reason !== "stop" || typeof response.model !== "string" || !message || message.role !== "assistant" || typeof message.content !== "string" || (Array.isArray(message.tool_calls) && message.tool_calls.length)) throw new Error("Local Ollama returned an incomplete result. No result was applied.");
  localModel(response.model);
  try { const result: unknown = JSON.parse(message.content); if (!result || typeof result !== "object") throw new Error(); return result; }
  catch { throw new Error("Local Ollama returned invalid JSON. No result was applied."); }
}
