import { db } from "@/lib/db";

interface StoredValue<T> {
  version: number;
  data: T;
}

export async function readSettingStore<T>(
  key: string,
  fallback: T,
  sanitize: (input: unknown, fallbackValue: T) => T
): Promise<StoredValue<T>> {
  const row = await db.appSetting.findUnique({ where: { key } });
  const raw = row?.value;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { version: 1, data: fallback };
  }
  const record = raw as Record<string, unknown>;
  const versionRaw = Number(record.version);
  const version = Number.isFinite(versionRaw) && versionRaw > 0 ? Math.floor(versionRaw) : 1;
  return {
    version,
    data: sanitize(record.data, fallback),
  };
}

export async function writeSettingStore<T>(key: string, payload: StoredValue<T>) {
  await db.appSetting.upsert({
    where: { key },
    create: { key, value: payload as any },
    update: { value: payload as any },
  });
  return payload;
}
