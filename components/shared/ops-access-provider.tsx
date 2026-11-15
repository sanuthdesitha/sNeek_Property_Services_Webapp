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
import type { OpsNavigationSeed } from "@/lib/rbac/ops-navigation-seed-types";

const OpsAccessContext = createContext<{
  canAccess: (href: string) => boolean;
  levels: OpsLevels | null;
  /** The server-resolved role while the browser session is still loading. */
  seedRole?: string | null;
}>({ canAccess: () => true, levels: null, seedRole: null });
export const useOpsAccess = () => useContext(OpsAccessContext);

/**
 * Navigation convenience only. Fresh server authorization remains authoritative.
 *
 * `seed` is the answer the server resolved while rendering this page (see
 * `opsNavigationSeed`). Without it every full page load showed a rail holding
 * only the unmapped "My profile" until /api/me/ops-permissions answered (and
 * for good when that read failed), even for administrators, whose access never
 * depends on a pack. The seed counts only for the person it was resolved for;
 * a refresh that fails keeps the last verified answer for the same identity
 * and shows the warning.
 */
export function OpsAccessProvider({ children, seed = null }: { children: ReactNode; seed?: OpsNavigationSeed | null }) {
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
          // Keep a verified answer for this identity; only an answer for
          // somebody else is dropped (it is ignored by `current` anyway).
          setAccess((previous) => (previous?.identity === identity ? previous : null));
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
  const fetched = access?.identity === identity ? access : null;
  const seeded = seed && (status === "loading" || session?.user?.id === seed.userId) ? { levels: seed.levels } : null;
  const current = fetched ?? seeded;
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
    <OpsAccessContext.Provider value={{ canAccess, levels, seedRole: seeded ? seed?.role ?? null : null }}>
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
