import Link from "next/link";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import CampaignWizard from "@/components/admin/campaign-wizard";

export default async function NewCampaignPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  const templates = await db.messageTemplate.findMany({
    where: { isActive: true },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    select: { id: true, name: true, subject: true, body: true, channel: true, category: true },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">New campaign</h1>
          <p className="text-sm text-muted-foreground">
            Pick a template, choose a channel, segment recipients, and save as draft or schedule.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/admin/marketing/campaigns">Back to campaigns</Link>
        </Button>
      </div>

      <CampaignWizard templates={templates as any} />
    </div>
  );
}
