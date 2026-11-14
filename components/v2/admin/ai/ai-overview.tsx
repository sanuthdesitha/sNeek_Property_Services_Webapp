"use client";

/**
 * The status strip (is AI working, which providers work, whether photos leave
 * the server, what it costs), Section 5 "Privacy and safety" and the first-run
 * guide shown instead of Sections 1 to 4 while nothing is set up.
 */
import * as React from "react";
import Link from "next/link";
import { EButton } from "@/components/v2/ui/primitives";
import { cn } from "@/lib/utils";
import { AI_FEATURE_CATALOG, AI_FEATURES } from "@/lib/ai/provider/routing-schema";
import type { AiPage, StatusStrip } from "./ai-config-model";
import { AI_MUTED, AiSectionHeading } from "./ai-ui";

export function AiStatusStrip({ strip }: { strip: StatusStrip }) {
  const cells: { key: string; title: React.ReactNode; detail: string; href?: string; bad?: boolean }[] = [
    { key: "ai", title: <>{strip.ai.on ? <span aria-hidden className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[hsl(var(--e-success))] align-middle" /> : null}{strip.ai.title}</>, detail: strip.ai.detail },
    { key: "providers", title: strip.providers.title, detail: strip.providers.detail, href: "#where", bad: strip.providers.failing > 0 },
    { key: "photos", title: strip.photos.title, detail: strip.photos.detail },
    { key: "cost", title: strip.cost.title, detail: strip.cost.detail, href: "#usage" },
  ];
  return (
    <section aria-label="AI status" className="grid min-w-0 grid-cols-1 overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] sm:grid-cols-2 lg:grid-cols-[1.1fr_1.2fr_1.3fr_1.3fr]">
      {cells.map((cell) => {
        const body = (
          <>
            <span className="min-w-0 flex-1">
              <b className="block text-[0.875rem]">{cell.title}</b>
              <span className={cn("block text-[0.71875rem] [overflow-wrap:anywhere]", cell.bad ? "text-[hsl(var(--e-danger))]" : AI_MUTED)}>{cell.detail}</span>
            </span>
            {cell.href ? <span aria-hidden className={cn("text-[0.75rem] sm:hidden", AI_MUTED)}>›</span> : null}
          </>
        );
        const cellClass = "flex min-h-11 items-center gap-2 border-t border-[hsl(var(--e-border))] px-3.5 py-2.5 first:border-t-0 sm:border-t-0 sm:[&:nth-child(n+3)]:border-t lg:[&:nth-child(n+3)]:border-t-0 sm:border-l sm:[&:nth-child(odd)]:border-l-0 lg:[&:nth-child(odd)]:border-l lg:first:border-l-0";
        return cell.href
          ? <a key={cell.key} href={cell.href} className={cn(cellClass, "hover:bg-[hsl(var(--e-muted))]")}>{body}</a>
          : <div key={cell.key} className={cellClass}>{body}</div>;
      })}
    </section>
  );
}

export function PrivacySection({ page }: { page: AiPage }) {
  const photoOn = AI_FEATURES.filter((feature) => AI_FEATURE_CATALOG[feature].usesImages && page.state.routing.features[feature].allowCloudImages);
  return (
    <section aria-labelledby="ai-privacy-heading" id="privacy" className="min-w-0 space-y-3 scroll-mt-24">
      <AiSectionHeading id="ai-privacy-heading" number={5} title="Privacy and safety" aside={page.state.isAdmin ? <Link className="underline" href="/v2/admin/settings/agents">Connected agents: Settings › Access › Agents ›</Link> : "Connected agents: Settings › Access › Agents"} />
      <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-1.5 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3.5 text-[0.78125rem]">
          <b className="text-[0.8125rem]">What can leave this server</b>
          <ul className="list-disc space-y-1 pl-4">
            <li>For features set to a cloud provider: the question or draft request, and the records needed to answer it, limited to what the person asking can already read.</li>
            <li>Photos, only for a photo feature whose switch is on, with the time and address stamp blacked out. {photoOn.length === 0 ? "Today every photo switch is off." : `Today: ${photoOn.map((feature) => AI_FEATURE_CATALOG[feature].label).join(", ")}.`}</li>
            <li>Nothing at all for features on Local Ollama.</li>
          </ul>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3.5 text-[0.78125rem]">
          <b className="text-[0.8125rem]">What is never sent</b>
          <ul className="list-disc space-y-1 pl-4">
            <li>Provider keys, passwords, PINs and payment details.</li>
            <li>Records the person asking cannot see in the app.</li>
            <li>Photos from properties that opted out.</li>
            <li>Anything at all when a feature is off: people continue manually.</li>
          </ul>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3.5 text-[0.78125rem]">
          <b className="text-[0.8125rem]">AI suggests, people decide</b>
          <ul className="list-disc space-y-1 pl-4">
            <li>AI never approves work, changes a score, makes a deduction, sends a message, publishes a post or edits a record by itself.</li>
            <li>Every suggestion shows who accepted it. Findings left out stay in the review history.</li>
            <li>Agents connect through Access › Agents with their own tokens and limits.</li>
            <li>When a cloud provider fails, nothing falls back to another provider: people see the failure and continue manually.</li>
          </ul>
        </div>
      </div>
    </section>
  );
}

export function FirstRunGuide({ page, onShowAll }: { page: AiPage; onShowAll: () => void }) {
  return (
    <section aria-labelledby="ai-first-run-heading" className="grid min-w-0 grid-cols-1 gap-4 rounded-[14px] border-[1.5px] border-dashed border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] p-4 lg:grid-cols-[18rem_1fr]">
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="e-eyebrow">Nothing is set up yet</span>
        <h2 id="ai-first-run-heading" className="font-[family-name:var(--e-font-serif)] text-[1.375rem] font-medium leading-tight">Set up your first provider</h2>
        <span className={cn("text-[0.75rem]", AI_MUTED)}>Until a provider is set up, every AI feature says &quot;AI unavailable, continue manually&quot;.</span>
        <button type="button" className="mt-1 self-start text-[0.75rem] underline" onClick={onShowAll}>Show every setting anyway</button>
      </div>
      <ol className="grid min-w-0 grid-cols-1 gap-2.5 md:grid-cols-3">
        <li className="flex min-w-0 flex-col gap-1.5 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3 text-[0.78125rem]">
          <span aria-hidden className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[hsl(var(--e-gold))] text-[0.75rem] font-semibold text-[hsl(var(--e-gold-foreground))]">1</span>
          <b>Choose where AI runs</b>
          <span className={AI_MUTED}>Local Ollama on your own server keeps everything here. Or add a key for Anthropic, OpenAI or another endpoint.</span>
          {page.canEdit ? (
            <div className="flex flex-wrap gap-1.5">
              <EButton type="button" size="sm" onClick={page.openOllamaSetup}>Set up Ollama</EButton>
              <EButton type="button" size="sm" variant="outline" onClick={() => page.openKey("anthropic", "add", true)}>Add a cloud key</EButton>
            </div>
          ) : <span className={cn("text-[0.75rem]", AI_MUTED)}>An administrator sets this up.</span>}
        </li>
        <li className="flex min-w-0 flex-col gap-1.5 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3 text-[0.78125rem]">
          <span aria-hidden className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[hsl(var(--e-gold))] text-[0.75rem] font-semibold text-[hsl(var(--e-gold-foreground))]">2</span>
          <b>Test the connection</b>
          <span className={AI_MUTED}>One made-up request, queued and run in the background. You see Passed, or the reason it failed in plain words.</span>
        </li>
        <li className="flex min-w-0 flex-col gap-1.5 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3 text-[0.78125rem]">
          <span aria-hidden className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[hsl(var(--e-gold))] text-[0.75rem] font-semibold text-[hsl(var(--e-gold-foreground))]">3</span>
          <b>Choose what AI does</b>
          <span className={AI_MUTED}>Pick features and their model. Photos stay on this server unless you switch a photo feature on.</span>
        </li>
      </ol>
    </section>
  );
}
