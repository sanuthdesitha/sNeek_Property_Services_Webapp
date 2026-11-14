"use client";

/**
 * Section 2, "What AI does": one row per feature (on/off, where it runs with
 * "Use default" naming the default, the photo switch with its consequence,
 * the hourly limit, the last test and this month's cost). Unbuilt features
 * are shown "Not available yet". On a phone the table becomes a list and each
 * feature opens its settings sheet; on a desktop "Settings" opens the same
 * sheet for the per-feature deadline and the photo workflow controls.
 */
import * as React from "react";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { EBottomSheet } from "@/components/v2/ui/bottom-sheet";
import { EToneCard, EToneRowCell } from "@/components/v2/ui/tone-band";
import { cn } from "@/lib/utils";
import {
  AI_FEATURE_CATALOG, AI_FEATURES, AI_PROVIDER_KINDS,
  type AiFeature, type AiProviderKind,
} from "@/lib/ai/provider/routing-schema";
import type { VisionSettings } from "@/lib/ai/vision-settings-schema";
import {
  clockText, effectiveRoute, featureTestView, isBlockedByPhotoRule, isCloud, monthFigure, monthText,
  PROVIDER_NAME, routeLabel, shortProviderName, suggestedModel, workflowOn,
  type AiPage, type FeatureDraft,
} from "./ai-config-model";
import { AI_FIELD, AI_LABEL, AI_MUTED, AiResultText, AiSectionHeading, AiSpinner, AiSwitch } from "./ai-ui";

const PHOTO_TEXT: Partial<Record<AiFeature, string>> = { explain_flag: "Text of the finding only" };

function useTick(active: boolean) {
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [active]);
}

/** Which providers are failing, so rows routed to them can say so. */
function failingProviders(page: AiPage): Set<string> {
  return new Set(AI_PROVIDER_KINDS.filter((kind) => page.statuses[kind].state === "failing"));
}

/** The provider select (with "Use default …") and, for an own route, the model box. */
export function FeatureRoutePicker({ page, feature, compact = false }: { page: AiPage; feature: AiFeature; compact?: boolean }) {
  const settings = page.draft.features[feature];
  const photo = AI_FEATURE_CATALOG[feature].usesImages;
  const label = AI_FEATURE_CATALOG[feature].label;
  const resolved = effectiveRoute(feature, page.state, { ...page.draft, features: { ...page.draft.features, [feature]: { ...settings, route: null } } }, page.visionDraft);
  const defaultText = photo
    ? `Use photo default${resolved ? ` · ${routeLabel(resolved, page.draft)}` : ""}`
    : `Use default${resolved ? ` · ${routeLabel(resolved, page.draft)}` : page.draft.defaultRoute ? "" : " · server setting"}`;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", compact ? "" : "sm:max-w-[15rem]")}>
      <select
        aria-label={`Runs on: ${label}`}
        className={AI_FIELD}
        value={settings.route?.provider ?? ""}
        disabled={page.locked}
        onChange={(event) => {
          const provider = event.target.value as AiProviderKind | "";
          page.updateFeature(feature, { route: provider ? { provider, model: settings.route?.provider === provider ? settings.route.model : suggestedModel(provider, page.state, photo) } : null });
        }}
      >
        <option value="">{defaultText}</option>
        {AI_PROVIDER_KINDS.map((provider) => <option key={provider} value={provider}>{shortProviderName(provider, page.draft)}</option>)}
      </select>
      {settings.route ? (
        <input
          aria-label={`Model for ${label}`}
          className={cn(AI_FIELD, "font-mono")}
          value={settings.route.model}
          autoComplete="off"
          spellCheck={false}
          disabled={page.locked}
          onChange={(event) => settings.route && page.updateFeature(feature, { route: { ...settings.route, model: event.target.value } })}
        />
      ) : null}
    </div>
  );
}

/** The photo switch and its consequence in words. */
function PhotoCell({ page, feature }: { page: AiPage; feature: AiFeature }) {
  const definition = AI_FEATURE_CATALOG[feature];
  if (!definition.usesImages) return <span className={cn("text-[0.75rem]", AI_MUTED)}>{PHOTO_TEXT[feature] ?? "No photos"}</span>;
  const allowed = page.draft.features[feature].allowCloudImages;
  const route = effectiveRoute(feature, page.state, page.draft, page.visionDraft);
  const company = route && isCloud(route.provider) ? shortProviderName(route.provider, page.draft) : "a cloud provider";
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="flex items-center gap-2">
        <AiSwitch
          checked={allowed}
          disabled={page.locked}
          label={`Send photos to a cloud provider: ${definition.label}`}
          onChange={(next) => (next ? page.askAllowPhotos(feature) : page.updateFeature(feature, { allowCloudImages: false }))}
        />
        <span className="text-[0.8125rem]">{allowed ? `May go to ${company}` : "Stay on this server"}</span>
      </span>
      <span className={cn("text-[0.71875rem]", AI_MUTED)}>
        {allowed
          ? `Photos go to ${company} with the time and address stamp blacked out.`
          : "Runs only on Local Ollama. Cloud would get photos with the time and address stamp blacked out."}
      </span>
    </div>
  );
}

function LimitInput({ page, feature, wide = false }: { page: AiPage; feature: AiFeature; wide?: boolean }) {
  const value = page.draft.features[feature].hourlyLimitPerActor;
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      <input
        type="number"
        inputMode="numeric"
        min={1}
        max={10000}
        step={1}
        aria-label={`Requests per person per hour: ${AI_FEATURE_CATALOG[feature].label}`}
        className={cn(AI_FIELD, "tabular-nums", wide ? "" : "w-[4.75rem]")}
        value={Number.isFinite(value) ? value : ""}
        disabled={page.locked}
        onChange={(event) => page.updateFeature(feature, { hourlyLimitPerActor: Number(event.target.value) })}
      />
      {wide ? null : <span className={cn("text-[0.75rem]", AI_MUTED)}>/ person / h</span>}
    </span>
  );
}

function TestCell({ page, feature, withButton = true }: { page: AiPage; feature: AiFeature; withButton?: boolean }) {
  const view = featureTestView(feature, page);
  useTick(view.running);
  const testOff = !page.canEdit || page.dirty || view.running || !AI_FEATURE_CATALOG[feature].built;
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <AiResultText tone={view.tone}>{view.running ? <AiSpinner /> : null}{view.text}</AiResultText>
      {view.detail && view.tone === "bad" ? <span className={cn("text-[0.6875rem] [overflow-wrap:anywhere]", AI_MUTED)}>{view.detail}</span> : null}
      {withButton ? (
        <EButton
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2"
          disabled={testOff}
          title={page.dirty ? "Save changes first; Test is off while there are unsaved edits." : !page.canEdit ? "Administrators run tests." : undefined}
          onClick={() => page.runTest(feature)}
          aria-label={`Test ${AI_FEATURE_CATALOG[feature].label}`}
        >Test</EButton>
      ) : null}
    </div>
  );
}

function MonthCell({ page, feature }: { page: AiPage; feature: AiFeature }) {
  const text = monthText(monthFigure(page.state.usage, (row) => row.feature === feature));
  return (
    <div className="whitespace-nowrap text-right tabular-nums">
      {text.requests}
      {text.cost ? <div className={cn("text-[0.75rem]", text.unknown ? "font-semibold text-[hsl(var(--e-warning))]" : text.cost.startsWith("local") ? AI_MUTED : "")}>{text.cost}</div> : null}
    </div>
  );
}

/** Notes under "Runs on": provider failing, workflow switch off, blocked. */
function RowNotes({ page, feature, failing }: { page: AiPage; feature: AiFeature; failing: Set<string> }) {
  const route = effectiveRoute(feature, page.state, page.draft, page.visionDraft);
  const notes: React.ReactNode[] = [];
  if (route && failing.has(route.provider)) notes.push(<AiResultText key="failing" tone="bad">Provider failing: people see &quot;continue manually&quot;</AiResultText>);
  if (isBlockedByPhotoRule(feature, page.state, page.draft, page.visionDraft)) notes.push(<AiResultText key="blocked" tone="bad">Blocked: photos may not leave this server</AiResultText>);
  if (workflowOn(feature, page.visionDraft) === false) notes.push(<span key="workflow" className={cn("text-[0.71875rem]", AI_MUTED)}>Photo workflow switch is off (Settings)</span>);
  return notes.length ? <div className="mt-1 flex flex-col gap-0.5">{notes}</div> : null;
}

export function FeaturesSection({ page }: { page: AiPage }) {
  const failing = failingProviders(page);
  const blocked = AI_FEATURES.filter((feature) => isBlockedByPhotoRule(feature, page.state, page.draft, page.visionDraft));
  const limitHits = page.state.status?.limitHits ?? null;
  const hitFeatures = limitHits ? AI_FEATURES.filter((feature) => limitHits[feature]?.people.length) : [];
  return (
    <section aria-labelledby="ai-what-heading" id="what" className="min-w-0 space-y-3 scroll-mt-24">
      <AiSectionHeading id="ai-what-heading" number={2} title="What AI does" aside={'Every result is a suggestion a person confirms. When a feature is off or blocked, people see "AI unavailable, continue manually".'} />

      {blocked.length || hitFeatures.length ? (
        <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
          {blocked.map((feature) => <BlockedCard key={feature} page={page} feature={feature} />)}
          {hitFeatures.map((feature) => <LimitHitCard key={feature} page={page} feature={feature} />)}
        </div>
      ) : null}

      {/* Desktop and tablet: one table row per feature. */}
      <ECard className="overflow-hidden max-sm:hidden">
        <div role="region" aria-label="AI features" tabIndex={0} className="overflow-x-auto">
          <table className="w-full min-w-[60rem] text-left text-[0.8125rem]">
            <thead className="border-b border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
              <tr>
                <th scope="col" className="w-[15rem] px-3 py-2 font-semibold">Feature</th>
                <th scope="col" className="px-3 py-2 font-semibold">On</th>
                <th scope="col" className="w-[14rem] px-3 py-2 font-semibold">Runs on</th>
                <th scope="col" className="w-[15rem] px-3 py-2 font-semibold">Photos</th>
                <th scope="col" className="px-3 py-2 font-semibold">Limit</th>
                <th scope="col" className="px-3 py-2 font-semibold">Last test</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">This month</th>
              </tr>
            </thead>
            <tbody>
              {AI_FEATURES.map((feature) => {
                const definition = AI_FEATURE_CATALOG[feature];
                const settings: FeatureDraft = page.draft.features[feature];
                if (!definition.built) {
                  return (
                    <tr key={feature} className="border-b border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] align-top text-[hsl(var(--e-muted-foreground))] last:border-0">
                      <td className="px-3 py-2.5"><b className="text-[hsl(var(--e-foreground))]">{definition.label}</b><div className="text-[0.75rem]">{definition.description}</div></td>
                      <td className="px-3 py-2.5"><AiSwitch checked={false} disabled label={`${definition.label}: not available`} onChange={() => undefined} /></td>
                      <td className="px-3 py-2.5" colSpan={4}>
                        Not available yet. Routing can be chosen ahead; it has no effect until the feature is built.
                        <div className="mt-1"><EButton type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={() => page.openFeature(feature)}>Choose routing ahead</EButton></div>
                      </td>
                      <td className="px-3 py-2.5 text-right">–</td>
                    </tr>
                  );
                }
                const blockedRow = isBlockedByPhotoRule(feature, page.state, page.draft, page.visionDraft);
                return (
                  <tr key={feature} className="border-b border-[hsl(var(--e-border))] align-top last:border-0">
                    <EToneRowCell tone={blockedRow ? "attention" : null} className="px-3 py-2.5">
                      <b>{definition.label}</b>
                      <div className={cn("text-[0.75rem]", blockedRow ? "" : AI_MUTED)}>{definition.description}</div>
                      <EButton type="button" size="sm" variant="ghost" className="mt-1 h-7 px-2" onClick={() => page.openFeature(feature)} aria-label={`Settings for ${definition.label}`}>Settings</EButton>
                    </EToneRowCell>
                    <td className="px-3 py-2.5"><AiSwitch checked={settings.enabled} disabled={page.locked} label={`Use AI for ${definition.label}`} onChange={(enabled) => page.updateFeature(feature, { enabled })} /></td>
                    <td className="px-3 py-2.5"><FeatureRoutePicker page={page} feature={feature} /><RowNotes page={page} feature={feature} failing={failing} /></td>
                    <td className="px-3 py-2.5"><PhotoCell page={page} feature={feature} /></td>
                    <td className="px-3 py-2.5"><LimitInput page={page} feature={feature} /></td>
                    <td className="px-3 py-2.5"><TestCell page={page} feature={feature} /></td>
                    <td className="px-3 py-2.5"><MonthCell page={page} feature={feature} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </ECard>

      {/* Phone: a list; each feature opens its settings sheet. */}
      <ECard className="overflow-hidden sm:hidden">
        <ul aria-label="AI features">
          {AI_FEATURES.map((feature) => <PhoneFeatureRow key={feature} page={page} feature={feature} failing={failing} />)}
        </ul>
      </ECard>

      <p className={cn("text-[0.75rem]", AI_MUTED)}>
        &quot;Test&quot; sends one made-up request (no property data; photo tests use generated colour cards) as a queued task and shows Queued, Running, then Passed or the reason it failed. Limits are 1 to 10,000 requests per person per hour; a reached limit says so to the person and resets on the hour.
      </p>
    </section>
  );
}

function PhoneFeatureRow({ page, feature, failing }: { page: AiPage; feature: AiFeature; failing: Set<string> }) {
  const definition = AI_FEATURE_CATALOG[feature];
  const settings = page.draft.features[feature];
  const route = effectiveRoute(feature, page.state, page.draft, page.visionDraft);
  const month = monthText(monthFigure(page.state.usage, (row) => row.feature === feature));
  let sub: React.ReactNode;
  if (!definition.built) sub = "Not available yet";
  else if (route && failing.has(route.provider)) sub = <span className="text-[hsl(var(--e-danger))]">Provider failing</span>;
  else if (isBlockedByPhotoRule(feature, page.state, page.draft, page.visionDraft)) sub = <span className="text-[hsl(var(--e-danger))]">Blocked: photos may not leave</span>;
  else {
    const where = route ? `${route.provider === "ollama" ? "Local" : shortProviderName(route.provider, page.draft)} ${route.model}` : "Route not known";
    const extra = definition.usesImages ? (settings.allowCloudImages ? "photos may leave" : "photos stay here") : month.cost && month.cost !== "local, no charge" ? month.cost : null;
    sub = [where, extra].filter(Boolean).join(" · ");
  }
  return (
    <li className="flex min-h-[52px] items-center gap-2.5 border-t border-[hsl(var(--e-border))] px-3 py-2 first:border-0">
      <button type="button" className="min-h-11 min-w-0 flex-1 text-left" onClick={() => page.openFeature(feature)}>
        <b className="block text-[0.875rem]">{definition.label}</b>
        <span className={cn("block text-[0.71875rem] [overflow-wrap:anywhere]", AI_MUTED)}>{sub}</span>
      </button>
      <AiSwitch checked={definition.built && settings.enabled} disabled={page.locked || !definition.built} label={`Use AI for ${definition.label}`} onChange={(enabled) => page.updateFeature(feature, { enabled })} />
    </li>
  );
}

/** Board state "A feature blocked by the photo rule": the two real ways out side by side. */
function BlockedCard({ page, feature }: { page: AiPage; feature: AiFeature }) {
  const definition = AI_FEATURE_CATALOG[feature];
  const route = effectiveRoute(feature, page.state, page.draft, page.visionDraft);
  const company = route ? shortProviderName(route.provider, page.draft) : "the cloud provider";
  const ollamaReady = page.statuses.ollama.state !== "not-set-up";
  return (
    <EToneCard
      tone="attention"
      pill="Blocked"
      header={<><b className="text-[0.875rem]">{definition.label}</b><div className="text-[0.75rem]">Runs on {routeLabel(route, page.draft)}</div></>}
      bodyClassName="space-y-2 text-[0.8125rem]"
    >
      <p><b>Photos may not leave this server{ollamaReady ? "" : ", and no local model is set"}.</b> So this feature cannot run: {feature === "photo_compare" ? "QA reviewers check photos by eye." : "cleaners assign photos by hand."}</p>
      {page.canEdit ? (
        <>
          <p className="text-[0.75rem]">Choose one:</p>
          <div className="flex flex-wrap gap-2">
            <EButton type="button" size="sm" disabled={page.locked} onClick={() => page.updateFeature(feature, { route: { provider: "ollama", model: suggestedModel("ollama", page.state, true) } })}>Use Local Ollama</EButton>
            <EButton type="button" size="sm" variant="outline" disabled={page.locked} onClick={() => page.askAllowPhotos(feature)}>Allow photos to go to {company}…</EButton>
          </div>
        </>
      ) : <p className={cn("text-[0.75rem]", AI_MUTED)}>Administrators change this.</p>}
      <div className="rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-background))] p-2.5 text-[0.75rem]">
        <span className="mb-0.5 block text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[hsl(var(--e-muted-foreground))]">What {feature === "photo_compare" ? "a QA reviewer" : "a cleaner"} sees</span>
        &quot;AI unavailable for this feature: images are not allowed to leave the server. Continue manually, or ask an administrator to choose a local provider.&quot;
      </div>
    </EToneCard>
  );
}

/** Board state "Hourly limit reached": who hit it and when it resets. */
function LimitHitCard({ page, feature }: { page: AiPage; feature: AiFeature }) {
  const definition = AI_FEATURE_CATALOG[feature];
  const hits = page.state.status?.limitHits?.[feature];
  if (!hits) return null;
  const limit = page.state.routing.features[feature].hourlyLimitPerActor;
  const month = monthText(monthFigure(page.state.usage, (row) => row.feature === feature));
  const people = hits.people.map((person) => `${person.name}${person.used !== null ? ` (${person.used})` : ""}`).join(", ");
  return (
    <EToneCard
      tone="attention"
      pill="Limit hit"
      header={<><b className="text-[0.875rem]">{definition.label}</b><div className="text-[0.75rem]">{limit} per person per hour</div></>}
      bodyClassName="space-y-2 text-[0.8125rem]"
    >
      <p>{hits.people.length === 1 ? "1 person" : `${hits.people.length} people`} reached the limit this hour: {people}. It resets at {clockText(hits.resetsAt, page.timezone)}.</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1">
          <span className={AI_LABEL}>Requests per person per hour</span>
          <LimitInput page={page} feature={feature} wide />
        </label>
        {page.canEdit ? <EButton type="button" size="sm" variant="outline" disabled={page.locked || !page.dirty} onClick={page.save}>Save</EButton> : null}
      </div>
      <p className={cn("text-[0.75rem]", AI_MUTED)}>1 to 10,000. Raising it costs more on cloud models{month.cost && !month.unknown ? `; this month ${definition.label} is ${month.cost}` : ""}.</p>
      <div className="rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-background))] p-2.5 text-[0.75rem]">
        <span className="mb-0.5 block text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[hsl(var(--e-muted-foreground))]">What they see</span>
        &quot;AI unavailable for now: the hourly limit for this feature was reached. Continue manually or try again later.&quot;
      </div>
    </EToneCard>
  );
}

/** One feature's settings: the phone sheet, and the desktop "Settings" dialog. */
export function FeatureSheet({ page, feature, onClose, onCheckPhotoModel, photoCheck }: {
  page: AiPage;
  feature: AiFeature | null;
  onClose: () => void;
  onCheckPhotoModel: () => void;
  photoCheck: string | null;
}) {
  if (!feature) return null;
  const definition = AI_FEATURE_CATALOG[feature];
  const settings = page.draft.features[feature];
  const month = monthText(monthFigure(page.state.usage, (row) => row.feature === feature));
  const vision: VisionSettings | null = page.visionDraft;
  const test = featureTestView(feature, page);
  const workflowKey = feature === "photo_compare" ? "comparisonEnabled" : feature === "photo_assign" ? "assignmentEnabled" : null;
  return (
    <EBottomSheet
      open
      tall
      onOpenChange={(next) => { if (!next) onClose(); }}
      title={definition.label}
      description={definition.description}
      headerAction={<EButton type="button" size="sm" variant="ghost" onClick={onClose}>Done</EButton>}
      footer={
        <>
          <EButton type="button" variant="outline" className="flex-1" disabled={!page.canEdit || page.dirty || test.running || !definition.built} onClick={() => page.runTest(feature)} title={page.dirty ? "Save changes first." : undefined}>Run a test</EButton>
          {page.canEdit ? <EButton type="button" className="flex-1" disabled={page.locked || !page.dirty} onClick={page.save}>Save</EButton> : null}
        </>
      }
    >
      <fieldset disabled={page.locked} className="min-w-0 space-y-3 text-[0.875rem]">
        {!page.canEdit ? <p className={cn("text-[0.75rem]", AI_MUTED)}>Administrators change these.</p> : null}
        {!definition.built ? <p className="text-[0.8125rem]">Not available yet. Routing can be chosen ahead; it has no effect until the feature is built.</p> : null}
        <div className="flex min-h-11 items-center justify-between gap-3">
          <b>Use AI for this</b>
          <AiSwitch checked={settings.enabled} disabled={page.locked} label={`Use AI for ${definition.label}`} onChange={(enabled) => page.updateFeature(feature, { enabled })} />
        </div>
        {workflowKey && vision ? (
          <div className="flex min-h-11 items-start justify-between gap-3">
            <div className="min-w-0">
              <b>{feature === "photo_compare" ? "Compare submitted photos with references" : "Suggest bulk photo assignments"}</b>
              <div className={cn("text-[0.75rem]", AI_MUTED)}>The photo workflow switch. Both switches must be on for this feature to run.</div>
            </div>
            <AiSwitch checked={vision[workflowKey]} disabled={page.locked} label={feature === "photo_compare" ? "Compare submitted photos with references" : "Suggest bulk photo assignments"} onChange={(next) => page.setVisionDraft((old) => ({ ...old, [workflowKey]: next }))} />
          </div>
        ) : null}
        <div>
          <span className={AI_LABEL}>Runs on</span>
          <FeatureRoutePicker page={page} feature={feature} compact />
        </div>
        {definition.usesImages && !settings.route && vision ? (
          <div className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
            <b className="block text-[0.8125rem]">Photo default (used by both photo features without their own choice)</b>
            <label className="block">
              <span className={AI_LABEL}>Photo analysis provider</span>
              <select className={AI_FIELD} value={vision.provider} disabled={page.locked} onChange={(event) => {
                const provider = event.target.value as VisionSettings["provider"];
                page.setVisionDraft((old) => ({ ...old, provider, model: provider === "ollama" ? suggestedModel("ollama", page.state, true) : provider === "openai" ? "gpt-4.1" : "claude-sonnet-5" }));
              }}>
                <option value="openai">{PROVIDER_NAME.openai}</option>
                <option value="anthropic">{PROVIDER_NAME.anthropic}</option>
                <option value="ollama">{PROVIDER_NAME.ollama}</option>
              </select>
            </label>
            <label className="block">
              <span className={AI_LABEL}>Vision model</span>
              <input className={cn(AI_FIELD, "font-mono")} value={vision.model} disabled={page.locked || vision.provider === "ollama"} spellCheck={false} autoComplete="off" onChange={(event) => page.setVisionDraft((old) => ({ ...old, model: event.target.value }))} />
            </label>
            {vision.provider === "ollama" ? <p className={cn("text-[0.75rem]", AI_MUTED)}>Change the shared vision model in Local Ollama setup (Section 1).</p> : null}
            <EButton type="button" size="sm" variant="outline" disabled={!page.canEdit || page.dirty} onClick={onCheckPhotoModel}>Check provider and saved model</EButton>
            <p className={cn("text-[0.75rem]", AI_MUTED)}>Reads model availability only; sends no photos. Save changes before checking.</p>
            {photoCheck ? <p aria-live="polite" className="text-[0.8125rem]">{photoCheck}</p> : null}
          </div>
        ) : null}
        {definition.usesImages ? <PhotoCell page={page} feature={feature} /> : <p className={cn("text-[0.75rem]", AI_MUTED)}>{PHOTO_TEXT[feature] ?? "No photos"} are sent.</p>}
        <label className="block">
          <span className={AI_LABEL}>Requests per person per hour</span>
          <LimitInput page={page} feature={feature} wide />
        </label>
        <label className="block">
          <span className={AI_LABEL}>Cloud deadline (seconds)</span>
          <input type="number" inputMode="numeric" min={10} max={300} step={1} className={cn(AI_FIELD, "tabular-nums")} value={settings.timeoutSeconds} disabled={page.locked} onChange={(event) => page.updateFeature(feature, { timeoutSeconds: Number(event.target.value) })} />
          <span className={cn("mt-1 block text-[0.75rem]", AI_MUTED)}>10 to 300. Local Ollama uses its own deadline.</span>
        </label>
        <div className="flex min-h-11 items-center justify-between gap-3 border-t border-[hsl(var(--e-border))]"><span>Last test</span><TestCell page={page} feature={feature} withButton={false} /></div>
        <div className="flex min-h-11 items-center justify-between gap-3 border-t border-[hsl(var(--e-border))]"><span>This month</span><span className={cn("text-right text-[0.8125rem]", AI_MUTED)}>{month.requests}{month.cost ? ` · ${month.cost}` : ""}</span></div>
      </fieldset>
    </EBottomSheet>
  );
}
