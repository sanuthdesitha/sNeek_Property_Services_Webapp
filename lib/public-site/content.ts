export interface WebsiteHeroStat {
  value: string;
  label: string;
  note: string;
}

export interface WebsiteFeatureCard {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  imageAlt: string;
}

export interface WebsiteTestimonial {
  quote: string;
  author: string;
  meta: string;
}

export interface WebsiteLegalSection {
  title: string;
  body: string;
  bullets: string[];
}

export interface WebsiteWhyItem {
  id: string;
  icon: string;
  title: string;
  description: string;
}

export interface WebsiteFaqItem {
  id: string;
  question: string;
  answer: string;
  category: "booking" | "pricing" | "services" | "trust" | "airbnb";
}

export interface WebsitePartner {
  id: string;
  name: string;
  logoUrl: string;
  url: string;
}

export interface WebsiteGalleryItem {
  id: string;
  imageUrl: string;
  imageAlt: string;
  caption: string;
  serviceType: string;
}

export interface WebsiteServicePage {
  heroImageUrl: string;
  heroImageAlt: string;
  whatIncluded: string[];
  notIncluded: string[];
  idealFor: string;
  priceGuide: string;
  faq: { question: string; answer: string }[];
}

export interface WebsiteAnnouncementBar {
  enabled: boolean;
  promoMessage: string;
  promoLink: string;
  promoLinkLabel: string;
  bgStyle: "subtle" | "accent" | "dark" | "warning";
  showPhone: boolean;
  showLocation: boolean;
  showHours: boolean;
  showEmail: boolean;
}

export interface WebsiteContent {
  announcementBar: WebsiteAnnouncementBar;
  home: {
    eyebrow: string;
    title: string;
    subtitle: string;
    brandIdea: string;
    primaryCtaLabel: string;
    secondaryCtaLabel: string;
    heroImageUrl: string;
    heroImageAlt: string;
    stats: WebsiteHeroStat[];
    servicesTitle: string;
    servicesIntro: string;
    serviceBenefits: WebsiteFeatureCard[];
    hostingTitle: string;
    hostingIntro: string;
    hostingFeatures: WebsiteFeatureCard[];
    testimonials: WebsiteTestimonial[];
    finalCtaTitle: string;
    finalCtaBody: string;
  };
  services: {
    eyebrow: string;
    title: string;
    intro: string;
  };
  airbnb: {
    eyebrow: string;
    title: string;
    subtitle: string;
    heroImageUrl: string;
    heroImageAlt: string;
    featuresTitle: string;
    featuresIntro: string;
    features: WebsiteFeatureCard[];
    reportsTitle: string;
    reportsBody: string;
  };
  subscriptions: {
    eyebrow: string;
    title: string;
    intro: string;
    compareTitle: string;
    compareBody: string;
  };
  contact: {
    eyebrow: string;
    title: string;
    intro: string;
    formIntro: string;
    displayEmail: string;
    displayPhone: string;
    addressLine: string;
    responsePromise: string;
    recipientEmails: string[];
  };
  footer: {
    blurb: string;
    areas: string;
    supportLine: string;
  };
  terms: {
    title: string;
    intro: string;
    publicLiabilityLabel: string;
    publicLiabilityBody: string;
    sections: WebsiteLegalSection[];
  };
  privacy: {
    title: string;
    intro: string;
    sections: WebsiteLegalSection[];
  };
  whyChooseUs: {
    title: string;
    intro: string;
    items: WebsiteWhyItem[];
  };
  faq: {
    title: string;
    intro: string;
    items: WebsiteFaqItem[];
  };
  partners: {
    title: string;
    items: WebsitePartner[];
  };
  gallery: {
    title: string;
    intro: string;
    items: WebsiteGalleryItem[];
  };
  socialLinks: {
    whatsapp: string;
    instagram: string;
    facebook: string;
    linkedin: string;
  };
  servicePages: Record<string, WebsiteServicePage>;
  containerWidth: string;
}

const livingRoomImage = "https://images.pexels.com/photos/7614615/pexels-photo-7614615.jpeg?cs=srgb&dl=pexels-artbovich-7614615.jpg&fm=jpg";
const apartmentKitchenImage = "https://images.pexels.com/photos/6312072/pexels-photo-6312072.jpeg?cs=srgb&dl=pexels-artbovich-6312072.jpg&fm=jpg";
const bedMakingImage = "https://images.pexels.com/photos/6466489/pexels-photo-6466489.jpeg?cs=srgb&dl=pexels-cottonbro-6466489.jpg&fm=jpg";
const linenRoomImage = "https://images.pexels.com/photos/6466214/pexels-photo-6466214.jpeg?cs=srgb&dl=pexels-cottonbro-6466214.jpg&fm=jpg";
const mattressCleanImage = "https://images.pexels.com/photos/14675103/pexels-photo-14675103.jpeg?cs=srgb&dl=pexels-thehealthyhome-me-ar-sa-385496128-14675103.jpg&fm=jpg";

const BLANK_SERVICE_PAGE: WebsiteServicePage = {
  heroImageUrl: "",
  heroImageAlt: "",
  whatIncluded: [],
  notIncluded: [],
  idealFor: "",
  priceGuide: "",
  faq: [],
};

export const DEFAULT_WEBSITE_CONTENT: WebsiteContent = {
  announcementBar: {
    enabled: true,
    promoMessage: "",
    promoLink: "",
    promoLinkLabel: "Book now →",
    bgStyle: "subtle",
    showPhone: true,
    showLocation: true,
    showHours: true,
    showEmail: true,
  },
  home: {
    eyebrow: "Parramatta & Greater Sydney",
    title: "Professional cleaning and property care that keeps your place guest-ready without the stress.",
    subtitle:
      "From occupied homes to Airbnb turnovers and managed properties, sNeek handles the clean, the presentation, and the practical follow-up so you're not chasing updates all day.",
    brandIdea:
      "The sNeek idea is quiet, behind-the-scenes property care: the work gets done properly, the updates stay clear, and your property stays ready without constant chasing.",
    primaryCtaLabel: "Get an instant quote",
    secondaryCtaLabel: "Talk to the team",
    heroImageUrl: bedMakingImage,
    heroImageAlt: "Professional cleaner preparing a guest-ready bed in a hotel-style room",
    stats: [
      { value: "500+", label: "Cleans completed", note: "Homes, Airbnbs, offices and specialty jobs across Parramatta and Greater Sydney." },
      { value: "$5M", label: "Public liability insured", note: "Full public liability cover on every clean — your property is protected." },
      { value: "4.9★", label: "Client satisfaction", note: "Consistently rated by real clients across residential, short-stay and commercial work." },
    ],
    servicesTitle: "Services designed for how properties are actually looked after",
    servicesIntro:
      "Routine home cleaning is only part of the job. Many clients also need guest-ready presentation, restocking, linen handling, outdoor upkeep, and quick escalation when something is off.",
    serviceBenefits: [
      {
        id: "general",
        title: "Residential cleaning that stays practical",
        description: "General, deep, spring, and end-of-lease cleaning with condition-aware quoting and clear scope from the start.",
        imageUrl: livingRoomImage,
        imageAlt: "Clean living room interior",
      },
      {
        id: "airbnb",
        title: "Airbnb turnovers with real operational support",
        description: "Guest-ready resets, linen handling, restocking, issue reporting, and same-day coordination for short-stay properties.",
        imageUrl: bedMakingImage,
        imageAlt: "Cleaner making a bed in a guest room",
      },
      {
        id: "specialty",
        title: "Specialty and exterior work when a normal clean isn't enough",
        description: "Steam cleaning, tile and grout, windows, lawns, pressure washing, gutters, and site-specific recovery work.",
        imageUrl: apartmentKitchenImage,
        imageAlt: "Modern apartment interior ready for service",
      },
    ],
    hostingTitle: "Hosting support that gives owners and managers breathing room",
    hostingIntro:
      "For Airbnb and short-stay properties, cleaning is only one part of the turnover. sNeek helps with reports, laundry timing, stock visibility, shopping runs, maintenance escalation, and invoice-ready records.",
    hostingFeatures: [
      {
        id: "reports",
        title: "Photo-backed reports after every clean",
        description: "Know what was completed, what was found, and what needs attention before the next guest arrives.",
        imageUrl: livingRoomImage,
        imageAlt: "Prepared living room with tidy presentation",
      },
      {
        id: "laundry",
        title: "Laundry and linen flow handled in the background",
        description: "Pickup, drop-off, timing updates, and visible laundry history reduce the usual short-stay coordination mess.",
        imageUrl: linenRoomImage,
        imageAlt: "Professional staff standing with fresh linen in a guest room",
      },
      {
        id: "issues",
        title: "Damage, restock, and maintenance escalated quickly",
        description: "Missing items, damage, low stock, and property issues are raised early so there is time to act before the next booking.",
        imageUrl: mattressCleanImage,
        imageAlt: "Cleaner checking and treating a mattress during property service",
      },
    ],
    testimonials: [
      {
        quote: "We stopped chasing cleaners and laundry separately. The property is ready, the updates are clear, and the reports give us confidence before guest check-in.",
        author: "Sarah M.",
        meta: "Parramatta · Short-stay host",
      },
      {
        quote: "The big difference is peace of mind. We can see what happened, approve anything unusual quickly, and keep the property moving.",
        author: "James T.",
        meta: "Sydney · Managed property owner",
      },
      {
        quote: "The quoting flow feels more accurate because it actually asks about condition, access, and the real scope of work.",
        author: "Linda K.",
        meta: "Western Sydney · End of lease",
      },
    ],
    finalCtaTitle: "Ready to get your property looking its best?",
    finalCtaBody:
      "Use the instant quote for standard work, or send the scope for a tailored review. Call us on +61 451 217 210 or chat on WhatsApp — we're based in Parramatta and ready to help.",
  },
  services: {
    eyebrow: "Our Services",
    title: "Cleaning and property support for homes, short-stays, and managed sites",
    intro:
      "Choose the service family that fits your property. Standard jobs can be quoted instantly. Bigger, specialist, or complex scope goes into a proper review instead of a vague guess.",
  },
  airbnb: {
    eyebrow: "Airbnb and hosting support",
    title: "More 5-star turnovers, fewer guest complaints, less host stress.",
    subtitle:
      "sNeek helps hosts and property managers stay ahead of turnovers with reliable cleaning, photo reports, laundry flow, restock visibility, and fast issue escalation before next check-in.",
    heroImageUrl: apartmentKitchenImage,
    heroImageAlt: "Modern short-stay apartment interior",
    featuresTitle: "What hosts and property managers actually need",
    featuresIntro:
      "The value is not just the clean itself. It is the visibility, speed, and follow-up around each turnover.",
    features: [
      {
        id: "airbnb-reports",
        title: "Detailed turnover reports",
        description: "Photo-backed reports show completed work, presentation status, and issues noticed during the clean.",
        imageUrl: livingRoomImage,
        imageAlt: "Clean and prepared living room",
      },
      {
        id: "airbnb-laundry",
        title: "Laundry handling and timing coordination",
        description: "Pickup and drop-off timing, ready updates, and visible schedule tracking reduce missed linen handovers.",
        imageUrl: linenRoomImage,
        imageAlt: "Fresh linen prepared for guest turnover",
      },
      {
        id: "airbnb-damage",
        title: "Damage and issue handling",
        description: "If something is broken, missing, or risky for the next guest, it is captured early and pushed into follow-up fast.",
        imageUrl: mattressCleanImage,
        imageAlt: "Cleaner checking property condition during service",
      },
      {
        id: "airbnb-stock",
        title: "Inventory and restock visibility",
        description: "Consumables, low stock, and urgent replacement needs can be tracked before they become guest complaints.",
        imageUrl: apartmentKitchenImage,
        imageAlt: "Apartment kitchen with stocked supplies",
      },
      {
        id: "airbnb-shopping",
        title: "Shopping runs and purchase records",
        description: "Urgent purchases can be logged with receipts, approvals, and billing clarity instead of disappearing into messages.",
        imageUrl: bedMakingImage,
        imageAlt: "Cleaner setting up a guest-ready room",
      },
      {
        id: "airbnb-invoicing",
        title: "Schedules, cases, and invoicing that stay organised",
        description: "Jobs, approvals, follow-ups, and billing records stay connected so property support is easier to manage at scale.",
        imageUrl: livingRoomImage,
        imageAlt: "Tidy property interior prepared for guests",
      },
    ],
    reportsTitle: "Visibility is what gives hosts peace of mind",
    reportsBody:
      "When you can see the report, the laundry status, the issue raised, the stock that is low, and the next action already moving, hosting stops feeling like a constant chase.",
  },
  subscriptions: {
    eyebrow: "Subscriptions",
    title: "Recurring service plans that reduce reactive work and keep properties consistently ready",
    intro:
      "Choose a recurring plan if you want the property looked after on a predictable rhythm instead of waiting for it to slip into recovery mode. Weekly, fortnightly, monthly, booking-based, and seasonal plans are available across home cleaning, short-stay support, offices, and exterior upkeep, with clear inclusions and straightforward top-ups when extra work is needed.",
    compareTitle: "Recommended subscription direction",
    compareBody:
      "Most customers are best served by weekly, fortnightly, or monthly care for homes, booking-based or hybrid support for short-stays, and seasonal or quarterly plans for exterior upkeep. If you want fewer surprises, steadier presentation, and less admin, recurring service is usually the better fit than reactive one-off bookings.",
  },
  contact: {
    eyebrow: "Contact us",
    title: "Get in touch — we're based in Parramatta and ready to help",
    intro:
      "Use this for large homes, custom scope, commercial requests, recurring-service discussions, Airbnb support enquiries, or anything the instant quote should not guess.",
    formIntro: "Send a quick message and the team can review the request properly.",
    displayEmail: "info@sneekproservices.com.au",
    displayPhone: "+61 451 217 210",
    addressLine: "Parramatta, NSW 2150",
    responsePromise: "We aim to review new enquiries quickly, especially when the work is time-sensitive or connected to an upcoming booking.",
    recipientEmails: ["info@sneekproservices.com.au", "admin@sneekproservices.com.au"],
  },
  footer: {
    blurb: "Professional cleaning, turnovers, linen coordination, property reporting, and practical support for homes and short-stay properties across Greater Sydney.",
    areas: "Parramatta, Greater Western Sydney, and surrounding service areas",
    supportLine: "Cleaner reports, laundry coordination, issue capture, and organised follow-up under one service relationship.",
  },
  terms: {
    title: "Terms and conditions for booked cleaning and property support services",
    intro:
      "These terms explain how quoting, access, scheduling, price adjustments, cancellations, recurring services, reports, and follow-up support work when you book services with sNeek Property Services.",
    publicLiabilityLabel: "$5 million public liability insurance",
    publicLiabilityBody:
      "sNeek maintains $5 million public liability insurance for covered incidents. Insurance does not change the need for customers to provide safe access, accurate scope information, and timely notice of hazards or existing damage.",
    sections: [
      {
        title: "Quotes, estimates, and scope",
        body: "Quotes must reflect the real property condition and scope. Instant quotes are estimates for standard jobs and may change if the actual site differs materially from the submitted information.",
        bullets: [
          "Final pricing may change where access, contamination, clutter, damage, size, or requested outcomes differ materially from the original request.",
          "Specialty work, larger properties, risky access, and unusual scope may require manual review before booking is confirmed.",
          "Extra rooms, bathrooms, balconies, appliances, outdoor areas, or specialist tasks outside the confirmed scope may be billed separately.",
        ],
      },
      {
        title: "Access and site readiness",
        body: "Customers must provide safe access, correct entry details, and any site instructions before the scheduled service window.",
        bullets: [
          "If access is not possible on arrival, a call-out, waiting, or reschedule charge may apply.",
          "Unsafe conditions, active hazards, illegal activity, or severe contamination may require the team to pause, rescope, or refuse the service.",
          "Utilities required for the service should be available unless another arrangement has been agreed in writing.",
        ],
      },
      {
        title: "Scheduling, cancellations, and recurring visits",
        body: "Time-sensitive jobs depend on allocated labour and reserved schedule capacity, so notice periods matter.",
        bullets: [
          "Reasonable notice should be given for cancellations or changes, especially for recurring service and short-stay turnovers.",
          "Late changes may incur charges where labour, travel, or reserved capacity has already been committed.",
          "Recurring subscriptions or plans should clearly define cadence, included scope, pause rules, and how extra work is approved.",
        ],
      },
      {
        title: "Payments, invoices, and approvals",
        body: "Payment timing depends on the service type, account status, and whether extra work or purchases need approval before billing.",
        bullets: [
          "Invoices are payable on the agreed terms shown on the quote, invoice, or recurring-service arrangement.",
          "Approved extras, shopping runs, consumables, and client-authorised add-on work may be charged separately from the base service price.",
          "Where third-party costs or urgent support actions require approval, the customer remains responsible for approved charges and reimbursements.",
        ],
      },
      {
        title: "Reports, issues, and limitations",
        body: "Reports, notes, and service images are used to confirm work completed, note exceptions, and support follow-up.",
        bullets: [
          "sNeek is not liable for pre-existing damage, wear and tear, hidden defects, or issues that could not reasonably be identified before or during the service.",
          "Customers should raise service concerns promptly so they can be reviewed against the booked scope and recorded evidence.",
          "Consumer rights under Australian Consumer Law continue to apply in addition to these service terms.",
        ],
      },
      {
        title: "Service concerns and reattendance",
        body: "If there is a concern about the completed service, it should be raised promptly and with enough detail for fair review.",
        bullets: [
          "sNeek may request photos, reports, site access, or a short review window before confirming any reattendance or remedy.",
          "Any remedy or follow-up service will be assessed against the booked scope, access conditions, and recorded service evidence.",
          "Nothing in these terms excludes guarantees or remedies that cannot be excluded under Australian Consumer Law.",
        ],
      },
    ],
  },
  privacy: {
    title: "Privacy policy for enquiries, accounts, and service delivery records",
    intro:
      "This privacy policy explains what information we collect, why we collect it, how it supports quoting and service delivery, and how operational records may be stored for quality, safety, support, and compliance purposes.",
    sections: [
      {
        title: "What we collect",
        body: "We collect the information needed to quote, schedule, communicate, deliver services, and manage customer accounts.",
        bullets: [
          "This may include name, email, phone, address, suburb, service scope details, booking notes, and account information.",
          "For operational delivery, records may include reports, uploads, issue logs, laundry updates, and approval history.",
          "Where staff accounts exist, internal operational records may also include assignment, timing, and work-completion records.",
        ],
      },
      {
        title: "Why we collect it",
        body: "Information is collected so we can quote accurately, coordinate access, deliver services, and follow up on issues or requested work.",
        bullets: [
          "Enquiry data supports quoting, booking discussions, and customer follow-up.",
          "Operational data supports service delivery, quality control, issue handling, and reporting.",
          "Contact details may be used for booking confirmations, job updates, reminders, approvals, invoices, and related service communication.",
        ],
      },
      {
        title: "How it is shared and stored",
        body: "Information is shared only with staff, contractors, or service providers who need it for service delivery, support, notifications, payments, or secure system hosting.",
        bullets: [
          "Portal visibility differs by role and by admin-controlled settings.",
          "Restricted staff notes, audit logs, and internal-only operational records are not shown to clients unless explicitly configured.",
          "Service evidence and operational records may be retained for quality assurance, issue review, safety, dispute handling, and compliance needs.",
        ],
      },
      {
        title: "Your choices and contact",
        body: "You can contact us about your information, enquiry records, or customer communication preferences.",
        bullets: [
          "If you believe information is incorrect, outdated, or should be reviewed, contact us at info@sneekproservices.com.au.",
          "Where Australian privacy law applies, requests will be handled in line with the applicable obligations and any permitted exceptions.",
          "Website enquiries and account requests should only include the information reasonably needed for us to assess and deliver the service.",
        ],
      },
    ],
  },
  whyChooseUs: {
    title: "Why clients choose sNeek for their property",
    intro:
      "We are not just another cleaning company. We are a property care team built around accountability, clear communication, and results you can actually see.",
    items: [
      {
        id: "insurance",
        icon: "ShieldCheck",
        title: "$5M Public Liability Covered",
        description: "Every job is covered by $5 million public liability insurance so your property is fully protected on every visit.",
      },
      {
        id: "reports",
        icon: "Camera",
        title: "Photo Reports After Every Clean",
        description: "You see exactly what was done — photo-backed reports after each visit. No guesswork, no chasing for updates.",
      },
      {
        id: "local",
        icon: "MapPin",
        title: "Parramatta-Based Team",
        description: "We operate from Parramatta and cover Greater Sydney. Local availability means faster response and better coverage.",
      },
      {
        id: "eco",
        icon: "Leaf",
        title: "Eco-Friendly Products",
        description: "Child and pet-safe cleaning products throughout. No harsh chemicals, no unpleasant smells left behind.",
      },
      {
        id: "sameday",
        icon: "Zap",
        title: "Same-Day Service Available",
        description: "Need an urgent clean? We offer priority and same-day service windows for qualifying bookings — call +61 451 217 210.",
      },
      {
        id: "guarantee",
        icon: "BadgeCheck",
        title: "100% Satisfaction Guarantee",
        description: "Not happy with the result? We'll come back within 48 hours and make it right at no extra charge.",
      },
    ],
  },
  faq: {
    title: "Frequently asked questions",
    intro: "Everything you need to know about our services, pricing, and how we work.",
    items: [
      { id: "faq-1", category: "booking", question: "How do I get a quote?", answer: "Use our online instant quote tool — select your service, enter property details, and get an itemised estimate in under 2 minutes. For complex or commercial jobs we'll follow up with a tailored quote after reviewing your request." },
      { id: "faq-2", category: "booking", question: "Do I need to be home during the clean?", answer: "No — most clients give us access instructions and are not home. We just need safe access and any specific instructions noted at booking time. We'll send you a photo report once the job is complete." },
      { id: "faq-3", category: "booking", question: "How far in advance should I book?", answer: "For general cleans we usually have availability within 1–3 business days. For same-day or urgent jobs, contact us directly on +61 451 217 210 or chat on WhatsApp for the fastest response." },
      { id: "faq-4", category: "pricing", question: "How is pricing calculated?", answer: "Pricing is based on property size (bedrooms/bathrooms), condition level, add-ons selected (oven, fridge, balcony, etc.), and service type. Our quote tool gives you an instant itemised breakdown including GST." },
      { id: "faq-5", category: "pricing", question: "Are there any hidden fees?", answer: "No hidden fees. The quote you receive includes GST and shows a clear line item breakdown. If the scope changes on the day (e.g. property is in worse condition than described), we'll discuss it with you before continuing." },
      { id: "faq-6", category: "pricing", question: "Do you offer recurring discounts?", answer: "Yes — weekly, fortnightly, and monthly recurring bookings receive discounted rates. Choose your cadence during the quote process and the discount is applied automatically to your estimate." },
      { id: "faq-7", category: "services", question: "What's the difference between a general clean and a deep clean?", answer: "A general clean covers regular maintenance — surfaces, floors, bathrooms, kitchen wipe-down. A deep clean goes further: inside appliances, detailed grout, skirtings, inside cupboards, and neglected areas that need recovery work. If your property hasn't been cleaned professionally in a while, a deep clean is usually the right starting point." },
      { id: "faq-8", category: "services", question: "What products do you use?", answer: "We use professional-grade, eco-friendly products that are safe for children and pets. No harsh bleaches or toxic chemicals unless specifically required and agreed with the client in advance." },
      { id: "faq-9", category: "services", question: "Do you clean commercial properties and offices?", answer: "Yes — we offer recurring commercial and office cleaning. These jobs are reviewed manually to confirm the right scope, visit windows, and access arrangements before booking is confirmed." },
      { id: "faq-10", category: "trust", question: "Are your cleaners police checked?", answer: "Yes — all team members are vetted before joining. We take the safety and security of your property and personal spaces seriously." },
      { id: "faq-11", category: "trust", question: "What if I'm not happy with the result?", answer: "We offer a 48-hour satisfaction guarantee. If something was missed or not up to standard, contact us and we'll return to fix it at no charge. Your satisfaction is the job, not just the clean." },
      { id: "faq-12", category: "trust", question: "Is my property insured during the clean?", answer: "Yes — we carry $5 million public liability insurance on every job. This covers incidents that occur during the service. We also ask clients to let us know about any existing damage or fragile items before we start." },
      { id: "faq-13", category: "airbnb", question: "How do Airbnb turnovers work?", answer: "We coordinate with your booking calendar, complete a full guest-ready reset between checkouts and check-ins, handle linen, restock supplies, and send you a photo report. You don't need to be involved in the day-to-day." },
      { id: "faq-14", category: "airbnb", question: "Can you handle same-day turnovers?", answer: "Yes — for short-stay properties we offer same-day and urgent turnover windows. Contact us directly on +61 451 217 210 or via WhatsApp for time-sensitive bookings." },
      { id: "faq-15", category: "airbnb", question: "Do you manage laundry and linen for Airbnbs?", answer: "Yes — laundry pickup, drop-off, timing updates, and linen coordination can be included in your hosting support package. This removes one of the most common short-stay pain points." },
    ],
  },
  partners: {
    title: "Partners & trusted suppliers",
    items: [
      { id: "partner-1", name: "", logoUrl: "", url: "" },
      { id: "partner-2", name: "", logoUrl: "", url: "" },
      { id: "partner-3", name: "", logoUrl: "", url: "" },
      { id: "partner-4", name: "", logoUrl: "", url: "" },
    ],
  },
  gallery: {
    title: "Our work",
    intro: "A selection of completed jobs across our service lines.",
    items: [
      { id: "gallery-1", imageUrl: "", imageAlt: "", caption: "", serviceType: "" },
      { id: "gallery-2", imageUrl: "", imageAlt: "", caption: "", serviceType: "" },
      { id: "gallery-3", imageUrl: "", imageAlt: "", caption: "", serviceType: "" },
      { id: "gallery-4", imageUrl: "", imageAlt: "", caption: "", serviceType: "" },
      { id: "gallery-5", imageUrl: "", imageAlt: "", caption: "", serviceType: "" },
      { id: "gallery-6", imageUrl: "", imageAlt: "", caption: "", serviceType: "" },
    ],
  },
  socialLinks: {
    whatsapp: "+61451217210",
    instagram: "",
    facebook: "",
    linkedin: "",
  },
  containerWidth: "80%",
  servicePages: {
    "airbnb-turnover": {
      heroImageUrl: bedMakingImage,
      heroImageAlt: "Cleaner making a bed for a guest-ready room",
      whatIncluded: [
        "Full property reset after guest checkout",
        "All bedrooms stripped, linens changed, beds made hotel-style",
        "Bathrooms sanitised and restocked (toiletries, paper)",
        "Kitchen cleaned — surfaces, appliances, dishes away",
        "Rubbish removed and bins emptied throughout",
        "Floors vacuumed and mopped",
        "Photo report sent immediately after completion",
        "Damage, missing items, and issues flagged with photos",
        "Restock visibility — consumables and supply levels noted",
      ],
      notIncluded: [
        "Oven or fridge deep clean (add-on available)",
        "Exterior window cleaning beyond ground floor",
        "Laundry drop-off coordination (add-on available)",
        "Property maintenance or repairs",
      ],
      idealFor: "Airbnb hosts and short-stay property managers who need reliable, fast turnovers with photo visibility and issue reporting.",
      priceGuide: "From approx. $130–$220 depending on property size, linen, and turnaround window. Instant estimate available via our quote tool.",
      faq: [
        { question: "Do you coordinate with my Airbnb booking calendar?", answer: "Yes — we can align to your check-out and check-in windows. Let us know your calendar setup when you contact us." },
        { question: "What happens if the property is in poor condition after checkout?", answer: "We'll document the condition with photos, complete what we can within the booked scope, and flag anything that needs extra time or attention for your approval." },
        { question: "Can you handle same-day turnovers?", answer: "Yes — same-day turnover windows are available for qualifying properties. Contact us on +61 451 217 210 for urgent requests." },
      ],
    },
    "general-clean": {
      heroImageUrl: livingRoomImage,
      heroImageAlt: "Clean and tidy living room ready for everyday use",
      whatIncluded: [
        "All bedrooms dusted and vacuumed",
        "Bathrooms scrubbed — toilet, sink, shower/bath",
        "Kitchen surfaces, stovetop, and splashback wiped",
        "Floors mopped and vacuumed throughout",
        "Internal windows and glass doors wiped",
        "General rubbish removal",
        "Mirrors and glass surfaces cleaned",
        "Skirting boards and accessible surfaces dusted",
      ],
      notIncluded: [
        "Inside oven or fridge (add-on available)",
        "Exterior windows above ground floor",
        "Garage or outdoor areas",
        "Carpet steam cleaning (separate service)",
        "Inside cupboards or drawers",
      ],
      idealFor: "Occupied homes wanting reliable, regular cleaning on a weekly, fortnightly, or monthly schedule.",
      priceGuide: "From approx. $150–$230 for a 2-bed/1-bath home in standard condition. Recurring clients receive discounted rates.",
      faq: [
        { question: "How long does a general clean take?", answer: "2–3 hours for a standard 2-bedroom home, depending on condition and any add-ons selected." },
        { question: "Can I set up recurring visits?", answer: "Yes — weekly, fortnightly, or monthly cadence with reduced rates. Choose your frequency during the quote process." },
        { question: "Do I need to supply any products?", answer: "No — we bring all equipment and eco-friendly cleaning products." },
      ],
    },
    "deep-clean": {
      heroImageUrl: apartmentKitchenImage,
      heroImageAlt: "Deep cleaned kitchen with sparkling surfaces",
      whatIncluded: [
        "Everything included in a general clean",
        "Inside oven cleaned thoroughly",
        "Inside fridge wiped and deodorised",
        "Inside all kitchen cupboards and drawers",
        "Detailed bathroom grout and tile scrubbing",
        "Skirting boards scrubbed and wiped",
        "Light fittings and ceiling fans dusted",
        "Window tracks and frames cleaned",
        "Detailed surface cleaning throughout",
      ],
      notIncluded: [
        "Carpet steam cleaning (separate service)",
        "Exterior windows above ground floor",
        "Garage or outdoor areas",
        "Mould treatment (separate service if severe)",
      ],
      idealFor: "Properties that haven't been professionally cleaned recently, or homes needing a thorough reset before guests, inspections, or a fresh start.",
      priceGuide: "From approx. $280–$450 for a 2-bed/1-bath home. Price varies with condition, size, and add-ons. Instant estimate available.",
      faq: [
        { question: "When should I choose a deep clean over a general clean?", answer: "If your property hasn't been professionally cleaned in 3+ months, is in heavy condition, or you need it to a higher standard for inspection or hosting — a deep clean is the right choice." },
        { question: "How long does a deep clean take?", answer: "4–7 hours for a standard 2-bedroom home depending on condition. We'll give you a time estimate at booking." },
        { question: "Can a deep clean be followed by recurring general cleans?", answer: "Yes — many clients book a deep clean first to reset the property, then move to regular fortnightly or monthly maintenance." },
      ],
    },
    "end-of-lease": {
      heroImageUrl: livingRoomImage,
      heroImageAlt: "Vacated property cleaned and ready for inspection",
      whatIncluded: [
        "Full property clean to real-estate inspection standard",
        "All rooms vacuumed, mopped, and dusted thoroughly",
        "Oven, stovetop, and rangehood deep cleaned",
        "Fridge cleaned inside and out",
        "Bathrooms and toilets sanitised to inspection standard",
        "All cupboards cleaned inside and out",
        "Window tracks, frames, and sills cleaned",
        "Skirting boards and light switches wiped",
        "Walls spot-cleaned where accessible",
        "Rubbish removed throughout",
      ],
      notIncluded: [
        "Carpet steam cleaning (separate add-on, strongly recommended)",
        "Exterior pressure washing",
        "Window cleaning above ground floor",
        "Garage cleaning",
        "Wall repainting or repairs",
      ],
      idealFor: "Tenants vacating a rental property who need a professional clean to meet real estate inspection requirements and maximise bond return.",
      priceGuide: "From approx. $320–$550 for a standard 2-bed/1-bath home. Larger homes or heavy condition may require manual review.",
      faq: [
        { question: "Does end-of-lease cleaning guarantee my bond back?", answer: "We clean to the highest standard to give you the best chance of a full bond return. We recommend documenting the property before and after with your own photos as well." },
        { question: "Do I need to add carpet steam cleaning?", answer: "Most property managers require it separately — we can arrange it as an add-on. Check your lease agreement first." },
        { question: "Can you clean a fully furnished property?", answer: "Yes — furnished properties are supported. Note the scope and any fragile items in your quote request." },
      ],
    },
    "spring-cleaning": {
      heroImageUrl: livingRoomImage,
      heroImageAlt: "Bright and freshly spring cleaned home",
      whatIncluded: [
        "Everything included in a deep clean",
        "Declutter-ready room-by-room approach",
        "Behind and under all furniture where accessible",
        "Detailed attention to neglected areas",
        "Window ledges, tracks, and frames cleaned",
        "Laundry and utility areas cleaned",
        "Thorough outdoor entry and patio wipe-down (if applicable)",
      ],
      notIncluded: [
        "Carpet steam cleaning (separate service)",
        "Furniture removal or heavy lifting",
        "Exterior pressure washing (separate service)",
        "Pest control or mould treatment",
      ],
      idealFor: "Homeowners wanting a thorough seasonal reset — ideal before summer, after a renovation, or when preparing to list a property.",
      priceGuide: "From approx. $350–$600 for a standard 3-bedroom home. Instant estimate available for most properties.",
      faq: [
        { question: "What's the difference between a spring clean and a deep clean?", answer: "A spring clean is a more thorough, room-by-room reset including areas often skipped in a deep clean — behind furniture, laundry areas, and seasonal buildup. It's the most comprehensive residential service we offer." },
        { question: "How often should I get a spring clean?", answer: "Once or twice a year is typical — usually before or after summer, or whenever the home needs a significant uplift beyond regular maintenance." },
        { question: "Do I need to move furniture before you arrive?", answer: "We'll clean around and behind furniture where safely accessible. If you want specific areas moved, let us know at booking and we'll accommodate where possible." },
      ],
    },
    "post-construction": {
      heroImageUrl: apartmentKitchenImage,
      heroImageAlt: "Post-construction site cleaned and ready for handover",
      whatIncluded: [
        "Dust and construction residue removal throughout",
        "Floors vacuumed and mopped (multiple passes if required)",
        "Windows cleaned inside (dust and residue)",
        "Surfaces wiped down throughout",
        "Kitchen and bathroom fixtures cleaned",
        "Paint splatter and adhesive removal where possible",
        "Rubbish removal (minor builder waste)",
      ],
      notIncluded: [
        "Heavy builder waste or skip bin removal",
        "Paint stripping or chemical surface treatment",
        "External window cleaning above ground floor",
        "Carpet installation or repair",
      ],
      idealFor: "Builders, property owners, or developers needing a thorough clean after renovation or construction before handover or occupancy.",
      priceGuide: "Manual review required — pricing depends heavily on dust level, site size, and access conditions. Contact us with photos for a fast quote.",
      faq: [
        { question: "Why does post-construction cleaning require manual review?", answer: "Dust levels, residue type, access, and site conditions vary enormously. We review job photos before confirming scope and pricing to ensure we quote accurately." },
        { question: "Can you clean during staged handovers?", answer: "Yes — we can work in stages as areas are completed. Let us know the handover schedule when you enquire." },
        { question: "How do I get a quote for post-construction cleaning?", answer: "Send us a few photos of the site via our contact form or WhatsApp (+61 451 217 210) and we'll turn around a quote quickly." },
      ],
    },
    "carpet-steam-cleaning": {
      heroImageUrl: livingRoomImage,
      heroImageAlt: "Steam cleaned carpet looking fresh and clean",
      whatIncluded: [
        "Hot water extraction steam cleaning for all selected rooms",
        "Pre-treatment of stains and high-traffic areas",
        "Furniture moved and replaced where safely possible",
        "Post-clean grooming of carpet fibres",
        "Deodorising treatment included",
      ],
      notIncluded: [
        "Permanent stain removal (results vary by stain type)",
        "Carpet repair, stretching, or re-laying",
        "Rugs (can be quoted separately)",
        "Upholstery cleaning (separate service)",
      ],
      idealFor: "End-of-lease tenants, homeowners refreshing their carpets, or anyone dealing with odours, stains, or high-traffic buildup.",
      priceGuide: "From approx. $60–$90 per room. End-of-lease bundles available — often better value when combined with a full property clean.",
      faq: [
        { question: "How long does carpet steam cleaning take to dry?", answer: "Typically 4–8 hours depending on carpet type, thickness, and ventilation. Open windows and fans help speed the process." },
        { question: "Will steam cleaning remove all stains?", answer: "Most stains respond well to professional steam cleaning. Very old or set-in stains (red wine, pet urine, ink) may be reduced but not always fully removed." },
        { question: "Can carpet steam cleaning be combined with an end-of-lease clean?", answer: "Yes — this is one of our most common combinations. Bundle pricing is available. Add carpet steam to your quote in the quote tool." },
      ],
    },
    "upholstery-cleaning": {
      heroImageUrl: livingRoomImage,
      heroImageAlt: "Freshly cleaned sofa looking like new",
      whatIncluded: [
        "Hot water extraction or dry-cleaning method (depending on fabric)",
        "Cushions removed and treated individually",
        "Armrests, back panels, and sides cleaned",
        "Stain pre-treatment on affected areas",
        "Deodorising treatment included",
      ],
      notIncluded: [
        "Leather conditioning (notify us at booking for leather-specific treatment)",
        "Antique or delicate fabric requiring specialist restoration",
        "Furniture repairs or reupholstering",
      ],
      idealFor: "Homeowners, landlords, or hosts looking to refresh sofas, armchairs, or soft furnishings without full replacement.",
      priceGuide: "From approx. $80–$150 per sofa or piece depending on size and fabric type. Instant estimate available via our quote tool.",
      faq: [
        { question: "What fabric types can you clean?", answer: "We clean most standard upholstery fabrics including cotton, polyester, and microfibre blends. Please tell us the fabric type when booking so we bring the right method." },
        { question: "Can you clean leather sofas?", answer: "Yes — but leather requires a different process. Please specify leather at booking and we'll use the appropriate method and avoid any water-based treatments." },
        { question: "How long does upholstery take to dry?", answer: "2–6 hours depending on fabric and ventilation. Avoid sitting on treated pieces until fully dry." },
      ],
    },
    "tile-and-grout-cleaning": {
      heroImageUrl: apartmentKitchenImage,
      heroImageAlt: "Sparkling clean bathroom tiles after professional grout cleaning",
      whatIncluded: [
        "High-pressure steam or scrub treatment of tiled surfaces",
        "Grout lines thoroughly cleaned and brightened",
        "Bathroom floors, walls, and shower recesses",
        "Kitchen splashbacks and tiled benchtops",
        "Grout sealing available on request",
      ],
      notIncluded: [
        "Grout recolouring or permanent grouting repairs",
        "Tile replacement",
        "Outdoor tiling (separate exterior service)",
      ],
      idealFor: "Homeowners, landlords, or end-of-lease tenants with heavily soiled, discoloured, or mouldy tile grout in bathrooms or kitchens.",
      priceGuide: "From approx. $120–$280 depending on area size and grout condition. Instant estimate available for most standard bathrooms.",
      faq: [
        { question: "How different will my grout look after cleaning?", answer: "Most grout goes from dark grey/black back to its original colour — often a dramatic improvement. Very old or deeply stained grout may take multiple passes." },
        { question: "Should I get grout sealed after cleaning?", answer: "Sealing is highly recommended after professional cleaning — it keeps grout cleaner for longer and is much easier than re-cleaning. We can quote this as an add-on." },
        { question: "How long does tile and grout cleaning take?", answer: "A standard bathroom takes 1.5–3 hours. Larger areas or heavy buildup will take longer — we'll estimate at booking." },
      ],
    },
    "mould-treatment": {
      heroImageUrl: apartmentKitchenImage,
      heroImageAlt: "Bathroom treated and cleared of mould growth",
      whatIncluded: [
        "Site assessment and affected area documentation",
        "Treatment of mould on accessible surfaces",
        "Anti-mould solution applied to affected areas",
        "Ventilation recommendations provided",
        "Photo report of treatment completed",
      ],
      notIncluded: [
        "Structural mould remediation or behind-wall treatment",
        "Insurance claim documentation",
        "Plumbing or waterproofing repairs",
        "Guarantee against recurrence (depends on ventilation and moisture source)",
      ],
      idealFor: "Rental properties, bathrooms, or rooms with visible surface mould that needs safe, professional treatment before inspection or occupancy.",
      priceGuide: "Manual review required — pricing depends on affected area size and severity. Send us photos via WhatsApp or the contact form for a fast quote.",
      faq: [
        { question: "Is mould treatment safe for the occupants?", answer: "Yes — we use treatments safe for residential use. We recommend ventilating the area during and after treatment. Occupants can typically return within a few hours." },
        { question: "Will the mould come back?", answer: "Surface mould treatment is effective but mould will return if the underlying moisture source (leaks, poor ventilation) is not addressed. We'll advise on prevention after treatment." },
        { question: "Why does mould treatment require manual review?", answer: "Mould severity, surface type, and health risk vary significantly. We always assess first to confirm the right treatment and safety approach." },
      ],
    },
    "window-cleaning": {
      heroImageUrl: apartmentKitchenImage,
      heroImageAlt: "Crystal clear windows after professional cleaning",
      whatIncluded: [
        "Interior and exterior window panes cleaned",
        "Window tracks and frames wiped",
        "Sills and ledges cleaned",
        "Sliding door glass cleaned (where applicable)",
        "Streak-free finish using professional tools",
      ],
      notIncluded: [
        "Roof or high-rise windows above 3 storeys (risk assessment required)",
        "Fly screen cleaning (add-on available on request)",
        "Window frame painting or sealing",
      ],
      idealFor: "Homeowners, landlords, end-of-lease tenants, and short-stay hosts wanting clear windows for presentation or before an inspection.",
      priceGuide: "From approx. $8–$15 per pane depending on size and access. Minimum booking applies. Instant estimate via our quote tool.",
      faq: [
        { question: "Do you clean windows on upper floors?", answer: "Yes — up to 2 storeys with standard access. 3-storey and above requires a safety assessment before booking is confirmed." },
        { question: "What's the best time to get windows cleaned?", answer: "Overcast days actually produce the best results — direct sunlight can cause streaks as product dries too fast. Any dry day works well." },
        { question: "Can window cleaning be combined with other services?", answer: "Yes — window cleaning is commonly added to end-of-lease, spring, and general cleans. Add it as an extra in the quote tool." },
      ],
    },
    "pressure-washing": {
      heroImageUrl: apartmentKitchenImage,
      heroImageAlt: "Freshly pressure washed driveway looking like new",
      whatIncluded: [
        "High-pressure wash of selected outdoor areas",
        "Driveways, pathways, and concrete surfaces",
        "Decking and outdoor entertainment areas",
        "Garage floors and entry areas",
        "Pre-soak of heavily soiled areas",
      ],
      notIncluded: [
        "Soft-wash or chemical treatment for surfaces that can't handle pressure",
        "Rubbish removal or skip hire",
        "Surface sealing or painting",
        "Gutter cleaning (separate service)",
      ],
      idealFor: "Homeowners, landlords, and property managers wanting to refresh outdoor hard surfaces before inspections, sales, or seasonal upkeep.",
      priceGuide: "From approx. $150–$400 depending on area size and surface type. Instant estimate available for standard driveways and patios.",
      faq: [
        { question: "Can pressure washing damage my driveway?", answer: "High-quality pressure washing at the right PSI is safe for most concrete and paving surfaces. We assess surface condition before starting to avoid damage." },
        { question: "How long does pressure washing take to dry?", answer: "Most surfaces are dry and usable within 1–4 hours depending on weather, sun, and drainage." },
        { question: "Can you pressure wash timber decking?", answer: "Yes — timber requires lower pressure settings to avoid surface damage. We adjust our approach based on surface type." },
      ],
    },
    "gutter-cleaning": {
      heroImageUrl: livingRoomImage,
      heroImageAlt: "Clean gutters on a home after professional service",
      whatIncluded: [
        "Debris removal from all accessible gutters",
        "Downpipe flushing and clearance check",
        "Before and after photos provided",
        "Gutter condition report — blockages, damage, or sagging noted",
      ],
      notIncluded: [
        "Gutter repairs or replacement",
        "Roof repairs",
        "3-storey or above without prior risk assessment",
      ],
      idealFor: "Homeowners and property managers wanting seasonal gutter maintenance to prevent overflow, water damage, and blocked downpipes.",
      priceGuide: "Manual review required — pricing depends on storey count, roof access, and debris level. Contact us for a fast quote.",
      faq: [
        { question: "How often should gutters be cleaned?", answer: "Twice a year is typical — once in autumn after leaf fall and once in spring. Homes near trees may need quarterly cleaning." },
        { question: "Why does gutter cleaning require manual review?", answer: "Safety depends on storey height, roof pitch, and access difficulty. We confirm these before confirming scope and pricing." },
        { question: "Can you clean gutters on a 2-storey home?", answer: "Yes — 2-storey is our standard range. 3-storey and above requires a site safety assessment first." },
      ],
    },
    "lawn-mowing": {
      heroImageUrl: livingRoomImage,
      heroImageAlt: "Neatly mowed lawn with clean edges",
      whatIncluded: [
        "Full lawn mow to a consistent height",
        "Edge trimming along paths, driveways, and garden beds",
        "Clippings blown clear from paths and driveways",
        "Basic rubbish pick-up from lawn area",
      ],
      notIncluded: [
        "Heavy overgrowth or slashing (review required)",
        "Garden bed weeding or planting",
        "Tree or hedge trimming",
        "Fertilising or soil treatment",
      ],
      idealFor: "Homeowners, landlords, and property managers wanting reliable, regular lawn maintenance without managing a separate gardener.",
      priceGuide: "From approx. $80–$180 depending on lawn area and condition. Instant estimate for standard blocks via our quote tool.",
      faq: [
        { question: "Can you mow if the lawn is overgrown?", answer: "Minor overgrowth is fine — we quote with an overgrowth allowance. Very heavy or long grass may require a review before booking is confirmed." },
        { question: "Do you offer regular mowing schedules?", answer: "Yes — fortnightly or monthly schedules are available and keep lawns consistently maintained. Recurring clients receive reduced rates." },
        { question: "Do you bring your own equipment?", answer: "Yes — we bring all mowing and edging equipment. You don't need to supply anything." },
      ],
    },
    "office-commercial-cleaning": {
      heroImageUrl: apartmentKitchenImage,
      heroImageAlt: "Clean and organised office space ready for work",
      whatIncluded: [
        "All offices, meeting rooms, and common areas cleaned",
        "Desks, surfaces, and equipment dusted",
        "Bathrooms and kitchenettes sanitised",
        "Floors vacuumed and mopped throughout",
        "Bins emptied and replaced",
        "Entry and reception area presentation",
      ],
      notIncluded: [
        "Window cleaning above ground floor (separate service)",
        "Specialist IT or electrical equipment cleaning",
        "Carpet steam cleaning (separate service)",
        "High-security or restricted area access without prior arrangement",
      ],
      idealFor: "Offices, commercial spaces, strata buildings, and managed sites requiring reliable recurring cleaning on a daily, weekly, or monthly basis.",
      priceGuide: "Manual review required — commercial pricing depends on site size, visit frequency, access windows, and scope. Contact us for a tailored quote.",
      faq: [
        { question: "Can you clean outside of business hours?", answer: "Yes — early morning, evening, and weekend cleans are available for offices and commercial sites to minimise disruption." },
        { question: "Do you offer ongoing service agreements?", answer: "Yes — recurring commercial agreements with fixed scope, visit cadence, and pricing. Reviewed regularly to keep the scope aligned." },
        { question: "What areas of Sydney do you service for commercial cleaning?", answer: "Parramatta and Greater Western Sydney are our primary area. Contact us to confirm coverage for your specific location." },
      ],
    },
  },
};

function sanitizeText(value: unknown, fallback: string, max = 4000) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, max);
}

function sanitizeBoolean(value: unknown, fallback: boolean) {
  if (typeof value !== "boolean") return fallback;
  return value;
}

function sanitizeStringArray(value: unknown, fallback: string[], maxItems = 20, maxLength = 240) {
  if (!Array.isArray(value)) return fallback;
  const cleaned = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems)
    .map((item) => item.slice(0, maxLength));
  return cleaned.length > 0 ? cleaned : fallback;
}

function sanitizeHeroStats(value: unknown, fallback: WebsiteHeroStat[]) {
  if (!Array.isArray(value)) return fallback;
  const rows = value
    .slice(0, 6)
    .map((row, index) => ({
      value: sanitizeText((row as any)?.value, fallback[index]?.value ?? "", 80),
      label: sanitizeText((row as any)?.label, fallback[index]?.label ?? "", 120),
      note: sanitizeText((row as any)?.note, fallback[index]?.note ?? "", 240),
    }))
    .filter((row) => row.value && row.label);
  return rows.length > 0 ? rows : fallback;
}

function sanitizeFeatureCards(value: unknown, fallback: WebsiteFeatureCard[]) {
  if (!Array.isArray(value)) return fallback;
  const rows = value
    .slice(0, 12)
    .map((row, index) => ({
      id: sanitizeText((row as any)?.id, fallback[index]?.id ?? `card-${index + 1}`, 80),
      title: sanitizeText((row as any)?.title, fallback[index]?.title ?? "", 140),
      description: sanitizeText((row as any)?.description, fallback[index]?.description ?? "", 600),
      imageUrl: sanitizeText((row as any)?.imageUrl, fallback[index]?.imageUrl ?? "", 2000),
      imageAlt: sanitizeText((row as any)?.imageAlt, fallback[index]?.imageAlt ?? "", 240),
    }))
    .filter((row) => row.id && row.title && row.description);
  return rows.length > 0 ? rows : fallback;
}

function sanitizeTestimonials(value: unknown, fallback: WebsiteTestimonial[]) {
  if (!Array.isArray(value)) return fallback;
  const rows = value
    .slice(0, 8)
    .map((row, index) => ({
      quote: sanitizeText((row as any)?.quote, fallback[index]?.quote ?? "", 600),
      author: sanitizeText((row as any)?.author, fallback[index]?.author ?? "", 140),
      meta: sanitizeText((row as any)?.meta, fallback[index]?.meta ?? "", 140),
    }))
    .filter((row) => row.quote && row.author);
  return rows.length > 0 ? rows : fallback;
}

function sanitizeLegalSections(value: unknown, fallback: WebsiteLegalSection[]) {
  if (!Array.isArray(value)) return fallback;
  const rows = value
    .slice(0, 20)
    .map((row, index) => ({
      title: sanitizeText((row as any)?.title, fallback[index]?.title ?? "", 160),
      body: sanitizeText((row as any)?.body, fallback[index]?.body ?? "", 1200),
      bullets: sanitizeStringArray((row as any)?.bullets, fallback[index]?.bullets ?? [], 10, 400),
    }))
    .filter((row) => row.title && (row.body || row.bullets.length > 0));
  return rows.length > 0 ? rows : fallback;
}

function sanitizeWhyItems(value: unknown, fallback: WebsiteWhyItem[]) {
  if (!Array.isArray(value)) return fallback;
  const rows = value
    .slice(0, 12)
    .map((row, index) => ({
      id: sanitizeText((row as any)?.id, fallback[index]?.id ?? `why-${index + 1}`, 80),
      icon: sanitizeText((row as any)?.icon, fallback[index]?.icon ?? "Star", 80),
      title: sanitizeText((row as any)?.title, fallback[index]?.title ?? "", 140),
      description: sanitizeText((row as any)?.description, fallback[index]?.description ?? "", 600),
    }))
    .filter((row) => row.id && row.title);
  return rows.length > 0 ? rows : fallback;
}

function sanitizeFaqItems(value: unknown, fallback: WebsiteFaqItem[]) {
  if (!Array.isArray(value)) return fallback;
  const validCategories = new Set(["booking", "pricing", "services", "trust", "airbnb"]);
  const rows = value
    .slice(0, 40)
    .map((row, index) => ({
      id: sanitizeText((row as any)?.id, fallback[index]?.id ?? `faq-${index + 1}`, 80),
      question: sanitizeText((row as any)?.question, fallback[index]?.question ?? "", 300),
      answer: sanitizeText((row as any)?.answer, fallback[index]?.answer ?? "", 1200),
      category: (validCategories.has((row as any)?.category) ? (row as any).category : (fallback[index]?.category ?? "services")) as WebsiteFaqItem["category"],
    }))
    .filter((row) => row.question && row.answer);
  return rows.length > 0 ? rows : fallback;
}

function sanitizePartners(value: unknown, fallback: WebsitePartner[]) {
  if (!Array.isArray(value)) return fallback;
  const rows = value
    .slice(0, 12)
    .map((row, index) => ({
      id: sanitizeText((row as any)?.id, fallback[index]?.id ?? `partner-${index + 1}`, 80),
      name: sanitizeText((row as any)?.name, fallback[index]?.name ?? "", 120),
      logoUrl: sanitizeText((row as any)?.logoUrl, fallback[index]?.logoUrl ?? "", 2000),
      url: sanitizeText((row as any)?.url, fallback[index]?.url ?? "", 2000),
    }));
  return rows.length > 0 ? rows : fallback;
}

function sanitizeGalleryItems(value: unknown, fallback: WebsiteGalleryItem[]) {
  if (!Array.isArray(value)) return fallback;
  const rows = value
    .slice(0, 20)
    .map((row, index) => ({
      id: sanitizeText((row as any)?.id, fallback[index]?.id ?? `gallery-${index + 1}`, 80),
      imageUrl: sanitizeText((row as any)?.imageUrl, fallback[index]?.imageUrl ?? "", 2000),
      imageAlt: sanitizeText((row as any)?.imageAlt, fallback[index]?.imageAlt ?? "", 240),
      caption: sanitizeText((row as any)?.caption, fallback[index]?.caption ?? "", 300),
      serviceType: sanitizeText((row as any)?.serviceType, fallback[index]?.serviceType ?? "", 120),
    }));
  return rows.length > 0 ? rows : fallback;
}

function sanitizeServicePage(value: unknown): WebsiteServicePage {
  if (!value || typeof value !== "object") return BLANK_SERVICE_PAGE;
  const v = value as Record<string, any>;
  return {
    heroImageUrl: sanitizeText(v.heroImageUrl, "", 2000),
    heroImageAlt: sanitizeText(v.heroImageAlt, "", 240),
    whatIncluded: sanitizeStringArray(v.whatIncluded, [], 20, 300),
    notIncluded: sanitizeStringArray(v.notIncluded, [], 20, 300),
    idealFor: sanitizeText(v.idealFor, "", 600),
    priceGuide: sanitizeText(v.priceGuide, "", 400),
    faq: Array.isArray(v.faq)
      ? v.faq
          .slice(0, 8)
          .map((item: any) => ({
            question: sanitizeText(item?.question, "", 300),
            answer: sanitizeText(item?.answer, "", 1200),
          }))
          .filter((item) => item.question && item.answer)
      : [],
  };
}

function sanitizeServicePages(value: unknown, fallback: Record<string, WebsiteServicePage>): Record<string, WebsiteServicePage> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const result: Record<string, WebsiteServicePage> = { ...fallback };
  for (const [slug, pageData] of Object.entries(value as Record<string, unknown>)) {
    if (typeof slug === "string" && slug.length <= 80) {
      result[slug] = sanitizeServicePage(pageData);
    }
  }
  return result;
}

function sanitizeAnnouncementBar(value: unknown, fallback: WebsiteAnnouncementBar): WebsiteAnnouncementBar {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }
  const announcementBar = value as Record<string, unknown>;
  const validBgStyles = new Set<WebsiteAnnouncementBar["bgStyle"]>(["subtle", "accent", "dark", "warning"]);
  const bgStyle = validBgStyles.has((announcementBar.bgStyle as WebsiteAnnouncementBar["bgStyle"]) ?? "subtle")
    ? (announcementBar.bgStyle as WebsiteAnnouncementBar["bgStyle"])
    : fallback.bgStyle;

  return {
    enabled: sanitizeBoolean(announcementBar.enabled, fallback.enabled),
    promoMessage: sanitizeText(announcementBar.promoMessage, fallback.promoMessage, 240),
    promoLink: sanitizeText(announcementBar.promoLink, fallback.promoLink, 2000),
    promoLinkLabel: sanitizeText(announcementBar.promoLinkLabel, fallback.promoLinkLabel, 80),
    bgStyle,
    showPhone: sanitizeBoolean(announcementBar.showPhone, fallback.showPhone),
    showLocation: sanitizeBoolean(announcementBar.showLocation, fallback.showLocation),
    showHours: sanitizeBoolean(announcementBar.showHours, fallback.showHours),
    showEmail: sanitizeBoolean(announcementBar.showEmail, fallback.showEmail),
  };
}

export function sanitizeWebsiteContent(input: unknown, fallback: WebsiteContent = DEFAULT_WEBSITE_CONTENT): WebsiteContent {
  if (!input || typeof input !== "object") return fallback;
  const value = input as Record<string, any>;
  const home = value.home ?? {};
  const services = value.services ?? {};
  const airbnb = value.airbnb ?? {};
  const subscriptions = value.subscriptions ?? {};
  const contact = value.contact ?? {};
  const footer = value.footer ?? {};
  const terms = value.terms ?? {};
  const privacy = value.privacy ?? {};
  const whyChooseUs = value.whyChooseUs ?? {};
  const faq = value.faq ?? {};
  const partners = value.partners ?? {};
  const gallery = value.gallery ?? {};
  const socialLinks = value.socialLinks ?? {};

  return {
    announcementBar: sanitizeAnnouncementBar(value.announcementBar, fallback.announcementBar),
    home: {
      eyebrow: sanitizeText(home.eyebrow, fallback.home.eyebrow, 120),
      title: sanitizeText(home.title, fallback.home.title, 240),
      subtitle: sanitizeText(home.subtitle, fallback.home.subtitle, 1200),
      brandIdea: sanitizeText(home.brandIdea, fallback.home.brandIdea, 800),
      primaryCtaLabel: sanitizeText(home.primaryCtaLabel, fallback.home.primaryCtaLabel, 80),
      secondaryCtaLabel: sanitizeText(home.secondaryCtaLabel, fallback.home.secondaryCtaLabel, 80),
      heroImageUrl: sanitizeText(home.heroImageUrl, fallback.home.heroImageUrl, 2000),
      heroImageAlt: sanitizeText(home.heroImageAlt, fallback.home.heroImageAlt, 240),
      stats: sanitizeHeroStats(home.stats, fallback.home.stats),
      servicesTitle: sanitizeText(home.servicesTitle, fallback.home.servicesTitle, 180),
      servicesIntro: sanitizeText(home.servicesIntro, fallback.home.servicesIntro, 900),
      serviceBenefits: sanitizeFeatureCards(home.serviceBenefits, fallback.home.serviceBenefits),
      hostingTitle: sanitizeText(home.hostingTitle, fallback.home.hostingTitle, 180),
      hostingIntro: sanitizeText(home.hostingIntro, fallback.home.hostingIntro, 900),
      hostingFeatures: sanitizeFeatureCards(home.hostingFeatures, fallback.home.hostingFeatures),
      testimonials: sanitizeTestimonials(home.testimonials, fallback.home.testimonials),
      finalCtaTitle: sanitizeText(home.finalCtaTitle, fallback.home.finalCtaTitle, 180),
      finalCtaBody: sanitizeText(home.finalCtaBody, fallback.home.finalCtaBody, 900),
    },
    services: {
      eyebrow: sanitizeText(services.eyebrow, fallback.services.eyebrow, 120),
      title: sanitizeText(services.title, fallback.services.title, 220),
      intro: sanitizeText(services.intro, fallback.services.intro, 1000),
    },
    airbnb: {
      eyebrow: sanitizeText(airbnb.eyebrow, fallback.airbnb.eyebrow, 120),
      title: sanitizeText(airbnb.title, fallback.airbnb.title, 220),
      subtitle: sanitizeText(airbnb.subtitle, fallback.airbnb.subtitle, 1200),
      heroImageUrl: sanitizeText(airbnb.heroImageUrl, fallback.airbnb.heroImageUrl, 2000),
      heroImageAlt: sanitizeText(airbnb.heroImageAlt, fallback.airbnb.heroImageAlt, 240),
      featuresTitle: sanitizeText(airbnb.featuresTitle, fallback.airbnb.featuresTitle, 180),
      featuresIntro: sanitizeText(airbnb.featuresIntro, fallback.airbnb.featuresIntro, 900),
      features: sanitizeFeatureCards(airbnb.features, fallback.airbnb.features),
      reportsTitle: sanitizeText(airbnb.reportsTitle, fallback.airbnb.reportsTitle, 180),
      reportsBody: sanitizeText(airbnb.reportsBody, fallback.airbnb.reportsBody, 900),
    },
    subscriptions: {
      eyebrow: sanitizeText(subscriptions.eyebrow, fallback.subscriptions.eyebrow, 120),
      title: sanitizeText(subscriptions.title, fallback.subscriptions.title, 220),
      intro: sanitizeText(subscriptions.intro, fallback.subscriptions.intro, 1200),
      compareTitle: sanitizeText(subscriptions.compareTitle, fallback.subscriptions.compareTitle, 180),
      compareBody: sanitizeText(subscriptions.compareBody, fallback.subscriptions.compareBody, 900),
    },
    contact: {
      eyebrow: sanitizeText(contact.eyebrow, fallback.contact.eyebrow, 120),
      title: sanitizeText(contact.title, fallback.contact.title, 220),
      intro: sanitizeText(contact.intro, fallback.contact.intro, 1200),
      formIntro: sanitizeText(contact.formIntro, fallback.contact.formIntro, 900),
      displayEmail: sanitizeText(contact.displayEmail, fallback.contact.displayEmail, 200),
      displayPhone: sanitizeText(contact.displayPhone, fallback.contact.displayPhone, 120),
      addressLine: sanitizeText(contact.addressLine, fallback.contact.addressLine, 240),
      responsePromise: sanitizeText(contact.responsePromise, fallback.contact.responsePromise, 500),
      recipientEmails: sanitizeStringArray(contact.recipientEmails, fallback.contact.recipientEmails, 10, 200),
    },
    footer: {
      blurb: sanitizeText(footer.blurb, fallback.footer.blurb, 500),
      areas: sanitizeText(footer.areas, fallback.footer.areas, 240),
      supportLine: sanitizeText(footer.supportLine, fallback.footer.supportLine, 500),
    },
    terms: {
      title: sanitizeText(terms.title, fallback.terms.title, 240),
      intro: sanitizeText(terms.intro, fallback.terms.intro, 1500),
      publicLiabilityLabel: sanitizeText(terms.publicLiabilityLabel, fallback.terms.publicLiabilityLabel, 120),
      publicLiabilityBody: sanitizeText(terms.publicLiabilityBody, fallback.terms.publicLiabilityBody, 1200),
      sections: sanitizeLegalSections(terms.sections, fallback.terms.sections),
    },
    privacy: {
      title: sanitizeText(privacy.title, fallback.privacy.title, 240),
      intro: sanitizeText(privacy.intro, fallback.privacy.intro, 1500),
      sections: sanitizeLegalSections(privacy.sections, fallback.privacy.sections),
    },
    whyChooseUs: {
      title: sanitizeText(whyChooseUs.title, fallback.whyChooseUs.title, 180),
      intro: sanitizeText(whyChooseUs.intro, fallback.whyChooseUs.intro, 900),
      items: sanitizeWhyItems(whyChooseUs.items, fallback.whyChooseUs.items),
    },
    faq: {
      title: sanitizeText(faq.title, fallback.faq.title, 180),
      intro: sanitizeText(faq.intro, fallback.faq.intro, 600),
      items: sanitizeFaqItems(faq.items, fallback.faq.items),
    },
    partners: {
      title: sanitizeText(partners.title, fallback.partners.title, 180),
      items: sanitizePartners(partners.items, fallback.partners.items),
    },
    gallery: {
      title: sanitizeText(gallery.title, fallback.gallery.title, 180),
      intro: sanitizeText(gallery.intro, fallback.gallery.intro, 600),
      items: sanitizeGalleryItems(gallery.items, fallback.gallery.items),
    },
    socialLinks: {
      whatsapp: sanitizeText(socialLinks.whatsapp, fallback.socialLinks.whatsapp, 30),
      instagram: sanitizeText(socialLinks.instagram, fallback.socialLinks.instagram, 200),
      facebook: sanitizeText(socialLinks.facebook, fallback.socialLinks.facebook, 200),
      linkedin: sanitizeText(socialLinks.linkedin, fallback.socialLinks.linkedin, 200),
    },
    servicePages: sanitizeServicePages(value.servicePages, fallback.servicePages),
    containerWidth: sanitizeText(value.containerWidth, fallback.containerWidth, 20),
  };
}
