// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({find:vi.fn(),upsert:vi.fn(),lock:vi.fn()}));
vi.mock("@/lib/db",()=>({db:{appSetting:{findUnique:m.find},$transaction:async(fn:any)=>fn({$executeRaw:m.lock,appSetting:{findUnique:m.find,upsert:m.upsert}})}}));
import {getOllamaSettings,getPublicOllamaSettings,saveOllamaSettings} from "@/lib/ai/ollama-settings";
import {ollamaSettingsInputSchema,validateOllamaBaseUrl} from "@/lib/ai/ollama-settings-schema";
import {getResolvedAiConfiguration,getResolvedVisionProviderConfiguration} from "@/lib/ai/config";
let stored:any;
const settings={baseUrl:"http://ollama:11434",textModel:"llama3.2:3b",visionModel:"gemma3:4b",useForText:true,contextTokens:4096,inferenceTimeoutSeconds:180,keepAliveMinutes:5};
beforeEach(()=>{vi.resetAllMocks();stored=null;m.find.mockImplementation(async()=>stored?{value:stored}:null);m.upsert.mockImplementation(async({update})=>{stored=update.value;return{value:stored}});vi.stubEnv("ENCRYPTION_KEY","1".repeat(64));vi.stubEnv("OLLAMA_BASE_URL","");vi.stubEnv("OLLAMA_API_KEY","");vi.stubEnv("OLLAMA_TEXT_MODEL","");vi.stubEnv("OLLAMA_VISION_MODEL","");vi.stubEnv("AI_TEXT_PROVIDER","anthropic");});
afterEach(()=>vi.unstubAllEnvs());
it("uses environment only before configuration is saved",async()=>{vi.stubEnv("OLLAMA_BASE_URL","http://127.0.0.1:11434");vi.stubEnv("AI_TEXT_PROVIDER","ollama");expect(await getOllamaSettings()).toMatchObject({baseUrl:"http://127.0.0.1:11434",useForText:true,contextTokens:4096});await saveOllamaSettings(settings);expect(await getOllamaSettings()).toMatchObject(settings);});
it("encrypts secrets, preserves blank edits and explicitly clears without exposing them",async()=>{const publicValue=await saveOllamaSettings({...settings,apiKey:"secret-token"});expect(publicValue).toEqual({...settings,hasApiKey:true});expect(JSON.stringify(stored)).not.toContain("secret-token");expect(stored.encryptedApiKey).toBeTruthy();expect((await getOllamaSettings()).apiKey).toBe("secret-token");const encrypted=stored.encryptedApiKey;await saveOllamaSettings({...settings,apiKey:""});expect(stored.encryptedApiKey).toBe(encrypted);await saveOllamaSettings({...settings,clearApiKey:true});expect(await getPublicOllamaSettings()).toMatchObject({hasApiKey:false});expect((await getOllamaSettings()).apiKey).toBeNull();});
it("explicit clear suppresses environment credential fallback",async()=>{vi.stubEnv("OLLAMA_API_KEY","environment-secret");await saveOllamaSettings(settings);expect((await getOllamaSettings()).apiKey).toBe("environment-secret");await saveOllamaSettings({...settings,clearApiKey:true});expect((await getOllamaSettings()).apiKey).toBeNull();});
it("fails closed if persisted credential is plaintext or encryption key unavailable",async()=>{stored={...settings,encryptedApiKey:"plaintext"};await expect(getOllamaSettings()).rejects.toThrow("decrypted");await saveOllamaSettings({...settings,apiKey:"secret-token"});vi.stubEnv("ENCRYPTION_KEY","");await expect(getOllamaSettings()).rejects.toThrow("decrypted");});
it("never writes a plaintext key when encryption configuration is missing",async()=>{vi.stubEnv("ENCRYPTION_KEY","");await expect(saveOllamaSettings({...settings,apiKey:"secret"})).rejects.toThrow();expect(m.upsert).not.toHaveBeenCalled();});
it.each(["https://public.example.com","http://8.8.8.8:11434","http://user:pass@localhost:11434","http://localhost:11434?x=1","http://169.254.169.254","file:///tmp"])("rejects external or unsafe endpoint %s",value=>{expect(validateOllamaBaseUrl(value)).toBe(false);expect(ollamaSettingsInputSchema.safeParse({...settings,baseUrl:value}).success).toBe(false);});
it.each(["http://localhost:11434","http://ollama:11434","http://10.0.0.2:11434","http://[::1]:11434","http://[fd00::1]:11434"])("allows internal endpoint %s",value=>expect(validateOllamaBaseUrl(value)).toBe(true));
it.each([{contextTokens:999999},{inferenceTimeoutSeconds:301},{keepAliveMinutes:31},{visionModel:"gemma3:cloud"},{apiKey:"new",clearApiKey:true}])("rejects unsafe settings %#",async patch=>{await expect(saveOllamaSettings({...settings,...patch})).rejects.toThrow();expect(m.upsert).not.toHaveBeenCalled();});
it("resolves stored text and vision models with no secret disclosure",async()=>{await saveOllamaSettings({...settings,apiKey:"private"});expect(await getResolvedAiConfiguration()).toEqual({provider:"ollama",model:settings.textModel,configured:true});expect(await getResolvedVisionProviderConfiguration("ollama")).toEqual({provider:"ollama",model:settings.visionModel,configured:true});});
it("does not switch to a paid provider when stored local text is turned off",async()=>{vi.stubEnv("AI_TEXT_PROVIDER","ollama");vi.stubEnv("ANTHROPIC_API_KEY","cloud-secret");await saveOllamaSettings({...settings,useForText:false});expect(await getResolvedAiConfiguration()).toMatchObject({provider:"ollama",configured:false});});
it("public settings remain readable for credential replacement when decryption fails",async()=>{
  await saveOllamaSettings({...settings,apiKey:"secret-token"});vi.stubEnv("ENCRYPTION_KEY","");
  expect(await getPublicOllamaSettings()).toEqual({...settings,hasApiKey:true});await expect(getOllamaSettings()).rejects.toThrow("decrypted");
  expect(await saveOllamaSettings({...settings,clearApiKey:true})).toMatchObject({hasApiKey:false});expect((await getOllamaSettings()).apiKey).toBeNull();
});
it.each(["openai","anthropic"])("keeps configured %s usable when an unused Ollama credential cannot decrypt",async provider=>{
  await saveOllamaSettings({...settings,useForText:false,apiKey:"local-secret"});vi.stubEnv("ENCRYPTION_KEY","");vi.stubEnv("AI_TEXT_PROVIDER",provider);vi.stubEnv("OPENAI_API_KEY","cloud-openai");vi.stubEnv("ANTHROPIC_API_KEY","cloud-anthropic");
  expect(await getResolvedAiConfiguration()).toMatchObject({provider,configured:true});await expect(getOllamaSettings()).rejects.toThrow("decrypted");
});
