"use client";

/**
 * Quote page header (one h1), stage strip and facts row. Buttons only start
 * actions the page already has; the More menu holds the rest.
 */
import Link from "next/link";
import { EButton, EPageHeader } from "@/components/v2/ui/primitives";
import { EPill, type EPillTone } from "@/components/v2/ui/pill";
import { EStageBar, type EStage } from "@/components/v2/ui/stage-bar";
import { ERowMenu, type ERowMenuItem } from "@/components/v2/ui/row-menu";

export type HeaderButton = { key: string; label: string; onClick?: () => void; href?: string; disabled?: boolean; title?: string };

export const STATUS_TONE: Record<string, EPillTone> = { DRAFT: "neutral", SENT: "info", ACCEPTED: "ok", DECLINED: "bad", CONVERTED: "gold" };

export function QuoteHeader({
  reference,
  title,
  statusLabel,
  statusTone,
  subLine,
  secondary,
  primary,
  save,
  moreItems,
  phoneMovedKey,
}: {
  reference: string | null;
  title: string;
  statusLabel: string;
  statusTone: EPillTone;
  subLine: string;
  secondary: HeaderButton[];
  primary: HeaderButton | null;
  save: HeaderButton | null;
  moreItems: ERowMenuItem[];
  /** Phones: the button the page docks in its sticky total bar, hidden here below 640px. */
  phoneMovedKey?: string | null;
}) {
  const renderButton = (button: HeaderButton, variant: "outline" | "primary") => (
    <QuoteHeaderButton key={button.key} button={button} variant={variant} size="sm" className={button.key === phoneMovedKey ? "max-sm:hidden" : undefined} />
  );
  return (
    <EPageHeader
      eyebrow={
        <span className="normal-case tracking-normal">
          <Link href="/v2/admin/quotes" className="font-[600] text-[hsl(var(--e-primary))] hover:underline">← Quotes</Link>
          {reference ? <span className="text-[hsl(var(--e-muted-foreground))]"> · {reference}</span> : null}
        </span>
      }
      title={
        <span className="inline-flex flex-wrap items-center gap-2">
          <span className="break-words">{title}</span>
          <EPill tone={statusTone}>{statusLabel}</EPill>
        </span>
      }
      description={<span className="[overflow-wrap:anywhere]">{subLine}</span>}
      actions={
        <>
          {secondary.map((button) => renderButton(button, "outline"))}
          {save ? renderButton(save, "outline") : null}
          {primary ? renderButton(primary, "primary") : null}
          {moreItems.length > 0 ? <ERowMenu label="More actions" items={moreItems} trigger="More ▾" triggerVariant="outline" /> : null}
        </>
      }
    />
  );
}

/** One header action as a button or link; also drawn in the phone total bar. */
export function QuoteHeaderButton({ button, variant, size, className }: { button: HeaderButton; variant: "outline" | "primary"; size?: "sm"; className?: string }) {
  return button.href ? (
    <EButton size={size} variant={variant} asChild className={className}>
      <Link href={button.href}>{button.label}</Link>
    </EButton>
  ) : (
    <EButton size={size} variant={variant} onClick={button.onClick} disabled={button.disabled} title={button.title} className={className}>
      {button.label}
    </EButton>
  );
}

export type Fact = { key: string; label: string; value: string; muted?: boolean; note?: string; pill?: { label: string; tone: EPillTone } };

export function QuoteProgress({ stages, facts }: { stages: EStage[]; facts: Fact[] }) {
  return (
    <div className="space-y-3">
      <EStageBar label="Quote progress" stages={stages} />
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        {facts.map((fact) => (
          <div key={fact.key} className="min-w-0 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 py-2">
            <dt className="text-[0.6875rem] font-[550] text-[hsl(var(--e-muted-foreground))]">{fact.label}</dt>
            <dd className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[0.875rem]">
              <b className={fact.muted ? "font-[500] text-[hsl(var(--e-muted-foreground))]" : "e-tnum"}>{fact.value}</b>
              {fact.note ? <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{fact.note}</span> : null}
              {fact.pill ? <EPill tone={fact.pill.tone}>{fact.pill.label}</EPill> : null}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
