/**
 * One stage of the job timeline (server component): a dot on the line, a card
 * with "N · Stage" eyebrow, the headline, the stage's own buttons, and its
 * content. "now" is gold and carries its buttons; "todo" is dashed. When the
 * job is finished, done stages collapse to their headline with the content
 * behind a disclosure (as drawn for the invoiced state).
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { TimelineStage } from "@/lib/jobs/job-page/timeline";
import { PhoneFold } from "@/components/v2/admin/phone-fold";
import { JobDisclosure } from "./job-disclosure";

const STATE_WORDS = { done: "done", now: "current stage", todo: "not yet" } as const;

const DOT_CLASS = {
  done: "bg-[hsl(var(--e-primary))] border-2 border-[hsl(var(--e-background))]",
  now: "bg-[hsl(var(--e-gold))] border-2 border-[hsl(var(--e-background))] shadow-[0_0_0_4px_hsl(var(--e-gold-soft))]",
  todo: "bg-[hsl(var(--e-background))] border-2 border-[hsl(var(--e-border-strong))]",
} as const;

const CARD_CLASS = {
  done: "border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]",
  now: "border-[hsl(var(--e-gold))] bg-[hsl(var(--e-surface))]",
  todo: "border-dashed border-[hsl(var(--e-border-strong))] bg-transparent",
} as const;

export function StageShell({
  stage,
  actions,
  aside,
  collapsed = false,
  children,
}: {
  stage: TimelineStage;
  /** The stage's own buttons, beside its heading. */
  actions?: ReactNode;
  /** Muted text on the right of the heading (e.g. a sync time). */
  aside?: ReactNode;
  collapsed?: boolean;
  children?: ReactNode;
}) {
  const headingId = `${stage.anchor}-title`;
  return (
    <article id={stage.anchor} aria-labelledby={headingId} className="relative min-w-0 scroll-mt-24 max-sm:scroll-mt-44">
      <span aria-hidden className={cn("absolute -left-[23px] top-[14px] h-3 w-3 rounded-full", DOT_CLASS[stage.state])} />
      <div className={cn("flex min-w-0 flex-col gap-2 rounded-[var(--e-radius-lg)] border px-4 py-3 text-[0.8125rem]", CARD_CLASS[stage.state])}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id={headingId} className="min-w-0 text-[0.875rem] font-[600] leading-snug">
            <span className="e-eyebrow mr-1.5 inline">{stage.eyebrow}</span>
            <span className="[overflow-wrap:anywhere]">{stage.headline}</span>
            <span className="sr-only">, {STATE_WORDS[stage.state]}</span>
          </h2>
          {actions || aside ? (
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {aside ? <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{aside}</span> : null}
              {actions}
            </div>
          ) : null}
        </div>
        {children ? (
          collapsed ? (
            <JobDisclosure id={`${stage.anchor}-details`} label="Show details">
              <div className="flex flex-col gap-2">{children}</div>
            </JobDisclosure>
          ) : stage.state === "done" ? (
            // Phones (board M-JobDetail): a finished stage folds to its headline.
            <PhoneFold label={stage.label}>{children}</PhoneFold>
          ) : (
            children
          )
        ) : null}
      </div>
    </article>
  );
}

/** A bordered sub-section inside a stage (the board's `.sec`). */
export function StageSection({ title, aside, children, className }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-2.5", className)}>
      {title || aside ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {title ? <h3 className="text-[0.8125rem] font-[600]">{title}</h3> : <span />}
          {aside}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Muted line. */
export function Muted({ children }: { children: ReactNode }) {
  return <span className="text-[hsl(var(--e-muted-foreground))]">{children}</span>;
}
