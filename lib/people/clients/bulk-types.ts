/**
 * People › Clients bulk contract. PLAIN module, shared by the route and the
 * screen.
 *  - send-update: one custom message (subject + text) to each client through
 *    the existing client lifecycle email (`sendLifecycleEmail`, manual mode),
 *    the same path as a client's "Send update". One outcome per client.
 *  - mark-inactive: deactivate each client exactly as "Delete client" does
 *    (isActive false, DEACTIVATE_CLIENT audit), behind the same PIN or
 *    password and the same `clients.delete` sensitive grant.
 * Portal invites are not bulk: an invite resets that client's portal password,
 * so it stays one client at a time behind its own confirmation.
 */
import { z } from "zod";

export const CLIENT_BULK_ACTIONS = ["send-update", "mark-inactive"] as const;
export type ClientBulkAction = (typeof CLIENT_BULK_ACTIONS)[number];
export const CLIENT_BULK_MAX_IDS = 100;

const securitySchema = z.object({ pin: z.string().max(64).optional(), password: z.string().max(256).optional() }).strict();

export const clientBulkSchema = z
  .object({
    action: z.enum(CLIENT_BULK_ACTIONS),
    ids: z.array(z.string().min(1).max(128)).min(1, "Select at least one client.").max(CLIENT_BULK_MAX_IDS, `Select at most ${CLIENT_BULK_MAX_IDS} clients at a time.`),
    subject: z.string().trim().max(200).optional(),
    message: z.string().trim().max(5000).optional(),
    security: securitySchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.action === "send-update" && (!value.subject || !value.message)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["message"], message: "Enter a subject and a message." });
    }
    if (value.action === "mark-inactive" && !value.security?.pin && !value.security?.password) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["security"], message: "Enter your PIN or password." });
    }
  });

export type ClientBulkRequest = z.infer<typeof clientBulkSchema>;
export type ClientBulkOutcome = "done" | "refused" | "unchanged";
export type ClientBulkResult = { id: string; outcome: ClientBulkOutcome; message: string };
export type ClientBulkResponse = { action: ClientBulkAction; results: ClientBulkResult[] };
