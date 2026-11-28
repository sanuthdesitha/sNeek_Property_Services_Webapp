"use client";

/**
 * Room by room (pilot "New cleaner job flow", 2026-11-28). The form's
 * sections are worked one at a time: "Kitchen · 3 of 12", what is still
 * missing in this room (each a jump), a room picker, and "Room done — next
 * room", which stays unavailable while a required photo or answer here is
 * missing. Nothing is stored by this component: a room is done exactly when
 * the shared validation (lib/forms/navigation.ts) finds nothing missing in
 * it, so the phone and the submit route cannot disagree.
 */
import * as React from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, Lock, Video } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { stripHtmlToText } from "@/lib/forms/sanitize";
import { toneNoticeClass } from "@/components/v2/ui/tone-band";

export type RoomMissingItem = { fieldId: string; label: string };

export type RoomStep = {
  id: string;
  label: string;
  missing: RoomMissingItem[];
};

function roomStatus(room: RoomStep): string {
  return room.missing.length === 0 ? "done" : `${room.missing.length} missing`;
}

export function RoomStepperHeader({
  rooms,
  activeId,
  onSelect,
  onJump,
}: {
  rooms: RoomStep[];
  activeId: string;
  onSelect: (roomId: string) => void;
  onJump: (fieldId: string) => void;
}) {
  const index = Math.max(0, rooms.findIndex((room) => room.id === activeId));
  const room = rooms[index];
  const doneCount = rooms.filter((entry) => entry.missing.length === 0).length;
  const selectId = React.useId();
  if (!room) return null;
  return (
    <section aria-labelledby={`${selectId}-title`} className="space-y-2 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`${selectId}-title`} className="min-w-0 text-[0.9375rem] font-[650] [overflow-wrap:anywhere]">
          {stripHtmlToText(room.label)} · {index + 1} of {rooms.length}
        </h2>
        <span className="text-[0.75rem] tabular-nums text-[hsl(var(--e-muted-foreground))]">
          {doneCount} of {rooms.length} rooms done
        </span>
      </div>
      <div aria-hidden className="h-1.5 overflow-hidden rounded-full bg-[hsl(var(--e-muted))]">
        <div className="h-full bg-[hsl(var(--e-success))]" style={{ width: `${rooms.length ? Math.round((doneCount / rooms.length) * 100) : 0}%` }} />
      </div>
      <label htmlFor={selectId} className="block text-[0.75rem] font-[550]">
        Go to room
        <select
          id={selectId}
          className="mt-1 h-10 w-full rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-2.5 text-[16px] sm:text-[0.8125rem]"
          value={room.id}
          onChange={(event) => onSelect(event.target.value)}
        >
          {rooms.map((entry, position) => (
            <option key={entry.id} value={entry.id}>
              {position + 1}. {stripHtmlToText(entry.label)} — {roomStatus(entry)}
            </option>
          ))}
        </select>
      </label>
      {room.missing.length > 0 ? (
        <div className={`rounded-[var(--e-radius)] ${toneNoticeClass("attention")} p-2`}>
          <p className="text-[0.75rem] font-[600]">Still missing in this room</p>
          <ul className="mt-1 space-y-0.5">
            {room.missing.map((item) => (
              <li key={item.fieldId}>
                <button
                  type="button"
                  onClick={() => onJump(item.fieldId)}
                  className="min-h-9 w-full rounded-[var(--e-radius-sm)] px-1.5 text-left text-[0.8125rem] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2"
                >
                  {stripHtmlToText(item.label)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-[0.8125rem] text-[hsl(var(--e-success))]">
          <CheckCircle2 aria-hidden className="h-4 w-4" /> Nothing missing in this room.
        </p>
      )}
    </section>
  );
}

export function RoomStepperFooter({
  rooms,
  activeId,
  onSelect,
  onFinished,
}: {
  rooms: RoomStep[];
  activeId: string;
  onSelect: (roomId: string) => void;
  /** All rooms done, from the last room. */
  onFinished: () => void;
}) {
  const index = Math.max(0, rooms.findIndex((room) => room.id === activeId));
  const room = rooms[index];
  if (!room) return null;
  const previous = index > 0 ? rooms[index - 1] : null;
  const next = index < rooms.length - 1 ? rooms[index + 1] : null;
  const roomComplete = room.missing.length === 0;
  const firstOpen = rooms.find((entry) => entry.missing.length > 0) ?? null;
  return (
    <div className="space-y-2">
      {!roomComplete ? (
        <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
          This room can be marked done once the {room.missing.length === 1 ? "item" : `${room.missing.length} items`} above {room.missing.length === 1 ? "is" : "are"} finished.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {previous ? (
          <EButton variant="outline" size="md" onClick={() => onSelect(previous.id)}>
            <ChevronLeft aria-hidden className="h-4 w-4" /> Previous room
          </EButton>
        ) : null}
        {next ? (
          <EButton variant="gold" size="md" disabled={!roomComplete} onClick={() => onSelect(next.id)}>
            Room done — next room <ChevronRight aria-hidden className="h-4 w-4" />
          </EButton>
        ) : (
          <EButton
            variant="gold"
            size="md"
            disabled={!roomComplete}
            onClick={() => (firstOpen ? onSelect(firstOpen.id) : onFinished())}
          >
            {firstOpen && roomComplete ? `Room done — back to ${stripHtmlToText(firstOpen.label)}` : "All rooms done — wrap up"}
          </EButton>
        )}
      </div>
    </div>
  );
}

/** Shown instead of the rest of the checklist until the arrival video is uploaded. */
export function ArrivalVideoLockNotice() {
  return (
    <div role="status" className={`flex items-start gap-2 rounded-[var(--e-radius)] ${toneNoticeClass("attention")} p-3 text-[0.8125rem]`}>
      <Lock aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
      <p>
        <span className="font-[600]">
          <Video aria-hidden className="mr-1 inline h-4 w-4" />
          Upload the arrival video first.
        </span>{" "}
        One video of the whole property, before you touch anything. If your phone split it, add every part to the same question. The rest of the checklist opens once it is uploaded.
      </p>
    </div>
  );
}
