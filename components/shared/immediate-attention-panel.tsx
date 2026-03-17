"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export type ImmediateAttentionItem = {
  id: string;
  title: string;
  description: string;
  count: number;
  href?: string;
  actionLabel?: string;
  tone?: "critical" | "warning" | "info";
};

type Props = {
  title?: string;
  description?: string;
  emptyText?: string;
  items: ImmediateAttentionItem[];
};

function badgeVariantForTone(tone: ImmediateAttentionItem["tone"]): "destructive" | "warning" | "secondary" {
  if (tone === "critical") return "destructive";
  if (tone === "warning") return "warning";
  return "secondary";
}

export function ImmediateAttentionPanel({
  title = "Immediate Attention",
  description = "Items that need action now.",
  emptyText = "No urgent actions right now.",
  items,
}: Props) {
  const visible = items.filter((item) => Number(item.count) > 0);

  return (
    <Card className={visible.length > 0 ? "border-amber-300/80" : undefined}>
      <CardHeader className="pb-3">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
          <div>
            <CardTitle className="text-lg">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {visible.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/80 px-3 py-4 text-sm text-muted-foreground">
            {emptyText}
          </div>
        ) : (
          visible.map((item) => (
            <div
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/15 px-3 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold">{item.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={badgeVariantForTone(item.tone)}>{item.count}</Badge>
                {item.href ? (
                  <Button asChild size="sm" variant="outline">
                    <Link href={item.href}>
                      {item.actionLabel || "Open"}
                      <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                    </Link>
                  </Button>
                ) : null}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
