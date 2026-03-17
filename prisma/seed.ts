/**
 * prisma/seed.ts – Seed demo data for sneek-ops-dashboard
 * Run: npm run db:seed
 */

import { PrismaClient, Role, JobType, JobStatus } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database…");

  // ─── Demo Users ────────────────────────────────────────────
  const hash = (pw: string) => bcrypt.hash(pw, 10);

  const users = await Promise.all([
    db.user.upsert({
      where: { email: "admin@sneekproservices.com.au" },
      create: { name: "Admin User", email: "admin@sneekproservices.com.au", role: Role.ADMIN, passwordHash: await hash("admin123"), isActive: true },
      update: {},
    }),
    db.user.upsert({
      where: { email: "ops@sneekproservices.com.au" },
      create: { name: "Ops Manager", email: "ops@sneekproservices.com.au", role: Role.OPS_MANAGER, passwordHash: await hash("ops123"), isActive: true },
      update: {},
    }),
    db.user.upsert({
      where: { email: "cleaner@sneekproservices.com.au" },
      create: { name: "Jane Cleaner", email: "cleaner@sneekproservices.com.au", role: Role.CLEANER, phone: "+61400000001", passwordHash: await hash("cleaner123"), isActive: true },
      update: {},
    }),
    db.user.upsert({
      where: { email: "client@sneekproservices.com.au" },
      create: { name: "Demo Client", email: "client@sneekproservices.com.au", role: Role.CLIENT, passwordHash: await hash("client123"), isActive: true },
      update: {},
    }),
    db.user.upsert({
      where: { email: "laundry@sneekproservices.com.au" },
      create: { name: "Laundry Partner", email: "laundry@sneekproservices.com.au", role: Role.LAUNDRY, phone: "+61400000002", passwordHash: await hash("laundry123"), isActive: true },
      update: {},
    }),
  ]);

  console.log(`✅ Created ${users.length} demo users`);

  // ─── Demo Client + Property ────────────────────────────────
  const client = await db.client.upsert({
    where: { id: "demo-client-001" },
    create: {
      id: "demo-client-001",
      name: "Harbour View Stays",
      email: "owner@harbourview.com.au",
      phone: "+61402000001",
      address: "1 Circular Quay, Sydney NSW 2000",
      notes: "Premium Airbnb portfolio in Sydney CBD and Eastern Suburbs",
      users: { connect: { email: "client@sneekproservices.com.au" } },
    },
    update: {},
  });

  const property = await db.property.upsert({
    where: { id: "demo-property-001" },
    create: {
      id: "demo-property-001",
      clientId: client.id,
      name: "The Bondi Studio",
      address: "42 Campbell Parade",
      suburb: "Bondi Beach",
      state: "NSW",
      postcode: "2026",
      bedrooms: 2,
      bathrooms: 1,
      hasBalcony: true,
      linenBufferSets: 1,
      inventoryEnabled: true,
      defaultCheckinTime: "15:00",
      defaultCheckoutTime: "10:00",
      accessInfo: {
        lockbox: "Front gate lockbox – code 4729",
        codes: "Building entry: 1234#",
        parking: "Street parking on Campbell Parade",
      },
      notes: "Ocean view apartment. Guest favorite. Check balcony door lock carefully.",
      integration: {
        create: {
          isEnabled: false,
          icalUrl: null,
          notes: "Hospitable iCal – add URL to enable sync (read-only; manual blocks in Hospitable do NOT appear here)",
        },
      },
    },
    update: {},
  });

  console.log(`✅ Created demo client & property`);

  // ─── Inventory Items ───────────────────────────────────────
  const inventoryItems = [
    { name: "Toilet Paper (rolls)", category: "Bathroom", location: "BATHROOM", unit: "roll", supplier: "Bunnings", sku: "TP-001" },
    { name: "Hand Soap (pump)", category: "Bathroom", location: "BATHROOM", unit: "bottle", supplier: "Priceline", sku: "HS-001" },
    { name: "Shampoo (individual)", category: "Bathroom", location: "BATHROOM", unit: "bottle", supplier: "Priceline", sku: "SH-001" },
    { name: "Conditioner (individual)", category: "Bathroom", location: "BATHROOM", unit: "bottle", supplier: "Priceline", sku: "CO-001" },
    { name: "Body Wash (individual)", category: "Bathroom", location: "BATHROOM", unit: "bottle", supplier: "Priceline", sku: "BW-001" },
    { name: "Dishwashing Liquid", category: "Kitchen", location: "KITCHEN", unit: "bottle", supplier: "Woolworths", sku: "DW-001" },
    { name: "Dishwasher Tablets", category: "Kitchen", location: "KITCHEN", unit: "pack", supplier: "Woolworths", sku: "DT-001" },
    { name: "Garbage Bags (small)", category: "Cleaning", location: "CLEANERS_CUPBOARD", unit: "bag", supplier: "Bunnings", sku: "GB-001" },
    { name: "Garbage Bags (large)", category: "Cleaning", location: "CLEANERS_CUPBOARD", unit: "bag", supplier: "Bunnings", sku: "GB-002" },
    { name: "Paper Towels (roll)", category: "Cleaning", location: "KITCHEN", unit: "roll", supplier: "Costco", sku: "PT-001" },
    { name: "All-Purpose Cleaner", category: "Cleaning", location: "CLEANERS_CUPBOARD", unit: "bottle", supplier: "Bunnings", sku: "AC-001" },
    { name: "Bathroom Cleaner", category: "Cleaning", location: "CLEANERS_CUPBOARD", unit: "bottle", supplier: "Bunnings", sku: "BC-001" },
    { name: "Glass Cleaner", category: "Cleaning", location: "CLEANERS_CUPBOARD", unit: "bottle", supplier: "Bunnings", sku: "GC-001" },
    { name: "Coffee (pods)", category: "Kitchen", location: "KITCHEN", unit: "pod", supplier: "Woolworths", sku: "CF-001" },
    { name: "Tea bags (individual)", category: "Kitchen", location: "KITCHEN", unit: "bag", supplier: "Woolworths", sku: "TB-001" },
    { name: "Sugar (sachets)", category: "Kitchen", location: "KITCHEN", unit: "sachet", supplier: "Woolworths", sku: "SG-001" },
  ];

  const createdItems: Record<string, any> = {};
  for (const item of inventoryItems) {
    const created = await db.inventoryItem.upsert({
      where: { sku: item.sku },
      create: item,
      update: {},
    });
    createdItems[item.sku] = created;
  }

  console.log(`✅ Created ${inventoryItems.length} inventory items`);

  // ─── Property Stock Levels ─────────────────────────────────
  const stockLevels = [
    { sku: "TP-001", onHand: 24, parLevel: 24, reorderThreshold: 8 },
    { sku: "HS-001", onHand: 6, parLevel: 6, reorderThreshold: 2 },
    { sku: "SH-001", onHand: 12, parLevel: 12, reorderThreshold: 4 },
    { sku: "CO-001", onHand: 12, parLevel: 12, reorderThreshold: 4 },
    { sku: "BW-001", onHand: 12, parLevel: 12, reorderThreshold: 4 },
    { sku: "DW-001", onHand: 2, parLevel: 2, reorderThreshold: 1 },
    { sku: "DT-001", onHand: 20, parLevel: 20, reorderThreshold: 5 },
    { sku: "GB-001", onHand: 30, parLevel: 30, reorderThreshold: 10 },
    { sku: "GB-002", onHand: 20, parLevel: 20, reorderThreshold: 5 },
    { sku: "CF-001", onHand: 20, parLevel: 20, reorderThreshold: 6 },
  ];

  for (const level of stockLevels) {
    const item = createdItems[level.sku];
    if (!item) continue;
    const { sku, ...stockData } = level;
    await db.propertyStock.upsert({
      where: { propertyId_itemId: { propertyId: property.id, itemId: item.id } },
      create: { propertyId: property.id, itemId: item.id, ...stockData },
      update: stockData,
    });
  }

  console.log(`✅ Created stock levels for demo property`);

  // ─── Price Book ────────────────────────────────────────────
  const priceBookEntries = [
    { jobType: JobType.AIRBNB_TURNOVER, bedrooms: 1, bathrooms: 1, baseRate: 120, addOns: { oven: 40, fridge: 30, balcony: 20, heavyMess: 60, sameDay: 50 }, multipliers: { conditionLevel: { light: 0.9, standard: 1.0, heavy: 1.3 } } },
    { jobType: JobType.AIRBNB_TURNOVER, bedrooms: 2, bathrooms: 1, baseRate: 160, addOns: { oven: 40, fridge: 30, balcony: 20, heavyMess: 60, sameDay: 50 }, multipliers: { conditionLevel: { light: 0.9, standard: 1.0, heavy: 1.3 } } },
    { jobType: JobType.AIRBNB_TURNOVER, bedrooms: 2, bathrooms: 2, baseRate: 185, addOns: { oven: 40, fridge: 30, balcony: 25, heavyMess: 70, sameDay: 60 }, multipliers: { conditionLevel: { light: 0.9, standard: 1.0, heavy: 1.3 } } },
    { jobType: JobType.AIRBNB_TURNOVER, bedrooms: 3, bathrooms: 2, baseRate: 230, addOns: { oven: 45, fridge: 35, balcony: 25, heavyMess: 80, sameDay: 70 }, multipliers: { conditionLevel: { light: 0.9, standard: 1.0, heavy: 1.3 } } },
    { jobType: JobType.DEEP_CLEAN, bedrooms: 1, bathrooms: 1, baseRate: 200, addOns: { oven: 60, fridge: 50, balcony: 30, heavyMess: 80, sameDay: 80 }, multipliers: { conditionLevel: { light: 0.9, standard: 1.0, heavy: 1.4 } } },
    { jobType: JobType.DEEP_CLEAN, bedrooms: 2, bathrooms: 2, baseRate: 320, addOns: { oven: 60, fridge: 50, balcony: 30, heavyMess: 100, sameDay: 80 }, multipliers: { conditionLevel: { light: 0.9, standard: 1.0, heavy: 1.4 } } },
    { jobType: JobType.END_OF_LEASE, bedrooms: 2, bathrooms: 1, baseRate: 380, addOns: { oven: 80, fridge: 60, balcony: 40, heavyMess: 120, sameDay: 100 }, multipliers: { conditionLevel: { light: 1.0, standard: 1.0, heavy: 1.5 } } },
  ];

  for (const entry of priceBookEntries) {
    await db.priceBook.upsert({
      where: { jobType_bedrooms_bathrooms: { jobType: entry.jobType, bedrooms: entry.bedrooms, bathrooms: entry.bathrooms } },
      create: { ...entry, isActive: true },
      update: entry,
    });
  }

  console.log(`✅ Created ${priceBookEntries.length} price book entries`);

  // ─── Airbnb Turnover Form Template v1 ─────────────────────
  const airbnbTemplate = {
    sections: [
      {
        id: "s1",
        label: "Arrival & Pre-Check",
        fields: [
          { id: "s1_walkthrough", type: "upload", label: "Arrival walkthrough video (required)", required: true, mediaType: "VIDEO" },
          { id: "s1_condition", type: "textarea", label: "Overall arrival condition notes" },
          { id: "s1_damage", type: "checkbox", label: "Any damage to report?" },
          { id: "s1_damage_notes", type: "textarea", label: "Damage description (if applicable)", conditional: { fieldId: "s1_damage", value: true } },
        ],
      },
      {
        id: "s2",
        label: "Bedrooms",
        repeatable: true,
        fields: [
          { id: "s2_stripped", type: "checkbox", label: "Linen stripped and placed in laundry bag" },
          { id: "s2_fresh_linen", type: "checkbox", label: "Fresh linen fitted (flat sheet, fitted sheet, pillowcases)" },
          { id: "s2_duvet", type: "checkbox", label: "Duvet/quilt cover changed" },
          { id: "s2_vacuumed", type: "checkbox", label: "Floor vacuumed" },
          { id: "s2_mopped", type: "checkbox", label: "Bedside tables wiped" },
          { id: "s2_closet", type: "checkbox", label: "Closet checked & tidy" },
          { id: "s2_photo", type: "upload", label: "Bedroom photo (required)", required: true },
        ],
      },
      {
        id: "s3",
        label: "Living / Common Areas",
        fields: [
          { id: "s3_sofa", type: "checkbox", label: "Sofa cushions straightened / wiped if needed" },
          { id: "s3_table", type: "checkbox", label: "Dining table wiped" },
          { id: "s3_surfaces", type: "checkbox", label: "All surfaces dusted & wiped" },
          { id: "s3_tv", type: "checkbox", label: "TV & remotes wiped" },
          { id: "s3_vacuumed", type: "checkbox", label: "Floor vacuumed" },
          { id: "s3_rugs", type: "checkbox", label: "Rugs vacuumed / straightened" },
          { id: "s3_bins", type: "checkbox", label: "All bins emptied & relined" },
          { id: "s3_photo", type: "upload", label: "Living area photo (required)", required: true },
        ],
      },
      {
        id: "s4",
        label: "Kitchen",
        fields: [
          { id: "s4_bench", type: "checkbox", label: "Bench tops cleared & wiped" },
          { id: "s4_sink", type: "checkbox", label: "Sink scrubbed & polished" },
          { id: "s4_stovetop", type: "checkbox", label: "Stovetop cleaned" },
          { id: "s4_oven", type: "checkbox", label: "Oven interior wiped (if needed)" },
          { id: "s4_microwave", type: "checkbox", label: "Microwave interior cleaned" },
          { id: "s4_fridge_outside", type: "checkbox", label: "Fridge exterior wiped" },
          { id: "s4_fridge_inside", type: "checkbox", label: "Fridge interior checked & cleaned" },
          { id: "s4_under_sink", type: "checkbox", label: "Under-sink area checked (no leaks)" },
          { id: "s4_dishwasher", type: "checkbox", label: "Dishwasher emptied & filter checked" },
          { id: "s4_supplies", type: "checkbox", label: "Supplies replenished (dish soap, pods, etc.)" },
          { id: "s4_photo_kitchen", type: "upload", label: "Kitchen overview photo (required)", required: true },
          { id: "s4_photo_fridge", type: "upload", label: "Fridge interior photo (required)", required: true },
          { id: "s4_photo_microwave", type: "upload", label: "Microwave interior photo (required)", required: true },
          { id: "s4_photo_under_sink", type: "upload", label: "Under-sink photo (required)", required: true },
          {
            id: "s4_inventory",
            type: "inventory",
            label: "Items used",
            inventoryUsage: true,
            items: ["DW-001", "DT-001", "CF-001", "TB-001"],
          },
        ],
      },
      {
        id: "s5",
        label: "Bathrooms",
        fields: [
          { id: "s5_toilet", type: "checkbox", label: "Toilet scrubbed inside & out" },
          { id: "s5_tp", type: "checkbox", label: "Toilet paper replaced & folded" },
          { id: "s5_shower", type: "checkbox", label: "Shower scrubbed & glass squeegeed" },
          { id: "s5_vanity", type: "checkbox", label: "Vanity & basin scrubbed" },
          { id: "s5_mirrors", type: "checkbox", label: "Mirrors cleaned streak-free" },
          { id: "s5_towels", type: "checkbox", label: "Fresh towels hung (hand, face, bath)" },
          { id: "s5_supplies", type: "checkbox", label: "Supplies replenished (soap, shampoo, conditioner, body wash)" },
          { id: "s5_floor", type: "checkbox", label: "Floor mopped / wiped" },
          { id: "s5_photo_tp", type: "upload", label: "Toilet paper proof photo (required)", required: true },
          { id: "s5_photo_bath", type: "upload", label: "Bathroom overview photo (required)", required: true },
          {
            id: "s5_inventory",
            type: "inventory",
            label: "Bathroom supplies used",
            inventoryUsage: true,
            items: ["TP-001", "HS-001", "SH-001", "CO-001", "BW-001"],
          },
        ],
      },
      {
        id: "s6",
        label: "Balcony",
        conditional: { propertyField: "hasBalcony", value: true },
        fields: [
          { id: "s6_swept", type: "checkbox", label: "Balcony swept" },
          { id: "s6_furniture", type: "checkbox", label: "Outdoor furniture wiped" },
          { id: "s6_bbq", type: "checkbox", label: "BBQ cleaned (if applicable)" },
          { id: "s6_glass", type: "checkbox", label: "Balcony glass/rail wiped" },
          { id: "s6_photo", type: "upload", label: "Balcony photo (required)", required: true },
        ],
      },
      {
        id: "s7",
        label: "Final Vacuum & Mop",
        fields: [
          { id: "s7_vacuum_all", type: "checkbox", label: "All floors vacuumed (rooms + hallway)" },
          { id: "s7_mop_all", type: "checkbox", label: "All hard floors mopped" },
          { id: "s7_skirting", type: "checkbox", label: "Skirting boards spot-wiped" },
          { id: "s7_entrance", type: "checkbox", label: "Entrance mat shaken / wiped" },
          { id: "s7_photo_living", type: "upload", label: "Final living area photo (required)", required: true },
          { id: "s7_photo_beds", type: "upload", label: "Final bedroom photo (required)", required: true },
        ],
      },
      {
        id: "s8",
        label: "Lock-Up",
        fields: [
          { id: "s8_windows", type: "checkbox", label: "All windows closed & locked" },
          { id: "s8_doors", type: "checkbox", label: "Balcony door locked (check twice)" },
          { id: "s8_ac", type: "checkbox", label: "A/C turned off" },
          { id: "s8_lights", type: "checkbox", label: "All lights off" },
          { id: "s8_key_returned", type: "checkbox", label: "Key / lockbox secured" },
          { id: "s8_video_lockup", type: "upload", label: "Lock-up video (key/lockbox, required)", required: true, mediaType: "VIDEO" },
        ],
      },
      {
        id: "s9",
        label: "Laundry Confirmation",
        fields: [
          { id: "s9_ready", type: "laundry_confirm", label: "Is laundry ready for pickup?", required: true },
          { id: "s9_bags", type: "checkbox", label: "Bags clearly labelled (if YES)", conditional: { fieldId: "s9_ready", value: true } },
          { id: "s9_location", type: "text", label: "Bag location / notes", conditional: { fieldId: "s9_ready", value: true } },
          { id: "s9_photo", type: "upload", label: "Laundry bag photo (required if YES)", conditional: { fieldId: "s9_ready", value: true }, required: true },
        ],
      },
    ],
  };

  await db.formTemplate.upsert({
    where: { id: "airbnb-turnover-v1" },
    create: {
      id: "airbnb-turnover-v1",
      name: "Airbnb Turnover – General v1",
      serviceType: JobType.AIRBNB_TURNOVER,
      version: 1,
      isActive: true,
      schema: airbnbTemplate,
    },
    update: { schema: airbnbTemplate, isActive: true },
  });

  // Basic EOL template
  await db.formTemplate.upsert({
    where: { id: "end-of-lease-v1" },
    create: {
      id: "end-of-lease-v1",
      name: "End of Lease – Basic v1",
      serviceType: JobType.END_OF_LEASE,
      version: 1,
      isActive: true,
      schema: {
        sections: [
          { id: "eol1", label: "Pre-Clean Check", fields: [
            { id: "eol1_1", type: "upload", label: "Arrival walkthrough video", required: true },
            { id: "eol1_2", type: "textarea", label: "Condition notes" },
          ]},
          { id: "eol2", label: "Full Clean", fields: [
            { id: "eol2_1", type: "checkbox", label: "All rooms vacuumed & mopped" },
            { id: "eol2_2", type: "checkbox", label: "Oven fully cleaned inside & out" },
            { id: "eol2_3", type: "checkbox", label: "Fridge fully cleaned inside" },
            { id: "eol2_4", type: "checkbox", label: "Range hood cleaned" },
            { id: "eol2_5", type: "checkbox", label: "All bathrooms scrubbed" },
            { id: "eol2_6", type: "checkbox", label: "Walls spot-cleaned" },
            { id: "eol2_7", type: "checkbox", label: "Windows interior cleaned" },
            { id: "eol2_8", type: "checkbox", label: "Blinds/curtains dusted" },
          ]},
          { id: "eol3", label: "Final Evidence", fields: [
            { id: "eol3_1", type: "upload", label: "Kitchen final photo", required: true },
            { id: "eol3_2", type: "upload", label: "Bathrooms final photo", required: true },
            { id: "eol3_3", type: "upload", label: "Living/bedrooms final photo", required: true },
          ]},
        ],
      },
    },
    update: {},
  });

  // Basic deep clean template
  await db.formTemplate.upsert({
    where: { id: "deep-clean-v1" },
    create: {
      id: "deep-clean-v1",
      name: "Deep Clean – Basic v1",
      serviceType: JobType.DEEP_CLEAN,
      version: 1,
      isActive: true,
      schema: {
        sections: [
          { id: "dc1", label: "Pre-Clean", fields: [
            { id: "dc1_1", type: "upload", label: "Before photo", required: true },
          ]},
          { id: "dc2", label: "Deep Clean Checklist", fields: [
            { id: "dc2_1", type: "checkbox", label: "All surfaces dusted (top to bottom)" },
            { id: "dc2_2", type: "checkbox", label: "Inside all cupboards" },
            { id: "dc2_3", type: "checkbox", label: "Behind appliances" },
            { id: "dc2_4", type: "checkbox", label: "Oven interior" },
            { id: "dc2_5", type: "checkbox", label: "Fridge interior" },
            { id: "dc2_6", type: "checkbox", label: "Bathrooms deep scrub" },
            { id: "dc2_7", type: "checkbox", label: "Grout cleaned" },
            { id: "dc2_8", type: "checkbox", label: "All floors vacuumed & mopped" },
          ]},
          { id: "dc3", label: "After Evidence", fields: [
            { id: "dc3_1", type: "upload", label: "After kitchen photo", required: true },
            { id: "dc3_2", type: "upload", label: "After bathroom photo", required: true },
          ]},
        ],
      },
    },
    update: {},
  });

  console.log(`✅ Created 3 form templates (Airbnb Turnover, End of Lease, Deep Clean)`);

  // ─── Demo Job ──────────────────────────────────────────────
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  const demoJob = await db.job.upsert({
    where: { id: "demo-job-001" },
    create: {
      id: "demo-job-001",
      propertyId: property.id,
      jobType: JobType.AIRBNB_TURNOVER,
      status: JobStatus.ASSIGNED,
      scheduledDate: tomorrow,
      startTime: "10:00",
      dueTime: "14:00",
      estimatedHours: 3,
      notes: "Guest checking in at 15:00. Ensure balcony door is secured.",
    },
    update: {},
  });

  const cleaner = users.find(u => u.role === Role.CLEANER)!;
  await db.jobAssignment.upsert({
    where: { jobId_userId: { jobId: demoJob.id, userId: cleaner.id } },
    create: { jobId: demoJob.id, userId: cleaner.id, isPrimary: true },
    update: {},
  });

  console.log(`✅ Created demo job (Airbnb Turnover, tomorrow, assigned to ${cleaner.name})`);

  console.log("\n🎉 Seed complete!");
  console.log("\nDemo credentials:");
  console.log("  Admin:   admin@sneekproservices.com.au / admin123");
  console.log("  Ops:     ops@sneekproservices.com.au / ops123");
  console.log("  Cleaner: cleaner@sneekproservices.com.au / cleaner123");
  console.log("  Client:  client@sneekproservices.com.au / client123");
  console.log("  Laundry: laundry@sneekproservices.com.au / laundry123");
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
