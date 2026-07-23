"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Eye, LogOut, Lock, Pencil } from "lucide-react";

/**
 * The always-on reminder that you are not yourself.
 *
 * Rendered fixed at the top of EVERY page (v1 and v2) whenever an
 * impersonation ticket is active — an admin who forgets they are viewing as a
 * cleaner is exactly how confusing support tickets and bad data get created.
 * Body padding is offset in globals.css so it never covers a sticky header.
 */
export function ImpersonationBar({
  targetName,
  targetRole,
  mode,
}: {
  targetName: string;
  targetRole: string;
  mode: "READ_ONLY" | "FULL";
}) {
  const router = useRouter();
  const [stopping, setStopping] = useState(false);

  async function stop() {
    setStopping(true);
    try {
      await fetch("/api/admin/impersonate", { method: "DELETE" });
      // Hard navigation: server components all over the app have cached the
      // impersonated identity, so a soft refresh can leave stale data behind.
      window.location.href = "/v2/admin/system/test-as";
    } catch {
      setStopping(false);
      router.refresh();
    }
  }

  const readOnly = mode === "READ_ONLY";

  return (
    <div
      role="status"
      className={`fixed inset-x-0 top-0 z-[200] flex h-9 items-center gap-2 px-3 text-[0.75rem] font-medium text-white shadow-md ${
        readOnly ? "bg-amber-600" : "bg-rose-600"
      }`}
    >
      <Eye className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">
        Testing as <strong className="font-semibold">{targetName}</strong>
        <span className="opacity-80"> · {targetRole.replace(/_/g, " ").toLowerCase()}</span>
      </span>
      <span className="hidden shrink-0 items-center gap-1 rounded-full bg-black/20 px-2 py-0.5 sm:flex">
        {readOnly ? <Lock className="h-3 w-3" aria-hidden /> : <Pencil className="h-3 w-3" aria-hidden />}
        {readOnly ? "Read-only" : "Full — writes are real"}
      </span>
      <button
        type="button"
        onClick={stop}
        disabled={stopping}
        className="shrink-0 inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 font-semibold text-slate-900 hover:bg-white disabled:opacity-60"
      >
        <LogOut className="h-3 w-3" aria-hidden />
        {stopping ? "Exiting…" : "Exit"}
      </button>
    </div>
  );
}
