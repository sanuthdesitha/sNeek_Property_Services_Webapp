"use client";

/**
 * Help in every portal header (board "Tutorials", section 5): a ? button that
 * opens a panel to replay this page's tour, see What's new, start a
 * walkthrough and list every tour for the role with done or not done. The
 * "Show tours" switch stops tours popping up for this person; Help still lists
 * everything. A paused tour shows "Continue tour 3 of 5" beside the button.
 */
import * as React from "react";
import { CircleHelp, Play } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { EBottomSheet } from "@/components/v2/ui/bottom-sheet";
import { EPill, type EPillTone } from "@/components/v2/ui/pill";
import { cn } from "@/lib/utils";
import { HELP_TARGET_BY_PORTAL } from "@/lib/tutorials/targets";
import { DEFERRAL_MESSAGES, type HelpStatus } from "@/lib/tutorials/engine";
import { useTutorials, type HelpEntry, type TutorialContextValue } from "./tutorial-provider";

const STATUS_TEXT: Record<HelpStatus, { label: string; tone: EPillTone }> = {
  done: { label: "Done", tone: "ok" },
  notDone: { label: "Not done", tone: "neutral" },
  inProgress: { label: "Stopped part-way", tone: "warn" },
  new: { label: "New", tone: "info" },
};

function actionLabel(entry: HelpEntry): string {
  if (entry.status === "inProgress") return "Continue";
  if (entry.status === "done") return entry.tour.kind === "page" ? "Replay" : "Again";
  if (entry.status === "new") return "Show";
  return "Start";
}

function actionMode(entry: HelpEntry): "replay" | "continue" | "whatsNew" {
  if (entry.status === "inProgress") return "continue";
  if (entry.status === "new") return "whatsNew";
  return "replay";
}

function kindLabel(entry: HelpEntry): string {
  if (entry.tour.kind === "welcome") return "Welcome";
  if (entry.tour.kind === "walkthrough") return entry.tour.practice ? "Walkthrough · practice" : "Walkthrough";
  return "Page tour";
}

export function HelpControls({ pageLabel }: { pageLabel: string }) {
  const tutorials = useTutorials();
  if (!tutorials) return null;
  const { continueTour, newCount, portal } = tutorials;
  return (
    <>
      {continueTour ? (
        <button
          type="button"
          onClick={() => tutorials.startTour(continueTour.tourKey, "continue")}
          className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-[var(--e-radius-pill)] bg-[hsl(var(--e-primary))] px-3 text-[0.75rem] font-[600] text-[hsl(var(--e-primary-foreground))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <Play aria-hidden="true" className="h-3.5 w-3.5" />
          <span className="max-sm:hidden">{`Continue tour ${continueTour.step} of ${continueTour.total}`}</span>
          <span className="sm:hidden">{`Tour ${continueTour.step}/${continueTour.total}`}</span>
          <span className="sr-only sm:hidden">{`Continue tour ${continueTour.step} of ${continueTour.total}`}</span>
        </button>
      ) : null}
      <button
        type="button"
        {...HELP_TARGET_BY_PORTAL[portal]}
        onClick={() => tutorials.setHelpOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={tutorials.helpOpen}
        className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--e-radius)] text-[hsl(var(--e-foreground))] hover:bg-[hsl(var(--e-muted)/0.6)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <CircleHelp aria-hidden="true" className="h-5 w-5" />
        <span className="sr-only">{newCount > 0 ? `Help, ${newCount} new` : "Help"}</span>
        {newCount > 0 ? <span aria-hidden="true" className="absolute right-2 top-2 h-2 w-2 rounded-full bg-[hsl(var(--e-gold))]" /> : null}
      </button>
      <HelpPanel tutorials={tutorials} pageLabel={pageLabel} />
    </>
  );
}

function HelpRow({ entry, onStart }: { entry: HelpEntry; onStart: (entry: HelpEntry) => void }) {
  const status = STATUS_TEXT[entry.status];
  return (
    <li className="flex min-w-0 items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[0.875rem] font-[550]">{entry.tour.title}</p>
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{`${kindLabel(entry)} · ${entry.stepCount} ${entry.stepCount === 1 ? "step" : "steps"}`}</p>
      </div>
      <EPill tone={status.tone}>{status.label}</EPill>
      <EButton variant="outline" size="sm" onClick={() => onStart(entry)} aria-label={`${actionLabel(entry)}: ${entry.tour.title}`}>
        {actionLabel(entry)}
      </EButton>
    </li>
  );
}

function HelpPanel({ tutorials, pageLabel }: { tutorials: TutorialContextValue; pageLabel: string }) {
  const { helpEntries, state, loading, loadError, deferred, portal } = tutorials;
  const [showAll, setShowAll] = React.useState(false);
  const [switchError, setSwitchError] = React.useState<string | null>(null);
  const [switchBusy, setSwitchBusy] = React.useState(false);
  const thisPage = helpEntries.filter((entry) => entry.onThisPage);
  const walkthroughs = helpEntries.filter((entry) => entry.tour.kind === "walkthrough");
  const doneCount = helpEntries.filter((entry) => entry.status === "done").length;
  const start = (entry: HelpEntry) => tutorials.startTour(entry.tour.key, actionMode(entry));
  const deferredHere = deferred && thisPage.some((entry) => entry.tour.key === deferred.tourKey) ? DEFERRAL_MESSAGES[deferred.reason] : null;

  const toggleTours = async () => {
    if (!state) return;
    setSwitchBusy(true);
    setSwitchError(null);
    const ok = await tutorials.setToursOn(!state.toursOn);
    setSwitchBusy(false);
    if (!ok) setSwitchError("Your choice was not saved. Try again.");
  };

  return (
    <EBottomSheet open={tutorials.helpOpen} onOpenChange={tutorials.setHelpOpen} title={`Help · ${pageLabel}`} description="Tours for this page and every walkthrough for your role.">
      <div className="space-y-5 px-5 pb-5 text-[hsl(var(--e-foreground))]">
        {loading && !state ? <p role="status" className="text-[0.875rem]">Loading tours…</p> : null}
        {loadError && !state ? <p role="alert" className="text-[0.875rem]">{loadError}</p> : null}
        {state && !state.recordable && state.notRecordableReason ? (
          <p className="rounded-[var(--e-radius)] border border-[hsl(var(--e-band-info-line))] bg-[hsl(var(--e-band-info-bg))] px-3 py-2 text-[0.8125rem] text-[hsl(var(--e-band-info-fg))]">{state.notRecordableReason}</p>
        ) : null}
        {deferredHere ? <p role="status" className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{deferredHere}</p> : null}

        {state ? (
          <>
            <section aria-labelledby="help-this-page">
              <h3 id="help-this-page" className="e-eyebrow">This page</h3>
              {thisPage.length > 0 ? (
                <ul className="divide-y divide-[hsl(var(--e-border))]">{thisPage.map((entry) => <HelpRow key={entry.tour.key} entry={entry} onStart={start} />)}</ul>
              ) : (
                <p className="py-2 text-[0.875rem] text-[hsl(var(--e-text-secondary))]">This page has no tour yet. The tours below still work from here.</p>
              )}
            </section>

            {walkthroughs.length > 0 ? (
              <section aria-labelledby="help-walkthroughs">
                <h3 id="help-walkthroughs" className="e-eyebrow">Walkthroughs</h3>
                <ul className="divide-y divide-[hsl(var(--e-border))]">{walkthroughs.map((entry) => <HelpRow key={entry.tour.key} entry={entry} onStart={start} />)}</ul>
              </section>
            ) : null}

            <section aria-labelledby="help-all">
              <button
                type="button"
                id="help-all"
                aria-expanded={showAll}
                aria-controls="help-all-list"
                onClick={() => setShowAll((value) => !value)}
                className="min-h-11 text-[0.875rem] font-[550] underline underline-offset-2"
              >
                {`All tours (${doneCount} of ${helpEntries.length} done)`}
              </button>
              <ul id="help-all-list" hidden={!showAll} className="divide-y divide-[hsl(var(--e-border))]">
                {helpEntries.map((entry) => <HelpRow key={entry.tour.key} entry={entry} onStart={start} />)}
              </ul>
            </section>

            <div className="flex items-center justify-between gap-3 border-t border-[hsl(var(--e-border))] pt-4">
              <div className="min-w-0">
                <p id="help-show-tours" className="text-[0.875rem] font-[550]">Show tours</p>
                <p id="help-show-tours-hint" className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  {state.roleToursOn ? "Off stops tours and What's new popping up. Help still lists everything." : "Tours are turned off for your role by the office. Help still lists everything."}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={state.toursOn}
                aria-labelledby="help-show-tours"
                aria-describedby="help-show-tours-hint"
                disabled={!state.recordable || switchBusy}
                onClick={toggleTours}
                className={cn(
                  "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border border-[hsl(var(--e-border-strong))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50",
                  state.toursOn ? "bg-[hsl(var(--e-primary))]" : "bg-[hsl(var(--e-muted))]",
                )}
              >
                <span aria-hidden="true" className={cn("absolute h-5 w-5 rounded-full bg-[hsl(var(--e-surface))] shadow", state.toursOn ? "left-6" : "left-1")} />
              </button>
            </div>
            {switchError ? <p role="alert" className="text-[0.8125rem]">{switchError}</p> : null}
            {portal !== "admin" ? <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Need a person? Message the office from Messages.</p> : null}
          </>
        ) : null}
      </div>
    </EBottomSheet>
  );
}
