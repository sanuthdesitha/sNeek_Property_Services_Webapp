import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Megaphone, BookOpen } from "lucide-react";

export default function LaundryHubPage() {
  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold text-text-primary">Hub</h1><p className="text-text-secondary mt-1">Announcements and updates</p></div>
      <Card variant="outlined">
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Megaphone className="h-5 w-5" />Announcements</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { title: "New detergent supplier effective May 1", date: "Apr 15" },
              { title: "Holiday schedule changes", date: "Apr 10" },
            ].map((post, i) => (
              <div key={i} className="p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900">
                <p className="text-sm font-medium">{post.title}</p>
                <p className="text-xs text-text-tertiary mt-1">{post.date}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
