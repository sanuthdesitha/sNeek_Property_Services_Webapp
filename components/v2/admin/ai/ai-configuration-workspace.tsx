"use client";

/**
 * The AI configuration page (boards "AI configuration", "AI configuration
 * states", "AI configuration, phone"): status strip, 1 Where AI runs, 2 What
 * AI does, 3 Photo checks, 4 Usage and cost, 5 Privacy and safety, and the
 * first-run guide. It replaces Settings › AI, the "Photo checks and memory"
 * page and the Ollama tab; every control of those screens lives here.
 *
 * Reads: GET /api/admin/ai/settings, /api/admin/ai/vision and
 * /api/admin/ai/photo-review-opt-out (each cancelled when replaced, checked
 * after parsing). Save changes writes the routing (stale-write guard; a 409
 * keeps the draft and offers "Load theirs" or "Put mine on top") and the photo
 * workflow settings. Fields freeze while saving; a failed save keeps the
 * draft. Operations managers read everything with every control disabled.
 */
import * as React from "react";
import Link from "next/link";
import { EAlert, EBadge, EButton, EPageHeader } from "@/components/v2/ui/primitives";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { EPhoneActionBar, ESectionSwitcher } from "@/components/v2/ui/phone-bars";
import { EToneCard } from "@/components/v2/ui/tone-band";
import { OllamaSection } from "@/components/v2/admin/settings/ollama-section";
import { PropertyPhotoMemoryPanel } from "@/components/v2/admin/property-photo-memory";
import {
  AI_FEATURE_CATALOG, AI_PROVIDER_KINDS, aiRoutingSchema,
  type AiFeature, type AiProviderKind, type AiRoutingSettings,
} from "@/lib/ai/provider/routing-schema";
import type { AgreementReport } from "@/lib/ai/photo-review-evaluation";
import { visionSettingsSchema, type VisionSettings } from "@/lib/ai/vision-settings-schema";
import {
  effectiveRoute, featuresOn, isFirstRun, providerStatus, shortProviderName, statusStrip, toRoutingDraft, whenText, clockText,
  type AiPage, type AiScreenState, type CredentialState, type FeatureDraft, type ProviderStatus, type RoutingDraft, type SecretProvider,
} from "./ai-config-model";
import { AiKeyDialog, type KeyDialogRequest } from "./ai-key-dialog";
import { FeatureSheet, FeaturesSection } from "./ai-features";
import { OptOutDialog, PhotoChecksSection, type OptOutState, type PartLoad } from "./ai-photo-checks";
import { ProviderSheet, ProvidersSection } from "./ai-providers";
import { AiStatusStrip, FirstRunGuide, PrivacySection } from "./ai-overview";
import { UsageSection } from "./ai-usage";
import { useFeatureTests } from "./use-feature-tests";

export type AiConfigurationProps = {
  /** Administrator acting as themselves (the server re-checks every write). */
  canEdit: boolean;
  /** Why the page is read-only, when it is. */
  readOnlyReason: string | null;
  timezone: string;
  agreement: AgreementReport | null;
  recognitionConfigured: boolean;
  /** `?section=ollama` (the old Ollama tab) opens the Local Ollama setup. */
  initialSection: string | null;
};

type Conflict = { current: AiRoutingSettings; savedBy: { at: string; by: string | null } | null };
type Notice = { tone: "success" | "danger" | "warning"; text: string };
type VisionBody = { settings?: unknown; recognitionConfigured?: boolean; error?: string };

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json().catch(() => ({}))) as T;
}

/** One cancellable read: aborts the previous one and ignores answers that arrive after it. */
function useCancellableRead() {
  const controllers = React.useRef(new Map<string, AbortController>());
  React.useEffect(() => {
    const current = controllers.current;
    return () => current.forEach((controller) => controller.abort());
  }, []);
  return React.useCallback((key: string) => {
    controllers.current.get(key)?.abort();
    const controller = new AbortController();
    controllers.current.set(key, controller);
    return controller.signal;
  }, []);
}

export function AiConfigurationWorkspace({ canEdit: serverCanEdit, readOnlyReason, timezone: serverTimezone, agreement, recognitionConfigured: serverRecognition, initialSection }: AiConfigurationProps) {
  const begin = useCancellableRead();
  const [settingsLoad, setSettingsLoad] = React.useState<PartLoad<null>>({ status: "loading" });
  const [state, setState] = React.useState<AiScreenState | null>(null);
  const [draft, setDraftState] = React.useState<RoutingDraft | null>(null);
  const [revision, setRevision] = React.useState(0);
  const [visionLoad, setVisionLoad] = React.useState<PartLoad<null>>({ status: "loading" });
  const [vision, setVision] = React.useState<VisionSettings | null>(null);
  const [visionDraft, setVisionDraftState] = React.useState<VisionSettings | null>(null);
  const [recognitionConfigured, setRecognitionConfigured] = React.useState(serverRecognition);
  const [optOut, setOptOut] = React.useState<PartLoad<OptOutState>>({ status: "loading" });
  const [saving, setSaving] = React.useState(false);
  const [notice, setNotice] = React.useState<Notice | null>(null);
  const [conflict, setConflict] = React.useState<Conflict | null>(null);
  const [keyRequest, setKeyRequest] = React.useState<KeyDialogRequest | null>(null);
  const [photoConfirm, setPhotoConfirm] = React.useState<AiFeature | null>(null);
  const [featureSheet, setFeatureSheet] = React.useState<AiFeature | null>(null);
  const [providerSheet, setProviderSheet] = React.useState<AiProviderKind | null>(null);
  const [ollamaOpen, setOllamaOpen] = React.useState(initialSection === "ollama");
  const [memoryOpen, setMemoryOpen] = React.useState(false);
  const [optOutOpen, setOptOutOpen] = React.useState(false);
  const [showAll, setShowAll] = React.useState(false);
  const [photoCheck, setPhotoCheck] = React.useState<string | null>(null);
  const { tests, run } = useFeatureTests();

  const loadSettings = React.useCallback(async () => {
    const signal = begin("settings");
    setSettingsLoad({ status: "loading" });
    try {
      const response = await fetch("/api/admin/ai/settings", { cache: "no-store", signal });
      const body = await readJson<AiScreenState & { error?: string }>(response);
      if (signal.aborted) return;
      if (!response.ok || !body.routing) throw new Error(body.error || "AI settings could not be loaded.");
      setState(body);
      setDraftState(toRoutingDraft(body.routing));
      setRevision(body.routing.revision);
      setSettingsLoad({ status: "ready", data: null });
    } catch (error) {
      if (signal.aborted) return;
      setSettingsLoad({ status: "failed", message: error instanceof Error ? error.message : "AI settings could not be loaded." });
    }
  }, [begin]);

  const loadVision = React.useCallback(async () => {
    const signal = begin("vision");
    setVisionLoad({ status: "loading" });
    try {
      const response = await fetch("/api/admin/ai/vision", { cache: "no-store", signal });
      const body = await readJson<VisionBody>(response);
      if (signal.aborted) return;
      const parsed = visionSettingsSchema.safeParse(body.settings);
      if (!response.ok || !parsed.success) throw new Error(body.error || "Photo check settings could not be read.");
      setVision(parsed.data);
      setVisionDraftState(parsed.data);
      if (typeof body.recognitionConfigured === "boolean") setRecognitionConfigured(body.recognitionConfigured);
      setVisionLoad({ status: "ready", data: null });
    } catch (error) {
      if (signal.aborted) return;
      setVisionLoad({ status: "failed", message: error instanceof Error ? error.message : "Photo check settings could not be read." });
    }
  }, [begin]);

  const loadOptOut = React.useCallback(async () => {
    const signal = begin("opt-out");
    setOptOut({ status: "loading" });
    try {
      const response = await fetch("/api/admin/ai/photo-review-opt-out", { cache: "no-store", signal });
      const body = await readJson<OptOutState & { error?: string }>(response);
      if (signal.aborted) return;
      if (!response.ok || !Array.isArray(body.propertyIds)) throw new Error(body.error || "Opted-out properties could not be loaded.");
      setOptOut({ status: "ready", data: body });
    } catch (error) {
      if (signal.aborted) return;
      setOptOut({ status: "failed", message: error instanceof Error ? error.message : "Opted-out properties could not be loaded." });
    }
  }, [begin]);

  React.useEffect(() => {
    void loadSettings();
    void loadVision();
    void loadOptOut();
  }, [loadSettings, loadVision, loadOptOut]);

  // Old links (#photo-checks, ?section=ollama) land on their section once it exists.
  const ready = settingsLoad.status === "ready";
  React.useEffect(() => {
    if (!ready) return;
    const target = initialSection === "ollama" ? "ollama-setup" : window.location.hash.slice(1);
    if (target) document.getElementById(target)?.scrollIntoView({ block: "start" });
  }, [ready, initialSection]);

  const canEdit = serverCanEdit && Boolean(state?.canEdit);
  const locked = saving || !canEdit;
  const savedDraft = state ? toRoutingDraft(state.routing) : null;
  const routingDirty = Boolean(draft && savedDraft && JSON.stringify(draft) !== JSON.stringify(savedDraft));
  const visionDirty = Boolean(vision && visionDraft && JSON.stringify(vision) !== JSON.stringify(visionDraft));
  const dirty = routingDirty || visionDirty;
  const routingValid = draft ? aiRoutingSchema.safeParse({ ...draft, revision }).success : false;
  const visionValid = !visionDraft || (visionSettingsSchema.safeParse(visionDraft).success && visionDraft.minorPoints <= visionDraft.majorPoints);
  const timezone = state?.timezone || serverTimezone;

  const setDraft = React.useCallback((update: (old: RoutingDraft) => RoutingDraft) => {
    setDraftState((old) => (old ? update(old) : old));
    setNotice(null);
  }, []);
  const setVisionDraft = React.useCallback((update: (old: VisionSettings) => VisionSettings) => {
    setVisionDraftState((old) => (old ? update(old) : old));
    setNotice(null);
  }, []);
  const updateFeature = React.useCallback((feature: AiFeature, patch: Partial<FeatureDraft>) => {
    setDraft((old) => ({ ...old, features: { ...old.features, [feature]: { ...old.features[feature], ...patch } } }));
  }, [setDraft]);

  async function saveRouting(useRevision: number): Promise<boolean> {
    if (!draft) return false;
    const response = await fetch("/api/admin/ai/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: useRevision, settings: draft }) });
    const body = await readJson<AiScreenState & { error?: string; current?: AiRoutingSettings; savedBy?: Conflict["savedBy"] }>(response);
    if (response.status === 409 && body.current) {
      setConflict({ current: body.current, savedBy: body.savedBy ?? null });
      return false;
    }
    if (!response.ok || !body.routing) throw new Error(body.error || "AI settings were not saved.");
    setState(body);
    setDraftState(toRoutingDraft(body.routing));
    setRevision(body.routing.revision);
    setConflict(null);
    return true;
  }

  async function saveVision(): Promise<void> {
    if (!visionDraft) return;
    const response = await fetch("/api/admin/ai/vision", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(visionDraft) });
    const body = await readJson<VisionBody>(response);
    const parsed = visionSettingsSchema.safeParse(body.settings);
    if (!response.ok || !parsed.success) throw new Error(body.error || "Photo check settings were not saved.");
    setVision(parsed.data);
    setVisionDraftState(parsed.data);
  }

  async function save(useRevision = revision) {
    if (!canEdit || saving || !dirty) return;
    if (!routingValid || !visionValid) {
      setNotice({ tone: "danger", text: "Check model names, limits (1 to 10,000 an hour), deadlines (10 to 300 seconds), the endpoint address and the photo check numbers." });
      return;
    }
    setSaving(true);
    setNotice(null);
    const problems: string[] = [];
    let routingSaved = !routingDirty;
    try {
      if (routingDirty) {
        try { routingSaved = await saveRouting(useRevision); } catch (error) { problems.push(error instanceof Error ? error.message : "AI settings were not saved."); }
      }
      if (visionDirty) {
        try { await saveVision(); } catch (error) { problems.push(error instanceof Error ? error.message : "Photo check settings were not saved."); }
      }
    } finally {
      setSaving(false);
    }
    if (problems.length) setNotice({ tone: "danger", text: `${problems.join(" ")} Your changes are kept.` });
    else if (!routingSaved) setNotice({ tone: "warning", text: "Someone saved AI settings after you opened them. Your changes are kept below; choose what to do." });
    else setNotice({ tone: "success", text: "Saved. Changes apply to the next request." });
    // A changed photo default changes where photo features run: re-read the routes when nothing is pending.
    if (visionDirty && routingSaved && !problems.length && !routingDirty) void loadSettings();
  }

  function loadTheirs(current: AiRoutingSettings) {
    setState((old) => (old ? { ...old, routing: current } : old));
    setDraftState(toRoutingDraft(current));
    setRevision(current.revision);
    setConflict(null);
    setNotice(null);
  }

  async function checkPhotoModel() {
    setPhotoCheck("Checking the saved photo model…");
    try {
      const response = await fetch("/api/admin/ai/vision/check", { method: "POST" });
      const body = await readJson<{ message?: string; model?: string; error?: string }>(response);
      if (!response.ok) throw new Error(body.error || "Connection check failed.");
      setPhotoCheck(`${body.message ?? "Checked."}${body.model ? ` Model: ${body.model}` : ""}`);
    } catch (error) {
      setPhotoCheck(error instanceof Error ? error.message : "Connection check failed.");
    }
  }

  function openOllamaSetup() {
    setOllamaOpen(true);
    setProviderSheet(null);
    window.setTimeout(() => document.getElementById("ollama-setup")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  const header = (
    <EPageHeader
      eyebrow={<><Link href="/v2/admin/settings" className="underline-offset-2 hover:underline">← Settings</Link> · Automation and AI</>}
      title="AI"
      description="Where AI runs, what it does, photo checks, what it costs and what leaves this server."
      actions={state ? (
        canEdit ? (
          <div className="flex items-center gap-2 max-sm:hidden">
            <span role="status" className="whitespace-nowrap text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              {saving ? "Saving…" : dirty ? "Unsaved changes" : state.status?.lastSaved ? `All changes saved ${whenText(state.status.lastSaved.at, timezone)}` : "No unsaved changes"}
            </span>
            {dirty ? <EButton type="button" variant="ghost" size="sm" disabled={saving} onClick={() => { if (savedDraft) setDraftState(savedDraft); setVisionDraftState(vision); setConflict(null); setNotice(null); }}>Discard</EButton> : null}
            <EButton type="button" disabled={!dirty || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save changes"}</EButton>
          </div>
        ) : <EBadge tone="info" soft>View only</EBadge>
      ) : undefined}
    />
  );

  if (settingsLoad.status === "failed" && !state) {
    return (
      <div className="min-w-0 space-y-5">
        {header}
        <EAlert tone="danger" title="AI configuration could not be loaded">
          <span role="alert">{settingsLoad.message}</span> <button type="button" className="underline" onClick={() => void loadSettings()}>Retry</button>
        </EAlert>
      </div>
    );
  }
  if (!state || !draft) {
    return (
      <div className="min-w-0 space-y-5">
        {header}
        <p role="status" className="text-sm">Loading AI configuration…</p>
      </div>
    );
  }

  const statuses = Object.fromEntries(AI_PROVIDER_KINDS.map((kind) => [kind, providerStatus(kind, state, draft, tests)])) as Record<AiProviderKind, ProviderStatus>;
  const page: AiPage = {
    state, draft, vision, visionDraft, statuses, canEdit, locked, dirty, timezone, tests,
    updateFeature, setDraft, setVisionDraft,
    runTest: (feature) => void run(feature),
    openKey: (provider, mode, choose) => setKeyRequest({ provider, mode, choose }),
    askAllowPhotos: (feature) => setPhotoConfirm(feature),
    openFeature: (feature) => setFeatureSheet(feature),
    openProvider: (kind) => setProviderSheet(kind),
    openOllamaSetup,
    save: () => void save(),
  };
  const firstRun = isFirstRun(statuses) && !showAll;
  const strip = statusStrip(state, draft, visionDraft, statuses);
  const keyCredential: CredentialState | null = keyRequest ? state.credentials.find((item) => item.provider === keyRequest.provider) ?? null : null;
  const keyUsers = keyRequest ? featuresOn(keyRequest.provider, state, draft, visionDraft).map((feature) => AI_FEATURE_CATALOG[feature].label) : [];
  const confirmRoute = photoConfirm ? effectiveRoute(photoConfirm, state, draft, visionDraft) : null;
  const confirmCompany = confirmRoute && confirmRoute.provider !== "ollama" ? shortProviderName(confirmRoute.provider, draft) : "a cloud provider";

  const ollamaSetup = ollamaOpen && canEdit ? (
    <section id="ollama-setup" aria-label="Local Ollama setup" className="min-w-0 scroll-mt-24 space-y-2 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] p-3 sm:p-4">
      <div className="flex justify-end"><EButton type="button" size="sm" variant="ghost" onClick={() => setOllamaOpen(false)}>Close Ollama setup</EButton></div>
      <OllamaSection />
    </section>
  ) : null;

  return (
    <div className="min-w-0 space-y-5">
      {header}
      {readOnlyReason ? <EAlert tone="info" title="View only">{readOnlyReason}</EAlert> : null}
      <AiStatusStrip strip={strip} />

      {conflict ? (
        <EToneCard tone="info" pill="Conflict" header={<><b className="text-[0.875rem]">Someone else saved first</b><div className="text-[0.75rem]">{conflict.savedBy ? `${conflict.savedBy.by ?? "Someone"} saved AI settings at ${clockText(conflict.savedBy.at, timezone)}` : "AI settings changed after you opened them"}</div></>} bodyClassName="flex flex-wrap items-center gap-2 text-[0.8125rem]">
          <span>Your changes are kept below.</span>
          <EButton type="button" size="sm" variant="outline" disabled={saving} onClick={() => loadTheirs(conflict.current)}>Load theirs</EButton>
          <EButton type="button" size="sm" disabled={saving} onClick={() => void save(conflict.current.revision)}>Put mine on top</EButton>
        </EToneCard>
      ) : null}
      {notice ? <EAlert tone={notice.tone}><span role={notice.tone === "danger" ? "alert" : "status"}>{notice.text}</span></EAlert> : null}
      {!state.encryptionReady && canEdit ? <EAlert tone="warning" title="Keys cannot be saved yet">The server has no ENCRYPTION_KEY, so provider keys cannot be stored safely. Keys set in the hosting environment keep working. Ask whoever hosts sNeek to add it and restart.</EAlert> : null}

      {firstRun ? (
        <>
          <FirstRunGuide page={page} onShowAll={() => setShowAll(true)} />
          {ollamaSetup}
        </>
      ) : (
        <>
          <ESectionSwitcher everywhere label="Sections" sections={[
            { id: "where", label: "1 Where AI runs" },
            { id: "what", label: "2 What AI does" },
            { id: "photo-checks", label: "3 Photo checks" },
            { id: "usage", label: "4 Usage and cost" },
            { id: "privacy", label: "5 Privacy and safety" },
          ]} />
          <fieldset disabled={saving} className="min-w-0 space-y-6">
            <ProvidersSection page={page} ollamaSetup={ollamaSetup} />
            <FeaturesSection page={page} />
            <PhotoChecksSection
              page={page}
              vision={visionDraft}
              visionLoad={visionLoad.status}
              onRetryVision={() => void loadVision()}
              recognitionConfigured={recognitionConfigured}
              agreement={agreement}
              optOut={optOut}
              onRetryOptOut={() => void loadOptOut()}
              onManageOptOut={() => setOptOutOpen(true)}
              memory={{ open: memoryOpen, toggle: () => setMemoryOpen((value) => !value), panel: <PropertyPhotoMemoryPanel canEdit={canEdit} /> }}
            />
            <UsageSection page={page} />
          </fieldset>
        </>
      )}
      <PrivacySection page={page} />

      {canEdit ? (
        <EPhoneActionBar label="AI actions" hidden={!dirty && !saving} primary={<EButton type="button" disabled={!dirty || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save changes"}</EButton>} />
      ) : null}

      <AiKeyDialog
        request={keyRequest}
        credential={keyCredential}
        usedBy={keyUsers}
        encryptionReady={state.encryptionReady}
        onClose={() => setKeyRequest(null)}
        onChooseProvider={(provider: SecretProvider) => setKeyRequest((old) => (old ? { ...old, provider } : old))}
        onSaved={(credentials, mode) => {
          setState((old) => (old ? { ...old, credentials } : old));
          setKeyRequest(null);
          setNotice({ tone: "success", text: mode === "remove" ? "Key removed. Features using it now say AI is unavailable until you choose another provider." : "Key saved. Saving does not test it: use Test connection." });
        }}
      />
      <EActionDialog
        open={photoConfirm !== null}
        eyebrow="Photos leave this server"
        title={`Allow photos to go to ${confirmCompany}?`}
        description={photoConfirm ? `${AI_FEATURE_CATALOG[photoConfirm].label} will send cleaning photos to ${confirmCompany}${confirmRoute && ["anthropic", "openai"].includes(confirmRoute.provider) ? " in the United States" : ""}, with the time and address stamp blacked out. It takes effect when you save changes, and the change is kept in the settings audit.` : undefined}
        onClose={() => setPhotoConfirm(null)}
        footer={
          <>
            <EButton variant="outline" onClick={() => setPhotoConfirm(null)}>Cancel</EButton>
            <EButton onClick={() => { if (photoConfirm) updateFeature(photoConfirm, { allowCloudImages: true }); setPhotoConfirm(null); }}>Allow photos</EButton>
          </>
        }
      >
        <p className="text-[0.8125rem]">Photos from properties that opted out are never sent. Turning the switch off again keeps photos on this server from the next request.</p>
      </EActionDialog>
      <OptOutDialog
        open={optOutOpen}
        canEdit={canEdit}
        optOut={optOut.status === "ready" ? optOut.data : null}
        onClose={() => setOptOutOpen(false)}
        onSaved={(next) => setOptOut({ status: "ready", data: next })}
      />
      <FeatureSheet page={page} feature={featureSheet} onClose={() => { setFeatureSheet(null); setPhotoCheck(null); }} onCheckPhotoModel={() => void checkPhotoModel()} photoCheck={photoCheck} />
      <ProviderSheet page={page} kind={providerSheet} onClose={() => setProviderSheet(null)} />
    </div>
  );
}
