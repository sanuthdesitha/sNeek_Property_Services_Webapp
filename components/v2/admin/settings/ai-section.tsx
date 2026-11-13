"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { EAlert, EBadge, EButton, ECard } from "@/components/v2/ui/primitives";
import { EField, EInput, ESectionHeading, ESelectNative } from "./estate-form";
import {
  AI_FEATURE_CATALOG, AI_FEATURES, AI_PROVIDER_KINDS, AI_PROVIDER_LABELS, aiRoutingSchema,
  type AiFeature, type AiModelPrice, type AiProviderKind, type AiRoute, type AiRoutingSettings,
} from "@/lib/ai/provider/routing-schema";

type SecretProvider = "anthropic" | "openai" | "openai_compatible";
type CredentialState = { provider: SecretProvider; state: "saved" | "environment" | "cleared" | "missing" | "unreadable"; hint: string | null };
type RouteRow = { feature: AiFeature; provider: string | null; model: string | null; configured: boolean; enabled: boolean; cloud: boolean; allowImages: boolean; source: string | null; error: string | null };
type UsageRow = { feature: string; provider: string; model: string; calls: number; succeeded: number; failed: number; refused: number; inputTokens: number; outputTokens: number; knownCostMicroUsd: number; unknownCostCalls: number };
type Usage = { monthLabel: string; timezone: string; rows: UsageRow[] };
type ScreenState = { routing: AiRoutingSettings; credentials: CredentialState[]; routes: RouteRow[]; usage: Usage | null; encryptionReady: boolean };
type TestState = { status: "queued" | "running" | "passed" | "failed" | "error"; message: string; taskId?: string };

const SECRET_LABELS: Record<SecretProvider, string> = { anthropic: "Anthropic Claude", openai: "OpenAI", openai_compatible: "OpenAI-compatible endpoint" };
const CREDENTIAL_TEXT: Record<CredentialState["state"], string> = {
  saved: "Key saved (encrypted)",
  environment: "Using the server environment key",
  cleared: "Removed",
  missing: "No key",
  unreadable: "Saved key cannot be read: enter it again",
};
const SOURCE_TEXT: Record<string, string> = {
  feature: "set for this feature",
  default: "default provider",
  "photo-settings": "photo provider in AI workflow settings",
  environment: "server environment",
};
const DEFAULT_MODELS: Record<AiProviderKind, string> = { anthropic: "claude-sonnet-5", openai: "gpt-4.1", openai_compatible: "", ollama: "gemma3:4b" };

type Draft = Omit<AiRoutingSettings, "revision">;
function toDraft(routing: AiRoutingSettings): Draft {
  const { revision: _revision, ...rest } = routing;
  return rest;
}

function money(micro: number): string {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(micro / 1_000_000);
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

export function AiSection() {
  const [state, setState] = useState<ScreenState | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [revision, setRevision] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(null);
  const [conflict, setConflict] = useState<AiRoutingSettings | null>(null);
  const [tests, setTests] = useState<Partial<Record<AiFeature, TestState>>>({});
  const mounted = useRef(true);
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const response = await fetch("/api/admin/ai/settings", { cache: "no-store" });
      const body = await readJson(response);
      if (!mounted.current) return;
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "AI settings could not be loaded.");
      const next = body as unknown as ScreenState;
      setState(next);
      setDraft(toDraft(next.routing));
      setRevision(next.routing.revision);
    } catch (error) {
      if (mounted.current) setLoadError(error instanceof Error ? error.message : "AI settings could not be loaded.");
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const pending = timers.current;
    void load();
    return () => {
      mounted.current = false;
      pending.forEach((timer) => clearTimeout(timer));
      pending.clear();
    };
  }, [load]);

  if (loadError && !state) {
    return <EAlert tone="danger" title="AI settings unavailable">{loadError} <button type="button" className="underline" onClick={() => void load()}>Retry</button></EAlert>;
  }
  if (!state || !draft) return <p role="status" className="text-sm">Loading AI settings…</p>;

  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(state.routing));
  const valid = aiRoutingSchema.safeParse({ ...draft, revision }).success;

  function updateFeature(feature: AiFeature, patch: Partial<Draft["features"][AiFeature]>) {
    setDraft((old) => (old ? { ...old, features: { ...old.features, [feature]: { ...old.features[feature], ...patch } } } : old));
    setMessage(null);
  }

  async function save(useRevision = revision) {
    if (!draft) return;
    setSaving(true); setMessage(null);
    try {
      const response = await fetch("/api/admin/ai/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: useRevision, settings: draft }) });
      const body = await readJson(response);
      if (!mounted.current) return;
      if (response.status === 409 && body.current) {
        setConflict(body.current as AiRoutingSettings);
        setMessage({ tone: "warning", text: "Someone saved AI settings after you opened them. Your changes are kept below; choose what to do." });
        return;
      }
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "AI settings were not saved.");
      const next = body as unknown as ScreenState;
      setState(next); setDraft(toDraft(next.routing)); setRevision(next.routing.revision); setConflict(null);
      setMessage({ tone: "success", text: "AI settings saved. They apply to the next request." });
    } catch (error) {
      if (mounted.current) setMessage({ tone: "danger", text: error instanceof Error ? error.message : "AI settings were not saved." });
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  function poll(feature: AiFeature, taskId: string, attempt: number) {
    const timer = setTimeout(async () => {
      timers.current.delete(timer);
      try {
        const response = await fetch(`/api/admin/ai/tests/${encodeURIComponent(taskId)}`, { cache: "no-store" });
        const body = await readJson(response);
        if (!mounted.current) return;
        if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "The test status could not be read.");
        const task = body.task as { status: string; result: { ok: boolean; message: string; provider: string; model: string; durationMs: number } | null; error: string | null };
        if (task.status === "SUCCEEDED" && task.result) {
          setTests((old) => ({ ...old, [feature]: { status: "passed", taskId, message: `${task.result!.message} ${task.result!.provider} · ${task.result!.model} · ${(task.result!.durationMs / 1000).toFixed(1)} s` } }));
        } else if (task.status === "FAILED") {
          setTests((old) => ({ ...old, [feature]: { status: "failed", taskId, message: task.result?.message ?? task.error ?? "The test failed." } }));
        } else {
          const waiting = attempt >= 30
            ? "Still waiting for the background worker. If nothing changes, check System, Diagnostics (worker)."
            : task.status === "RUNNING" ? "Running the test…" : "Queued for the background worker…";
          setTests((old) => ({ ...old, [feature]: { status: task.status === "RUNNING" ? "running" : "queued", taskId, message: waiting } }));
          if (attempt < 150) poll(feature, taskId, attempt + 1);
        }
      } catch (error) {
        if (mounted.current) setTests((old) => ({ ...old, [feature]: { status: "error", taskId, message: error instanceof Error ? error.message : "The test status could not be read." } }));
      }
    }, 2000);
    timers.current.add(timer);
  }

  async function runTest(feature: AiFeature) {
    setTests((old) => ({ ...old, [feature]: { status: "queued", message: "Queuing the test…" } }));
    try {
      const response = await fetch("/api/admin/ai/tests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feature }) });
      const body = await readJson(response);
      if (!mounted.current) return;
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "The test could not be queued.");
      const task = body.task as { id: string };
      setTests((old) => ({ ...old, [feature]: { status: "queued", taskId: task.id, message: "Queued for the background worker…" } }));
      poll(feature, task.id, 0);
    } catch (error) {
      if (mounted.current) setTests((old) => ({ ...old, [feature]: { status: "error", message: error instanceof Error ? error.message : "The test could not be queued." } }));
    }
  }

  return (
    <section aria-labelledby="ai-settings-heading" className="min-w-0 space-y-6">
      <ESectionHeading eyebrow="AI" title={<span id="ai-settings-heading">AI providers and models</span>} description="Choose a local or cloud model for each AI feature. Every AI result is a suggestion a person confirms; nothing here approves work, changes scores or sends messages." />
      <EAlert tone="info" title="Defaults pending owner confirmation">
        Photos never go to a cloud provider unless you allow it for that feature below (off by default). When allowed, the time and address stamp on cleaners&apos; photos is blacked out before sending. Local Ollama keeps photos on your own server.
      </EAlert>
      {!state.encryptionReady ? <EAlert tone="warning" title="Keys cannot be saved yet">The server has no ENCRYPTION_KEY, so provider keys cannot be stored safely here. Environment keys keep working until it is set.</EAlert> : null}

      <ProviderCards
        credentials={state.credentials}
        routes={state.routes}
        compatible={draft.compatible}
        disabled={saving}
        onCompatibleChange={(compatible) => { setDraft((old) => (old ? { ...old, compatible } : old)); setMessage(null); }}
        onCredentialsChange={(credentials) => setState((old) => (old ? { ...old, credentials } : old))}
      />

      <fieldset disabled={saving} className="min-w-0 space-y-6">
        <ECard className="space-y-3 p-4 sm:p-5">
          <h3 className="text-base font-semibold">Default provider for text features</h3>
          <p className="text-sm text-[hsl(var(--e-muted-foreground))]">Used by social drafts and notification wording unless a feature has its own choice. &quot;Server environment&quot; keeps the AI_TEXT_PROVIDER setting (or Ollama&apos;s &quot;use for text&quot;).</p>
          <RoutePicker
            idPrefix="default-route"
            value={draft.defaultRoute}
            inheritLabel="Server environment"
            onChange={(defaultRoute) => { setDraft((old) => (old ? { ...old, defaultRoute } : old)); setMessage(null); }}
          />
        </ECard>

        <div className="space-y-3">
          <h3 className="text-base font-semibold">Features</h3>
          {AI_FEATURES.map((feature) => (
            <FeatureCard
              key={feature}
              feature={feature}
              settings={draft.features[feature]}
              route={state.routes.find((row) => row.feature === feature) ?? null}
              test={tests[feature]}
              savedAndUnchanged={!dirty}
              onChange={(patch) => updateFeature(feature, patch)}
              onTest={() => void runTest(feature)}
            />
          ))}
        </div>

        <PriceEditor prices={draft.prices} onChange={(prices) => { setDraft((old) => (old ? { ...old, prices } : old)); setMessage(null); }} />
      </fieldset>

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-3 border-t border-[hsl(var(--e-border))] bg-[hsl(var(--e-background))] px-1 py-3 max-sm:bottom-16">
        <EButton type="button" disabled={!dirty || !valid || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save AI settings"}</EButton>
        <EButton type="button" variant="outline" disabled={!dirty || saving} onClick={() => { setDraft(toDraft(state.routing)); setMessage(null); setConflict(null); }}>Discard changes</EButton>
        {!valid && dirty ? <span className="text-sm">Check model names, limits (1 to 10,000 an hour), deadlines (10 to 300 seconds) and the endpoint address.</span> : null}
      </div>
      {message ? <EAlert tone={message.tone}><span role={message.tone === "danger" ? "alert" : "status"}>{message.text}</span></EAlert> : null}
      {conflict ? (
        <div className="flex flex-wrap gap-3">
          <EButton type="button" disabled={saving} onClick={() => void save(conflict.revision)}>Put my changes on top</EButton>
          <EButton type="button" variant="outline" disabled={saving} onClick={() => { setState((old) => (old ? { ...old, routing: conflict } : old)); setDraft(toDraft(conflict)); setRevision(conflict.revision); setConflict(null); setMessage(null); }}>Load theirs</EButton>
        </div>
      ) : null}

      <UsageTable usage={state.usage} />
    </section>
  );
}

/** A native checkbox with its visible label, so keyboard and screen readers get the name. */
function LabelledSwitch({ checked, onChange, label, description }: { checked: boolean; onChange: (checked: boolean) => void; label: string; description: string }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-3">
      <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="min-w-0">
        <span className="block text-[0.875rem] font-medium">{label}</span>
        <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{description}</span>
      </span>
    </label>
  );
}

function RoutePicker({ idPrefix, value, inheritLabel, onChange }: { idPrefix: string; value: AiRoute | null; inheritLabel: string; onChange: (route: AiRoute | null) => void }) {
  return (
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <EField label="Provider" htmlFor={`${idPrefix}-provider`}>
        <ESelectNative id={`${idPrefix}-provider`} value={value?.provider ?? ""} onChange={(event) => {
          const provider = event.target.value as AiProviderKind | "";
          onChange(provider ? { provider, model: value?.provider === provider ? value.model : DEFAULT_MODELS[provider] || "model-name" } : null);
        }}>
          <option value="">{inheritLabel}</option>
          {AI_PROVIDER_KINDS.map((provider) => <option key={provider} value={provider}>{AI_PROVIDER_LABELS[provider]}</option>)}
        </ESelectNative>
      </EField>
      <EField label="Model" htmlFor={`${idPrefix}-model`} hint={value?.provider === "ollama" ? "An installed local model (see Settings, Ollama)." : undefined}>
        <EInput id={`${idPrefix}-model`} disabled={!value} value={value?.model ?? ""} autoComplete="off" spellCheck={false} onChange={(event) => value && onChange({ ...value, model: event.target.value })} />
      </EField>
    </div>
  );
}

function FeatureCard({ feature, settings, route, test, savedAndUnchanged, onChange, onTest }: {
  feature: AiFeature;
  settings: Draft["features"][AiFeature];
  route: RouteRow | null;
  test: TestState | undefined;
  savedAndUnchanged: boolean;
  onChange: (patch: Partial<Draft["features"][AiFeature]>) => void;
  onTest: () => void;
}) {
  const definition = AI_FEATURE_CATALOG[feature];
  const status = !definition.built ? "Not built yet" : route?.error ? "Settings unreadable" : !route?.enabled ? "Switched off" : !route.configured ? "Not configured" : definition.usesImages && !route.allowImages ? "Images stay on the server: unavailable" : "Ready, not tested";
  const statusTone = status === "Ready, not tested" ? "neutral" : "warning";
  const testing = test && (test.status === "queued" || test.status === "running");
  return (
    <ECard className="min-w-0 space-y-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="font-semibold">{definition.label}</h4>
          <p className="text-sm text-[hsl(var(--e-muted-foreground))]">{definition.description}</p>
        </div>
        <EBadge tone={statusTone} soft>{status}</EBadge>
      </div>
      {route && !route.error ? (
        <p className="break-words text-sm [overflow-wrap:anywhere]">Now: {route.provider ? AI_PROVIDER_LABELS[route.provider as AiProviderKind] ?? route.provider : "—"} · {route.model ?? "—"} ({SOURCE_TEXT[route.source ?? ""] ?? "unknown"}){route.cloud ? " · cloud" : " · local"}</p>
      ) : route?.error ? <p className="text-sm">{route.error}</p> : null}
      <LabelledSwitch checked={settings.enabled} onChange={(enabled) => onChange({ enabled })} label="Use AI for this feature" description={definition.built ? "Off: the feature says AI is unavailable and people continue manually." : "Reserved; it has no effect until the feature is built."} />
      <RoutePicker idPrefix={`route-${feature}`} value={settings.route} inheritLabel={definition.usesImages ? "Photo provider (AI workflow settings)" : "Default provider"} onChange={(next) => onChange({ route: next })} />
      {definition.usesImages ? (
        <LabelledSwitch
          checked={settings.allowCloudImages}
          onChange={(allowCloudImages) => onChange({ allowCloudImages })}
          label="Allow photos to go to a cloud provider"
          description="Off (default): this feature only runs on Local Ollama, or says AI is unavailable. On: photos are sent to the cloud provider with the time and address stamp blacked out."
        />
      ) : null}
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <EField label="Requests per person per hour" htmlFor={`limit-${feature}`}>
          <EInput id={`limit-${feature}`} type="number" inputMode="numeric" min={1} max={10000} step={1} value={settings.hourlyLimitPerActor} onChange={(event) => onChange({ hourlyLimitPerActor: Number(event.target.value) })} />
        </EField>
        <EField label="Cloud deadline (seconds)" htmlFor={`timeout-${feature}`} hint="Local Ollama uses its own deadline.">
          <EInput id={`timeout-${feature}`} type="number" inputMode="numeric" min={10} max={300} step={1} value={settings.timeoutSeconds} onChange={(event) => onChange({ timeoutSeconds: Number(event.target.value) })} />
        </EField>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <EButton type="button" variant="outline" size="sm" disabled={!definition.built || !savedAndUnchanged || Boolean(testing)} onClick={onTest}>{testing ? "Testing…" : "Run a real test"}</EButton>
        <span className="text-xs text-[hsl(var(--e-muted-foreground))]">{savedAndUnchanged ? "Sends one request with made-up content (no property data); photo tests use generated colour cards." : "Save changes before testing."}</span>
      </div>
      {test ? <p aria-live="polite" className="break-words text-sm [overflow-wrap:anywhere]"><strong>{test.status === "passed" ? "Passed: " : test.status === "failed" ? "Failed: " : test.status === "error" ? "Not tested: " : ""}</strong>{test.message}</p> : null}
    </ECard>
  );
}

function ProviderCards({ credentials, routes, compatible, disabled, onCompatibleChange, onCredentialsChange }: {
  credentials: CredentialState[];
  routes: RouteRow[];
  compatible: Draft["compatible"];
  disabled: boolean;
  onCompatibleChange: (compatible: Draft["compatible"]) => void;
  onCredentialsChange: (credentials: CredentialState[]) => void;
}) {
  const ollamaUsedBy = routes.filter((row) => row.provider === "ollama").map((row) => AI_FEATURE_CATALOG[row.feature].label);
  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold">Providers</h3>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        {credentials.map((credential) => (
          <KeyCard key={credential.provider} credential={credential} disabled={disabled} onSaved={onCredentialsChange}>
            {credential.provider === "openai_compatible" ? (
              <div className="grid gap-3">
                <EField label="Base address (https)" htmlFor="compatible-base-url" hint="For example https://api.example.com/v1. Saved with Save AI settings. Public addresses only; use Local Ollama for your own network.">
                  <EInput id="compatible-base-url" inputMode="url" autoComplete="off" spellCheck={false} value={compatible.baseUrl} onChange={(event) => onCompatibleChange({ ...compatible, baseUrl: event.target.value })} />
                </EField>
                <EField label="Name shown here" htmlFor="compatible-label">
                  <EInput id="compatible-label" maxLength={60} value={compatible.label} onChange={(event) => onCompatibleChange({ ...compatible, label: event.target.value })} />
                </EField>
              </div>
            ) : null}
          </KeyCard>
        ))}
        <ECard className="min-w-0 space-y-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-semibold">Local Ollama</h4>
            <EBadge tone="neutral" soft>{ollamaUsedBy.length ? `Used by ${ollamaUsedBy.length} feature${ollamaUsedBy.length === 1 ? "" : "s"}` : "Not selected"}</EBadge>
          </div>
          <p className="text-sm text-[hsl(var(--e-muted-foreground))]">Runs on your own server; photos never leave it. Address, models and diagnostics are in Ollama setup.</p>
          <a className="inline-flex min-h-11 items-center text-sm font-medium underline" href="/v2/admin/settings?tab=ollama">Open Ollama setup</a>
        </ECard>
      </div>
    </div>
  );
}

function KeyCard({ credential, disabled, onSaved, children }: { credential: CredentialState; disabled: boolean; onSaved: (credentials: CredentialState[]) => void; children?: React.ReactNode }) {
  const [apiKey, setApiKey] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const id = `key-${credential.provider}`;

  async function submit(clear: boolean) {
    setBusy(true); setNote("");
    try {
      const response = await fetch("/api/admin/ai/credentials", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: credential.provider, ...(clear ? { clear: true } : { apiKey }), password }) });
      const body = await readJson(response);
      if (!mounted.current) return;
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "The key was not changed.");
      setApiKey(""); setPassword("");
      onSaved(body.credentials as CredentialState[]);
      setNote(clear ? "Key removed." : "Key saved.");
    } catch (error) {
      // The typed key stays in the field for another attempt; the password is cleared.
      if (mounted.current) { setPassword(""); setNote(error instanceof Error ? error.message : "The key was not changed."); }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <ECard className="min-w-0 space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold">{SECRET_LABELS[credential.provider]}</h4>
        <EBadge tone={credential.state === "saved" || credential.state === "environment" ? "neutral" : "warning"} soft>{CREDENTIAL_TEXT[credential.state]}{credential.hint ? ` ${credential.hint}` : ""}</EBadge>
      </div>
      {children}
      <fieldset disabled={disabled || busy} className="grid min-w-0 gap-3">
        <EField label="New API key" htmlFor={`${id}-value`} hint="Stored encrypted. It is never shown again; only its last four characters.">
          <EInput id={`${id}-value`} type="password" autoComplete="off" spellCheck={false} value={apiKey} onChange={(event) => setApiKey(event.target.value)} />
        </EField>
        <EField label="Your password" htmlFor={`${id}-password`}>
          <EInput id={`${id}-password`} type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </EField>
        <div className="flex flex-wrap gap-2">
          <EButton type="button" size="sm" disabled={!apiKey.trim() || !password} onClick={() => void submit(false)}>{busy ? "Saving…" : "Save key"}</EButton>
          <EButton type="button" size="sm" variant="outline" disabled={!password || credential.state === "missing" || credential.state === "cleared"} onClick={() => void submit(true)}>Remove key</EButton>
        </div>
      </fieldset>
      {note ? <p role="status" className="text-sm">{note}</p> : null}
    </ECard>
  );
}

function PriceEditor({ prices, onChange }: { prices: AiModelPrice[]; onChange: (prices: AiModelPrice[]) => void }) {
  return (
    <ECard className="min-w-0 space-y-3 p-4 sm:p-5">
      <h3 className="text-base font-semibold">Model prices (for the usage estimate)</h3>
      <p className="text-sm text-[hsl(var(--e-muted-foreground))]">Enter your provider&apos;s price in US dollars per million tokens. Models without a price show &quot;Not known&quot;, never $0. Local Ollama has no provider charge.</p>
      {prices.length === 0 ? <p className="text-sm">No prices entered.</p> : null}
      {prices.map((price, index) => (
        <div key={index} className="grid min-w-0 gap-2 border-t border-[hsl(var(--e-border))] pt-3 sm:grid-cols-[1fr_1fr_8rem_8rem_auto] sm:items-end">
          <EField label="Provider" htmlFor={`price-provider-${index}`}>
            <ESelectNative id={`price-provider-${index}`} value={price.provider} onChange={(event) => onChange(prices.map((item, i) => (i === index ? { ...item, provider: event.target.value as AiProviderKind } : item)))}>
              {AI_PROVIDER_KINDS.filter((provider) => provider !== "ollama").map((provider) => <option key={provider} value={provider}>{AI_PROVIDER_LABELS[provider]}</option>)}
            </ESelectNative>
          </EField>
          <EField label="Model" htmlFor={`price-model-${index}`}>
            <EInput id={`price-model-${index}`} value={price.model} autoComplete="off" spellCheck={false} onChange={(event) => onChange(prices.map((item, i) => (i === index ? { ...item, model: event.target.value } : item)))} />
          </EField>
          <EField label="Input $/M" htmlFor={`price-in-${index}`}>
            <EInput id={`price-in-${index}`} type="number" inputMode="decimal" min={0} step="0.01" value={price.inputUsdPerMillion} onChange={(event) => onChange(prices.map((item, i) => (i === index ? { ...item, inputUsdPerMillion: Number(event.target.value) } : item)))} />
          </EField>
          <EField label="Output $/M" htmlFor={`price-out-${index}`}>
            <EInput id={`price-out-${index}`} type="number" inputMode="decimal" min={0} step="0.01" value={price.outputUsdPerMillion} onChange={(event) => onChange(prices.map((item, i) => (i === index ? { ...item, outputUsdPerMillion: Number(event.target.value) } : item)))} />
          </EField>
          <EButton type="button" variant="ghost" size="sm" onClick={() => onChange(prices.filter((_, i) => i !== index))}>Remove</EButton>
        </div>
      ))}
      <EButton type="button" variant="outline" size="sm" disabled={prices.length >= 50} onClick={() => onChange([...prices, { provider: "anthropic", model: DEFAULT_MODELS.anthropic, inputUsdPerMillion: 0, outputUsdPerMillion: 0 }])}>Add a price</EButton>
    </ECard>
  );
}

function UsageTable({ usage }: { usage: Usage | null }) {
  if (!usage) return <EAlert tone="warning" title="Usage unavailable">This month&apos;s AI usage could not be read. Settings above still work.</EAlert>;
  return (
    <section aria-labelledby="ai-usage-heading" className="min-w-0 space-y-2">
      <h3 id="ai-usage-heading" className="text-base font-semibold">Usage in {usage.monthLabel}</h3>
      {usage.rows.length === 0 ? <p className="text-sm">No AI requests this month.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead><tr className="border-b border-[hsl(var(--e-border))]"><th className="py-2 pr-3">Feature</th><th className="py-2 pr-3">Provider · model</th><th className="py-2 pr-3">Requests</th><th className="py-2 pr-3">Tokens in / out</th><th className="py-2">Estimated cost</th></tr></thead>
            <tbody>
              {usage.rows.map((row) => (
                <tr key={`${row.feature}-${row.provider}-${row.model}`} className="border-b border-[hsl(var(--e-border))] align-top">
                  <td className="py-2 pr-3">{AI_FEATURE_CATALOG[row.feature as AiFeature]?.label ?? row.feature}</td>
                  <td className="break-words py-2 pr-3 [overflow-wrap:anywhere]">{AI_PROVIDER_LABELS[row.provider as AiProviderKind] ?? row.provider} · {row.model}</td>
                  <td className="py-2 pr-3">{row.calls} ({row.succeeded} ok, {row.failed} failed, {row.refused} refused)</td>
                  <td className="py-2 pr-3">{row.inputTokens.toLocaleString("en-AU")} / {row.outputTokens.toLocaleString("en-AU")}</td>
                  <td className="py-2">{row.provider === "ollama" ? "Local: no provider charge" : row.unknownCostCalls > 0 ? `${row.knownCostMicroUsd > 0 ? `${money(row.knownCostMicroUsd)} + ` : ""}not known for ${row.unknownCostCalls}` : money(row.knownCostMicroUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-[hsl(var(--e-muted-foreground))]">Counted in {usage.timezone}. Refused requests (switched off, not configured, photos not allowed, hourly limit) never reached a provider.</p>
    </section>
  );
}
