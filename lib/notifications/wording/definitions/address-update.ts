/** Wording for workforce.address_update_request (Cleaner home addresses, 2026-11-17). */
import { editable, inbox } from "./build";

export const ADDRESS_UPDATE_WORDING = editable("workforce.address_update_request", [
  inbox(
    "ask",
    "Check your home address",
    "Please check your home address",
    "The office asked you to check the home address in your profile. {{reason}} Open Your profile to add or correct your street address and suburb. Only administrators can see it.",
    { note: "Inbox only, to each cleaner an administrator chose on Cleaner home addresses, at most once a day. {{reason}} says what is missing." },
  ),
]);
