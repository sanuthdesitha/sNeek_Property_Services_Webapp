"use client";
import { useEffect, useRef, useState } from "react";
import { EBadge, EButton, ECard } from "@/components/v2/ui/primitives";
import { EField, EInput, ESectionHeading } from "./estate-form";

type Settings = { baseUrl: string; textModel: string; visionModel: string; useForText: boolean; contextTokens: number; inferenceTimeoutSeconds: number; keepAliveMinutes: number; hasApiKey: boolean };
type Check = "connection" | "text" | "assignment" | "comparison";
type Result = { ok: boolean; check: Check; message: string; checkedAt: string; durationMs: number; models?: { name: string; size: number }[]; running?: { name: string; size: number; sizeVram: number }[]; version?: string };
const checks: { key: Check; label: string; description: string }[] = [
 { key: "connection", label: "Connection", description: "Reach the saved Ollama server and list installed models." },
 { key: "text", label: "Text model", description: "Ask the selected text model for a small structured response." },
 { key: "assignment", label: "Photo assignment", description: "Check the vision model with synthetic section-matching images." },
 { key: "comparison", label: "Photo comparison", description: "Check the vision model with synthetic reference and inspection images." },
];
const defaults: Settings = { baseUrl: "", textModel: "", visionModel: "", useForText: false, contextTokens: 4096, inferenceTimeoutSeconds: 180, keepAliveMinutes: 5, hasApiKey: false };
const bytes = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GB`;

export function OllamaSection() {
 const [saved, setSaved] = useState<Settings | null>(null), [draft, setDraft] = useState<Settings>(defaults);
 const [apiKey, setApiKey] = useState(""), [clearApiKey, setClearApiKey] = useState(false);
 const [busy, setBusy] = useState("Loading settings"), [error, setError] = useState(""), [notice, setNotice] = useState("");
 const [results, setResults] = useState<Partial<Record<Check, Result>>>({});
 const [downloadModel, setDownloadModel] = useState(""), [progress, setProgress] = useState<{ status: string; completed?: number; total?: number } | null>(null);
 const operation = useRef(false), controller = useRef<AbortController | null>(null), mounted = useRef(true);
 const dirty = saved !== null && (JSON.stringify(saved) !== JSON.stringify(draft) || !!apiKey || clearApiKey);
 async function request(path: string, init?: RequestInit) {
  const abort = new AbortController(); controller.current = abort;
  const timeout = setTimeout(() => abort.abort(), 360_000);
  try { const response = await fetch(path, { ...init, signal: abort.signal, cache: "no-store" }); const body = await response.json(); if (!response.ok) throw new Error(body.error || "The request could not be completed."); return body; }
  finally { clearTimeout(timeout); if (controller.current === abort) controller.current = null; }
 }
 async function run(label: string, task: () => Promise<void>) {
  if (operation.current) return;
  operation.current = true; setBusy(label); setError(""); setNotice("");
  try { await task(); } catch (failure) { if (mounted.current) setError(failure instanceof Error && failure.name !== "AbortError" ? failure.message : "The request timed out or was interrupted. Check the server before retrying."); }
  finally { operation.current = false; if (mounted.current) setBusy(""); }
 }
 async function load() { await run("Loading settings", async () => { const body = await request("/api/admin/ai/ollama"); if (!body.settings) throw new Error("Settings unavailable."); if (mounted.current) { setSaved(body.settings); setDraft(body.settings); } }); }
 useEffect(() => { mounted.current = true; const start = setTimeout(() => void load(), 0); return () => { clearTimeout(start); mounted.current = false; controller.current?.abort(); }; }, []);
 function edit<K extends keyof Settings>(key: K, value: Settings[K]) { setDraft(old => ({ ...old, [key]: value })); setResults({}); setNotice(""); setProgress(null); }
 async function save() { await run("Saving settings", async () => { const body = await request("/api/admin/ai/ollama", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...draft, hasApiKey: undefined, apiKey: apiKey || undefined, clearApiKey }) }); if (!body.settings) throw new Error("Save was not confirmed. Reload settings before retrying."); setSaved(body.settings); setDraft(body.settings); setApiKey(""); setClearApiKey(false); setResults({}); setNotice("Settings saved. Run checks to verify this configuration."); }); }
 async function checkOne(check: Check) {
  setBusy(`Checking ${checks.find(row => row.key === check)!.label.toLowerCase()}`);
  try {
   const result = await request("/api/admin/ai/ollama/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ check }) });
   if (typeof result.ok !== "boolean" || result.check !== check || typeof result.message !== "string") throw new Error("The server returned an incomplete diagnostic result.");
   setResults(old => ({ ...old, [check]: result }));
  } catch (failure) { setResults(old => ({ ...old, [check]: { check, ok: false, message: failure instanceof Error && failure.name !== "AbortError" ? failure.message : "Check timed out or was interrupted.", checkedAt: new Date().toISOString(), durationMs: 0 } })); }
 }
 async function check(selected: Check[]) { if (dirty || !saved) return; await run("Checking", async () => { setResults(old => { const next = { ...old }; selected.forEach(key => delete next[key]); return next; }); for (const key of selected) { if (!mounted.current) break; await checkOne(key); } }); }
 async function pull() {
  if (dirty || !saved || !downloadModel.trim()) return;
  await run("Downloading model", async () => {
   setProgress({ status: "Starting download…" }); setResults({});
   const abort = new AbortController(); controller.current = abort;
   const timeout = setTimeout(() => abort.abort(), 1_800_000);
   let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
   try {
    const response = await fetch("/api/admin/ai/ollama/pull", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: downloadModel.trim() }), signal: abort.signal });
    if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || "Model download could not start."); }
    if (!response.body) throw new Error("Download progress unavailable.");
    reader = response.body.getReader(); const decoder = new TextDecoder(); let pending = "", success = false;
    const consume = (line: string) => { if (!line.trim()) return; const event = JSON.parse(line); if (event.error) throw new Error(event.error); if (typeof event.status !== "string") throw new Error("Invalid download progress."); setProgress(event); if (event.status === "success") success = true; }
    while (true) { const chunk = await reader.read(); if (chunk.done) break; pending += decoder.decode(chunk.value, { stream: true }); if (pending.length > 1_000_000) throw new Error("Download progress exceeded the expected size."); const lines = pending.split("\n"); pending = lines.pop()!; lines.forEach(consume); }
    pending += decoder.decode(); consume(pending);
    if (!success) throw new Error("Download completion was not confirmed. Check installed models before retrying.");
    setNotice("Model downloaded. Installed models refreshed below; run model checks before using it.");
   } finally { clearTimeout(timeout); await reader?.cancel().catch(() => {}); if (controller.current === abort) controller.current = null; }
   await checkOne("connection");
  });
 }
 const locked = !!busy;
 const connection = results.connection;
 const passed = checks.filter(row => results[row.key]?.ok).length;
 return <div className="min-w-0 space-y-5 [&_input:not([type=checkbox])]:min-h-11 [&_button]:min-h-11">
  <ESectionHeading eyebrow="Local AI" title="Ollama" description="Connect your own model server, download models and check each workflow before enabling it." />
  <ECard className="space-y-3 p-4 sm:p-6">
   <h3 className="font-semibold">1. Start your model server</h3>
   <p className="text-sm leading-relaxed text-[hsl(var(--e-muted-foreground))]">Ollama must already be running as a Docker service or on your server. This page configures the app; it cannot install Docker or start a server.</p>
   <details><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Hostinger / Docker network setup</summary><div className="space-y-2 text-sm leading-relaxed text-[hsl(var(--e-muted-foreground))]"><p>Ask your server administrator to add the Ollama service to the same private Docker network as this web app, with persistent model storage. The app can then use a service address such as <code className="break-all">http://sneek-ollama:11434</code>.</p><p>Inside Docker, localhost points to the web app container, not another container. Keep the Ollama port private; use your protected gateway key only if one is required. Set OLLAMA_NO_CLOUD=1 on the Ollama service to disable cloud features.</p><p>Model downloads need server disk space and internet access. Larger models need more memory and can be slow on CPU-only servers.</p></div></details>
  </ECard>
  {error ? <p role="alert" className="rounded-[var(--e-radius)] border border-[hsl(var(--e-danger))] p-4 text-sm text-[hsl(var(--e-danger))]">{error}</p> : null}
  {notice ? <p role="status" className="rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-raised))] p-3 text-sm">{notice}</p> : null}
  {busy ? <p role="status" className="text-sm text-[hsl(var(--e-muted-foreground))]">{busy}…</p> : null}
  {!saved ? <EButton variant="outline" disabled={locked} onClick={() => void load()}>Reload settings</EButton> : <>
   <ECard className="space-y-5 p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">2. Connection and models</h3><EBadge soft tone={dirty ? "warning" : "neutral"}>{dirty ? "Unsaved changes" : "Saved configuration"}</EBadge></div>
    <fieldset disabled={locked} className="min-w-0 space-y-4">
     <EField label="Ollama server address" htmlFor="ollama-url" hint="An address reachable by the web app server."><EInput id="ollama-url" value={draft.baseUrl} onChange={e => edit("baseUrl", e.target.value)} placeholder="http://sneek-ollama:11434" /></EField>
     <div className="grid min-w-0 gap-4 sm:grid-cols-2"><EField label="Text model" htmlFor="ollama-text"><EInput id="ollama-text" value={draft.textModel} onChange={e => edit("textModel", e.target.value)} placeholder="Model name and tag" /></EField><EField label="Vision model" htmlFor="ollama-vision" hint="Choose a model with image support, such as gemma3:4b."><EInput id="ollama-vision" value={draft.visionModel} onChange={e => edit("visionModel", e.target.value)} placeholder="gemma3:4b" /></EField></div>
     <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5" checked={draft.useForText} onChange={e => edit("useForText", e.target.checked)} />Use Ollama for text generation</label>
     <EField label="Gateway API key (optional)" htmlFor="ollama-key" hint={saved.hasApiKey ? "A key is stored. Leave blank to keep it." : "Leave blank if the private server does not require a key."}><EInput id="ollama-key" type="password" autoComplete="new-password" value={apiKey} disabled={clearApiKey} onChange={e => { setApiKey(e.target.value); setResults({}); setNotice(""); setProgress(null); }} /></EField>
     {saved.hasApiKey ? <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5" checked={clearApiKey} onChange={e => { setClearApiKey(e.target.checked); setApiKey(""); setResults({}); setNotice(""); setProgress(null); }} />Remove stored gateway key when saving</label> : null}
     <details><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Model performance settings</summary><div className="grid gap-4 sm:grid-cols-3">{([{ key: "contextTokens", label: "Context tokens", min: 1024, max: 32768 }, { key: "inferenceTimeoutSeconds", label: "Inference timeout (seconds)", min: 30, max: 300 }, { key: "keepAliveMinutes", label: "Keep model loaded (minutes)", min: 0, max: 30 }] as const).map(field => <EField key={field.key} label={field.label} htmlFor={`ollama-${field.key}`}><EInput id={`ollama-${field.key}`} type="number" min={field.min} max={field.max} step={1} value={draft[field.key]} onChange={e => edit(field.key, Number(e.target.value))} /></EField>)}</div></details>
    </fieldset>
    <EButton disabled={locked || !dirty} onClick={() => void save()}>Save Ollama settings</EButton>
   </ECard>
   <ECard className="space-y-4 p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">3. Verify saved settings</h3><EButton variant="outline" disabled={locked || dirty} onClick={() => void check(checks.map(row => row.key))}>Check all</EButton></div>
    <p className="text-sm text-[hsl(var(--e-muted-foreground))]">{dirty ? "Save your changes before running checks or downloading models." : `${passed} of 4 checks passed for the saved settings. Checks run independently; a failed check does not skip the next one.`} Test images are synthetic. These checks validate the connection and response format, not accuracy on real property photos. They do not change jobs or QA scores.</p>
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">{checks.map(row => { const result = results[row.key]; return <section key={row.key} className="min-w-0 space-y-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-medium">{row.label}</h4><EBadge soft tone={!result ? "neutral" : result.ok ? "success" : "danger"}>{!result ? "Not checked" : result.ok ? "Passed" : "Failed"}</EBadge></div><p className="text-xs leading-relaxed text-[hsl(var(--e-muted-foreground))]">{row.description}</p>{result ? <p className="break-words text-sm" role={result.ok ? undefined : "alert"}>{result.message}</p> : null}{result?.checkedAt ? <p className="text-xs text-[hsl(var(--e-muted-foreground))]">{new Date(result.checkedAt).toLocaleString()} · {(result.durationMs / 1000).toFixed(1)}s</p> : null}<EButton variant="outline" disabled={locked || dirty} onClick={() => void check([row.key])}>Check {row.label.toLowerCase()}</EButton></section>; })}</div>
    {connection?.models ? <div className="space-y-2 text-sm"><h4 className="font-medium">Installed models{connection.version ? ` · Ollama ${connection.version}` : ""}</h4>{connection.models.length ? connection.models.map(model => <p key={model.name} className="break-all">{model.name} · {bytes(model.size)}</p>) : <p>No installed models reported.</p>}<h4 className="pt-2 font-medium">Currently loaded</h4>{connection.running?.length ? connection.running.map(model => <p key={model.name} className="break-all">{model.name} · {bytes(model.size)} total · {bytes(model.sizeVram)} GPU</p>) : <p>No running models reported.</p>}</div> : null}
   </ECard>
   <ECard className="space-y-4 p-4 sm:p-6"><h3 className="font-semibold">4. Download a model</h3><p className="text-sm text-[hsl(var(--e-muted-foreground))]">This downloads model files to your saved Ollama server. It does not switch the selected models or train a property classifier.</p><EField label="Model to download" htmlFor="ollama-download"><EInput id="ollama-download" value={downloadModel} disabled={locked} onChange={e => setDownloadModel(e.target.value)} placeholder="gemma3:4b" /></EField><EButton variant="outline" disabled={locked || dirty || !downloadModel.trim()} onClick={() => void pull()}>Download model</EButton>{progress ? <div role="status" className="space-y-2 text-sm"><p className="break-words">{progress.status}</p>{typeof progress.total === "number" && progress.total > 0 && typeof progress.completed === "number" ? <><progress className="h-2 w-full" max={progress.total} value={Math.min(progress.completed, progress.total)} aria-label="Model download progress" /><p>{Math.min(100, Math.round(progress.completed / progress.total * 100))}% · {bytes(progress.completed)} / {bytes(progress.total)}</p></> : null}</div> : null}</ECard>
   <p className="text-sm leading-relaxed text-[hsl(var(--e-muted-foreground))]"><a className="inline-flex min-h-11 items-center font-medium underline" href="/v2/admin/ai">Open AI workflow settings</a> to enable photo assignment or comparison. The dedicated property classifier is a separate service; Ollama does not train it.</p>
  </>}
 </div>;
}
