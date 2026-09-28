import { z } from "zod";
/** Browser-safe equivalent of the transport's internal-address restriction. */
export function validateOllamaBaseUrl(raw: string): boolean {
  try {
    if (!raw || /[\\\u0000-\u0020]/.test(raw)) return false;
    const url = new URL(raw), host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const parts = host.split("."); const ipv4 = parts.length === 4 && parts.every(part => /^\d+$/.test(part) && Number(part) <= 255);
    const octets = parts.map(Number);
    const privateV4 = ipv4 && (octets[0] === 127 || octets[0] === 10 || (octets[0] === 192 && octets[1] === 168) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31));
    const privateV6 = host.includes(":") && (host === "::1" || /^(fc|fd)/.test(host));
    const internalName = /^[a-z][a-z0-9-]*$/.test(host);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && (privateV4 || privateV6 || internalName);
  } catch { return false; }
}
const localModel = z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9._/-]*(?::[a-zA-Z0-9._-]+)?$/).refine(value => !value.split("/").some(part => part === "." || part === "..") && !/(?:^|[:/_-])cloud(?:$|[:/_-])/i.test(value), "Choose an installed local model, not a cloud model.");
export const ollamaSettingsSchema = z.object({
  baseUrl: z.string().trim().max(2048).refine(value => value === "" || validateOllamaBaseUrl(value), "Use an internal Ollama server address."),
  textModel: localModel.default("gemma3:4b"), visionModel: localModel.default("gemma3:4b"), useForText: z.boolean().default(false),
  contextTokens: z.number().int().min(1024).max(32768).default(4096),
  inferenceTimeoutSeconds: z.number().int().min(30).max(300).default(180), keepAliveMinutes: z.number().int().min(0).max(30).default(5),
}).strict();
export const ollamaSettingsInputSchema = ollamaSettingsSchema.extend({ apiKey: z.string().trim().max(4096).optional(), clearApiKey: z.boolean().optional() }).strict().refine(value => !(value.apiKey && value.clearApiKey), "Choose a new key or remove the existing key, not both.");
export type OllamaSettings = z.infer<typeof ollamaSettingsSchema>;
export type PublicOllamaSettings = OllamaSettings & { hasApiKey: boolean };
