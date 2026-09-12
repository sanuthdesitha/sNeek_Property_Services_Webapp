"use client";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Check, Columns3 } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { DEFAULT_JOBS_COLUMNS, JOBS_COLUMN_KEYS, type JobsColumns } from "@/lib/jobs/workspace-state";

const labels = { client: "Client", cleaner: "Cleaner", schedule: "Schedule" };
export function JobsColumnsMenu({ columns, onChange }: { columns: JobsColumns; onChange: (columns: JobsColumns) => void }) {
  return <Menu.Root>
    <Menu.Trigger asChild>
      <EButton variant="outline" size="sm" aria-label="List columns" title="List columns"><Columns3 className="h-4 w-4" /></EButton>
    </Menu.Trigger>
    <Menu.Portal>
      <Menu.Content data-skin="estate" aria-label="List columns" sideOffset={4} align="end"
        className="z-50 min-w-44 max-w-[calc(100vw-2rem)] rounded border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-1 text-[hsl(var(--e-foreground))] shadow-lg">
        {JOBS_COLUMN_KEYS.map(key => <Menu.CheckboxItem key={key} checked={columns[key]}
          onCheckedChange={checked => onChange({ ...columns, [key]: checked === true })}
          onSelect={event => event.preventDefault()}
          className="relative flex min-h-10 cursor-default select-none items-center rounded py-2 pl-8 pr-3 text-sm outline-none focus:bg-[hsl(var(--e-muted))]">
          <Menu.ItemIndicator className="absolute left-2"><Check className="h-4 w-4" /></Menu.ItemIndicator>
          {labels[key]}
        </Menu.CheckboxItem>)}
        <Menu.Separator className="my-1 h-px bg-[hsl(var(--e-border))]" />
        <Menu.Item onSelect={() => onChange({ ...DEFAULT_JOBS_COLUMNS })}
          className="min-h-10 cursor-default rounded px-3 py-2 text-sm outline-none focus:bg-[hsl(var(--e-muted))]">Show all columns</Menu.Item>
      </Menu.Content>
    </Menu.Portal>
  </Menu.Root>;
}
