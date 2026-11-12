"use client";

/**
 * What an incoming link means once the page is in the browser:
 *  - an old `?tab=` mapped to a stage scrolls there (the server cannot set a hash);
 *  - `#chat` (approvals "Client requests") moves to the Messages tab.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { chatHashRedirect, type JobPageView } from "@/lib/jobs/job-page/deep-link";

export function JobArrival({ jobId, view, anchor }: { jobId: string; view: JobPageView; anchor: string | null }) {
  const router = useRouter();
  useEffect(() => {
    const redirect = chatHashRedirect(jobId, view, window.location.hash);
    if (redirect) {
      router.replace(redirect);
      return;
    }
    const target = window.location.hash ? window.location.hash.slice(1) : anchor;
    if (!target) return;
    const element = document.getElementById(target);
    if (!element) return;
    element.scrollIntoView({ block: "start" });
    if (!window.location.hash && anchor) window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#${anchor}`);
    // Re-dispatch so a disclosure named by the anchor opens itself.
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }, [jobId, view, anchor, router]);
  return null;
}
