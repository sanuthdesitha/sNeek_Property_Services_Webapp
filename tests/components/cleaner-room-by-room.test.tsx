/**
 * Pilot "New cleaner job flow", item 1 on the Clean stage: the arrival video
 * lock, then one room at a time with what is missing; pilot off = the
 * accordion exactly as before.
 */
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rendered = vi.hoisted(() => ({ props: null as null | { onlySectionIds?: readonly string[]; hideExtras?: boolean } }));
vi.mock("@/components/v2/cleaner/job-actions", () => ({ EarlyCheckoutStatus: () => null }));
vi.mock("@/components/v2/cleaner/purchase-asks-card", () => ({ PurchaseAsksCard: () => null }));
vi.mock("@/components/v2/cleaner/bulk-photo-assign", () => ({ BulkPhotoAssign: () => null }));
vi.mock("@/components/v2/cleaner/media-capture", () => ({ MediaCapture: () => null }));
vi.mock("@/components/v2/cleaner/form-renderer", () => ({
  FormRenderer: (props: { onlySectionIds?: readonly string[]; hideExtras?: boolean }) => {
    rendered.props = props;
    return <output aria-label="Sections shown">{props.onlySectionIds ? props.onlySectionIds.join(",") : "all"}</output>;
  },
}));

import { StageClean } from "@/components/v2/cleaner/job-stages/stage-clean";

const schema = {
  sections: [
    { id: "arrival-evidence", title: "Arrival evidence", fields: [{ id: "arrival-walkthrough-video", type: "video", label: "Arrival walkthrough video", required: true, walkthroughVideo: "arrival" }] },
    { id: "kitchen", title: "Kitchen", fields: [{ id: "kitchen-bench", type: "photo", label: "Bench photo", required: true }] },
    { id: "bathroom", title: "Bathroom", fields: [{ id: "bath-mirror", type: "photo", label: "Mirror photo", required: true }] },
  ],
};

type Uploads = Record<string, Array<{ key: string; kind: string }>>;

function api(pilot: boolean | undefined, uploads: Uploads, setActiveStage = vi.fn()) {
  return {
    schema,
    answers: {},
    uploads,
    jobTasks: [{ id: "task", title: "Water plants", source: "ADMIN", metadata: {} }],
    taskDrafts: {},
    locked: false,
    property: {},
    jobId: "job-1",
    template: { name: "Turnover" },
    bulkPool: [],
    payload: pilot === undefined ? {} : { pilots: { cleanerJobFlow: pilot } },
    setTask: vi.fn(),
    setActiveStage,
    openBulkAssign: vi.fn(),
  } as never;
}

const video = { key: "v.mp4", kind: "video" };

beforeEach(() => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  window.sessionStorage.clear();
  rendered.props = null;
});
afterEach(cleanup);

describe("Clean stage, New cleaner job flow pilot", () => {
  it("off (or absent): every section in the accordion, no lock, the checklist shown", () => {
    for (const pilot of [false, undefined]) {
      render(<StageClean api={api(pilot, {})} />);
      expect(screen.getByLabelText("Sections shown")).toHaveTextContent("all");
      expect(screen.queryByText(/Upload the arrival video first/)).toBeNull();
      expect(screen.getByText("Water plants")).toBeInTheDocument();
      expect(rendered.props?.hideExtras).toBe(false);
      cleanup();
    }
  });

  it("on without the arrival video: only the arrival section, the checklist and extras locked", () => {
    render(<StageClean api={api(true, {})} />);
    expect(screen.getByText(/Upload the arrival video first/)).toBeInTheDocument();
    expect(screen.getByLabelText("Sections shown")).toHaveTextContent("arrival-evidence");
    expect(screen.queryByText("Water plants")).toBeNull();
    expect(rendered.props?.hideExtras).toBe(true);
    expect(screen.queryByRole("heading", { name: /of 3/ })).toBeNull();
  });

  it("on with the video: one room at a time, missing items listed, Room done only when nothing is missing", () => {
    render(<StageClean api={api(true, { "arrival-walkthrough-video": [video] })} />);
    expect(screen.getByRole("heading", { name: "Kitchen · 2 of 3" })).toBeInTheDocument();
    expect(screen.getByLabelText("Sections shown")).toHaveTextContent("kitchen");
    expect(screen.getByText("1 of 3 rooms done")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bench photo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Room done — next room/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Go to room"), { target: { value: "bathroom" } });
    expect(screen.getByRole("heading", { name: "Bathroom · 3 of 3" })).toBeInTheDocument();
    expect(window.sessionStorage.getItem("sneek:cleaner-room:job-1")).toBe("bathroom");
  });

  it("a complete room moves on; the last complete room goes to Wrap up", () => {
    const setActiveStage = vi.fn();
    const uploads = { "arrival-walkthrough-video": [video], "kitchen-bench": [{ key: "k.jpg", kind: "image" }], "bath-mirror": [{ key: "b.jpg", kind: "image" }] };
    render(<StageClean api={api(true, uploads, setActiveStage)} />);
    expect(screen.getByRole("heading", { name: "Arrival evidence · 1 of 3" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Room done — next room/ }));
    fireEvent.click(screen.getByRole("button", { name: /Room done — next room/ }));
    expect(screen.getByRole("heading", { name: "Bathroom · 3 of 3" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "All rooms done — wrap up" }));
    expect(setActiveStage).toHaveBeenCalledWith(5);
  });

  it("a jump from Wrap up to a field in another room opens that room", () => {
    vi.useFakeTimers();
    try {
      render(<StageClean api={api(true, { "arrival-walkthrough-video": [video] })} />);
      act(() => {
        window.dispatchEvent(new CustomEvent("sneek:focus-field", { detail: { match: "bath-mirror" } }));
      });
      expect(screen.getByRole("heading", { name: "Bathroom · 3 of 3" })).toBeInTheDocument();
      act(() => vi.runOnlyPendingTimers());
    } finally {
      vi.useRealTimers();
    }
  });
});
