import { z } from "zod";
import { db } from "@/lib/db";
import { isSegmentId } from "./segments";

export const emailCampaignAudienceSchema = z.object({
  type: z.enum(["all_clients", "inactive_clients", "service_type", "segment", "single_recipient"]),
  filters: z.object({
    daysSinceLastBooking: z.number().int().min(1).max(3650).optional(),
    jobTypes: z.array(z.string().trim().min(1)).optional(),
    segmentId: z.string().trim().min(1).refine(isSegmentId, "Unknown segment").optional(),
    email: z.string().trim().email().max(254).transform(value => value.toLowerCase()).optional(),
  }).optional(),
}).superRefine((value, ctx) => {
  if (value.type === "single_recipient" && !value.filters?.email) ctx.addIssue({ code: "custom", path: ["filters", "email"], message: "Enter one recipient email address." });
  if (value.type === "segment" && !value.filters?.segmentId) ctx.addIssue({ code: "custom", path: ["filters", "segmentId"], message: "Select a valid segment." });
});
export type EmailCampaignAudience = z.infer<typeof emailCampaignAudienceSchema>;
export function normalizeCampaignAudience(value: unknown): EmailCampaignAudience {
  // Only absent legacy audiences default to all clients. An invalid explicit
  // selection must never turn a one-person campaign into a broadcast.
  return emailCampaignAudienceSchema.parse(value == null ? { type: "all_clients" } : value);
}

export async function resolveSingleCampaignRecipient(email: string) {
  const address = z.string().trim().email().max(254).parse(email).toLowerCase();
  const clients = await db.client.findMany({
    where: { isActive: true, OR: [
      { email: { equals: address, mode: "insensitive" } },
      { users: { some: { isActive: true, email: { equals: address, mode: "insensitive" } } } },
    ] },
    select: { id: true, name: true, email: true, phone: true, users: {
      where: { isActive: true, email: { equals: address, mode: "insensitive" } },
      select: { phone: true },
    } },
    take: 2,
  });
  if (clients.length > 1) throw new Error("This email matches more than one client. Use a unique client contact email.");
  const client = clients[0];
  if (!client) return [];
  // Selecting a contact's email must never route SMS to a different person's
  // primary account phone when that contact has no phone recorded.
  const phone = client.users.length > 0 ? client.users[0]?.phone?.trim() || ""
    : client.email?.trim().toLowerCase() === address ? client.phone?.trim() || "" : "";
  return [{ clientId: client.id, clientName: client.name, email: address, phone }];
}
