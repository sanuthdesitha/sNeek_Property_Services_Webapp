"use client";

/**
 * The page header's "New form ▾" menu. Each item opens the existing way of
 * creating that kind of form; nothing is created by the menu itself.
 */
import { ChevronDown } from "lucide-react";
import { ERowMenu, type ERowMenuItem } from "@/components/v2/ui/row-menu";

export function NewFormMenu({ canQa, canMessages }: { canQa: boolean; canMessages: boolean }) {
  const items: ERowMenuItem[] = [
    { key: "job", label: "Job form (blank, starter or copy)", href: "/v2/admin/forms/new" },
    ...(canQa ? [{ key: "qa", label: "QA template", href: "/v2/admin/forms?tab=qa" }] : []),
    ...(canMessages ? [{ key: "message", label: "Message template", href: "/v2/admin/forms?tab=messages&view=messages" }] : []),
  ];
  return (
    <ERowMenu
      label="New form"
      items={items}
      className="h-[34px] rounded-[8px] px-3 text-[0.8125rem] font-[500]"
      trigger={
        <>
          New form <ChevronDown aria-hidden className="h-3.5 w-3.5" />
        </>
      }
    />
  );
}
