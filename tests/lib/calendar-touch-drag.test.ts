import { describe, expect, it } from "vitest";
import { DRAG_THRESHOLD_PX, IDLE, TOUCH_HOLD_MS, TOUCH_SLOP_PX, gestureStep, suppressesScroll, type GestureEvent, type GestureState } from "@/lib/calendar/touch-drag";

function run(events: GestureEvent[]): GestureState {
  return events.reduce(gestureStep, IDLE);
}

describe("touch drag on calendar chips", () => {
  it("starts only after press-and-hold, then owns the finger (no page scroll)", () => {
    const pressed = run([{ type: "down", pointer: "touch", x: 100, y: 100, at: 0 }]);
    expect(pressed.phase).toBe("pressed");
    expect(gestureStep(pressed, { type: "hold-elapsed", at: TOUCH_HOLD_MS - 1 }).phase).toBe("pressed");
    const dragging = gestureStep(pressed, { type: "hold-elapsed", at: TOUCH_HOLD_MS });
    expect(dragging).toEqual({ phase: "dragging", pointer: "touch" });
    expect(suppressesScroll(dragging)).toBe(true);
    // Once lifted, moving far does not cancel it.
    expect(gestureStep(dragging, { type: "move", x: 400, y: 600, at: TOUCH_HOLD_MS + 50 }).phase).toBe("dragging");
  });

  it("cancels when the finger moves before the delay, so the page scrolls", () => {
    const state = run([
      { type: "down", pointer: "touch", x: 100, y: 100, at: 0 },
      { type: "move", x: 100, y: 100 + TOUCH_SLOP_PX + 1, at: 120 },
    ]);
    expect(state).toEqual(IDLE);
    expect(gestureStep(state, { type: "hold-elapsed", at: TOUCH_HOLD_MS }).phase).toBe("idle");
  });

  it("tolerates a small wobble during the hold and treats an early lift as a tap", () => {
    const wobble = run([
      { type: "down", pointer: "touch", x: 100, y: 100, at: 0 },
      { type: "move", x: 104, y: 103, at: 200 },
      { type: "hold-elapsed", at: TOUCH_HOLD_MS },
    ]);
    expect(wobble.phase).toBe("dragging");
    expect(run([{ type: "down", pointer: "touch", x: 0, y: 0, at: 0 }, { type: "up" }])).toEqual(IDLE);
  });

  it("keeps mouse and pen dragging after a short move, with no hold and no scroll suppression", () => {
    const pressed = run([{ type: "down", pointer: "mouse", x: 10, y: 10, at: 0 }]);
    expect(gestureStep(pressed, { type: "move", x: 10 + DRAG_THRESHOLD_PX - 1, y: 10, at: 5 }).phase).toBe("pressed");
    const dragging = gestureStep(pressed, { type: "move", x: 60, y: 60, at: 10 });
    expect(dragging).toEqual({ phase: "dragging", pointer: "mouse" });
    expect(suppressesScroll(dragging)).toBe(false);
    expect(gestureStep(pressed, { type: "hold-elapsed", at: 10_000 }).phase).toBe("pressed");
  });
});
