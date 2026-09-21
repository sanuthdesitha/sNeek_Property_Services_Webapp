import "server-only";
import { isIP } from "node:net";
import type { VisionImage } from "./vision";

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
function localModel(value: string) {
  if (!value || value.length > 200 || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]*(?::[a-zA-Z0-9._-]+)?$/.test(value) || value.split("/").some(part => part === "." || part === "..") || /(?:^|[:/_-])cloud(?:$|[:/_-])/i.test(value)) throw new Error("Choose an installed local Ollama model. Cloud models are unavailable.");
  return value;
}
function remote(value: Record<string, unknown>) { return Boolean(value.remote_host || value.remote_model); }
async function post(path: "show" | "chat", body: unknown) {
  try {
    const key = process.env.OLLAMA_API_KEY?.trim();
    const response = await fetch(`${endpoint()}/api/${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body), redirect: "error", cache: "no-store", signal: AbortSignal.timeout(path === "show" ? 8_000 : 45_000) });
    if (!response.ok || response.redirected || !response.body || Number(response.headers.get("content-length")) > 1024 * 1024) { await response.body?.cancel().catch(() => undefined); throw new Error("Unavailable"); }
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let size = 0, text = "";
    try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > 1024 * 1024) throw new Error("Oversized result"); text += decoder.decode(chunk.value, { stream: true }); } text += decoder.decode(); }
    finally { await reader.cancel().catch(() => undefined); }
    const result: unknown = JSON.parse(text);
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Malformed result");
    const object = result as Record<string, unknown>;
    if (object.error || remote(object)) throw new Error("Remote or invalid model");
    return object;
  } catch { throw new Error("Local Ollama could not complete the request. Check the server and installed model; no cloud fallback was used."); }
}
async function show(model: string, requireVision: boolean) {
  const checked = localModel(model);
  const info = await post("show", { model: checked, verbose: false });
  const capabilities = info.capabilities;
  if (!Array.isArray(capabilities) || !capabilities.includes("completion") || (requireVision && !capabilities.includes("vision"))) throw new Error(requireVision ? "The installed Ollama model does not support image analysis." : "The installed Ollama model does not support text generation.");
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
  const info = await show(input.model, input.images.length > 0);
  const details = info.details as { family?: unknown; families?: unknown } | undefined;
  const families = [details?.family, ...(Array.isArray(details?.families) ? details.families : [])];
  if (input.images.length > 1 && families.includes("mllama")) throw new Error("This Ollama model supports only one image. Choose a model supporting multiple images.");
  const ordering = input.images.map((image, index) => ({ imageNumber: index + 1, id: image.id }));
  const response = await post("chat", { model: input.model, stream: false, format: input.schema, options: { temperature: 0, num_predict: 4096 }, messages: [
    { role: "system", content: input.instructions + " Return only JSON matching the supplied schema." },
    { role: "user", content: input.prompt + (ordering.length ? "\nImage identifiers in attachment order: " + JSON.stringify(ordering) : ""), ...(input.images.length ? { images: input.images.map(image => image.data) } : {}) },
  ] });
  const message = response.message as { role?: unknown; content?: unknown; tool_calls?: unknown } | undefined;
  if (response.done !== true || response.done_reason !== "stop" || typeof response.model !== "string" || !message || message.role !== "assistant" || typeof message.content !== "string" || (Array.isArray(message.tool_calls) && message.tool_calls.length)) throw new Error("Local Ollama returned an incomplete result. No result was applied.");
  localModel(response.model);
  try { const result: unknown = JSON.parse(message.content); if (!result || typeof result !== "object") throw new Error(); return result; }
  catch { throw new Error("Local Ollama returned invalid JSON. No result was applied."); }
}
