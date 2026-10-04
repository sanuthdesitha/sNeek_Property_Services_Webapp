import { expect, it } from "vitest";
import { parseJobInternalNotes, serializeJobInternalNotes } from "@/lib/jobs/meta";
const parse = (tasks: unknown) => parseJobInternalNotes(JSON.stringify({ version: 1, specialRequestTasks: tasks })).specialRequestTasks;
const roundtrip = (tasks: unknown) => parseJobInternalNotes(serializeJobInternalNotes({ specialRequestTasks: tasks } as any)).specialRequestTasks;
it.each([undefined, null, {}, "task list", 1])("non-array task metadata cannot create actionable work (%j)", tasks => {
 expect(parse(tasks)).toEqual([]); expect(roundtrip(tasks)).toEqual([]);
});
it("drops nonobjects and missing/nonstring/blank titles instead of rendering phantom work", () => {
 const tasks = [null, false, 42, "text", {}, { title: 55 }, { title: "  " }, { title: " Keep ", id: " stable ", description: " Proof needed " }];
 const expected = [{ id: "stable", title: "Keep", description: "Proof needed", requiresPhoto: false, requiresNote: false }];
 expect(parse(tasks)).toEqual(expected); expect(roundtrip(tasks)).toEqual(expected);
});
it.each([null, 42, " ", {}, []])("invalid or blank identifier receives a deterministic fallback (%j)", id => {
 const tasks = [{ id, title: "Valid", description: false, requiresPhoto: true, requiresNote: true }];
 for (const result of [parse(tasks), roundtrip(tasks)]) expect(result).toEqual([{ id: "admin-task-1", title: "Valid", description: undefined, requiresPhoto: true, requiresNote: true }]);
});
it.each([null, 7, {}, " ", undefined])("nonstring/blank descriptions are absent rather than coercing unsafe text (%j)", description => {
 expect(parse([{ id: "t", title: "Task", description }])[0].description).toBeUndefined();
 expect(roundtrip([{ id: "t", title: "Task", description }])[0].description).toBeUndefined();
});
it.each([true, false, "true", "false", 1, 0, null, {}, undefined])("only literal true enables optional disposition (%j)", allowNotApplicable => {
 const tasks = [{ id: "t", title: "Conditional plant care", allowNotApplicable, requiresPhoto: "true", requiresNote: 1 }];
 for (const result of [parse(tasks), roundtrip(tasks)]) {
  expect(result[0]).toMatchObject({ requiresPhoto: false, requiresNote: false });
  if (allowNotApplicable === true) expect(result[0].allowNotApplicable).toBe(true);
  else expect(result[0]).not.toHaveProperty("allowNotApplicable");
 }
});
it("fallback identity keeps normalized order through repeated saves", () => {
 const first = parse([{ title: " " }, { title: "Plant" }, { id: " canonical ", title: " Detail " }]);
 expect(first.map(t => t.id)).toEqual(["admin-task-2", "canonical"]);
 expect(roundtrip(first)).toEqual(first);
});
