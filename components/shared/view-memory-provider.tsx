"use client";

import { useContext, useEffect, useMemo, type ReactNode } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { usePathname, useSearchParams } from "next/navigation";
import {
  initializeViewMemory,
  rememberChosenView,
  rememberedHref,
  rememberCurrentView,
  settleChosenView,
} from "@/lib/navigation/view-memory";

/** A bare link to the open page chooses its default view; anything else may return to the last view. */
function destinationFor(href: string): string {
  return rememberChosenView(href) ? href : rememberedHref(href);
}

/** Restore only navigation preferences. Explicit destination queries always win. */
export function ViewMemoryProvider({ children }: { children: ReactNode }) {
  const router = useContext(AppRouterContext);
  const pathname = usePathname();
  const query = useSearchParams()?.toString();
  const value = useMemo(
    () =>
      router
        ? {
            ...router,
            push: (href: string, options?: Parameters<typeof router.push>[1]) =>
              router.push(destinationFor(href), options),
            replace: (
              href: string,
              options?: Parameters<typeof router.replace>[1],
            ) => router.replace(destinationFor(href), options),
          }
        : router,
    [router],
  );

  useEffect(() => {
    settleChosenView();
    const boot = initializeViewMemory();
    if (boot.resetHref) {
      const href = boot.resetHref;
      delete boot.resetHref;
      router?.replace(href);
      return;
    }
    const current =
      window.location.pathname + window.location.search + window.location.hash;
    const restored = rememberedHref(current);
    if (restored !== current) {
      router?.replace(restored);
      return;
    }
    rememberCurrentView();
  }, [pathname, query, router]);

  useEffect(() => {
    function follow(event: MouseEvent) {
      if (
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey ||
        event.defaultPrevented
      )
        return;
      const anchor = (event.target as Element | null)?.closest?.(
        "a[href]",
      ) as HTMLAnchorElement | null;
      if (
        !anchor ||
        anchor.hasAttribute("download") ||
        (anchor.target && anchor.target !== "_self")
      )
        return;
      const href = anchor.getAttribute("href")!;
      // A tab whose default is the bare URL ("Timeline" on the job page): the
      // viewer chose it, so the view being left must not be restored onto it.
      if (rememberChosenView(href)) return;
      rememberCurrentView();
      const restored = rememberedHref(href);
      if (restored === href) return;
      // AccountScopeProvider remains the outer transport and binds retained URLs.
      event.preventDefault();
      router?.push(restored);
    }
    document.addEventListener("click", follow, true);
    window.addEventListener("pagehide", rememberCurrentView);
    return () => {
      document.removeEventListener("click", follow, true);
      window.removeEventListener("pagehide", rememberCurrentView);
    };
  }, [router]);

  return (
    <AppRouterContext.Provider value={value}>
      {children}
    </AppRouterContext.Provider>
  );
}
