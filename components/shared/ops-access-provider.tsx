"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useSession } from "next-auth/react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  canUseOpsPath,
  opsRequestFeature,
  OPS_FEATURE_KEYS,
  type OpsLevels,
} from "@/lib/rbac/ops-catalog";

const OpsAccessContext = createContext<{
  canAccess: (href: string) => boolean;
  levels: OpsLevels | null;
}>({ canAccess: () => true, levels: null });
export const useOpsAccess = () => useContext(OpsAccessContext);

/** Navigation convenience only. Fresh server authorization remains authoritative. */
export function OpsAccessProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const query = useSearchParams()?.toString() ?? "";
  const identity = JSON.stringify([
    session?.user?.id,
    session?.user?.role,
    session?.impersonation,
  ]);
  const [access, setAccess] = useState<{
    identity: string;
    levels: OpsLevels | null;
  } | null>(null);
  const [failure, setFailure] = useState(false);
  useEffect(() => {
    if (status !== "authenticated") {
      setAccess(null);
      return;
    }
    const controller = new AbortController();
    let running = false;
    async function refresh() {
      if (running) return;
      running = true;
      try {
        const response = await fetch("/api/me/ops-permissions", {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json();
        if (
          !response.ok ||
          !(
            data.levels === null ||
            OPS_FEATURE_KEYS.every((key) =>
              ["off", "read", "manage"].includes(data.levels?.[key]),
            )
          )
        )
          throw new Error("Could not verify access");
        if (!controller.signal.aborted) {
          setAccess({ identity, levels: data.levels });
          setFailure(false);
        }
      } catch {
        if (!controller.signal.aborted) {
          setAccess(null);
          setFailure(true);
        }
      } finally {
        running = false;
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    window.addEventListener("focus", refresh);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [identity, status, pathname, query]);
  const current = access?.identity === identity ? access : null;
  const levels = current?.levels ?? null;
  const canAccess = (href: string) =>
    current
      ? !levels || canUseOpsPath(levels, href)
      : opsRequestFeature(href) === null;
  const feature = opsRequestFeature(`${pathname}?${query}`);
  const readOnly =
    levels &&
    feature &&
    feature !== "owner" &&
    feature !== "unmapped" &&
    levels[feature] === "read";
  return (
    <OpsAccessContext.Provider value={{ canAccess, levels }}>
      {failure && (
        <p
          role="alert"
          className="bg-amber-50 px-4 py-2 text-sm text-amber-950"
        >
          Navigation permissions could not be verified. Focus this window to
          retry.
        </p>
      )}
      {readOnly && (
        <p
          role="status"
          className="border-b border-border bg-surface px-4 py-2 text-sm text-foreground"
        >
          View-only access: you can browse this feature, but changes are
          blocked.
        </p>
      )}
      {children}
    </OpsAccessContext.Provider>
  );
}
