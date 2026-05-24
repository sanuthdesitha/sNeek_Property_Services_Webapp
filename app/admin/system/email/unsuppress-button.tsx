"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

export function EmailUnsuppressButton({ email }: { email: string }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleClick() {
    setLoading(true);
    try {
      await fetch(
        `/api/admin/system/email/${encodeURIComponent(email)}/unsuppress`,
        { method: "POST" }
      );
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={handleClick}
      disabled={loading}
    >
      {loading ? "..." : "Unsuppress"}
    </Button>
  );
}
