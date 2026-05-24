import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Role } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { ThemeEditor } from "@/components/reports/theme-editor";

export const dynamic = "force-dynamic";

export default async function EditThemePage({ params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  } catch {
    redirect("/login");
  }

  const theme = await (db as any).reportTheme.findUnique({ where: { id: params.id } });
  if (!theme) return notFound();

  // Make sure layout has the standard shape
  const safe = {
    ...theme,
    layout:
      theme.layout && typeof theme.layout === "object"
        ? theme.layout
        : {
            sections: [
              { id: "header", visible: true, order: 0 },
              { id: "summary", visible: true, order: 1 },
              { id: "task-checklist", visible: true, order: 2 },
              { id: "before-after-gallery", visible: true, order: 3 },
              { id: "supplies", visible: false, order: 4 },
              { id: "signature", visible: true, order: 5 },
              { id: "footer", visible: true, order: 6 },
            ],
            photoSize: "medium",
            density: "default",
          },
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-2xl font-bold">Edit theme</h2>
            <p className="text-sm text-muted-foreground">{safe.name}</p>
          </div>
          {safe.isDefault && (
            <Badge variant="success" className="text-xs">
              Default
            </Badge>
          )}
        </div>
        <Button variant="outline" asChild>
          <Link href="/admin/reports/themes">Back</Link>
        </Button>
      </div>

      <ThemeEditor initial={safe} />
    </div>
  );
}
