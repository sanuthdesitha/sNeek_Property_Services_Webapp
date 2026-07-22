import { describe, it, expect } from "vitest";
import {
  addToPool,
  assignToField,
  assignmentIndex,
  moveToField,
  nextUnmetField,
  shortfall,
  unassignKeys,
  type AssignField,
  type BulkAssignState,
} from "@/lib/cleaner/bulk-assign";

type M = { key: string; url: string };
const m = (key: string): M => ({ key, url: `https://cdn/${key}.jpg` });

function state(pool: string[], uploads: Record<string, string[]> = {}): BulkAssignState<M> {
  return {
    pool: pool.map(m),
    uploads: Object.fromEntries(Object.entries(uploads).map(([k, v]) => [k, v.map(m)])),
  };
}

const keysOf = (list: M[] | undefined) => (list ?? []).map((x) => x.key);

const FIELDS: AssignField[] = [
  { id: "kitchen", label: "Kitchen", sectionTitle: "Rooms", minPhotos: 2 },
  { id: "bath", label: "Bathroom", sectionTitle: "Rooms", required: true },
  { id: "extra", label: "Anything else", sectionTitle: "Rooms" },
];

describe("bulk-assign reducers", () => {
  it("assigning removes from the pool and adds to the field", () => {
    const next = assignToField(state(["a", "b", "c"]), ["b"], "kitchen");
    expect(keysOf(next.pool)).toEqual(["a", "c"]);
    expect(keysOf(next.uploads.kitchen)).toEqual(["b"]);
  });

  it("assigns multiple photos at once, in selection order", () => {
    const next = assignToField(state(["a", "b", "c"]), ["c", "a"], "kitchen");
    expect(keysOf(next.pool)).toEqual(["b"]);
    expect(keysOf(next.uploads.kitchen)).toEqual(["c", "a"]);
  });

  it("appends to a field that already holds photos", () => {
    const next = assignToField(state(["b"], { kitchen: ["a"] }), ["b"], "kitchen");
    expect(keysOf(next.uploads.kitchen)).toEqual(["a", "b"]);
    expect(next.pool).toHaveLength(0);
  });

  it("assigning a key the field already holds is a no-op (no duplicate)", () => {
    const before = state([], { kitchen: ["a", "b"] });
    const next = assignToField(before, ["a"], "kitchen");
    expect(keysOf(next.uploads.kitchen)).toEqual(["a", "b"]);
    expect(next.pool).toHaveLength(0);
  });

  it("moving between fields never duplicates the key", () => {
    const next = moveToField(state([], { kitchen: ["a", "b"], bath: ["c"] }), ["a"], "bath");
    expect(keysOf(next.uploads.kitchen)).toEqual(["b"]);
    expect(keysOf(next.uploads.bath)).toEqual(["c", "a"]);
    const all = Object.values(next.uploads).flatMap(keysOf).concat(keysOf(next.pool));
    expect(new Set(all).size).toBe(all.length);
  });

  it("moves a multi-selection out of several fields into one", () => {
    const next = moveToField(state([], { kitchen: ["a"], bath: ["b"], extra: ["c"] }), ["a", "b"], "extra");
    expect(keysOf(next.uploads.kitchen)).toEqual([]);
    expect(keysOf(next.uploads.bath)).toEqual([]);
    expect(keysOf(next.uploads.extra)).toEqual(["c", "a", "b"]);
  });

  it("unassign returns photos to the pool and clears the field", () => {
    const next = unassignKeys(state(["z"], { kitchen: ["a", "b"] }), ["a", "b"]);
    expect(keysOf(next.uploads.kitchen)).toEqual([]);
    expect(keysOf(next.pool)).toEqual(["z", "a", "b"]);
  });

  it("unassigning an unknown key leaves the state untouched", () => {
    const before = state(["a"], { kitchen: ["b"] });
    expect(unassignKeys(before, ["nope"])).toBe(before);
    expect(assignToField(before, [], "kitchen")).toBe(before);
  });

  it("addToPool ignores keys already pooled or already filed", () => {
    const next = addToPool(state(["a"], { kitchen: ["b"] }), [m("a"), m("b"), m("c")]);
    expect(keysOf(next.pool)).toEqual(["a", "c"]);
  });

  it("assignmentIndex maps every filed key to its field", () => {
    expect(assignmentIndex(state([], { kitchen: ["a"], bath: ["b"] }).uploads)).toEqual({
      a: "kitchen",
      b: "bath",
    });
  });

  it("shortfall counts required and minPhotos", () => {
    const { uploads } = state([], { kitchen: ["a"] });
    expect(shortfall(FIELDS[0], uploads)).toBe(1);
    expect(shortfall(FIELDS[1], uploads)).toBe(1);
    expect(shortfall(FIELDS[2], uploads)).toBe(0);
  });

  it("nextUnmetField walks forward and wraps around", () => {
    const { uploads } = state([], { kitchen: ["a", "b"] });
    expect(nextUnmetField(FIELDS, uploads)?.id).toBe("bath");
    // after bath → wraps past extra (satisfied, no minimum) back to bath itself
    expect(nextUnmetField(FIELDS, uploads, "bath")?.id).toBe("bath");
    const done = state([], { kitchen: ["a", "b"], bath: ["c"] }).uploads;
    expect(nextUnmetField(FIELDS, done)).toBeNull();
  });
});
