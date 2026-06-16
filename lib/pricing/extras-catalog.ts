/**
 * Common add-on EXTRAS a client (or admin) can add to any quote. Each carries a
 * default ex-GST price and a short how-to instruction so that when the quote
 * becomes a job, the extra flows into the cleaner's form as an "Additionals"
 * item complete with what to do. Prices are editable per line in the builder.
 */
export interface ExtraOption {
  id: string;
  label: string;
  price: number;
  /** How-to shown to the cleaner when this extra lands on the job form. */
  instructions: string;
}

export const EXTRAS_CATALOG: ExtraOption[] = [
  { id: "oven", label: "Inside oven clean", price: 70, instructions: "Remove racks and soak in hot soapy water. Apply oven degreaser to interior (avoid the element/fan), let dwell 15-20 min, then scrub and wipe streak-free. Refit dry racks." },
  { id: "fridge", label: "Inside fridge clean", price: 45, instructions: "Empty, remove shelves/drawers and wash in warm soapy water. Wipe interior with warm water + a little bicarb, dry, and refit. Wipe door seals." },
  { id: "rangehood", label: "Rangehood degrease", price: 25, instructions: "Remove filters and soak in hot water with degreaser/dish soap. Wipe the hood interior and exterior with degreaser; dry and refit filters." },
  { id: "interiorWindows", label: "Interior windows & glass", price: 45, instructions: "Dust frames and sills, then clean glass with glass cleaner and a microfibre or squeegee, finishing edges streak-free. Wipe tracks." },
  { id: "balcony", label: "Balcony / courtyard", price: 35, instructions: "Sweep the area, wipe railings and any outdoor furniture, remove cobwebs, and mop/hose down hard floor if accessible." },
  { id: "garage", label: "Garage sweep-out", price: 40, instructions: "Remove cobwebs, sweep the floor end-to-end, and spot-clean any obvious marks. Tidy and leave clear." },
  { id: "insideCupboards", label: "Inside cupboards & drawers", price: 40, instructions: "Empty if required, vacuum crumbs, wipe interiors and shelves with a damp microfibre, and dry before closing." },
  { id: "wallSpot", label: "Wall spot-cleaning", price: 40, instructions: "Spot-clean marks/scuffs with a damp microfibre or melamine sponge, testing an inconspicuous area first to avoid removing paint." },
  { id: "blinds", label: "Blinds / shutters dusting", price: 30, instructions: "Dust slats with a microfibre or blind brush top-to-bottom; wipe heavily soiled slats with a barely-damp cloth." },
  { id: "skirting", label: "Skirting boards & sills", price: 30, instructions: "Wipe all skirting boards, window sills and ledges with a damp microfibre to remove dust and marks." },
  { id: "washDishes", label: "Wash up dishes", price: 20, instructions: "Wash, dry and put away dishes in the sink, or load/run the dishwasher and wipe the sink down." },
  { id: "pets", label: "Pet hair treatment", price: 25, instructions: "Extra vacuum pass with a pet/upholstery tool on floors and soft furnishings; lint-roll where needed." },
  { id: "carpetSteam", label: "Carpet steam (per room)", price: 35, instructions: "Vacuum thoroughly, pre-treat stains, then hot-water extract per room. Note approximate dry time for the client." },
  { id: "mattress", label: "Mattress steam", price: 60, instructions: "Vacuum the mattress, spot-treat marks, then steam/extract the top surface. Leave to dry fully before making the bed." },
  { id: "upholstery", label: "Sofa / upholstery steam (per seat)", price: 25, instructions: "Vacuum, check colour-fastness, pre-treat soiling, then steam-extract each seat/section. Advise drying time." },
];

export const EXTRAS_BY_ID: Record<string, ExtraOption> = Object.fromEntries(
  EXTRAS_CATALOG.map((e) => [e.id, e])
);
