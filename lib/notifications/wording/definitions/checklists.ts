/** Wording for the checklist rollout types (catalog-checklists.ts). */
import type { TypeWordingDefinition } from "../types";
import { editable, storePart } from "./build";

const BODY =
  "<p>Hello,</p><p>To set up the cleaning checklist for {{propertyName}}, {{companyName}} would like to know what the property has (dishwasher, oven, pool and so on).</p><p>Open this link, no login needed: <a href=\"{{surveyUrl}}\">{{surveyUrl}}</a></p><p>The link works until {{expiresOn}}.</p><p>Thank you.</p>";

export const CHECKLIST_WORDING: readonly TypeWordingDefinition[] = [
  editable("checklist.amenities_link", [
    storePart(
      "email",
      "Email to the client",
      "EMAIL",
      { subject: "{{companyName}}: what does {{propertyName}} have?", body: BODY },
      ["companyName", "propertyName", "surveyUrl", "expiresOn"],
      ["propertyName", "surveyUrl", "expiresOn"],
      { note: "Email only. The link and its expiry date are made for each send." },
    ),
  ]),
];
