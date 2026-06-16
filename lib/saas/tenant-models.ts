/**
 * Tenant-isolation model registry — the single source of truth for which Prisma
 * models are scoped to an organization and which are global.
 *
 * Design = fail-closed:
 *  - Every model must be classified in exactly ONE of the two sets below.
 *  - `assertRegistryComplete()` (exercised by a unit test) compares these sets
 *    against Prisma's DMMF, so adding a new model to the schema FAILS CI until
 *    it is consciously classified here. A forgotten model can never silently
 *    become a cross-tenant leak.
 *
 * TENANT_OWNED_MODELS will each receive an `organizationId` column in the Phase
 * 1b migration (denormalized onto child tables too, so direct queries are safe
 * and Postgres RLS can backstop them). GLOBAL_MODELS never get one.
 */

/** Models intentionally NOT scoped by organization. */
export const GLOBAL_MODELS = new Set<string>([
  // NextAuth / authentication infrastructure (a login is global; org membership
  // is resolved from User.organizationId after authentication).
  "Account",
  "Session",
  "VerificationToken",
  "WebAuthnCredential",
  // User is a global identity (unique email, can sign in before org is resolved).
  // It carries organizationId for membership, but is excluded from the auto-WHERE
  // because auth lookups (by email/id) must not be org-filtered. Admin user
  // listings scope by organizationId explicitly.
  "User",
  // SaaS platform tables (the tenancy spine itself).
  "Organization",
  "Plan",
  "Subscription",
]);

/**
 * Models scoped to a single organization. Each gets an `organizationId` column.
 * Child/line tables are included (denormalized) so list/where queries that hit
 * them directly are isolated and not just reachable-via-parent.
 */
export const TENANT_OWNED_MODELS = new Set<string>([
  // Core business
  "Client",
  "Property",
  "Job",
  "Reservation",
  "JobAssignment",
  "TimeLog",
  "TimeLogAdjustmentRequest",
  "CleanerPayAdjustment",
  "CleanerAvailability",
  "CleanerLocationPing",
  // Forms / QA / evidence
  "FormTemplate",
  "FormSubmission",
  "SubmissionMedia",
  "QAReview",
  "QaFormTemplate",
  "QaAssignment",
  "QaReworkTransfer",
  "QaFormSubmission",
  "MediaOverrideRequest",
  "Report",
  "ReportTheme",
  // Cases / tasks
  "IssueTicket",
  "CaseTransition",
  "CaseComment",
  "CaseAttachment",
  "JobTask",
  "JobTaskAttachment",
  "JobTaskEvent",
  // Inventory / shopping / laundry
  "InventoryItem",
  "PropertyStock",
  "StockTx",
  "StockRun",
  "StockRunLine",
  "ShoppingRun",
  "ShoppingRunLine",
  "ShoppingReceipt",
  "ShoppingSettlement",
  "LaundryTask",
  "LaundryConfirmation",
  "LaundrySupplier",
  // Maintenance
  "PropertyMaintenanceItem",
  "PropertyMaintenanceEvent",
  // Pricing / quoting / billing of THEIR clients
  "PriceBook",
  "DiscountCampaign",
  "SubscriptionPlan",
  "PropertyClientRate",
  "QuoteLead",
  "Quote",
  "ClientInvoice",
  "ClientInvoiceLine",
  "ClientPayment",
  "PaymentGateway",
  "PayrollRun",
  "Payout",
  // Marketing / engagement
  "BlogPost",
  "ClientSatisfactionRating",
  "LoyaltyAccount",
  "LoyaltyTransaction",
  "Referral",
  "ClientMessage",
  "EmailCampaign",
  "MarketingAsset",
  "SocialPost",
  "SocialPostAsset",
  "JobFeedback",
  // Messaging / notifications (per-org config + logs)
  "Notification",
  "NotificationTemplate",
  "NotificationPreference",
  "NotificationLog",
  "MessageTemplate",
  "ClientAutomationRule",
  "UserNotificationPreference",
  "ClientNotificationPreference",
  "UserPushDevice",
  "PushSubscription",
  // Team / workforce / hiring / learning
  "TeamGroup",
  "TeamGroupMember",
  "WorkforcePost",
  "WorkforcePostRead",
  "ChatChannel",
  "ChatMessage",
  "ChatChannelRead",
  "LearningPath",
  "LearningAssignment",
  "StaffDocument",
  "StaffDocumentRequest",
  "StaffRecognition",
  "HiringPosition",
  "HiringApplication",
  "UserInvitation",
  // Onboarding
  "PropertyOnboardingSurvey",
  "OnboardingAppliance",
  "OnboardingSpecialRequest",
  "OnboardingLaundryDetail",
  "OnboardingAccessDetail",
  "OnboardingJobTypeAnswer",
  // Integrations (per-org credentials/state)
  "Integration",
  "IcalSyncRun",
  "XeroConnection",
  // Config + audit + ops logs (per-org)
  "AppSetting",
  "AuditLog",
  "UploadFailure",
  "GeocodeFailure",
]);

/** True when this model should be auto-scoped by organizationId. */
export function isTenantOwned(model: string | undefined | null): boolean {
  return !!model && TENANT_OWNED_MODELS.has(model);
}

/**
 * Verify every Prisma model is classified exactly once. Call from a unit test
 * with the model names from `Prisma.dmmf.datamodel.models`. Returns the problems
 * (empty array = registry is complete and non-overlapping).
 */
export function findRegistryGaps(allModelNames: string[]): {
  unclassified: string[];
  overlapping: string[];
  unknownInRegistry: string[];
} {
  const all = new Set(allModelNames);
  const unclassified = allModelNames.filter(
    (m) => !GLOBAL_MODELS.has(m) && !TENANT_OWNED_MODELS.has(m)
  );
  const overlapping = allModelNames.filter(
    (m) => GLOBAL_MODELS.has(m) && TENANT_OWNED_MODELS.has(m)
  );
  const unknownInRegistry = Array.from(GLOBAL_MODELS)
    .concat(Array.from(TENANT_OWNED_MODELS))
    .filter((m) => !all.has(m));
  return { unclassified, overlapping, unknownInRegistry };
}
