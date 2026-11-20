import "server-only";
/**
 * The email a guest gets about a found item (2026-11-20): the office's text,
 * the item's first photo and a "View your item and request its return"
 * button. Both links go through the guest's token (the photo is served by
 * `/api/public/lost-found/<token>/photo`, which signs a short-lived link to
 * that item's own photo), so the email never carries a storage key, a signed
 * storage URL or an address that needs a login.
 */
import { buildDesignedEmail } from "@/lib/email-design/build-email";
import { plainMessageEmail } from "@/lib/email-design/build-email";
import { getAppSettings } from "@/lib/settings";
import { guestPhotoUrl } from "./guest-link";

export type GuestEmailParts = {
  subject: string;
  body: string;
  /** The guest's token, when a link exists; without it the email is plain text. */
  token: string | null;
  linkUrl: string | null;
  hasPhoto: boolean;
};

/** The photo URL the email shows, or null (no link, no photo, or a relative app URL). */
export function guestEmailPhotoUrl(parts: Pick<GuestEmailParts, "token" | "hasPhoto">): string | null {
  if (!parts.token || !parts.hasPhoto) return null;
  const url = guestPhotoUrl(parts.token);
  return /^https?:\/\//i.test(url) ? url : null;
}

export async function buildGuestItemEmail(parts: GuestEmailParts): Promise<{ subject: string; html: string }> {
  const settings = await getAppSettings();
  const company = { companyName: settings.companyName || "sNeek Property Services" };
  if (!parts.token || !parts.linkUrl) return plainMessageEmail({ subject: parts.subject, text: parts.body, settings: company });
  const photo = guestEmailPhotoUrl(parts);
  const built = buildDesignedEmail(company, "lostFoundGuestMessage", {
    messageText: parts.body,
    itemPhoto: photo ? JSON.stringify([{ url: photo, caption: "" }]) : "",
    itemUrl: parts.linkUrl,
  });
  return { subject: parts.subject, html: built.html };
}
