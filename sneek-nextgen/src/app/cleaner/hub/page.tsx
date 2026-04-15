import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Megaphone, BookOpen, Pin } from "lucide-react";

export default function CleanerHubPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Hub</h1>
        <p className="text-text-secondary mt-1">Announcements, learning, and team updates</p>
      </div>

      {/* Announcements */}
      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Megaphone className="h-5 w-5" />
            Announcements
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { title: "New safety protocols effective May 1", date: "Apr 15", pinned: true, reads: 6 },
              { title: "Reminder: Easter schedule changes", date: "Apr 10", pinned: false, reads: 12 },
            ].map((post, i) => (
              <div key={i} className="p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900">
                <div className="flex items-center gap-2">
                  {post.pinned && <Pin className="h-3 w-3 text-warning-500" />}
                  <p className="text-sm font-medium">{post.title}</p>
                </div>
                <p className="text-xs text-text-tertiary mt-1">{post.date} &middot; {post.reads} reads</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Learning */}
      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Learning
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { title: "Safety Training Module 1", status: "ASSIGNED", progress: 0 },
              { title: "Eco-Friendly Cleaning Products", status: "COMPLETED", progress: 100 },
            ].map((course, i) => (
              <div key={i} className="p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{course.title}</p>
                  <p className="text-xs text-text-tertiary">{course.progress}% complete</p>
                </div>
                <Badge variant={course.status === "COMPLETED" ? "success" : "info"}>{course.status}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
