/**
 * Browser facts for the tutorial engine: where a registered target is, and
 * whether something urgent is on screen. Read-only; nothing here changes the
 * page. Targets are found only by their registered `data-tour` id.
 */
import type { TourTargetId } from "@/lib/tutorials/targets";
import type { UrgencySignals } from "@/lib/tutorials/engine";

/** Every element the tutorial layer renders carries this, so it never counts itself as urgent work. */
export const TOUR_UI_ATTRIBUTE = "data-tour-ui";

function isVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = window.getComputedStyle(element);
  return style.visibility !== "hidden" && style.display !== "none";
}

/** The first visible element carrying this target id (a control may appear in a desktop and a phone variant). */
export function findTarget(id: TourTargetId): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${CSS.escape(id)}"]`));
  return candidates.find(isVisible) ?? null;
}

export function targetAvailable(id: TourTargetId): boolean {
  return findTarget(id) !== null;
}

function insideTourUi(element: Element | null): boolean {
  return Boolean(element?.closest(`[${TOUR_UI_ATTRIBUTE}]`));
}

function editing(): boolean {
  const active = document.activeElement as HTMLElement | null;
  if (!active || insideTourUi(active)) return false;
  if (active.isContentEditable) return true;
  if (active instanceof HTMLTextAreaElement) return true;
  if (active instanceof HTMLInputElement) {
    return !["button", "checkbox", "radio", "submit", "reset", "range", "color", "file"].includes(active.type);
  }
  return false;
}

/**
 * What is on screen right now. Pages mark other urgent states themselves with
 * `data-tour-busy="<reason>"` (the cleaner job marks "clock" while the clock runs)
 * and unsaved editors with `data-unsaved="true"`.
 */
export function readUrgencySignals(): UrgencySignals {
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open]'));
  const dialogOpen = dialogs.some((element) => !insideTourUi(element) && isVisible(element));
  const busyMarkers = Array.from(document.querySelectorAll<HTMLElement>("[data-tour-busy]"))
    .map((element) => element.dataset.tourBusy ?? "")
    .filter(Boolean);
  if (typeof navigator !== "undefined" && navigator.onLine === false) busyMarkers.push("offline");
  return {
    clockRunning: busyMarkers.includes("clock"),
    dialogOpen,
    unsavedForm: editing() || document.querySelector('[data-unsaved="true"]') !== null,
    busyMarkers,
  };
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)")?.matches === true;
}

export function isPhoneViewport(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    && window.matchMedia("(max-width: 639.98px)")?.matches === true;
}
