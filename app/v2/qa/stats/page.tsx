import { ECard, ECardBody, ECardHeader, ECardTitle, EPageHeader, EStatCard, EThread } from "@/components/v2/ui/primitives";

export const metadata = { title: "Stats · Estate QA" };

const BY_CLEANER = [
  ["Ana R.", "97% avg", "0 rework"],
  ["Marco P.", "94% avg", "1 rework"],
  ["Lena K.", "91% avg", "2 rework"],
];

export default function QaStatsPage() {
  return (
    <div className="space-y-6">
      <EPageHeader eyebrow="Performance" title="Stats" description="Quality across the team." />
      <section className="grid gap-4 sm:grid-cols-4">
        <EStatCard label="Avg score · week" value="93%" delta="+1 pt" />
        <EStatCard label="Pass rate" value="96%" delta="+2 pts" />
        <EStatCard label="Rework rate" value="4%" delta="-1 pt" />
        <EStatCard label="Reviews · week" value="74" delta="+9" />
      </section>
      <ECard>
        <ECardHeader><ECardTitle>By cleaner</ECardTitle></ECardHeader>
        <ECardBody className="space-y-1">
          {BY_CLEANER.map(([name, score, rework], i) => (
            <div key={i}>
              {i > 0 ? <EThread className="my-1" /> : null}
              <div className="flex items-center justify-between gap-2 py-2">
                <p className="text-[0.875rem] font-medium">{name}</p>
                <div className="flex items-center gap-4">
                  <span className="e-numeral text-[0.9375rem]">{score}</span>
                  <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{rework}</span>
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
