import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Megaphone, BookOpen, FileText, Users } from "lucide-react";

export default function WorkforcePage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Workforce</h1>
          <p className="text-text-secondary mt-1">Posts, hiring, learning, and staff management</p>
        </div>
      </div>

      <Tabs defaultValue="posts">
        <TabsList>
          <TabsTrigger value="posts">Posts</TabsTrigger>
          <TabsTrigger value="hiring">Hiring</TabsTrigger>
          <TabsTrigger value="learning">Learning</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="recognition">Recognition</TabsTrigger>
        </TabsList>

        <TabsContent value="posts" className="space-y-4">
          <div className="flex justify-end">
            <Button asChild>
              <Link href="/admin/workforce/posts/new">
                <Plus className="h-4 w-4 mr-2" />
                New Post
              </Link>
            </Button>
          </div>
          {[
            { title: "New safety protocols effective May 1", type: "ANNOUNCEMENT", pinned: true, audience: "All Cleaners", date: "2026-04-15", reads: 6 },
            { title: "Reminder: Easter schedule changes", type: "ANNOUNCEMENT", pinned: false, audience: "All Staff", date: "2026-04-10", reads: 12 },
          ].map((post, i) => (
            <Card key={i} variant="outlined">
              <CardContent className="pt-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Megaphone className="h-4 w-4 text-text-tertiary" />
                      <h3 className="font-medium">{post.title}</h3>
                      {post.pinned && <Badge variant="warning">Pinned</Badge>}
                    </div>
                    <p className="text-sm text-text-tertiary mt-1">
                      {post.audience} &middot; {post.reads} reads &middot; {post.date}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm">Edit</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="hiring" className="space-y-4">
          <div className="flex justify-end">
            <Button asChild>
              <Link href="/admin/workforce/hiring/new">
                <Plus className="h-4 w-4 mr-2" />
                New Position
              </Link>
            </Button>
          </div>
          <Card variant="outlined">
            <CardContent className="pt-6 text-center text-text-secondary">
              <Users className="h-8 w-8 mx-auto mb-2 text-text-tertiary" />
              <p>No open positions</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="learning" className="space-y-4">
          <div className="flex justify-end">
            <Button asChild>
              <Link href="/admin/workforce/learning/new">
                <Plus className="h-4 w-4 mr-2" />
                New Course
              </Link>
            </Button>
          </div>
          <Card variant="outlined">
            <CardContent className="pt-6 text-center text-text-secondary">
              <BookOpen className="h-8 w-8 mx-auto mb-2 text-text-tertiary" />
              <p>No learning paths created yet</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents" className="space-y-4">
          <Card variant="outlined">
            <CardContent className="pt-6 text-center text-text-secondary">
              <FileText className="h-8 w-8 mx-auto mb-2 text-text-tertiary" />
              <p>No staff documents uploaded</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="recognition" className="space-y-4">
          <Card variant="outlined">
            <CardContent className="pt-6 text-center text-text-secondary">
              <p>No staff recognitions yet</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
