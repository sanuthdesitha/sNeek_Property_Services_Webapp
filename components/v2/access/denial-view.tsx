/**
 * One access-denied page for every portal (board "Access denied", 2026-11):
 * what you tried, why not, who can change it (or who can help), and a way
 * back. Office pages sit in the admin shell; worker and client pages in their
 * own portal's shell, so each looks like its portal.
 *
 * Plain module (no "use client"): server pages render it; the interactive
 * parts come from denial-actions.tsx. One h1 (EPageHeader or the portal
 * heading); the portal shell owns the main landmark.
 */
import Link from "next/link";
import { EButton, ECard, ECardBody, EPageHeader } from "@/components/v2/ui/primitives";
import { EToneCard } from "@/components/v2/ui/tone-band";
import { cn } from "@/lib/utils";
import { askFootnote, type DenialAnswer, type DenialPageView, type DenialText, type DenialView } from "@/lib/access/denial";
import { AskAdministrator, DenialHistoryBack, DenialRetry, DenialSignOut } from "./denial-actions";

function DenialRun({ text }: { text: DenialText }) {
  return (
    <>
      {text.map((part, index) => {
        if (typeof part === "string") return <span key={index}>{part}</span>;
        if ("strong" in part) return <strong key={index} className="font-[600] text-[hsl(var(--e-foreground))]">{part.strong}</strong>;
        return (
          <Link key={index} href={part.href} className="font-[500] text-[hsl(var(--e-primary))] underline underline-offset-2">
            {part.link}
          </Link>
        );
      })}
    </>
  );
}

function AnswerValue({ answer }: { answer: DenialAnswer }) {
  return (
    <>
      <DenialRun text={answer.text} />
      {answer.path ? (
        <>
          {" "}
          <code className="break-all font-mono text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{answer.path}</code>
        </>
      ) : null}
    </>
  );
}

/** Office answers: a two-column list from 640px, stacked with small labels on a phone. */
function OfficeAnswers({ answers }: { answers: readonly DenialAnswer[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
      {answers.map((answer) => (
        <div key={answer.label} className="contents">
          <dt className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))] max-sm:text-[0.6875rem] max-sm:font-[600] max-sm:uppercase max-sm:tracking-[0.08em]">
            {answer.label}
          </dt>
          <dd className="min-w-0 text-[0.9375rem] leading-relaxed text-[hsl(var(--e-text-secondary))] max-sm:-mt-2">
            <AnswerValue answer={answer} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Portal answers: the eyebrow-label stack the portal boards draw. */
function PortalAnswers({ answers }: { answers: readonly DenialAnswer[] }) {
  return (
    <dl className="space-y-4">
      {answers.map((answer) => (
        <div key={answer.label}>
          <dt className="text-[0.6875rem] font-[650] uppercase tracking-[0.1em] text-[hsl(var(--e-accent-portal,var(--e-gold-ink)))]">{answer.label}</dt>
          <dd className="mt-1 min-w-0 text-[0.9375rem] leading-relaxed text-[hsl(var(--e-foreground))]">
            <AnswerValue answer={answer} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function OfficeDenial({ view, fromPath }: { view: DenialView; fromPath: string | null }) {
  const ask = view.ask;
  return (
    <div className="max-w-[44rem] space-y-6">
      <EPageHeader eyebrow={view.eyebrow} title={view.title} description={view.intro ?? undefined} />
      <ECard>
        <ECardBody className="space-y-5 p-4 sm:p-6">
          <OfficeAnswers answers={view.answers} />
          <div className="border-t border-[hsl(var(--e-border))] pt-4">
            <div className="flex flex-wrap items-center gap-2 max-sm:flex-col max-sm:items-stretch">
              {view.historyBack ? <DenialHistoryBack fallbackHref={view.back.href} /> : null}
              <EButton asChild variant={view.historyBack ? "outline" : "primary"}>
                <Link href={view.back.href}>{view.back.label}</Link>
              </EButton>
              {ask?.kind === "offered" ? (
                <AskAdministrator area={ask.area} areaLabel={ask.areaLabel} fromLabel={ask.fromLabel} fromPath={fromPath} administrators={ask.administrators} />
              ) : null}
            </div>
            <div className="mt-3 space-y-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              {ask?.kind === "offered" ? <p>{askFootnote(ask)}</p> : null}
              {ask?.kind === "not_offered" ? <p>{ask.reason}</p> : null}
              {view.footnote ? <p>{view.footnote}</p> : null}
            </div>
          </div>
        </ECardBody>
      </ECard>
    </div>
  );
}

function PortalDenial({ view }: { view: DenialView }) {
  return (
    <div className="mx-auto max-w-[36rem] space-y-6 pb-6">
      <div>
        <p className="text-[0.75rem] font-[600] uppercase tracking-[0.12em] text-[hsl(var(--e-muted-foreground))]">{view.eyebrow}</p>
        <h1 className="e-display-md mt-1 break-words">{view.title}</h1>
      </div>
      <PortalAnswers answers={view.answers} />
      <div className="space-y-2">
        <EButton asChild variant="primary" className="w-full max-sm:h-12">
          <Link href={view.back.href}>{view.back.label}</Link>
        </EButton>
        {view.signOut ? <DenialSignOut /> : null}
      </div>
      {view.footnote ? <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{view.footnote}</p> : null}
    </div>
  );
}

/** The whole page for any denial state: denied, could not be checked, or nothing refused. */
export function DenialPage({ view, fromPath = null }: { view: DenialPageView; fromPath?: string | null }) {
  const office = view.portal === "admin";
  if (view.state === "unknown") {
    return (
      <div className={cn("space-y-6", office ? "max-w-[44rem]" : "mx-auto max-w-[36rem]")}>
        <EPageHeader eyebrow="Access" title={view.title} />
        <EToneCard tone="attention" pill="Unknown" header={<p className="text-[0.9375rem] font-[600]">Access could not be checked</p>} role="alert">
          <div className="space-y-4">
            <p className="text-[0.9375rem] text-[hsl(var(--e-text-secondary))]">{view.message}</p>
            <DenialRetry />
          </div>
        </EToneCard>
      </div>
    );
  }
  if (view.state === "nothing") {
    return (
      <div className="max-w-[44rem] space-y-6">
        <EPageHeader eyebrow="Access" title={view.title} description={view.message} />
        <EButton asChild variant="primary">
          <Link href={view.back.href}>{view.back.label}</Link>
        </EButton>
      </div>
    );
  }
  return office ? <OfficeDenial view={view} fromPath={fromPath} /> : <PortalDenial view={view} />;
}
