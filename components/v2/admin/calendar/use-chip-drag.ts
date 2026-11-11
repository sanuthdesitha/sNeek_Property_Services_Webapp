"use client";

/**
 * Pointer drag for calendar chips. Mouse and pen start a drag after a short
 * movement; touch starts one only after press-and-hold (`TOUCH_HOLD_MS`) so a
 * finger still scrolls the page (`lib/calendar/touch-drag.ts`). While a touch
 * drag is live the page's scrolling is suppressed; moving before the hold
 * completes abandons the drag and scrolls as normal. Keyboard and menu users
 * keep "Move or reassign…".
 *
 * Drop targets are cells with `data-drop-day`, `data-drop-lane` and
 * `data-drop-row`; a Day-view hour track adds `data-drop-axis-start`
 * (minutes) and `data-drop-px-per-hour`, so the drop also reports the minute
 * under the pointer. The drag only reports where the chip was dropped; it
 * never moves the chip. Escape cancels a drag in progress.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { DropLane, DropPoint } from "@/lib/calendar/drop";
import { trackMinute } from "@/lib/calendar/time-drop";
import { IDLE, TOUCH_HOLD_MS, gestureStep, suppressesScroll, type GestureEvent, type GestureState, type PointerKind } from "@/lib/calendar/touch-drag";
import type { CalendarJob } from "@/lib/calendar/types";

export type DragState = { job: CalendarJob; source: DropPoint; x: number; y: number; over: DropPoint | null; touch: boolean } | null;

type Pending = { job: CalendarJob; source: DropPoint; gesture: GestureState; holdTimer: number | null; lastX: number; lastY: number };

export function readDropPoint(element: Element | null, clientX?: number): DropPoint | null {
  const cell = element?.closest<HTMLElement>("[data-drop-day]");
  if (!cell) return null;
  const day = cell.dataset.dropDay;
  const lane = cell.dataset.dropLane as DropLane | undefined;
  if (!day || (lane !== "unassigned" && lane !== "cleaner" && lane !== "property")) return null;
  const point: DropPoint = { day, lane, rowId: cell.dataset.dropRow || null };
  const axisStart = Number(cell.dataset.dropAxisStart);
  const pxPerHour = Number(cell.dataset.dropPxPerHour);
  if (clientX !== undefined && cell.dataset.dropAxisStart !== undefined && Number.isFinite(axisStart)) {
    point.minute = trackMinute(clientX - cell.getBoundingClientRect().left, axisStart, pxPerHour);
  }
  return point;
}

function pointerKind(type: string): PointerKind {
  return type === "touch" ? "touch" : type === "pen" ? "pen" : "mouse";
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
    if (pending.current?.holdTimer) window.clearTimeout(pending.current.holdTimer);
    pending.current = null;
    setDrag(null);
  }, []);

  /** Advance the gesture; returns true when this event made it a drag. */
  const advance = useCallback((event: GestureEvent): boolean => {
    const current = pending.current;
    if (!current) return false;
    const before: GestureState = current.gesture;
    const next: GestureState = gestureStep(before, event);
    current.gesture = next;
    if (next.phase === "idle") {
      if (before.phase !== "idle") stop();
      return false;
    }
    if (before.phase !== "dragging" && next.phase === "dragging") {
      if (current.holdTimer) window.clearTimeout(current.holdTimer);
      current.holdTimer = null;
      const over = readDropPoint(document.elementFromPoint(current.lastX, current.lastY), current.lastX);
      setDrag({ job: current.job, source: current.source, x: current.lastX, y: current.lastY, over, touch: next.pointer === "touch" });
      return true;
    }
    return false;
  }, [stop]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const current = pending.current;
      if (!current) return;
      current.lastX = event.clientX;
      current.lastY = event.clientY;
      advance({ type: "move", x: event.clientX, y: event.clientY, at: Date.now() });
      const gesture = pending.current?.gesture;
      if (!gesture || gesture.phase !== "dragging") return;
      event.preventDefault();
      const over = readDropPoint(document.elementFromPoint(event.clientX, event.clientY), event.clientX);
      setDrag({ job: current.job, source: current.source, x: event.clientX, y: event.clientY, over, touch: gesture.pointer === "touch" });
    };
    const onUp = (event: PointerEvent) => {
      const current = pending.current;
      if (!current) return;
      if (current.gesture.phase === "dragging") {
        suppressClick.current = current.job.id;
        const target = readDropPoint(document.elementFromPoint(event.clientX, event.clientY), event.clientX);
        if (target) onDropRef.current(current.job, current.source, target);
      }
      stop();
    };
    // A held touch drag owns the finger: stop the page from scrolling under it.
    const onTouchMove = (event: TouchEvent) => {
      if (pending.current && suppressesScroll(pending.current.gesture)) event.preventDefault();
    };
    const onContextMenu = (event: Event) => {
      if (pending.current?.gesture.phase === "pressed" || pending.current?.gesture.phase === "dragging") event.preventDefault();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && pending.current?.gesture.phase === "dragging") {
        suppressClick.current = pending.current.job.id;
        stop();
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", stop);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("keydown", onKey);
    };
  }, [stop, advance]);

  const onChipPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>, job: CalendarJob, source: DropPoint) => {
    if (event.button !== 0) return;
    stop();
    const pointer = pointerKind(event.pointerType);
    const at = Date.now();
    // Where on the hour track the chip was grabbed (Day view), for a time drop.
    const grabbed = readDropPoint(event.currentTarget, event.clientX);
    const origin: DropPoint = grabbed?.minute != null ? { ...source, minute: grabbed.minute } : source;
    pending.current = { job, source: origin, gesture: IDLE, holdTimer: null, lastX: event.clientX, lastY: event.clientY };
    advance({ type: "down", pointer, x: event.clientX, y: event.clientY, at });
    if (pointer === "touch") {
      pending.current.holdTimer = window.setTimeout(() => {
        advance({ type: "hold-elapsed", at: Date.now() });
      }, TOUCH_HOLD_MS);
    }
  }, [advance, stop]);

  const consumeClickSuppression = useCallback((jobId: string) => {
    if (suppressClick.current !== jobId) return false;
    suppressClick.current = null;
    return true;
  }, []);

  return { drag, onChipPointerDown, consumeClickSuppression };
}
