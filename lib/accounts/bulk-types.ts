/** Accounts bulk request contract. Pure; shared by the route and the screen. */
import { z } from "zod";
import { payRateSchema } from "./pay-rate-rules";

export const ACCOUNT_BULK_ACTIONS = ["resend-invite", "disable", "change-rate"] as const;
export type AccountBulkAction = (typeof ACCOUNT_BULK_ACTIONS)[number];
export const ACCOUNT_BULK_MAX_IDS = 100;

/** Actions only an ADMIN may run. */
export const ADMIN_ONLY_BULK_ACTIONS: ReadonlySet<AccountBulkAction> = new Set<AccountBulkAction>(["disable", "change-rate"]);

export const accountBulkSchema = z
  .object({
    action: z.enum(ACCOUNT_BULK_ACTIONS),
    ids: z.array(z.string().min(1).max(128)).min(1, "Select at least one person.").max(ACCOUNT_BULK_MAX_IDS, `Select at most ${ACCOUNT_BULK_MAX_IDS} people at a time.`),
    hourlyRate: payRateSchema.shape.hourlyRate.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.action === "change-rate" && value.hourlyRate === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["hourlyRate"], message: "Enter the new hourly rate." });
    }
  });

export type AccountBulkRequest = z.infer<typeof accountBulkSchema>;
export type AccountBulkOutcome = "done" | "refused" | "unchanged";
export type AccountBulkResult = { id: string; outcome: AccountBulkOutcome; message: string };
export type AccountBulkResponse = { action: AccountBulkAction; results: AccountBulkResult[] };
