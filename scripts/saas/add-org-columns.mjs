// One-shot generator for the Phase 1b organizationId column rollout.
//
// Adds a NULLABLE `organizationId` scalar + `@@index([organizationId])` to every
// tenant-owned model in prisma/schema.prisma, and emits a matching migration.sql
// (ADD COLUMN + index + FK per table). Nullable + additive, so applying it does
// not break existing rows — enforcement stays OFF (SNEEK_MULTITENANCY) until the
// 2-tenant leak audit passes.
//
// We add a plain scalar (no Prisma relation) to avoid ~95 back-relation fields on
// Organization; the FK is created in raw SQL. The auto-scoping middleware only
// needs the column.
//
// Run: node scripts/saas/add-org-columns.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SCHEMA = path.join(ROOT, "prisma", "schema.prisma");

// Must match TENANT_OWNED_MODELS in lib/saas/tenant-models.ts (guarded by the
// registry completeness test).
const TENANT_MODELS = [
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

const src = fs.readFileSync(SCHEMA, "utf8");
const lines = src.split(/\r?\n/);

const out = [];
let i = 0;
let touched = 0;
const skipped = [];

while (i < lines.length) {
  const line = lines[i];
  const m = line.match(/^model\s+(\w+)\s*\{/);
  if (!m || !TENANT_MODELS.includes(m[1])) {
    out.push(line);
    i++;
    continue;
  }
  // Capture the whole model block.
  const modelName = m[1];
  const block = [line];
  i++;
  while (i < lines.length && !/^\}/.test(lines[i])) {
    block.push(lines[i]);
    i++;
  }
  const closing = lines[i]; // the `}`
  i++;

  const body = block.join("\n");
  if (/^\s*organizationId\s/m.test(body)) {
    skipped.push(modelName);
    out.push(body, closing);
    continue;
  }

  // Insert the field right after the model declaration line, and the index just
  // before the closing brace.
  const newBlock = [block[0], "  organizationId String?", ...block.slice(1)];
  newBlock.push("  @@index([organizationId])");
  out.push(newBlock.join("\n"), closing);
  touched++;
}

fs.writeFileSync(SCHEMA, out.join("\n"), "utf8");

// Emit migration SQL.
const stamp = "20260617020000_tenant_organization_id_rollout";
const dir = path.join(ROOT, "prisma", "migrations", stamp);
fs.mkdirSync(dir, { recursive: true });
const sql = [
  "-- Phase 1b: add nullable organizationId to every tenant-owned model.",
  "-- Additive + nullable → safe on a live single-tenant DB. Backfill to Org #1",
  "-- and set NOT NULL in a follow-up migration after the leak audit.",
  "",
];
for (const model of TENANT_MODELS) {
  sql.push(`ALTER TABLE "${model}" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;`);
  sql.push(`CREATE INDEX IF NOT EXISTS "${model}_organizationId_idx" ON "${model}"("organizationId");`);
  sql.push(
    `ALTER TABLE "${model}" ADD CONSTRAINT "${model}_organizationId_fkey" ` +
      `FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;`
  );
  sql.push("");
}
fs.writeFileSync(path.join(dir, "migration.sql"), sql.join("\n"), "utf8");

console.log(`Added organizationId to ${touched} models; skipped ${skipped.length} (already had it): ${skipped.join(", ") || "none"}`);
console.log(`Migration written to prisma/migrations/${stamp}/migration.sql`);
