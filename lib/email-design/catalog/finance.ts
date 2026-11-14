/**
 * Finance-editor emails (lib/notifications/events.ts, sent by
 * lib/notifications/engine.ts) as blocks. Version 1 is each event's standard
 * wording (the web subject and body in lib/notification-templates.ts). An
 * HTML body saved in the finance template editor before blocks keeps going
 * out as "custom HTML from before" until a block version is published; an
 * event with neither is still not emailed (as today). Plain module.
 */
import { FINANCE_EVENTS } from "@/lib/notifications/events";
import { getDefaultNotificationTemplates } from "@/lib/notification-templates";
import { design, doc, paragraph, v } from "./build";
import type { EmailDesignDefinition } from "../types";

const toDouble = (text: string) => text.replace(/\{([a-zA-Z0-9_]+)\}/g, "{{$1}}");

export function financeDesignKey(eventKey: string): string {
  return `finance.${eventKey}`;
}

function label(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (char) => char.toUpperCase());
}

export function financeDesigns(): EmailDesignDefinition[] {
  const defaults = getDefaultNotificationTemplates() as Record<string, { webSubject?: string; webBody?: string } | undefined>;
  return FINANCE_EVENTS.map((event) => {
    const standard = defaults[event.key];
    const recipients = event.defaultRecipients as readonly string[];
    const toClient = recipients.includes("CLIENT");
    return design({
      key: financeDesignKey(event.key),
      label: `Finance: ${event.label}`,
      group: "money",
      typeKey: "money.finance_events",
      audience: recipients.join(", ").toLowerCase(),
      trigger: `Finance event "${event.label}".`,
      security: false,
      whyLine: toClient ? "You got this because you're a client of sNeek." : "You got this because of your work with sNeek's finances.",
      preferences: toClient ? "client" : "staff",
      mustStay: [],
      source: "finance template editor (standard wording from lib/notification-templates.ts)",
      titleOptional: true,
      variables: event.variables.map((name) => v(name, label(name), `[${label(name)}]`, { fallback: "" })),
      defaults: doc(toDouble(standard?.webSubject ?? event.label), "", [paragraph(toDouble(standard?.webBody ?? event.label))]),
    });
  });
}
