"use client";

/**
 * Pointer drag for calendar chips (mouse and pen). Touch does not start a
 * drag, so a finger still scrolls the page; touch and keyboard users move jobs
 * with "Move or reassign…" in the chip's menu. Drop targets are cells with
 * `data-drop-day`, `data-drop-lane` and `data-drop-row`.
 *
 * The drag only reports where the chip was dropped; it never moves the chip.
 * Escape cancels a drag in progress.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { DropLane, DropPoint } from "@/lib/calendar/drop";
import type { CalendarJob } from "@/lib/calendar/types";

const DRAG_THRESHOLD_PX = 6;

export type DragState = { job: CalendarJob; source: DropPoint; x: number; y: number; over: DropPoint | null } | null;

type Pending = { job: CalendarJob; source: DropPoint; startX: number; startY: number; dragging: boolean };

export function readDropPoint(element: Element | null): DropPoint | null {
  const cell = element?.closest<HTMLElement>("[data-drop-day]");
  if (!cell) return null;
  const day = cell.dataset.dropDay;
  const lane = cell.dataset.dropLane as DropLane | undefined;
  if (!day || (lane !== "unassigned" && lane !== "cleaner" && lane !== "property")) return null;
  return { day, lane, rowId: cell.dataset.dropRow || null };
}

export type ChipDragApi = {
  drag: DragState;
  /** Start tracking a possible drag from a chip. */
  onChipPointerDown: (event: ReactPointerEvent<HTMLElement>, job: CalendarJob, source: DropPoint) => void;
  /** True when the click that follows a drag should be ignored. */
  consumeClickSuppression: (jobId: string) => boolean;
};

export function useChipDrag(onDrop: (job: CalendarJob, source: DropPoint, target: DropPoint) => void): ChipDragApi {
  const [drag, setDrag] = useState<DragState>(null);
  const pending = useRef<Pending | null>(null);
  const suppressClick = useRef<string | null>(null);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  const stop = useCallback(() => {
    pending.current = null;
    setDrag(null);
  }, []);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const current = pending.current;
      if (!current) return;
      if (!current.dragging) {
        if (Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < DRAG_THRESHOLD_PX) return;
        current.dragging = true;
      }
      event.preventDefault();
      const over = readDropPoint(document.elementFromPoint(event.clientX, event.clientY));
      setDrag({ job: current.job, source: current.source, x: event.clientX, y: event.clientY, over });
    };
    const onUp = (event: PointerEvent) => {
      const current = pending.current;
      if (!current) return;
      if (current.dragging) {
        suppressClick.current = current.job.id;
        const target = readDropPoint(document.elementFromPoint(event.clientX, event.clientY));
        if (target) onDropRef.current(current.job, current.source, target);
      }
      stop();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && pending.current?.dragging) {
        suppressClick.current = pending.current.job.id;
        stop();
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", stop);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("keydown", onKey);
    };
  }, [stop]);

  const onChipPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>, job: CalendarJob, source: DropPoint) => {
    if (event.button !== 0 || event.pointerType === "touch") return;
    pending.current = { job, source, startX: event.clientX, startY: event.clientY, dragging: false };
  }, []);

  const consumeClickSuppression = useCallback((jobId: string) => {
    if (suppressClick.current !== jobId) return false;
    suppressClick.current = null;
    return true;
  }, []);

  return { drag, onChipPointerDown, consumeClickSuppression };
}
