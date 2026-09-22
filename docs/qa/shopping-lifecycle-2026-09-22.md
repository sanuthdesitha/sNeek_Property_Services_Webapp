# Shopping lifecycle verification — 2026-09-22

## Delivered in existing pages

- Cleaner shopping: general/property purchases, actual catalogue/custom items alongside suggestions, mandatory time/cost/owned receipts on completion.
- Completion posts purchased quantities to cleaner holdings once. Both cleaner and admin may make audited corrections. Same catalogue item and unit are grouped; source records remain distinct.
- Cleaner stock entry and delivery support multi-item batches in the existing page, with all-or-none writes and persistent exact-request retry. Delivery destinations are active assigned properties for cleaners. General stock can be delivered later. Partial deliveries allocate cents and whole minutes cumulatively; duplicate delivery requests cannot deduct or bill twice.
- Client shopping details and completion/delivery emails show only that client's property information. Shared receipts are withheld where they contain other clients/general stock. Preferences remain respected; uncertain email attempts are logged without automatic blind retry.
- Existing admin run detail approves a separate client time rate, expense waiver and accounting treatment. Pending charges never enter invoices. Payer changes invalidate uninvoiced approval; invoiced charges are locked. Cleaner pay stays separate.
- Invoice generation consumes approved sources atomically, stores source snapshots, prevents legacy duplicates and releases eligible allocations on void. Agency disbursements are outside the invoice GST base and operational revenue; ordinary recharges/time retain ordinary treatment.
- Company Xero exports require a separate configured balance-sheet account for agency disbursements (BASEXCLUDED). Correct classification requires office review; this is not a blanket exemption for all reimbursements.
- Clients can download their own issued invoice PDF and manually upload it to their own Xero. No new pages, client OAuth flow or one-click Xero import.

## Verification

- Prisma client generated; schema validation passed with a placeholder database URL (validation does not connect).
- TypeScript `tsc --noEmit` passed.
- Final integrated regression batch: 334 tests passed across 36 files, including independent purchase waivers, invoiced payer locks, no-GST Xero exports and exact one-minute labour amounts. One earlier expectation was updated for the new expenseBillable default before this clean run.
- Four Playwright fixture suites: 12/12 scenarios passed (cleaner stock 6, admin stock 2, actual shopping 2, client purchase details 2). Cleaner batch checks include two-item creation, failed second-item preservation, lost delivery acknowledgements, empty refreshed holdings and reverse-order receipts at 320/390px. Fresh 320/390px screenshots inspected; desktop scenarios also passed. These are mocked browser fixtures, not production end-to-end tests.
- Focused V8 run before the final Xero rounding/mapping fixes and batch additions: 90 tests passed. Eight new core helpers: 98.64% lines, 79.44% branches, 95.45% functions. Advisory 95% per-metric coverage target is not met for branches and the charge helper's functions; no required coverage gate is configured. This focused run does not claim coverage of every touched file.
- Unit tests exercise authorization, revision checks, payment changes, invoice claims, rounding and failure paths using mocked transactions/providers. No real PostgreSQL concurrency/rollback, production email delivery, actual PDF rendering or live Xero operation was performed.

## Deployment and setup

Deploy all three migrations from the new application image before serving the new code:

- `20260922120000_shopping_client_charges`
- `20260922140000_general_shopping_lines`
- `20260922141000_held_stock_purchase_source`

Use the repository's existing one-shot runner (`sh /app/scripts/migrate-once.sh`) in a container of the new image with the production database environment and network. Do not run the migrations concurrently on every replica. No production migrations were applied in this task.

In the existing admin shopping run detail, review client allocations, set the agreed client hourly rate and approve the treatment. Configure the separate disbursement balance-sheet account in existing Xero settings before exporting agency lines. Check one direct purchase and one general-stock delivery on the deployed environment, including the client email/receipt access and next generated invoice, before relying on the workflow operationally.

Official references: [Xero bill upload](https://central.xero.com/s/article/Upload-bills-into-Xero), [Xero tax types](https://developer.xero.com/documentation/api/accounting/types/).
