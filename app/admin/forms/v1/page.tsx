import Link from "next/link";
import { format } from "date-fns";
import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";

export const dynamic = "force-dynamic";

const KIND_LABELS: Record<string, string> = {
  AIRBNB_TURNOVER: "Airbnb Turnover",
  END_OF_LEASE: "End of Lease",
  DEEP_CLEAN: "Deep Clean",
  REGULAR_MAINTENANCE: "Regular Maintenance",
  POST_CONSTRUCTION: "Post-Construction",
  WINDOW: "Window / Glass",
  CARPET: "Carpet / Steam",
  COMMERCIAL: "Commercial / Office",
  MOVE_IN: "Move-in / Move-out",
  OVEN: "Oven / Appliance",
  CUSTOM: "Custom",
};

// Stable display ordering for kinds — matches the V1 spec's kind order.
const KIND_ORDER: string[] = [
  "AIRBNB_TURNOVER",
  "END_OF_LEASE",
  "DEEP_CLEAN",
  "REGULAR_MAINTENANCE",
  "POST_CONSTRUCTION",
  "WINDOW",
  "CARPET",
  "COMMERCIAL",
  "MOVE_IN",
  "OVEN",
  "CUSTOM",
];

export default async function FormsV1ListPage() {
  const templates = await db.formTemplate.findMany({
    orderBy: [{ kind: "asc" }, { version: "desc" }],
    select: {
      id: true,
      name: true,
      kind: true,
      version: true,
      isActive: true,
      publishedAt: true,
      archivedAt: true,
      updatedAt: true,
    },
  });

  const byKind = templates.reduce<Record<string, typeof templates>>((acc, t) => {
    (acc[t.kind] ||= []).push(t);
    return acc;
  }, {});

  const orderedKinds = KIND_ORDER.filter((k) => byKind[k]?.length).concat(
    Object.keys(byKind).filter((k) => !KIND_ORDER.includes(k))
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Form Templates (V1)</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {templates.length} templates across {Object.keys(byKind).length} job kinds.
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/forms/new">New template</Link>
        </Button>
      </header>

      {orderedKinds.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No form templates yet.
          </CardContent>
        </Card>
      )}

      {orderedKinds.map((kind) => (
        <Card key={kind}>
          <CardHeader>
            <CardTitle>{KIND_LABELS[kind] ?? kind}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {byKind[kind].map((t) => (
                <li
                  key={t.id}
                  className="flex items-center justify-between gap-3 px-6 py-3 text-sm"
                >
                  <Link
                    href={`/admin/forms/${t.id}/edit`}
                    className="flex-1 hover:underline"
                  >
                    <span className="font-medium">{t.name}</span>
                    <span className="ml-2 font-mono text-xs text-muted-foreground">
                      v{t.version}
                    </span>
                  </Link>
                  <div className="flex items-center gap-2">
                    {t.archivedAt ? (
                      <StatusPill variant="neutral">Archived</StatusPill>
                    ) : t.isActive ? (
                      <StatusPill variant="success">Published</StatusPill>
                    ) : (
                      <StatusPill variant="warning">Draft</StatusPill>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {t.publishedAt
                        ? format(t.publishedAt, "MMM d")
                        : "—"}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
