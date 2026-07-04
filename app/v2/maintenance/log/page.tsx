import { EBadge, ECard, ECardBody, EPageHeader, EThread } from "@/components/v2/ui/primitives";

export const metadata = { title: "Log · Estate maintenance" };

const LOG = [
  { date: "3 Jul", property: "5/44 Beach St", action: "Aircon serviced", tone: "success" as const },
  { date: "1 Jul", property: "12 Marine Parade", action: "Replaced bedside lamps", tone: "success" as const },
  { date: "28 Jun", property: "88 Ocean View Rd", action: "Sealed bathroom grout", tone: "success" as const },
  { date: "24 Jun", property: "7 Curlewis St", action: "Fixed sticking front door", tone: "success" as const },
];

export default function MaintenanceLogPage() {
  return (
    <div className="space-y-6">
      <EPageHeader eyebrow="History" title="Log" description="Completed maintenance record." />
      <ECard>
        <ECardBody className="space-y-1 pt-6">
          {LOG.map((l, i) => (
            <div key={i}>
              {i > 0 ? <EThread className="my-1" /> : null}
              <div className="flex items-center justify-between gap-3 py-2">
                <div>
                  <p className="text-[0.875rem] font-medium">{l.action}</p>
                  <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{l.property}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[0.75rem] text-[hsl(var(--e-text-faint))] tabular-nums">{l.date}</span>
                  <EBadge tone={l.tone} soft>Done</EBadge>
                </div>
              </div>
            </div>
          ))}
        </ECardBody>
      </ECard>
      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Estate preview · representative data.</p>
    </div>
  );
}
