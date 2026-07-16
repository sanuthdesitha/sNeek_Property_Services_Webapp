"use client";

/**
 * Stage 3 — Set up. The existing job-start gate content, re-ordered into the
 * setup sequence: code → duration → laundry bag → READ FIRST → setup reference
 * strip → restock needs → watch-outs → confirmation checkboxes → CLOCK IN. All
 * gate booleans, confirmations and the clockIn handler come from the workspace
 * unchanged. The job briefing (prior QA / linen drop / access vault) rides along
 * as pre-start context.
 */
import * as React from "react";
import { Clock, WashingMachine, BookOpen, Package, AlertTriangle, ClipboardCheck } from "lucide-react";
import { ECard, ECardBody, EAlert } from "@/components/v2/ui/primitives";
import { MediaGallery } from "@/components/shared/media-gallery";
import { ReadFirstBlock } from "@/components/v2/cleaner/read-first-block";
import { ClockCard, BriefingCard } from "@/components/v2/cleaner/job-stages/parts";
import type { WorkspaceApi } from "@/components/v2/cleaner/job-stages/shared";

export function StageSetup({ api }: { api: WorkspaceApi }) {
  const {
    propertyCode,
    expectedDurationMinutes,
    formatDurationMinutes,
    laundryEnabled,
    bagLabel,
    bagColor,
    readFirstItems,
    setupGuideEntries,
    restockNeeds,
    recurringIssues,
    startGateBlocks,
    propertyCodeConfirmed,
    setPropertyCodeConfirmed,
    laundryBagConfirmRequired,
    laundryBagConfirmed,
    setLaundryBagConfirmed,
    briefing,
    timeState,
    status,
    locked,
    hasCheckin,
    busy,
    clockInDisabled,
    addressLine,
  } = api;

  return (
    <div className="space-y-5">
      {api.payload?.job?.formPendingAfterClockOut && !locked ? (
        <EAlert tone="warning" title="Form still pending">
          You clocked out without submitting the form. This job is not complete until the form is submitted.
        </EAlert>
      ) : null}

      <BriefingCard briefing={briefing} />

      <ECard className={api.hasStarted ? undefined : "border-[hsl(var(--e-gold))]"}>
        <ECardBody className="space-y-4 pt-6">
          <p className="flex items-center gap-1.5">
            <ClipboardCheck className="h-4 w-4 text-[hsl(var(--e-gold))]" />
            <span className="text-[0.9375rem] font-[600]">Property setup</span>
          </p>

          {/* Property code — big */}
          <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3">
            <p className="text-[0.625rem] uppercase tracking-[0.08em] text-[hsl(var(--e-text-faint))]">Property code</p>
            <p className="text-[1.75rem] font-[650] leading-tight tracking-[0.02em]">{propertyCode || "—"}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
              <p className="flex items-center gap-1.5 text-[0.625rem] uppercase tracking-[0.08em] text-[hsl(var(--e-text-faint))]">
                <Clock className="h-3.5 w-3.5" /> Expected duration
              </p>
              <p className="mt-1 text-[0.9375rem] font-[550]">
                {expectedDurationMinutes != null ? formatDurationMinutes(expectedDurationMinutes) : "Not set"}
              </p>
            </div>

            {laundryEnabled && (bagLabel || bagColor) ? (
              <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
                <p className="flex items-center gap-1.5 text-[0.625rem] uppercase tracking-[0.08em] text-[hsl(var(--e-text-faint))]">
                  <WashingMachine className="h-3.5 w-3.5" /> Laundry bag
                </p>
                <div className="mt-1 flex items-center gap-2">
                  {bagColor ? (
                    <span
                      className="inline-block h-4 w-4 shrink-0 rounded-full border border-[hsl(var(--e-border-strong))]"
                      style={{ backgroundColor: bagColor }}
                      aria-hidden
                    />
                  ) : null}
                  <span className="text-[0.9375rem] font-[550]">
                    {bagLabel || "—"}
                    {bagColor ? (
                      <span className="ml-1 text-[0.8125rem] font-[400] text-[hsl(var(--e-muted-foreground))]">
                        ({bagColor})
                      </span>
                    ) : null}
                  </span>
                </div>
              </div>
            ) : null}
          </div>

          {readFirstItems.length > 0 ? <ReadFirstBlock items={readFirstItems} /> : null}

          {setupGuideEntries.length > 0 ? (
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-[0.8125rem] font-[550]">
                <BookOpen className="h-3.5 w-3.5" /> Setup reference
              </p>
              {setupGuideEntries.map((entry, ei) => {
                const images = Array.isArray(entry.images) ? entry.images.filter((im) => im?.url) : [];
                return (
                  <div key={entry.id || `setup-${ei}`} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
                    {entry.label ? <p className="text-[0.8125rem] font-[550]">{entry.label}</p> : null}
                    {entry.instructions ? (
                      <p className="mt-0.5 whitespace-pre-wrap text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                        {entry.instructions}
                      </p>
                    ) : null}
                    {images.length > 0 ? (
                      <MediaGallery
                        items={images.map((im, ii) => ({
                          id: `${entry.id || ei}-${ii}`,
                          url: im.url as string,
                          label: im.caption || entry.label || undefined,
                        }))}
                        title={entry.label || "Setup reference"}
                        className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4"
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}

          {restockNeeds.length > 0 ? (
            <div className="rounded-[var(--e-radius)] border-l-[3px] border-[hsl(var(--e-warning))] bg-[hsl(var(--e-warning-soft))] p-3">
              <p className="flex items-center gap-1.5 text-[0.8125rem] font-[550]">
                <Package className="h-4 w-4" /> Restock needed
              </p>
              <ul className="mt-1.5 space-y-1">
                {restockNeeds.map((r, ri) => (
                  <li key={`${r.name}-${ri}`} className="flex items-center justify-between gap-2 text-[0.8125rem]">
                    <span>{r.name}</span>
                    <span className="font-[550] tabular-nums">
                      +{r.needed}
                      {r.unit ? ` ${r.unit}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {recurringIssues.length > 0 ? (
            <div className="rounded-[var(--e-radius)] border-l-[3px] border-[hsl(var(--e-warning))] bg-[hsl(var(--e-warning-soft))] p-3">
              <p className="flex items-center gap-1.5 text-[0.8125rem] font-[550]">
                <AlertTriangle className="h-4 w-4" /> Watch-outs from previous cleans
              </p>
              <ul className="mt-1.5 space-y-1">
                {recurringIssues.map((r, ri) => (
                  <li key={ri} className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {startGateBlocks ? (
            <div className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold-soft))] p-3">
              <label className="flex items-start gap-2 text-[0.875rem]">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-[hsl(var(--e-gold))]"
                  checked={propertyCodeConfirmed}
                  onChange={(e) => setPropertyCodeConfirmed(e.target.checked)}
                />
                <span>
                  I have verified the property code
                  {propertyCode ? <span className="font-[600]"> — {propertyCode}</span> : null}
                </span>
              </label>
              {laundryBagConfirmRequired ? (
                <label className="flex items-start gap-2 text-[0.875rem]">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-[hsl(var(--e-gold))]"
                    checked={laundryBagConfirmed}
                    onChange={(e) => setLaundryBagConfirmed(e.target.checked)}
                  />
                  <span>
                    I am using the correct laundry bag
                    {bagLabel ? <span className="font-[600]"> — {bagLabel}</span> : null}
                  </span>
                </label>
              ) : null}
            </div>
          ) : null}
        </ECardBody>
      </ECard>

      <ClockCard
        status={status}
        locked={locked}
        hasCheckin={hasCheckin}
        isRunning={timeState.isRunning}
        completedSeconds={timeState.completedSeconds}
        activeStartedAt={timeState.activeStartedAt ?? null}
        maxAllowedTotalSeconds={timeState.maxAllowedTotalSeconds ?? null}
        busy={busy}
        clockInDisabled={clockInDisabled}
        onClockIn={api.clockIn}
        onPause={api.pauseClock}
      />
    </div>
  );
}
