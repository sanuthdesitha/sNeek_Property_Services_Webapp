# Feature Usage Guide (Harder Workflows)

## 1) Email template visual builder + snippets

Path: `Admin -> Settings -> Email Templates`

- Pick a template.
- Enable `Visual builder`.
- Use `Snippet library`:
  - `Insert snippet` appends
  - `Replace with snippet` replaces current blocks
- Drag blocks to reorder.
- Use variables like `{userName}`, `{propertyName}`, `{actionUrl}`, `{actionLabel}`.
- Use preview switch (`Mobile` / `Desktop`) before saving.

## 2) Future job start protection (Cleaner)

Path: `Cleaner -> Job`

- If cleaner tries to start a future-date job, a warning confirmation appears.
- If confirmed, the system logs an audit record and notifies admins.

## 3) Forced password reset flow

- Admin reset sends temporary password.
- On next login, user is forced to `/force-password-reset`.
- After changing password, normal portal access resumes.

## 4) Onboarding lock + required profile fields

- New users are redirected to `/onboarding`.
- Tutorial appears first.
- Required fields by role must be completed before portal usage:
  - Cleaner/Laundry: bank details
  - Client/Laundry: ABN + business name
  - All non-admins: address + contact number

## 5) Extra pay request approval chain

- Cleaner submits extra pay request.
- Admin reviews first.
- Client communication is admin-controlled (no direct cleaner-to-client send).

## 6) Inventory low stock behavior

- Form submission deducts property stock.
- When below threshold, admin/ops push notifications are created.
- Items then appear in shopping/low-stock workflows.

