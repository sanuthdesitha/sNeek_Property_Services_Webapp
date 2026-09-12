// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const signing = vi.hoisted(() => vi.fn());
vi.mock("@/lib/s3", () => ({ getPresignedDownloadUrl: signing }));
import { resolveTemplateReferenceUrls } from "@/lib/forms/resolve-references";

beforeEach(() => {
  signing.mockReset().mockImplementation(async (key: string) => `https://test.invalid/signed/${key}`);
});

describe("form reference resolution", () => {
  it("resolves child references when the parent has none, retaining IDs and evidence keys", async () => {
    const template = { id: "template", schema: { sections: [{ id: "section", fields: [{
      id: "parent", type: "yesno", children: [{ id: "child", type: "photo", references: [{ storageKey: "example.jpg", caption: "Expected result" }] }],
    }] }] } };
    const original = structuredClone(template);
    const result = await resolveTemplateReferenceUrls(template);
    expect(result.schema.sections[0].fields[0].children[0]).toEqual({
      id: "child", type: "photo", references: [{ storageKey: "example.jpg", caption: "Expected result", url: "https://test.invalid/signed/example.jpg" }],
    });
    expect(template).toEqual(original);
    expect(signing).toHaveBeenCalledWith("example.jpg", 3600);
  });

  it("resolves parent and nested descendant references together", async () => {
    const result = await resolveTemplateReferenceUrls({ schema: { sections: [{ fields: [{
      id: "parent", references: [{ storageKey: "parent" }], children: [{
        id: "child", references: [], children: [{ id: "grandchild", references: [{ storageKey: "nested" }] }],
      }],
    }] }] } });
    expect(result.schema.sections[0].fields[0].references[0]).toMatchObject({ storageKey: "parent", url: expect.any(String) });
    expect(result.schema.sections[0].fields[0].children[0].children[0].references[0]).toMatchObject({ storageKey: "nested", url: expect.any(String) });
    expect(signing).toHaveBeenCalledTimes(2);
  });

  it("keeps external and already-resolved URLs unchanged", async () => {
    const references = [{ url: "https://external.invalid/image" }, { storageKey: "existing", url: "https://existing.invalid/image" }];
    const result = await resolveTemplateReferenceUrls({ schema: { sections: [{ fields: [{ children: [{ references }] }] }] } });
    expect(result.schema.sections[0].fields[0].children[0].references).toEqual(references);
    expect(signing).not.toHaveBeenCalled();
  });

  it("preserves a failed child key while resolving its siblings and theme logo", async () => {
    signing.mockImplementation(async (key: string) => {
      if (key === "unavailable") throw new Error("provider unavailable");
      return `https://test.invalid/${key}`;
    });
    const result = await resolveTemplateReferenceUrls({ schema: {
      theme: { logoKey: "logo" }, sections: [{ fields: [{ children: [{ references: [{ storageKey: "unavailable" }, { storageKey: "available" }] }] }] }],
    } });
    expect(result.schema.sections[0].fields[0].children[0].references).toEqual([
      { storageKey: "unavailable" }, { storageKey: "available", url: "https://test.invalid/available" },
    ]);
    expect(result.schema.theme).toEqual({ logoKey: "logo", logoUrl: "https://test.invalid/logo" });
  });

  it.each([null, {}, { schema: {} }, { schema: { sections: null } }])("preserves missing or malformed schema %j", async template => {
    expect(await resolveTemplateReferenceUrls(template)).toEqual(template);
    expect(signing).not.toHaveBeenCalled();
  });

  it("preserves malformed child containers and unrelated field properties", async () => {
    const field = { id: "field", required: true, children: "legacy", references: null, conditional: { fieldId: "other", value: true } };
    const result = await resolveTemplateReferenceUrls({ schema: { sections: [{ fields: [field, null, ["malformed"]] }] } });
    expect(result.schema.sections[0].fields).toEqual([field, null, ["malformed"]]);
    expect(signing).not.toHaveBeenCalled();
  });
});
