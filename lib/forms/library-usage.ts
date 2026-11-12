/**
 * "Used by" for the forms library: which properties a job of the template's
 * service type would resolve to this template for, using the runtime rules in
 * resolve-job-template.ts (job pin → property override → newest global).
 *
 * PURE: the caller passes the templates, overrides and active property ids.
 */
import {
  collectPropertyScopedTemplateIds,
  pickGlobalDefaultTemplate,
  propertiesUsingTemplate,
  type ResolvableFormTemplate,
  type TemplateOverridesMap,
} from "./resolve-job-template";
import type { FormUsage } from "./library-types";

export type UsageTemplate = ResolvableFormTemplate & { archivedAt: Date | null };

export type UsageContext = {
  overrides: TemplateOverridesMap | null | undefined;
  activePropertyIds: readonly string[];
  /** Every template (any state); only active rows can be used. */
  templates: readonly UsageTemplate[];
};

export type UsageResolver = (template: UsageTemplate) => FormUsage;

export function createUsageResolver(context: UsageContext): UsageResolver {
  const scoped = collectPropertyScopedTemplateIds(context.overrides);
  const active = context.templates.filter((t) => t.isActive && !t.archivedAt);
  const activeById = new Map(active.map((t) => [t.id, t]));
  const activeProperties = new Set(context.activePropertyIds);
  const defaultByService = new Map<string, string | null>();

  function globalDefaultId(serviceType: string): string | null {
    if (!defaultByService.has(serviceType)) {
      defaultByService.set(serviceType, pickGlobalDefaultTemplate(active, serviceType, scoped)?.id ?? null);
    }
    return defaultByService.get(serviceType) ?? null;
  }

  /** Active properties whose override for this service type is a usable template. */
  function overriddenCount(serviceType: string): number {
    let count = 0;
    for (const propertyId of Array.from(activeProperties)) {
      const configured = context.overrides?.[propertyId]?.[serviceType];
      const target = typeof configured === "string" ? activeById.get(configured) : undefined;
      if (target && target.serviceType === serviceType) count += 1;
    }
    return count;
  }

  return (template) => {
    if (!template.isActive || template.archivedAt) return { kind: "not-live" };
    if (template.isJobScoped) return { kind: "job" };
    if (scoped.has(template.id)) {
      const properties = propertiesUsingTemplate(context.overrides, template.id).filter((id) => {
        const configured = context.overrides?.[id]?.[template.serviceType];
        return activeProperties.has(id) && configured === template.id;
      }).length;
      return { kind: "property", properties };
    }
    if (globalDefaultId(template.serviceType) === template.id) {
      return { kind: "default", properties: Math.max(0, activeProperties.size - overriddenCount(template.serviceType)) };
    }
    return { kind: "unused" };
  };
}

/** Sort weight for the Used by column: more properties first when descending. */
export function usageWeight(usage: FormUsage): number {
  switch (usage.kind) {
    case "default":
    case "property":
      return usage.properties;
    case "job":
      return 0.5;
    case "unused":
      return 0;
    default:
      return -1;
  }
}
