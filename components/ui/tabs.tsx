"use client";
import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { useRestorableState } from "@/hooks/use-restorable-state";
import { cn } from "@/lib/utils";

type TabsProps = React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root> & {
  memoryKey?: string;
  remember?: boolean;
};
function tabValues(children: React.ReactNode): string[] {
  return React.Children.toArray(children).flatMap((child) => {
    if (
      !React.isValidElement<{ value?: string; children?: React.ReactNode }>(
        child,
      )
    )
      return [];
    return [
      ...((child.type === TabsTrigger ||
        child.type === TabsContent ||
        child.type === TabsPrimitive.Trigger ||
        child.type === TabsPrimitive.Content) &&
      typeof child.props.value === "string"
        ? [child.props.value]
        : []),
      ...tabValues(child.props.children),
    ];
  });
}
const Tabs = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Root>,
  TabsProps
>(
  (
    {
      value,
      defaultValue,
      onValueChange,
      children,
      memoryKey,
      remember = true,
      ...props
    },
    ref,
  ) => {
    const values = React.useMemo(
      () => Array.from(new Set(tabValues(children))),
      [children],
    );
    const key = memoryKey ?? `tabs:${props.id ?? values.join("|")}`;
    const initial = value ?? defaultValue ?? values[0] ?? "";
    const [saved, setSaved] = useRestorableState(key, initial);
    const callback = React.useRef(onValueChange);
    callback.current = onValueChange;
    const restored = React.useRef<string | null>(null);
    React.useEffect(() => {
      const query = new URLSearchParams(window.location.search);
      if (query.has("tab") || query.has("view")) return;
      if (!remember || restored.current === saved || !values.includes(saved))
        return;
      restored.current = saved;
      if (value !== undefined && saved !== value) callback.current?.(saved);
    }, [saved, value, remember, values]);
    return (
      <TabsPrimitive.Root
        {...props}
        ref={ref}
        value={
          remember && value === undefined
            ? values.includes(saved)
              ? saved
              : initial
            : value
        }
        defaultValue={defaultValue}
        onValueChange={(next) => {
          if (remember) setSaved(next);
          onValueChange?.(next);
        }}
      >
        {children}
      </TabsPrimitive.Root>
    );
  },
);
Tabs.displayName = "Tabs";

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex h-10 max-w-full items-center justify-center overflow-x-auto rounded-lg bg-surface-raised p-1 text-muted-foreground",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-surface data-[state=active]:text-foreground data-[state=active]:shadow-xs",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
