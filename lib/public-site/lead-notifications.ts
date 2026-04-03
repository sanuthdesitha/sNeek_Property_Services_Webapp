import type { AppSettings } from "@/lib/settings";
import { sendEmailDetailed } from "@/lib/notifications/email";

function looksLikeEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function getWebsiteLeadRecipients(settings: AppSettings) {
  const candidates = [
    ...(settings.websiteContent.contact.recipientEmails ?? []),
    settings.accountsEmail,
    settings.websiteContent.contact.displayEmail,
  ];

  return Array.from(
    new Set(
      candidates
        .map((email) => email.trim().toLowerCase())
        .filter((email) => email && looksLikeEmail(email))
    )
  );
}

export async function sendWebsiteLeadNotification({
  settings,
  subject,
  html,
  replyTo,
}: {
  settings: AppSettings;
  subject: string;
  html: string;
  replyTo?: string | null;
}) {
  const recipients = getWebsiteLeadRecipients(settings);
  if (recipients.length === 0) return false;

  await sendEmailDetailed({
    to: recipients,
    subject,
    html,
    replyTo: replyTo || undefined,
  });

  return true;
}
