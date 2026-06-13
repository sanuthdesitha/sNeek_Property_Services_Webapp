import { PrismaClient } from "@prisma/client";
import { SEED_REPORT_THEMES } from "../../lib/reports/seed-themes";

async function main() {
  const prisma = new PrismaClient();
  for (const theme of SEED_REPORT_THEMES) {
    const existing = await prisma.reportTheme.findFirst({ where: { kind: theme.kind, name: theme.name } });
    if (existing) {
      console.log(`[skip] ${theme.kind} ${theme.name}`);
      continue;
    }
    // Idempotent + safe to re-run: when this seed should be the default, demote
    // any current default first so exactly one theme stays isDefault.
    if (theme.isDefault) {
      await prisma.reportTheme.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    }
    await prisma.reportTheme.create({
      data: {
        name: theme.name,
        kind: theme.kind,
        isDefault: theme.isDefault,
        layout: theme.layout as any,
        titleTemplate: theme.titleTemplate,
        primaryColorHsl: theme.primaryColorHsl,
        accentColorHsl: theme.accentColorHsl,
      },
    });
    console.log(`[ok] seeded ${theme.kind} ${theme.name}`);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
