import type { ChecklistMap } from "@/lib/checklists/types";

export const DEFAULT_CHECKLISTS: ChecklistMap = {
  AIRBNB_TURNOVER: {
    jobType: "AIRBNB_TURNOVER",
    summary:
      "A fast, standardised guest-changeover reset that returns a short-stay property to a hotel-ready state between bookings.",
    notCovered: [
      "Inside oven and grill",
      "Inside cupboards and drawers",
      "Interior or exterior windows beyond glass doors and spot marks",
      "Walls, skirting boards and blinds deep clean",
      "Carpet steam cleaning",
      "Mould remediation",
      "Moving heavy furniture",
    ],
    sections: [
      {
        id: "kitchen",
        title: "Kitchen",
        items: [
          {
            id: "kitchen.benchtops",
            label: "Wipe benchtops and splashback",
            covered: true,
            instructions:
              "Clear all surfaces, spray a multipurpose cleaner and wipe down with a microfibre cloth. Buff stone or laminate dry to remove streaks and check for crumbs along the splashback edge.",
          },
          {
            id: "kitchen.stovetop",
            label: "Clean stovetop and rangehood face",
            covered: true,
            instructions:
              "Spray degreaser on the cooktop, let it dwell 2 to 3 minutes, then scrub with a non-scratch pad and wipe streak-free. Wipe the rangehood face and controls; do not deep clean filters on a turnover.",
          },
          {
            id: "kitchen.sink",
            label: "Clean and polish sink and tapware",
            covered: true,
            instructions:
              "Scrub the sink with a non-abrasive cream cleanser, rinse, then dry and buff the tapware with a microfibre cloth so chrome is spot-free.",
          },
          {
            id: "kitchen.appliances.exterior",
            label: "Wipe appliance exteriors (fridge, microwave, kettle, toaster)",
            covered: true,
            instructions:
              "Wipe all appliance fronts, handles and the microwave interior with multipurpose cleaner. Empty crumbs from the toaster tray and refill the kettle.",
          },
          {
            id: "kitchen.dishes",
            label: "Run/empty dishwasher and put away dishes",
            covered: true,
            instructions:
              "Load any used items and run the dishwasher, or hand-wash and dry. Return all crockery, glassware and utensils to their correct storage so the kitchen presents complete.",
          },
          {
            id: "kitchen.fridge.check",
            label: "Empty and wipe fridge of guest leftovers",
            covered: true,
            instructions:
              "Remove all guest food and drink, wipe shelves and the door seal with a mild detergent, and check the freezer is clear. Report any items left behind to the host.",
          },
          {
            id: "kitchen.bin",
            label: "Empty bins and replace liners",
            covered: true,
            instructions:
              "Empty general waste and recycling, wipe the bin lid, and fit fresh liners. Take rubbish to the property's collection point.",
          },
          {
            id: "kitchen.restock",
            label: "Restock consumables (dishwashing, paper towel, bags)",
            covered: true,
            instructions:
              "Replenish dishwashing liquid, dishwasher tablets, paper towel, bin liners and tea/coffee/sugar to the host's par levels.",
          },
        ],
      },
      {
        id: "bathrooms",
        title: "Bathrooms",
        items: [
          {
            id: "bathroom.toilet",
            label: "Clean and sanitise toilet",
            covered: true,
            instructions:
              "Apply toilet cleaner under the rim and let it dwell. Scrub the bowl with the brush, then wipe the seat, lid, cistern and base with a disinfectant and a dedicated colour-coded cloth.",
          },
          {
            id: "bathroom.shower",
            label: "Clean shower, screen and tiles",
            covered: true,
            instructions:
              "Spray bathroom cleaner over tiles, screen and fittings, dwell 2 to 3 minutes, then scrub and rinse. Squeegee the glass screen and buff tapware dry to prevent water spots.",
          },
          {
            id: "bathroom.basin",
            label: "Clean basin, vanity and mirror",
            covered: true,
            instructions:
              "Wipe the basin and vanity with multipurpose cleaner, polish tapware, and clean the mirror with glass cleaner and a flat-weave microfibre for a streak-free finish.",
          },
          {
            id: "bathroom.surfaces",
            label: "Wipe surfaces and remove guest items",
            covered: true,
            instructions:
              "Clear and wipe all ledges and shelving, removing any guest toiletries or rubbish left behind.",
          },
          {
            id: "bathroom.towels",
            label: "Replace towels and bath mat",
            covered: true,
            instructions:
              "Remove used towels and the bath mat for laundering and set out fresh, folded linen at the host's specified count.",
          },
          {
            id: "bathroom.restock",
            label: "Restock amenities and toilet paper",
            covered: true,
            instructions:
              "Restock hand soap, shampoo/conditioner, body wash and a fresh spare toilet roll to the host's standard presentation.",
          },
          {
            id: "bathroom.floor",
            label: "Mop bathroom floor",
            covered: true,
            instructions:
              "Sweep or vacuum hair and debris, then mop with a bathroom-safe disinfectant, paying attention to behind the toilet and door entry.",
          },
        ],
      },
      {
        id: "bedrooms",
        title: "Bedrooms",
        items: [
          {
            id: "bedroom.linen",
            label: "Strip and remake beds with fresh linen",
            covered: true,
            instructions:
              "Strip all used linen for laundering, inspect the mattress protector, and make the bed with fresh sheets, pillowcases and a styled doona. Hotel-fold and present neatly.",
          },
          {
            id: "bedroom.surfaces",
            label: "Dust and wipe bedside tables and surfaces",
            covered: true,
            instructions:
              "Dust bedside tables, dresser tops, lamps and headboard with a microfibre cloth, working top to bottom.",
          },
          {
            id: "bedroom.mirrors",
            label: "Clean mirrors and glass",
            covered: true,
            instructions:
              "Spray glass cleaner onto a microfibre cloth and buff mirrors and wardrobe glass streak-free.",
          },
          {
            id: "bedroom.tidy",
            label: "Tidy wardrobe, hangers and check for left items",
            covered: true,
            instructions:
              "Reset hangers, check drawers and under the bed for guest belongings, and set out spare blankets and pillows as standard.",
          },
          {
            id: "bedroom.floor",
            label: "Vacuum/mop bedroom floors",
            covered: true,
            instructions:
              "Vacuum carpet and rugs or vacuum and mop hard floors, including under the bed where accessible.",
          },
        ],
      },
      {
        id: "living",
        title: "Living areas",
        items: [
          {
            id: "living.surfaces",
            label: "Dust and wipe surfaces and electronics",
            covered: true,
            instructions:
              "Dust coffee tables, shelving, TV unit and decor top to bottom. Wipe the TV screen and remote with a dry microfibre cloth only.",
          },
          {
            id: "living.sofa",
            label: "Tidy and reset sofa, cushions and throws",
            covered: true,
            instructions:
              "Fluff and straighten cushions, fold throws, and vacuum the sofa surface and between cushions to remove crumbs.",
          },
          {
            id: "living.touchpoints",
            label: "Sanitise high-touch points",
            covered: true,
            instructions:
              "Disinfect light switches, door handles, remotes and bench edges with a sanitiser to leave the space hygienically reset.",
          },
          {
            id: "living.staging",
            label: "Reset staging and welcome presentation",
            covered: true,
            instructions:
              "Return furniture and decor to the host's photo-standard layout and set out any welcome book, guest information or amenities.",
          },
        ],
      },
      {
        id: "floors",
        title: "Floors",
        items: [
          {
            id: "floors.vacuum",
            label: "Vacuum all carpets and hard floors",
            covered: true,
            instructions:
              "Vacuum through the whole property including edges, corners and entry mats to lift dust and debris before mopping.",
          },
          {
            id: "floors.mop",
            label: "Mop all hard floors",
            covered: true,
            instructions:
              "Mop tiles, timber or vinyl with a suitable floor cleaner, working from the far corner back toward the exit to avoid footprints.",
          },
        ],
      },
      {
        id: "general",
        title: "Whole-home reset",
        items: [
          {
            id: "general.bins",
            label: "Empty all bins and remove rubbish",
            covered: true,
            instructions:
              "Empty every bin, replace liners, and take all rubbish and recycling to the building's collection point.",
          },
          {
            id: "general.glassdoors",
            label: "Spot-clean glass doors and entry",
            covered: true,
            instructions:
              "Wipe fingerprints from glass doors, the front door and the entry area so the first impression is clean.",
          },
          {
            id: "general.report",
            label: "Note damage, low stock and maintenance issues",
            covered: true,
            instructions:
              "Photograph and report any damage, stains, low supplies or maintenance faults to the host so issues are actioned before the next guest.",
          },
          {
            id: "general.laundry",
            label: "Start/collect linen laundry",
            covered: true,
            instructions:
              "Bag used linen for the laundry service or start an on-site wash per the host's agreed process.",
          },
        ],
      },
    ],
  },

  GENERAL_CLEAN: {
    jobType: "GENERAL_CLEAN",
    summary:
      "Routine maintenance cleaning of occupied homes covering surfaces, bathrooms, floors and bins to keep the property fresh week to week.",
    notCovered: [
      "Inside oven, grill and range filters",
      "Inside cupboards, drawers and the fridge",
      "Interior and exterior window glass (sills/tracks excluded)",
      "Wall washing and ceiling cobweb removal",
      "Carpet steam cleaning",
      "Mould remediation",
      "Moving heavy furniture or appliances",
    ],
    sections: [
      {
        id: "kitchen",
        title: "Kitchen",
        items: [
          {
            id: "kitchen.benchtops",
            label: "Wipe benchtops and splashback",
            covered: true,
            instructions:
              "Clear and spray surfaces with multipurpose cleaner, wipe with microfibre and buff dry. Address the splashback behind the stove where grease collects.",
          },
          {
            id: "kitchen.stovetop",
            label: "Clean stovetop and rangehood face",
            covered: true,
            instructions:
              "Spray degreaser, dwell 2 to 3 minutes, scrub with a non-scratch pad and wipe streak-free. Wipe the rangehood face and controls.",
          },
          {
            id: "kitchen.sink",
            label: "Clean and polish sink and tapware",
            covered: true,
            instructions:
              "Scrub the sink with a non-abrasive cream cleanser, rinse, then dry and buff tapware so chrome is spot-free.",
          },
          {
            id: "kitchen.appliances.exterior",
            label: "Wipe appliance exteriors and microwave interior",
            covered: true,
            instructions:
              "Wipe fronts and handles of the fridge, oven, dishwasher and small appliances. Wipe the microwave inside and out.",
          },
          {
            id: "kitchen.cupboards.exterior",
            label: "Wipe cupboard fronts and handles",
            covered: true,
            instructions:
              "Wipe cabinet doors and handles to remove fingerprints and splatter; treat any sticky spots with a degreaser.",
          },
          {
            id: "kitchen.bin",
            label: "Empty bins and replace liners",
            covered: true,
            instructions:
              "Empty general waste and recycling, wipe the lid, and fit fresh liners.",
          },
          {
            id: "kitchen.floor",
            label: "Sweep and mop kitchen floor",
            covered: true,
            instructions:
              "Sweep or vacuum debris, then mop with floor cleaner, getting along the kickboards and in front of the sink.",
          },
          {
            id: "kitchen.oven.interior",
            label: "Inside oven (not included in general clean)",
            covered: false,
            instructions:
              "Interior oven detailing is offered as a deep clean or end-of-lease add-on, not in routine maintenance.",
          },
        ],
      },
      {
        id: "bathrooms",
        title: "Bathrooms",
        items: [
          {
            id: "bathroom.toilet",
            label: "Clean and sanitise toilet",
            covered: true,
            instructions:
              "Apply cleaner under the rim and dwell, scrub the bowl, then disinfect seat, lid, cistern and base with a colour-coded cloth.",
          },
          {
            id: "bathroom.shower",
            label: "Clean shower, screen and tiles",
            covered: true,
            instructions:
              "Spray bathroom cleaner, dwell 2 to 3 minutes, scrub tiles and fittings, rinse, then squeegee the screen and buff tapware dry.",
          },
          {
            id: "bathroom.basin",
            label: "Clean basin, vanity and mirror",
            covered: true,
            instructions:
              "Wipe basin and vanity, polish tapware and clean the mirror with glass cleaner for a streak-free finish.",
          },
          {
            id: "bathroom.surfaces",
            label: "Wipe ledges, shelves and towel rails",
            covered: true,
            instructions:
              "Dust and wipe all ledges, shelving and rails, removing soap scum and dust build-up.",
          },
          {
            id: "bathroom.floor",
            label: "Mop bathroom floor",
            covered: true,
            instructions:
              "Sweep or vacuum hair, then mop with a bathroom disinfectant, including behind the toilet and along edges.",
          },
          {
            id: "bathroom.grout",
            label: "Deep grout/mould scrub (not included)",
            covered: false,
            instructions:
              "Heavy grout whitening and mould treatment are specialised services, not part of routine surface cleaning.",
          },
        ],
      },
      {
        id: "bedrooms",
        title: "Bedrooms",
        items: [
          {
            id: "bedroom.surfaces",
            label: "Dust surfaces, sills and skirting tops",
            covered: true,
            instructions:
              "Dust top to bottom: dresser tops, bedside tables, lamps, sills and reachable skirting tops with a microfibre cloth.",
          },
          {
            id: "bedroom.beds",
            label: "Make beds (linen change if left out)",
            covered: true,
            instructions:
              "Make beds neatly; change linen only where the client has set out fresh sheets for the visit.",
          },
          {
            id: "bedroom.mirrors",
            label: "Clean mirrors and glass",
            covered: true,
            instructions:
              "Buff mirrors and wardrobe glass streak-free with glass cleaner on a microfibre cloth.",
          },
          {
            id: "bedroom.floor",
            label: "Vacuum and/or mop floors",
            covered: true,
            instructions:
              "Vacuum carpet and rugs or vacuum and mop hard floors, including under the bed where accessible.",
          },
        ],
      },
      {
        id: "living",
        title: "Living areas",
        items: [
          {
            id: "living.dust",
            label: "Dust surfaces, decor and electronics",
            covered: true,
            instructions:
              "Dust shelving, tables, TV unit and decor top to bottom; wipe screens with a dry microfibre cloth only.",
          },
          {
            id: "living.sofa",
            label: "Tidy and vacuum sofa",
            covered: true,
            instructions:
              "Straighten cushions and vacuum the sofa surface and crevices to remove crumbs and dust.",
          },
          {
            id: "living.touchpoints",
            label: "Sanitise switches, handles and remotes",
            covered: true,
            instructions:
              "Wipe high-touch points with a sanitiser, including light switches, door handles and remotes.",
          },
          {
            id: "living.floor",
            label: "Vacuum and mop floors",
            covered: true,
            instructions:
              "Vacuum carpet and rugs, then vacuum and mop hard floors throughout the living space.",
          },
        ],
      },
      {
        id: "general",
        title: "Whole-home",
        items: [
          {
            id: "general.cobwebs",
            label: "Remove reachable cobwebs",
            covered: true,
            instructions:
              "Remove visible cobwebs from accessible ceiling corners and cornices with an extendable duster.",
          },
          {
            id: "general.bins",
            label: "Empty all bins and replace liners",
            covered: true,
            instructions:
              "Empty bins throughout the home, wipe lids and fit fresh liners.",
          },
          {
            id: "general.doors",
            label: "Spot-clean doors, frames and switches",
            covered: true,
            instructions:
              "Spot-wipe fingerprints and marks from doors, frames and switch plates with a damp microfibre cloth.",
          },
        ],
      },
    ],
  },

  SPRING_CLEANING: {
    jobType: "SPRING_CLEANING",
    summary:
      "A thorough seasonal refresh that goes beyond a general clean to detail neglected areas like skirtings, doors, blinds, sills and inside the microwave, without full end-of-lease depth.",
    notCovered: [
      "Inside oven (offered as an add-on)",
      "Exterior windows above ground floor",
      "Carpet steam cleaning",
      "Mould remediation",
      "Wall washing (spot-clean only)",
    ],
    sections: [
      {
        id: "kitchen",
        title: "Kitchen",
        items: [
          {
            id: "kitchen.benchtops",
            label: "Detail benchtops and splashback",
            covered: true,
            instructions:
              "Clear all surfaces, degrease the splashback and benchtops, and wipe along the back edges and behind small appliances.",
          },
          {
            id: "kitchen.stovetop",
            label: "Detail stovetop, knobs and rangehood face",
            covered: true,
            instructions:
              "Degrease the cooktop, remove and soak trivets/grates, scrub with a non-scratch pad, and clean knobs and the rangehood face.",
          },
          {
            id: "kitchen.cupboards.exterior",
            label: "Wipe cupboard fronts, handles and toe-kicks",
            covered: true,
            instructions:
              "Degrease and wipe all cabinet doors, handles and the toe-kick strip where grease and dust collect.",
          },
          {
            id: "kitchen.microwave",
            label: "Clean inside and out of microwave",
            covered: true,
            instructions:
              "Steam-loosen residue by microwaving a bowl of water and lemon for 2 minutes, then wipe the interior, turntable and door seal.",
          },
          {
            id: "kitchen.appliances.exterior",
            label: "Detail appliance exteriors and tops",
            covered: true,
            instructions:
              "Wipe fronts, handles and the tops of the fridge and cabinetry where dust settles out of sight.",
          },
          {
            id: "kitchen.sink",
            label: "Clean and descale sink and tapware",
            covered: true,
            instructions:
              "Scrub the sink, descale tapware aerators with a mild acid or vinegar solution, rinse and buff dry.",
          },
          {
            id: "kitchen.floor",
            label: "Sweep, mop and detail edges",
            covered: true,
            instructions:
              "Vacuum debris then mop, hand-detailing edges, corners and kickboards that routine cleaning skips.",
          },
        ],
      },
      {
        id: "bathrooms",
        title: "Bathrooms",
        items: [
          {
            id: "bathroom.toilet",
            label: "Deep clean and sanitise toilet",
            covered: true,
            instructions:
              "Apply cleaner under the rim and dwell, scrub the bowl, descale waterline staining, then disinfect seat, hinges, cistern and base.",
          },
          {
            id: "bathroom.shower",
            label: "Descale shower, screen and tiles",
            covered: true,
            instructions:
              "Apply a soap-scum and lime remover, dwell, scrub tiles and screen, rinse and squeegee. Detail the screen channel and seals.",
          },
          {
            id: "bathroom.grout.surface",
            label: "Scrub grout lines (surface)",
            covered: true,
            instructions:
              "Scrub grout with a stiff brush and a mild grout cleaner to lift surface staining; note any areas needing specialist treatment.",
          },
          {
            id: "bathroom.basin",
            label: "Detail basin, vanity and mirror",
            covered: true,
            instructions:
              "Clean the basin and overflow, wipe inside reachable vanity edges, polish tapware and buff the mirror streak-free.",
          },
          {
            id: "bathroom.extractor",
            label: "Dust extractor fan and light fittings",
            covered: true,
            instructions:
              "Vacuum and wipe the exhaust fan cover and light fittings to remove dust build-up.",
          },
          {
            id: "bathroom.floor",
            label: "Mop and detail floor edges",
            covered: true,
            instructions:
              "Vacuum hair, mop with disinfectant and hand-detail behind the toilet and along skirting.",
          },
        ],
      },
      {
        id: "bedrooms",
        title: "Bedrooms",
        items: [
          {
            id: "bedroom.dusting",
            label: "Detail dust including skirting, sills and ledges",
            covered: true,
            instructions:
              "Dust top to bottom including picture rails, sills, skirting boards, lamps and behind accessible furniture.",
          },
          {
            id: "bedroom.blinds",
            label: "Dust blinds and window furnishings",
            covered: true,
            instructions:
              "Dust blinds slat by slat or wipe with a damp microfibre, and vacuum curtain leading edges.",
          },
          {
            id: "bedroom.skirting",
            label: "Wipe skirting boards and door frames",
            covered: true,
            instructions:
              "Damp-wipe skirting boards, door frames and architraves to lift dust and scuffs.",
          },
          {
            id: "bedroom.floor",
            label: "Vacuum and mop, including under beds",
            covered: true,
            instructions:
              "Vacuum carpet thoroughly including under beds where accessible, then mop hard floors to the edges.",
          },
        ],
      },
      {
        id: "living",
        title: "Living areas",
        items: [
          {
            id: "living.dust",
            label: "Detail dust shelving, decor and electronics",
            covered: true,
            instructions:
              "Dust all surfaces, ornaments, shelving and the TV unit top to bottom; wipe screens with a dry microfibre cloth.",
          },
          {
            id: "living.skirting",
            label: "Wipe skirting, sills and door frames",
            covered: true,
            instructions:
              "Damp-wipe skirting boards, window sills and door frames throughout living areas.",
          },
          {
            id: "living.sofa",
            label: "Vacuum sofa and under cushions",
            covered: true,
            instructions:
              "Lift cushions and vacuum the frame, crevices and cushions to remove crumbs, dust and pet hair.",
          },
          {
            id: "living.floor",
            label: "Vacuum and mop floors to edges",
            covered: true,
            instructions:
              "Vacuum carpets and rugs, then vacuum and mop hard floors, detailing edges and corners.",
          },
        ],
      },
      {
        id: "general",
        title: "Whole-home",
        items: [
          {
            id: "general.cobwebs",
            label: "Remove cobwebs and dust cornices",
            covered: true,
            instructions:
              "Clear cobwebs from ceiling corners and cornices and dust ceiling fans and air-con vents with an extendable tool.",
          },
          {
            id: "general.switches",
            label: "Clean light switches, handles and frames",
            covered: true,
            instructions:
              "Wipe and sanitise switch plates, door handles and frames throughout the home.",
          },
          {
            id: "general.windows.interior",
            label: "Clean interior window glass and sills",
            covered: true,
            instructions:
              "Clean reachable interior glass with glass cleaner and a microfibre cloth, and wipe out sills and tracks.",
          },
          {
            id: "general.bins",
            label: "Empty and sanitise bins",
            covered: true,
            instructions:
              "Empty all bins, wash or sanitise the bin bodies, and fit fresh liners.",
          },
        ],
      },
    ],
  },

  DEEP_CLEAN: {
    jobType: "DEEP_CLEAN",
    summary:
      "An exhaustive top-to-bottom clean of the whole home including inside the oven, inside cupboards, skirtings, doors, blinds, sills and grout for properties that are well overdue or being reset.",
    notCovered: [
      "Carpet steam cleaning (separate service)",
      "Exterior windows above ground floor",
      "Structural mould remediation",
      "Pest control",
      "External pressure washing",
    ],
    sections: [
      {
        id: "kitchen",
        title: "Kitchen",
        items: [
          {
            id: "kitchen.oven.interior",
            label: "Clean inside oven, racks and door glass",
            covered: true,
            instructions:
              "Apply a caustic oven cleaner to the interior and racks, dwell per the product label, then scrub off carbon and wipe out thoroughly. Clean between the door glass and rinse all residue. Wear gloves and ventilate.",
          },
          {
            id: "kitchen.stovetop",
            label: "Degrease stovetop, grates and rangehood",
            covered: true,
            instructions:
              "Soak grates and trivets in hot degreaser, scrub the cooktop, and clean the rangehood face; soak metal filters in hot degreasing solution and rinse.",
          },
          {
            id: "kitchen.cupboards.interior",
            label: "Clean inside cupboards and drawers",
            covered: true,
            instructions:
              "Empty where practical, vacuum crumbs, then wipe shelves, drawer interiors and runners with a multipurpose cleaner and dry.",
          },
          {
            id: "kitchen.cupboards.exterior",
            label: "Degrease cupboard fronts and toe-kicks",
            covered: true,
            instructions:
              "Degrease and wipe all cabinet faces, handles and the toe-kick strip, removing built-up grease and grime.",
          },
          {
            id: "kitchen.benchtops",
            label: "Detail benchtops and splashback",
            covered: true,
            instructions:
              "Clear surfaces, degrease the splashback and benchtops, and clean behind and under small appliances.",
          },
          {
            id: "kitchen.sink",
            label: "Descale sink, drain and tapware",
            covered: true,
            instructions:
              "Scrub the sink, clean the drain and overflow, descale tapware with a vinegar or lime-scale solution, then rinse and buff dry.",
          },
          {
            id: "kitchen.appliances",
            label: "Detail appliance exteriors and tops",
            covered: true,
            instructions:
              "Wipe fronts, handles, sides and tops of the fridge, dishwasher and microwave; clean the microwave interior and door seal.",
          },
          {
            id: "kitchen.floor",
            label: "Detail floor, edges and behind appliances",
            covered: true,
            instructions:
              "Vacuum then mop, hand-detailing kickboards, corners and accessible areas beside and behind appliances.",
          },
        ],
      },
      {
        id: "bathrooms",
        title: "Bathrooms",
        items: [
          {
            id: "bathroom.toilet",
            label: "Deep clean and descale toilet",
            covered: true,
            instructions:
              "Apply cleaner under the rim and dwell, scrub the bowl, remove waterline scale, then disinfect the seat, hinges, cistern, base and behind the pan.",
          },
          {
            id: "bathroom.shower",
            label: "Descale and detail shower, screen and seals",
            covered: true,
            instructions:
              "Apply a soap-scum and lime remover, dwell, scrub tiles, screen and channels, rinse and squeegee. Detail seals and tracks and polish tapware.",
          },
          {
            id: "bathroom.grout",
            label: "Scrub and whiten grout and silicone",
            covered: true,
            instructions:
              "Scrub grout lines with a stiff brush and a dedicated grout cleaner or oxygen bleach paste; treat discoloured silicone and rinse thoroughly.",
          },
          {
            id: "bathroom.basin",
            label: "Detail basin, vanity inside and out, mirror",
            covered: true,
            instructions:
              "Clean the basin and overflow, wipe vanity interior and exterior, polish tapware and buff the mirror streak-free.",
          },
          {
            id: "bathroom.extractor",
            label: "Clean extractor fan and light fittings",
            covered: true,
            instructions:
              "Remove and wash the exhaust fan cover where removable, vacuum dust, and wipe light fittings.",
          },
          {
            id: "bathroom.floor",
            label: "Detail floor, skirting and behind toilet",
            covered: true,
            instructions:
              "Vacuum hair, mop with disinfectant, and hand-detail skirting, corners and behind the toilet pan.",
          },
        ],
      },
      {
        id: "bedrooms",
        title: "Bedrooms",
        items: [
          {
            id: "bedroom.dusting",
            label: "Detail dust all surfaces, sills and skirting",
            covered: true,
            instructions:
              "Dust top to bottom including picture rails, light fittings, sills, skirting and behind accessible furniture.",
          },
          {
            id: "bedroom.wardrobe",
            label: "Wipe inside empty wardrobes and shelves",
            covered: true,
            instructions:
              "Vacuum and wipe empty wardrobe interiors, shelving and rails to remove dust and marks.",
          },
          {
            id: "bedroom.blinds",
            label: "Dust/wipe blinds and window furnishings",
            covered: true,
            instructions:
              "Wipe blinds slat by slat and vacuum curtain edges; clean window sills and tracks.",
          },
          {
            id: "bedroom.doors",
            label: "Wipe doors, frames and skirting",
            covered: true,
            instructions:
              "Damp-wipe doors, frames, architraves and skirting boards, spot-cleaning scuffs and marks.",
          },
          {
            id: "bedroom.floor",
            label: "Vacuum and mop, including under beds",
            covered: true,
            instructions:
              "Vacuum carpets thoroughly including under beds, then mop hard floors to the edges.",
          },
        ],
      },
      {
        id: "living",
        title: "Living areas",
        items: [
          {
            id: "living.dust",
            label: "Detail dust shelving, decor and electronics",
            covered: true,
            instructions:
              "Dust all surfaces, ornaments, light fittings and the TV unit top to bottom; wipe screens with a dry microfibre cloth.",
          },
          {
            id: "living.skirting",
            label: "Wipe skirting, doors, frames and sills",
            covered: true,
            instructions:
              "Damp-wipe skirting boards, doors, frames and window sills throughout, spot-cleaning marks.",
          },
          {
            id: "living.walls.spot",
            label: "Spot-clean wall marks and switches",
            covered: true,
            instructions:
              "Spot-clean visible marks on walls with a damp microfibre and gentle cleaner, taking care not to burnish paint; wipe switch plates.",
          },
          {
            id: "living.sofa",
            label: "Vacuum sofa frame and cushions",
            covered: true,
            instructions:
              "Lift cushions and vacuum the frame, crevices and cushions to remove crumbs, dust and pet hair.",
          },
          {
            id: "living.floor",
            label: "Vacuum and mop floors to edges",
            covered: true,
            instructions:
              "Vacuum carpets and rugs, then vacuum and mop hard floors, hand-detailing edges and corners.",
          },
        ],
      },
      {
        id: "general",
        title: "Whole-home",
        items: [
          {
            id: "general.cobwebs",
            label: "Remove cobwebs, dust fans and vents",
            covered: true,
            instructions:
              "Clear cobwebs from ceiling corners and cornices and dust ceiling fans, air-con units and vents with an extendable tool.",
          },
          {
            id: "general.windows.interior",
            label: "Clean interior glass, sills and tracks",
            covered: true,
            instructions:
              "Clean reachable interior window glass, vacuum and wipe tracks, and wipe sills throughout the home.",
          },
          {
            id: "general.switches",
            label: "Sanitise switches, handles and rails",
            covered: true,
            instructions:
              "Wipe and sanitise all switch plates, door handles, rails and high-touch points.",
          },
          {
            id: "general.bins",
            label: "Empty and sanitise all bins",
            covered: true,
            instructions:
              "Empty bins, wash or sanitise the bodies, and fit fresh liners.",
          },
        ],
      },
    ],
  },

  END_OF_LEASE: {
    jobType: "END_OF_LEASE",
    summary:
      "A comprehensive bond-return vacate clean to real-estate exit-condition standard, covering oven, cupboards, walls, skirtings, windows, tracks and wet areas for an empty property.",
    notCovered: [
      "Carpet steam cleaning (quoted separately, often required by the lease)",
      "Pest control / flea treatment (quoted separately if required)",
      "Exterior windows above ground floor",
      "Garden, lawn and rubbish removal",
      "Structural mould remediation and repairs",
    ],
    sections: [
      {
        id: "kitchen",
        title: "Kitchen",
        items: [
          {
            id: "kitchen.oven",
            label: "Detail inside oven, racks, trays and glass",
            covered: true,
            instructions:
              "Apply caustic oven cleaner to the cavity, racks and trays, dwell per label, scrub off all carbon, clean between the door glass and rinse residue-free. Ventilate and wear gloves.",
          },
          {
            id: "kitchen.stovetop",
            label: "Degrease cooktop, grates and rangehood + filters",
            covered: true,
            instructions:
              "Soak grates and filters in hot degreaser, scrub the cooktop, and clean the rangehood inside and out before reassembling.",
          },
          {
            id: "kitchen.cupboards",
            label: "Clean inside and outside all cupboards and drawers",
            covered: true,
            instructions:
              "Vacuum crumbs then wipe every cupboard and drawer interior, shelf, runner and exterior face, removing grease and marks.",
          },
          {
            id: "kitchen.benchtops",
            label: "Detail benchtops, splashback and tiles",
            covered: true,
            instructions:
              "Degrease and wipe benchtops, the full splashback and tiled areas, detailing grout lines where stained.",
          },
          {
            id: "kitchen.sink",
            label: "Descale sink, drain and tapware",
            covered: true,
            instructions:
              "Scrub the sink, clean the drain and overflow, descale tapware, then rinse and buff to a polished finish.",
          },
          {
            id: "kitchen.appliances",
            label: "Clean dishwasher, microwave and provided appliances",
            covered: true,
            instructions:
              "Clean the dishwasher filter and seals, the microwave inside and out, and any landlord-provided appliances inside and out.",
          },
          {
            id: "kitchen.floor",
            label: "Detail floor, edges and behind appliances",
            covered: true,
            instructions:
              "Vacuum then mop, hand-detailing kickboards, corners and accessible areas behind appliances.",
          },
        ],
      },
      {
        id: "bathrooms",
        title: "Bathrooms & laundry",
        items: [
          {
            id: "bathroom.toilet",
            label: "Deep clean and descale toilet",
            covered: true,
            instructions:
              "Scrub and disinfect the bowl, remove waterline scale, and sanitise the seat, hinges, cistern, base and behind the pan.",
          },
          {
            id: "bathroom.shower",
            label: "Descale shower, screen, tiles and seals",
            covered: true,
            instructions:
              "Apply soap-scum and lime remover, dwell, scrub tiles, screen, channels and seals, rinse and squeegee to a clear finish.",
          },
          {
            id: "bathroom.grout",
            label: "Scrub and whiten grout and silicone",
            covered: true,
            instructions:
              "Scrub grout with a stiff brush and grout cleaner or oxygen-bleach paste, treat discoloured silicone and rinse thoroughly.",
          },
          {
            id: "bathroom.vanity",
            label: "Clean basin, vanity inside/out, mirror and tapware",
            covered: true,
            instructions:
              "Clean the basin and overflow, wipe the vanity interior and exterior, polish tapware and buff the mirror streak-free.",
          },
          {
            id: "bathroom.exhaust",
            label: "Clean exhaust fan, fittings and skirting",
            covered: true,
            instructions:
              "Remove and wash the exhaust cover, vacuum dust, wipe light fittings and detail skirting and behind the toilet.",
          },
          {
            id: "laundry.tub",
            label: "Clean laundry tub, cabinetry and behind/around appliances",
            covered: true,
            instructions:
              "Clean the tub and tapware, wipe cabinetry inside and out, and clean accessible areas around washer/dryer connections.",
          },
        ],
      },
      {
        id: "bedrooms",
        title: "Bedrooms",
        items: [
          {
            id: "bedroom.wardrobe",
            label: "Clean inside wardrobes, shelves, rails and mirrors",
            covered: true,
            instructions:
              "Vacuum and wipe wardrobe interiors, shelving, rails, drawers and mirrored doors to a mark-free finish.",
          },
          {
            id: "bedroom.dusting",
            label: "Detail dust all surfaces, sills and skirting",
            covered: true,
            instructions:
              "Dust top to bottom including light fittings, sills, skirting and ledges.",
          },
          {
            id: "bedroom.doors",
            label: "Wipe doors, frames, skirting and switches",
            covered: true,
            instructions:
              "Damp-wipe doors, frames, architraves, skirting and switch plates, spot-cleaning marks.",
          },
          {
            id: "bedroom.walls.spot",
            label: "Spot-clean wall marks and cobwebs",
            covered: true,
            instructions:
              "Remove cobwebs and spot-clean visible wall marks with a damp microfibre and gentle cleaner, avoiding burnishing the paint.",
          },
          {
            id: "bedroom.floor",
            label: "Vacuum and mop floors to edges",
            covered: true,
            instructions:
              "Vacuum carpets to the skirting and mop hard floors to the edges throughout.",
          },
        ],
      },
      {
        id: "living",
        title: "Living areas",
        items: [
          {
            id: "living.dust",
            label: "Detail dust, fittings, vents and fans",
            covered: true,
            instructions:
              "Dust all surfaces, light fittings, ceiling fans and air-con/vents top to bottom.",
          },
          {
            id: "living.skirting",
            label: "Wipe skirting, doors, frames and switches",
            covered: true,
            instructions:
              "Damp-wipe skirting boards, doors, frames and switch plates throughout living areas.",
          },
          {
            id: "living.walls.spot",
            label: "Spot-clean wall marks and cobwebs",
            covered: true,
            instructions:
              "Remove cobwebs and spot-clean wall marks gently; flag any marks that require painting rather than cleaning.",
          },
          {
            id: "living.floor",
            label: "Vacuum and mop all floors",
            covered: true,
            instructions:
              "Vacuum carpets and rugs, then vacuum and mop hard floors to the edges and corners.",
          },
        ],
      },
      {
        id: "windows",
        title: "Windows & tracks",
        items: [
          {
            id: "windows.glass.interior",
            label: "Clean interior window glass",
            covered: true,
            instructions:
              "Clean all reachable interior glass with glass cleaner and a flat-weave microfibre or squeegee for a streak-free finish.",
          },
          {
            id: "windows.tracks",
            label: "Vacuum and wipe tracks and sills",
            covered: true,
            instructions:
              "Vacuum debris from tracks, scrub with a detail brush and detergent, then wipe dry along with the sills.",
          },
          {
            id: "windows.glass.exterior",
            label: "Clean exterior glass (ground-floor/reachable)",
            covered: true,
            instructions:
              "Clean reachable ground-floor exterior glass; exterior glass above ground floor is excluded for safety.",
          },
        ],
      },
      {
        id: "general",
        title: "Whole-property",
        items: [
          {
            id: "general.cobwebs",
            label: "Remove all cobwebs and dust cornices",
            covered: true,
            instructions:
              "Clear cobwebs from every room's ceiling corners, cornices and external eaves within reach.",
          },
          {
            id: "general.airvents",
            label: "Dust air vents, returns and smoke alarms",
            covered: true,
            instructions:
              "Dust and wipe air-conditioning vents, return grilles and smoke-alarm covers without dislodging them.",
          },
          {
            id: "general.bins",
            label: "Clean and sanitise bins; remove cleaning rubbish",
            covered: true,
            instructions:
              "Wash and sanitise bins inside and out and remove all rubbish generated during the clean.",
          },
        ],
      },
    ],
  },

  PRESSURE_WASH: {
    jobType: "PRESSURE_WASH",
    summary:
      "High-pressure and soft-wash cleaning of hard external surfaces such as driveways, paths, patios and walls to remove dirt, moss, lichen and stains.",
    notCovered: [
      "Roof tile walking/pressure washing (soft wash only by quote)",
      "Painted surfaces that may strip under pressure",
      "Window glass (separate window service)",
      "Mould remediation inside the home",
      "Removal of permanent oil or paint stains (best-effort only)",
    ],
    sections: [
      {
        id: "prep",
        title: "Preparation",
        items: [
          {
            id: "prep.clear",
            label: "Clear area and protect plants/fixtures",
            covered: true,
            instructions:
              "Move pots, furniture and obstacles, pre-wet adjacent garden beds, and cover or avoid power outlets, light fittings and delicate fixtures.",
          },
          {
            id: "prep.sweep",
            label: "Sweep loose debris and pre-treat",
            covered: true,
            instructions:
              "Sweep away loose dirt and leaves, then apply a suitable detergent or moss/mould treatment and let it dwell before washing.",
          },
        ],
      },
      {
        id: "surfaces",
        title: "Surface washing",
        items: [
          {
            id: "surfaces.driveway",
            label: "Pressure wash driveway",
            covered: true,
            instructions:
              "Use a surface cleaner attachment for even results, working in overlapping passes at a consistent distance to avoid striping the concrete.",
          },
          {
            id: "surfaces.paths",
            label: "Pressure wash paths and entry",
            covered: true,
            instructions:
              "Wash paths and entry areas in steady overlapping passes, keeping the nozzle moving to prevent etching.",
          },
          {
            id: "surfaces.patio",
            label: "Wash patio, alfresco and pavers",
            covered: true,
            instructions:
              "Clean pavers and patio surfaces, adjusting pressure for the material; re-sand paver joints afterward if required (by quote).",
          },
          {
            id: "surfaces.walls",
            label: "Soft wash external walls and render",
            covered: true,
            instructions:
              "Use a low-pressure soft-wash with detergent on render and painted walls to lift grime without damaging the surface, then rinse top to bottom.",
          },
          {
            id: "surfaces.driveway.stains",
            label: "Treat oil and rust stains (best effort)",
            covered: true,
            instructions:
              "Apply a degreaser to oil spots and a rust remover to rust marks, agitate and rinse; deeply set stains may not fully clear.",
          },
        ],
      },
      {
        id: "finish",
        title: "Finishing",
        items: [
          {
            id: "finish.rinse",
            label: "Final rinse and clear runoff",
            covered: true,
            instructions:
              "Rinse the whole area and surrounding plants, and direct or sweep runoff away from drains where required by local regulations.",
          },
          {
            id: "finish.reset",
            label: "Replace furniture and tidy",
            covered: true,
            instructions:
              "Once surfaces are clear of standing water, return furniture and pots and remove any equipment and hoses.",
          },
        ],
      },
    ],
  },

  TILE_GROUT_CLEANING: {
    jobType: "TILE_GROUT_CLEANING",
    summary:
      "Deep cleaning and restoration of tiled floors and walls and their grout lines, with optional sealing to keep grout cleaner for longer.",
    notCovered: [
      "Re-grouting or tile repair",
      "Replacing perished silicone (sealing of grout only)",
      "Guaranteed removal of permanent dye or efflorescence stains",
      "Polishing or honing of natural stone (specialist service)",
    ],
    sections: [
      {
        id: "prep",
        title: "Preparation",
        items: [
          {
            id: "prep.sweep",
            label: "Sweep/vacuum and clear loose dirt",
            covered: true,
            instructions:
              "Vacuum and sweep the tiled area thoroughly so loose grit does not turn to slurry during scrubbing.",
          },
          {
            id: "prep.pretreat",
            label: "Apply grout cleaner and dwell",
            covered: true,
            instructions:
              "Apply an alkaline grout and tile cleaner to the grout lines and let it dwell several minutes to break down soil before agitation.",
          },
        ],
      },
      {
        id: "clean",
        title: "Deep clean",
        items: [
          {
            id: "clean.grout",
            label: "Agitate and scrub grout lines",
            covered: true,
            instructions:
              "Agitate grout lines with a stiff grout brush or rotary brush to lift embedded soil and staining from the porous grout.",
          },
          {
            id: "clean.tiles",
            label: "Clean tile faces and texture",
            covered: true,
            instructions:
              "Clean the tile faces, paying attention to textured or matt tiles where grime sits in the surface, then agitate as needed.",
          },
          {
            id: "clean.extract",
            label: "Rinse and extract dirty solution",
            covered: true,
            instructions:
              "Rinse with clean water and extract the soiled solution with a wet vacuum so dirt is removed rather than redeposited.",
          },
        ],
      },
      {
        id: "finish",
        title: "Finishing & sealing",
        items: [
          {
            id: "finish.dry",
            label: "Dry and inspect results",
            covered: true,
            instructions:
              "Dry the surface and inspect grout lines under good light, re-treating stubborn areas before sealing.",
          },
          {
            id: "finish.seal",
            label: "Apply grout sealer (optional add-on)",
            covered: true,
            instructions:
              "Once grout is fully dry, apply a penetrating grout sealer evenly with an applicator, wipe excess off the tile face, and allow the recommended cure time before use.",
          },
        ],
      },
    ],
  },

  POST_CONSTRUCTION: {
    jobType: "POST_CONSTRUCTION",
    summary:
      "A builder's and post-renovation clean removing dust, plaster, paint specks, stickers and debris to make a newly built or renovated space ready to occupy.",
    notCovered: [
      "Removal of building waste and skip materials",
      "Paint or render touch-ups and trade rectification",
      "Carpet steam cleaning (separate service)",
      "Exterior windows above ground floor",
      "Removal of structural adhesives or set concrete spills (best-effort)",
    ],
    sections: [
      {
        id: "debris",
        title: "Debris & rough clean",
        items: [
          {
            id: "debris.remove",
            label: "Remove loose debris and protective coverings",
            covered: true,
            instructions:
              "Collect loose offcuts, packaging and protective films/tape from surfaces and fittings, and bag light debris for disposal.",
          },
          {
            id: "debris.dust.gross",
            label: "Gross dust removal (HEPA vacuum)",
            covered: true,
            instructions:
              "HEPA-vacuum fine construction dust from floors, ledges, vents and frames first, as wiping dry dust spreads it. Work top to bottom.",
          },
        ],
      },
      {
        id: "detail",
        title: "Detail clean",
        items: [
          {
            id: "detail.surfaces",
            label: "Wipe all surfaces, ledges and joinery",
            covered: true,
            instructions:
              "Damp-wipe every surface, ledge, shelf and joinery face to remove residual fine dust after vacuuming.",
          },
          {
            id: "detail.paint",
            label: "Remove paint specks, stickers and adhesive",
            covered: true,
            instructions:
              "Remove paint over-spray and stickers from glass and hard surfaces with a plastic blade and adhesive remover, working carefully to avoid scratching.",
          },
          {
            id: "detail.fittings",
            label: "Clean fixtures, switches and fittings",
            covered: true,
            instructions:
              "Wipe light fittings, switch plates, power points, door hardware and tapware to remove dust and handling marks.",
          },
          {
            id: "detail.cabinets",
            label: "Clean inside and outside cabinetry",
            covered: true,
            instructions:
              "Vacuum and wipe the inside and outside of new cupboards, drawers and wardrobes to remove sawdust and debris.",
          },
        ],
      },
      {
        id: "wet",
        title: "Wet areas",
        items: [
          {
            id: "wet.kitchen",
            label: "Detail kitchen and appliances",
            covered: true,
            instructions:
              "Clean benchtops, splashback, sink and appliance interiors/exteriors, removing protective film and dust.",
          },
          {
            id: "wet.bathrooms",
            label: "Detail bathrooms and tiles",
            covered: true,
            instructions:
              "Clean and de-haze tiles, remove grout smears and cement film, and clean fixtures, screens and tapware.",
          },
        ],
      },
      {
        id: "glass",
        title: "Glass & floors",
        items: [
          {
            id: "glass.windows",
            label: "Clean interior glass and tracks",
            covered: true,
            instructions:
              "Remove labels and film, scrape specks, then clean interior glass and vacuum/wipe tracks and sills.",
          },
          {
            id: "floors.final",
            label: "Vacuum and mop/finish all floors",
            covered: true,
            instructions:
              "Vacuum again to capture settled dust, then mop hard floors with frequent water changes until rinse water runs clear.",
          },
        ],
      },
    ],
  },

  WINDOW_CLEAN: {
    jobType: "WINDOW_CLEAN",
    summary:
      "Professional cleaning of window glass, frames, tracks and screens for a streak-free, clear result inside and out where safely reachable.",
    notCovered: [
      "Windows above ground floor requiring scaffolding or roof access",
      "Removal of hard mineral or paint stains baked into glass (best-effort)",
      "Repair of damaged screens or seals",
      "Solar panel cleaning",
    ],
    sections: [
      {
        id: "interior",
        title: "Interior glass",
        items: [
          {
            id: "interior.glass",
            label: "Clean interior window glass",
            covered: true,
            instructions:
              "Apply glass cleaner or a wet strip-washer, then squeegee in overlapping strokes, wiping the blade each pass, and detail edges with a flat-weave microfibre.",
          },
          {
            id: "interior.sills",
            label: "Wipe interior sills and ledges",
            covered: true,
            instructions:
              "Wipe sills and ledges to remove dust and any drips from the glass cleaning.",
          },
        ],
      },
      {
        id: "exterior",
        title: "Exterior glass",
        items: [
          {
            id: "exterior.glass",
            label: "Clean exterior glass (reachable)",
            covered: true,
            instructions:
              "Wash exterior glass with a strip-washer and detergent, squeegee streak-free, or use a water-fed pole with purified water for higher reachable panes.",
          },
          {
            id: "exterior.flyspecks",
            label: "Remove fly specks and grime",
            covered: true,
            instructions:
              "Pre-soak heavily soiled glass and gently scrape stubborn specks with a glass-safe blade before squeegeeing.",
          },
        ],
      },
      {
        id: "tracks",
        title: "Tracks & frames",
        items: [
          {
            id: "tracks.clean",
            label: "Vacuum and scrub tracks",
            covered: true,
            instructions:
              "Vacuum grit from sliding tracks, scrub with a detail brush and detergent, then wipe dry so windows slide freely.",
          },
          {
            id: "tracks.frames",
            label: "Wipe frames and sashes",
            covered: true,
            instructions:
              "Damp-wipe frames, sashes and handles to remove dust, cobwebs and marks.",
          },
        ],
      },
      {
        id: "screens",
        title: "Screens",
        items: [
          {
            id: "screens.clean",
            label: "Remove and clean fly/security screens",
            covered: true,
            instructions:
              "Where removable, take screens out, brush and rinse the mesh with mild detergent, dry, then refit. Note any damaged screens to the client.",
          },
        ],
      },
    ],
  },

  CARPET_STEAM_CLEAN: {
    jobType: "CARPET_STEAM_CLEAN",
    summary:
      "Hot-water-extraction (steam) cleaning of carpets with pre-treatment of stains and high-traffic areas for a deep, sanitising clean.",
    notCovered: [
      "Guaranteed removal of permanent dye, bleach or rust stains",
      "Repair of damaged, delaminated or burnt carpet",
      "Moving heavy furniture (light items only)",
      "Flea/pest treatment (separate service)",
      "Same-day dry guarantee (drying times vary)",
    ],
    sections: [
      {
        id: "pretreatment",
        title: "Pre-treatment",
        items: [
          {
            id: "pretreatment.vacuum",
            label: "Vacuum thoroughly",
            covered: true,
            instructions:
              "Vacuum the carpet in multiple directions to remove dry soil and grit, which is essential before any wet cleaning.",
          },
          {
            id: "pretreatment.spots",
            label: "Pre-treat stains and traffic lanes",
            covered: true,
            instructions:
              "Apply an appropriate pre-spray to traffic lanes and spot-treat stains by type (protein, tannin, oil), allowing dwell time before extraction.",
          },
          {
            id: "pretreatment.agitate",
            label: "Agitate pre-spray into pile",
            covered: true,
            instructions:
              "Work the pre-spray into the pile with a brush or groomer so the solution reaches the base of the fibres.",
          },
        ],
      },
      {
        id: "extraction",
        title: "Steam extraction",
        items: [
          {
            id: "extraction.steam",
            label: "Hot-water extraction",
            covered: true,
            instructions:
              "Make slow overlapping wet and dry passes with the extraction wand to flush soil and recover as much moisture as possible.",
          },
          {
            id: "extraction.rinse",
            label: "Neutralise and rinse",
            covered: true,
            instructions:
              "Use a neutralising rinse to remove detergent residue, which otherwise attracts dirt and causes rapid re-soiling.",
          },
          {
            id: "extraction.spots",
            label: "Post-treat any remaining spots",
            covered: true,
            instructions:
              "Re-treat any lingering spots with a targeted spotter and re-extract, advising the client on stains that may be permanent.",
          },
        ],
      },
      {
        id: "drying",
        title: "Drying & finish",
        items: [
          {
            id: "drying.groom",
            label: "Groom pile",
            covered: true,
            instructions:
              "Groom the pile in one direction to speed drying and leave an even, professional finish.",
          },
          {
            id: "drying.airflow",
            label: "Set up air movers / ventilation",
            covered: true,
            instructions:
              "Position air movers or open windows to promote airflow; advise the client to keep foot traffic light until the carpet is dry (typically 2 to 6 hours).",
          },
        ],
      },
    ],
  },

  UPHOLSTERY_CLEANING: {
    jobType: "UPHOLSTERY_CLEANING",
    summary:
      "Fabric and microfibre upholstery cleaning by pre-treatment and low-moisture extraction, with fabric-appropriate methods to refresh sofas and chairs.",
    notCovered: [
      "Leather conditioning (separate leather-care service)",
      "Guaranteed removal of permanent or dye-transfer stains",
      "Reupholstery or structural repair",
      "Dry-clean-only (code S) fabrics with water (solvent method only)",
    ],
    sections: [
      {
        id: "assessment",
        title: "Assessment & prep",
        items: [
          {
            id: "assessment.code",
            label: "Check fabric care code and test",
            covered: true,
            instructions:
              "Read the manufacturer's cleaning code (W, S, WS or X) and test cleaning solution on a hidden area for colourfastness before proceeding.",
          },
          {
            id: "assessment.vacuum",
            label: "Vacuum upholstery and crevices",
            covered: true,
            instructions:
              "Vacuum the surface, cushions and crevices with an upholstery tool to remove loose soil, crumbs and pet hair.",
          },
        ],
      },
      {
        id: "cleaning",
        title: "Cleaning",
        items: [
          {
            id: "cleaning.pretreat",
            label: "Pre-treat soiled areas and spots",
            covered: true,
            instructions:
              "Apply a fabric-safe pre-spray to arms, headrests and spots, and dwell to break down body oils and soiling.",
          },
          {
            id: "cleaning.extract",
            label: "Low-moisture extraction clean",
            covered: true,
            instructions:
              "Clean with a hand extraction tool using controlled moisture, making overlapping passes and recovering moisture to avoid over-wetting the padding.",
          },
          {
            id: "cleaning.solvent",
            label: "Solvent clean for code S fabrics",
            covered: true,
            instructions:
              "For solvent-only (S) fabrics, use a dry solvent cleaner with a brush and absorbent towel instead of water-based extraction.",
          },
        ],
      },
      {
        id: "finish",
        title: "Finishing & drying",
        items: [
          {
            id: "finish.groom",
            label: "Groom and reset pile/nap",
            covered: true,
            instructions:
              "Brush the fabric to reset the nap and prevent watermarks as it dries.",
          },
          {
            id: "finish.dry",
            label: "Speed drying with airflow",
            covered: true,
            instructions:
              "Use airflow or a fan to dry the upholstery and advise the client to avoid use until fully dry.",
          },
        ],
      },
    ],
  },

  LAWN_MOWING: {
    jobType: "LAWN_MOWING",
    summary:
      "Regular lawn maintenance including mowing, edging and a tidy-up of clippings to keep yards neat and healthy.",
    notCovered: [
      "Hedge trimming and tree pruning (separate garden service)",
      "Weeding garden beds and mulching",
      "Green-waste removal beyond bagging clippings (by quote)",
      "Turf laying, fertilising programs and irrigation repair",
    ],
    sections: [
      {
        id: "mowing",
        title: "Mowing",
        items: [
          {
            id: "mowing.cut",
            label: "Mow lawn at correct height",
            covered: true,
            instructions:
              "Mow when the grass is dry, removing no more than one-third of the blade height to avoid stressing the lawn, and overlap passes for an even cut.",
          },
          {
            id: "mowing.obstacles",
            label: "Clear obstacles and check area first",
            covered: true,
            instructions:
              "Walk the lawn first to remove sticks, toys, hoses and pet waste so the mower runs safely and cleanly.",
          },
        ],
      },
      {
        id: "edging",
        title: "Edging & trimming",
        items: [
          {
            id: "edging.edges",
            label: "Edge paths, driveways and beds",
            covered: true,
            instructions:
              "Define edges along paths, driveways and garden beds with a line trimmer or edger for a crisp finish.",
          },
          {
            id: "edging.whippersnip",
            label: "Whipper-snip around obstacles",
            covered: true,
            instructions:
              "Trim grass around fences, posts, trees and air-con units that the mower cannot reach, protecting trunks and structures.",
          },
        ],
      },
      {
        id: "cleanup",
        title: "Clean-up",
        items: [
          {
            id: "cleanup.blow",
            label: "Blow/sweep clippings off hard surfaces",
            covered: true,
            instructions:
              "Blow or sweep clippings from paths, driveways and entryways back onto the lawn or into a pile for collection.",
          },
          {
            id: "cleanup.dispose",
            label: "Bag or mulch clippings",
            covered: true,
            instructions:
              "Catch and bag clippings, or mulch back into the lawn where appropriate, leaving the area tidy.",
          },
        ],
      },
    ],
  },

  GUTTER_CLEANING: {
    jobType: "GUTTER_CLEANING",
    summary:
      "Clearing leaves and debris from gutters and downpipes to restore water flow and reduce overflow and fire risk, on single-storey and safely reachable rooflines.",
    notCovered: [
      "Multi-storey or steep roofs requiring scaffolding/harness rigging (by quote)",
      "Gutter, downpipe or roof repairs and replacement",
      "Gutter guard supply and installation (separate service)",
      "Roof cleaning or moss treatment",
      "Pressure washing of roof tiles",
    ],
    sections: [
      {
        id: "safety",
        title: "Safety & setup",
        items: [
          {
            id: "safety.ladder",
            label: "Set up and secure ladder",
            covered: true,
            instructions:
              "Place the ladder on firm level ground at the correct angle, secure or have it footed, and maintain three points of contact at all times.",
          },
          {
            id: "safety.assess",
            label: "Assess roofline and hazards",
            covered: true,
            instructions:
              "Check for power lines, brittle tiles, wasp nests and unsafe access before starting, and decline unsafe heights for re-quote.",
          },
        ],
      },
      {
        id: "clearing",
        title: "Clearing",
        items: [
          {
            id: "clearing.gutters",
            label: "Remove leaves and debris from gutters",
            covered: true,
            instructions:
              "Scoop debris by hand into a bucket or bag rather than dropping it down the wall, working systematically along each run.",
          },
          {
            id: "clearing.downpipes",
            label: "Check and clear downpipes",
            covered: true,
            instructions:
              "Check downpipe outlets for blockages and clear them so water drains freely; flush with a hose to confirm flow.",
          },
          {
            id: "clearing.flush",
            label: "Flush gutters and check fall",
            covered: true,
            instructions:
              "Flush gutters with water to remove fine sediment and confirm they drain toward downpipes without pooling.",
          },
        ],
      },
      {
        id: "finish",
        title: "Finish",
        items: [
          {
            id: "finish.cleanup",
            label: "Bag debris and clean up",
            covered: true,
            instructions:
              "Collect all removed debris, leave the area tidy, and dispose of green waste per the agreed arrangement.",
          },
          {
            id: "finish.report",
            label: "Report damage or rust",
            covered: true,
            instructions:
              "Note and photograph any rust, sagging, loose brackets or damaged downpipes for the client to action.",
          },
        ],
      },
    ],
  },

  COMMERCIAL_RECURRING: {
    jobType: "COMMERCIAL_RECURRING",
    summary:
      "Scheduled recurring commercial cleaning of offices and workspaces covering touchpoints, washrooms, kitchens, floors and waste to a consistent professional standard.",
    notCovered: [
      "Carpet steam cleaning and hard-floor stripping/sealing (periodic add-on)",
      "High-level and external window cleaning",
      "Specialised medical, industrial or hazardous waste handling",
      "Consumable supply unless contracted",
    ],
    sections: [
      {
        id: "touchpoints",
        title: "Touchpoints & surfaces",
        items: [
          {
            id: "touchpoints.sanitise",
            label: "Sanitise high-touch points",
            covered: true,
            instructions:
              "Disinfect door handles, switches, lift buttons, handrails and shared equipment with a TGA-listed disinfectant and correct dwell time.",
          },
          {
            id: "touchpoints.desks",
            label: "Wipe desks and reception surfaces",
            covered: true,
            instructions:
              "Wipe clear desk surfaces, reception counters and meeting tables, leaving personal items and papers undisturbed.",
          },
          {
            id: "touchpoints.dust",
            label: "Dust surfaces and fittings",
            covered: true,
            instructions:
              "Dust ledges, sills, partitions and fittings with a microfibre cloth, working top to bottom.",
          },
        ],
      },
      {
        id: "washrooms",
        title: "Washrooms",
        items: [
          {
            id: "washrooms.toilets",
            label: "Clean and sanitise toilets and urinals",
            covered: true,
            instructions:
              "Clean and disinfect pans, urinals, seats and flush plates with colour-coded cloths and a washroom disinfectant.",
          },
          {
            id: "washrooms.basins",
            label: "Clean basins, mirrors and tapware",
            covered: true,
            instructions:
              "Clean basins, polish mirrors and tapware, and wipe vanity surfaces to a spot-free finish.",
          },
          {
            id: "washrooms.restock",
            label: "Restock consumables",
            covered: true,
            instructions:
              "Replenish toilet paper, hand towel, soap and sanitiser where supply is contracted, and report low stock otherwise.",
          },
          {
            id: "washrooms.floor",
            label: "Mop and sanitise washroom floors",
            covered: true,
            instructions:
              "Sweep then mop with a washroom disinfectant, using wet-floor signage during cleaning.",
          },
        ],
      },
      {
        id: "kitchen",
        title: "Kitchen / breakout",
        items: [
          {
            id: "kitchen.surfaces",
            label: "Clean benches, sink and appliance exteriors",
            covered: true,
            instructions:
              "Wipe benches, splashback and sink, and clean the exteriors and microwave interior of shared appliances.",
          },
          {
            id: "kitchen.bins",
            label: "Empty bins and replace liners",
            covered: true,
            instructions:
              "Empty general and recycling bins, wipe lids, and fit fresh liners; remove waste to the collection point.",
          },
        ],
      },
      {
        id: "floors",
        title: "Floors & waste",
        items: [
          {
            id: "floors.vacuum",
            label: "Vacuum carpets and mats",
            covered: true,
            instructions:
              "Vacuum carpeted areas, walk-off mats and under desks where accessible to lift daily soil.",
          },
          {
            id: "floors.mop",
            label: "Mop hard floors",
            covered: true,
            instructions:
              "Sweep or dust-mop, then damp-mop hard floors with a neutral cleaner, displaying wet-floor signage.",
          },
          {
            id: "floors.bins",
            label: "Empty all office bins",
            covered: true,
            instructions:
              "Empty under-desk and common-area bins, replace liners and consolidate waste for collection.",
          },
        ],
      },
    ],
  },

  SPECIAL_CLEAN: {
    jobType: "SPECIAL_CLEAN",
    summary:
      "A custom one-off clean scoped to the client's specific requirements where standard packages do not fit, quoted and tailored on assessment.",
    notCovered: [
      "Biohazard, trauma or hoarding remediation (specialist licensed service)",
      "Asbestos handling and hazardous materials",
      "Pest control",
      "Anything outside the agreed scope confirmed in the quote",
    ],
    sections: [
      {
        id: "scope",
        title: "Scope & assessment",
        items: [
          {
            id: "scope.brief",
            label: "Confirm client brief and priorities",
            covered: true,
            instructions:
              "Walk through the property with the client, confirm the specific tasks and priorities, and document the agreed scope before starting.",
          },
          {
            id: "scope.products",
            label: "Select correct products and method",
            covered: true,
            instructions:
              "Choose products and methods suited to the surfaces involved and spot-test on delicate or unknown materials first.",
          },
        ],
      },
      {
        id: "execution",
        title: "Execution",
        items: [
          {
            id: "execution.tasks",
            label: "Complete agreed tasks to standard",
            covered: true,
            instructions:
              "Work through the agreed task list methodically top to bottom and clean to dirty, checking results against the brief.",
          },
          {
            id: "execution.detail",
            label: "Detail target areas of concern",
            covered: true,
            instructions:
              "Give extra attention to the specific problem areas the client raised, using appropriate specialist techniques.",
          },
          {
            id: "execution.safety",
            label: "Follow safety and ventilation practices",
            covered: true,
            instructions:
              "Use appropriate PPE, ventilate when using stronger chemicals, and never mix incompatible products such as bleach and acids.",
          },
        ],
      },
      {
        id: "handover",
        title: "Handover",
        items: [
          {
            id: "handover.inspect",
            label: "Inspect with client and sign off",
            covered: true,
            instructions:
              "Walk the completed work with the client, address any spot fixes, and confirm the job meets the agreed brief.",
          },
        ],
      },
    ],
  },

  MOLD_TREATMENT: {
    jobType: "MOLD_TREATMENT",
    summary:
      "Treatment of surface mould on walls, ceilings, tiles and wet-area silicone to clean and inhibit regrowth on accessible non-structural surfaces.",
    notCovered: [
      "Structural / Category 3 mould remediation and removal of affected building materials",
      "Fixing the moisture source (leaks, ventilation, rising damp)",
      "Air-quality testing and laboratory sampling",
      "Re-painting, re-grouting or replacing perished silicone",
      "Mould inside cavities, ducts or under flooring",
    ],
    sections: [
      {
        id: "assessment",
        title: "Assessment & safety",
        items: [
          {
            id: "assessment.extent",
            label: "Assess extent and identify cause",
            covered: true,
            instructions:
              "Inspect the affected area, identify the likely moisture source, and advise the client that surface treatment will not last unless the cause is fixed. Refer extensive growth to specialist remediation.",
          },
          {
            id: "assessment.ppe",
            label: "Set up PPE and ventilation",
            covered: true,
            instructions:
              "Wear gloves, eye protection and a P2 mask, ventilate the room, and contain the area to limit spore spread during cleaning.",
          },
        ],
      },
      {
        id: "treatment",
        title: "Treatment",
        items: [
          {
            id: "treatment.clean",
            label: "Clean visible mould from surfaces",
            covered: true,
            instructions:
              "Gently wipe mould from hard surfaces with a detergent solution rather than dry brushing, which disperses spores. Avoid spreading growth into clean areas.",
          },
          {
            id: "treatment.apply",
            label: "Apply mould treatment to inhibit regrowth",
            covered: true,
            instructions:
              "Apply a suitable mould treatment to the cleaned surface, dwell per the product label, and wipe or leave per directions. Never mix bleach with other cleaners.",
          },
          {
            id: "treatment.silicone",
            label: "Treat affected silicone and grout (surface)",
            covered: true,
            instructions:
              "Treat mouldy silicone and grout on the surface; advise replacement where mould has penetrated and cannot be cleaned out.",
          },
        ],
      },
      {
        id: "finish",
        title: "Finish & advice",
        items: [
          {
            id: "finish.dry",
            label: "Dry area and improve airflow",
            covered: true,
            instructions:
              "Dry the treated surfaces fully and improve ventilation to slow regrowth while the underlying cause is addressed.",
          },
          {
            id: "finish.advice",
            label: "Advise on prevention and next steps",
            covered: true,
            instructions:
              "Recommend fixing leaks, improving ventilation and managing humidity, and refer to a specialist where the mould is structural or recurring.",
          },
        ],
      },
    ],
  },
};

export default DEFAULT_CHECKLISTS;
