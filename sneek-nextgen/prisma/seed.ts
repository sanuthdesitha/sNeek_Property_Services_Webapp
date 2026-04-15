import { PrismaClient, Role, JobType, NotificationRecipientRole, NotificationChannel } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { hash } from "@/lib/auth/crypto";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding database...");

  // ── Users ──
  const adminPassword = await hash("admin123");
  const opsPassword = await hash("ops123");
  const cleanerPassword = await hash("cleaner123");
  const clientPassword = await hash("client123");
  const laundryPassword = await hash("laundry123");

  const users = await Promise.all([
    prisma.user.upsert({
      where: { email: "admin@sneekops.com.au" },
      update: {},
      create: {
        email: "admin@sneekops.com.au",
        name: "Admin User",
        passwordHash: adminPassword,
        role: Role.ADMIN,
        phone: "+61400000001",
        isActive: true,
      },
    }),
    prisma.user.upsert({
      where: { email: "ops@sneekops.com.au" },
      update: {},
      create: {
        email: "ops@sneekops.com.au",
        name: "Ops Manager",
        passwordHash: opsPassword,
        role: Role.OPS_MANAGER,
        phone: "+61400000002",
        isActive: true,
      },
    }),
    prisma.user.upsert({
      where: { email: "cleaner@sneekops.com.au" },
      update: {},
      create: {
        email: "cleaner@sneekops.com.au",
        name: "John Cleaner",
        passwordHash: cleanerPassword,
        role: Role.CLEANER,
        phone: "+61400000003",
        hourlyRate: 32,
        isActive: true,
      },
    }),
    prisma.user.upsert({
      where: { email: "client@sneekops.com.au" },
      update: {},
      create: {
        email: "client@sneekops.com.au",
        name: "Sarah Client",
        passwordHash: clientPassword,
        role: Role.CLIENT,
        phone: "+61400000004",
        isActive: true,
      },
    }),
    prisma.user.upsert({
      where: { email: "laundry@sneekops.com.au" },
      update: {},
      create: {
        email: "laundry@sneekops.com.au",
        name: "Laundry Service",
        passwordHash: laundryPassword,
        role: Role.LAUNDRY,
        phone: "+61400000005",
        isActive: true,
      },
    }),
  ]);

  console.log(`Created ${users.length} users`);

  // ── Client ──
  const client = await prisma.client.upsert({
    where: { id: "client_001" },
    update: {},
    create: {
      id: "client_001",
      name: "Harbour Properties Pty Ltd",
      email: "sarah@harbourproperties.com.au",
      phone: "+61400000004",
      address: "Suite 5, 100 George St, Sydney NSW 2000",
      notes: "Primary client - multiple properties",
      isActive: true,
    },
  });

  console.log(`Created client: ${client.name}`);

  // ── Properties ──
  const properties = await Promise.all([
    prisma.property.upsert({
      where: { id: "prop_001" },
      update: {},
      create: {
        id: "prop_001",
        clientId: client.id,
        name: "Harbour View Apartment",
        address: "123 Harbour Street",
        suburb: "Sydney",
        state: "NSW",
        postcode: "2000",
        notes: "Luxury apartment with harbour views",
        linenBufferSets: 3,
        inventoryEnabled: true,
        defaultCheckinTime: "14:00",
        defaultCheckoutTime: "10:00",
        hasBalcony: true,
        bedrooms: 2,
        bathrooms: 1,
        latitude: -33.8688,
        longitude: 151.2093,
        accessCode: "1234",
        keyLocation: "Lockbox at front door",
        accessNotes: "Use side entrance, lockbox code 1234",
        laundryEnabled: true,
        isActive: true,
      },
    }),
    prisma.property.upsert({
      where: { id: "prop_002" },
      update: {},
      create: {
        id: "prop_002",
        clientId: client.id,
        name: "Beach House",
        address: "45 Ocean Avenue",
        suburb: "Bondi",
        state: "NSW",
        postcode: "2026",
        notes: "Beachfront property",
        linenBufferSets: 4,
        inventoryEnabled: true,
        defaultCheckinTime: "15:00",
        defaultCheckoutTime: "10:00",
        hasBalcony: false,
        bedrooms: 3,
        bathrooms: 2,
        latitude: -33.8915,
        longitude: 151.2767,
        accessCode: "5678",
        keyLocation: "Under the mat",
        accessNotes: "Street parking available",
        laundryEnabled: true,
        isActive: true,
      },
    }),
  ]);

  console.log(`Created ${properties.length} properties`);

  // ── Inventory Items ──
  const inventoryItems = [
    { name: "All-Purpose Cleaner", sku: "APC-001", category: "CHEMICALS", unit: "bottle" },
    { name: "Glass Cleaner", sku: "GC-001", category: "CHEMICALS", unit: "bottle" },
    { name: "Bathroom Disinfectant", sku: "BD-001", category: "CHEMICALS", unit: "bottle" },
    { name: "Floor Cleaner", sku: "FC-001", category: "CHEMICALS", unit: "bottle" },
    { name: "Microfiber Cloths", sku: "MC-001", category: "CLOTHS", unit: "pack" },
    { name: "Mop Head", sku: "MH-001", category: "EQUIPMENT", unit: "unit" },
    { name: "Toilet Paper (Roll)", sku: "TP-001", category: "CONSUMABLES", unit: "roll" },
    { name: "Hand Soap (500ml)", sku: "HS-001", category: "CONSUMABLES", unit: "bottle" },
    { name: "Bin Liners (Box)", sku: "BL-001", category: "CONSUMABLES", unit: "box" },
    { name: "Sponge Pack", sku: "SP-001", category: "CLOTHS", unit: "pack" },
  ];

  const createdItems = [];
  for (const item of inventoryItems) {
    const created = await prisma.inventoryItem.upsert({
      where: { sku: item.sku },
      update: {},
      create: item,
    });
    createdItems.push(created);
  }

  console.log(`Created ${createdItems.length} inventory items`);

  // ── Property Stock Levels ──
  for (const property of properties) {
    for (const item of createdItems) {
      await prisma.propertyStock.upsert({
        where: { propertyId_itemId: { propertyId: property.id, itemId: item.id } },
        update: {},
        create: {
          propertyId: property.id,
          itemId: item.id,
          onHand: Math.floor(Math.random() * 10) + 5,
          parLevel: 10,
          reorderThreshold: 3,
        },
      });
    }
  }

  console.log("Set up property stock levels");

  // ── Form Templates ──
  const airbnbTemplate = await prisma.formTemplate.upsert({
    where: { id: "template_airbnb" },
    update: {},
    create: {
      id: "template_airbnb",
      name: "Airbnb Turnover Checklist",
      serviceType: JobType.AIRBNB_TURNOVER,
      version: 1,
      isActive: true,
      schema: {
        sections: [
          {
            id: "bedrooms",
            title: "Bedrooms",
            fields: [
              { id: "bed_strip", label: "Strip and remake beds", type: "checkbox", required: true },
              { id: "vacuum_under_beds", label: "Vacuum under beds", type: "checkbox", required: true },
              { id: "dust_surfaces", label: "Dust all surfaces", type: "checkbox", required: true },
              { id: "check_lost_items", label: "Check for lost items", type: "checkbox", required: true },
            ],
          },
          {
            id: "bathrooms",
            title: "Bathrooms",
            fields: [
              { id: "sanitize_all", label: "Sanitize all surfaces", type: "checkbox", required: true },
              { id: "restock_toiletries", label: "Restock toiletries", type: "checkbox", required: true },
              { id: "check_towels", label: "Check towel count", type: "checkbox", required: true },
              { id: "clean_mirror", label: "Clean mirrors", type: "checkbox", required: true },
            ],
          },
          {
            id: "kitchen",
            title: "Kitchen",
            fields: [
              { id: "clean_appliances", label: "Clean all appliances", type: "checkbox", required: true },
              { id: "wipe_surfaces", label: "Wipe all surfaces", type: "checkbox", required: true },
              { id: "mop_floor", label: "Mop floor", type: "checkbox", required: true },
              { id: "empty_bin", label: "Empty bin", type: "checkbox", required: true },
              { id: "run_dishwasher", label: "Run dishwasher", type: "checkbox", required: false },
            ],
          },
          {
            id: "living",
            title: "Living Areas",
            fields: [
              { id: "dust_all", label: "Dust all surfaces", type: "checkbox", required: true },
              { id: "vacuum", label: "Vacuum floors", type: "checkbox", required: true },
              { id: "staging_check", label: "Staging check", type: "checkbox", required: true },
            ],
          },
          {
            id: "laundry",
            title: "Laundry",
            fields: [
              { id: "linen_count", label: "Linen count", type: "number", required: true },
              { id: "laundry_ready", label: "Laundry ready for pickup", type: "checkbox", required: false },
              { id: "bag_location", label: "Bag location", type: "text", required: false },
            ],
          },
          {
            id: "photos",
            title: "Photos",
            fields: [
              { id: "before_photos", label: "Before photos", type: "photo", required: true },
              { id: "after_photos", label: "After photos", type: "photo", required: true },
            ],
          },
        ],
      },
    },
  });

  console.log(`Created form template: ${airbnbTemplate.name}`);

  // ── Price Book ──
  const priceBookEntries = [
    { jobType: JobType.AIRBNB_TURNOVER, bedrooms: 1, bathrooms: 1, baseRate: 120, addOns: { oven: 25, fridge: 20, balcony: 15, heavyMess: 30, sameDay: 40 }, multipliers: { conditionLevel: { light: 0.9, standard: 1, heavy: 1.2 } } },
    { jobType: JobType.AIRBNB_TURNOVER, bedrooms: 2, bathrooms: 1, baseRate: 150, addOns: { oven: 25, fridge: 20, balcony: 15, heavyMess: 30, sameDay: 40 }, multipliers: { conditionLevel: { light: 0.9, standard: 1, heavy: 1.2 } } },
    { jobType: JobType.AIRBNB_TURNOVER, bedrooms: 2, bathrooms: 2, baseRate: 170, addOns: { oven: 25, fridge: 20, balcony: 15, heavyMess: 30, sameDay: 40 }, multipliers: { conditionLevel: { light: 0.9, standard: 1, heavy: 1.2 } } },
    { jobType: JobType.AIRBNB_TURNOVER, bedrooms: 3, bathrooms: 2, baseRate: 200, addOns: { oven: 25, fridge: 20, balcony: 15, heavyMess: 30, sameDay: 40 }, multipliers: { conditionLevel: { light: 0.9, standard: 1, heavy: 1.2 } } },
    { jobType: JobType.DEEP_CLEAN, bedrooms: 1, bathrooms: 1, baseRate: 200, addOns: { oven: 30, fridge: 25, balcony: 20, heavyMess: 40, sameDay: 50 }, multipliers: { conditionLevel: { light: 0.9, standard: 1, heavy: 1.3 } } },
    { jobType: JobType.DEEP_CLEAN, bedrooms: 2, bathrooms: 1, baseRate: 250, addOns: { oven: 30, fridge: 25, balcony: 20, heavyMess: 40, sameDay: 50 }, multipliers: { conditionLevel: { light: 0.9, standard: 1, heavy: 1.3 } } },
    { jobType: JobType.DEEP_CLEAN, bedrooms: 3, bathrooms: 2, baseRate: 320, addOns: { oven: 30, fridge: 25, balcony: 20, heavyMess: 40, sameDay: 50 }, multipliers: { conditionLevel: { light: 0.9, standard: 1, heavy: 1.3 } } },
    { jobType: JobType.END_OF_LEASE, bedrooms: 1, bathrooms: 1, baseRate: 250, addOns: { oven: 35, fridge: 30, balcony: 20, heavyMess: 50, sameDay: 60 }, multipliers: { conditionLevel: { light: 0.9, standard: 1, heavy: 1.3 } } },
    { jobType: JobType.END_OF_LEASE, bedrooms: 2, bathrooms: 1, baseRate: 300, addOns: { oven: 35, fridge: 30, balcony: 20, heavyMess: 50, sameDay: 60 }, multipliers: { conditionLevel: { light: 0.9, standard: 1, heavy: 1.3 } } },
    { jobType: JobType.END_OF_LEASE, bedrooms: 3, bathrooms: 2, baseRate: 380, addOns: { oven: 35, fridge: 30, balcony: 20, heavyMess: 50, sameDay: 60 }, multipliers: { conditionLevel: { light: 0.9, standard: 1, heavy: 1.3 } } },
    { jobType: JobType.GENERAL_CLEAN, bedrooms: 1, bathrooms: 1, baseRate: 100, addOns: { oven: 20, fridge: 15, balcony: 10, heavyMess: 25, sameDay: 30 }, multipliers: { conditionLevel: { light: 0.9, standard: 1, heavy: 1.2 } } },
    { jobType: JobType.GENERAL_CLEAN, bedrooms: 2, bathrooms: 1, baseRate: 130, addOns: { oven: 20, fridge: 15, balcony: 10, heavyMess: 25, sameDay: 30 }, multipliers: { conditionLevel: { light: 0.9, standard: 1, heavy: 1.2 } } },
    { jobType: JobType.GENERAL_CLEAN, bedrooms: 3, bathrooms: 2, baseRate: 170, addOns: { oven: 20, fridge: 15, balcony: 10, heavyMess: 25, sameDay: 30 }, multipliers: { conditionLevel: { light: 0.9, standard: 1, heavy: 1.2 } } },
  ];

  for (const entry of priceBookEntries) {
    await prisma.priceBook.upsert({
      where: { jobType_bedrooms_bathrooms: { jobType: entry.jobType, bedrooms: entry.bedrooms, bathrooms: entry.bathrooms } },
      update: {},
      create: entry,
    });
  }

  console.log(`Created ${priceBookEntries.length} price book entries`);

  // ── Laundry Supplier ──
  await prisma.laundrySupplier.upsert({
    where: { id: "laundry_supplier_001" },
    update: {},
    create: {
      id: "laundry_supplier_001",
      name: "Sydney Fresh Laundry Co",
      phone: "+61400000010",
      email: "orders@sydneyfreshlaundry.com.au",
      address: "50 Industrial Rd, Alexandria NSW 2015",
      pricePerKg: 4.5,
      avgTurnaround: 48,
      reliabilityScore: 4.5,
      notes: "Primary laundry supplier - 48hr turnaround",
      isActive: true,
    },
  });

  console.log("Created laundry supplier");

  // ── Notification Templates ──
  const notificationTemplates = [
    { eventKey: "invoice_sent", label: "Invoice Sent", category: "invoice", emailSubject: "Your invoice from sNeek Property Service", emailBodyHtml: "<p>Hi {{client_name}},</p><p>Your invoice {{invoice_number}} for {{total_amount}} is ready.</p>", availableVars: { client_name: "string", invoice_number: "string", total_amount: "string" } },
    { eventKey: "payroll_processed", label: "Payroll Processed", category: "payroll", emailSubject: "Your pay has been processed", emailBodyHtml: "<p>Hi {{cleaner_name}},</p><p>Your pay of {{amount}} has been processed.</p>", availableVars: { cleaner_name: "string", amount: "string" } },
    { eventKey: "job_assigned", label: "Job Assigned", category: "job", emailSubject: "New job assigned: {{job_type}} at {{property_name}}", emailBodyHtml: "<p>Hi {{cleaner_name}},</p><p>You have been assigned a new job: {{job_type}} at {{property_name}} on {{date}}.</p>", availableVars: { cleaner_name: "string", job_type: "string", property_name: "string", date: "string" } },
    { eventKey: "job_completed", label: "Job Completed", category: "job", emailSubject: "Job completed: {{job_type}} at {{property_name}}", emailBodyHtml: "<p>Hi {{client_name}},</p><p>Your {{job_type}} at {{property_name}} has been completed.</p>", availableVars: { client_name: "string", job_type: "string", property_name: "string" } },
    { eventKey: "stock_low", label: "Low Stock Alert", category: "inventory", emailSubject: "Low stock alert: {{item_name}}", emailBodyHtml: "<p>{{item_name}} is running low at {{property_name}}. Current stock: {{on_hand}}.</p>", availableVars: { item_name: "string", property_name: "string", on_hand: "number" } },
    { eventKey: "laundry_ready", label: "Laundry Ready", category: "laundry", emailSubject: "Laundry ready for pickup at {{property_name}}", emailBodyHtml: "<p>Laundry at {{property_name}} is ready for pickup.</p>", availableVars: { property_name: "string" } },
    { eventKey: "client_payment_received", label: "Client Payment Received", category: "client_payment", emailSubject: "Payment received: {{amount}}", emailBodyHtml: "<p>Payment of {{amount}} has been received from {{client_name}}.</p>", availableVars: { amount: "string", client_name: "string" } },
    { eventKey: "xero_export_success", label: "Xero Export Success", category: "xero", emailSubject: "Xero export completed", emailBodyHtml: "<p>{{count}} records exported to Xero successfully.</p>", availableVars: { count: "number" } },
  ];

  for (const template of notificationTemplates) {
    await prisma.notificationTemplate.upsert({
      where: { eventKey: template.eventKey },
      update: {},
      create: template,
    });
  }

  console.log(`Created ${notificationTemplates.length} notification templates`);

  // ── Notification Preferences ──
  const prefCombos: { eventKey: string; recipientRole: NotificationRecipientRole; channel: NotificationChannel }[] = [
    { eventKey: "invoice_sent", recipientRole: "CLIENT", channel: "EMAIL" },
    { eventKey: "payroll_processed", recipientRole: "CLEANER", channel: "EMAIL" },
    { eventKey: "job_assigned", recipientRole: "CLEANER", channel: "EMAIL" },
    { eventKey: "job_assigned", recipientRole: "CLEANER", channel: "PUSH" },
    { eventKey: "job_completed", recipientRole: "CLIENT", channel: "EMAIL" },
    { eventKey: "stock_low", recipientRole: "ADMIN", channel: "EMAIL" },
    { eventKey: "laundry_ready", recipientRole: "ADMIN", channel: "EMAIL" },
    { eventKey: "client_payment_received", recipientRole: "ADMIN", channel: "EMAIL" },
  ];

  for (const pref of prefCombos) {
    await prisma.notificationPreference.upsert({
      where: { eventKey_recipientRole_channel: { eventKey: pref.eventKey, recipientRole: pref.recipientRole, channel: pref.channel } },
      update: {},
      create: { ...pref, enabled: true },
    });
  }

  console.log(`Created ${prefCombos.length} notification preferences`);

  // ── App Settings ──
  await prisma.appSetting.upsert({
    where: { key: "general" },
    update: {},
    create: {
      key: "general",
      value: {
        companyName: "sNeek Property Service",
        timezone: "Australia/Sydney",
        defaultReminder24h: true,
        defaultReminder2h: true,
        qaPassThreshold: 80,
        gstRate: 10,
      },
    },
  });

  console.log("Created app settings");

  // ── Subscription Plans ──
  const plans = [
    { slug: "weekly", name: "Weekly Clean", tagline: "Regular weekly cleaning service", startingPrice: 130, priceLabel: "/week", features: ["Weekly scheduled cleaning", "Same cleaner assigned", "Priority booking", "Monthly quality review"], isPublished: true, sortOrder: 1 },
    { slug: "fortnightly", name: "Fortnightly Clean", tagline: "Cleaning every two weeks", startingPrice: 150, priceLabel: "/fortnight", features: ["Fortnightly scheduled cleaning", "Flexible scheduling", "Quality assurance", "Inventory management"], isPublished: true, sortOrder: 2 },
    { slug: "monthly", name: "Monthly Clean", tagline: "Monthly deep cleaning service", startingPrice: 200, priceLabel: "/month", features: ["Monthly deep clean", "Comprehensive checklist", "Photo documentation", "Detailed report"], isPublished: true, sortOrder: 3 },
    { slug: "airbnb", name: "Airbnb Hosting", tagline: "Turnover cleaning for short-term rentals", startingPrice: 120, priceLabel: "/turnover", features: ["iCal integration", "Express turnaround", "Linen management", "Guest-ready guarantee"], isPublished: true, sortOrder: 4 },
  ];

  for (const plan of plans) {
    await prisma.subscriptionPlan.upsert({
      where: { slug: plan.slug },
      update: {},
      create: plan,
    });
  }

  console.log(`Created ${plans.length} subscription plans`);

  console.log("Seeding complete!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
