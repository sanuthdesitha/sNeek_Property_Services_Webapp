# Jobs Layout Recheck

Verified the existing local responsive-row fix against the reported screenshot.

- Local URL: http://localhost:3010/v2/admin/jobs
- Browser: Chromium, authenticated isolated QA administrator.
- Viewport widths: 390, 779, 1000, 1280, 1440, 1920 pixels.
- All six widths: no document horizontal overflow; property column remained at least 263 pixels wide in the sampled rows.
- Narrow layouts use the compact property summary rather than squeezing seven columns into the available space.
- Exact reported property, QA Harbour Apartment: name readable at 779 pixels; EARLY 13:00 and LATE 10:30 visible.
- Search found the reported property; row checkbox toggled correctly; Manage navigated to that job's schedule tab.
- Automated: 48 tests passed across admin-job-row, jobs-workspace-state, jobs-workspace-url and job-dialog.

No new layout changes were needed for this recheck. The responsive fix was already present in the working tree. This does not certify unrelated portal changes or the entire application.
