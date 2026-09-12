import { expect, test } from "../fixtures/local-admin";
import type { Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

test.skip(process.env.SNEEK_E2E_LOCAL_FIXTURES !== "1", "Requires explicitly enabled loopback database fixtures");
test.setTimeout(180_000);

class TicketPage {
  constructor(private page: Page) {}
  async open() { await this.page.goto("/v2/maintenance/tickets"); }
  async search(value: string) { await this.page.getByRole("textbox", { name: "Search tickets" }).fill(value); }
  async keyboardView(name: string) {
    await this.page.getByRole("button", { name }).focus();
    await this.page.keyboard.press("Enter");
  }
  ticket(name: string) { return this.page.getByRole("link", { name, exact: true }); }
}

test("maintenance board and keyboard list preserve the unresolved ticket", async ({ localAdmin }) => {
  const { page } = localAdmin;
  const db = new PrismaClient();
  const id = `e2e-ticket-${randomUUID()}`;
  const title = `Fixture repair ${id}`;
  try {
    await db.client.create({ data: { id, name: "Maintenance verification" } });
    await db.property.create({ data: { id, clientId: id, name: "Fixture property", address: "1 Fixture Street", suburb: "Sydney" } });
    await db.propertyMaintenanceItem.create({ data: {
      id, propertyId: id, reportedByUserId: localAdmin.id, source: "ADMIN", title,
      priority: "URGENT", status: "OPEN", outcome: "NEEDS_PARTS", costApprovalStatus: "PENDING", clockOutAt: new Date(),
    } });
    const tickets = new TicketPage(page);
    await tickets.open();
    await tickets.search(id);
    await expect(tickets.ticket(title)).toBeVisible();
    await expect(page.getByText("Needs parts", { exact: true })).toBeVisible();
    await expect(page.getByText(/Awaiting cost approval/)).toBeVisible();
    await tickets.keyboardView("Board view");
    await expect(page.getByRole("region", { name: "Open tickets" }).getByRole("link", { name: title })).toBeVisible();
    await tickets.keyboardView("List view");
    await expect(tickets.ticket(title)).toBeVisible();
    await expect(page.getByRole("region", { name: "Open tickets" })).toHaveCount(0);
    await tickets.search("No matching fixture exists");
    await expect(page.getByText("No matching tickets", { exact: true })).toBeVisible();
  } finally {
    await db.propertyMaintenanceItem.deleteMany({ where: { id, reportedByUserId: localAdmin.id } });
    await db.property.deleteMany({ where: { id, clientId: id } });
    await db.client.deleteMany({ where: { id } });
    await db.$disconnect();
  }
});
