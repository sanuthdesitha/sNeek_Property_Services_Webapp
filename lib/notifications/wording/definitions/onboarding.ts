/** Wording for the property onboarding types (catalog-onboarding.ts). */
import type { TypeWordingDefinition } from "../types";
import { editable, inbox, inCode } from "./build";

export const ONBOARDING_WORDING: readonly TypeWordingDefinition[] = [
  inCode("onboarding.client_link", "The message names the property, the parts the office ticked, the link and how long it works; the parts and the link are built for each send."),
  editable("onboarding.client_finished", [
    inbox("finished", "Client finished", "Client finished their part: {{propertyName}}", "The client finished {{sections}} for {{surveyNumber}}. Review their answers (and any codes they typed) before activating.", {
      required: ["propertyName"],
      note: "Inbox only, to administrators and operations managers. Nothing is activated.",
    }),
  ]),
];
