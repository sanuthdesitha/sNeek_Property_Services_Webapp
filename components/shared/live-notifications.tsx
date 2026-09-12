"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { toast } from "@/hooks/use-toast";

type NotificationFeedItem = {
  id: string;
  jobId?: string | null;
  subject?: string | null;
  body: string;
  href: string;
};

export const NOTIFICATION_EVENT = "sneek:notification";
const MAX_SEEN_IDS = 1000;

function internalHref(href: string): string | null {
  if (!href.startsWith("/") || href.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(href)) return null;
  try {
    const url = new URL(href, window.location.origin);
    return url.origin === window.location.origin && !url.pathname.startsWith("//")
      ? url.pathname + url.search + url.hash
      : null;
  } catch {
    return null;
  }
}

function isNotificationFeedItem(value: unknown): value is NotificationFeedItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    row.id.trim().length > 0 &&
    (row.subject == null || typeof row.subject === "string") &&
    (row.jobId == null || typeof row.jobId === "string") &&
    typeof row.body === "string" &&
    typeof row.href === "string"
  );
}

export function LiveNotifications() {
  const { status, data: session } = useSession();
  const scope = status === "authenticated" && session?.user?.id && session.user.role
    ? JSON.stringify([session.user.id, session.user.role, session.impersonation?.actorId,
        session.impersonation?.mode, session.impersonation?.startedAt])
    : null;
  const activeScopeRef = useRef<string | null>(null);

  // Invalidate old callbacks at commit, before passive subscription cleanup.
  useLayoutEffect(() => {
    activeScopeRef.current = scope;
    return () => { activeScopeRef.current = null; };
  }, [scope]);

  useEffect(() => {
    if (!scope) return;
    if (typeof window === "undefined") return;

    let source: EventSource | null = null;
    let cancelled = false;
    const controller = new AbortController();
    const seenIds = new Set<string>();
    const isCurrent = () => !cancelled && activeScopeRef.current === scope;
    const remember = (id: string) => {
      seenIds.add(id);
      if (seenIds.size > MAX_SEEN_IDS) seenIds.delete(seenIds.values().next().value!);
    };

    const announce = (item: NotificationFeedItem) => {
      if (!isCurrent()) return;
      window.dispatchEvent(
        new CustomEvent(NOTIFICATION_EVENT, {
          detail: item,
        })
      );

      if (!isCurrent()) return;
      toast({
        title: item.subject?.trim() || "New notification",
        description: item.body || "You have a new update.",
      });

      if (
        isCurrent() &&
        "Notification" in window &&
        Notification.permission === "granted" &&
        document.visibilityState !== "visible"
      ) {
        const notification = new Notification(item.subject?.trim() || "New notification", {
          body: item.body || "You have a new update.",
        });
        notification.onclick = () => {
          if (!isCurrent()) {
            notification.close();
            return;
          }
          window.focus();
          const href = internalHref(item.href);
          if (href && isCurrent()) {
            window.location.assign(href);
          }
          notification.close();
        };
      }
    };

    const handleIncoming = (raw: unknown) => {
      if (!isCurrent() || !isNotificationFeedItem(raw)) return;
      if (seenIds.has(raw.id)) return;
      remember(raw.id);
      announce(raw);
    };

    async function primeSeenIds() {
      try {
        // Device permission is requested by WebPushSubscriber after a user action.
        const res = await fetch("/api/notifications/log", { cache: "no-store", signal: controller.signal });
        if (!isCurrent() || !res.ok) return;
        const body = await res.json().catch(() => []);
        if (!isCurrent()) return;
        const rows = Array.isArray(body) ? body : [];
        for (const row of rows) {
          if (isNotificationFeedItem(row)) {
            remember(row.id);
          }
        }
      } catch {
        // Keep stream behavior even if priming fails.
      }
    }

    function connect() {
      if (!isCurrent()) return;
      // Skip the long-lived SSE under automated browsers (Playwright / preview
      // capture) — an always-open stream prevents "network idle", which hangs
      // screenshot/snapshot tooling. Real users are unaffected.
      if (typeof navigator !== "undefined" && navigator.webdriver) return;
      source = new EventSource("/api/notifications/stream");
      source.addEventListener("notification", onNotification);
      source.onerror = () => {
        // Browser EventSource auto-reconnect handles transient errors.
      };
    }

    function onNotification(event: MessageEvent<string>) {
      try {
        const payload = JSON.parse(event.data);
        handleIncoming(payload);
      } catch {
        // Ignore malformed events.
      }
    }

    void primeSeenIds().finally(() => {
      connect();
    });

    return () => {
      cancelled = true;
      controller.abort();
      seenIds.clear();
      if (source) {
        source.removeEventListener("notification", onNotification);
        source.onerror = null;
        source.close();
      }
    };
  }, [scope]);

  return null;
}
