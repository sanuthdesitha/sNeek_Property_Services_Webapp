/**
 * When a pointer gesture on a calendar chip becomes a drag. PURE, so the rule
 * is testable without a browser.
 *
 * - Mouse and pen: a drag starts once the pointer has moved
 *   `DRAG_THRESHOLD_PX` (unchanged behaviour).
 * - Touch: press and HOLD for `TOUCH_HOLD_MS` without moving more than
 *   `TOUCH_SLOP_PX`; only then does the chip lift. Moving before the delay
 *   means the finger is scrolling: the gesture is abandoned and the page
 *   scrolls as normal. Lifting the finger before the delay is a plain tap.
 */
export const DRAG_THRESHOLD_PX = 6;
export const TOUCH_HOLD_MS = 450;
export const TOUCH_SLOP_PX = 10;

export type PointerKind = "mouse" | "pen" | "touch";

export type GestureState =
  | { phase: "idle" }
  | { phase: "pressed"; pointer: PointerKind; startX: number; startY: number; startedAt: number }
  | { phase: "dragging"; pointer: PointerKind };

export type GestureEvent =
  | { type: "down"; pointer: PointerKind; x: number; y: number; at: number }
  | { type: "move"; x: number; y: number; at: number }
  | { type: "hold-elapsed"; at: number }
  | { type: "up" }
  | { type: "cancel" };

export const IDLE: GestureState = { phase: "idle" };

function distance(state: Extract<GestureState, { phase: "pressed" }>, x: number, y: number): number {
  return Math.hypot(x - state.startX, y - state.startY);
}

export function gestureStep(state: GestureState, event: GestureEvent): GestureState {
  switch (event.type) {
    case "down":
      return { phase: "pressed", pointer: event.pointer, startX: event.x, startY: event.y, startedAt: event.at };
    case "move": {
      if (state.phase !== "pressed") return state;
      const moved = distance(state, event.x, event.y);
      if (state.pointer !== "touch") return moved >= DRAG_THRESHOLD_PX ? { phase: "dragging", pointer: state.pointer } : state;
      // Touch: moving before the hold completes is a scroll, not a drag.
      if (moved > TOUCH_SLOP_PX && event.at - state.startedAt < TOUCH_HOLD_MS) return IDLE;
      return state;
    }
    case "hold-elapsed":
      if (state.phase !== "pressed" || state.pointer !== "touch") return state;
      return event.at - state.startedAt >= TOUCH_HOLD_MS ? { phase: "dragging", pointer: "touch" } : state;
    case "up":
    case "cancel":
      return IDLE;
  }
}

/** Touch drags need the page's own scrolling suppressed while the chip is held. */
export function suppressesScroll(state: GestureState): boolean {
  return state.phase === "dragging" && state.pointer === "touch";
}
