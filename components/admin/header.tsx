"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { AlertTriangle, ArrowRight, Bell, CalendarDays, CheckCircle2, Clock, DollarSign, Menu, RefreshCw, Shirt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { toast } from "@/hooks/use-toast";
import { NOTIFICATION_EVENT } from "@/components/shared/live-notifications";
import { AdminNavLinks } from "@/components/admin/sidebar";

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
  const pathname = usePathname();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const [clearingNotifications, setClearingNotifications] = useState(false);
  const [headerHidden, setHeaderHidden] = useState(false);
  const [pendingTotal, setPendingTotal] = useState(0);
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
    async function fetchPendingTotal() {
      try {
        const res = await fetch("/api/admin/all-approvals");
        const body = await res.json().catch(() => null);
        if (body?.counts?.total != null) setPendingTotal(body.counts.total);
      } catch { /* silent */ }
    }
    fetchPendingTotal();
    const pendingTimer = setInterval(fetchPendingTotal, 60_000);
    return () => clearInterval(pendingTimer);
  }, []);

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

  useEffect(() => {
    setHeaderHidden(false);
    setMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mobileMedia = window.matchMedia("(max-width: 767px)");
    if (!mobileMedia.matches) {
      setHeaderHidden(false);
      return;
    }

    let lastScrollY = window.scrollY;
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      const delta = currentScrollY - lastScrollY;
      if (currentScrollY <= 24) {
        setHeaderHidden(false);
      } else if (delta > 8) {
        setHeaderHidden(true);
      } else if (delta < -8) {
        setHeaderHidden(false);
      }
      lastScrollY = currentScrollY;
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <>
      <header
        className={`sticky top-0 z-40 shrink-0 border-b border-white/60 bg-white/75 px-3 py-3 backdrop-blur-md transition-transform duration-300 sm:px-4 md:px-6 ${
          headerHidden ? "-translate-y-full md:translate-y-0" : "translate-y-0"
        }`}
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              variant="outline"
              size="icon"
              className="shrink-0 md:hidden"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open admin menu"
            >
              <Menu className="h-4 w-4" />
            </Button>
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
              {(pendingTotal > 0 || notifications.length > 0) && (
                <Badge className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center p-0.5 text-[10px]">
                  {Math.min(pendingTotal + notifications.length, 99)}
                </Badge>
              )}
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
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Notifications &amp; Attention</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* ── Pending approvals section ── */}
            <AttentionSection onNavigate={() => setNotificationsOpen(false)} />

            {/* ── Email/system notification log ── */}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Recent system notifications
              </p>
              {loadingNotifications ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : notificationError ? (
                <p className="text-sm text-destructive">{notificationError}</p>
              ) : notifications.length === 0 ? (
                <p className="text-sm text-muted-foreground">No notifications found.</p>
              ) : (
                <div className="max-h-[220px] space-y-1.5 overflow-auto">
                  {notifications.slice(0, 20).map((item) => (
                    <Link
                      key={item.id}
                      href={item.href ?? "/admin/notifications"}
                      onClick={() => setNotificationsOpen(false)}
                      className="block rounded-xl border border-border/60 bg-muted/30 p-2.5 transition-colors hover:bg-muted/60"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium leading-snug">{item.subject ?? "Notification"}</p>
                        <span className="shrink-0 rounded-full border border-border/50 bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {item.channel}
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{item.body}</p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {new Date(item.createdAt).toLocaleString("en-AU")}
                      </p>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-between gap-2 border-t border-border/60 pt-3">
              <Button variant="outline" asChild size="sm">
                <Link href="/admin/notifications" onClick={() => setNotificationsOpen(false)}>
                  Full log
                </Link>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={clearNotifications}
                disabled={clearingNotifications || notifications.length === 0}
              >
                {clearingNotifications ? "Clearing…" : "Clear notifications"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <DialogContent className="flex max-h-[85vh] max-w-sm flex-col overflow-hidden p-0">
          <DialogHeader className="border-b border-border/70 px-5 py-4">
            <DialogTitle>Admin Menu</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 pb-5">
            <AdminNavLinks onNavigate={() => setMobileMenuOpen(false)} />
          </div>
          <div className="border-t border-border/70 px-3 py-3">
            <div className="mb-3 flex items-center gap-3 rounded-xl border border-border/70 bg-white/70 px-3 py-3">
              {session?.user?.image ? (
                <img src={session.user.image} alt={session.user.name ?? "Admin"} className="h-9 w-9 rounded-full object-cover" />
              ) : (
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
                  <span className="text-xs font-semibold text-primary">{session?.user?.name?.[0]?.toUpperCase() ?? "A"}</span>
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{session?.user?.name ?? "Admin"}</p>
                <p className="truncate text-xs text-muted-foreground">{session?.user?.email ?? "Signed in"}</p>
              </div>
            </div>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => {
                const callbackUrl = `${window.location.origin}/login`;
                window.location.assign(`/api/auth/local-signout?callbackUrl=${encodeURIComponent(callbackUrl)}`);
              }}
            >
              Sign out
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Attention section inside the notification panel ────────────────────────────

type ApprovalCounts = {
  continuations: number;
  timingRequests: number;
  payAdjustments: number;
  timeAdjustments: number;
  clientApprovals: number;
  flaggedLaundry: number;
  total: number;
};

const ATTENTION_ITEMS: Array<{
  key: keyof ApprovalCounts;
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { key: "continuations",   label: "Job continuation requests", href: "/admin/approvals", icon: RefreshCw },
  { key: "timingRequests",  label: "Timing requests (check-in/out)", href: "/admin/approvals", icon: Clock },
  { key: "payAdjustments",  label: "Cleaner pay requests", href: "/admin/approvals", icon: DollarSign },
  { key: "timeAdjustments", label: "Clock adjustments", href: "/admin/approvals", icon: Clock },
  { key: "clientApprovals", label: "Client approvals awaiting response", href: "/admin/approvals", icon: CheckCircle2 },
  { key: "flaggedLaundry",  label: "Flagged laundry tasks", href: "/admin/approvals", icon: Shirt },
];

function AttentionSection({ onNavigate }: { readonly onNavigate: () => void }) {
  const [counts, setCounts] = useState<ApprovalCounts | null>(null);

  useEffect(() => {
    fetch("/api/admin/all-approvals")
      .then((r) => r.json().catch(() => null))
      .then((body) => { if (body?.counts) setCounts(body.counts); })
      .catch(() => {});
  }, []);

  const active = ATTENTION_ITEMS.filter((item) => (counts?.[item.key] ?? 0) > 0);

  if (!counts || active.length === 0) {
    return (
      <div className="rounded-xl border border-border/50 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        {!counts ? "Loading attention items…" : "No pending approvals — all clear."}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Needs attention
        </p>
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold text-white">
          {counts.total}
        </span>
      </div>
      <div className="space-y-1.5">
        {active.map((item) => {
          const count = counts[item.key] ?? 0;
          const Icon = item.icon;
          return (
            <Link
              key={item.key}
              href={item.href}
              onClick={onNavigate}
              className="flex items-center gap-3 rounded-xl border border-amber-200/60 bg-amber-50/60 px-3 py-2.5 transition-colors hover:bg-amber-100/60"
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
              <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-sm font-medium">{item.label}</span>
              <span className="rounded-full bg-destructive px-2 py-0.5 text-[11px] font-bold text-white">
                {count}
              </span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
