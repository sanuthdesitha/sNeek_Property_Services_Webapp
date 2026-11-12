"use client";

/**
 * Who each laundry request goes to (the routing drawn on the Suppliers board,
 * "Pickup and drop questions go to the laundry partner"). A closed disclosure
 * after the Pipeline: it explains, it changes nothing.
 */
const ROUTES: Array<{ action: string; goesTo: string }> = [
  { action: "Pickup in doubt", goesTo: "The run's laundry partner: \"Ask laundry team: confirm pickup\" or \"move pickup\"" },
  { action: "Bags not confirmed", goesTo: "The cleaner on the job: \"Ask cleaner: bags out?\", because the cleaner leaves the bags" },
  { action: "No drop-off time yet", goesTo: "The run's laundry partner: \"Ask laundry team: drop time\"" },
  { action: "Delivered without a drop photo", goesTo: "The laundry login who delivered: \"Ask laundry team for photo\" (the whole team when the deliverer is not on it)" },
  { action: "Over turnaround", goesTo: "\"Chase supplier\" to the partner's stored email or phone; \"when will it be back?\" to the team from the run panel" },
];

export function LaundryRequestRouting() {
  return (
    <details className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 py-2 text-[0.8125rem]">
      <summary className="cursor-pointer py-1 font-[550]">Who laundry requests go to</summary>
      <p className="mt-1 text-[hsl(var(--e-muted-foreground))]">Pickup and drop questions go to the laundry partner. Each card says who the question goes to. The cleaner is only asked about the bags they leave out.</p>
      <div className="mt-2 overflow-x-auto" role="region" aria-label="Laundry request routing" tabIndex={0}>
        <table className="w-full min-w-[480px] text-left">
          <thead>
            <tr className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]"><th className="py-1 pr-3 font-[550]">Laundry action</th><th className="py-1 font-[550]">It goes to</th></tr>
          </thead>
          <tbody>
            {ROUTES.map((row) => (
              <tr key={row.action} className="border-t border-[hsl(var(--e-border))] align-top"><td className="py-1.5 pr-3">{row.action}</td><td className="py-1.5">{row.goesTo}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
