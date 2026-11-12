"use client";

/**
 * Wrap up → Laundry handoff (board: "Laundry handoff · Ready / Not ready / No
 * pickup · Bags · Left at · + Laundry photo"). Moved out of stage-wrapup.tsx
 * unchanged in behaviour: the same workspace setters, the same early-send
 * command and the same saved-receipt lock. The outcome is a segmented choice
 * over the same three stored values the select used.
 */
import * as React from "react";
import { WashingMachine, Check } from "lucide-react";
import { EButton, ECard, ECardBody } from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect, ETextarea } from "@/components/v2/cleaner/fields";
import { MediaCapture } from "@/components/v2/cleaner/media-capture";
import { LAUNDRY_SKIP_REASONS, type LaundryOutcome, type WorkspaceApi } from "@/components/v2/cleaner/job-stages/shared";
import { cn } from "@/lib/utils";

export const LAUNDRY_CARD_ID = "wrapup-laundry";

/** Human labels for the locked "sent" summary. */
export const LAUNDRY_OUTCOME_LABELS: Record<string, string> = {
  READY_FOR_PICKUP: "Ready for pickup",
  NOT_READY: "Not ready",
  NO_PICKUP_REQUIRED: "No pickup required",
};

const OUTCOME_CHOICES: Array<{ value: LaundryOutcome; label: string }> = [
  { value: "READY_FOR_PICKUP", label: "Ready" },
  { value: "NOT_READY", label: "Not ready" },
  { value: "NO_PICKUP_REQUIRED", label: "No pickup" },
];

function LaundryOutcomeChoice({ value, disabled, onChange }: { value: LaundryOutcome | ""; disabled: boolean; onChange: (value: LaundryOutcome | "") => void }) {
  const name = React.useId();
  return (
    <fieldset disabled={disabled} className="space-y-1.5">
      <legend className="text-[0.8125rem] font-[550]">Outcome (required)</legend>
      <div className="grid grid-cols-3 gap-1 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-1">
        {OUTCOME_CHOICES.map((choice) => {
          const checked = value === choice.value;
          return (
            <label
              key={choice.value}
              className={cn(
                "flex min-h-11 cursor-pointer items-center justify-center rounded-[var(--e-radius)] px-2 text-center text-[0.8125rem] font-[550] focus-within:outline focus-within:outline-2",
                checked ? "bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] shadow-[var(--e-elevation-1)]" : "text-[hsl(var(--e-muted-foreground))]",
              )}
            >
              <input type="radio" name={name} value={choice.value} checked={checked} onChange={() => onChange(choice.value)} className="sr-only" />
              {choice.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function LaundryHandoff({ api }: { api: WorkspaceApi }) {
  const { locked, addressLine, property } = api;
  return (
    <ECard id={LAUNDRY_CARD_ID}>
      <ECardBody className="space-y-3 pt-6">
        <p className="e-eyebrow flex items-center gap-1.5">
          <WashingMachine className="h-3.5 w-3.5" /> Laundry handoff
        </p>
        {api.laundryLocked ? (
          /* SENT: the update already went to the laundry team. Lock it to a
             read-only summary (v1 parity) so it can't be silently changed —
             and so submit doesn't transmit a second, different update.
             "Edit update" is the deliberate way back into the form. */
          <div className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-success)/0.4)] bg-[hsl(var(--e-success)/0.06)] p-3">
            <p className="flex items-center gap-1.5 text-[0.875rem] font-[600] text-[hsl(var(--e-success))]">
              <Check className="h-4 w-4" /> Laundry update saved
            </p>
            <dl className="space-y-0.5 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
              <div className="flex gap-1.5">
                <dt className="text-[hsl(var(--e-muted-foreground))]">Outcome:</dt>
                <dd className="font-[550]">{LAUNDRY_OUTCOME_LABELS[api.laundryOutcome] ?? api.laundryOutcome}</dd>
              </div>
              {api.laundryOutcome === "READY_FOR_PICKUP" && api.laundryBagLocation ? (
                <div className="flex gap-1.5">
                  <dt className="text-[hsl(var(--e-muted-foreground))]">Bag left at:</dt>
                  <dd className="font-[550]">{api.laundryBagLocation}</dd>
                </div>
              ) : null}
              {api.laundryEarlySentAt ? (
                <div className="flex gap-1.5">
                  <dt className="text-[hsl(var(--e-muted-foreground))]">Recorded:</dt>
                  <dd className="font-[550]">{api.laundryEarlySentAt}</dd>
                </div>
              ) : null}
              {api.laundryOutcome === "READY_FOR_PICKUP" ? <div className="flex gap-1.5"><dt>Bags ready:</dt><dd>{api.laundryBagCount || "Not recorded"}</dd></div> : null}
              {api.laundryOutcome !== "READY_FOR_PICKUP" ? <div className="flex gap-1.5"><dt>Reason:</dt><dd>{api.laundrySkipNote || api.laundrySkipCode.replaceAll("_", " ").toLowerCase()}</dd></div> : null}
            </dl>
            {api.laundryPhoto[0]?.url ? <a href={api.laundryPhoto[0].url} target="_blank" rel="noopener noreferrer" className="text-sm underline">View saved laundry photo</a> : null}
            <p className="text-xs text-[hsl(var(--e-muted-foreground))]">This is the saved update receipt. Notification delivery is tracked separately.</p>
            <EButton variant="outline" size="sm" disabled={locked} onClick={api.beginLaundryEdit}>
              Edit update
            </EButton>
          </div>
        ) : (
        <>
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          Tell the laundry service the used-linen bag is ready. They collect it — you don&apos;t take it.
          Saved when you submit and sent to the laundry team.
        </p>
        <LaundryOutcomeChoice value={api.laundryOutcome} disabled={locked} onChange={api.setLaundryOutcome} />
        {api.laundryOutcome === "READY_FOR_PICKUP" ? (
          <>
            <EField label="Bags ready (optional)">
              <EInput aria-label="Bags ready (optional)" type="number" min={1} max={50} step={1} value={api.laundryBagCount}
                disabled={locked || api.laundryBagCountRecorded} onChange={e => api.setLaundryBagCount(e.target.value)} />
              <p className="text-xs text-[hsl(var(--e-muted-foreground))]">{api.laundryBagCountRecorded ? "The original ready count is retained for pickup comparison. An unrecorded count stays unknown." : "Count the bags left for pickup. Leave blank if you cannot confirm the count."}</p>
            </EField>
            <EField label="Bag location (required)">
              {api.laundryBagLocationOptions.length > 0 ? (
                <ESelect
                  value={api.laundryBagLocation}
                  disabled={locked}
                  onChange={(e) => api.setLaundryBagLocation(e.target.value)}
                >
                  <option value="">Select where you left the bag…</option>
                  {api.laundryBagLocationOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                  {api.laundryBagLocation &&
                  !api.laundryBagLocationOptions.includes(api.laundryBagLocation) ? (
                    <option value={api.laundryBagLocation}>{api.laundryBagLocation}</option>
                  ) : null}
                </ESelect>
              ) : (
                <EInput
                  placeholder="e.g. Laundry room shelf, labeled bags"
                  value={api.laundryBagLocation}
                  disabled={locked}
                  onChange={(e) => api.setLaundryBagLocation(e.target.value)}
                />
              )}
            </EField>
            <EField label="Laundry photo (required)">
              <MediaCapture
                evidenceDestination={{ type: "laundry" }}
                multiple={false}
                value={api.laundryPhoto}
                onChange={api.setLaundryPhoto}
                mode="photo"
                folder="laundry"
                disabled={locked}
                stamp={{
                  address: addressLine || undefined,
                  reference: (property?.name as string) || undefined,
                  tag: "laundry",
                  contextLabel: "Laundry bags ready for pickup",
                }}
              />
            </EField>
          </>
        ) : api.laundryOutcome ? (
          <>
            <EField label="Reason (required)">
              <ESelect value={api.laundrySkipCode} disabled={locked} onChange={(e) => api.setLaundrySkipCode(e.target.value)}>
                {LAUNDRY_SKIP_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </ESelect>
            </EField>
            <EField label="Note (optional)">
              <ETextarea value={api.laundrySkipNote} disabled={locked} onChange={(e) => api.setLaundrySkipNote(e.target.value)} />
            </EField>
          </>
        ) : null}

        {api.laundryOutcome && !locked ? (
          <div className="space-y-1.5 border-t border-[hsl(var(--e-border))] pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                Linen ready before the form is done? Send this status to the laundry team now.
                {api.laundryEarlySentAt ? ` Last recorded ${api.laundryEarlySentAt}.` : ""}
              </p>
              <EButton
                variant="outline"
                size="sm"
                disabled={
                  api.laundryEarlySending ||
                  (api.laundryOutcome === "READY_FOR_PICKUP" &&
                    (!api.laundryBagLocation.trim() || api.laundryPhoto.length === 0))
                }
                onClick={() => api.sendLaundryEarlyUpdate()}
              >
                {api.laundryEarlySending ? "Sending…" : "Send to laundry team now"}
              </EButton>
            </div>
            {api.laundryAmendedSinceSend ? (
              <p className="text-[0.75rem] text-[hsl(var(--e-gold-ink))]">
                You&apos;ve changed this since sending — the amendment goes with your submission.
              </p>
            ) : null}
            {api.laundryEarlyNotice ? (
              <p
                className={`text-[0.75rem] ${
                  api.laundryEarlyNotice.tone === "success"
                    ? "text-[hsl(var(--e-success))]"
                    : "text-[hsl(var(--e-danger))]"
                }`}
              >
                {api.laundryEarlyNotice.text}
              </p>
            ) : null}
          </div>
        ) : null}
        </>
        )}
      </ECardBody>
    </ECard>
  );
}
