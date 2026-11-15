"use client";

import "@/app/v2/estate.css";
import { useState } from "react";
import { Eye, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { toneBandClass, tonePillClass, toneMutedClass } from "@/components/v2/ui/tone-band";
import { testAsModeWords } from "@/lib/auth/test-as-rules";

/**
 * The always-on reminder that you are not yourself (board "Test as").
 *
 * Fixed above every page of every portal (v1 and v2), never covering it:
 * body and sticky headers are offset in globals.css. The tinted band, the
 * mode in words and the icon all say the mode (honey for view only, wine for
 * full access), with the end time in the organisation timezone. "Stop
 * testing" ends it at once; if the network fails the banner stays and says so.
 */
export type ImpersonationBarProps = {
  targetName: string;
  /** "Marco R.", for the phone banner. */
  targetShortName: string;
  /** "cleaner", "client", … */
  targetRoleLabel: string;
  mode: "READ_ONLY" | "FULL";
  /** "15:42" in the organisation timezone. */
  endsAtLabel: string;
};

/** Phone: "Stop" (or "Try again" after a failure); from 640px: "Stop testing". */
function StopLabel({ stopping, failed }: { stopping: boolean; failed: boolean }) {
  if (stopping) return <>Stopping…</>;
  return (
    <>
      <span className="sm:hidden">{failed ? "Try again" : "Stop"}</span>
      <span className="max-sm:hidden">Stop testing</span>
    </>
  );
}

export function ImpersonationBar({ targetName, targetShortName, targetRoleLabel, mode, endsAtLabel }: ImpersonationBarProps) {
  const [stopping, setStopping] = useState(false);
  const [failed, setFailed] = useState(false);
  const readOnly = mode === "READ_ONLY";
  const tone = readOnly ? "attention" : "problem";
  const words = testAsModeWords(mode);
  const Icon = readOnly ? Eye : Pencil;

  async function stop() {
    setStopping(true);
    setFailed(false);
    try {
      const response = await fetch("/api/admin/impersonate", { method: "DELETE" });
      if (!response.ok) throw new Error("not stopped");
      // Hard navigation: server components all over the app cached the
      // tested identity, so a soft refresh could leave stale data behind.
      window.location.href = "/v2/admin/system/test-as?stopped=1";
    } catch {
      setStopping(false);
      setFailed(true);
    }
  }

  return (
    <div data-skin="estate" className="impersonation-bar fixed inset-x-0 top-0 z-[200]">
      <div
        role="region"
        aria-label="Testing as someone else"
        className={cn("flex h-[3.25rem] items-center gap-2 px-3 text-[0.8125rem] sm:h-11 sm:gap-3 sm:px-4", toneBandClass(tone))}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
        <p className="min-w-0 flex-1 truncate">
          <span className="sm:hidden">
            As <strong className="font-[650]">{targetShortName}</strong> · {readOnly ? words.short : "Full, real"}
          </span>
          <span className="max-sm:hidden">
            Testing as <strong className="font-[650]">{targetName}</strong>
            <span className={toneMutedClass(tone)}> · {targetRoleLabel}</span>
          </span>
        </p>
        <span className={cn(tonePillClass(tone), "max-sm:hidden")}>{words.long}</span>
        <span className={cn("shrink-0 max-sm:hidden", toneMutedClass(tone))} role={failed ? "alert" : undefined}>
          {failed ? "Could not stop. Try again." : `ends ${endsAtLabel}`}
        </span>
        {failed ? (
          <span role="alert" className="sr-only sm:hidden">Could not stop. Try again.</span>
        ) : null}
        <button
          type="button"
          onClick={stop}
          disabled={stopping}
          className="inline-flex h-11 shrink-0 items-center rounded-full bg-[hsl(var(--e-foreground))] px-4 text-[0.8125rem] font-[650] text-[hsl(var(--e-background))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60 sm:h-8"
        >
          <StopLabel stopping={stopping} failed={failed} />
        </button>
      </div>
    </div>
  );
}
