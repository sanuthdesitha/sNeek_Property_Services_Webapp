"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { toast } from "@/hooks/use-toast";

type NotificationFeedItem = {
  id: string;
  jobId: string | null;
  subject: string | null;
  body: string;
  href: string;
};

export const NOTIFICATION_EVENT = "sneek:notification";

function isNotificationFeedItem(value: unknown): value is NotificationFeedItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.body === "string" &&
    typeof row.href === "string"
  );
}

export function LiveNotifications() {
  const { status } = useSession();
  const seenIdsRef = useRef<Set<string>>(new Set());
  const requestedPermissionRef = useRef(false);

  useEffect(() => {
    if (status !== "authenticated") return;
    if (typeof window === "undefined") return;

    let source: EventSource | null = null;
    let cancelled = false;

    const announce = (item: NotificationFeedItem) => {
      window.dispatchEvent(
        new CustomEvent(NOTIFICATION_EVENT, {
          detail: item,
        })
      );

      toast({
        title: item.subject?.trim() || "New notification",
        description: item.body || "You have a new update.",
      });

      if (
        "Notification" in window &&
        Notification.permission === "granted" &&
        document.visibilityState !== "visible"
      ) {
        const notification = new Notification(item.subject?.trim() || "New notification", {
          body: item.body || "You have a new update.",
        });
        notification.onclick = () => {
          window.focus();
          if (item.href) {
            window.location.assign(item.href);
          }
          notification.close();
        };
      }
    };

    const handleIncoming = (raw: unknown) => {
      if (!isNotificationFeedItem(raw)) return;
      if (seenIdsRef.current.has(raw.id)) return;
      seenIdsRef.current.add(raw.id);
      announce(raw);
    };

    async function primeSeenIds() {
      try {
        if (
          "Notification" in window &&
          Notification.permission === "default" &&
          !requestedPermissionRef.current
        ) {
          requestedPermissionRef.current = true;
          Notification.requestPermission().catch(() => undefined);
        }
        const res = await fetch("/api/notifications/log", { cache: "no-store" });
        const body = await res.json().catch(() => []);
        const rows = Array.isArray(body) ? body : [];
        for (const row of rows) {
          if (row && typeof row.id === "string") {
            seenIdsRef.current.add(row.id);
          }
        }
      } catch {
        // Keep stream behavior even if priming fails.
      }
    }

    function connect() {
      if (cancelled) return;
      source = new EventSource("/api/notifications/stream");
      source.addEventListener("notification", (event: MessageEvent<string>) => {
        try {
          const payload = JSON.parse(event.data);
          handleIncoming(payload);
        } catch {
          // Ignore malformed events.
        }
      });
      source.onerror = () => {
        // Browser EventSource auto-reconnect handles transient errors.
      };
    }

    void primeSeenIds().finally(() => {
      connect();
    });

    return () => {
      cancelled = true;
      if (source) source.close();
    };
  }, [status]);

  return null;
}
