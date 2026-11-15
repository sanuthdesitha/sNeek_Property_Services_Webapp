// Temporary fixture script for visual inspection (removed afterwards). Usage: node <file> add|remove
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient({ datasources: { db: { url: "postgresql://sneek@127.0.0.1:55439/sneek_ui" } } });
const P = "gapb2-";
const mode = process.argv[2];
async function remove() {
  await db.qaIssue.deleteMany({ where: { id: { startsWith: P } } });
  await db.submissionMedia.deleteMany({ where: { id: { startsWith: P } } });
  await db.formSubmission.deleteMany({ where: { id: { startsWith: P } } });
  await db.clientAutomationRule.deleteMany({ where: { id: { startsWith: P } } });
  await db.messageTemplate.deleteMany({ where: { id: { startsWith: P } } });
  await db.reportTheme.deleteMany({ where: { id: { startsWith: P } } });
  await db.qaFormTemplate.deleteMany({ where: { id: { startsWith: P } } });
  await db.propertyChecklistProfile.deleteMany({ where: { id: { startsWith: P } } });
  await db.appSetting.deleteMany({ where: { key: { startsWith: "amenitiesSurvey:" }, createdAt: { gte: new Date(Date.now() - 6 * 3600e3) } } });
}
async function add() {
  await remove();
  const tpl = await db.formTemplate.findUnique({ where: { id: "cmwfl7arj00014uzk8jp7wn2o" } });
  const fields = tpl.schema.sections.flatMap((s) => s.fields ?? []).filter((f) => f.locationTag);
  const jobs = await db.job.findMany({ where: { property: { isActive: true } }, select: { id: true, propertyId: true }, take: 12 });
  const cleaner = await db.user.findFirst({ where: { role: "CLEANER" }, select: { id: true } });
  const admin = await db.user.findFirst({ where: { email: "admin@sneekproservices.com.au" }, select: { id: true } });
  let n = 0;
  for (const [i, job] of jobs.entries()) {
    const createdAt = new Date(Date.now() - (i * 3 + 1) * 86400e3);
    const data = { uploads: {} };
    for (const f of fields) {
      const r = (i * 7 + f.id.length) % 10;
      if (f.type === "yesno") { if (r < 8) data[f.id] = r !== 3; if (r === 3) data[`${f.id}_details`] = ["Out of degreaser", "Guest left food", "No access"][i % 3]; }
      else if (f.type === "photo") { if (r < 7) data.uploads[f.id] = Array.from({ length: 1 + (r % 3) }, (_, k) => `k/${i}/${f.id}/${k}`); }
      else if (r < 8) data[f.id] = "Ok";
    }
    const sub = await db.formSubmission.create({ data: { id: `${P}sub-${i}`, jobId: job.id, templateId: tpl.id, submittedById: cleaner.id, data, createdAt } });
    if (i % 3 === 0) {
      const media = await db.submissionMedia.create({ data: { id: `${P}m-${i}`, submissionId: sub.id, fieldId: "kitchen-benches-sink", mediaType: "PHOTO", url: "https://example.invalid/x.jpg", s3Key: `gapb2/${i}.jpg` } });
      await db.qaIssue.create({ data: { id: `${P}iss-${i}`, jobId: job.id, propertyId: job.propertyId, cleanerId: cleaner.id, raisedById: admin.id, category: "kitchen_detail", description: "Benches smeared", severity: "MINOR", cleanerMediaIds: [media.id], falseConfirmation: i === 0 ? "CONFIRMED" : "NONE", createdAt: new Date(createdAt.getTime() + 3600e3) } });
      n++;
    }
  }
  const client = await db.client.findFirst({ where: { id: "demo-client-001" } });
  const t = (id, name, category, channel, body, extra = {}) => db.messageTemplate.create({ data: { id: P + id, name, category, channel, body, subject: channel === "SMS" ? null : name, triggerType: "MANUAL", ...extra } });
  await t("booking", "Booking confirmed", "OPERATIONAL", "EMAIL", "Hi {{client.firstName}},\n\nYou're booked: {{job.scheduledFor | date short}} at {{job.scheduledFor | time}} for {{property.name}}.\nYour cleaner will be {{cleaner_name}}.\n\nReply to this email if anything changes.\n— sNeek");
  await t("ontheway", "Cleaner on the way", "OPERATIONAL", "SMS", "Hi {{client.firstName}}, your cleaner is on the way.");
  await t("quote", "Quote follow-up, day 1", "CHASE", "EMAIL", "Hi {{client.firstName}}, just following up on your quote of {{quote.totalAmount | currency}}.");
  await t("feedback", "How was the clean?", "FEEDBACK", "EMAIL", "Hi {{client_name}}, how did we go? {{feedback_url}}");
  await t("shift", "Shift available", "CLEANER_FACING", "SMS", "A shift is available tomorrow. Reply YES to take it.");
  await t("spring", "Spring deep clean, 20% off", "MARKETING", "EMAIL", "Hi {{client.firstName}}, 20% off a spring deep clean.", { isActive: false });
  await db.clientAutomationRule.create({ data: { id: P + "rule", clientId: client.id, triggerType: "POST_JOB_NEXT_CLEAN", templateId: P + "booking", delayMinutes: 120, isEnabled: true } });
  const layout = (template, photoSize) => ({ template, photoSize, density: "default", sections: [{ id: "header", visible: true, order: 0 }, { id: "summary", visible: true, order: 1 }, { id: "qa-summary", visible: true, order: 2 }, { id: "task-checklist", visible: true, order: 3 }, { id: "before-after-gallery", visible: true, order: 4 }, { id: "supplies", visible: false, order: 5 }, { id: "signature", visible: true, order: 6 }, { id: "footer", visible: true, order: 7 }] });
  await db.reportTheme.create({ data: { id: P + "estate", name: "Estate", kind: "CUSTOM", isDefault: true, layout: layout("estate", "medium"), primaryColorHsl: "158 42% 20%", accentColorHsl: "41 42% 57%", titleTemplate: "Report: {{property.name}}, {{job.scheduledFor | date short}}", footerHtml: "sNeek Property Services · hello@sneek.au" } });
  await db.reportTheme.create({ data: { id: P + "compact", name: "Compact", kind: "COMPACT", layout: layout("classic", "small"), primaryColorHsl: "158 42% 20%", accentColorHsl: "38 15% 80%" } });
  await db.reportTheme.create({ data: { id: P + "old", name: "Old classic (v1)", kind: "CUSTOM", isActive: false, layout: layout("classic", "medium") } });
  const qa = await db.qaFormTemplate.findUnique({ where: { id: "gapb1-tpl" } });
  await db.qaFormTemplate.create({ data: { id: P + "qa-a", name: "Deep clean QA", serviceType: "DEEP_CLEAN", version: 3, schema: qa.schema } });
  await db.qaFormTemplate.create({ data: { id: P + "qa-b", name: "Deep clean QA, detailed", serviceType: "DEEP_CLEAN", version: 1, schema: qa.schema } });
  const props = await db.property.findMany({ where: { isActive: true, checklistProfile: null }, select: { id: true }, take: 2 });
  if (props[0]) await db.propertyChecklistProfile.create({ data: { id: P + "cp1", propertyId: props[0].id, selections: {}, status: "DRAFT" } });
  if (props[1]) await db.propertyChecklistProfile.create({ data: { id: P + "cp2", propertyId: props[1].id, selections: {}, status: "STALE", approvedAt: new Date("2026-10-13") } });
  console.log("added", jobs.length, "submissions", n, "issues");
}
if (mode === "add") await add(); else await remove();
await db.$disconnect();
