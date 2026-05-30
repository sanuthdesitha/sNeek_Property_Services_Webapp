"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { ProfileCompletenessResult } from "@/lib/profile/completeness";

const DISMISS_KEY = "sneek:profile-completion-dismissed";

// Shows a one-per-session reminder when the signed-in user has compulsory
// profile fields missing, with a link to the relevant profile page. Dismissible,
// but reappears on the next login (new browser session). Mounted in the shared
// portal shell so it covers every role.
export function ProfileCompletionGate() {
  const pathname = usePathname();
  const [result, setResult] = React.useState<ProfileCompletenessResult | null>(null);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/me/profile-completeness");
        if (!res.ok) return;
        const body = (await res.json()) as ProfileCompletenessResult;
        if (cancelled || body.complete) return;
        const dismissed = sessionStorage.getItem(DISMISS_KEY) === "1";
        setResult(body);
        if (!dismissed) setOpen(true);
      } catch {
        /* ignore — never block the portal on this */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!result || result.complete) return null;
  // Don't nag while they're already on the page where they fix it.
  if (pathname === result.fixUrl) return null;

  function dismiss() {
    sessionStorage.setItem(DISMISS_KEY, "1");
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : dismiss())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-amber-500" />
            Complete your profile
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            A few required details are missing from your profile. Please complete them so we can keep
            your records and payments accurate.
          </p>
          <ul className="list-inside list-disc space-y-1 rounded-md border bg-muted/30 p-3 text-sm">
            {result.missing.map((field) => (
              <li key={field.key}>{field.label}</li>
            ))}
          </ul>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button variant="outline" onClick={dismiss}>
              Later
            </Button>
            <Button asChild>
              <Link href={result.fixUrl} onClick={() => setOpen(false)}>
                Complete now
              </Link>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
