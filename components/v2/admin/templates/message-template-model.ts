/**
 * Message templates screen (board "Message templates", 2026-11-17): the
 * record shape, category and trigger words, the grouping of the list, and
 * the "Where it is used" lines. PURE (plain module).
 */
import type { TemplateDestination } from "@/lib/messages/template-variables";

export type MessageTrigger = "POST_JOB" | "REVIEW_REQUEST" | "DISCOUNT" | "NEXT_CLEAN" | "MANUAL";
export type MessageChannel = "EMAIL" | "SMS" | "BOTH";
export type MessageCategoryKey =
  | "OPERATIONAL"
  | "CHASE"
  | "SERVICE_RECOVERY"
  | "FEEDBACK"
  | "CLEANER_FACING"
  | "MARKETING"
  | "COMPLAINT"
  | "ONBOARDING"
  | "LAUNDRY_FACING"
  | "INTERNAL"
  | "CUSTOM";

export type MessageTemplateRecord = {
  id: string;
  name: string;
  triggerType: MessageTrigger;
  jobType: string | null;
  channel: MessageChannel;
  category: MessageCategoryKey;
  subject: string | null;
  body: string;
  isActive: boolean;
  updatedAt: string;
};

export type MessageTemplateDraft = Omit<MessageTemplateRecord, "id" | "updatedAt">;

export type AutomationUse = { ruleId: string; clientId: string; clientName: string; triggerType: string; delayMinutes: number; isEnabled: boolean };
export type CampaignUse = { id: string; name: string; status: string; sentAt: string | null };
export type TemplateUsage = { automations: AutomationUse[]; campaigns: CampaignUse[] };

/** Category order on the list: the busy ones first, the rest behind "Show". */
export const CATEGORY_ORDER: readonly MessageCategoryKey[] = [
  "OPERATIONAL",
  "CHASE",
  "SERVICE_RECOVERY",
  "FEEDBACK",
  "CLEANER_FACING",
  "MARKETING",
  "COMPLAINT",
  "ONBOARDING",
  "LAUNDRY_FACING",
  "INTERNAL",
  "CUSTOM",
];
export const FIRST_CATEGORIES = 6;

export const CATEGORY_LABEL: Record<MessageCategoryKey, string> = {
  OPERATIONAL: "Operational",
  CHASE: "Chase",
  SERVICE_RECOVERY: "Service recovery",
  FEEDBACK: "Feedback",
  CLEANER_FACING: "Cleaner-facing",
  MARKETING: "Marketing",
  COMPLAINT: "Complaint",
  ONBOARDING: "Onboarding",
  LAUNDRY_FACING: "Laundry-facing",
  INTERNAL: "Internal",
  CUSTOM: "Custom",
};

export const TRIGGER_LABEL: Record<MessageTrigger, string> = {
  MANUAL: "Nothing, manual",
  POST_JOB: "After a job (post-job)",
  REVIEW_REQUEST: "Review request",
  DISCOUNT: "Discount offer",
  NEXT_CLEAN: "Next clean reminder",
};

export const AUTOMATION_TRIGGER_LABEL: Record<string, string> = {
  POST_JOB_REVIEW: "Review request",
  POST_JOB_NEXT_CLEAN: "Next clean",
  POST_JOB_DISCOUNT: "Discount",
  POST_JOB_CUSTOM: "Custom",
};

export const CHANNEL_LABEL: Record<MessageChannel, string> = { EMAIL: "Email", SMS: "SMS", BOTH: "Email and SMS" };

export const EMPTY_DRAFT: MessageTemplateDraft = {
  name: "",
  triggerType: "MANUAL",
  jobType: null,
  channel: "EMAIL",
  category: "CUSTOM",
  subject: "",
  body: "",
  isActive: true,
};

export function draftOf(record: MessageTemplateRecord): MessageTemplateDraft {
  return {
    name: record.name,
    triggerType: record.triggerType,
    jobType: record.jobType,
    channel: record.channel,
    category: record.category,
    subject: record.subject ?? "",
    body: record.body,
    isActive: record.isActive,
  };
}

export function sameDraft(a: MessageTemplateDraft, b: MessageTemplateDraft): boolean {
  return (
    a.name === b.name &&
    a.triggerType === b.triggerType &&
    (a.jobType ?? null) === (b.jobType ?? null) &&
    a.channel === b.channel &&
    a.category === b.category &&
    (a.subject ?? "") === (b.subject ?? "") &&
    a.body === b.body &&
    a.isActive === b.isActive
  );
}

export type ListFilter = "all" | "email" | "sms" | "off";

export function matchesFilter(template: MessageTemplateRecord, filter: ListFilter, query: string): boolean {
  if (filter === "email" && template.channel === "SMS") return false;
  if (filter === "sms" && template.channel === "EMAIL") return false;
  if (filter === "off" && template.isActive) return false;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [template.name, template.body, template.subject ?? "", CATEGORY_LABEL[template.category] ?? ""].some((text) => text.toLowerCase().includes(q));
}

export type CategoryGroup = { category: MessageCategoryKey; label: string; rows: MessageTemplateRecord[] };

export function groupByCategory(rows: readonly MessageTemplateRecord[]): CategoryGroup[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    label: CATEGORY_LABEL[category],
    rows: rows.filter((row) => row.category === category).sort((a, b) => a.name.localeCompare(b.name)),
  })).filter((group) => group.rows.length > 0);
}

/** The row's second line: channel · where it is used. "–" for usage that could not be read. */
export function usageSummary(template: MessageTemplateRecord, usage: TemplateUsage | null | undefined, usageFailed: boolean): string {
  const parts: string[] = [CHANNEL_LABEL[template.channel]];
  if (template.isActive) parts.push("Inbox insert");
  if (usageFailed) parts.push("automations –");
  else if (usage) {
    if (usage.automations.length > 0) parts.push(`${usage.automations.length} client automation${usage.automations.length === 1 ? "" : "s"}`);
    if (usage.campaigns.length > 0) parts.push(`${usage.campaigns.length} campaign${usage.campaigns.length === 1 ? "" : "s"}`);
  }
  return parts.join(" · ");
}

/** The places a template is used in, for the variable warning. */
export function destinationsOf(template: Pick<MessageTemplateDraft, "isActive">, usage: TemplateUsage | null | undefined): TemplateDestination[] {
  const destinations: TemplateDestination[] = [];
  if (template.isActive) destinations.push("inbox", "composer");
  if (usage?.automations.length) destinations.push("automation");
  if (usage?.campaigns.length) destinations.push("campaign");
  return destinations;
}

export function isMessageTemplateRecord(value: unknown): value is MessageTemplateRecord {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && typeof row.name === "string" && typeof row.body === "string";
}
