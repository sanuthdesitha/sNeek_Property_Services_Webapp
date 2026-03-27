import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BellRing } from "lucide-react";
import { WorkforcePostCard } from "@/components/workforce/workforce-post-card";

export function WorkforceDashboardPosts({
  title = "Team Updates",
  posts,
}: {
  title?: string;
  posts: Array<{
    id: string;
    type?: string;
    title: string;
    body: string;
    pinned?: boolean;
    coverImageUrl?: string | null;
    createdAt: string | Date;
    createdBy?: { name?: string | null; image?: string | null } | null;
  }>;
}) {
  if (!posts.length) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle className="text-base">{title}</CardTitle>
          <p className="text-xs text-muted-foreground">Announcements, recognition, and team updates.</p>
        </div>
        <BellRing className="h-4 w-4 text-primary" />
      </CardHeader>
      <CardContent className="space-y-3">
        {posts.map((post) => (
          <WorkforcePostCard key={post.id} post={post} />
        ))}
      </CardContent>
    </Card>
  );
}
