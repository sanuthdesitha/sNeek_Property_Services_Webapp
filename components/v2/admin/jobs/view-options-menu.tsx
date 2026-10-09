"use client";

import { useRef } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal, Settings2 } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";

export function JobsViewOptionsMenu({ onOpen }: { onOpen: () => void }) {
  const openingOptions = useRef(false);
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <EButton
          variant="outline"
          aria-label="Jobs options"
          title="Jobs options"
        >
          <MoreHorizontal className="h-5 w-5" aria-hidden />
        </EButton>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          onCloseAutoFocus={(event) => {
            if (openingOptions.current) {
              event.preventDefault();
              openingOptions.current = false;
            }
          }}
          data-skin="estate"
          align="end"
          sideOffset={6}
          className="z-50 min-w-48 rounded-lg border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-1 text-[hsl(var(--e-foreground))] shadow-lg"
        >
          <Menu.Item
            onSelect={() => {
              openingOptions.current = true;
              onOpen();
            }}
            className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-3 py-2 text-sm outline-none focus:bg-[hsl(var(--e-muted))]"
          >
            <Settings2 className="h-4 w-4" aria-hidden /> View options
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
