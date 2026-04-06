import Link from "next/link";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { EmailCampaignsWorkspace } from "@/components/admin/email-campaigns-workspace";
import { listEmailCampaigns } from "@/lib/marketing/email-campaigns";

export default async function AdminEmailCampaignsPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const campaigns = await listEmailCampaigns();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Email Campaigns</h1>
          <p className="text-sm text-muted-foreground">Send broadcast campaigns to active or segmented clients and schedule them for later dispatch.</p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/admin/marketing">Back to marketing</Link>
        </Button>
      </div>
      <EmailCampaignsWorkspace initialCampaigns={campaigns as any} />
    </div>
  );
}
