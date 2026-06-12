import { PageHeader } from "@/components/ui/page-header";

export function AdminPageShell({
  eyebrow: _eyebrow,
  title,
  description,
  actions,
  icon,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <PageHeader icon={icon} title={title} description={description} actions={actions} />
      {children}
    </div>
  );
}
