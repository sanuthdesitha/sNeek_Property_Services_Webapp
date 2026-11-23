import { db } from "@/lib/db";
import { canUseNodePrisma } from "@/lib/database-runtime";
import { cleanXeroAccountCode, isValidXeroAccountCode } from "@/lib/xero/cleaner-bill-accounts";

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
    /**
     * Sales account of client invoices (Settings › Money › Xero › Client
     * invoices). Empty means not chosen, and pushes, credit notes, Update in
     * Xero and CSV exports are refused (lib/xero/client-invoice-accounts.ts).
     * Before 2026-11-23 it defaulted to "200" and every save wrote that back,
     * so a stored "200" is kept working but shown as "confirm or change".
     */
    defaultAccountCode: string;
    /** True once the sales account was saved from the Client invoices card (or changed deliberately). */
    defaultAccountCodeConfirmed: boolean;
    /** Repairs the client covers (MAINTENANCE lines); empty uses the sales account. */
    clientRepairsAccountCode: string;
    /** Shopping recharged to the client and shopping time; empty uses the sales account. */
    clientShoppingAccountCode: string;
    /** Every line of a credit note except agency disbursements; empty keeps each line on its kind's account. */
    clientCreditNoteAccountCode: string;
    disbursementAccountCode: string;
    /** Xero inventory Item code applied to invoice lines (the "item number"). */
    defaultItemCode: string;
    /** Per-service item codes, keyed by JobType (falls back to defaultItemCode). */
    itemCodeByService: Record<string, string>;
    /** Optional sales TaxType override (e.g. OUTPUT2 for AU GST on Income). Blank = auto. */
    salesTaxType: string;
    trackingCategory: string;
    contactFallbackEmail: string;
    /**
     * Expense account of cleaner (payee) bills: cleaning work. Empty means not
     * chosen, and the bill push is refused (lib/xero/cleaner-bill-accounts.ts).
     */
    cleanerBillAccountCode: string;
    /** QA inspection lines; empty uses cleanerBillAccountCode (said on screen). */
    cleanerBillInspectionAccountCode: string;
    /** Reimbursement lines (shopping, parking, receipts); empty uses cleanerBillAccountCode. */
    cleanerBillReimbursementAccountCode: string;
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
    // Never defaulted (2026-11-23): an account is chosen in Settings or the push is refused.
    defaultAccountCode: "",
    defaultAccountCodeConfirmed: false,
    clientRepairsAccountCode: "",
    clientShoppingAccountCode: "",
    clientCreditNoteAccountCode: "",
    disbursementAccountCode: "",
    defaultItemCode: "",
    itemCodeByService: {},
    salesTaxType: "",
    trackingCategory: "Branch",
    contactFallbackEmail: "",
    cleanerBillAccountCode: "",
    cleanerBillInspectionAccountCode: "",
    cleanerBillReimbursementAccountCode: "",
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

/** Keep only string→non-empty-string entries; cap keys + value length. */
function sanitizeItemCodeMap(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, string> = {};
  let count = 0;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (count >= 100) break;
    if (typeof value !== "string") continue;
    const code = value.trim().slice(0, 30);
    if (!code) continue;
    out[String(key).trim().slice(0, 60)] = code;
    count += 1;
  }
  return out;
}

/** A stored Xero account code, or "" when absent or unreadable (the route refuses an invalid one). */
function storedAccountCode(value: unknown): string {
  const code = cleanXeroAccountCode(value);
  return isValidXeroAccountCode(code) ? code : "";
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
      // Kept as stored (an existing value keeps working); an empty one stays
      // empty and is never turned back into "200".
      defaultAccountCode:
        typeof xeroRaw.defaultAccountCode === "string" ? xeroRaw.defaultAccountCode.trim().slice(0, 32) : "",
      defaultAccountCodeConfirmed: xeroRaw.defaultAccountCodeConfirmed === true,
      clientRepairsAccountCode: storedAccountCode(xeroRaw.clientRepairsAccountCode),
      clientShoppingAccountCode: storedAccountCode(xeroRaw.clientShoppingAccountCode),
      clientCreditNoteAccountCode: storedAccountCode(xeroRaw.clientCreditNoteAccountCode),
      defaultItemCode:
        typeof xeroRaw.defaultItemCode === "string" ? xeroRaw.defaultItemCode.trim().slice(0, 30) : "",
      disbursementAccountCode: typeof xeroRaw.disbursementAccountCode === "string" ? xeroRaw.disbursementAccountCode.trim().slice(0, 32) : "",
      itemCodeByService: sanitizeItemCodeMap(xeroRaw.itemCodeByService),
      salesTaxType:
        typeof xeroRaw.salesTaxType === "string" ? xeroRaw.salesTaxType.trim().toUpperCase().slice(0, 50) : "",
      trackingCategory:
        typeof xeroRaw.trackingCategory === "string" && xeroRaw.trackingCategory.trim()
          ? xeroRaw.trackingCategory.trim().slice(0, 100)
          : DEFAULT_PHASE3_INTEGRATIONS.xero.trackingCategory,
      contactFallbackEmail:
        typeof xeroRaw.contactFallbackEmail === "string"
          ? xeroRaw.contactFallbackEmail.trim().toLowerCase().slice(0, 200)
          : "",
      // Kept only when it is a readable Xero account code; never defaulted.
      cleanerBillAccountCode: storedAccountCode(xeroRaw.cleanerBillAccountCode),
      cleanerBillInspectionAccountCode: storedAccountCode(xeroRaw.cleanerBillInspectionAccountCode),
      cleanerBillReimbursementAccountCode: storedAccountCode(xeroRaw.cleanerBillReimbursementAccountCode),
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

/**
 * Whether the stored sales account counts as chosen after a save. Saving it
 * from the Client invoices card (`defaultAccountCodeConfirmed: true`) or
 * changing it to another code confirms it; a save that re-sends the same code
 * (another card, the older settings screen) leaves the flag as it was; an
 * empty code is never confirmed.
 */
export function nextSalesAccountConfirmed(
  current: Pick<Phase3IntegrationsSettings["xero"], "defaultAccountCode" | "defaultAccountCodeConfirmed">,
  patch: Phase3IntegrationsPatch["xero"],
  nextCode: string,
): boolean {
  if (!nextCode) return false;
  if (patch?.defaultAccountCodeConfirmed === true) return true;
  if (patch && "defaultAccountCode" in patch && nextCode !== current.defaultAccountCode) return true;
  return current.defaultAccountCodeConfirmed;
}

export async function savePhase3IntegrationsSettings(
  patch: Phase3IntegrationsPatch
) {
  const current = await getPhase3IntegrationsSettings();
  const merged = sanitize({
    ...current,
    ...patch,
    stripe: patch.stripe ? { ...current.stripe, ...patch.stripe } : current.stripe,
    xero: patch.xero ? { ...current.xero, ...patch.xero } : current.xero,
    googlePlaces: patch.googlePlaces
      ? { ...current.googlePlaces, ...patch.googlePlaces }
      : current.googlePlaces,
  });
  const next: Phase3IntegrationsSettings = {
    ...merged,
    xero: {
      ...merged.xero,
      defaultAccountCodeConfirmed: nextSalesAccountConfirmed(current.xero, patch.xero, merged.xero.defaultAccountCode),
    },
  };

  await db.appSetting.upsert({
    where: { key: INTEGRATIONS_KEY },
    create: { key: INTEGRATIONS_KEY, value: next as any },
    update: { value: next as any },
  });

  return next;
}
