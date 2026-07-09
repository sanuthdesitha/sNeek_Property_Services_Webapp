/**
 * Common add-on EXTRAS a client (or admin) can add to any quote. Each carries a
 * default ex-GST price and a short how-to instruction so that when the quote
 * becomes a job, the extra flows into the cleaner's form as an "Additionals"
 * item complete with what to do. Prices are editable per line in the builder.
 *
 * Extras are grouped by `category` so the quote builder can present them in tidy
 * sections (kitchen, tidy-up, laundry, fixtures, outdoor, specialist). Ids and
 * prices of existing entries are kept stable — historical quotes reference them.
 */
export type ExtraCategory =
  | "kitchen"
  | "tidyUp"
  | "laundry"
  | "fixtures"
  | "outdoor"
  | "specialist";

export interface ExtraOption {
  id: string;
  label: string;
  price: number;
  /** Grouping in the quote builder. Defaults to "kitchen" if omitted. */
  category?: ExtraCategory;
  /** How-to shown to the cleaner when this extra lands on the job form. */
  instructions: string;
}

export const EXTRA_CATEGORIES: { id: ExtraCategory; label: string }[] = [
  { id: "kitchen", label: "Kitchen & appliances" },
  { id: "tidyUp", label: "Tidy-up & organising" },
  { id: "laundry", label: "Laundry" },
  { id: "fixtures", label: "Windows, walls & fixtures" },
  { id: "outdoor", label: "Outdoor areas" },
  { id: "specialist", label: "Specialist / deep treatments" },
];

export const EXTRAS_CATALOG: ExtraOption[] = [
  // ── Kitchen & appliances ────────────────────────────────────────────────
  { id: "oven", label: "Inside oven clean", price: 70, category: "kitchen", instructions: "Remove racks and soak in hot soapy water. Apply oven degreaser to interior (avoid the element/fan), let dwell 15-20 min, then scrub and wipe streak-free. Refit dry racks." },
  { id: "fridge", label: "Inside fridge clean", price: 45, category: "kitchen", instructions: "Empty, remove shelves/drawers and wash in warm soapy water. Wipe interior with warm water + a little bicarb, dry, and refit. Wipe door seals." },
  { id: "freezer", label: "Inside freezer clean", price: 40, category: "kitchen", instructions: "Empty and, if already defrosted, wipe interior and drawers with warm water + a little bicarb, dry and refit. Do not force-defrost ice build-up." },
  { id: "rangehood", label: "Rangehood degrease", price: 25, category: "kitchen", instructions: "Remove filters and soak in hot water with degreaser/dish soap. Wipe the hood interior and exterior with degreaser; dry and refit filters." },
  { id: "microwave", label: "Inside microwave clean", price: 15, category: "kitchen", instructions: "Steam a bowl of water to loosen grime, then wipe interior, turntable and door with multipurpose cleaner. Dry and refit the turntable." },
  { id: "dishwasher", label: "Dishwasher wipe & filter", price: 20, category: "kitchen", instructions: "Remove and rinse the filter, wipe the interior, door edges and seals, and clean the detergent drawer. Refit the filter." },
  { id: "insideCupboards", label: "Inside cupboards & drawers", price: 40, category: "kitchen", instructions: "Empty if required, vacuum crumbs, wipe interiors and shelves with a damp microfibre, and dry before closing." },
  { id: "washDishes", label: "Wash up dishes", price: 20, category: "kitchen", instructions: "Wash, dry and put away dishes in the sink, or load/run the dishwasher and wipe the sink down." },

  // ── Tidy-up & organising ────────────────────────────────────────────────
  { id: "generalTidy", label: "General tidy & declutter", price: 35, category: "tidyUp", instructions: "Straighten and neaten each room — square up cushions and furnishings, clear surfaces of clutter into a tidy pile/basket, and reset the space to a presentable state. Do not discard anything." },
  { id: "makeBeds", label: "Make / change beds", price: 15, category: "tidyUp", instructions: "Make each bed neatly, or strip and remake with fresh linen if supplied. Fold throws and arrange pillows." },
  { id: "putAway", label: "Put items away / reset rooms", price: 25, category: "tidyUp", instructions: "Return out-of-place items to their homes and reset living areas — shoes, dishes, toys, remotes, laundry — leaving each room presentable." },
  { id: "kidsRooms", label: "Kids' rooms & toy tidy", price: 25, category: "tidyUp", instructions: "Pack toys into their bins/boxes, straighten beds and shelves, and clear the floor so the room is safe and tidy." },
  { id: "wardrobeTidy", label: "Wardrobe / linen press tidy", price: 30, category: "tidyUp", instructions: "Neatly fold and stack folded items, align hanging clothes, and square up shelves. Organise, do not deep-declutter or discard." },
  { id: "foldClothes", label: "Fold clothes left out", price: 15, category: "tidyUp", instructions: "Fold clean clothing left on beds/chairs and stack neatly for the client to put away." },

  // ── Laundry ─────────────────────────────────────────────────────────────
  { id: "laundryWash", label: "Wash & tumble-dry (per load)", price: 25, category: "laundry", instructions: "Sort and run one machine load, transfer to the dryer (or hang if requested), then fold. Use the client's detergent and follow care labels." },
  { id: "laundryWashFold", label: "Wash, dry & fold linen (per set)", price: 35, category: "laundry", instructions: "Wash one linen set (sheets, pillowcases, towels), dry fully, then fold and stack neatly ready for the next changeover." },
  { id: "stripRemake", label: "Strip & remake beds with fresh linen", price: 20, category: "laundry", instructions: "Strip used linen, bag for laundering, and remake each bed with fresh supplied linen — hospital corners, pillows cased, throw folded." },
  { id: "ironing", label: "Ironing (per basket)", price: 40, category: "laundry", instructions: "Iron the supplied basket of clothing/linen following care labels, hang or fold, and present neatly. Note anything unsuitable to iron." },
  { id: "hangWashing", label: "Hang out / bring in washing", price: 10, category: "laundry", instructions: "Hang the finished load on the line/airer, or bring in and fold dry washing. Weather-check before hanging outside." },
  { id: "laundryPickup", label: "Off-site laundry pickup & return", price: 30, category: "laundry", instructions: "Collect the bagged linen for off-site laundering and return clean folded linen on the agreed run. Log bag counts on pickup and drop-off." },

  // ── Windows, walls & fixtures ───────────────────────────────────────────
  { id: "interiorWindows", label: "Interior windows & glass", price: 45, category: "fixtures", instructions: "Dust frames and sills, then clean glass with glass cleaner and a microfibre or squeegee, finishing edges streak-free. Wipe tracks." },
  { id: "exteriorWindows", label: "Exterior windows (ground floor)", price: 55, category: "fixtures", instructions: "Clean reachable ground-floor exterior glass with a squeegee/microfibre and glass cleaner, finishing streak-free. Wipe frames and sills. No work at height." },
  { id: "wallSpot", label: "Wall spot-cleaning", price: 40, category: "fixtures", instructions: "Spot-clean marks/scuffs with a damp microfibre or melamine sponge, testing an inconspicuous area first to avoid removing paint." },
  { id: "wallWash", label: "Full wall wash (per room)", price: 60, category: "fixtures", instructions: "Wash walls top-to-bottom with a diluted sugar-soap solution and microfibre, rinsing as you go. Test paint-fastness first; keep water off switches/outlets." },
  { id: "cobwebs", label: "Ceiling & cornice cobweb removal", price: 20, category: "fixtures", instructions: "Remove cobwebs from ceilings, cornices and corners with an extendable duster throughout the property." },
  { id: "lightFittings", label: "Light fittings & switches", price: 30, category: "fixtures", instructions: "Wipe light switches and reachable fittings/shades with a barely-damp microfibre. Do not remove fittings or work live wiring." },
  { id: "ceilingFans", label: "Ceiling fans dusting", price: 20, category: "fixtures", instructions: "Dust each fan blade top and bottom with a microfibre or fan duster, wiping heavier build-up with a barely-damp cloth." },
  { id: "exhaustFans", label: "Exhaust fan covers", price: 20, category: "fixtures", instructions: "Remove reachable exhaust-fan covers, wash, dry and refit. Wipe the surround. Do not dismantle the motor." },
  { id: "blinds", label: "Blinds / shutters dusting", price: 30, category: "fixtures", instructions: "Dust slats with a microfibre or blind brush top-to-bottom; wipe heavily soiled slats with a barely-damp cloth." },
  { id: "skirting", label: "Skirting boards & sills", price: 30, category: "fixtures", instructions: "Wipe all skirting boards, window sills and ledges with a damp microfibre to remove dust and marks." },
  { id: "doorsFrames", label: "Doors, frames & handles", price: 25, category: "fixtures", instructions: "Wipe doors, frames and handles to remove marks and fingerprints, paying attention to high-touch points." },

  // ── Outdoor areas ───────────────────────────────────────────────────────
  { id: "balcony", label: "Balcony / courtyard", price: 35, category: "outdoor", instructions: "Sweep the area, wipe railings and any outdoor furniture, remove cobwebs, and mop/hose down hard floor if accessible." },
  { id: "patioFurniture", label: "Patio & outdoor furniture wipe", price: 30, category: "outdoor", instructions: "Wipe down outdoor tables and chairs, remove cobwebs, and sweep the surrounding area." },
  { id: "bbqClean", label: "BBQ clean", price: 45, category: "outdoor", instructions: "Scrape and clean the grill plates, empty the fat tray, and wipe the hood and exterior. Do not dismantle gas fittings." },
  { id: "garage", label: "Garage sweep-out", price: 40, category: "outdoor", instructions: "Remove cobwebs, sweep the floor end-to-end, and spot-clean any obvious marks. Tidy and leave clear." },
  { id: "binClean", label: "Wheelie bin clean", price: 20, category: "outdoor", instructions: "Rinse and scrub the bin interior with disinfectant, wipe the lid and exterior, and leave to air-dry." },
  { id: "entrySweep", label: "Entry / porch sweep & wipe", price: 15, category: "outdoor", instructions: "Sweep the entry/porch, remove cobwebs, and wipe the door, frame and any nearby marks for a tidy first impression." },

  // ── Specialist / deep treatments ────────────────────────────────────────
  { id: "carpetSteam", label: "Carpet steam (per room)", price: 35, category: "specialist", instructions: "Vacuum thoroughly, pre-treat stains, then hot-water extract per room. Note approximate dry time for the client." },
  { id: "mattress", label: "Mattress steam", price: 60, category: "specialist", instructions: "Vacuum the mattress, spot-treat marks, then steam/extract the top surface. Leave to dry fully before making the bed." },
  { id: "upholstery", label: "Sofa / upholstery steam (per seat)", price: 25, category: "specialist", instructions: "Vacuum, check colour-fastness, pre-treat soiling, then steam-extract each seat/section. Advise drying time." },
  { id: "tileGrout", label: "Tile & grout deep-scrub (per bathroom)", price: 55, category: "specialist", instructions: "Apply grout/tile cleaner, dwell, then scrub grout lines with a stiff brush and rinse. Squeegee and buff tiles streak-free." },
  { id: "moldSpot", label: "Mould spot-treatment", price: 40, category: "specialist", instructions: "Ventilate, apply an appropriate mould treatment to affected surfaces with PPE on, dwell per product, then wipe. Flag any large/structural mould to the office." },
  { id: "pets", label: "Pet hair treatment", price: 25, category: "specialist", instructions: "Extra vacuum pass with a pet/upholstery tool on floors and soft furnishings; lint-roll where needed." },
  { id: "ecoProducts", label: "Green / eco products only", price: 15, category: "specialist", instructions: "Use only the client's supplied or approved eco/low-tox products throughout the clean. Avoid bleach and strong solvents." },
];

export const EXTRAS_BY_ID: Record<string, ExtraOption> = Object.fromEntries(
  EXTRAS_CATALOG.map((e) => [e.id, e])
);

/** Extras grouped by category, in display order, for the quote builder. */
export const EXTRAS_BY_CATEGORY: { id: ExtraCategory; label: string; options: ExtraOption[] }[] =
  EXTRA_CATEGORIES.map((c) => ({
    ...c,
    options: EXTRAS_CATALOG.filter((e) => (e.category ?? "kitchen") === c.id),
  })).filter((g) => g.options.length > 0);
