"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

/** Refresh server-rendered operational totals while the page is visible. */
export function LivePageRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    function refresh() {
      if (document.visibilityState !== "visible" || pending) return;
      startTransition(() => router.refresh());
    }
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router, pending]);
  return null;
}
