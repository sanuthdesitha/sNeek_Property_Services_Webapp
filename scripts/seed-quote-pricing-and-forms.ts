import { PrismaClient, JobType } from "@prisma/client";

const db = new PrismaClient();

const commonAddOns = {
  minimumPrice: 120,
  additionalBedroom: 55,
  additionalBathroom: 65,
  oven: 70,
  fridge: 45,
  fridgeFull: 75,
  freezer: 30,
  balcony: 28,
  smallBalcony: 28,
  largeBalcony: 55,
  heavyMess: 85,
  sameDay: 65,
  furnished: 35,
  pets: 30,
  outdoorArea: 45,
  largeKitchen: 45,
  grill: 45,
  rangehood: 35,
  dishwasher: 30,
  insideCupboards: 85,
  pantry: 45,
  interiorWindows: 75,
  exteriorWindows: 110,
  slidingGlassDoor: 35,
  blindsShutters: 70,
  wallSpotClean: 65,
  wallWashing: 180,
  ceilingFans: 35,
  airConditionerVents: 45,
  wardrobe: 45,
  garage: 60,
  deckPatio: 50,
  alfresco: 65,
  pergola: 55,
  carpetSteam: 85,
  changeBedsheets: 18,
  washDishes: 30,
  laundryLoad: 25,
  laundryFold: 35,
  laundryCloset: 35,
  rumpusRoom: 55,
  additionalFloor: 22,
  streetParking: 8,
  limitedParking: 18,
  standardWindowAccess: 20,
  extensiveWindows: 45,
};

const multipliers = {
  conditionLevel: {
    light: 0.95,
    standard: 1,
    heavy: 1.35,
  },
};

const priceRows = [
  [JobType.GENERAL_CLEAN, 1, 1, 140],
  [JobType.GENERAL_CLEAN, 2, 1, 175],
  [JobType.GENERAL_CLEAN, 2, 2, 210],
  [JobType.GENERAL_CLEAN, 3, 2, 260],
  [JobType.GENERAL_CLEAN, 4, 2, 320],
  [JobType.GENERAL_CLEAN, 5, 3, 410],
  [JobType.DEEP_CLEAN, 1, 1, 260],
  [JobType.DEEP_CLEAN, 2, 1, 340],
  [JobType.DEEP_CLEAN, 2, 2, 390],
  [JobType.DEEP_CLEAN, 3, 2, 470],
  [JobType.DEEP_CLEAN, 4, 2, 580],
  [JobType.DEEP_CLEAN, 5, 3, 720],
  [JobType.END_OF_LEASE, 1, 1, 360],
  [JobType.END_OF_LEASE, 2, 1, 450],
  [JobType.END_OF_LEASE, 2, 2, 520],
  [JobType.END_OF_LEASE, 3, 2, 620],
  [JobType.END_OF_LEASE, 4, 2, 760],
  [JobType.END_OF_LEASE, 5, 3, 930],
  [JobType.SPECIAL_CLEAN, 1, 1, 310],
  [JobType.SPECIAL_CLEAN, 2, 1, 390],
  [JobType.SPECIAL_CLEAN, 2, 2, 455],
  [JobType.SPECIAL_CLEAN, 3, 2, 560],
  [JobType.SPECIAL_CLEAN, 4, 2, 690],
  [JobType.SPECIAL_CLEAN, 5, 3, 850],
  [JobType.SPRING_CLEANING, 1, 1, 210],
  [JobType.SPRING_CLEANING, 2, 1, 280],
  [JobType.SPRING_CLEANING, 2, 2, 330],
  [JobType.SPRING_CLEANING, 3, 2, 410],
  [JobType.SPRING_CLEANING, 4, 2, 520],
] as const;

function checkbox(id: string, label: string) {
  return { id, type: "checkbox", label };
}

function upload(id: string, label: string, required = false) {
  return { id, type: "upload", label, required };
}

function textarea(id: string, label: string) {
  return { id, type: "textarea", label };
}

function section(id: string, label: string, fields: any[]) {
  return { id, label, fields };
}

const generalDeepTemplate = {
  sections: [
    section("arrival", "Arrival & Scope", [
      upload("arrival_photos", "Arrival photos - main areas", true),
      textarea("condition_notes", "Condition notes / client priorities"),
    ]),
    section("all_areas", "All Areas", [
      checkbox("dust_furniture", "Dust furniture"),
      checkbox("vacuum_carpets", "Vacuum carpets"),
      checkbox("sweep_mop_floors", "Sweep and mop floors"),
      checkbox("clean_mirrors", "Clean mirrors"),
      checkbox("empty_bins", "Empty rubbish bins"),
      checkbox("quick_declutter", "Quick declutter of floors"),
      checkbox("wipe_electronics", "Wipe down electronics"),
      checkbox("skirting_boards", "Wipe down skirting boards"),
      checkbox("cornices_cobwebs", "Dust cornices and remove cobwebs"),
      checkbox("window_frames_ledges", "Wipe down window frames and ledges"),
      checkbox("doors_frames_handles", "Wipe down doors, frames and handles"),
      checkbox("switches_power_points", "Wipe down switches and power points"),
    ]),
    section("kitchen", "Kitchen", [
      checkbox("kitchen_surfaces", "Clean all surfaces"),
      checkbox("appliance_exteriors", "Wipe down exterior of appliances"),
      checkbox("stovetop_oven_exterior", "Clean stovetop and oven exterior"),
      checkbox("cabinet_exteriors", "Wipe down cabinet exteriors"),
      checkbox("microwave", "Clean inside and outside microwave"),
      checkbox("splashback_benchtops", "Sanitise splashback and benchtops"),
      checkbox("sink_taps", "Polish sink and taps"),
      checkbox("inside_oven", "Extra selected: inside oven, trays and racks"),
      checkbox("rangehood_filters", "Extra selected: rangehood and filters"),
      checkbox("inside_cupboards", "Extra selected: inside cupboards, shelves and drawers"),
    ]),
    section("bathrooms_laundry", "Bathrooms & Laundry", [
      checkbox("bathroom_mirrors", "Clean mirrors"),
      checkbox("toilet", "Scrub and sanitise toilet"),
      checkbox("bathtub_shower", "Scrub clean bathtub and shower"),
      checkbox("bathroom_cabinet_exteriors", "Wipe down cabinet exteriors"),
      checkbox("bathroom_benchtops", "Wipe down benchtops"),
      checkbox("bathroom_sink_taps", "Polish sink and taps"),
      checkbox("bathroom_inside_cabinets", "Extra selected: inside cabinets, shelves and drawers"),
      checkbox("fan_vents", "Dust accessible exterior fan vents"),
    ]),
    section("bedrooms", "Bedrooms", [
      checkbox("bedroom_floors", "Vacuum carpets / sweep and mop floors"),
      checkbox("bedroom_mirrors", "Clean mirrors"),
      checkbox("make_beds", "Make beds if requested"),
      checkbox("bedroom_declutter", "Quick declutter of floors"),
      checkbox("bedroom_furniture", "Dust and wipe down furniture"),
      checkbox("wardrobe_exteriors", "Wipe down wardrobe and cupboard exteriors"),
      checkbox("wardrobe_interiors", "Extra selected: wardrobe and cupboard interiors"),
    ]),
    section("final", "Final Evidence", [
      upload("kitchen_after", "After photo - kitchen", true),
      upload("bathroom_after", "After photo - bathroom", true),
      upload("living_after", "After photo - living / bedrooms", true),
      textarea("completion_notes", "Completion notes"),
    ]),
  ],
};

function vacateTemplate(title: string) {
  return {
    sections: [
      section("arrival", `${title} Arrival`, [
        upload("walkthrough_video", "Arrival walkthrough video", true),
        textarea("condition_notes", "Condition notes / agent or client priorities"),
      ]),
      section("kitchen", "Kitchen", [
        checkbox("oven", "Clean oven inside and outside including trays"),
        checkbox("microwave", "Clean inside and outside built-in microwave"),
        checkbox("cooktop_grill", "Clean cooktop, stove and grill"),
        checkbox("rangehood", "Clean rangehood and filter"),
        checkbox("benchtops_splashback", "Clean benchtops and splashback"),
        checkbox("sink_taps", "Clean sink, taps and handles"),
        checkbox("cabinets_drawers", "Clean inside and outside cabinets and drawers including tops"),
        checkbox("pantry", "Clean pantry shelves and drawers"),
        checkbox("kitchen_windows", "Clean windows, sills and tracks internally"),
        checkbox("dishwasher", "Clean outside dishwasher and handles"),
        checkbox("kitchen_walls", "Spot clean walls"),
        upload("kitchen_evidence", "Kitchen completion photos", true),
      ]),
      section("bathrooms", "Bathrooms & Toilets", [
        checkbox("bathroom_floors", "Vacuum and mop floors"),
        checkbox("shower_screen_tiles", "Clean and descale shower screen and tiles"),
        checkbox("exhaust_vents", "Clean and dust exhaust fans and air vents"),
        checkbox("bathroom_windows", "Clean window sills and tracks internally"),
        checkbox("toilet", "Clean toilet inside and outside"),
        checkbox("mirrors_counters", "Clean mirrors and wipe all counters"),
        checkbox("basin_bathtub", "Clean basin and bathtub including taps and handles"),
        checkbox("vanity", "Clean vanity including taps and handles"),
        checkbox("skirting_boards", "Scrub and clean skirting boards"),
        checkbox("fixtures_switches", "Clean and dust lighting, switches and fixtures"),
        checkbox("bathroom_cabinets", "Clean inside and outside cabinets and drawers"),
        checkbox("mould_minerals", "Scrub mineral deposits and mould"),
        upload("bathroom_evidence", "Bathroom completion photos", true),
      ]),
      section("bedrooms_living", "Bedrooms, Living & Dining", [
        checkbox("floors", "Vacuum and mop floors"),
        checkbox("skirting_boards", "Scrub and clean skirting boards"),
        checkbox("fixtures", "Clean and dust lighting, switches and fixtures"),
        checkbox("cornices_cobwebs", "Dust cornices, walls and remove cobwebs"),
        checkbox("windows_tracks", "Clean windows, sills and tracks internally"),
        checkbox("spot_walls", "Spot clean walls"),
        checkbox("air_vents", "Clean and dust exhaust fans and air vents"),
        checkbox("cupboards_wardrobes", "Clean cupboards, drawers and built-in wardrobes inside and outside"),
        checkbox("wardrobe_tracks", "Clean wardrobe mirrors, frames and tracks"),
        checkbox("doors_frames", "Wipe clean doors and door frames"),
        upload("rooms_evidence", "Bedrooms / living completion photos", true),
      ]),
      section("entry_laundry_other", "Entry, Hallway, Laundry & Other Areas", [
        checkbox("entry_floors", "Vacuum and mop entry, hallway and laundry floors"),
        checkbox("entry_skirts", "Scrub and clean skirting boards"),
        checkbox("laundry_windows", "Clean laundry window sills and tracks internally"),
        checkbox("laundry_sink", "Clean sink, taps and tap handles"),
        checkbox("washer_dryer", "Wipe clean washer and dryer surfaces"),
        checkbox("front_door", "Front door sweep"),
        checkbox("sliding_door", "Sliding glass door inside and outside including tracks"),
        checkbox("garage_addon", "Extra selected: garage sweep and tidy"),
        checkbox("balcony_addon", "Extra selected: balcony floors, cobwebs, railings and internal glass walls"),
        upload("final_evidence", "Final lock-up / completion photos", true),
        textarea("completion_notes", "Completion notes"),
      ]),
    ],
  };
}

const hourlyTemplate = {
  sections: [
    section("priority_tasks", "Hourly Cleaning Priority Tasks", [
      textarea("client_priority_order", "Client priority order / instructions"),
      ...Array.from({ length: 12 }, (_, index) => checkbox(`task_${index + 1}`, `Priority task ${index + 1}`)),
    ]),
    section("evidence", "Evidence & Notes", [
      upload("before_photos", "Before photos for priority areas"),
      upload("after_photos", "After photos for completed priority areas", true),
      textarea("notes", "Notes, incomplete items, or extra time required"),
    ]),
  ],
};

async function upsertPriceRow(jobType: JobType, bedrooms: number, bathrooms: number, baseRate: number) {
  const existing = await db.priceBook.findFirst({ where: { jobType, bedrooms, bathrooms } });
  const data = {
    jobType,
    bedrooms,
    bathrooms,
    baseRate,
    addOns: commonAddOns,
    multipliers,
    isActive: true,
  };
  if (existing) {
    await db.priceBook.update({ where: { id: existing.id }, data: data as any });
    return;
  }
  await db.priceBook.create({ data: data as any });
}

async function upsertTemplate(id: string, name: string, serviceType: JobType, schema: any) {
  await db.formTemplate.upsert({
    where: { id },
    create: { id, name, serviceType, version: 2, isActive: true, schema },
    update: { name, serviceType, version: 2, isActive: true, schema },
  });
}

async function main() {
  for (const [jobType, bedrooms, bathrooms, baseRate] of priceRows) {
    await upsertPriceRow(jobType, bedrooms, bathrooms, baseRate);
  }

  await upsertTemplate("general-clean-miracle-v2", "General Cleaning - Miracle Checklist v2", JobType.GENERAL_CLEAN, generalDeepTemplate);
  await upsertTemplate("deep-clean-miracle-v2", "Deep Cleaning - Miracle Checklist v2", JobType.DEEP_CLEAN, generalDeepTemplate);
  await upsertTemplate("hourly-clean-miracle-v2", "Hourly Cleaning - Priority Task List v2", JobType.GENERAL_CLEAN, hourlyTemplate);
  await upsertTemplate("end-of-lease-miracle-v2", "End of Lease - Miracle Checklist v2", JobType.END_OF_LEASE, vacateTemplate("End of Lease"));
  await upsertTemplate("move-in-miracle-v2", "Move-In Cleaning - Miracle Checklist v2", JobType.SPECIAL_CLEAN, vacateTemplate("Move-In"));

  console.log("Seeded quote pricing and cleaning form templates.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
