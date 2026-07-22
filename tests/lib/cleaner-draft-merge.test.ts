import { describe, it, expect } from "vitest";
import { mergeDraftStates, unionMedia } from "@/lib/cleaner/draft-merge";

const m = (key: string) => ({ key, url: `https://s3/${key}` });

describe("unionMedia", () => {
  it("unions by key, preserving first-seen order, dropping keyless entries", () => {
    expect(unionMedia([m("a"), m("b")], [m("b"), m("c")]).map((x) => x.key)).toEqual(["a", "b", "c"]);
    expect(unionMedia([{ url: "no-key" }], [m("a")]).map((x) => x.key)).toEqual(["a"]);
    expect(unionMedia(null, undefined)).toEqual([]);
  });
});

describe("mergeDraftStates — uploads are never lost", () => {
  const older = {
    updatedAt: "2026-07-17T10:00:00.000Z",
    answers: { q1: "old", q2: "keep-me" },
    uploads: { kitchen: [m("k1")] },
  };
  const newer = {
    updatedAt: "2026-07-17T10:05:00.000Z",
    answers: { q1: "new" },
    uploads: { kitchen: [m("k2")], bathroom: [m("b1")] },
  };

  it("unions uploads across states (the core data-loss guarantee)", () => {
    const out = mergeDraftStates(older, newer);
    expect(out.uploads.kitchen.map((x: any) => x.key)).toEqual(["k1", "k2"]);
    expect(out.uploads.bathroom.map((x: any) => x.key)).toEqual(["b1"]);
  });

  it("is order-independent for media", () => {
    const a = mergeDraftStates(older, newer).uploads.kitchen.map((x: any) => x.key).sort();
    const b = mergeDraftStates(newer, older).uploads.kitchen.map((x: any) => x.key).sort();
    expect(a).toEqual(b);
  });

  it("newer answers win per key; older-only keys survive", () => {
    const out = mergeDraftStates(older, newer);
    expect(out.answers.q1).toBe("new");
    expect(out.answers.q2).toBe("keep-me");
  });

  it("handles a missing/!object side", () => {
    expect(mergeDraftStates(null, newer)).toEqual(newer);
    expect(mergeDraftStates(older, undefined)).toEqual(older);
  });
});

describe("mergeDraftStates — task drafts and nested photos", () => {
  it("unions task proof and never downgrades a real decision back to OPEN", () => {
    const older = {
      updatedAt: "2026-07-17T10:00:00.000Z",
      taskDrafts: { t1: { decision: "COMPLETED", note: "done", proof: [m("p1")] } },
    };
    const newer = {
      updatedAt: "2026-07-17T10:05:00.000Z",
      taskDrafts: { t1: { decision: "OPEN", note: "", proof: [m("p2")] } },
    };
    const out = mergeDraftStates(older, newer);
    expect(out.taskDrafts.t1.decision).toBe("COMPLETED");
    expect(out.taskDrafts.t1.note).toBe("done");
    expect(out.taskDrafts.t1.proof.map((x: any) => x.key)).toEqual(["p1", "p2"]);
  });

  it("unions laundry + carry-forward photos while newer scalars win", () => {
    const older = {
      updatedAt: "2026-07-17T10:00:00.000Z",
      laundry: { outcome: "NOT_READY", bagLocation: "old", photo: [m("l1")] },
      carryForward: { hasNew: false, photos: [m("c1")] },
    };
    const newer = {
      updatedAt: "2026-07-17T10:05:00.000Z",
      laundry: { outcome: "READY_FOR_PICKUP", bagLocation: "Laundry room", photo: [m("l2")] },
      carryForward: { hasNew: true, photos: [m("c2")] },
    };
    const out = mergeDraftStates(older, newer);
    expect(out.laundry.outcome).toBe("READY_FOR_PICKUP");
    expect(out.laundry.bagLocation).toBe("Laundry room");
    expect(out.laundry.photo.map((x: any) => x.key)).toEqual(["l1", "l2"]);
    expect(out.carryForward.hasNew).toBe(true);
    expect(out.carryForward.photos.map((x: any) => x.key)).toEqual(["c1", "c2"]);
  });
});
