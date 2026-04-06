import { notFound } from "next/navigation";
import type { WebsiteContent, WebsitePageVisibility } from "@/lib/public-site/content";

export type WebsitePageKey = keyof WebsitePageVisibility;
export const ADMIN_RECOVERY_LOGIN_URL = "/login?admin=1";

export function isWebsitePageEnabled(content: WebsiteContent, key: WebsitePageKey) {
  return content.pageVisibility?.[key] !== false;
}

export function requireWebsitePageEnabled(content: WebsiteContent, key: WebsitePageKey) {
  if (!isWebsitePageEnabled(content, key)) {
    notFound();
  }
}

export function isWebsiteInMaintenance(content: WebsiteContent) {
  return content.maintenanceMode?.enabled === true;
}

export function isWebsiteLoginAllowed(content: WebsiteContent) {
  if (!isWebsiteInMaintenance(content)) return true;
  return content.maintenanceMode?.allowLogin !== false;
}
