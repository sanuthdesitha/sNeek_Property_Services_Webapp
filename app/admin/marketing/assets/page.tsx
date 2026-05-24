import Link from "next/link";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import AssetUploader from "@/components/admin/marketing-asset-uploader";

export default async function MarketingAssetsPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  const assets = await (db as any).marketingAsset.findMany({
    orderBy: [{ createdAt: "desc" }],
    take: 500,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Marketing assets</h1>
          <p className="text-sm text-muted-foreground">
            Images, videos, and GIFs available for social posts and campaigns.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/admin/marketing">Back to marketing</Link>
        </Button>
      </div>

      <Card className="p-4">
        <h2 className="mb-3 text-base font-semibold">Upload new asset</h2>
        <AssetUploader />
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 text-base font-semibold">Library</h2>
        {assets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No assets uploaded yet.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {assets.map((a: any) => (
              <div key={a.id} className="rounded-md border border-border bg-surface p-2">
                {a.mediaType === "IMAGE" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.url} alt={a.name} className="mb-1 h-24 w-full rounded object-cover" />
                ) : (
                  <div className="mb-1 flex h-24 w-full items-center justify-center rounded bg-muted text-xs text-muted-foreground">
                    {a.mediaType}
                  </div>
                )}
                <p className="truncate text-xs text-foreground" title={a.name}>{a.name}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(a.createdAt).toLocaleDateString()}
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
