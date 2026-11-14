/**
 * Building a block-design email in code (routes and libraries that used to
 * write their own HTML). The result is ready for sendEmailDetailed: the send
 * path renders it again with the published version and Email look, and
 * refuses it when a required value is empty.
 */
import { resolveAppUrl } from "@/lib/app-url";
import { businessFromSettings, composeDesign, withSpec, type CompanySettingsLike } from "./compose";
import { emailDesign } from "./registry";
import { DEFAULT_EMAIL_THEME } from "./theme";

export type BuiltDesignedEmail = { subject: string; html: string; text: string; missing: string[] };

export function buildDesignedEmail(settings: CompanySettingsLike, key: string, values: Record<string, string>): BuiltDesignedEmail {
  const definition = emailDesign(key);
  if (!definition) throw new Error(`Unknown email design ${key}`);
  const rendered = composeDesign(definition, definition.defaults, values, {
    theme: DEFAULT_EMAIL_THEME,
    business: businessFromSettings(settings),
    appUrl: resolveAppUrl("/"),
    mode: "send",
    settings,
  });
  return { subject: rendered.subject, html: withSpec(rendered, { kind: "design", key, values }), text: rendered.text, missing: rendered.missing };
}
