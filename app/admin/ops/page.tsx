import Link from "next/link";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const LINKS = [
  {
    title: "Dispatch and scheduling",
    description: "Use Jobs and Calendar for assignment, due times, and daily workload.",
    href: "/admin/jobs",
  },
  {
    title: "Operational settings",
    description: "Automation defaults, notification rules, and operational controls now live in Settings.",
    href: "/admin/settings",
  },
  {
    title: "Laundry operations",
    description: "Laundry exceptions, skip notes, and weekly planning are managed in the Laundry area.",
    href: "/admin/laundry",
  },
  {
    title: "Integrations",
    description: "iCal sync operations and integration health are managed centrally under Integrations.",
    href: "/admin/integrations",
  },
];

export default async function OpsPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Operations</h1>
        <p className="text-sm text-muted-foreground">
          The old Operations workspace has been consolidated. Use the core pages below instead of
          maintaining a separate duplicate workflow.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {LINKS.map((item) => (
          <Card key={item.href}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{item.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">{item.description}</p>
              <Button asChild size="sm">
                <Link href={item.href}>Open</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
