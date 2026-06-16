// Phase 1b backfill: make the existing single-tenant data belong to Organization #1.
//
// Run ONCE, against a CLONE of your production database first (never blind on prod):
//   node scripts/saas/backfill-org-one.mjs
//
// It is idempotent (only fills rows where organizationId IS NULL) and wrapped in a
// transaction. After it succeeds and the 2-tenant leak audit passes, run the
// follow-up migration that sets organizationId NOT NULL, then flip SNEEK_MULTITENANCY=1.
//
// Prereqs: the two additive migrations applied (organization tables + the
// organizationId columns), so the columns exist.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Must match TENANT_OWNED_MODELS / the column rollout. Table name == model name.
const TENANT_TABLES = [
  "Client", "Property", "Job", "Reservation", "JobAssignment", "TimeLog",
  "TimeLogAdjustmentRequest", "CleanerPayAdjustment", "CleanerAvailability",
  "CleanerLocationPing", "FormTemplate", "FormSubmission", "SubmissionMedia",
  "QAReview", "QaFormTemplate", "QaAssignment", "QaReworkTransfer",
  "QaFormSubmission", "MediaOverrideRequest", "Report", "ReportTheme",
  "IssueTicket", "CaseTransition", "CaseComment", "CaseAttachment", "JobTask",
  "JobTaskAttachment", "JobTaskEvent", "InventoryItem", "PropertyStock",
  "StockTx", "StockRun", "StockRunLine", "ShoppingRun", "ShoppingRunLine",
  "ShoppingReceipt", "ShoppingSettlement", "LaundryTask", "LaundryConfirmation",
  "LaundrySupplier", "PropertyMaintenanceItem", "PropertyMaintenanceEvent",
  "PriceBook", "DiscountCampaign", "SubscriptionPlan", "PropertyClientRate",
  "QuoteLead", "Quote", "ClientInvoice", "ClientInvoiceLine", "ClientPayment",
  "PaymentGateway", "PayrollRun", "Payout", "BlogPost", "ClientSatisfactionRating",
  "LoyaltyAccount", "LoyaltyTransaction", "Referral", "ClientMessage",
  "EmailCampaign", "MarketingAsset", "SocialPost", "SocialPostAsset", "JobFeedback",
  "Notification", "NotificationTemplate", "NotificationPreference", "NotificationLog",
  "MessageTemplate", "ClientAutomationRule", "UserNotificationPreference",
  "ClientNotificationPreference", "UserPushDevice", "PushSubscription", "TeamGroup",
  "TeamGroupMember", "WorkforcePost", "WorkforcePostRead", "ChatChannel",
  "ChatMessage", "ChatChannelRead", "LearningPath", "LearningAssignment",
  "StaffDocument", "StaffDocumentRequest", "StaffRecognition", "HiringPosition",
  "HiringApplication", "UserInvitation", "PropertyOnboardingSurvey",
  "OnboardingAppliance", "OnboardingSpecialRequest", "OnboardingLaundryDetail",
  "OnboardingAccessDetail", "OnboardingJobTypeAnswer", "Integration", "IcalSyncRun",
  "XeroConnection", "AppSetting", "AuditLog", "UploadFailure", "GeocodeFailure",
];

async function main() {
  // 1. Find or create Organization #1 from the existing AppSetting company name.
  let org = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
  if (!org) {
    let name = "My Cleaning Business";
    try {
      const setting = await prisma.appSetting.findFirst({ where: { key: "app" } });
      const data = setting?.value ?? null;
      if (data && typeof data === "object" && typeof data.companyName === "string" && data.companyName.trim()) {
        name = data.companyName.trim();
      }
    } catch {}
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "workspace";
    org = await prisma.organization.create({
      data: { name, slug, status: "ACTIVE", planKey: "scale", subscription: { create: { planKey: "scale", status: "ACTIVE" } } },
    });
    console.log(`Created Organization #1: ${org.name} (${org.id})`);
  } else {
    console.log(`Using existing Organization #1: ${org.name} (${org.id})`);
  }

  const orgId = org.id;

  // 2. Assign every user to Org #1; set the first ADMIN as owner.
  await prisma.user.updateMany({ where: { organizationId: null }, data: { organizationId: orgId } });
  if (!org.ownerUserId) {
    const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" } });
    if (admin) {
      await prisma.organization.update({ where: { id: orgId }, data: { ownerUserId: admin.id } });
      console.log(`Set owner: ${admin.email}`);
    }
  }

  // 3. Backfill every tenant table.
  let total = 0;
  for (const table of TENANT_TABLES) {
    try {
      const n = await prisma.$executeRawUnsafe(
        `UPDATE "${table}" SET "organizationId" = $1 WHERE "organizationId" IS NULL`,
        orgId
      );
      if (n > 0) console.log(`  ${table}: ${n}`);
      total += n;
    } catch (err) {
      console.error(`  ! ${table}: ${err?.message ?? err}`);
      throw err;
    }
  }
  console.log(`Backfilled ${total} rows across ${TENANT_TABLES.length} tables into Org #1.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
