export type ConfirmationTier = "routine" | "highRisk";

export type ConfirmationActionKey =
  | "deleteJob"
  | "resetJob"
  | "deleteCase"
  | "deleteReport"
  | "deactivateFormTemplate"
  | "deactivateClient"
  | "deactivateProperty"
  | "resetUserPassword"
  | "discardStockRun"
  | "clearNotificationLog"
  | "deleteLaundryTask"
  | "deleteQuote"
  | "deleteUserAccount"
  | "sendClientInvite"
  | "deactivateUserAccount"
  | "deleteSupplier"
  | "deleteShoppingRun"
  | "deleteCampaign"
  | "deleteSubscriptionPlan"
  | "deleteBlogPost"
  | "deleteInvoice";

export interface ConfirmationPolicy {
  tier: ConfirmationTier;
  confirmPhrase?: string;
}

const CONFIRMATION_POLICIES: Record<ConfirmationActionKey, ConfirmationPolicy> = {
  deleteJob: { tier: "routine" },
  resetJob: { tier: "routine" },
  deleteCase: { tier: "routine" },
  deleteReport: { tier: "routine" },
  deactivateFormTemplate: { tier: "routine" },
  deactivateClient: { tier: "routine" },
  deactivateProperty: { tier: "routine" },
  resetUserPassword: { tier: "routine" },
  discardStockRun: { tier: "routine" },
  clearNotificationLog: { tier: "routine" },
  deleteLaundryTask: { tier: "routine" },
  deleteQuote: { tier: "routine" },
  sendClientInvite: { tier: "routine" },
  deactivateUserAccount: { tier: "routine" },
  deleteSupplier: { tier: "routine" },
  deleteShoppingRun: { tier: "routine" },
  deleteCampaign: { tier: "routine" },
  deleteSubscriptionPlan: { tier: "routine" },
  deleteBlogPost: { tier: "routine" },
  deleteInvoice: { tier: "routine" },
  deleteUserAccount: { tier: "highRisk", confirmPhrase: "DELETE" },
};

export function getConfirmationPolicy(actionKey?: ConfirmationActionKey): ConfirmationPolicy | null {
  if (!actionKey) return null;
  return CONFIRMATION_POLICIES[actionKey] ?? null;
}
