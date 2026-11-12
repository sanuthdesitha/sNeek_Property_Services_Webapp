"use client";

/**
 * Client header controls (board: "Messages sit in the header on every screen;
 * every request starts from one Request sheet"). The envelope shows unread
 * office replies; it is offered only when the viewer may open Messages.
 */
import Link from "next/link";
import { Mail } from "lucide-react";
import { RequestButton } from "@/components/v2/client/portal/request-sheet";

export function ClientHeaderActions({ showMessages, unread }: { showMessages: boolean; unread: number | undefined }) {
  const count = typeof unread === "number" && unread > 0 ? unread : 0;
  return (
    <>
      {showMessages ? (
        <Link
          href="/v2/client/messages"
          aria-label={count > 0 ? `Messages, ${count} unread` : "Messages"}
          className="relative flex h-11 w-11 items-center justify-center rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-text-secondary))] hover:bg-[hsl(var(--e-muted))] focus-visible:outline focus-visible:outline-2"
        >
          <Mail className="h-4 w-4" aria-hidden />
          {count > 0 ? (
            <span aria-hidden className="absolute -right-1.5 -top-1.5 min-w-[1.125rem] rounded-full bg-[hsl(var(--e-danger))] px-1 text-center text-[0.625rem] font-semibold leading-[1.125rem] text-white">
              {count > 9 ? "9+" : count}
            </span>
          ) : null}
        </Link>
      ) : null}
      <RequestButton />
    </>
  );
}
