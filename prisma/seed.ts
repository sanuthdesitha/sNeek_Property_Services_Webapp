/**
 * Seed baseline system data for sneek-ops-dashboard.
 *
 * Commands:
 * - npm run db:seed
 * - npm run db:seed:demo
 */

import { PrismaClient, Role, JobType, JobStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
import { DEFAULT_INVENTORY_ITEMS } from "../lib/inventory/default-items";
import { DEFAULT_SETTINGS } from "../lib/settings";

const db = new PrismaClient();
const includeDemo = process.env.SEED_INCLUDE_DEMO === "1";

async function seedDemoData() {
  const hash = (pw: string) => bcrypt.hash(pw, 10);

  const users = await Promise.all([
    db.user.upsert({
      where: { email: "admin@sneekproservices.com.au" },
      create: {
        name: "Admin User",
        email: "admin@sneekproservices.com.au",
        role: Role.ADMIN,
        passwordHash: await hash("admin123"),
        isActive: true,
      },
      update: {},
    }),
    db.user.upsert({
      where: { email: "ops@sneekproservices.com.au" },
      create: {
        name: "Ops Manager",
        email: "ops@sneekproservices.com.au",
        role: Role.OPS_MANAGER,
        passwordHash: await hash("ops123"),
        isActive: true,
      },
      update: {},
    }),
    db.user.upsert({
      where: { email: "cleaner@sneekproservices.com.au" },
      create: {
        name: "Jane Cleaner",
        email: "cleaner@sneekproservices.com.au",
        role: Role.CLEANER,
        phone: "+61400000001",
        passwordHash: await hash("cleaner123"),
        isActive: true,
      },
      update: {},
    }),
    db.user.upsert({
      where: { email: "client@sneekproservices.com.au" },
      create: {
        name: "Demo Client",
        email: "client@sneekproservices.com.au",
        role: Role.CLIENT,
        passwordHash: await hash("client123"),
        isActive: true,
      },
      update: {},
    }),
    db.user.upsert({
      where: { email: "laundry@sneekproservices.com.au" },
      create: {
        name: "Laundry Partner",
        email: "laundry@sneekproservices.com.au",
        role: Role.LAUNDRY,
        phone: "+61400000002",
        passwordHash: await hash("laundry123"),
        isActive: true,
      },
      update: {},
    }),
  ]);

  console.log(`Created ${users.length} demo users`);

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
        lockbox: "Front gate lockbox - code 4729",
        codes: "Building entry: 1234#",
        parking: "Street parking on Campbell Parade",
      },
      notes: "Ocean view apartment. Guest favorite. Check balcony door lock carefully.",
      integration: {
        create: {
          isEnabled: false,
          icalUrl: null,
          notes: "Hospitable iCal - add URL to enable sync (read-only; manual blocks in Hospitable do NOT appear here)",
        },
      },
    },
    update: {},
  });

  console.log("Created demo client and property");

  for (const item of DEFAULT_INVENTORY_ITEMS) {
    const record = await db.inventoryItem.findUnique({
      where: { sku: item.sku },
      select: { id: true },
    });

    if (!record) continue;

    await db.propertyStock.upsert({
      where: {
        propertyId_itemId: {
          propertyId: property.id,
          itemId: record.id,
        },
      },
      create: {
        propertyId: property.id,
        itemId: record.id,
        onHand: item.defaultParLevel,
        parLevel: item.defaultParLevel,
        reorderThreshold: item.defaultThreshold,
      },
      update: {
        onHand: item.defaultParLevel,
        parLevel: item.defaultParLevel,
        reorderThreshold: item.defaultThreshold,
      },
    });
  }

  console.log("Created stock levels for demo property");

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  const demoJob = await db.job.upsert({
    where: { id: "demo-job-001" },
    create: {
      id: "demo-job-001",
      jobNumber: "JOB-000001",
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

  const cleaner = users.find((user) => user.role === Role.CLEANER);
  if (cleaner) {
    await db.jobAssignment.upsert({
      where: { jobId_userId: { jobId: demoJob.id, userId: cleaner.id } },
      create: { jobId: demoJob.id, userId: cleaner.id, isPrimary: true },
      update: {},
    });
  }

  console.log("Created demo job");
  console.log("");
  console.log("Demo credentials:");
  console.log("  Admin:   admin@sneekproservices.com.au / admin123");
  console.log("  Ops:     ops@sneekproservices.com.au / ops123");
  console.log("  Cleaner: cleaner@sneekproservices.com.au / cleaner123");
  console.log("  Client:  client@sneekproservices.com.au / client123");
  console.log("  Laundry: laundry@sneekproservices.com.au / laundry123");
}

async function main() {
  console.log(`Seeding database (${includeDemo ? "system + demo" : "system only"})...`);

  const createdItems: Record<string, string> = {};
  for (const item of DEFAULT_INVENTORY_ITEMS) {
    const created = await db.inventoryItem.upsert({
      where: { sku: item.sku },
      create: {
        sku: item.sku,
        name: item.name,
        category: item.category,
        location: item.location,
        unit: item.unit,
        supplier: item.supplier,
        isActive: true,
      },
      update: {
        name: item.name,
        category: item.category,
        location: item.location,
        unit: item.unit,
        supplier: item.supplier,
        isActive: true,
      },
      select: { id: true, sku: true },
    });
    if (created.sku) {
      createdItems[created.sku] = created.id;
    }
  }

  console.log(`Created ${DEFAULT_INVENTORY_ITEMS.length} inventory items`);

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
      where: {
        jobType_bedrooms_bathrooms: {
          jobType: entry.jobType,
          bedrooms: entry.bedrooms,
          bathrooms: entry.bathrooms,
        },
      },
      create: { ...entry, isActive: true },
      update: entry,
    });
  }

  console.log(`Created ${priceBookEntries.length} price book entries`);

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
          { id: "s2_closet", type: "checkbox", label: "Closet checked and tidy" },
          { id: "s2_photo", type: "upload", label: "Bedroom photo (required)", required: true },
        ],
      },
      {
        id: "s3",
        label: "Living / Common Areas",
        fields: [
          { id: "s3_sofa", type: "checkbox", label: "Sofa cushions straightened / wiped if needed" },
          { id: "s3_table", type: "checkbox", label: "Dining table wiped" },
          { id: "s3_surfaces", type: "checkbox", label: "All surfaces dusted and wiped" },
          { id: "s3_tv", type: "checkbox", label: "TV and remotes wiped" },
          { id: "s3_vacuumed", type: "checkbox", label: "Floor vacuumed" },
          { id: "s3_rugs", type: "checkbox", label: "Rugs vacuumed / straightened" },
          { id: "s3_bins", type: "checkbox", label: "All bins emptied and relined" },
          { id: "s3_photo", type: "upload", label: "Living area photo (required)", required: true },
        ],
      },
      {
        id: "s4",
        label: "Kitchen",
        fields: [
          { id: "s4_bench", type: "checkbox", label: "Bench tops cleared and wiped" },
          { id: "s4_sink", type: "checkbox", label: "Sink scrubbed and polished" },
          { id: "s4_stovetop", type: "checkbox", label: "Stovetop cleaned" },
          { id: "s4_oven", type: "checkbox", label: "Oven interior wiped (if needed)" },
          { id: "s4_microwave", type: "checkbox", label: "Microwave interior cleaned" },
          { id: "s4_fridge_outside", type: "checkbox", label: "Fridge exterior wiped" },
          { id: "s4_fridge_inside", type: "checkbox", label: "Fridge interior checked and cleaned" },
          { id: "s4_under_sink", type: "checkbox", label: "Under-sink area checked (no leaks)" },
          { id: "s4_dishwasher", type: "checkbox", label: "Dishwasher emptied and filter checked" },
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
            items: ["DEF-PAPERTOWEL", "DEF-SCRUBPAD", "DEF-COFFEECAPS", "DEF-TEABAG"],
          },
        ],
      },
      {
        id: "s5",
        label: "Bathrooms",
        fields: [
          { id: "s5_toilet", type: "checkbox", label: "Toilet scrubbed inside and out" },
          { id: "s5_tp", type: "checkbox", label: "Toilet paper replaced and folded" },
          { id: "s5_shower", type: "checkbox", label: "Shower scrubbed and glass squeegeed" },
          { id: "s5_vanity", type: "checkbox", label: "Vanity and basin scrubbed" },
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
            items: ["DEF-TP", "DEF-HANDSOAP", "DEF-SHAMPOO", "DEF-CONDITIONER", "DEF-BODYWASH"],
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
          { id: "s8_windows", type: "checkbox", label: "All windows closed and locked" },
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
      name: "Airbnb Turnover - General v1",
      serviceType: JobType.AIRBNB_TURNOVER,
      version: 1,
      isActive: true,
      schema: airbnbTemplate,
    },
    update: { schema: airbnbTemplate, isActive: true },
  });

  await db.formTemplate.upsert({
    where: { id: "end-of-lease-v1" },
    create: {
      id: "end-of-lease-v1",
      name: "End of Lease - Basic v1",
      serviceType: JobType.END_OF_LEASE,
      version: 1,
      isActive: true,
      schema: {
        sections: [
          {
            id: "eol1",
            label: "Pre-Clean Check",
            fields: [
              { id: "eol1_1", type: "upload", label: "Arrival walkthrough video", required: true },
              { id: "eol1_2", type: "textarea", label: "Condition notes" },
            ],
          },
          {
            id: "eol2",
            label: "Full Clean",
            fields: [
              { id: "eol2_1", type: "checkbox", label: "All rooms vacuumed and mopped" },
              { id: "eol2_2", type: "checkbox", label: "Oven fully cleaned inside and out" },
              { id: "eol2_3", type: "checkbox", label: "Fridge fully cleaned inside" },
              { id: "eol2_4", type: "checkbox", label: "Range hood cleaned" },
              { id: "eol2_5", type: "checkbox", label: "All bathrooms scrubbed" },
              { id: "eol2_6", type: "checkbox", label: "Walls spot-cleaned" },
              { id: "eol2_7", type: "checkbox", label: "Windows interior cleaned" },
              { id: "eol2_8", type: "checkbox", label: "Blinds/curtains dusted" },
            ],
          },
          {
            id: "eol3",
            label: "Final Evidence",
            fields: [
              { id: "eol3_1", type: "upload", label: "Kitchen final photo", required: true },
              { id: "eol3_2", type: "upload", label: "Bathrooms final photo", required: true },
              { id: "eol3_3", type: "upload", label: "Living/bedrooms final photo", required: true },
            ],
          },
        ],
      },
    },
    update: {},
  });

  await db.formTemplate.upsert({
    where: { id: "deep-clean-v1" },
    create: {
      id: "deep-clean-v1",
      name: "Deep Clean - Basic v1",
      serviceType: JobType.DEEP_CLEAN,
      version: 1,
      isActive: true,
      schema: {
        sections: [
          {
            id: "dc1",
            label: "Pre-Clean",
            fields: [{ id: "dc1_1", type: "upload", label: "Before photo", required: true }],
          },
          {
            id: "dc2",
            label: "Deep Clean Checklist",
            fields: [
              { id: "dc2_1", type: "checkbox", label: "All surfaces dusted (top to bottom)" },
              { id: "dc2_2", type: "checkbox", label: "Inside all cupboards" },
              { id: "dc2_3", type: "checkbox", label: "Behind appliances" },
              { id: "dc2_4", type: "checkbox", label: "Oven interior" },
              { id: "dc2_5", type: "checkbox", label: "Fridge interior" },
              { id: "dc2_6", type: "checkbox", label: "Bathrooms deep scrub" },
              { id: "dc2_7", type: "checkbox", label: "Grout cleaned" },
              { id: "dc2_8", type: "checkbox", label: "All floors vacuumed and mopped" },
            ],
          },
          {
            id: "dc3",
            label: "After Evidence",
            fields: [
              { id: "dc3_1", type: "upload", label: "After kitchen photo", required: true },
              { id: "dc3_2", type: "upload", label: "After bathroom photo", required: true },
            ],
          },
        ],
      },
    },
    update: {},
  });

  console.log("Created 3 form templates (Airbnb Turnover, End of Lease, Deep Clean)");

  await db.appSetting.upsert({
    where: { key: "app" },
    create: { key: "app", value: DEFAULT_SETTINGS as any },
    update: {},
  });

  console.log("Ensured default app settings");

  if (includeDemo) {
    await seedDemoData();
  } else {
    console.log("Skipped demo users, client, property, stock, and job");
  }

  console.log("");
  console.log("Seed complete.");
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
