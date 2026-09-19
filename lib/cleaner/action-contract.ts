import { z } from "zod";
export const CLEANER_ACTIONS = ["gps-checkin", "start", "stop", "clock-out-early", "assignment-response", "submit", "laundry-status"] as const;
export type CleanerAction = typeof CLEANER_ACTIONS[number];
export const actionResultSchema = z.object({ status: z.number().int().min(200).max(599), body: z.record(z.unknown()) }).strict()
  .refine(value => value.status < 300 ? value.body.ok === true : typeof value.body.error === "string");
export const recoveredActionSchema = z.object({ ok: z.literal(true), state: z.enum(["COMMITTED", "CANCELLED"]), result: actionResultSchema }).strict()
  .refine(value => value.state !== "CANCELLED" || value.result.status === 409);
const admission = { version: z.literal(1), label: z.string().min(1).max(100), requestId: z.string().uuid(), scope: z.string().min(1) };
export const pendingActionSchema = z.discriminatedUnion("phase", [
  z.object({ ...admission, phase: z.literal("ADMITTED") }).strict(),
  z.object({ ...admission, phase: z.literal("DISPATCHED"), action: z.enum(CLEANER_ACTIONS), input: z.record(z.unknown()),
    jobId: z.string().min(1).max(200).regex(/^[^/]+$/), identity: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
]);
export type PendingAction = z.infer<typeof pendingActionSchema>;
