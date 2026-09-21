"use client";
import { useState } from "react";
import { visionSettingsSchema, type VisionSettings } from "@/lib/ai/vision-settings-schema";

export function VisionSettingsPanel({ initialSettings, canEdit, configured, providerConfigured, providerModels, recognitionConfigured = false }: { initialSettings: VisionSettings; canEdit: boolean; configured: boolean; providerConfigured?: Partial<Record<VisionSettings["provider"], boolean>>; providerModels?: Partial<Record<VisionSettings["provider"], string>>; recognitionConfigured?: boolean }) {
  const [settings, setSettings] = useState(initialSettings);
  const [saved, setSaved] = useState(initialSettings);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [connection, setConnection] = useState("Not tested");
  const dirty = JSON.stringify(settings) !== JSON.stringify(saved);
  const selectedConfigured = providerConfigured?.[settings.provider] ?? (settings.provider === initialSettings.provider && configured);
  const providerName = settings.provider === "ollama" ? "Ollama" : settings.provider === "openai" ? "OpenAI" : "Anthropic";
  const credentialName = settings.provider === "ollama" ? "OLLAMA_BASE_URL" : settings.provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
  async function save() {
    if (!visionSettingsSchema.safeParse(settings).success) { setMessage("Check the limits shown beside each setting."); return; }
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin/ai/vision", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Settings were not saved.");
      const next = visionSettingsSchema.parse(result.settings);
      setSettings(next); setSaved(next); setConnection("Not tested"); setMessage("Vision settings saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Settings were not saved."); }
    finally { setBusy(false); }
  }
  async function check() {
    setBusy(true); setConnection("Checking saved model…");
    try {
      const response = await fetch("/api/admin/ai/vision/check", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Connection check failed.");
      setConnection(`${result.message} Model: ${result.model}`);
    } catch (error) { setConnection(error instanceof Error ? error.message : "Connection check failed."); }
    finally { setBusy(false); }
  }
  return <section className="space-y-4 rounded-xl border p-5" aria-labelledby="vision-settings-title">
    <h2 id="vision-settings-title" className="text-lg font-semibold">Photo analysis</h2>
    <p className="text-sm">Enabled features send authorized property photos to the selected provider. Reference comparison proposes deductions for QA/admin approval; scores never change automatically.</p>
    <p className="text-sm">{providerName} uses the server-only {credentialName}. {selectedConfigured ? "Server configuration is present; connection has not been verified." : "Add this setting to your hosting environment and restart the app."}</p>
    {settings.provider === "ollama" && <p className="text-sm">Run a vision-capable model on your own Ollama server. Photos go to that server; failures never switch to a paid provider. Install the selected model before checking. Previous property examples help recognition without retraining the base model.</p>}
    {settings.provider === "openai" ? <p className="text-sm">Connect using an OpenAI API project key, not your ChatGPT login. Previous property photos are supplied as examples during analysis. You can use OpenAI without the separate dedicated recognition service.</p> : null}
    {!canEdit && <p className="text-sm">Only administrators can change these settings or check the provider.</p>}
    <fieldset disabled={!canEdit || busy} className="space-y-4">
      <label className="block">Photo analysis provider<select className="mt-1 block min-h-11 w-full rounded border p-2" value={settings.provider} onChange={event => { const provider = event.target.value as VisionSettings["provider"]; setSettings({ ...settings, provider, model: providerModels?.[provider] ?? (provider === "ollama" ? "gemma3:4b" : provider === "openai" ? "gpt-4.1" : "claude-sonnet-5") }); setConnection("Not tested"); }}><option value="openai">OpenAI (GPT)</option><option value="anthropic">Anthropic (Claude)</option><option value="ollama">Ollama (local server)</option></select></label>
      <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={settings.comparisonEnabled} onChange={(event) => setSettings({ ...settings, comparisonEnabled: event.target.checked })} />Compare submitted photos with references</label>
      <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={settings.assignmentEnabled} onChange={(event) => setSettings({ ...settings, assignmentEnabled: event.target.checked })} />Suggest bulk photo assignments</label>
      <label className="flex min-h-11 items-center gap-3"><input type="checkbox" disabled={!settings.assignmentEnabled} checked={settings.historicalAssignmentExamplesEnabled} onChange={(event) => setSettings({ ...settings, historicalAssignmentExamplesEnabled: event.target.checked })} />Use prior photos from the same property to recognize rooms</label>
      <p className="text-sm">When photo assignment is enabled, a small recent sample of previously submitted photos can help distinguish rooms and sections. These location examples do not retrain the base model and are never cleanliness standards for QA comparison.</p>
      <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={settings.dedicatedRecognitionEnabled} onChange={(event) => setSettings({ ...settings, dedicatedRecognitionEnabled: event.target.checked })} />Train and use dedicated property recognition</label>
      <p className="text-sm">Requires the separately deployed model service. Enabling this transfers eligible property photos to that service to train a property-specific classifier. New submissions update its training library; only versions passing held-out job validation become active. Recognition suggests locations and never changes QA scores.</p>
      <p className="text-sm">{recognitionConfigured ? "Dedicated service credentials are configured; connectivity and trained model quality are not verified here." : "Set MODEL_SERVICE_URL and MODEL_SERVICE_TOKEN on the server before enabling dedicated recognition."}</p>
      <label className="block">Vision model<input className="mt-1 block min-h-11 w-full rounded border p-2" value={settings.model} onChange={(event) => { setSettings({ ...settings, model: event.target.value }); setConnection("Not tested"); }} /></label>
      <div className="grid gap-4 sm:grid-cols-3">
        <label>Photos per batch (1–8)<input aria-label="Photos per batch" type="number" min={1} max={8} step={1} className="mt-1 block min-h-11 w-full rounded border p-2" value={settings.batchSize} onChange={(event) => setSettings({ ...settings, batchSize: Number(event.target.value) })} /></label>
        <label>Minimum confidence (0–1)<input aria-label="Minimum confidence" type="number" min={0} max={1} step={0.05} className="mt-1 block min-h-11 w-full rounded border p-2" value={settings.minConfidence} onChange={(event) => setSettings({ ...settings, minConfidence: Number(event.target.value) })} /></label>
        <label>Maximum proposed deduction (0–20 points)<input aria-label="Maximum proposed deduction" type="number" min={0} max={20} step={1} className="mt-1 block min-h-11 w-full rounded border p-2" value={settings.maxScoreContribution} onChange={(event) => setSettings({ ...settings, maxScoreContribution: Number(event.target.value) })} /></label>
      </div>
      <div className="flex flex-wrap gap-3"><button type="button" className="min-h-11 rounded border px-4" onClick={save}>Save vision settings</button><button type="button" disabled={dirty || !selectedConfigured} className="min-h-11 rounded border px-4" onClick={check}>Check provider and saved model</button></div>
    </fieldset>
    <p className="text-sm">The connection check reads model availability only; it sends no photos and runs no image analysis. Save model changes before checking.</p>
    <p role="status">{message}</p><p aria-live="polite">{connection}</p>
  </section>;
}
