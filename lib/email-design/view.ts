import "server-only";
/**
 * Responses for the email design routes: what the editor and the Email look
 * screen need (the stored row, the live look, Company details for the footer,
 * who may do what). Definitions are not sent: the editor reads the same
 * plain registry module.
 */
import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { resolveAppUrl } from "@/lib/app-url";
import { getAppSettings } from "@/lib/settings";
import { isCustomizedEmailTemplate, type AppEmailTemplateKey } from "@/lib/email-templates";
import { businessFromSettings } from "./compose";
import { designAccess, lookEditRefusal, publishRefusal } from "./permission";
import { EMAIL_DESIGNS, emailDesign } from "./registry";
import { EmailDesignError, getPublishedEmailTheme, readDesignRow, readThemeRow, type DesignRow, type ThemeRow } from "./store";
import { DEFAULT_EMAIL_THEME, themeContrastReport } from "./theme";
import type { DesignListItem, DesignViewResponse, LookViewResponse } from "./view-types";

export const DESIGN_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export function designError(error: unknown): NextResponse {
  if (error instanceof EmailDesignError) return NextResponse.json({ error: error.message, ...error.details }, { status: error.status, headers: DESIGN_HEADERS });
  const message = error instanceof Error ? error.message : "";
  if (message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in again." }, { status: 401, headers: DESIGN_HEADERS });
  if (message === "FORBIDDEN") return NextResponse.json({ error: "You do not have access to email designs." }, { status: 403, headers: DESIGN_HEADERS });
  return NextResponse.json({ error: "Something went wrong. Nothing was changed." }, { status: 500, headers: DESIGN_HEADERS });
}

function customHtml(key: string, settings: Awaited<ReturnType<typeof getAppSettings>>): boolean {
  const definition = emailDesign(key);
  if (!definition?.templateKey || definition.security) return false;
  const templateKey = definition.templateKey as AppEmailTemplateKey;
  return isCustomizedEmailTemplate(templateKey, settings.emailTemplates[templateKey]);
}

export async function designList(session: Session): Promise<{ items: DesignListItem[]; access: Awaited<ReturnType<typeof designAccess>> }> {
  const [access, settings] = await Promise.all([designAccess(session), getAppSettings()]);
  const rows = await Promise.all(EMAIL_DESIGNS.map(async (definition) => ({ definition, row: await readDesignRow(definition.key).catch(() => null) })));
  const items = rows.map(({ definition, row }): DesignListItem => ({
    key: definition.key,
    publishedVersion: row?.publishedVersion ?? null,
    hasDraft: Boolean(row?.draft),
    readFailed: row === null,
    customHtml: customHtml(definition.key, settings),
  }));
  return { items, access };
}

export async function designView(session: Session, key: string, row?: DesignRow): Promise<DesignViewResponse> {
  const definition = emailDesign(key);
  if (!definition) throw new EmailDesignError(404, "No email design with that name.");
  const [access, settings, theme, stored] = await Promise.all([designAccess(session), getAppSettings(), getPublishedEmailTheme(), row ? Promise.resolve(row) : readDesignRow(key)]);
  return {
    key,
    row: stored,
    theme,
    business: businessFromSettings(settings),
    appUrl: resolveAppUrl("/"),
    customHtml: customHtml(key, settings),
    access,
    impersonating: Boolean(session.impersonation),
  };
}

export async function lookView(session: Session, row?: ThemeRow): Promise<LookViewResponse> {
  const [settings, stored] = await Promise.all([getAppSettings(), row ? Promise.resolve(row) : readThemeRow()]);
  const published = stored.versions.find((item) => item.version === stored.publishedVersion)?.theme ?? DEFAULT_EMAIL_THEME;
  const editRefusal = lookEditRefusal(session);
  const publish = publishRefusal(session);
  return {
    row: stored,
    published,
    contrast: themeContrastReport(stored.draft?.theme ?? published),
    business: businessFromSettings(settings),
    appUrl: resolveAppUrl("/"),
    sendingAddress: process.env.EMAIL_FROM ?? "admin@sneekproservices.com.au",
    officeInbox: settings.accountsEmail ?? "",
    canEdit: editRefusal === null,
    editReason: editRefusal,
    canPublish: publish === null && editRefusal === null,
    publishReason: editRefusal ?? publish,
  };
}
