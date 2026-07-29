import { describe, expect, it } from "vitest";
import {
  isQuoteScopeTemplateName,
  materializeJobScopedFormTemplate,
  quoteScopeTemplateName,
  type JobScopedTemplateClient,
} from "@/lib/forms/job-scoped-template";

/**
 * The regression this file exists for: quote → job conversion used to register
 * its one-off template as the property's PERMANENT per-job-type override, so
 * every future job of that type at that property rendered one quote's agreed
 * scope and never saw the admin's edits to the global template. The one-off is
 * now pinned to the job it was minted for — and to nothing else.
 */

function fakeClient() {
  const calls: Array<{ op: string; args: unknown }> = [];
  const client: JobScopedTemplateClient = {
    formTemplate: {
      async create(args) {
        calls.push({ op: "formTemplate.create", args });
        return { id: "tpl-new" };
      },
    },
    job: {
      async update(args) {
        calls.push({ op: "job.update", args });
        return {};
      },
    },
  };
  return { client, calls };
}

describe("materializeJobScopedFormTemplate", () => {
  it("creates an active, job-scoped v1 CUSTOM template and pins it to the job", async () => {
    const { client, calls } = fakeClient();

    const id = await materializeJobScopedFormTemplate(client, {
      jobId: "job-1",
      name: quoteScopeTemplateName("4F2A9C", "agreed"),
      serviceType: "AIRBNB_TURNOVER",
      schema: { sections: [{ id: "s1", title: "Agreed scope", fields: [] }] },
    });

    expect(id).toBe("tpl-new");

    const create = calls.find((c) => c.op === "formTemplate.create")!.args as {
      data: Record<string, unknown>;
    };
    expect(create.data.name).toBe("Quote 4F2A9C — agreed scope");
    expect(create.data.serviceType).toBe("AIRBNB_TURNOVER");
    expect(create.data.kind).toBe("CUSTOM");
    expect(create.data.version).toBe(1);
    expect(create.data.isActive).toBe(true);
    // The marker that keeps a one-off out of global resolution and out of the
    // "publish archives the previous global" sweep.
    expect(create.data.isJobScoped).toBe(true);

    const update = calls.find((c) => c.op === "job.update")!.args as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    expect(update.where.id).toBe("job-1");
    expect(update.data.formTemplateId).toBe("tpl-new");
  });

  it("touches ONLY the template row and the job — never a property override", async () => {
    const { client, calls } = fakeClient();
    await materializeJobScopedFormTemplate(client, {
      jobId: "job-1",
      name: quoteScopeTemplateName("ABC123", "standard"),
      serviceType: "DEEP_CLEAN",
      schema: { sections: [] },
    });
    // Two writes, both job-local. Anything else (a settings write registering a
    // property override) is the bug this module was extracted to prevent.
    expect(calls.map((c) => c.op)).toEqual(["formTemplate.create", "job.update"]);
    expect(JSON.stringify(calls)).not.toContain("propertyFormTemplateOverrides");
    expect(JSON.stringify(calls)).not.toContain("propertyId");
  });
});

describe("quote one-off naming convention", () => {
  it("round-trips the names the backfill has to recognise", () => {
    expect(isQuoteScopeTemplateName(quoteScopeTemplateName("4F2A9C", "agreed"))).toBe(true);
    expect(isQuoteScopeTemplateName(quoteScopeTemplateName("4F2A9C", "standard"))).toBe(true);
  });

  it("does not match property checklist templates or arbitrary names", () => {
    // generatePropertyTemplates' convention — legitimate property overrides.
    expect(isQuoteScopeTemplateName("Beachside Villa — airbnb turnover checklist")).toBe(false);
    expect(isQuoteScopeTemplateName("Quote 4F2A9C")).toBe(false);
    expect(isQuoteScopeTemplateName("Quote 4F2A9C - agreed scope")).toBe(false); // hyphen, not em dash
    expect(isQuoteScopeTemplateName(null)).toBe(false);
    expect(isQuoteScopeTemplateName("")).toBe(false);
  });
});
