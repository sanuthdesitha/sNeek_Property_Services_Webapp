"use client";

/**
 * Wraps a practice screen (board "Tutorials", section 4). It installs the
 * practice network guard BEFORE the real screen mounts, so not even a
 * component's first effect can write; it shows the striped "Practice · nothing
 * is sent" banner with End practice; and it starts the walkthrough when the
 * screen is opened directly. Sample data is labelled "Practice" on screen.
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { findTour } from "@/lib/tutorials/registry";
import { installPracticeGuard } from "./practice-guard";
import { PRACTICE_FIXTURE_SETS, type PracticeFixtureSet } from "./practice-fixtures";
import { useTutorials } from "./tutorial-provider";

const STRIPES: React.CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(135deg, hsl(var(--e-band-attention-bg)) 0 12px, hsl(var(--e-band-attention-bg) / 0.55) 12px 24px)",
};

export function PracticeBoundary({
  tourKey,
  fixtureSet = "none",
  children,
}: {
  tourKey: string;
  /** Reads answered from sample data in the browser (practice-fixtures.ts). */
  fixtureSet?: PracticeFixtureSet;
  children: React.ReactNode;
}) {
  const tour = findTour(tourKey);
  const tutorials = useTutorials();
  const [ready, setReady] = React.useState(false);
  const startedRef = React.useRef(false);
  // Fixtures are fixed for the life of the screen.
  const fixturesRef = React.useRef(PRACTICE_FIXTURE_SETS[fixtureSet]);

  React.useLayoutEffect(() => {
    const uninstall = installPracticeGuard(fixturesRef.current);
    setReady(true);
    return () => {
      uninstall();
    };
  }, []);

  const hasState = Boolean(tutorials?.state);
  const runningKey = tutorials?.run?.plan.tourKey ?? null;
  React.useEffect(() => {
    if (!ready || !tutorials || !hasState || startedRef.current) return;
    startedRef.current = true;
    if (runningKey !== tourKey) tutorials.startTour(tourKey, "replay");
  }, [ready, tutorials, hasState, runningKey, tourKey]);

  const banner = tour?.practice?.banner ?? "Practice · nothing is sent";

  return (
    <div data-practice="true" className="space-y-4">
      <div
        role="note"
        aria-label="Practice mode"
        style={STRIPES}
        className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-band-attention-line))] px-4 py-2.5 text-[hsl(var(--e-band-attention-fg))]"
      >
        <p className="min-w-0 text-[0.875rem] font-[600]">{banner}</p>
        <EButton
          variant="outline"
          size="sm"
          onClick={() => {
            if (tutorials) tutorials.endPractice(tourKey);
            else if (tour?.practice) window.location.assign(tour.practice.exitHref);
          }}
        >
          End practice
        </EButton>
      </div>
      {ready ? children : <p role="status" className="text-[0.875rem]">Preparing the practice screen…</p>}
    </div>
  );
}
