import { db } from "@/lib/db";

const CREDENTIAL_KEY = "integrationCredentials";

export type XeroAppCredentials = { clientId: string; clientSecret: string };

/**
 * The Xero app's Client ID and Secret: Settings → Integrations first, then the
 * XERO_CLIENT_ID / XERO_CLIENT_SECRET environment fallback. Never logged.
 */
export async function getXeroCredentials(): Promise<XeroAppCredentials> {
  const row = await db.appSetting.findUnique({ where: { key: CREDENTIAL_KEY } });
  const creds = (row?.value as Record<string, string> | null) ?? {};
  return {
    clientId: creds.xeroClientId || process.env.XERO_CLIENT_ID || "",
    clientSecret: creds.xeroClientSecret || process.env.XERO_CLIENT_SECRET || "",
  };
}
