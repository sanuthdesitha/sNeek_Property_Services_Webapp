"use client";

/**
 * Spotlight and tip for one tour step (board "Tutorials", section 3 and 7).
 *
 * - The page stays live: four dim panes surround the target and clicking one
 *   pauses the tour; the target itself is not covered and stays usable.
 * - The tip is a non-modal dialog labelled "Tour step 2 of 5", described by
 *   its text, and points at the target with aria-describedby. Focus moves
 *   into it; Escape (handled by the provider) pauses and returns focus. Focus
 *   is never trapped.
 * - Desktop: the tip sits beside the target. Phone (below 640px): a bottom
 *   card, or a top card when the target is low on the screen.
 * - Reduced motion: no sliding or pulsing; everything appears in place.
 * - A step without a target (welcome screens) is a centred card.
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EstatePortal } from "@/components/v2/ui/portal-root";
import { cn } from "@/lib/utils";
import { findTour } from "@/lib/tutorials/registry";
import { personalise, type ResolvedStep, type RunPlan } from "@/lib/tutorials/engine";
import type { TourDefinition, TourPortal, TourStepAction } from "@/lib/tutorials/types";
import { TOUR_UI_ATTRIBUTE, isPhoneViewport, prefersReducedMotion } from "./tour-dom";

const SPOT_PADDING = 6;
const EDGE = 12;
const TIP_WIDTH = 320;

const HOME_LABEL: Record<TourPortal, string> = {
  admin: "Command",
  cleaner: "Today",
  client: "Home",
  laundry: "Today",
  qa: "Today",
  maintenance: "Today",
};

export type TourOverlayProps = {
  tour: TourDefinition;
  plan: RunPlan;
  index: number;
  step: ResolvedStep;
  target: HTMLElement | null;
  firstName: string | null;
  dontShowAgain: boolean;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  onPause: () => void;
  onNotNow: () => void;
  onTakeTour: () => void;
  onToggleDontShowAgain: (value: boolean) => void;
  onAction: (action: TourStepAction) => void;
  onOfferWalkthrough: (tourKey: string) => void;
};

type Rect = { top: number; left: number; width: number; height: number };

function useTargetRect(target: HTMLElement | null, reduced: boolean): Rect | null {
  const [rect, setRect] = React.useState<Rect | null>(null);
  React.useLayoutEffect(() => {
    if (!target) {
      setRect(null);
      return;
    }
    const box = target.getBoundingClientRect();
    const offscreen = box.top < 72 || box.bottom > window.innerHeight - 24;
    if (offscreen && typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
    }
    const measure = () => {
      const next = target.getBoundingClientRect();
      setRect((current) =>
        current && current.top === next.top && current.left === next.left && current.width === next.width && current.height === next.height
          ? current
          : { top: next.top, left: next.left, width: next.width, height: next.height },
      );
    };
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    const interval = setInterval(measure, 300);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
      clearInterval(interval);
    };
  }, [target, reduced]);
  return rect;
}

/** Desktop placement: below, else above, else beside; always inside the viewport and off the target. */
export function placeTip(rect: Rect, tip: { width: number; height: number }, viewport: { width: number; height: number }) {
  const below = rect.top + rect.height + SPOT_PADDING + EDGE;
  const above = rect.top - SPOT_PADDING - EDGE - tip.height;
  const clampLeft = (left: number) => Math.min(Math.max(left, EDGE), viewport.width - tip.width - EDGE);
  if (below + tip.height <= viewport.height - EDGE) return { top: below, left: clampLeft(rect.left) };
  if (above >= EDGE) return { top: above, left: clampLeft(rect.left) };
  const right = rect.left + rect.width + SPOT_PADDING + EDGE;
  const top = Math.min(Math.max(rect.top, EDGE), viewport.height - tip.height - EDGE);
  if (right + tip.width <= viewport.width - EDGE) return { top, left: right };
  return { top, left: clampLeft(rect.left - tip.width - SPOT_PADDING - EDGE) };
}

export function TourOverlay(props: TourOverlayProps) {
  const { tour, plan, index, step, target, firstName } = props;
  const reduced = React.useMemo(() => prefersReducedMotion(), []);
  const [phone, setPhone] = React.useState(false);
  React.useEffect(() => {
    setPhone(isPhoneViewport());
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(max-width: 639.98px)");
    if (!query) return;
    const onChange = () => setPhone(query.matches);
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, []);
  const rect = useTargetRect(target, reduced);
  const tipRef = React.useRef<HTMLDivElement>(null);
  const [tipSize, setTipSize] = React.useState({ width: TIP_WIDTH, height: 200 });
  const bodyId = React.useId();
  const titleId = React.useId();
  const total = plan.steps.length;
  const centred = step.target === null;
  const mode = plan.mode;
  const isLast = index === total - 1;
  const title = personalise(step.title, firstName);
  const stepLabel = mode === "intro" ? "New" : `${mode === "whatsNew" ? "New · " : ""}Step ${index + 1} of ${total}`;
  const offered = isLast && tour.offerWalkthrough && mode !== "intro" ? findTour(tour.offerWalkthrough) : undefined;

  React.useLayoutEffect(() => {
    const element = tipRef.current;
    if (!element) return;
    const next = { width: element.offsetWidth || TIP_WIDTH, height: element.offsetHeight || 200 };
    setTipSize((current) => (current.width === next.width && current.height === next.height ? current : next));
  });

  // Focus moves into the tip on every step (a callback ref: the tip mounts inside a portal
  // after this component's first effects). The provider returns focus when the tour ends or pauses.
  const headingRef = React.useCallback(
    (node: HTMLHeadingElement | null) => {
      node?.focus({ preventScroll: true });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plan.tourKey, index, mode],
  );

  // Point at the target for screen readers while the step shows.
  React.useEffect(() => {
    if (!target) return;
    const previous = target.getAttribute("aria-describedby");
    target.setAttribute("aria-describedby", previous ? `${previous} ${bodyId}` : bodyId);
    return () => {
      if (previous === null) target.removeAttribute("aria-describedby");
      else target.setAttribute("aria-describedby", previous);
    };
  }, [target, bodyId]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowRight" && mode !== "intro" && !step.actions) {
      event.preventDefault();
      props.onNext();
    } else if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      props.onBack();
    }
  };

  const motion = reduced ? "" : "motion-safe:transition-all motion-safe:duration-200";
  const spot = rect
    ? {
        top: rect.top - SPOT_PADDING,
        left: rect.left - SPOT_PADDING,
        width: rect.width + SPOT_PADDING * 2,
        height: rect.height + SPOT_PADDING * 2,
      }
    : null;

  let tipStyle: React.CSSProperties;
  if (centred) {
    tipStyle = {};
  } else if (phone) {
    const low = rect ? rect.top + rect.height / 2 > window.innerHeight * 0.55 : false;
    tipStyle = low ? { top: 72, left: EDGE, right: EDGE } : { bottom: EDGE, left: EDGE, right: EDGE };
  } else if (rect) {
    tipStyle = placeTip(rect, tipSize, { width: window.innerWidth, height: window.innerHeight });
  } else {
    tipStyle = { bottom: EDGE, right: EDGE };
  }

  return (
    <EstatePortal>
      <div {...{ [TOUR_UI_ATTRIBUTE]: "" }} data-reduced-motion={reduced ? "true" : "false"} data-phone={phone ? "true" : "false"} className="fixed inset-0 z-[70] pointer-events-none">
        {/* Dimming: hidden from screen readers; a click pauses the tour and does nothing else. */}
        {centred || !spot ? (
          <div aria-hidden="true" data-testid="tour-dim" onClick={props.onPause} className="pointer-events-auto absolute inset-0 bg-black/50" />
        ) : (
          <>
            <div aria-hidden="true" data-testid="tour-dim" onClick={props.onPause} className="pointer-events-auto absolute left-0 right-0 top-0 bg-black/45" style={{ height: Math.max(spot.top, 0) }} />
            <div aria-hidden="true" data-testid="tour-dim" onClick={props.onPause} className="pointer-events-auto absolute left-0 right-0 bottom-0 bg-black/45" style={{ top: spot.top + spot.height }} />
            <div aria-hidden="true" data-testid="tour-dim" onClick={props.onPause} className="pointer-events-auto absolute left-0 bg-black/45" style={{ top: spot.top, height: spot.height, width: Math.max(spot.left, 0) }} />
            <div aria-hidden="true" data-testid="tour-dim" onClick={props.onPause} className="pointer-events-auto absolute right-0 bg-black/45" style={{ top: spot.top, height: spot.height, left: spot.left + spot.width }} />
            <div aria-hidden="true" data-testid="tour-ring" className={cn("absolute rounded-[var(--e-radius)] ring-2 ring-[hsl(var(--e-gold))] ring-offset-2 ring-offset-transparent", motion)} style={spot} />
          </>
        )}

        <div
          ref={tipRef}
          role="dialog"
          aria-modal="false"
          aria-label={mode === "intro" ? "Tour available" : `Tour step ${index + 1} of ${total}`}
          aria-describedby={bodyId}
          onKeyDown={onKeyDown}
          className={cn(
            "pointer-events-auto absolute rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] shadow-[0_12px_32px_rgb(0_0_0/0.28)]",
            centred
              ? "inset-x-3 bottom-3 mx-auto max-w-md p-6 sm:inset-x-0 sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2"
              : phone ? "p-4" : "p-4",
            !centred && !phone && "w-[320px]",
            motion,
          )}
          style={tipStyle}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-[0.6875rem] font-[600] uppercase tracking-[0.06em] text-[hsl(var(--e-muted-foreground))]">
              {centred ? `${index + 1} of ${total}` : stepLabel}
            </p>
            {step.practice ? (
              <span className="rounded-[var(--e-radius-pill)] bg-[hsl(var(--e-gold-soft))] px-2 py-0.5 text-[0.6875rem] font-[600] text-[hsl(var(--e-gold-ink))]">Practice</span>
            ) : null}
          </div>
          <h2 ref={headingRef} id={titleId} tabIndex={-1} className={cn("mt-1 outline-none", centred ? "e-serif text-[1.5rem] leading-tight" : "text-[1rem] font-[600]")}>
            {mode === "intro" ? "This page has a tour" : title}
          </h2>
          <p id={bodyId} className="mt-1.5 text-[0.875rem] leading-relaxed text-[hsl(var(--e-text-secondary))]">
            {mode === "intro" ? `${tour.title}: ${total} short steps on this page. Take it now, or any time from Help.` : step.body}
          </p>
          {step.note ? (
            <p className="mt-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-band-info-line))] bg-[hsl(var(--e-band-info-bg))] px-3 py-2 text-[0.8125rem] text-[hsl(var(--e-band-info-fg))]">{step.note}</p>
          ) : null}
          <p aria-live="polite" className="sr-only">{`${mode === "intro" ? "This page has a tour" : title}. ${centred ? `${index + 1} of ${total}` : stepLabel}.`}</p>

          {mode !== "intro" && total > 1 ? (
            <div aria-hidden="true" className="mt-3 flex gap-1.5">
              {plan.steps.map((entry, dotIndex) => (
                <span key={entry.id} className={cn("h-1.5 rounded-full", dotIndex === index ? "w-4 bg-[hsl(var(--e-primary))]" : "w-1.5 bg-[hsl(var(--e-border-strong))]")} />
              ))}
            </div>
          ) : null}

          {mode === "intro" ? (
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <EButton variant="ghost" size="sm" onClick={props.onNotNow}>Not now</EButton>
              <EButton size="sm" onClick={props.onTakeTour}>Take the tour</EButton>
            </div>
          ) : centred ? (
            <WelcomeButtons {...props} isLast={isLast} homeLabel={HOME_LABEL[tour.portal]} />
          ) : (
            <>
              <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                {index > 0 ? <EButton variant="outline" size="sm" onClick={props.onBack}>Back</EButton> : null}
                {offered ? (
                  <EButton variant="outline" size="sm" onClick={() => props.onOfferWalkthrough(offered.key)}>
                    {`Try: ${offered.title}`}
                  </EButton>
                ) : null}
                <EButton size="sm" onClick={props.onNext}>{isLast ? "Done" : "Next"}</EButton>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[hsl(var(--e-border))] pt-2">
                <button type="button" onClick={props.onSkip} className="min-h-11 text-[0.8125rem] font-[550] text-[hsl(var(--e-foreground))] underline underline-offset-2 sm:min-h-8">
                  Skip tour
                </button>
                <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[0.8125rem] text-[hsl(var(--e-text-secondary))] sm:min-h-8">
                  <input type="checkbox" checked={props.dontShowAgain} onChange={(event) => props.onToggleDontShowAgain(event.target.checked)} className="h-4 w-4 accent-[hsl(var(--e-primary))]" />
                  Don&apos;t show again
                </label>
              </div>
            </>
          )}
        </div>
      </div>
    </EstatePortal>
  );
}

function WelcomeButtons(props: TourOverlayProps & { isLast: boolean; homeLabel: string }) {
  const actions = props.step.actions ?? [];
  if (actions.length > 0) {
    return (
      <div className="mt-5 flex flex-col gap-2">
        {actions.map((action) => (
          <EButton key={action.label} variant={action.primary ? "primary" : "outline"} className="w-full" onClick={() => props.onAction(action)}>
            {action.label}
          </EButton>
        ))}
        <p className="text-center text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Replay any time from ? Help</p>
      </div>
    );
  }
  return (
    <div className="mt-5 flex flex-col gap-2">
      <EButton className="w-full" onClick={props.onNext}>Next</EButton>
      {props.index > 0 ? <EButton variant="outline" className="w-full" onClick={props.onBack}>Back</EButton> : null}
      <EButton variant="ghost" className="w-full" onClick={props.onSkip}>{`Skip, take me to ${props.homeLabel}`}</EButton>
    </div>
  );
}
