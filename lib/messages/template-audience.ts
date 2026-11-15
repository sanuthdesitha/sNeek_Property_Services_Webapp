/**
 * Which message templates the office is offered when writing to someone
 * (owner default 2026-11-17): cleaners get the cleaner-facing list, laundry
 * partners the laundry-facing list, clients everything except the cleaner,
 * laundry and internal categories. No audience: every switched-on template
 * (the list Forms and older callers read). PURE.
 */
export type TemplateAudience = "client" | "cleaner" | "laundry";

const STAFF_ONLY = ["CLEANER_FACING", "LAUNDRY_FACING", "INTERNAL"];

export function parseTemplateAudience(value: string | null | undefined): TemplateAudience | null {
  return value === "client" || value === "cleaner" || value === "laundry" ? value : null;
}

/** Prisma `category` filter for an audience (undefined: no filter). */
export function audienceCategoryFilter(audience: TemplateAudience | null): { in: string[] } | { notIn: string[] } | undefined {
  if (audience === "cleaner") return { in: ["CLEANER_FACING"] };
  if (audience === "laundry") return { in: ["LAUNDRY_FACING"] };
  if (audience === "client") return { notIn: STAFF_ONLY };
  return undefined;
}

/** The audience for a compose recipient: a client, or a user by their role. */
export function audienceForRecipient(recipient: { kind: string; role?: string | null } | null): TemplateAudience | null {
  if (!recipient) return null;
  if (recipient.kind === "client") return "client";
  if (recipient.role === "CLEANER") return "cleaner";
  if (recipient.role === "LAUNDRY") return "laundry";
  return null;
}

export const AUDIENCE_LABEL: Record<TemplateAudience, string> = {
  client: "client",
  cleaner: "cleaner-facing",
  laundry: "laundry-facing",
};
