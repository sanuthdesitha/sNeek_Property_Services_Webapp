// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/s3", () => ({ getPresignedDownloadUrl: vi.fn() }));
import { getPresignedDownloadUrl } from "@/lib/s3";
import { assembleJobForm } from "@/lib/forms/assemble-job-form";
import { resolveTemplateReferenceUrls } from "@/lib/forms/resolve-references";
import { formRevision, type FormRevisionInput } from "@/lib/forms/form-revision";
import { isTemplateConditionalMet } from "@/lib/forms/visibility";

function fixture(): FormRevisionInput {
  return {
    templateId: "template-1",
    schema: assembleJobForm({ standardSections: false, sections: [{ id: "room", fields: [
      { id: "photo", type: "photo", required: true, minPhotos: 2,
        conditional: { propertyField: "bedrooms", value: 2 },
        references: [{ storageKey: "example.jpg", kind: "image" }],
        children: [{ id: "child", type: "text", references: [{ storageKey: "child.jpg", kind: "image" }] }] },
      { id: "answer", type: "text", required: true },
    ] }] }, [{ id: "extra", label: "Oven" }]),
    validationContext: { jobType: "REGULAR", isRework: false, laundryEligible: true,
      canUseNoPhoto: false, requiredChecklistTicksBlockSubmit: false, selfInspectionBlocksSubmit: true,
      property: { hasBalcony: true, bedrooms: 2, pay: 100 }, finalCheckupItems: [] },
  };
}
const schema = (input: FormRevisionInput): any => input.schema;

describe("formRevision", () => {
  it("requires explicit JSON property projection rather than a raw Date-bearing Prisma shape", () => {
    const input = fixture();
    const rawProperty = { hasBalcony: true, bedrooms: 2, createdAt: new Date(), updatedAt: new Date() };
    input.validationContext.property = rawProperty;
    expect(() => formRevision(input)).toThrow(TypeError);
    input.validationContext.property = { hasBalcony: rawProperty.hasBalcony, bedrooms: rawProperty.bedrooms };
    expect(formRevision(input)).toBe(formRevision(fixture()));
  });

  it("tracks section and child property conditions with literal dotted keys like visibility", () => {
    const input = fixture();
    const condition = { propertyField: "settings.enabled", value: true };
    schema(input).sections[0].conditional = condition;
    schema(input).sections[0].fields[0].children[0].conditional = { propertyField: "childEnabled", value: true };
    input.validationContext.property.settings = { enabled: true };
    expect(isTemplateConditionalMet(condition, {}, input.validationContext.property)).toBe(false);
    const initial = formRevision(input);
    input.validationContext.property.settings = { enabled: false };
    expect(formRevision(input)).toBe(initial);
    input.validationContext.property["settings.enabled"] = true;
    expect(isTemplateConditionalMet(condition, {}, input.validationContext.property)).toBe(true);
    const sectionChanged = formRevision(input);
    expect(sectionChanged).not.toBe(initial);
    input.validationContext.property.childEnabled = true;
    expect(formRevision(input)).not.toBe(sectionChanged);
  });

  it("hashes real assembly optional undefined properties exactly like response JSON", () => {
    const input = fixture();
    expect(schema(input).sections[1].fields[0]).toHaveProperty("instructions", undefined);
    expect(formRevision(input)).toMatch(/^[a-f0-9]{64}$/);
    expect(formRevision(input)).toBe(formRevision(JSON.parse(JSON.stringify(input))));
  });

  it("sorts object keys, preserves repeated object references and does not mutate input", () => {
    const input = fixture();
    const before = JSON.stringify(input);
    const reverse = (value: any): any => Array.isArray(value) ? value.map(reverse)
      : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reverse(v)])) : value;
    expect(formRevision(input)).toBe(formRevision(reverse(input)));
    const shared = { value: 1 };
    schema(input).custom = [shared, shared];
    expect(formRevision(input)).toBe(formRevision(JSON.parse(JSON.stringify(input))));
    delete schema(input).custom;
    expect(JSON.stringify(input)).toBe(before);
  });

  it("ignores actual signer refreshes including child references and logo, without mutation", async () => {
    const input = fixture();
    schema(input).theme = { logoKey: "logo.png" };
    vi.mocked(getPresignedDownloadUrl).mockImplementation(async key => `https://signed.test/${key}?token=one`);
    const first = await resolveTemplateReferenceUrls({ schema: input.schema });
    vi.mocked(getPresignedDownloadUrl).mockImplementation(async key => `https://signed.test/${key}?token=two`);
    const second = await resolveTemplateReferenceUrls({ schema: input.schema });
    expect(first).not.toEqual(second);
    expect(formRevision({ ...input, schema: first.schema })).toBe(formRevision({ ...input, schema: second.schema }));
    expect(formRevision(input)).toBe(formRevision({ ...input, schema: first.schema }));
    expect(schema(input).sections[0].fields[0].references[0].url).toBeUndefined();
    const noTheme = fixture();
    const resolved = await resolveTemplateReferenceUrls({ schema: noTheme.schema });
    expect(resolved.schema).toHaveProperty("theme", undefined);
    expect(formRevision(noTheme)).toBe(formRevision({ ...noTheme, schema: resolved.schema }));
  });

  it.each([
    ["template", (i: any) => { i.templateId = "template-2"; }],
    ["field id", (i: any) => { i.schema.sections[0].fields[0].id = "different"; }],
    ["requirement", (i: any) => { i.schema.sections[0].fields[0].minPhotos = 3; }],
    ["condition", (i: any) => { i.schema.sections[0].fields[0].conditional.value = 3; }],
    ["array order", (i: any) => { i.schema.sections[0].fields.reverse(); }],
    ["additional", (i: any) => { i.schema.sections[1].fields[0].label = "Windows"; }],
    ["root config", (i: any) => { i.schema.standardSections = true; }],
    ["storage destination", (i: any) => { i.schema.sections[0].fields[0].references[0].storageKey = "other.jpg"; }],
    ["business URL", (i: any) => { i.schema.business = { storageKey: "x", url: "https://external.test" }; }],
    ["unknown theme", (i: any) => { i.schema.theme = { futureValidation: true }; }],
    ["property dependency", (i: any) => { i.validationContext.property.bedrooms = 3; }],
    ["balcony", (i: any) => { i.validationContext.property.hasBalcony = false; }],
    ["rework", (i: any) => { i.validationContext.isRework = true; }],
    ["job type", (i: any) => { i.validationContext.jobType = "DEEP"; }],
    ["laundry eligibility", (i: any) => { i.validationContext.laundryEligible = false; }],
    ["no photo permission", (i: any) => { i.validationContext.canUseNoPhoto = true; }],
    ["checkbox gate", (i: any) => { i.validationContext.requiredChecklistTicksBlockSubmit = true; }],
    ["inspection gate", (i: any) => { i.validationContext.selfInspectionBlocksSubmit = false; }],
    ["final checkup", (i: any) => { i.validationContext.finalCheckupItems = [{ id: "lock", label: "Lock door" }]; }],
  ])("changes for %s", (_, change) => {
    const input = fixture();
    const before = formRevision(input);
    (change as (input: FormRevisionInput) => void)(input);
    expect(formRevision(input)).not.toBe(before);
  });

  it.each([undefined, "", "   "])("retains external reference URL with storageKey=%s", storageKey => {
    const input = fixture();
    const ref = { storageKey, url: "https://external.test/one" };
    schema(input).sections[0].fields[0].references = [ref];
    const before = formRevision(input);
    ref.url = "https://external.test/two";
    expect(formRevision(input)).not.toBe(before);
  });

  it("ignores unreferenced property pay/time and known theme appearance", () => {
    const input = fixture();
    const before = formRevision(input);
    input.validationContext.property.pay = 999;
    input.validationContext.property.updatedAt = "later";
    schema(input).theme = { logoUrl: "https://logo.test", accentColor: "red", headingFont: "serif" };
    expect(formRevision(input)).toBe(before);
  });

  it.each([NaN, Infinity, -Infinity, BigInt(1), Symbol("x"), () => 1, new Date(), new Map(),
    [undefined], Array(1), { toJSON: () => "hidden" }, Object.defineProperty({}, "x", { get() { throw Error("executed"); }, enumerable: true }),
  ])("rejects malformed JSON %# even inside excluded theme values", value => {
    const input = fixture();
    schema(input).theme = { logoUrl: value };
    expect(() => formRevision(input)).toThrow(TypeError);
  });

  it("rejects cycles, symbol keys, extended arrays and missing required context", () => {
    const input = fixture();
    schema(input).loop = input.schema;
    expect(() => formRevision(input)).toThrow(TypeError);
    delete schema(input).loop;
    schema(input)[Symbol("hidden")] = true;
    expect(() => formRevision(input)).toThrow(TypeError);
    const extended = fixture();
    schema(extended).sections.extra = true;
    expect(() => formRevision(extended)).toThrow(TypeError);
    const missing = fixture();
    delete (missing.validationContext as any).canUseNoPhoto;
    expect(() => formRevision(missing)).toThrow(TypeError);
  });
});
