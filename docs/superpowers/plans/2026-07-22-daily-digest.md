# Daily Digest (Phase 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sidebar "Daily Digest" button that prints a report of today's action items grouped by coordinator, reusing the existing Workflow Follow-up (A-L) system.

**Architecture:** One new HTML button (no `data-tab`, guarded against the tab-switcher), one new JS function pair (`generateDailyDigest` + `setupDailyDigestButton`), plus a one-line safety guard added to the existing `setupTabSwitching()` click handler so a `data-tab`-less nav button never blanks the active tab.

**Tech Stack:** Vanilla JS, no build step, no test framework. No git repo — do not run git commands.

**Spec:** `docs/superpowers/specs/2026-07-22-daily-digest-design.md`

---

### Task 1: JS — digest generator, button wiring, tab-switch safety guard

**Files:** Modify `dashboard.js` (3 edits, all in this one task to minimize round-trips)

- [ ] **Edit A — safety guard in `setupTabSwitching()`**

Find:
```js
    navItems.forEach(item => {
        item.addEventListener("click", () => {
            const targetTab = item.getAttribute("data-tab");

            navItems.forEach(i => { i.classList.remove("active"); i.removeAttribute("aria-current"); });
```
Replace with:
```js
    navItems.forEach(item => {
        item.addEventListener("click", () => {
            const targetTab = item.getAttribute("data-tab");
            if (!targetTab) return;

            navItems.forEach(i => { i.classList.remove("active"); i.removeAttribute("aria-current"); });
```

- [ ] **Edit B — add `generateDailyDigest()` and `setupDailyDigestButton()`**

Insert these two new functions anywhere at top level in `dashboard.js` (e.g. right after `setupResetCache()`'s closing `}` — find `function setupResetCache() {` and insert after its matching closing brace, before the next function). Exact bodies:

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

- [ ] **Edit C — call `setupDailyDigestButton()` from `initApp()`**

Find:
```js
    setupResetCache();
    if (dependenciesReady) {
```
Replace with:
```js
    setupResetCache();
    setupDailyDigestButton();
    if (dependenciesReady) {
```

- [ ] **Verify:** Read the file back to confirm all 3 edits landed correctly and `generateDailyDigest`/`setupDailyDigestButton`/the `if (!targetTab) return;` guard each appear exactly once. `isClosedCase`, `getPatientWorkflowLists`, `WORKFLOW_LISTS`, `getPatientVal`, `getEscapedPatientVal`, `escapeHTML`, `showToast` are all pre-existing — do not modify them. No git commands.

Report: Status, what changed, verification, concerns.

---

### Task 2: HTML — sidebar button

**Files:** Modify `index.html`

Find:
```html
                    <button class="nav-item" data-tab="settings" id="nav-settings">
                        <i class="fa-solid fa-gear"></i>
                        <span>Sync Settings</span>
                    </button>
                </div>
            </nav>
```
Replace with:
```html
                    <button class="nav-item" data-tab="settings" id="nav-settings">
                        <i class="fa-solid fa-gear"></i>
                        <span>Sync Settings</span>
                    </button>
                    <button class="nav-item" id="nav-daily-digest">
                        <i class="fa-solid fa-file-lines"></i>
                        <span>Daily Digest</span>
                    </button>
                </div>
            </nav>
```
Note: the new button intentionally has NO `data-tab` attribute (Task 1's guard handles this safely).

Verify: `id="nav-daily-digest"` unique in the file, no `data-tab` attribute on it, Sync Settings button unchanged, no new CSS. No git commands.

Report: Status, what changed, verification, concerns.

---

### Task 3: End-to-end verification

**Files:** None.

1. Reload app with patient data loaded. Click "Daily Digest" — confirm a popup opens, grouped by coordinator (busiest first), each patient shows readable action labels, print dialog triggers. Aggregate/coordinator-level content only is safe to screenshot; if real patient names appear, verify via DOM text reads instead of screenshots.
2. Confirm clicking "Daily Digest" does NOT blank out or deactivate the currently active main-window tab (check `document.querySelector('.tab-pane.active')` still returns a pane before and after the click — this is the regression the Task 1 guard prevents).
3. Click through 2-3 other sidebar tabs normally afterward to confirm they still work (regression check on the guard change).
4. No console errors.
