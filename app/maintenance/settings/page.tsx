import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { User, Mail, Phone } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function MaintenanceSettingsPage() {
  const session = await requireRole([Role.MAINTENANCE, Role.ADMIN, Role.OPS_MANAGER]);

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { name: true, email: true, phone: true },
  });

  const rows: Array<{ label: string; value: string | null | undefined; Icon: typeof User }> = [
    { label: "Name", value: user?.name ?? session.user.name, Icon: User },
    { label: "Email", value: user?.email ?? session.user.email, Icon: Mail },
    { label: "Phone", value: user?.phone, Icon: Phone },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profile"
        description="Your account details."
        icon={<User />}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {rows.map(({ label, value, Icon }) => (
            <div
              key={label}
              className="flex items-center gap-3 rounded-lg border border-border bg-background p-3"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="truncate text-sm font-medium text-foreground">
                  {value || "Not set"}
                </p>
              </div>
            </div>
          ))}
          <p className="pt-1 text-xs text-muted-foreground">
            Update your details during onboarding / contact admin.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
