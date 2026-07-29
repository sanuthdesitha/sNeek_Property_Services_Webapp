import { describe, expect, it } from "vitest";
import {
  collectPropertyScopedTemplateIds,
  compareTemplateRecency,
  pickGlobalDefaultTemplate,
  propertiesOverridingServiceType,
  propertiesUsingTemplate,
  resolveJobFormTemplate,
  type ResolvableFormTemplate,
} from "@/lib/forms/resolve-job-template";

/**
 * The rule that decides WHICH form template a job renders. Getting this wrong
 * is indistinguishable, from the admin's chair, from "my edit didn't save":
 * the row saves, but the job renders a different row.
 */

function tpl(over: Partial<ResolvableFormTemplate> & { id: string }): ResolvableFormTemplate {
  return {
    serviceType: "AIRBNB_TURNOVER",
    isActive: true,
    version: 1,
    publishedAt: null,
    updatedAt: null,
    createdAt: null,
    ...over,
  };
}

describe("collectPropertyScopedTemplateIds", () => {
  it("collects every template registered as some property's override", () => {
    const ids = collectPropertyScopedTemplateIds({
      "prop-a": { AIRBNB_TURNOVER: "t-a", DEEP_CLEAN: "t-b" },
      "prop-b": { AIRBNB_TURNOVER: "t-c" },
    });
    expect([...ids].sort()).toEqual(["t-a", "t-b", "t-c"]);
  });

  it("ignores empty / null entries and missing maps", () => {
    expect(collectPropertyScopedTemplateIds(undefined).size).toBe(0);
    expect(
      collectPropertyScopedTemplateIds({ "prop-a": { AIRBNB_TURNOVER: "", DEEP_CLEAN: null }, "prop-b": null }).size
    ).toBe(0);
  });
});

describe("resolveJobFormTemplate — property override", () => {
  const templates = [
    tpl({ id: "global-1", version: 3 }),
    tpl({ id: "prop-tpl", version: 9 }),
  ];
  const overrides = { "prop-a": { AIRBNB_TURNOVER: "prop-tpl" } };

  it("uses the property's override when it is active and matches the service type", () => {
    const res = resolveJobFormTemplate({
      jobType: "AIRBNB_TURNOVER",
      propertyId: "prop-a",
      overrides,
      templates,
    });
    expect(res.template?.id).toBe("prop-tpl");
    expect(res.source).toBe("property_override");
    expect(res.configuredPropertyTemplateId).toBe("prop-tpl");
    expect(res.overrideUnusable).toBe(false);
  });

  it("never leaks one property's generated template to another property", () => {
    // prop-tpl is version 9 — the highest active row of this service type — but
    // it is property-scoped, so prop-b must still get the global template.
    const res = resolveJobFormTemplate({
      jobType: "AIRBNB_TURNOVER",
      propertyId: "prop-b",
      overrides,
      templates,
    });
    expect(res.template?.id).toBe("global-1");
    expect(res.source).toBe("global_latest");
  });

  it("falls back to the global default and flags it when the override is archived", () => {
    const res = resolveJobFormTemplate({
      jobType: "AIRBNB_TURNOVER",
      propertyId: "prop-a",
      overrides,
      templates: [tpl({ id: "global-1", version: 3 }), tpl({ id: "prop-tpl", version: 9, isActive: false })],
    });
    expect(res.template?.id).toBe("global-1");
    expect(res.source).toBe("global_latest");
    expect(res.overrideUnusable).toBe(true);
  });

  it("ignores an override that points at a different service type", () => {
    const res = resolveJobFormTemplate({
      jobType: "AIRBNB_TURNOVER",
      propertyId: "prop-a",
      overrides,
      templates: [tpl({ id: "global-1", version: 3 }), tpl({ id: "prop-tpl", serviceType: "DEEP_CLEAN", version: 9 })],
    });
    expect(res.template?.id).toBe("global-1");
    expect(res.overrideUnusable).toBe(true);
  });
});

describe("resolveJobFormTemplate — global fallback", () => {
  it("picks the highest active version of the matching service type", () => {
    const res = resolveJobFormTemplate({
      jobType: "DEEP_CLEAN",
      propertyId: "prop-x",
      overrides: {},
      templates: [
        tpl({ id: "a", serviceType: "DEEP_CLEAN", version: 2 }),
        tpl({ id: "b", serviceType: "DEEP_CLEAN", version: 7 }),
        tpl({ id: "c", serviceType: "AIRBNB_TURNOVER", version: 99 }),
      ],
    });
    expect(res.template?.id).toBe("b");
  });

  it("ignores inactive (draft / archived) templates — a draft edit is never live", () => {
    const res = resolveJobFormTemplate({
      jobType: "DEEP_CLEAN",
      propertyId: "prop-x",
      overrides: {},
      templates: [
        tpl({ id: "live", serviceType: "DEEP_CLEAN", version: 2 }),
        tpl({ id: "draft", serviceType: "DEEP_CLEAN", version: 20, isActive: false }),
      ],
    });
    expect(res.template?.id).toBe("live");
  });

  it("returns none when no active template exists for the service type", () => {
    const res = resolveJobFormTemplate({
      jobType: "LAWN_MOWING",
      propertyId: "prop-x",
      overrides: {},
      templates: [tpl({ id: "a", serviceType: "DEEP_CLEAN" })],
    });
    expect(res.template).toBeNull();
    expect(res.source).toBe("none");
  });

  it("is deterministic when versions tie — newest publishedAt wins, not row order", () => {
    // Version numbers are allocated per FormKind but resolution happens per
    // serviceType, so ties are routine. An arbitrary tie-break is exactly the
    // "sometimes my edit applies" symptom.
    const older = tpl({ id: "zzz-old", serviceType: "DEEP_CLEAN", version: 4, publishedAt: "2026-01-01T00:00:00Z" });
    const newer = tpl({ id: "aaa-new", serviceType: "DEEP_CLEAN", version: 4, publishedAt: "2026-06-01T00:00:00Z" });
    for (const templates of [[older, newer], [newer, older]]) {
      const res = resolveJobFormTemplate({
        jobType: "DEEP_CLEAN",
        propertyId: "prop-x",
        overrides: {},
        templates,
      });
      expect(res.template?.id).toBe("aaa-new");
    }
  });

  it("falls through publishedAt → updatedAt → createdAt → id for a total order", () => {
    const a = tpl({ id: "a", version: 1, updatedAt: "2026-01-01T00:00:00Z" });
    const b = tpl({ id: "b", version: 1, updatedAt: "2026-02-01T00:00:00Z" });
    expect(compareTemplateRecency(a, b)).toBeGreaterThan(0);

    const c = tpl({ id: "c", version: 1, createdAt: "2026-03-01T00:00:00Z" });
    const d = tpl({ id: "d", version: 1, createdAt: "2026-01-01T00:00:00Z" });
    expect(compareTemplateRecency(c, d)).toBeLessThan(0);

    const e = tpl({ id: "e", version: 1 });
    const f = tpl({ id: "f", version: 1 });
    expect(compareTemplateRecency(e, f)).toBeLessThan(0);
    expect(compareTemplateRecency(f, e)).toBeGreaterThan(0);
  });
});

describe("resolveJobFormTemplate — job pin (quote-minted one-off)", () => {
  // The bug this covers: quote → job conversion used to register its one-off
  // template as the property's PERMANENT override, so every future job of that
  // type at the property rendered one quote's agreed scope. The one-off is now
  // pinned to the job it was minted for — and to nothing else.
  const pinned = tpl({ id: "quote-one-off", version: 1, isJobScoped: true });
  const propertyTpl = tpl({ id: "prop-tpl", version: 5 });
  const globalTpl = tpl({ id: "global-1", version: 3 });
  const templates = [globalTpl, propertyTpl, pinned];
  const overrides = { "prop-a": { AIRBNB_TURNOVER: "prop-tpl" } };

  it("wins over the property override and the global default", () => {
    const res = resolveJobFormTemplate({
      jobType: "AIRBNB_TURNOVER",
      propertyId: "prop-a",
      overrides,
      templates,
      jobTemplateId: "quote-one-off",
    });
    expect(res.template?.id).toBe("quote-one-off");
    expect(res.source).toBe("job_pin");
    expect(res.pinnedJobTemplateId).toBe("quote-one-off");
    expect(res.pinUnusable).toBe(false);
    // The property override is still reported — it just did not win.
    expect(res.configuredPropertyTemplateId).toBe("prop-tpl");
  });

  it("applies to that job ONLY — an unpinned job at the same property is untouched", () => {
    const res = resolveJobFormTemplate({
      jobType: "AIRBNB_TURNOVER",
      propertyId: "prop-a",
      overrides,
      templates,
    });
    expect(res.template?.id).toBe("prop-tpl");
    expect(res.source).toBe("property_override");
    expect(res.pinnedJobTemplateId).toBeNull();
  });

  it("never leaks into the global default, even as the newest row", () => {
    // A job-scoped one-off with the highest version must not become anybody's
    // default now that it is no longer registered in the overrides map.
    const res = resolveJobFormTemplate({
      jobType: "AIRBNB_TURNOVER",
      propertyId: "prop-b",
      overrides: {},
      templates: [globalTpl, tpl({ id: "quote-one-off", version: 99, isJobScoped: true })],
    });
    expect(res.template?.id).toBe("global-1");
    expect(res.source).toBe("global_latest");
  });

  it("falls back when the pinned template is archived (isActive false)", () => {
    const res = resolveJobFormTemplate({
      jobType: "AIRBNB_TURNOVER",
      propertyId: "prop-a",
      overrides,
      templates: [globalTpl, propertyTpl, tpl({ id: "quote-one-off", isActive: false, isJobScoped: true })],
      jobTemplateId: "quote-one-off",
    });
    expect(res.template?.id).toBe("prop-tpl");
    expect(res.source).toBe("property_override");
    expect(res.pinUnusable).toBe(true);
  });

  it("falls back when the pinned template is missing entirely", () => {
    const res = resolveJobFormTemplate({
      jobType: "AIRBNB_TURNOVER",
      propertyId: "prop-b",
      overrides,
      templates: [globalTpl],
      jobTemplateId: "deleted-row",
    });
    expect(res.template?.id).toBe("global-1");
    expect(res.source).toBe("global_latest");
    expect(res.pinUnusable).toBe(true);
  });

  it("ignores a pin whose service type no longer matches the job", () => {
    const res = resolveJobFormTemplate({
      jobType: "AIRBNB_TURNOVER",
      propertyId: "prop-b",
      overrides: {},
      templates: [globalTpl, tpl({ id: "quote-one-off", serviceType: "DEEP_CLEAN", isJobScoped: true })],
      jobTemplateId: "quote-one-off",
    });
    expect(res.template?.id).toBe("global-1");
    expect(res.pinUnusable).toBe(true);
  });

  it("wins even when the pinned row is ALSO a property-scoped row (legacy data)", () => {
    // Pre-repair rows are registered as the property's override AND pinned by
    // the backfill. Being property-scoped must not disqualify the pin.
    const res = resolveJobFormTemplate({
      jobType: "AIRBNB_TURNOVER",
      propertyId: "prop-a",
      overrides: { "prop-a": { AIRBNB_TURNOVER: "quote-one-off" } },
      templates: [globalTpl, tpl({ id: "quote-one-off", version: 1 })],
      jobTemplateId: "quote-one-off",
    });
    expect(res.template?.id).toBe("quote-one-off");
    expect(res.source).toBe("job_pin");
  });

  it("an empty / null pin behaves exactly like no pin", () => {
    for (const jobTemplateId of [null, undefined, ""]) {
      const res = resolveJobFormTemplate({
        jobType: "AIRBNB_TURNOVER",
        propertyId: "prop-a",
        overrides,
        templates,
        jobTemplateId,
      });
      expect(res.source).toBe("property_override");
      expect(res.pinUnusable).toBe(false);
      expect(res.pinnedJobTemplateId).toBeNull();
    }
  });
});

describe("pickGlobalDefaultTemplate", () => {
  it("excludes property-scoped rows even when they are the newest", () => {
    const templates = [tpl({ id: "global", version: 1 }), tpl({ id: "scoped", version: 50 })];
    expect(pickGlobalDefaultTemplate(templates, "AIRBNB_TURNOVER", new Set(["scoped"]))?.id).toBe("global");
    expect(pickGlobalDefaultTemplate(templates, "AIRBNB_TURNOVER", new Set())?.id).toBe("scoped");
  });

  it("excludes job-scoped one-offs regardless of the override map", () => {
    const templates = [
      tpl({ id: "global", version: 1 }),
      tpl({ id: "one-off", version: 50, isJobScoped: true }),
    ];
    expect(pickGlobalDefaultTemplate(templates, "AIRBNB_TURNOVER", new Set())?.id).toBe("global");
  });
});

describe("impact helpers", () => {
  const overrides = {
    "prop-a": { AIRBNB_TURNOVER: "t-1" },
    "prop-b": { AIRBNB_TURNOVER: "t-2", DEEP_CLEAN: "t-3" },
    "prop-c": { DEEP_CLEAN: "t-1" },
  };

  it("lists the properties overriding a service type", () => {
    expect(propertiesOverridingServiceType(overrides, "AIRBNB_TURNOVER")).toEqual([
      { propertyId: "prop-a", templateId: "t-1" },
      { propertyId: "prop-b", templateId: "t-2" },
    ]);
  });

  it("lists the properties pinned to a specific template", () => {
    expect(propertiesUsingTemplate(overrides, "t-1")).toEqual(["prop-a", "prop-c"]);
    expect(propertiesUsingTemplate(overrides, "nope")).toEqual([]);
  });
});
