# Main release coverage — 2026-10-09

Focused pre-commit run: 523 tests passed across 44 files. Production build and full-suite results are in the recent-changes review. This project has no mandatory coverage gate. The skill default of 95% lines, branches and functions is advisory here. These figures describe the focused test selection; they are not a full-suite coverage measurement. No pre-change coverage baseline was run, so regression comparison is unavailable.

Coverage command: Vitest V8 over changed non-database test files, with explicit coverage include paths for all 179 changed TypeScript source files and JSON/JSON-summary reporters. Reports retained outside the repository in `/workspace/scratch/main-release/coverage/`. Future runs can persist this command in dev-kit configuration if the project adopts that workflow.

8 of 179 source files meet all three advisory targets. Uncovered portal entry points and presentation branches require mounted route/view tests; uncovered permissions and evidence branches require additional deny, conflict and retry cases. The existing passing browser and database checks are separate evidence.

| File | Lines | Branches | Functions | Verdict |
| --- | ---: | ---: | ---: | --- |
| app/admin/jobs/[id]/page.tsx | N/A | N/A | N/A | NOT MEASURED |
| app/api/admin/cases/[id]/route.ts | N/A | N/A | N/A | NOT MEASURED |
| app/api/admin/clients/[id]/route.ts | N/A | N/A | N/A | NOT MEASURED |
| app/api/admin/form-templates/[id]/route.ts | N/A | N/A | N/A | NOT MEASURED |
| app/api/admin/invoices/[id]/reconcile/route.ts | N/A | N/A | N/A | NOT MEASURED |
| app/api/admin/jobs/[id]/reset/route.ts | N/A | N/A | N/A | NOT MEASURED |
| app/api/admin/jobs/[id]/route.ts | N/A | N/A | N/A | NOT MEASURED |
| app/api/admin/laundry/[taskId]/route.ts | N/A | N/A | N/A | NOT MEASURED |
| app/api/admin/laundry/confirmations/[confirmationId]/route.ts | N/A | N/A | N/A | NOT MEASURED |
| app/api/admin/properties/[id]/route.ts | N/A | N/A | N/A | NOT MEASURED |
| app/api/cleaner/jobs/[id]/evidence/route.ts | N/A | N/A | N/A | NOT MEASURED |
| app/api/laundry/[taskId]/route.ts | N/A | N/A | N/A | NOT MEASURED |
| app/v2/admin/jobs/[id]/page.tsx | N/A | N/A | N/A | NOT MEASURED |
| app/v2/admin/properties/[id]/page.tsx | N/A | N/A | N/A | NOT MEASURED |
| app/v2/client/jobs/[id]/page.tsx | N/A | N/A | N/A | NOT MEASURED |
| app/v2/client/properties/[id]/page.tsx | N/A | N/A | N/A | NOT MEASURED |
| app/admin/laundry/page.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| app/admin/page.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| app/admin/settings/holiday-rates/page.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| app/admin/settings/page.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| app/api/admin/ops-permissions/route.ts | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| app/api/auth/retained/validate/route.ts | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| app/api/auth/validate-session/route.ts | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| app/api/me/ops-permissions/route.ts | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| app/cleaner/jobs/page.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| app/laundry/page.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| app/layout.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| app/providers.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| app/v2/admin/access-denied/page.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| app/v2/admin/finance/page.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| app/v2/admin/inventory/page.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| app/v2/admin/jobs/page.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| app/v2/admin/laundry/page.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| app/v2/admin/settings/holiday-rates/page.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| app/v2/admin/settings/page.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| app/v2/admin/settings/property-form/page.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| app/v2/cleaner/jobs/page.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| app/v2/cleaner/supplies/page.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| app/v2/laundry/tracking/page.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/admin/ops-live-map.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/admin/settings-workspace.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/admin/sidebar.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/client/client-laundry-workspace.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/finance/holiday-rates-workspace.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/qa/qa-job-client.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/shared/view-memory-provider.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/accounts/staff-manager.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/accounts/va-directory.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/approvals/approvals-history.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/calendar/estate-schedule.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/checklists/checklist-coverage.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/cleaner-invoices/cleaner-invoices-tabs.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/cleaner-invoices/cleaner-invoices-workspace.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/cleaners/cleaners-roster.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/comms/delivery-log.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/comms/intent-queue.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/delivery-profiles/estate-delivery-profiles.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/diagnostics/diagnostics-hub.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/finance/estate-invoices.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/finance/finance-overview.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/finance/pay-adjustments.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/finance/time-adjustments.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/forms/management/estate-forms-list.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/hiring/pipeline/hiring-pipeline.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/hiring/position/position-editor.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/inventory/estate-items.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/jobs/draft-evidence-review.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/laundry/laundry-evidence-replacement.tsx | 6.94 | 100 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/laundry/laundry-reports.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/lost-found/lost-found-board.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/marketing/campaigns-manager.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/marketing/template-gallery.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/messages/compose-workspace.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/messages/messages-workspace.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/onboarding/surveys-board.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/onboarding/wizard.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/ops/estate-ops-map.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/ops/live-cleaners.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/properties/properties-portfolio.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/properties/property-jobs-history.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/quotes/quotes-pipeline.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/reports/reports-manager.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/settings/audit-section.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/settings/ical-section.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/settings/overview-section.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/settings/roles-section.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/templates/message-templates-workspace.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/templates/notification-templates-workspace.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/website/blog/blog-workspace.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/website/editor/website-editor.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/workforce/compliance-board.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/admin/workforce/roster-table.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/cleaner/daily-briefing.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/cleaner/driving-mode.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/cleaner/job-stages/job-header.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/cleaner/job-stages/parts.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/cleaner/job-stages/stage-accept.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/cleaner/job-stages/stage-clean.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/cleaner/job-stages/stage-nav.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/cleaner/job-stages/stage-setup.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/cleaner/job-stages/stage-travel.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/cleaner/pay-requests-panel.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/cleaner/property-info-drawer.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/cleaner/route-driving.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/cleaner/team-hub.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/client/cases-workspace.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/client/laundry/laundry-workspace.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/client/services-agenda.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/laundry/history-board.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/laundry/laundry-board.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/laundry/laundry-delete-dialog.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/laundry/laundry-team-hub.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/maintenance/tickets-workspace.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/portal/portal-shell.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/qa/qa-inspection-workspace.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/v2/qa/qa-queue-workspace.tsx | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| hooks/use-toast.ts | 47.36 | 100 | 0 | BELOW ADVISORY TARGET |
| lib/auth/session.ts | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| lib/briefing/cleaner-briefing.ts | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| lib/briefing/spoken-script.ts | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| lib/cleaner/shared-job-draft.ts | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| lib/forms/resolve-effective-job-form.ts | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| lib/inventory/urgent-stock.ts | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| lib/laundry/bag-custody.ts | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| lib/laundry/deletion.ts | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| lib/portal/search.ts | 0 | 0 | 0 | BELOW ADVISORY TARGET |
| components/property-care/workspace.tsx | 17.51 | 59.25 | 6.45 | BELOW ADVISORY TARGET |
| components/inventory/urgent-stock-workspace.tsx | 27.45 | 50 | 7.69 | BELOW ADVISORY TARGET |
| components/client/client-jobs-workspace.tsx | 48.87 | 63.63 | 19.35 | BELOW ADVISORY TARGET |
| components/v2/admin/properties/property-detail.tsx | 61.75 | 49.58 | 19.67 | BELOW ADVISORY TARGET |
| components/shared/ops-access-provider.tsx | 20.96 | 100 | 66.66 | BELOW ADVISORY TARGET |
| components/v2/admin/laundry/laundry-investigation.tsx | 79.01 | 52.17 | 25 | BELOW ADVISORY TARGET |
| components/v2/admin/laundry/laundry-workspace.tsx | 78.53 | 52.74 | 27.27 | BELOW ADVISORY TARGET |
| app/api/admin/turnover-profit/route.ts | 84.61 | 28.57 | 100 | BELOW ADVISORY TARGET |
| lib/forms/device-status.ts | 66.07 | 45 | 28.57 | BELOW ADVISORY TARGET |
| app/api/laundry/bag-custody/route.ts | 65.38 | 30 | 75 | BELOW ADVISORY TARGET |
| components/v2/admin/jobs/jobs-workspace.tsx | 81.74 | 88.26 | 31.42 | BELOW ADVISORY TARGET |
| components/v2/admin/estate-kit.tsx | 55.89 | 81.08 | 31.57 | BELOW ADVISORY TARGET |
| components/v2/client/jobs-board.tsx | 63.18 | 71.24 | 32.55 | BELOW ADVISORY TARGET |
| components/shared/global-request-progress.tsx | 60.29 | 39.53 | 76.92 | BELOW ADVISORY TARGET |
| middleware.ts | 46.06 | 45.63 | 40 | BELOW ADVISORY TARGET |
| components/v2/admin/jobs/job-row.tsx | 92.95 | 43.87 | 56.52 | BELOW ADVISORY TARGET |
| components/operations/turnover-profit.tsx | 76.83 | 66.66 | 44.44 | BELOW ADVISORY TARGET |
| hooks/use-restorable-state.ts | 66.66 | 80 | 50 | BELOW ADVISORY TARGET |
| lib/security/admin-verification.ts | 69 | 55 | 50 | BELOW ADVISORY TARGET |
| components/v2/cleaner/job-workspace.tsx | 84.42 | 76.62 | 51.92 | BELOW ADVISORY TARGET |
| components/v2/admin/laundry/laundry-shared.ts | 91.6 | 55 | 100 | BELOW ADVISORY TARGET |
| lib/client/restorable-state.ts | 68.86 | 55.55 | 66.66 | BELOW ADVISORY TARGET |
| components/inventory/stay-preparation-panel.tsx | 68.03 | 60 | 57.14 | BELOW ADVISORY TARGET |
| components/v2/admin/settings/ops-permissions-section.tsx | 88.2 | 76 | 57.14 | BELOW ADVISORY TARGET |
| lib/rbac/ops-access.ts | 57.83 | 80 | 75 | BELOW ADVISORY TARGET |
| lib/gps/client.tsx | 84.82 | 82.89 | 58.33 | BELOW ADVISORY TARGET |
| app/v2/cleaner/route/page.tsx | 98.81 | 60 | 100 | BELOW ADVISORY TARGET |
| components/ui/tabs.tsx | 98.5 | 65.38 | 100 | BELOW ADVISORY TARGET |
| lib/cleaner/evidence-client.ts | 91.49 | 66.53 | 88.23 | BELOW ADVISORY TARGET |
| app/api/inventory/urgent-stock/route.ts | 93.33 | 67.85 | 100 | BELOW ADVISORY TARGET |
| components/operations/linen-bags.tsx | 99.07 | 89.09 | 69.23 | BELOW ADVISORY TARGET |
| app/api/admin/ops/live-locations/stream/route.ts | 88.57 | 70.37 | 100 | BELOW ADVISORY TARGET |
| components/v2/cleaner/bulk-photo-assign.tsx | 91.33 | 78.21 | 71.05 | BELOW ADVISORY TARGET |
| app/v2/cleaner/page.tsx | 81.07 | 74.5 | 88.88 | BELOW ADVISORY TARGET |
| components/v2/admin/jobs/saved-views-controls.tsx | 100 | 93.85 | 75 | BELOW ADVISORY TARGET |
| components/v2/cleaner/shift-route-overview.tsx | 100 | 85.71 | 75 | BELOW ADVISORY TARGET |
| lib/rbac/ops-catalog.ts | 100 | 76.62 | 100 | BELOW ADVISORY TARGET |
| app/v2/admin/page.tsx | 81.84 | 77.03 | 90.9 | BELOW ADVISORY TARGET |
| lib/navigation/view-memory.ts | 96.47 | 85 | 100 | BELOW ADVISORY TARGET |
| components/shared/job-status-icon.tsx | 100 | 88.46 | 100 | BELOW ADVISORY TARGET |
| lib/forms/device-charging.ts | 99.15 | 88.88 | 100 | BELOW ADVISORY TARGET |
| lib/ops/live-positions.ts | 100 | 88.88 | 100 | BELOW ADVISORY TARGET |
| components/v2/admin/jobs/use-jobs-workspace-state.ts | 96.2 | 89.28 | 100 | BELOW ADVISORY TARGET |
| lib/rbac/ops-policy.ts | 100 | 89.47 | 100 | BELOW ADVISORY TARGET |
| components/operations/ui.tsx | 100 | 89.65 | 100 | BELOW ADVISORY TARGET |
| hooks/use-shared-evidence-sync.ts | 100 | 96.66 | 100 | PASS |
| components/v2/admin/settings/settings-navigation.tsx | 100 | 98.27 | 100 | PASS |
| components/shared/job-status-progress.tsx | 100 | 100 | 100 | PASS |
| components/shared/live-page-refresh.tsx | 100 | 100 | 100 | PASS |
| components/v2/admin/jobs/view-options-menu.tsx | 100 | 100 | 100 | PASS |
| components/v2/admin/settings/settings-catalog.ts | 100 | 100 | 100 | PASS |
| lib/jobs/status-presentation.ts | 100 | 100 | 100 | PASS |
| lib/security/sensitive-actions.ts | 100 | 100 | 100 | PASS |
