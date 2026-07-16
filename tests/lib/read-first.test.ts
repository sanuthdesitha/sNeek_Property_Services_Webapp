import { describe, it, expect } from "vitest";
import { buildReadFirstItems } from "@/components/v2/cleaner/read-first-block";

describe("buildReadFirstItems", () => {
  it("returns an empty list for empty / missing inputs", () => {
    expect(buildReadFirstItems({})).toEqual([]);
    expect(buildReadFirstItems({ jobMeta: {}, jobTasks: [], carryForwardTasks: [] })).toEqual([]);
    expect(
      buildReadFirstItems({ jobMeta: { internalNoteText: "   " }, jobTasks: [], carryForwardTasks: [] })
    ).toEqual([]);
  });

  it("maps the admin internal note to an ADMIN item", () => {
    const items = buildReadFirstItems({ jobMeta: { internalNoteText: "Gate code changed" } });
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({ source: "ADMIN", title: "Admin note", body: "Gate code changed" });
  });

  it("maps additionals and special requests to CLIENT items (label/instructions and title/description)", () => {
    const items = buildReadFirstItems({
      jobMeta: {
        additionals: [{ id: "a1", label: "Balcony wash", instructions: "Use the long brush" }],
        specialRequestTasks: [{ id: "s1", title: "Water the plants", description: "Twice" }],
      },
    });
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ source: "CLIENT", title: "Balcony wash", body: "Use the long brush" });
    expect(items[1]).toEqual({ source: "CLIENT", title: "Water the plants", body: "Twice" });
  });

  it("maps job tasks to TASK items with REQUEST_REFERENCE images only", () => {
    const items = buildReadFirstItems({
      jobTasks: [
        {
          title: "Reset the sofa bed",
          description: "Fold as per photo",
          attachments: [
            { kind: "REQUEST_REFERENCE", url: "https://x/ref.jpg", label: "Reference" },
            { kind: "COMPLETION_PROOF", url: "https://x/proof.jpg" },
          ],
        },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0].source).toBe("TASK");
    expect(items[0].title).toBe("Reset the sofa bed");
    expect(items[0].body).toBe("Fold as per photo");
    expect(items[0].images).toEqual([{ url: "https://x/ref.jpg", label: "Reference" }]);
  });

  it("omits the images key when a task has no reference images", () => {
    const items = buildReadFirstItems({
      jobTasks: [{ title: "Sweep balcony", attachments: [{ kind: "COMPLETION_PROOF", url: "https://x/p.jpg" }] }],
    });
    expect(items).toHaveLength(1);
    expect(items[0].images).toBeUndefined();
    expect(items[0].body).toBeNull();
  });

  it("maps carry-forward tasks (description only) to CARRY_FORWARD items", () => {
    const items = buildReadFirstItems({
      carryForwardTasks: [{ id: "c1", description: "Oven still needs a scrub" }, { id: "c2", description: "  " }],
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({ source: "CARRY_FORWARD", title: "Unfinished task", body: "Oven still needs a scrub" });
  });

  it("preserves the ADMIN → CLIENT → TASK → CARRY_FORWARD merge order", () => {
    const items = buildReadFirstItems({
      jobMeta: {
        internalNoteText: "Admin says hi",
        additionals: [{ id: "a1", label: "Extra dusting" }],
        specialRequestTasks: [{ id: "s1", title: "Special request" }],
      },
      jobTasks: [{ title: "A job task" }],
      carryForwardTasks: [{ description: "Left over" }],
    });
    expect(items.map((i) => i.source)).toEqual(["ADMIN", "CLIENT", "CLIENT", "TASK", "CARRY_FORWARD"]);
  });

  it("skips additionals without a label and tasks without a title", () => {
    const items = buildReadFirstItems({
      jobMeta: { additionals: [{ id: "a1", instructions: "no label here" }] },
      jobTasks: [{ description: "no title here" }],
    });
    expect(items).toEqual([]);
  });
});
