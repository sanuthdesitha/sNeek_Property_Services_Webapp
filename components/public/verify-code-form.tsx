"use client";

// Code-entry form for the public report verification page. Navigation only —
// the lookup itself happens server-side on /verify/[code], where it is
// rate-limited per IP.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeVerificationCode } from "@/lib/reports/verification-code";

export function VerifyCodeForm() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const code = normalizeVerificationCode(value);
    if (!code) {
      setError("That doesn't look like a report code — it has 16 letters and numbers, e.g. ABCD-EFGH-JKMN-PQRS.");
      return;
    }
    setError(null);
    router.push(`/verify/${code}`);
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label htmlFor="verify-code" className="text-sm font-medium">
        Report code
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          id="verify-code"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="ABCD-EFGH-JKMN-PQRS"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          className="font-mono tracking-[0.12em] uppercase"
        />
        <Button type="submit" className="shrink-0">
          Verify report
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </form>
  );
}
