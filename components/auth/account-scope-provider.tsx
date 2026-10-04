"use client";
import * as React from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { bindAccountUrl, readAccountPath } from "@/lib/auth/account-request-scope";
/** Full navigation clears React/query state while the old tab's requests retain their URL identity. */
export function AccountScopeProvider({ contextId, children }: { contextId: string | null; children: React.ReactNode }) {
  const router = React.useContext(AppRouterContext);
  const pathname = React.useContext(PathnameContext);
  const value = React.useMemo(() => {
    if (!router || !contextId) return router;
    const destination = (href: string) => href === "/accounts" ? href : bindAccountUrl(contextId, window.location.origin)(href);
    return { ...router, push: (href: string) => window.location.assign(destination(href)), replace: (href: string) => window.location.replace(destination(href)), prefetch: async () => {} };
  }, [router, contextId]);
  return <AppRouterContext.Provider value={value}><PathnameContext.Provider value={pathname ? readAccountPath(pathname)?.pathname ?? pathname : pathname}>{children}</PathnameContext.Provider></AppRouterContext.Provider>;
}
