"use client";

/**
 * Section 1, "Where AI runs": one card per provider (Local Ollama, Anthropic,
 * OpenAI-compatible, OpenAI) with the title band (sage connected, wine
 * failing, sky not set up or not tested), a Local or Cloud tag naming where
 * requests go, the key's last four characters, models, last test and the
 * actions. Below them the default for text features and the cloud deadline.
 * On a phone the cards become a list and each opens its provider sheet.
 */
import * as React from "react";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { EBottomSheet } from "@/components/v2/ui/bottom-sheet";
import { EToneBand, ETonePill, toneMutedClass } from "@/components/v2/ui/tone-band";
import { cn } from "@/lib/utils";
import { AI_FEATURE_CATALOG, AI_FEATURES, AI_PROVIDER_KINDS, type AiFeature, type AiProviderKind } from "@/lib/ai/provider/routing-schema";
import {
  featuresOn, monthFigure, monthText, orderedProviders, providerModels, providerTitle, providerWhere,
  shortProviderName, suggestedModel, whenText,
  type AiPage, type SecretProvider,
} from "./ai-config-model";
import { AI_FIELD, AI_LABEL, AI_MUTED, AiModelChips, AiResultText, AiSectionHeading, AiWhereTag } from "./ai-ui";

const DEADLINES = [10, 20, 30, 45, 60, 90, 120, 180, 300];

function isSecret(kind: AiProviderKind): kind is SecretProvider {
  return kind !== "ollama";
}

/** The feature a provider's "Test connection" runs: a text feature first (cheaper), else a photo one. */
function testFeatureFor(kind: AiProviderKind, page: AiPage): AiFeature | null {
  const on = featuresOn(kind, page.state, page.draft, page.visionDraft);
  return on.find((feature) => !AI_FEATURE_CATALOG[feature].usesImages) ?? on[0] ?? null;
}

function hasKey(kind: AiProviderKind, page: AiPage): boolean {
  const credential = page.state.credentials.find((item) => item.provider === kind);
  return credential?.state === "saved" || credential?.state === "environment";
}

/** Explicit routes to this provider that "Move … to default" clears. */
function ownRoutesTo(kind: AiProviderKind, page: AiPage): AiFeature[] {
  return AI_FEATURES.filter((feature) => page.draft.features[feature].route?.provider === kind && AI_FEATURE_CATALOG[feature].built);
}

function ProviderActions({ kind, page, phone = false }: { kind: AiProviderKind; page: AiPage; phone?: boolean }) {
  const status = page.statuses[kind];
  const testFeature = testFeatureFor(kind, page);
  const testing = testFeature ? ["queued", "running"].includes(page.tests[testFeature]?.status ?? "") : false;
  const testTitle = !testFeature ? `No feature uses ${shortProviderName(kind, page.draft)} yet. Choose it for a feature in Section 2, save, then test.` : page.dirty ? "Save changes first; Test is off while there are unsaved edits." : undefined;
  const test = status.state === "not-set-up" ? null : (
    <EButton type="button" size="sm" variant={status.state === "failing" ? "ghost" : "outline"} className={phone ? "w-full" : undefined} disabled={!page.canEdit || !testFeature || page.dirty || testing} title={testTitle} onClick={() => testFeature && page.runTest(testFeature)}>
      {testing ? "Testing…" : status.state === "failing" ? "Test again" : "Test connection"}
    </EButton>
  );
  if (!page.canEdit) return test ? <div className="mt-auto flex flex-wrap gap-1.5">{test}</div> : null;
  const moveable = status.state === "failing" ? ownRoutesTo(kind, page) : [];
  return (
    <div className={cn("mt-auto flex flex-wrap gap-1.5", phone && "flex-col")}>
      {status.state === "failing" && isSecret(kind) ? <EButton type="button" size="sm" className={phone ? "w-full" : undefined} disabled={page.locked} onClick={() => page.openKey(kind, "replace")}>Replace key…</EButton> : null}
      {moveable.length ? (
        <EButton type="button" size="sm" variant="outline" className={phone ? "w-full" : undefined} disabled={page.locked} onClick={() => moveable.forEach((feature) => page.updateFeature(feature, { route: null }))}>
          Move {moveable.length === 1 ? AI_FEATURE_CATALOG[moveable[0]].label.split(" (")[0] : `${moveable.length} features`} to default
        </EButton>
      ) : null}
      {test}
      {kind === "ollama" ? <EButton type="button" size="sm" variant="ghost" onClick={page.openOllamaSetup}>Ollama setup ›</EButton> : null}
      {isSecret(kind) && status.state !== "failing" ? (
        hasKey(kind, page)
          ? <><EButton type="button" size="sm" variant="outline" className={phone ? "w-full" : undefined} disabled={page.locked} onClick={() => page.openKey(kind, "replace")}>Replace key…</EButton>
            <EButton type="button" size="sm" variant="ghost" className={phone ? "w-full" : undefined} disabled={page.locked} onClick={() => page.openKey(kind, "remove")}>Remove key…</EButton></>
          : <EButton type="button" size="sm" className={phone ? "w-full" : undefined} disabled={page.locked} onClick={() => page.openKey(kind, "add")}>Add key…</EButton>
      ) : null}
      {isSecret(kind) && status.state === "failing" && hasKey(kind, page) ? <EButton type="button" size="sm" variant="ghost" className={phone ? "w-full" : undefined} disabled={page.locked} onClick={() => page.openKey(kind, "remove")}>Remove key…</EButton> : null}
    </div>
  );
}

/** The compatible endpoint's address and name (saved with Save changes). */
function CompatibleFields({ page }: { page: AiPage }) {
  const [open, setOpen] = React.useState(!page.draft.compatible.baseUrl);
  const id = React.useId();
  return (
    <div className="space-y-2">
      <button type="button" aria-expanded={open} aria-controls={id} className="min-h-11 text-left text-[0.75rem] font-medium underline sm:min-h-0" onClick={() => setOpen((value) => !value)}>
        {open ? "Hide endpoint address" : "Endpoint address and name"}
      </button>
      <div id={id} hidden={!open} className="space-y-2">
        <label className="block">
          <span className={AI_LABEL}>Base address (https)</span>
          <input className={cn(AI_FIELD, "font-mono")} inputMode="url" autoComplete="off" spellCheck={false} disabled={page.locked} value={page.draft.compatible.baseUrl} placeholder="https://api.example.com/v1" onChange={(event) => page.setDraft((old) => ({ ...old, compatible: { ...old.compatible, baseUrl: event.target.value } }))} />
        </label>
        <label className="block">
          <span className={AI_LABEL}>Name shown here</span>
          <input className={AI_FIELD} maxLength={60} disabled={page.locked} value={page.draft.compatible.label} onChange={(event) => page.setDraft((old) => ({ ...old, compatible: { ...old.compatible, label: event.target.value } }))} />
        </label>
        <p className={cn("text-[0.6875rem]", AI_MUTED)}>Public https addresses only; use Local Ollama for your own network. Saved with Save changes.</p>
      </div>
    </div>
  );
}

/** What a failing provider means for people, and the likely fix. */
function FailureDetails({ kind, page }: { kind: AiProviderKind; page: AiPage }) {
  const status = page.statuses[kind];
  const health = page.state.status?.providers?.[kind];
  const users = featuresOn(kind, page.state, page.draft, page.visionDraft).map((feature) => AI_FEATURE_CATALOG[feature].label);
  const at = health?.lastFailure?.at ?? status.lastTest?.at ?? null;
  const real = health?.failuresSinceOk ?? 0;
  const name = shortProviderName(kind, page.draft);
  const auth = (health?.lastFailure?.errorCode ?? status.lastTest?.detail ?? "").startsWith("AUTH");
  return (
    <div className="space-y-2">
      <p><b>{status.failure}</b>{at ? ` at ${whenText(at, page.timezone)}` : ""}{real ? `, on ${real} real ${real === 1 ? "request" : "requests"} since the last success` : ""}.</p>
      {users.length ? (
        <div className="rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-raised))] p-2.5 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
          <b className="block text-[hsl(var(--e-foreground))]">What people see</b>
          {users.join(", ")}: &quot;AI unavailable for this feature. Continue manually.&quot; Nothing is retried in their name.
        </div>
      ) : null}
      <p className="text-[0.75rem]">Likely fix: {auth ? `the key was revoked or expired at ${name}. Replace it` : "check the key, model name and the provider's status, then test again"}{users.length ? ", or point these features at the default." : "."}</p>
      {status.lastTest?.detail ? <p className="rounded-[6px] bg-[hsl(var(--e-surface-raised))] px-2 py-1 font-mono text-[0.6875rem] text-[hsl(var(--e-text-secondary))]">Technical detail: {status.lastTest.detail}</p> : null}
    </div>
  );
}

function ProviderBody({ kind, page }: { kind: AiProviderKind; page: AiPage }) {
  const status = page.statuses[kind];
  const users = featuresOn(kind, page.state, page.draft, page.visionDraft);
  const month = monthText(monthFigure(page.state.usage, (row) => row.provider === kind));
  const lastTest = status.lastTest;
  const local = kind === "ollama";
  return (
    <>
      <AiWhereTag local={local}>{providerWhere(kind)}</AiWhereTag>
      {status.state === "failing" ? <FailureDetails kind={kind} page={page} /> : null}
      {status.state === "not-set-up" ? (
        <p className={AI_MUTED}>
          {local
            ? "Set the address of your own Ollama server to keep every request and photo on this server."
            : `Add a key to use ${shortProviderName(kind, page.draft)} models for any feature. Keys are stored encrypted; only the last four characters are ever shown again.`}
        </p>
      ) : (
        <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 gap-y-1">
          <dt className={AI_MUTED}>Models</dt>
          <dd className="min-w-0"><AiModelChips models={providerModels(kind, page.state, page.draft, page.visionDraft)} /></dd>
          <dt className={AI_MUTED}>Last test</dt>
          <dd>{lastTest ? <AiResultText tone={lastTest.ok ? "ok" : "bad"}>{lastTest.ok ? "Passed" : "Failed"} {whenText(lastTest.at, page.timezone)}</AiResultText> : <AiResultText tone="none">{page.state.status?.lastTests ? "Not tested" : "Not known"}</AiResultText>}</dd>
          <dt className={AI_MUTED}>{local ? "Cost" : "Used by"}</dt>
          <dd className="min-w-0 [overflow-wrap:anywhere]">{local ? "No provider charge" : users.length ? users.map((feature) => AI_FEATURE_CATALOG[feature].label.split(" (")[0]).join(", ") : "No feature yet"}</dd>
          {!local ? <><dt className={AI_MUTED}>This month</dt><dd className={month.unknown ? "font-semibold text-[hsl(var(--e-warning))]" : undefined}>{month.requests}{month.cost ? ` · ${month.cost}` : ""}</dd></> : null}
        </dl>
      )}
      {kind === "openai_compatible" && page.canEdit ? <CompatibleFields page={page} /> : null}
    </>
  );
}

function ProviderBand({ kind, page, title }: { kind: AiProviderKind; page: AiPage; title: string }) {
  const status = page.statuses[kind];
  return (
    <EToneBand tone={status.tone} className="-mx-3.5 flex items-start justify-between gap-2.5 border-b px-3.5 pb-2 pt-2.5">
      <div className="min-w-0">
        <b className="block text-[0.875rem]">{title}</b>
        <span className={cn("block text-[0.71875rem] [overflow-wrap:anywhere]", toneMutedClass(status.tone))}>{status.subtitle}</span>
      </div>
      <ETonePill tone={status.tone} className="shrink-0">{status.pill}</ETonePill>
    </EToneBand>
  );
}

export function ProvidersSection({ page, ollamaSetup }: { page: AiPage; ollamaSetup: React.ReactNode }) {
  const order = orderedProviders(page.statuses);
  return (
    <section aria-labelledby="ai-where-heading" id="where" className="min-w-0 space-y-3 scroll-mt-24">
      <AiSectionHeading id="ai-where-heading" number={1} title="Where AI runs" aside="Local runs on your own server. Cloud sends the request to the company named." />
      <div className="grid min-w-0 grid-cols-1 gap-3 max-sm:hidden sm:grid-cols-2 xl:grid-cols-4">
        {order.map((kind) => (
          <section key={kind} aria-label={providerTitle(kind, page.draft)} className="flex min-w-0 flex-col gap-2 overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3.5 pb-3 text-[0.78125rem]">
            <ProviderBand kind={kind} page={page} title={providerTitle(kind, page.draft)} />
            <ProviderBody kind={kind} page={page} />
            <ProviderActions kind={kind} page={page} />
          </section>
        ))}
      </div>
      <ECard className="overflow-hidden sm:hidden">
        <ul aria-label="Providers">
          {order.map((kind) => {
            const status = page.statuses[kind];
            const sub = status.state === "failing" ? status.failure : status.state === "not-set-up" ? (kind === "ollama" ? "Local · no address" : "Cloud · no key") : `${kind === "ollama" ? "Local · on this server" : `Cloud · ${status.subtitle.replace(/^Key /, "")}`}`;
            return (
              <li key={kind} className="border-t border-[hsl(var(--e-border))] first:border-0">
                <button type="button" className="flex min-h-[52px] w-full items-center gap-2.5 px-3 py-2 text-left" onClick={() => page.openProvider(kind)}>
                  <span className="min-w-0 flex-1"><b className="block text-[0.875rem]">{providerTitle(kind, page.draft).replace(" (OpenAI-compatible)", "")}</b><span className={cn("block text-[0.71875rem] [overflow-wrap:anywhere]", status.state === "failing" ? "text-[hsl(var(--e-danger))]" : AI_MUTED)}>{sub}</span></span>
                  <ETonePill tone={status.tone} className="shrink-0 border border-[hsl(var(--e-border))]">{status.pill}</ETonePill>
                </button>
              </li>
            );
          })}
        </ul>
      </ECard>
      {ollamaSetup}
      <DefaultsCard page={page} />
    </section>
  );
}

function DefaultsCard({ page }: { page: AiPage }) {
  const route = page.draft.defaultRoute;
  const built = AI_FEATURES.filter((feature) => AI_FEATURE_CATALOG[feature].built);
  const deadlines = new Set(built.map((feature) => page.draft.features[feature].timeoutSeconds));
  const shared = deadlines.size === 1 ? Array.from(deadlines)[0] : null;
  return (
    <ECard className="flex min-w-0 flex-wrap items-end gap-4 p-4">
      <div className="min-w-0 basis-[20rem]">
        <label className={AI_LABEL} htmlFor="ai-default-provider">Default for text features</label>
        <div className="grid min-w-0 grid-cols-1 gap-1.5 sm:grid-cols-2">
          <select id="ai-default-provider" className={AI_FIELD} value={route?.provider ?? ""} disabled={page.locked} onChange={(event) => {
            const provider = event.target.value as AiProviderKind | "";
            page.setDraft((old) => ({ ...old, defaultRoute: provider ? { provider, model: old.defaultRoute?.provider === provider ? old.defaultRoute.model : suggestedModel(provider, page.state, false) } : null }));
          }}>
            <option value="">Server setting (AI_TEXT_PROVIDER)</option>
            {AI_PROVIDER_KINDS.map((provider) => <option key={provider} value={provider}>{shortProviderName(provider, page.draft)}</option>)}
          </select>
          {route ? <input aria-label="Default model for text features" className={cn(AI_FIELD, "font-mono")} value={route.model} disabled={page.locked} spellCheck={false} autoComplete="off" onChange={(event) => page.setDraft((old) => (old.defaultRoute ? { ...old, defaultRoute: { ...old.defaultRoute, model: event.target.value } } : old))} /> : null}
        </div>
      </div>
      <div className="w-full sm:w-[12.5rem]">
        <label className={AI_LABEL} htmlFor="ai-deadline">Cloud deadline</label>
        <select id="ai-deadline" className={AI_FIELD} value={shared ?? ""} disabled={page.locked} onChange={(event) => {
          const seconds = Number(event.target.value);
          if (!seconds) return;
          page.setDraft((old) => ({ ...old, features: Object.fromEntries(AI_FEATURES.map((feature) => [feature, { ...old.features[feature], timeoutSeconds: seconds }])) as typeof old.features }));
        }}>
          {shared === null ? <option value="">Differs by feature</option> : null}
          {(shared !== null && !DEADLINES.includes(shared) ? [...DEADLINES, shared].sort((a, b) => a - b) : DEADLINES).map((seconds) => <option key={seconds} value={seconds}>{seconds} seconds</option>)}
        </select>
      </div>
      <p className={cn("min-w-0 flex-1 basis-[16rem] text-[0.75rem]", AI_MUTED)}>
        Features set to &quot;Use default&quot; follow this. &quot;Server setting&quot; keeps what the hosting environment says (AI_TEXT_PROVIDER). Photo features never follow the text default; they choose their own provider in Section 2. The deadline applies to every feature; a feature&apos;s Settings can differ.
      </p>
    </ECard>
  );
}

export function ProviderSheet({ page, kind, onClose }: { page: AiPage; kind: AiProviderKind | null; onClose: () => void }) {
  if (!kind) return null;
  const title = providerTitle(kind, page.draft);
  const month = monthText(monthFigure(page.state.usage, (row) => row.provider === kind));
  const users = featuresOn(kind, page.state, page.draft, page.visionDraft);
  const status = page.statuses[kind];
  return (
    <EBottomSheet open tall onOpenChange={(next) => { if (!next) onClose(); }} title={title} description={providerWhere(kind)}>
      <div className="min-w-0 space-y-3 text-[0.8125rem]">
        <div className="flex min-w-0 flex-col gap-2 overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] px-3.5 pb-3">
          <ProviderBand kind={kind} page={page} title={status.state === "connected" ? "Connected" : status.pill} />
          <ProviderBody kind={kind} page={page} />
        </div>
        {status.state !== "not-set-up" ? (
          <>
            <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-[hsl(var(--e-muted-foreground))]">Used by</p>
            <ul className="overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))]">
              {users.length ? users.map((feature) => (
                <li key={feature} className="flex min-h-11 items-center justify-between gap-2 border-t border-[hsl(var(--e-border))] px-3 first:border-0">
                  <span>{AI_FEATURE_CATALOG[feature].label}</span>
                  <span className={AI_MUTED}>{page.draft.features[feature].route ? "own choice" : "default"}</span>
                </li>
              )) : <li className={cn("px-3 py-2", AI_MUTED)}>No feature uses it yet.</li>}
            </ul>
            <div className="grid grid-cols-2 gap-1.5">
              <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2"><span className={cn("block text-[0.6875rem]", AI_MUTED)}>This month</span><b className="block tabular-nums">{month.cost || month.requests}</b><span className={cn("block text-[0.6875rem]", AI_MUTED)}>{month.requests}</span></div>
              <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2"><span className={cn("block text-[0.6875rem]", AI_MUTED)}>Deadline</span><b className="block tabular-nums">{kind === "ollama" ? "Own setting" : `${page.draft.features.assistant.timeoutSeconds} s`}</b><span className={cn("block text-[0.6875rem]", AI_MUTED)}>{kind === "ollama" ? "Ollama setup" : "cloud requests"}</span></div>
            </div>
          </>
        ) : null}
        <ProviderActions kind={kind} page={page} phone />
      </div>
    </EBottomSheet>
  );
}
