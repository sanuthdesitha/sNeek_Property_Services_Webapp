"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RefreshCcw, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { TwoStepConfirmDialog } from "@/components/shared/two-step-confirm-dialog";

export default function NotificationsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/admin/notifications/log");
    const body = await res.json().catch(() => []);
    setItems(Array.isArray(body) ? body : []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function clearAll() {
    setClearing(true);
    const res = await fetch("/api/admin/notifications/log", { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    setClearing(false);
    if (!res.ok) {
      toast({ title: "Clear failed", description: body.error ?? "Could not clear notifications.", variant: "destructive" });
      return;
    }
    toast({ title: "Notifications cleared" });
    setClearOpen(false);
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-2xl font-bold">Notifications</h2>
          <p className="text-sm text-muted-foreground">All past notification logs and delivery history.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load}>
            <RefreshCcw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button variant="destructive" onClick={() => setClearOpen(true)} disabled={items.length === 0}>
            <Trash2 className="mr-2 h-4 w-4" />
            Clear all
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Loading notifications...</p>
          ) : items.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No notifications found.</p>
          ) : (
            <div className="divide-y">
              {items.map((item) => (
                <Link
                  key={item.id}
                  href={item.href ?? "/admin/notifications"}
                  className="block px-5 py-3 transition-colors hover:bg-muted/40"
                >
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium">{item.subject ?? "Notification"}</p>
                      <p className="text-xs text-muted-foreground">{item.body}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {new Date(item.createdAt).toLocaleString("en-AU")}
                        {item.user?.email ? ` | ${item.user.email}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{item.channel}</Badge>
                      <Badge variant={item.status === "FAILED" ? "destructive" : item.status === "SENT" ? "success" : "secondary"}>
                        {item.status}
                      </Badge>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <TwoStepConfirmDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title="Clear notifications"
        description="This will remove all notification logs from the system."
        actionKey="clearNotificationLog"
        confirmLabel="Yes"
        cancelLabel="No"
        loading={clearing}
        onConfirm={clearAll}
      />
    </div>
  );
}
