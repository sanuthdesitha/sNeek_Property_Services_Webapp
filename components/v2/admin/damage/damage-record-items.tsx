"use client";

/**
 * One card per damaged item: the cleaner's words, the photos (each labelled,
 * the marked-up copy shown beside the untouched original in Preview), the
 * item's case and repair read live, the internal repair estimate and the
 * item's own history.
 *
 * The estimate saves when the field is left (the existing SET_COST change).
 * A blank estimate is "not estimated" and left out of the total, never $0.
 * While it saves the field is frozen; a refused save keeps what was typed
 * with the reason and a retry.
 */
import * as React from "react";
import Link from "next/link";
import { EButton } from "@/components/v2/ui/primitives";
import { EToneCard } from "@/components/v2/ui/tone-band";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { cn } from "@/lib/utils";
import type { RecordItem, RecordPhoto } from "./damage-record-api";
import { CASE_STATE_LABEL, CAUSE_LABEL, REPAIR_STATUS_LABEL, SECTION_LABEL, SEVERITY_LABEL, dayOnly, itemBand, titleText, weekdayTime } from "./damage-record-format";

type SaveState = { status: "idle" } | { status: "saving" } | { status: "saved" } | { status: "failed"; message: string };

function photoLabel(photo: RecordPhoto): string {
  const section = SECTION_LABEL[photo.section] ?? titleText(photo.section);
  return photo.markedUpUrl ? `${section} · marked up` : section;
}

function PhotoPreview({ photo, itemTitle, onClose }: { photo: RecordPhoto; itemTitle: string; onClose: () => void }) {
  const original = photo.originalUrl ?? photo.url;
  return (
    <EActionDialog open wide onClose={onClose} title={`${itemTitle}: ${photoLabel(photo)}`} eyebrow="Photo">
      <div className={cn("grid gap-3", photo.markedUpUrl ? "sm:grid-cols-2" : "grid-cols-1")}>
        <figure className="space-y-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={original} alt={`${itemTitle}, ${SECTION_LABEL[photo.section] ?? photo.section}, original`} className="max-h-[60vh] w-full rounded-[var(--e-radius)] object-contain" />
          <figcaption className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">Original, as the cleaner took it · never changed</figcaption>
        </figure>
        {photo.markedUpUrl ? (
          <figure className="space-y-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.markedUpUrl} alt={`${itemTitle}, ${SECTION_LABEL[photo.section] ?? photo.section}, marked up`} className="max-h-[60vh] w-full rounded-[var(--e-radius)] object-contain" />
            <figcaption className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">Marked-up copy · kept separately from the original</figcaption>
          </figure>
        ) : null}
      </div>
      {photo.caption ? <p className="mt-2 text-[0.8125rem]">{photo.caption}</p> : null}
    </EActionDialog>
  );
}

const SECTION_ORDER = ["OVERVIEW", "CLOSE_UP", "CONTEXT", "EVIDENCE"];

/** Overview, close-up, context, evidence; the cleaner's order within a section. */
function orderedPhotos(photos: RecordPhoto[]): RecordPhoto[] {
  const rank = (photo: RecordPhoto) => {
    const index = SECTION_ORDER.indexOf(photo.section);
    return index === -1 ? SECTION_ORDER.length : index;
  };
  return photos.map((photo, index) => ({ photo, index })).sort((a, b) => rank(a.photo) - rank(b.photo) || a.index - b.index).map((entry) => entry.photo);
}

function Photos({ item, title }: { item: RecordItem; title: string }) {
  const [open, setOpen] = React.useState<RecordPhoto | null>(null);
  if (item.photos.length === 0) return <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">No photos on this item.</p>;
  return (
    <>
      <ul className="flex flex-wrap gap-2" aria-label={`Photos of ${title}`}>
        {orderedPhotos(item.photos).map((photo) => (
          <li key={photo.id}>
            <button
              type="button"
              onClick={() => setOpen(photo)}
              className="relative block h-[72px] w-[100px] overflow-hidden rounded-[8px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[hsl(var(--e-ring))] sm:h-[70px] sm:w-[97px]"
              aria-label={`Preview ${photoLabel(photo)}${photo.markedUpUrl ? " and the original" : ""}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt="" className="h-full w-full object-cover" />
              <span className="absolute bottom-1 left-1 max-w-[calc(100%-0.5rem)] rounded-[4px] bg-[hsl(160_18%_8%/0.72)] px-1.5 py-0.5 text-left text-[0.625rem] font-[550] leading-tight text-white">
                {photoLabel(photo)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {open ? <PhotoPreview photo={open} itemTitle={title} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function CaseAndRepair({ item, clientVisible, earlierReports }: { item: RecordItem; clientVisible: boolean; earlierReports: number }) {
  const repair = item.maintenance[0] ?? null;
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
      <span>
        Case{" "}
        {item.caseId ? (
          <>
            <Link href={`/v2/admin/cases?open=${encodeURIComponent(item.caseId)}`} className="text-[hsl(var(--e-foreground))] underline underline-offset-2">open case</Link>{" "}
            <b className="font-[600] text-[hsl(var(--e-foreground))]">{CASE_STATE_LABEL[item.caseState ?? ""] ?? titleText(item.caseState)}</b>, {clientVisible ? "visible to the client" : "hidden from client"}
          </>
        ) : (
          <b className="font-[600] text-[hsl(var(--e-foreground))]">Not opened yet</b>
        )}
      </span>
      {repair ? (
        <span>
          Repair{" "}
          <Link href={`/v2/admin/maintenance/${encodeURIComponent(repair.id)}`} className="text-[hsl(var(--e-foreground))] underline underline-offset-2">{repair.title}</Link>{" "}
          <b className="font-[600] text-[hsl(var(--e-foreground))]">{REPAIR_STATUS_LABEL[repair.status] ?? titleText(repair.status)}</b>
          {` · ${repair.assignedWorkerName ?? "nobody assigned"}, ${repair.scheduledFor ? "visit booked" : "visit not booked"}`}
          {item.maintenance.length > 1 ? ` · ${item.maintenance.length - 1} more` : ""}
        </span>
      ) : item.caseId ? (
        <span>Repair <b className="font-[600] text-[hsl(var(--e-foreground))]">None linked</b></span>
      ) : null}
      {!repair ? <span>Earlier reports here: <b className="font-[600] text-[hsl(var(--e-foreground))]">{earlierReports === 0 ? "none" : earlierReports}</b></span> : null}
    </p>
  );
}

function EstimateField({ item, frozen, onSave }: { item: RecordItem; frozen: boolean; onSave: (itemId: string, value: number | null) => Promise<string | null> }) {
  const [draft, setDraft] = React.useState(item.estimatedCost === null ? "" : item.estimatedCost.toFixed(2));
  const [state, setState] = React.useState<SaveState>({ status: "idle" });
  const inputId = React.useId();
  const hintId = React.useId();
  const stored = item.estimatedCost;

  // A newer stored value (after a reload) replaces the field, unless a refused save is being kept for retry.
  const keepDraft = state.status === "failed" || state.status === "saving";
  const keepRef = React.useRef(keepDraft);
  keepRef.current = keepDraft;
  React.useEffect(() => {
    if (keepRef.current) return;
    setDraft(stored === null ? "" : stored.toFixed(2));
  }, [stored]);

  async function commit() {
    const raw = draft.trim();
    const next = raw === "" ? null : Number(raw);
    if (next !== null && (!Number.isFinite(next) || next < 0)) {
      setState({ status: "failed", message: "Enter an amount of zero or more, or leave it blank for not estimated." });
      return;
    }
    const rounded = next === null ? null : Math.round(next * 100) / 100;
    if (rounded === stored) {
      if (state.status === "failed") setState({ status: "idle" });
      return;
    }
    setState({ status: "saving" });
    const refusal = await onSave(item.id, rounded);
    setState(refusal ? { status: "failed", message: refusal } : { status: "saved" });
  }

  const saving = state.status === "saving";
  return (
    <div className="space-y-1">
      <label htmlFor={inputId} className="block text-[0.75rem] font-[650] text-[hsl(var(--e-text-secondary))]">Repair estimate, AUD · internal</label>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <input
          id={inputId}
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          placeholder="Not estimated"
          value={draft}
          disabled={frozen || saving}
          aria-describedby={hintId}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }}
          className="h-9 w-36 rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-2.5 text-[0.875rem] placeholder:text-[hsl(var(--e-text-faint))] disabled:opacity-60 max-sm:h-11 max-sm:w-full max-sm:text-[16px]"
        />
        <p id={hintId} className="min-w-0 flex-1 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
          {draft.trim() === "" ? "Blank stays \"not estimated\" and is left out of the total, never counted as $0." : "Saved when you leave the field · never shown to the client. Clear it to say \"not estimated\"."}
        </p>
      </div>
      <p aria-live="polite" className="text-[0.75rem]">
        {state.status === "saving" ? <span className="text-[hsl(var(--e-text-secondary))]">Saving…</span> : null}
        {state.status === "saved" ? <span className="text-[hsl(var(--e-success))]">Saved</span> : null}
      </p>
      {state.status === "failed" ? (
        <p role="alert" className="flex flex-wrap items-center gap-2 text-[0.75rem] text-[hsl(var(--e-danger))]">
          It was not saved: {state.message}
          <EButton type="button" size="sm" variant="outline" disabled={frozen} onClick={() => void commit()}>Retry</EButton>
        </p>
      ) : null}
    </div>
  );
}

function ItemHistory({ item, timeZone }: { item: RecordItem; timeZone: string }) {
  if (item.transitions.length === 0) return null;
  return (
    <ol aria-label="This item's case history" className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
      {item.transitions.map((transition, index) => (
        <li key={transition.id} className="flex items-center gap-1.5">
          {index > 0 ? <span aria-hidden>→</span> : null}
          <span>
            {CASE_STATE_LABEL[transition.toState] ?? titleText(transition.toState)}
            {transition.actorName ? ` · ${transition.actorName}` : ""} · {weekdayTime(transition.occurredAt, timeZone) ?? "time not recorded"}
            {transition.reason ? ` (${transition.reason})` : ""}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function DamageItemCard({
  item,
  index,
  timeZone,
  clientVisible,
  earlierReports,
  frozen,
  onSaveEstimate,
}: {
  item: RecordItem;
  index: number;
  timeZone: string;
  clientVisible: boolean;
  earlierReports: number;
  frozen: boolean;
  onSaveEstimate: (itemId: string, value: number | null) => Promise<string | null>;
}) {
  const title = `${titleText(item.area)} ${item.category.toLowerCase()}`;
  const heading = `${index + 1} · ${title}`;
  const band = itemBand(item.severity, item.estimatedCost !== null);
  const sub = `${titleText(item.category)} · ${item.area.toLowerCase()} · cause: ${CAUSE_LABEL[item.suspectedCause] ?? titleText(item.suspectedCause).toLowerCase()}`;
  return (
    <EToneCard
      id={`damage-item-${item.id}`}
      tone={band?.tone ?? null}
      pill={band ? band.pill : <span className="text-[0.75rem] font-[600] text-[hsl(var(--e-text-secondary))]">{SEVERITY_LABEL[item.severity] ?? titleText(item.severity)}</span>}
      header={(
        <>
          <h3 className="text-[0.9375rem] font-[650] [overflow-wrap:anywhere]">{heading}</h3>
          <p className="text-[0.75rem] opacity-80 [overflow-wrap:anywhere]">{sub}</p>
        </>
      )}
      bodyClassName="space-y-3"
    >
      <p className="text-[0.875rem] [overflow-wrap:anywhere]">&ldquo;{item.description}&rdquo;</p>
      <Photos item={item} title={title} />
      <CaseAndRepair item={item} clientVisible={clientVisible} earlierReports={earlierReports} />
      <EstimateField key={item.id} item={item} frozen={frozen} onSave={onSaveEstimate} />
      <ItemHistory item={item} timeZone={timeZone} />
      {item.maintenance[0]?.scheduledFor ? <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">Repair visit {dayOnly(item.maintenance[0].scheduledFor, timeZone)}</p> : null}
    </EToneCard>
  );
}
