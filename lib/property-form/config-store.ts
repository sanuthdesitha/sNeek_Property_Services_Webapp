import "server-only";
import { db } from "@/lib/db";
import {
  EMPTY_PROPERTY_FORM_CONFIG,
  PROPERTY_FORM_CONFIG_KEY,
  sanitizePropertyFormConfig,
  type PropertyFormConfig,
} from "./config";

// DB read/write for the propertyFormConfig AppSetting. Split out of ./config so
// that module stays client-bundle-safe (it's imported by client components).

export async function getPropertyFormConfig(): Promise<PropertyFormConfig> {
  const row = await db.appSetting.findUnique({ where: { key: PROPERTY_FORM_CONFIG_KEY } });
  if (!row?.value) return EMPTY_PROPERTY_FORM_CONFIG;
  return sanitizePropertyFormConfig(row.value);
}

export async function savePropertyFormConfig(input: unknown): Promise<PropertyFormConfig> {
  const config = sanitizePropertyFormConfig(input);
  await db.appSetting.upsert({
    where: { key: PROPERTY_FORM_CONFIG_KEY },
    create: { key: PROPERTY_FORM_CONFIG_KEY, value: config as any },
    update: { value: config as any },
  });
  return config;
}
