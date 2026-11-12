/**
 * The two existing shared template stores a wording part can be backed by:
 * `settings.emailTemplates` (EMAIL parts) and `settings.notificationTemplates`
 * (INBOX title/body and SMS body). Reading, writing and rendering them in one
 * place; the stores keep their own `{name}` syntax, the editor shows
 * `{{name}}`. Plain module (no server imports).
 */
import { getDefaultEmailTemplates, renderEmailTemplate, type AppEmailTemplates } from "@/lib/email-templates";
import { getDefaultNotificationTemplates, renderNotificationTemplate, type AppNotificationTemplates } from "@/lib/notification-templates";
import { fromEmailTemplateSyntax, toEmailTemplateSyntax } from "./template";
import type { WordingFields, WordingPartDefinition } from "./types";

export type TemplateSettings = {
  companyName: string;
  projectName?: string;
  logoUrl: string;
  accountsEmail?: string;
  timezone?: string;
  emailTemplates: AppEmailTemplates;
  notificationTemplates: AppNotificationTemplates;
};

export function isTemplatePart(part: WordingPartDefinition): boolean {
  return part.source.kind !== "STORE";
}

function fieldsFromNotification(template: { webSubject: string; webBody: string; smsBody: string }, part: WordingPartDefinition): WordingFields {
  if (part.transport === "SMS") return { body: fromEmailTemplateSyntax(template.smsBody) };
  return { title: fromEmailTemplateSyntax(template.webSubject), body: fromEmailTemplateSyntax(template.webBody) };
}

/** The shipped default of a template part. */
export function templateDefaults(part: WordingPartDefinition): WordingFields {
  if (part.source.kind === "EMAIL_TEMPLATE") {
    const template = getDefaultEmailTemplates()[part.source.key];
    return { subject: fromEmailTemplateSyntax(template.subject), body: fromEmailTemplateSyntax(template.html) };
  }
  if (part.source.kind === "NOTIFICATION_TEMPLATE") return fieldsFromNotification(getDefaultNotificationTemplates()[part.source.key], part);
  return part.defaults;
}

/** The live text of a template part in the settings (may carry an edit made in Forms). */
export function templateLive(settings: Pick<TemplateSettings, "emailTemplates" | "notificationTemplates">, part: WordingPartDefinition): WordingFields {
  if (part.source.kind === "EMAIL_TEMPLATE") {
    const template = settings.emailTemplates?.[part.source.key] ?? getDefaultEmailTemplates()[part.source.key];
    return { subject: fromEmailTemplateSyntax(template.subject), body: fromEmailTemplateSyntax(template.html) };
  }
  if (part.source.kind === "NOTIFICATION_TEMPLATE") {
    return fieldsFromNotification(settings.notificationTemplates?.[part.source.key] ?? getDefaultNotificationTemplates()[part.source.key], part);
  }
  return part.defaults;
}

/** Trimmed the way the settings sanitizer stores it, so the live hash matches after a save. */
export function templateStoredFields(part: WordingPartDefinition, fields: WordingFields): WordingFields {
  const trimmed: WordingFields = {};
  for (const [name, value] of Object.entries(fields)) trimmed[name as keyof WordingFields] = (value ?? "").trim();
  return trimmed;
}

/** The settings patch that writes a template part's new text, keeping the template's other fields. */
export function templatePatch(settings: Pick<TemplateSettings, "emailTemplates" | "notificationTemplates">, part: WordingPartDefinition, fields: WordingFields): Partial<TemplateSettings> {
  if (part.source.kind === "EMAIL_TEMPLATE") {
    return { emailTemplates: { ...settings.emailTemplates, [part.source.key]: { subject: toEmailTemplateSyntax(fields.subject ?? ""), html: toEmailTemplateSyntax(fields.body ?? "") } } };
  }
  if (part.source.kind === "NOTIFICATION_TEMPLATE") {
    const key = part.source.key;
    const current = settings.notificationTemplates?.[key] ?? getDefaultNotificationTemplates()[key];
    const next = part.transport === "SMS"
      ? { ...current, smsBody: toEmailTemplateSyntax(fields.body ?? "") }
      : { ...current, webSubject: toEmailTemplateSyntax(fields.title ?? ""), webBody: toEmailTemplateSyntax(fields.body ?? "") };
    return { notificationTemplates: { ...settings.notificationTemplates, [key]: next } };
  }
  return {};
}

/** Renders a template part through the existing renderer of its store. */
export function renderTemplatePart(settings: TemplateSettings, part: WordingPartDefinition, values: Record<string, unknown>): { title: string; subject: string; body: string; html: string } {
  if (part.source.kind === "EMAIL_TEMPLATE") {
    const rendered = renderEmailTemplate(settings, part.source.key, values);
    return { title: "", subject: rendered.subject, body: rendered.html, html: rendered.html };
  }
  if (part.source.kind === "NOTIFICATION_TEMPLATE") {
    const rendered = renderNotificationTemplate(settings, part.source.key, values);
    return part.transport === "SMS"
      ? { title: "", subject: "", body: rendered.smsBody, html: "" }
      : { title: rendered.webSubject, subject: "", body: rendered.webBody, html: "" };
  }
  throw new Error("Not a template part");
}

/** Extra limits of the shared in-app / SMS template store (its sanitizer cuts longer text). */
export function templateLimitProblem(part: WordingPartDefinition, fields: WordingFields): string | null {
  if (part.source.kind !== "NOTIFICATION_TEMPLATE") return null;
  if (part.transport === "SMS" && (fields.body ?? "").length > 320) return "Keep the SMS under 320 characters.";
  if ((fields.title ?? "").length > 200) return "Keep the title under 200 characters.";
  return null;
}
