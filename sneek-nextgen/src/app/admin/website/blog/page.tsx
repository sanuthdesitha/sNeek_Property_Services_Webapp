import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Globe } from "lucide-react";

export default function BlogPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Blog</h1>
          <p className="text-text-secondary mt-1">Manage blog posts and content</p>
        </div>
        <Button asChild>
          <Link href="/admin/website/blog/new">
            <Plus className="h-4 w-4 mr-2" />
            New Post
          </Link>
        </Button>
      </div>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">All Posts</CardTitle>
          <CardDescription>Published and draft blog posts</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Author</TableHead>
                <TableHead>Published</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                { title: "5 Tips for Maintaining a Clean Airbnb", tags: ["Airbnb", "Tips"], status: "published", author: "sNeek Team", date: "2026-04-10" },
                { title: "Why Deep Cleaning Matters", tags: ["Deep Clean", "Education"], status: "published", author: "sNeek Team", date: "2026-04-05" },
                { title: "Spring Cleaning Checklist 2026", tags: ["Spring Clean", "Checklist"], status: "draft", author: "sNeek Team", date: null },
              ].map((post, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium text-sm flex items-center gap-2">
                    <Globe className="h-4 w-4 text-text-tertiary" />
                    {post.title}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {post.tags.map((tag) => (
                        <Badge key={tag} variant="neutral" className="text-xs">{tag}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell><Badge variant={post.status === "published" ? "success" : "neutral"}>{post.status}</Badge></TableCell>
                  <TableCell className="text-sm">{post.author}</TableCell>
                  <TableCell className="text-sm">{post.date ?? "—"}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/admin/website/blog/${i}`}>Edit</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
