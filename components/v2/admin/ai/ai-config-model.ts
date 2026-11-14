/**
 * The AI configuration page's data shapes and the pure rules that turn the
 * server's answer into what the page says. Plain module (no "use client"):
 * tests and components import it; it never decides authorization.
 */
import {
  AI_FEATURE_CATALOG, AI_FEATURES,
  type AiFeature, type AiProviderKind, type AiRoute, type AiRoutingSettings,
} from "@/lib/ai/provider/routing-schema";
import type { AiFeatureTestSummary, AiStatusFacts } from "@/lib/ai/provider/status";
import type { VisionSettings } from "@/lib/ai/vision-settings-schema";

export type SecretProvider = "anthropic" | "openai" | "openai_compatible";
export type CredentialState = { provider: SecretProvider; state: "saved" | "environment" | "cleared" | "missing" | "unreadable"; hint: string | null };
export type RouteRow = { feature: AiFeature; provider: string | null; model: string | null; configured: boolean; enabled: boolean; cloud: boolean; allowImages: boolean; source: string | null; error: string | null };
export type UsageRow = { feature: string; provider: string; model: string; calls: number; succeeded: number; failed: number; refused: number; inputTokens: number; outputTokens: number; knownCostMicroUsd: number; unknownCostCalls: number };
export type Usage = { monthLabel: string; timezone: string; rows: UsageRow[] };

/** GET /api/admin/ai/settings. */
export type AiScreenState = {
  routing: AiRoutingSettings;
  credentials: CredentialState[];
  routes: RouteRow[];
  usage: Usage | null;
  timezone: string;
  status: AiStatusFacts | null;
  canEdit: boolean;
  isAdmin: boolean;
  encryptionReady: boolean;
};

export type RoutingDraft = Omit<AiRoutingSettings, "revision">;
export type FeatureDraft = RoutingDraft["features"][AiFeature];

export function toRoutingDraft(routing: AiRoutingSettings): RoutingDraft {
  const { revision: _revision, ...rest } = routing;
  return rest;
}

/** A test this screen queued and is following (or has just finished). */
export type LiveTest = {
  status: "queued" | "running" | "passed" | "failed" | "error";
  message: string;
  startedAt: number;
  finishedAt?: string;
  provider?: string;
  model?: string;
  durationMs?: number;
  waitingTooLong?: boolean;
};

export const PROVIDER_ORDER: readonly AiProviderKind[] = ["ollama", "anthropic", "openai_compatible", "openai"];

export const PROVIDER_NAME: Readonly<Record<AiProviderKind, string>> = {
  ollama: "Local Ollama",
  anthropic: "Anthropic",
  openai: "OpenAI",
  openai_compatible: "OpenAI-compatible",
};

/** Where a request goes, in words. */
export function providerWhere(kind: AiProviderKind): string {
  if (kind === "ollama") return "Local · on this server";
  if (kind === "anthropic") return "Cloud · Anthropic, United States";
  if (kind === "openai") return "Cloud · OpenAI, United States";
  return "Cloud · your chosen endpoint";
}

/** The compatible endpoint's display name: "Together (OpenAI-compatible)". */
export function providerTitle(kind: AiProviderKind, draft: RoutingDraft | null): string {
  if (kind === "openai_compatible" && draft?.compatible.label.trim()) return `${draft.compatible.label.trim()} (OpenAI-compatible)`;
  return PROVIDER_NAME[kind];
}

export function shortProviderName(kind: string, draft: RoutingDraft | null): string {
  if (kind === "openai_compatible") return draft?.compatible.label.trim() || "OpenAI-compatible";
  return PROVIDER_NAME[kind as AiProviderKind] ?? kind;
}

export type ProviderState = "connected" | "failing" | "untested" | "not-set-up";
export type ProviderTone = "good" | "problem" | "info";

export type ProviderStatus = {
  state: ProviderState;
  tone: ProviderTone;
  pill: string;
  /** Under the name in the band: "Key ••••a9F2" / "No key saved" / the address. */
  subtitle: string;
  /** The last test result, in words, or null when never tested. */
  lastTest: { ok: boolean; at: string; message: string | null; detail: string | null } | null;
  /** The failure in words when failing. */
  failure: string | null;
};

const PROVIDER_FAILURE_TEXT: Readonly<Record<string, string>> = {
  AUTH: "The key was refused",
  TIMEOUT: "Took longer than the deadline",
  RATE_LIMITED: "Provider is busy, try in a minute (429)",
  CONNECTION: "Could not reach the address",
  SERVER: "The provider had an error",
  INVALID_JSON: "Answer was not usable",
  SCHEMA: "Answer was not usable",
  INCOMPLETE: "Answer was cut short",
  BAD_REQUEST: "The provider refused the request (model name or settings)",
};

/** A failure in plain words from the audit's outcome and error code. */
export function failureInWords(outcome: string, errorCode: string | null): string {
  if (errorCode && PROVIDER_FAILURE_TEXT[errorCode]) return PROVIDER_FAILURE_TEXT[errorCode];
  if (outcome === "TIMEOUT") return PROVIDER_FAILURE_TEXT.TIMEOUT;
  if (outcome === "INVALID_OUTPUT") return PROVIDER_FAILURE_TEXT.SCHEMA;
  return "The request failed";
}

/** The newest test (server record or one followed here) of any feature that ran on this provider. */
export function latestProviderTest(kind: AiProviderKind, state: AiScreenState, live: Partial<Record<AiFeature, LiveTest>>): ProviderStatus["lastTest"] {
  let best: ProviderStatus["lastTest"] = null;
  const consider = (candidate: ProviderStatus["lastTest"]) => {
    if (candidate && (!best || Date.parse(candidate.at) > Date.parse(best.at))) best = candidate;
  };
  for (const feature of AI_FEATURES) {
    const recorded: AiFeatureTestSummary | undefined = state.status?.lastTests?.[feature];
    if (recorded && recorded.ok !== null && testProvider(recorded, state, feature) === kind) {
      consider({ ok: recorded.ok, at: recorded.at, message: recorded.message, detail: recorded.detail });
    }
    const followed = live[feature];
    if (followed && (followed.status === "passed" || followed.status === "failed") && followed.finishedAt) {
      const provider = followed.provider || state.routes.find((row) => row.feature === feature)?.provider;
      if (provider === kind) consider({ ok: followed.status === "passed", at: followed.finishedAt, message: followed.message, detail: null });
    }
  }
  return best;
}

/** A failed test records no provider; it ran on the route the feature had then (best known: the current route). */
function testProvider(test: AiFeatureTestSummary, state: AiScreenState, feature: AiFeature): string | null {
  if (test.provider) return test.provider;
  const detailProvider = test.detail?.split(" · ")[1];
  return detailProvider || state.routes.find((row) => row.feature === feature)?.provider || null;
}

function credentialOf(state: AiScreenState, kind: AiProviderKind): CredentialState | null {
  return state.credentials.find((credential) => credential.provider === kind) ?? null;
}

export function providerStatus(kind: AiProviderKind, state: AiScreenState, draft: RoutingDraft, live: Partial<Record<AiFeature, LiveTest>>): ProviderStatus {
  const lastTest = latestProviderTest(kind, state, live);
  const health = state.status?.providers?.[kind] ?? null;
  let subtitle: string;
  let setUp: boolean;
  let unreadable = false;
  if (kind === "ollama") {
    const facts = state.status?.ollama ?? null;
    setUp = Boolean(facts?.configured);
    subtitle = facts?.host ?? (setUp ? "Address saved" : "No address saved");
  } else {
    const credential = credentialOf(state, kind);
    const hasKey = credential?.state === "saved" || credential?.state === "environment";
    unreadable = credential?.state === "unreadable";
    const keyText = !credential ? "Key state not known"
      : unreadable ? "Saved key cannot be read"
        : !hasKey ? "No key saved"
          : credential.hint ? `Key ${credential.hint}` : credential.state === "environment" ? "Key from the server environment" : "Key saved";
    if (kind === "openai_compatible") {
      const address = state.routing.compatible.baseUrl;
      setUp = hasKey && Boolean(address);
      subtitle = address ? `${address} · ${keyText.replace(/^Key /, "key ")}` : `No address saved · ${keyText.replace(/^Key /, "key ")}`;
    } else {
      setUp = hasKey;
      subtitle = credential?.state === "environment" && credential.hint ? `Key ${credential.hint} · server environment` : keyText;
    }
  }
  const failedOnRequests = Boolean(health?.lastFailure && (!health.lastOkAt || Date.parse(health.lastFailure.at) > Date.parse(health.lastOkAt)));
  const failedTest = lastTest?.ok === false;
  if (unreadable) {
    return { state: "failing", tone: "problem", pill: "Failing", subtitle, lastTest, failure: "The saved key cannot be read. Enter it again." };
  }
  if (!setUp) return { state: "not-set-up", tone: "info", pill: "Not set up", subtitle, lastTest, failure: null };
  if (failedTest || failedOnRequests) {
    const failure = failedOnRequests && health?.lastFailure
      ? failureInWords(health.lastFailure.outcome, health.lastFailure.errorCode)
      : lastTest?.detail ? failureInWords("PROVIDER_ERROR", lastTest.detail.split(" · ")[0] ?? null) : "The last test failed";
    return { state: "failing", tone: "problem", pill: "Failing", subtitle, lastTest, failure };
  }
  if (lastTest?.ok) return { state: "connected", tone: "good", pill: "Connected", subtitle, lastTest, failure: null };
  return { state: "untested", tone: "info", pill: "Not tested", subtitle, lastTest, failure: null };
}

const STATE_RANK: Readonly<Record<ProviderState, number>> = { connected: 0, failing: 1, untested: 2, "not-set-up": 3 };

export function orderedProviders(statuses: Record<AiProviderKind, ProviderStatus>): AiProviderKind[] {
  return [...PROVIDER_ORDER].sort((a, b) => STATE_RANK[statuses[a].state] - STATE_RANK[statuses[b].state] || PROVIDER_ORDER.indexOf(a) - PROVIDER_ORDER.indexOf(b));
}

/** Where a feature runs with the draft: its own route, or what the server resolved for the saved default. */
export function effectiveRoute(feature: AiFeature, state: AiScreenState, draft: RoutingDraft, vision: VisionSettings | null): { provider: string; model: string; fromDefault: boolean } | null {
  const own = draft.features[feature].route;
  if (own) return { provider: own.provider, model: own.model, fromDefault: false };
  if (AI_FEATURE_CATALOG[feature].usesImages && vision) return { provider: vision.provider, model: vision.model, fromDefault: true };
  if (!AI_FEATURE_CATALOG[feature].usesImages && draft.defaultRoute) return { provider: draft.defaultRoute.provider, model: draft.defaultRoute.model, fromDefault: true };
  const savedRoute = state.routing.features[feature].route;
  const resolved = state.routes.find((row) => row.feature === feature);
  if (!savedRoute && resolved?.provider && resolved.model && (AI_FEATURE_CATALOG[feature].usesImages || !state.routing.defaultRoute)) {
    return { provider: resolved.provider, model: resolved.model, fromDefault: true };
  }
  return null;
}

export function isCloud(provider: string): boolean {
  return provider !== "ollama";
}

/** A photo feature set to a cloud provider while its photo switch is off cannot run. */
export function isBlockedByPhotoRule(feature: AiFeature, state: AiScreenState, draft: RoutingDraft, vision: VisionSettings | null): boolean {
  if (!AI_FEATURE_CATALOG[feature].usesImages || !draft.features[feature].enabled) return false;
  const route = effectiveRoute(feature, state, draft, vision);
  return Boolean(route && isCloud(route.provider) && !draft.features[feature].allowCloudImages);
}

export type MonthFigure = { requests: number; knownMicroUsd: number; unknownCalls: number; local: boolean };

/** This month's requests and known cost for one feature, or one provider. Never folds unknown cost into $0. */
export function monthFigure(usage: Usage | null, match: (row: UsageRow) => boolean): MonthFigure | null {
  if (!usage) return null;
  const rows = usage.rows.filter(match);
  return {
    requests: rows.reduce((sum, row) => sum + row.calls, 0),
    knownMicroUsd: rows.reduce((sum, row) => sum + row.knownCostMicroUsd, 0),
    unknownCalls: rows.reduce((sum, row) => sum + row.unknownCostCalls, 0),
    local: rows.length > 0 && rows.every((row) => row.provider === "ollama"),
  };
}

export function money(micro: number): string {
  // US dollars, written "$14.72" as the provider bills (en-US places the plain "$" sign).
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(micro / 1_000_000);
}

export function count(value: number): string {
  return value.toLocaleString("en-AU");
}

export function millions(tokens: number): string {
  if (tokens === 0) return "0";
  const value = tokens / 1_000_000;
  return `${value >= 1 ? value.toFixed(1) : value.toFixed(2)} M`;
}

/** "today 09:02", "yesterday 16:40", "Tue 09:02", "3 Nov" in the organisation timezone. */
export function whenText(iso: string, timezone: string, now = new Date()): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "Not recorded";
  const day = (value: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
  const time = new Intl.DateTimeFormat("en-AU", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  const today = day(now);
  const yesterday = day(new Date(now.getTime() - 86_400_000));
  if (day(date) === today) return `today ${time}`;
  if (day(date) === yesterday) return `yesterday ${time}`;
  if (now.getTime() - date.getTime() < 6 * 86_400_000) return `${new Intl.DateTimeFormat("en-AU", { timeZone: timezone, weekday: "short" }).format(date)} ${time}`;
  return new Intl.DateTimeFormat("en-AU", { timeZone: timezone, day: "numeric", month: "short" }).format(date);
}

export function clockText(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-AU", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

/** The confidence band numbers the eligibility rule compares (lib/ai/vision.ts: low 0.4, medium 0.7, high 0.9). */
export const CONFIDENCE_BANDS = [
  { key: "low", label: "Low", value: 0.4 },
  { key: "medium", label: "Medium", value: 0.7 },
  { key: "high", label: "High", value: 0.9 },
] as const;
export type BandKey = (typeof CONFIDENCE_BANDS)[number]["key"] | "none";

/** The lowest band whose number reaches the minimum confidence; "none" when no band does. */
export function lowestDeductibleBand(minConfidence: number): BandKey {
  return CONFIDENCE_BANDS.find((band) => band.value >= minConfidence)?.key ?? "none";
}

/** The minimum confidence a band choice stores. High keeps the default 0.8; "none" stores 1. */
export function minConfidenceForBand(band: BandKey, current: number): number {
  if (lowestDeductibleBand(current) === band) return current;
  if (band === "low") return 0.4;
  if (band === "medium") return 0.7;
  if (band === "high") return 0.8;
  return 1;
}

export type StatusStrip = {
  ai: { on: boolean; setUp: boolean; title: string; detail: string };
  providers: { title: string; detail: string; failing: number };
  photos: { title: string; detail: string };
  cost: { title: string; detail: string };
};

export function builtFeatures(): AiFeature[] {
  return AI_FEATURES.filter((feature) => AI_FEATURE_CATALOG[feature].built);
}

/** Whether a photo feature's own workflow switch (AI workflow settings) is on. Text features have none. */
export function workflowOn(feature: AiFeature, vision: VisionSettings | null): boolean | null {
  if (feature === "photo_compare") return vision ? vision.comparisonEnabled : null;
  if (feature === "photo_assign") return vision ? vision.assignmentEnabled : null;
  return true;
}

export function statusStrip(state: AiScreenState, draft: RoutingDraft, vision: VisionSettings | null, statuses: Record<AiProviderKind, ProviderStatus>): StatusStrip {
  const built = builtFeatures();
  const on = built.filter((feature) => state.routing.features[feature].enabled && workflowOn(feature, vision) !== false);
  const unbuilt = AI_FEATURES.filter((feature) => !AI_FEATURE_CATALOG[feature].built).map((feature) => AI_FEATURE_CATALOG[feature].label);
  const working = PROVIDER_ORDER.filter((kind) => statuses[kind].state === "connected");
  const failing = PROVIDER_ORDER.filter((kind) => statuses[kind].state === "failing");
  const setUp = PROVIDER_ORDER.some((kind) => statuses[kind].state !== "not-set-up");
  const ai = !setUp
    ? { on: false, setUp, title: "AI is not set up", detail: "People continue manually" }
    : on.length === 0
      ? { on: false, setUp, title: "AI is off", detail: "Every feature is off; people continue manually" }
      : { on: true, setUp, title: "AI is on", detail: `${on.length} of ${built.length} built features on${unbuilt.length ? ` · ${unbuilt.join(", ")} not built` : ""}` };
  const providers = {
    title: working.length === 1 ? "1 provider connected" : `${working.length} providers connected`,
    detail: [working.map((kind) => shortProviderName(kind, draft)).join(", ") || "None tested yet", failing.length ? `${failing.length} ${failing.length === 1 ? "endpoint" : "endpoints"} failing` : ""].filter(Boolean).join(" · "),
    failing: failing.length,
  };
  const photoFeatures = AI_FEATURES.filter((feature) => AI_FEATURE_CATALOG[feature].usesImages && state.routing.features[feature].allowCloudImages);
  const photos = photoFeatures.length === 0
    ? { title: "Photos stay on this server", detail: "No feature may send photos to a cloud provider" }
    : { title: "Photos may leave this server", detail: `${photoFeatures.map((feature) => AI_FEATURE_CATALOG[feature].label).join(", ")} may send photos to a cloud provider` };
  let cost: StatusStrip["cost"];
  if (!state.usage) cost = { title: "Cost not known", detail: "This month's usage could not be read" };
  else {
    const total = monthFigure(state.usage, () => true)!;
    const unknownText = total.unknownCalls ? ` · ${count(total.unknownCalls)} at a price marked "Not known"` : "";
    cost = total.requests === 0
      ? { title: "No AI cost this month", detail: "0 requests" }
      : total.knownMicroUsd > 0 || total.unknownCalls === 0
      ? { title: `About ${money(total.knownMicroUsd)} this month`, detail: `${count(total.requests)} requests${unknownText}` }
      : { title: "Cost not known this month", detail: `${count(total.requests)} requests${unknownText}` };
  }
  return { ai, providers, photos, cost };
}

/** Nothing set up yet: the first-run guide replaces Sections 1 to 4. */
export function isFirstRun(statuses: Record<AiProviderKind, ProviderStatus>): boolean {
  return PROVIDER_ORDER.every((kind) => statuses[kind].state === "not-set-up");
}

/** Models a provider serves for the page's chips: from the routes and this month's usage. */
export function providerModels(kind: AiProviderKind, state: AiScreenState, draft: RoutingDraft, vision: VisionSettings | null): string[] {
  const models = new Set<string>();
  for (const feature of AI_FEATURES) {
    const route = effectiveRoute(feature, state, draft, vision);
    if (route?.provider === kind && AI_FEATURE_CATALOG[feature].built) models.add(route.model);
  }
  if (kind === "ollama") {
    if (state.status?.ollama?.visionModel) models.add(state.status.ollama.visionModel);
    if (state.status?.ollama?.textModel) models.add(state.status.ollama.textModel);
  }
  for (const row of state.usage?.rows ?? []) if (row.provider === kind) models.add(row.model);
  return Array.from(models);
}

export function featuresOn(kind: AiProviderKind, state: AiScreenState, draft: RoutingDraft, vision: VisionSettings | null): AiFeature[] {
  return builtFeatures().filter((feature) => effectiveRoute(feature, state, draft, vision)?.provider === kind);
}

/** A model name suggested when a provider is first chosen for a route. */
export function suggestedModel(provider: AiProviderKind, state: AiScreenState | null, photo: boolean): string {
  if (provider === "ollama") return (photo ? state?.status?.ollama?.visionModel : state?.status?.ollama?.textModel) ?? "gemma3:4b";
  if (provider === "anthropic") return "claude-sonnet-5";
  if (provider === "openai") return "gpt-4.1";
  return "model-name";
}

export function routeLabel(route: AiRoute | { provider: string; model: string } | null, draft: RoutingDraft | null): string {
  return route ? `${shortProviderName(route.provider, draft)} · ${route.model}` : "Not known";
}

/** What every section receives from the workspace: the read state, the drafts and the actions. */
export type AiPage = {
  state: AiScreenState;
  draft: RoutingDraft;
  vision: VisionSettings | null;
  visionDraft: VisionSettings | null;
  statuses: Record<AiProviderKind, ProviderStatus>;
  canEdit: boolean;
  /** Saving, or read-only: every field is frozen. */
  locked: boolean;
  /** Unsaved edits anywhere: tests are off until saved. */
  dirty: boolean;
  timezone: string;
  tests: Partial<Record<AiFeature, LiveTest>>;
  updateFeature: (feature: AiFeature, patch: Partial<FeatureDraft>) => void;
  setDraft: (update: (draft: RoutingDraft) => RoutingDraft) => void;
  setVisionDraft: (update: (vision: VisionSettings) => VisionSettings) => void;
  runTest: (feature: AiFeature) => void;
  openKey: (provider: SecretProvider, mode: "add" | "replace" | "remove", choose?: boolean) => void;
  askAllowPhotos: (feature: AiFeature) => void;
  openFeature: (feature: AiFeature) => void;
  openProvider: (kind: AiProviderKind) => void;
  openOllamaSetup: () => void;
  save: () => void;
};

export type FeatureTestView = { tone: "ok" | "bad" | "none"; text: string; detail: string | null; running: boolean; elapsedSeconds: number | null };

/** The last test of a feature in words: one followed here wins over the recorded one. */
export function featureTestView(feature: AiFeature, page: Pick<AiPage, "state" | "tests" | "timezone">, now = Date.now()): FeatureTestView {
  const live = page.tests[feature];
  if (live && (live.status === "queued" || live.status === "running")) {
    const elapsed = Math.max(0, Math.round((now - live.startedAt) / 1000));
    return { tone: "none", text: live.status === "running" ? `Running · ${elapsed} s` : "Queued", detail: live.message, running: true, elapsedSeconds: elapsed };
  }
  if (live?.status === "passed" && live.finishedAt) return { tone: "ok", text: `Passed ${whenText(live.finishedAt, page.timezone)}`, detail: `${live.model ?? ""} answered${live.durationMs !== undefined ? ` in ${(live.durationMs / 1000).toFixed(1)} s` : ""}. ${live.message}`.trim(), running: false, elapsedSeconds: null };
  if (live?.status === "failed" && live.finishedAt) return { tone: "bad", text: `Failed ${whenText(live.finishedAt, page.timezone)}`, detail: live.message, running: false, elapsedSeconds: null };
  if (live?.status === "error") return { tone: "bad", text: "Not tested", detail: live.message, running: false, elapsedSeconds: null };
  if (!page.state.status?.lastTests) return { tone: "none", text: "Not known", detail: "Test results could not be read.", running: false, elapsedSeconds: null };
  const recorded = page.state.status.lastTests[feature];
  if (!recorded) return { tone: "none", text: "Not tested", detail: null, running: false, elapsedSeconds: null };
  if (recorded.ok === true) return { tone: "ok", text: `Passed ${whenText(recorded.at, page.timezone)}`, detail: recorded.message, running: false, elapsedSeconds: null };
  if (recorded.ok === false) return { tone: "bad", text: `Failed ${whenText(recorded.at, page.timezone)}`, detail: [recorded.message, recorded.detail].filter(Boolean).join(" "), running: false, elapsedSeconds: null };
  return { tone: "none", text: recorded.status === "RUNNING" ? "Running" : "Queued", detail: "Queued by someone; not finished yet.", running: false, elapsedSeconds: null };
}

/** "1,020 requests · local, no charge" / "61 requests · $14.20" / "9 requests · Not known". */
export function monthText(figure: MonthFigure | null): { requests: string; cost: string; unknown: boolean } {
  if (!figure) return { requests: "Not known", cost: "", unknown: true };
  const requests = `${count(figure.requests)} ${figure.requests === 1 ? "request" : "requests"}`;
  if (figure.requests === 0) return { requests, cost: "", unknown: false };
  if (figure.local) return { requests, cost: "local, no charge", unknown: false };
  if (figure.unknownCalls > 0 && figure.knownMicroUsd === 0) return { requests, cost: "Not known", unknown: true };
  if (figure.unknownCalls > 0) return { requests, cost: `${money(figure.knownMicroUsd)} + ${count(figure.unknownCalls)} Not known`, unknown: true };
  return { requests, cost: money(figure.knownMicroUsd), unknown: false };
}
