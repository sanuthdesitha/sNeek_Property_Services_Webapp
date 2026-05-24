import { PrismaClient } from "@prisma/client";
import { SEED_MESSAGE_TEMPLATES } from "../../lib/messages/seed-templates";

async function main() {
  const prisma = new PrismaClient();
  let added = 0;
  let skipped = 0;
  let failed = 0;
  for (const t of SEED_MESSAGE_TEMPLATES) {
    const existing = await prisma.messageTemplate.findFirst({
      where: { name: t.name },
    });
    if (existing) {
      console.log(`[skip] ${t.name}`);
      skipped++;
      continue;
    }
    try {
      await prisma.messageTemplate.create({
        data: {
          name: t.name,
          category: t.category as any,
          channel: t.channel,
          subject: t.subject,
          body: t.body,
          triggerType: "MANUAL",
          variables: t.variables ? (t.variables as any) : undefined,
          isActive: true,
        } as any,
      });
      console.log(`[ok] ${t.name}`);
      added++;
    } catch (e: any) {
      console.log(`[err] ${t.name}: ${e.message}`);
      failed++;
    }
  }
  console.log(`\nSummary: added=${added}, skipped=${skipped}, failed=${failed}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
