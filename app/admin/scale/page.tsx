import Link from "next/link";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const LINKS = [
  {
    title: "Client invoices",
    description: "Billing rates, invoice generation, PDF preview, and Xero export now live in Invoices.",
    href: "/admin/invoices",
  },
  {
    title: "Shopping runs",
    description: "Procurement and reimbursement flows now live in Shopping Runs.",
    href: "/admin/shopping-runs",
  },
  {
    title: "Stock counts",
    description: "Inventory verification and par-level updates are managed in Stock Counts.",
    href: "/admin/stock-runs",
  },
  {
    title: "Reports and finance",
    description: "Operational reporting and finance review belong in Reports and Finance.",
    href: "/admin/reports",
  },
];

export default async function ScalePage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Scale</h1>
        <p className="text-sm text-muted-foreground">
          Phase 3 scale features have been folded into the live operational pages. Use the links
          below instead of a separate experimental workspace.
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
