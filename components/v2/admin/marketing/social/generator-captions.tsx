"use client";

/**
 * Step 3 of the social post generator (2026-11-17): one caption per network,
 * each within that network's limits, and alt text for every image. Templates
 * by default (free, no AI); AI caption help only when it is switched on. Edits
 * stay on screen when a save fails or another step is opened.
 */
import * as React from "react";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { EToneNotice } from "@/components/v2/ui/tone-band";
import { captionLength, captionProblems } from "@/lib/marketing/social/captions";
import { networkDefinition, SOCIAL_NETWORKS, type SocialNetwork } from "@/lib/marketing/social/networks";
import type { GroupView } from "@/lib/marketing/social/view-types";
import { SOCIAL_API } from "./social-api";
import { cn } from "@/lib/utils";

export type CaptionDraft = { caption: string; hashtags: string };
export type CaptionDrafts = Record<SocialNetwork, CaptionDraft>;
export type AiState = { state: "idle" } | { state: "working" } | { state: "unavailable"; message: string } | { state: "ready"; captions: Partial<Record<SocialNetwork, string>>; altText: Record<string, string>; problems: string[]; usedPhotos: boolean };

export function parseHashtags(text: string): string[] {
  return Array.from(new Set(text.split(/[\s,]+/).map((tag) => tag.trim()).filter(Boolean).map((tag) => (tag.startsWith("#") ? tag : `#${tag}`)).filter((tag) => new RegExp("^#[\\p{L}\\p{N}_]{2,60}$", "u").test(tag))));
}

function grouped(value: number) {
  return value.toLocaleString("en-AU");
}

export function GeneratorCaptions({
  group, drafts, onDraft, altDrafts, onAlt, templates, templateKey, hookIndex, onTemplate, ai, onAi, onUseAi, saving, saveError, onSave, dirty, frozen,
}: {
  group: GroupView;
  drafts: CaptionDrafts;
  onDraft: (network: SocialNetwork, draft: CaptionDraft) => void;
  altDrafts: Record<string, string>;
  onAlt: (photoId: string, text: string) => void;
  templates: Array<{ key: string; name: string; hooks: number }>;
  templateKey: string | null;
  hookIndex: number;
  onTemplate: (templateKey: string | null, hookIndex: number) => void;
  ai: AiState;
  onAi: () => void;
  onUseAi: () => void;
  saving: boolean;
  saveError: string | null;
  onSave: () => void;
  dirty: boolean;
  frozen: boolean;
}) {
  const [network, setNetwork] = React.useState<SocialNetwork>("INSTAGRAM");
  const definition = networkDefinition(network);
  const draft = drafts[network];
  const tags = parseHashtags(draft.hashtags);
  const length = captionLength(network, draft.caption, tags);
  const problems = captionProblems(network, draft.caption, tags);
  const template = templates.find((item) => item.key === templateKey) ?? templates[0] ?? null;
  const firstCopy = group.derivatives[0];

  return (
    <fieldset disabled={frozen} className="min-w-0 space-y-4">
      <legend className="sr-only">Captions and alt text</legend>
      <div role="tablist" aria-label="Network caption" className="flex gap-1 overflow-x-auto border-b border-[hsl(var(--e-border))] [scrollbar-width:none]">
        {SOCIAL_NETWORKS.map((item) => (
          <button key={item.key} type="button" role="tab" aria-selected={network === item.key} onClick={() => setNetwork(item.key)} className={cn("min-h-11 whitespace-nowrap px-3 text-[0.8125rem]", network === item.key ? "border-b-2 border-[hsl(var(--e-primary))] font-[600]" : "text-[hsl(var(--e-muted-foreground))]")}>
            <span aria-hidden className="mr-1 font-[700]">{item.mark}</span>{item.label}
          </button>
        ))}
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_minmax(0,18rem)]">
        <ECard className="min-w-0 space-y-2 p-3 max-lg:order-3">
          <p className="text-[0.75rem] font-[600]">Preview: {definition.label}</p>
          {firstCopy ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`${SOCIAL_API}/derivatives/${firstCopy.assetId}`} alt="" className="w-full rounded-[var(--e-radius)] object-cover" />
          ) : (
            <div className="flex aspect-[4/5] items-center justify-center rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-sunken))] p-3 text-center text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Make the cleaned copies in step 2 to see them here.</div>
          )}
          <p className="whitespace-pre-wrap text-[0.75rem] [overflow-wrap:anywhere]">{draft.caption.slice(0, 160)}{draft.caption.length > 160 ? "… more" : ""}</p>
          <p className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">Preview drawn by sNeek; the network may show it slightly differently.</p>
        </ECard>

        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <label htmlFor="social-caption" className="text-[0.8125rem] font-[600]">Caption</label>
            {template ? <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Template &quot;{template.name}&quot;, hook {(hookIndex % Math.max(1, template.hooks)) + 1} of {template.hooks}</span> : null}
          </div>
          <textarea id="social-caption" rows={9} value={draft.caption} onChange={(event) => onDraft(network, { ...draft, caption: event.target.value })} aria-describedby="social-caption-count" className="w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3 text-[0.875rem] max-sm:text-[1rem]" />
          <div id="social-caption-count" className="flex flex-wrap justify-between gap-2 text-[0.75rem]">
            <span className="text-[hsl(var(--e-muted-foreground))]">{definition.captionLimitSource}</span>
            <span className={cn("e-tnum", length > definition.captionLimit && "font-[650] text-[hsl(var(--e-danger))]")}>{grouped(length)} / {grouped(definition.captionLimit)} characters</span>
          </div>
          {definition.usesHashtags ? (
            <div>
              <label htmlFor="social-hashtags" className="text-[0.8125rem] font-[550]">Hashtags ({tags.length} of {definition.hashtagLimit})</label>
              <input id="social-hashtags" value={draft.hashtags} onChange={(event) => onDraft(network, { ...draft, hashtags: event.target.value })} className="mt-1 min-h-11 w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 text-[0.8125rem] max-sm:text-[1rem]" />
            </div>
          ) : <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{definition.label}: no hashtag block.</p>}
          {problems.length ? <EToneNotice tone="problem" role="alert"><ul className="list-disc pl-4">{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul></EToneNotice> : null}
          <div className="flex flex-wrap gap-2">
            <EButton size="sm" variant="outline" onClick={() => onTemplate(template?.key ?? null, hookIndex + 1)}>Next hook</EButton>
            <EButton size="sm" variant="outline" onClick={() => { const index = templates.findIndex((item) => item.key === template?.key); onTemplate(templates[(index + 1) % Math.max(1, templates.length)]?.key ?? null, 0); }}>Other template</EButton>
            <EButton size="sm" variant="ghost" onClick={() => onTemplate(template?.key ?? null, hookIndex)}>Reset to template</EButton>
          </div>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Changing hook or template replaces the captions of every network with the template text. Facebook: no hashtag block, the link written out. Google Business: one photo, plain text. LinkedIn: business tone. TikTok: the first line is the title (90 characters).</p>
          <div className="flex flex-wrap items-center gap-2">
            <EButton size="sm" onClick={onSave} disabled={saving || !dirty}>{saving ? "Saving…" : dirty ? "Save captions and alt text" : "Saved"}</EButton>
            {saveError ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{saveError} Your text is kept.</p> : null}
          </div>
        </div>

        <div className="min-w-0 space-y-3">
          <ECard className="space-y-2 p-3">
            <h3 className="text-[0.8125rem] font-[600]">Alt text, one per image (required)</h3>
            {group.photos.map((photo, index) => {
              const value = altDrafts[photo.photoId] ?? photo.altText;
              return (
                <div key={photo.photoId}>
                  <label htmlFor={`alt-${photo.photoId}`} className="text-[0.75rem] font-[550]">{index + 1}. {photo.room}{photo.role !== "PHOTO" ? ` (${photo.role === "BEFORE" ? "before" : "after"})` : ""}</label>
                  <textarea id={`alt-${photo.photoId}`} rows={2} value={value} placeholder={photo.altHint} onChange={(event) => onAlt(photo.photoId, event.target.value)} className={cn("mt-0.5 w-full rounded-[var(--e-radius)] border bg-[hsl(var(--e-surface))] p-2 text-[0.8125rem] max-sm:text-[1rem]", value.trim() ? "border-[hsl(var(--e-border))]" : "border-[hsl(var(--e-danger))]")} />
                  {!value.trim() ? (
                    <p className="text-[0.6875rem] text-[hsl(var(--e-danger))]">Missing. Write what the photo shows; posting waits for it. <button type="button" className="underline" onClick={() => onAlt(photo.photoId, photo.altHint)}>Use the suggestion</button></p>
                  ) : null}
                </div>
              );
            })}
            <p className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">Suggested from the form field&apos;s label and room; you edit it. Sent as alt text to Instagram and Facebook; kept with the image for the others.</p>
          </ECard>
          <ECard className="space-y-2 p-3">
            <h3 className="text-[0.8125rem] font-[600]">Caption help</h3>
            <p className="text-[0.75rem]"><strong>Templates</strong> (free, no AI): {templates.length} templates with rotating hooks.</p>
            <EButton size="sm" variant="outline" onClick={onAi} disabled={ai.state === "working"}>{ai.state === "working" ? "Asking…" : "AI draft"}</EButton>
            {ai.state === "unavailable" ? <p role="status" className="text-[0.75rem]">{ai.message}</p> : null}
            {ai.state === "ready" ? (
              <div className="space-y-1.5 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2">
                <p className="text-[0.6875rem] font-[600] uppercase tracking-wide">Suggestion, not saved{ai.usedPhotos ? " · the AI saw the cleaned copies" : " · text only"}</p>
                <p className="whitespace-pre-wrap text-[0.75rem] [overflow-wrap:anywhere]">{ai.captions[network] ?? "No caption for this network."}</p>
                {ai.problems.length ? <ul className="list-disc pl-4 text-[0.6875rem] text-[hsl(var(--e-danger))]">{ai.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul> : null}
                <EButton size="sm" variant="outline" onClick={onUseAi}>Use these captions and alt text</EButton>
              </div>
            ) : null}
            <p className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">AI uses the &quot;Social photo captions&quot; feature in <a className="underline" href="/v2/admin/ai">AI configuration</a>; photos are sent only when that feature may send photos, and then only the cleaned copies. Drafts from Claude wait in <a className="underline" href="/v2/admin/approvals?tab=agents">Approvals, Agent requests</a>.</p>
          </ECard>
        </div>
      </div>
    </fieldset>
  );
}
