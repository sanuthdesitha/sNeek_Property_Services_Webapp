"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { Bell, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useEffect, useRef, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { NOTIFICATION_EVENT } from "@/components/shared/live-notifications";

interface AdminHeaderProps {
  title?: string;
  companyName?: string;
  logoUrl?: string;
}

function initialsFromName(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function AdminHeader({ title, companyName = "sNeek Property Services", logoUrl = "" }: AdminHeaderProps) {
  const { data: session } = useSession();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const [clearingNotifications, setClearingNotifications] = useState(false);
  const realtimeRefreshLockRef = useRef(false);
  const initials = initialsFromName(companyName) || "SP";

  const dateLabel = new Intl.DateTimeFormat("en-AU", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date());

  async function fetchNotifications(options?: { silent?: boolean }) {
    const silent = options?.silent === true;

    if (!silent) setLoadingNotifications(true);
    setNotificationError(null);

    await fetch("/api/admin/notifications/log")
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error ?? "Could not load notifications.");

        const rows = Array.isArray(data) ? data : [];
        setNotifications(rows);
      })
      .catch((err) => {
        if (!silent) setNotifications([]);
        setNotificationError(err?.message ?? "Could not load notifications.");
      })
      .finally(() => {
        if (!silent) setLoadingNotifications(false);
      });
  }

  async function clearNotifications() {
    setClearingNotifications(true);
    const res = await fetch("/api/admin/notifications/log", { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    setClearingNotifications(false);

    if (!res.ok) {
      toast({ title: "Clear failed", description: body.error ?? "Could not clear notifications.", variant: "destructive" });
      return;
    }

    toast({ title: "Notifications cleared" });
    setNotifications([]);
  }

  useEffect(() => {
    fetchNotifications({ silent: true }).catch(() => {});
    const timer = setInterval(() => {
      fetchNotifications({ silent: true }).catch(() => {});
    }, 60000);
    return () => {
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onRealtimeNotification() {
      if (realtimeRefreshLockRef.current) return;
      realtimeRefreshLockRef.current = true;
      fetchNotifications({ silent: true })
        .catch(() => {})
        .finally(() => {
          window.setTimeout(() => {
            realtimeRefreshLockRef.current = false;
          }, 250);
        });
    }

    window.addEventListener(NOTIFICATION_EVENT, onRealtimeNotification as EventListener);
    return () => {
      window.removeEventListener(NOTIFICATION_EVENT, onRealtimeNotification as EventListener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!notificationsOpen) return;
    fetchNotifications({ silent: false }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notificationsOpen]);

  return (
    <>
      <header className="sticky top-0 z-40 shrink-0 border-b border-white/60 bg-white/75 px-3 py-3 backdrop-blur-md sm:px-4 md:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            {logoUrl ? (
              <img src={logoUrl} alt={`${companyName} logo`} className="h-9 w-9 rounded-md bg-white p-0.5 object-cover shadow-sm" />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary shadow-sm">
                <span className="text-xs font-bold text-white">{initials}</span>
              </div>
            )}
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Admin Portal</p>
              <h1 className="truncate text-lg font-semibold text-foreground">{title || "Operations Console"}</h1>
              <p className="truncate text-xs text-muted-foreground">{companyName}</p>
            </div>
          </div>

          <div className="ml-auto flex w-full flex-wrap items-center justify-end gap-2 md:w-auto md:gap-3">
            <div className="hidden items-center gap-2 rounded-full border border-border/70 bg-white/75 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm lg:flex">
              <CalendarDays className="h-3.5 w-3.5" />
              <span>{dateLabel}</span>
            </div>

            <Button
              variant="ghost"
              size="icon"
              className="relative shrink-0"
              onClick={() => setNotificationsOpen(true)}
              aria-label="Open notifications"
            >
              <Bell className="h-4 w-4" />
              <Badge className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center p-0 text-[10px]">
                {Math.min(notifications.length || 0, 9)}
              </Badge>
            </Button>

            <div className="flex items-center gap-2">
              {session?.user?.image ? (
                <img src={session.user.image} alt={session.user.name ?? "Admin"} className="h-8 w-8 rounded-full object-cover" />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                  <span className="text-xs font-semibold text-primary">{session?.user?.name?.[0]?.toUpperCase() ?? "A"}</span>
                </div>
              )}
              {session?.user?.name && <span className="hidden max-w-[140px] truncate text-sm font-medium lg:block">{session.user.name}</span>}
            </div>
          </div>
        </div>
      </header>

      <Dialog open={notificationsOpen} onOpenChange={setNotificationsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Notifications</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            {loadingNotifications ? (
              <p className="text-sm text-muted-foreground">Loading notifications...</p>
            ) : notificationError ? (
              <p className="text-sm text-destructive">{notificationError}</p>
            ) : notifications.length === 0 ? (
              <p className="text-sm text-muted-foreground">No notifications found.</p>
            ) : (
              <div className="max-h-[360px] space-y-2 overflow-auto">
                {notifications.slice(0, 30).map((item) => (
                  <Link
                    key={item.id}
                    href={item.href ?? "/admin/notifications"}
                    onClick={() => setNotificationsOpen(false)}
                    className="block rounded-lg border border-border/70 p-2 transition-colors hover:bg-muted/50"
                  >
                    <p className="text-xs font-medium">{item.channel}</p>
                    <p className="text-sm">{item.subject ?? "Notification"}</p>
                    <p className="line-clamp-2 text-xs text-muted-foreground">{item.body}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {new Date(item.createdAt).toLocaleString("en-AU")} - {item.status}
                    </p>
                  </Link>
                ))}
              </div>
            )}

            <div className="flex justify-end">
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  onClick={clearNotifications}
                  disabled={clearingNotifications || notifications.length === 0}
                >
                  {clearingNotifications ? "Clearing..." : "Clear"}
                </Button>
                <Button variant="outline" asChild>
                  <Link href="/admin/notifications">Open full log</Link>
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
