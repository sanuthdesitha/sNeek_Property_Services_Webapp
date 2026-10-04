import { describe, it, expect } from "vitest";
import { collectRotationalItems, filterRotationalSchema } from "@/lib/accountability/rotation-schema";
const schema = { sections: [{ id: "room", fields: [
  { id: "floor", type: "photo" },
  { id: "detail__bed1", type: "photo", frequency: "ROTATIONAL", rotationEveryNCleans: 3 },
  { id: "detail__bed2", type: "photo", frequency: "ROTATIONAL", rotationEveryNCleans: 3 },
] }] };
describe("rotation published catalogue", () => {
  it("retains full catalogue for incrementing not-yet-due counters", () => {
    expect(collectRotationalItems(schema)).toEqual([{ key: "detail", rotationEveryNCleans: 3 }]);
    const visible = filterRotationalSchema(schema, [{ itemKey: "detail", cleansSinceDone: 0 }]);
    expect(visible.sections[0].fields.map(f => f.id)).toEqual(["floor"]);
    expect(schema.sections[0].fields).toHaveLength(3);
    expect(collectRotationalItems(schema)).toHaveLength(1);
  });
  it("shows new items immediately then reappears on the third clean", () => {
    expect(filterRotationalSchema(schema, []).sections[0].fields).toHaveLength(3);
    for (const count of [0, 1]) expect(filterRotationalSchema(schema, [{ itemKey: "detail", cleansSinceDone: count }]).sections[0].fields).toHaveLength(1);
    expect(filterRotationalSchema(schema, [{ itemKey: "detail", cleansSinceDone: 2 }]).sections[0].fields).toHaveLength(3);
  });
  it("handles non-schema inputs", () => { expect(filterRotationalSchema(null, [])).toBeNull(); expect(collectRotationalItems(null)).toEqual([]); });
});
it("walks nested rooms, defaults legacy cadence, and rejects invalid cadence", () => {
 const nested: any = { sections: [{ fields: [{ id: "group", children: [
  { id: "legacy__bath2", frequency: "ROTATIONAL" },
  ...[0, -1, 1.5, "bad"].map((rotationEveryNCleans, i) => ({ id: `invalid${i}`, frequency: "ROTATIONAL", rotationEveryNCleans })),
  { id: 42, frequency: "ROTATIONAL" }, null,
 ] }] }, {}] };
 expect(collectRotationalItems(nested)).toEqual([{ key: "legacy", rotationEveryNCleans: 4 }]);
 // Null catalogue entries are ignored by discovery; published field arrays are valid objects.
 nested.sections[0].fields![0].children.pop();
 const filtered = filterRotationalSchema(nested, [{ itemKey: "legacy", cleansSinceDone: 3 }]);
 expect(filtered.sections[0].fields![0].children.map((f: any) => f?.id)).toEqual(["legacy__bath2", 42]);
 expect(filtered.sections[1].fields).toEqual([]);
 expect(filterRotationalSchema({ sections: [] }, [])).toEqual({ sections: [] });
 expect(filterRotationalSchema("legacy", [])).toBe("legacy");
 expect(filterRotationalSchema({}, [])).toEqual({});
});
