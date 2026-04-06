"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";

type WorkforceHubTab = {
  value: string;
  label: string;
};

export function WorkforceHubTabNav({
  tabs,
  activeTab,
  onChange,
}: {
  tabs: WorkforceHubTab[];
  activeTab: string;
  onChange: (value: string) => void;
}) {
  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.value === activeTab)
  );
  const active = tabs[activeIndex] ?? tabs[0];
  const previous = activeIndex > 0 ? tabs[activeIndex - 1] : null;
  const next = activeIndex < tabs.length - 1 ? tabs[activeIndex + 1] : null;

  return (
    <div className="space-y-3">
      <div className="rounded-[1.35rem] border border-white/70 bg-white/92 p-3 shadow-[0_14px_36px_-24px_rgba(25,67,74,0.32)] md:hidden">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-10 w-10 shrink-0 rounded-full"
            onClick={() => previous && onChange(previous.value)}
            disabled={!previous}
            aria-label="Previous section"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0 flex-1 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Section</p>
            <p className="truncate text-sm font-semibold">{active?.label}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-10 w-10 shrink-0 rounded-full"
            onClick={() => next && onChange(next.value)}
            disabled={!next}
            aria-label="Next section"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Select value={activeTab} onValueChange={onChange}>
          <SelectTrigger className="mt-3 h-11 w-full rounded-full bg-white">
            <SelectValue placeholder="Choose section" />
          </SelectTrigger>
          <SelectContent>
            {tabs.map((tab) => (
              <SelectItem key={tab.value} value={tab.value}>
                {tab.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="hidden overflow-x-auto pb-1 md:block">
        <TabsList className="flex min-w-max flex-nowrap justify-start gap-2 bg-transparent p-0">
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="rounded-full px-4">
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
    </div>
  );
}
