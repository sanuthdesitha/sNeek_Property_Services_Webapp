import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function qaEffectFingerprint(value: unknown) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
/** Caller holds the job lock; receipt and business write must share its transaction. */
export async function applyQaToolEffect<T extends Prisma.InputJsonValue>(tx: Prisma.TransactionClient, jobId: string, sourceId: string, payload: unknown, apply: () => Promise<T>, legacyAction = false): Promise<T> {
  const key = `qa_tool_effect_v1:${jobId}:${qaEffectFingerprint(sourceId)}`;
  const fingerprint = qaEffectFingerprint(payload);
  const previous = await tx.appSetting.findUnique({ where: { key } });
  if (previous) {
    const receipt = previous.value as { fingerprint: string; result: T };
    if (receipt.fingerprint !== fingerprint) throw new Error("This QA action already created a linked case or stock request. Correct that record directly before changing the QA action.");
    return receipt.result;
  }
  if (legacyAction) throw new Error("This earlier QA action has no reliable linked-record receipt. Review its existing case or stock request before resubmitting it.");
  const result = await apply();
  await tx.appSetting.create({ data: { key, value: { fingerprint, result } as Prisma.InputJsonValue } });
  return result;
}
