import Link from "next/link";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const LINKS = [
  {
    title: "Cases",
    description: "Disputes, damage, and follow-up are unified in Cases.",
    href: "/admin/cases",
  },
  {
    title: "Forms",
    description: "Template versioning and form controls belong in Forms.",
    href: "/admin/forms",
  },
  {
    title: "Reports",
    description: "Report visibility, PDF performance, and operational reporting belong in Reports.",
    href: "/admin/reports",
  },
  {
    title: "Shopping and invoices",
    description: "Procurement reimbursement and billing are handled through Shopping Runs and Invoices.",
    href: "/admin/invoices",
  },
];

export default async function IntelligencePage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Intelligence</h1>
        <p className="text-sm text-muted-foreground">
          The old intelligence workspace has been retired. The features that remain live now sit in
          the core operational pages below.
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
