import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
const key = "ai_ollama_setup_operation_v1";
/** A short DB lease prevents simultaneous setup work across web replicas. No long DB transaction. */
export async function acquireOllamaOperation(milliseconds: number) {
  const token = randomUUID();
  await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    const row = await tx.appSetting.findUnique({ where: { key } });
    const current = row?.value as { expires?: number } | undefined;
    if (current?.expires && current.expires > Date.now()) throw new Error("OLLAMA_BUSY");
    const value = { token, expires: Date.now() + milliseconds };
    await tx.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  });
  return async () => { await db.appSetting.deleteMany({ where: { key, value: { path: ["token"], equals: token } } }); };
}
