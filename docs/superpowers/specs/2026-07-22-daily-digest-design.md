# Phase 4: Daily Digest

## Goal
A "Daily Digest" button in the sidebar (System group) that generates a print-ready report of today's action items, grouped by coordinator (busiest first), reusing the existing Workflow Follow-up (A-L) system and print-window pattern.

## Scope decisions
- **Inclusion:** patients where `!isClosedCase(pat)` AND `getPatientWorkflowLists(pat)` intersects `{A,B,C,D,E,F,G,H,I,L}` (same "actionable" set already used in `updateBadges()`'s `ACTION_LISTS`, redefined locally here — small deliberate duplication, same precedent as Phase 3's `computeSnapshotSummary`).
- **Grouping:** by coordinator (empty/missing → "Unassigned"), sorted by item count descending. Coordinators with 0 actionable items omitted entirely. Zero items overall → toast "No action items to report today." instead of opening a blank print window.
- **Per-patient labels:** each matching list id's `WORKFLOW_LISTS[id].title` (existing lookup), joined with `<br>` if a patient matches multiple lists.
- **Output:** same popup-window print pattern as `executePrintJob()` (landscape, auto `window.print()` + close) — a new dedicated `generateDailyDigest()` function, not a reuse of `executePrintJob` itself, since content is grouped sections, not a flat table.

## Bug to avoid: sidebar click wiring
The digest button must NOT be treated as a tab-switcher by `setupTabSwitching()`. Its `document.querySelectorAll(".nav-item")` loop currently has no guard for a missing `data-tab` — clicking a `.nav-item` without `data-tab` would deactivate every tab pane and leave the app blank (a real regression). Fix: add `if (!targetTab) return;` as the first line inside that click handler, before any DOM mutation. Then the digest button gets its own separate click listener (`setupDailyDigestButton()`) calling `generateDailyDigest()` — both listeners coexist safely on the same button.

## HTML (`index.html`, System nav group)
```html
<button class="nav-item" id="nav-daily-digest">
    <i class="fa-solid fa-file-lines"></i>
    <span>Daily Digest</span>
</button>
```
Inserted right after the existing Sync Settings button, still inside the "System" `.nav-group`. No `data-tab` attribute (intentional, see bug note above).

## JS (`dashboard.js`)

```js
function setupDailyDigestButton() {
    const btn = document.getElementById("nav-daily-digest");
    if (btn) btn.addEventListener("click", generateDailyDigest);
}

function generateDailyDigest() {
    const ACTION_LISTS = ['A','B','C','D','E','F','G','H','I','L'];
    const byCoordinator = {};
    patientsData.forEach(pat => {
        if (isClosedCase(pat)) return;
        const lists = [...getPatientWorkflowLists(pat)].filter(id => ACTION_LISTS.includes(id));
        if (lists.length === 0) return;
        const coordinator = getPatientVal(pat, 'coordinator') || 'Unassigned';
        if (!byCoordinator[coordinator]) byCoordinator[coordinator] = [];
        byCoordinator[coordinator].push({ pat, lists });
    });

    const coordinatorNames = Object.keys(byCoordinator).sort((a, b) => byCoordinator[b].length - byCoordinator[a].length);
    if (coordinatorNames.length === 0) {
        showToast("No action items to report today.", "info");
        return;
    }
    const totalItems = coordinatorNames.reduce((sum, c) => sum + byCoordinator[c].length, 0);

    let bodyHtml = '';
    coordinatorNames.forEach(coordinator => {
        const items = byCoordinator[coordinator];
        bodyHtml += `<h2>${escapeHTML(coordinator)} (${items.length} item${items.length !== 1 ? 's' : ''})</h2><table><thead><tr><th>Patient Name</th><th>ID</th><th>Clinic</th><th>Action Needed</th></tr></thead><tbody>`;
        items.forEach(({ pat, lists }) => {
            const labels = lists.map(id => escapeHTML(WORKFLOW_LISTS[id].title)).join('<br>');
            bodyHtml += `<tr><td>${getEscapedPatientVal(pat, 'name')}</td><td>${getEscapedPatientVal(pat, 'id')}</td><td>${getEscapedPatientVal(pat, 'clinic')}</td><td>${labels}</td></tr>`;
        });
        bodyHtml += `</tbody></table>`;
    });

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
        showToast("Error: Popup blocked! Please allow popups for this site.", "error");
        return;
    }

    const dateStr = new Date().toLocaleString();
    const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <title>Daily Digest</title>
        <style>
            @page { size: landscape; margin: 12mm 15mm; }
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #222222; background: #ffffff; margin: 0; padding: 10px; font-size: 9.5pt; }
            h1 { font-size: 20pt; margin: 0 0 4px 0; color: #1e3a8a; font-weight: 700; }
            .meta { font-size: 10pt; color: #555555; margin-bottom: 10px; }
            h2 { font-size: 13pt; color: #1e3a8a; margin-top: 24px; border-bottom: 1px solid #cccccc; padding-bottom: 4px; }
            table { width: 100%; border-collapse: collapse; margin-top: 8px; }
            th, td { border: 1px solid #cccccc; padding: 6px 8px; text-align: left; vertical-align: top; }
            th { background-color: #f3f4f6; color: #1f2937; font-weight: 700; }
        </style>
    </head>
    <body>
        <h1>Daily Digest</h1>
        <p class="meta">${dateStr} — ${totalItems} action item${totalItems !== 1 ? 's' : ''} across ${coordinatorNames.length} coordinator${coordinatorNames.length !== 1 ? 's' : ''}</p>
        ${bodyHtml}
        <script>
            window.onload = function() {
                window.print();
                setTimeout(function() { window.close(); }, 500);
            };
        <\/script>
    </body>
    </html>
    `;

    printWindow.document.open();
    printWindow.document.write(htmlContent);
    printWindow.document.close();
}
```

`setupDailyDigestButton()` is called from `initApp()`.

## Edge cases
- No actionable items at all → toast, no popup (avoids a blank print window).
- Popup blocked → existing error toast pattern reused verbatim.
- Coordinator field blank → grouped under "Unassigned", still included if it has items.

## Test plan
1. With real/sample data loaded, click "Daily Digest" — confirm popup opens, grouped correctly, sorted busiest-coordinator-first, action labels readable, print dialog triggers.
2. Temporarily filter to a dataset with zero actionable items (or a tiny synthetic all-closed dataset) — confirm toast instead of popup.
3. Confirm clicking the button does NOT blank out the currently active tab (the bug this design explicitly guards against).
4. No console errors.
