import { Card, CardContent } from "@/components/ui/card";

export function AdminPageShell({
  eyebrow,
  title,
  description,
  actions,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <Card className="rounded-[2rem] border-white/70 bg-white/80 shadow-[0_20px_60px_-36px_rgba(25,67,74,0.32)]">
        <CardContent className="flex flex-col gap-4 p-6 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2">
            {eyebrow ? <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">{eyebrow}</p> : null}
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
              {description ? <p className="mt-2 max-w-3xl text-sm leading-7 text-muted-foreground">{description}</p> : null}
            </div>
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </CardContent>
      </Card>
      {children}
    </div>
  );
}
