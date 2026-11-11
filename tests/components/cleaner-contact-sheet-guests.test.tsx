import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ContactRows } from "@/components/v2/cleaner/contact-sheet";

afterEach(cleanup);

it("lists the departing guest before the arriving guest, each labelled", () => {
  render(
    <ContactRows
      contact={{ guestName: "Arriving Ana", guestPhone: "0400 000 001", departingGuestName: "Departing Dev", departingGuestPhone: "0400 000 002" }}
    />,
  );
  const links = screen.getAllByRole("link");
  expect(links.map((link) => link.getAttribute("href"))).toEqual(["tel:0400000002", "tel:0400000001"]);
  expect(links[0]).toHaveTextContent("Departing Dev");
  expect(links[0]).toHaveTextContent("Departing guest");
  expect(links[1]).toHaveTextContent("Arriving guest");
});

it("shows the departing guest when there is no arriving guest", () => {
  render(<ContactRows contact={{ departingGuestPhone: "0400 000 002" }} />);
  expect(screen.getByRole("link")).toHaveTextContent("Departing guest");
});

it("omits a departing guest with no phone number", () => {
  render(<ContactRows contact={{ departingGuestName: "Departing Dev" }} />);
  expect(screen.getByText("No contact numbers configured")).toBeInTheDocument();
});
