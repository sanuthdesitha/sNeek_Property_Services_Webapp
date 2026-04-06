import { db } from "@/lib/db";
import { canUseNodePrisma } from "@/lib/database-runtime";

const INTEGRATIONS_KEY = "phase3_integrations_v1";

export interface Phase3IntegrationsSettings {
  stripe: {
    enabled: boolean;
    currency: string;
    successUrl: string;
    cancelUrl: string;
    statementDescriptor: string;
  };
  xero: {
    enabled: boolean;
    tenantId: string;
    defaultAccountCode: string;
    trackingCategory: string;
    contactFallbackEmail: string;
  };
  googlePlaces: {
    placeId: string;
  };
}

export interface Phase3IntegrationsPatch {
  stripe?: Partial<Phase3IntegrationsSettings["stripe"]>;
  xero?: Partial<Phase3IntegrationsSettings["xero"]>;
  googlePlaces?: Partial<Phase3IntegrationsSettings["googlePlaces"]>;
}

export const DEFAULT_PHASE3_INTEGRATIONS: Phase3IntegrationsSettings = {
  stripe: {
    enabled: false,
    currency: "aud",
    successUrl: "",
    cancelUrl: "",
    statementDescriptor: "SNEEK SERVICES",
  },
  xero: {
    enabled: false,
    tenantId: "",
    defaultAccountCode: "200",
    trackingCategory: "Branch",
    contactFallbackEmail: "",
  },
  googlePlaces: {
    placeId: "",
  },
};

function sanitizeUrl(value: unknown) {
  if (typeof value !== "string") return "";
  const url = value.trim();
  if (!url) return "";
  try {
    // Throws for invalid URLs.
    new URL(url);
    return url;
  } catch {
    return "";
  }
}

function sanitize(input: unknown): Phase3IntegrationsSettings {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return DEFAULT_PHASE3_INTEGRATIONS;
  }
  const row = input as Record<string, unknown>;
  const stripeRaw =
    row.stripe && typeof row.stripe === "object" && !Array.isArray(row.stripe)
      ? (row.stripe as Record<string, unknown>)
      : {};
  const xeroRaw =
    row.xero && typeof row.xero === "object" && !Array.isArray(row.xero)
      ? (row.xero as Record<string, unknown>)
      : {};
  const googlePlacesRaw =
    row.googlePlaces && typeof row.googlePlaces === "object" && !Array.isArray(row.googlePlaces)
      ? (row.googlePlaces as Record<string, unknown>)
      : {};

  return {
    stripe: {
      enabled: stripeRaw.enabled === true,
      currency:
        typeof stripeRaw.currency === "string" && stripeRaw.currency.trim()
          ? stripeRaw.currency.trim().toLowerCase().slice(0, 8)
          : DEFAULT_PHASE3_INTEGRATIONS.stripe.currency,
      successUrl: sanitizeUrl(stripeRaw.successUrl),
      cancelUrl: sanitizeUrl(stripeRaw.cancelUrl),
      statementDescriptor:
        typeof stripeRaw.statementDescriptor === "string" && stripeRaw.statementDescriptor.trim()
          ? stripeRaw.statementDescriptor.trim().slice(0, 22).toUpperCase()
          : DEFAULT_PHASE3_INTEGRATIONS.stripe.statementDescriptor,
    },
    xero: {
      enabled: xeroRaw.enabled === true,
      tenantId:
        typeof xeroRaw.tenantId === "string" ? xeroRaw.tenantId.trim().slice(0, 200) : "",
      defaultAccountCode:
        typeof xeroRaw.defaultAccountCode === "string" && xeroRaw.defaultAccountCode.trim()
          ? xeroRaw.defaultAccountCode.trim().slice(0, 32)
          : DEFAULT_PHASE3_INTEGRATIONS.xero.defaultAccountCode,
      trackingCategory:
        typeof xeroRaw.trackingCategory === "string" && xeroRaw.trackingCategory.trim()
          ? xeroRaw.trackingCategory.trim().slice(0, 100)
          : DEFAULT_PHASE3_INTEGRATIONS.xero.trackingCategory,
      contactFallbackEmail:
        typeof xeroRaw.contactFallbackEmail === "string"
          ? xeroRaw.contactFallbackEmail.trim().toLowerCase().slice(0, 200)
          : "",
    },
    googlePlaces: {
      placeId:
        typeof googlePlacesRaw.placeId === "string"
          ? googlePlacesRaw.placeId.trim().slice(0, 300)
          : "",
    },
  };
}

export async function getPhase3IntegrationsSettings() {
  if (!canUseNodePrisma()) {
    return DEFAULT_PHASE3_INTEGRATIONS;
  }

  try {
    const row = await db.appSetting.findUnique({ where: { key: INTEGRATIONS_KEY } });
    return sanitize(row?.value);
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[phase3/integrations] Falling back to defaults:", error);
    }
    return DEFAULT_PHASE3_INTEGRATIONS;
  }
}

export async function savePhase3IntegrationsSettings(
  patch: Phase3IntegrationsPatch
) {
  const current = await getPhase3IntegrationsSettings();
  const next = sanitize({
    ...current,
    ...patch,
    stripe: patch.stripe ? { ...current.stripe, ...patch.stripe } : current.stripe,
    xero: patch.xero ? { ...current.xero, ...patch.xero } : current.xero,
    googlePlaces: patch.googlePlaces
      ? { ...current.googlePlaces, ...patch.googlePlaces }
      : current.googlePlaces,
  });

  await db.appSetting.upsert({
    where: { key: INTEGRATIONS_KEY },
    create: { key: INTEGRATIONS_KEY, value: next as any },
    update: { value: next as any },
  });

  return next;
}
