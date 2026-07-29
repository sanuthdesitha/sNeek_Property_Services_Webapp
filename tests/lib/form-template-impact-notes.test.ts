import { describe, expect, it } from "vitest";
import { buildImpactNotes, type TemplateImpact } from "@/components/v2/admin/forms/builder/template-impact";

/**
 * The builder's "where this template applies" guard rail. Each note exists
 * because that situation previously read to an admin as "my edit didn't save".
 */

function impact(over: Partial<TemplateImpact> = {}): TemplateImpact {
  return {
    status: "published",
    isGlobalDefault: true,
    globalDefault: { id: "self", name: "Self", version: 3 },
    propertyScoped: false,
    generatedForProperty: null,
    usedByProperties: [],
    divergentProperties: [],
    openJobsUsingThis: 4,
    openJobsOfServiceType: 4,
    submissionCount: 0,
    activeSiblingCount: 1,
    ...over,
  };
}

const texts = (i: TemplateImpact) => buildImpactNotes(i).map((n) => n.text).join(" | ");

describe("buildImpactNotes", () => {
  it("tells a draft it is not live", () => {
    expect(texts(impact({ status: "draft", isGlobalDefault: false }))).toMatch(/Draft — saving stores your edits/);
  });

  it("warns that an archived template reaches nothing", () => {
    expect(texts(impact({ status: "archived", isGlobalDefault: false }))).toMatch(/Archived/);
  });

  it("warns that a generated per-property template is replaced on re-approval", () => {
    const out = texts(
      impact({ generatedForProperty: { id: "p1", name: "Bondi 12" }, propertyScoped: true, isGlobalDefault: false })
    );
    expect(out).toMatch(/Bondi 12/);
    expect(out).toMatch(/discarded/);
  });

  it("explains a property-specific template is never the global default", () => {
    const out = texts(
      impact({ propertyScoped: true, isGlobalDefault: false, usedByProperties: [{ id: "p1", name: "Bondi 12" }] })
    );
    expect(out).toMatch(/Property-specific template/);
    expect(out).toMatch(/never the global default/);
  });

  it("names the template that IS live when this one is not the default", () => {
    const out = texts(
      impact({ isGlobalDefault: false, globalDefault: { id: "other", name: "Turnover v9", version: 9 } })
    );
    expect(out).toMatch(/Turnover v9/);
    expect(out).toMatch(/Publish this template to make it the default/);
  });

  it("counts properties that override this service type with another form", () => {
    const out = texts(
      impact({
        divergentProperties: [
          { id: "p1", name: "Bondi 12" },
          { id: "p2", name: "Manly 4" },
        ],
      })
    );
    expect(out).toMatch(/2 properties override this service type/);
    expect(out).toMatch(/will NOT reach them/);
  });

  it("flags the wrong-template case when no open job resolves here", () => {
    expect(texts(impact({ openJobsUsingThis: 0, openJobsOfServiceType: 6 }))).toMatch(
      /No open job currently resolves to this template/
    );
  });

  it("reassures that live jobs pick edits up without re-assignment", () => {
    expect(texts(impact({ openJobsUsingThis: 3 }))).toMatch(/3 open jobs will render these edits/);
  });

  it("explains that submitted forms are snapshots by design", () => {
    expect(texts(impact({ submissionCount: 12 }))).toMatch(/never change retroactively/);
  });
});
